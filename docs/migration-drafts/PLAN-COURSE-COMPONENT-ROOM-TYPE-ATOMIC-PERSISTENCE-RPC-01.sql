-- SOURCE-ONLY FORWARD DRAFT. DO NOT APPLY WITHOUT A SEPARATE APPROVAL.
-- PLAN-COURSE-COMPONENT-ROOM-TYPE-ATOMIC-PERSISTENCE-RPC-01
BEGIN;

-- Preserve the historical dispatcher for non-plan imports and for the V2
-- transaction. It is no longer directly executable by client roles.
ALTER FUNCTION public.commit_import_job_atomic(uuid, timestamptz)
  RENAME TO commit_import_job_atomic_legacy_impl;

REVOKE ALL ON FUNCTION public.commit_import_job_atomic_legacy_impl(uuid, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public._import_validate_plan_component_payload_v2(
  p_college uuid,
  p_components jsonb
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_component jsonb;
  v_type text;
  v_hours numeric;
  v_room_id uuid;
  v_room public.room_types%ROWTYPE;
  v_seen text[] := ARRAY[]::text[];
  v_expected integer := 0;
  v_timetabled boolean;
BEGIN
  IF p_components IS NULL OR jsonb_typeof(p_components) <> 'array' THEN
    RAISE EXCEPTION 'ROOM_TYPE_COMPONENT_CONTRACT_INVALID: components must be an array'
      USING ERRCODE = '22023';
  END IF;

  FOR v_component IN SELECT value FROM jsonb_array_elements(p_components)
  LOOP
    IF jsonb_typeof(v_component) <> 'object' THEN
      RAISE EXCEPTION 'ROOM_TYPE_COMPONENT_CONTRACT_INVALID: component must be an object'
        USING ERRCODE = '22023';
    END IF;
    v_type := NULLIF(v_component->>'component_type', '');
    IF v_type IS NULL OR v_type NOT IN (
      'theory', 'practical', 'tutorial', 'project', 'summer_training'
    ) THEN
      RAISE EXCEPTION 'ROOM_TYPE_COMPONENT_CONTRACT_INVALID: component_type=%', v_type
        USING ERRCODE = '22023';
    END IF;
    IF v_type = ANY(v_seen) THEN
      RAISE EXCEPTION 'ROOM_TYPE_COMPONENT_CONTRACT_INVALID: duplicate component_type=%', v_type
        USING ERRCODE = '22023';
    END IF;
    v_seen := array_append(v_seen, v_type);

    BEGIN
      v_hours := COALESCE(
        NULLIF(v_component->>'hours', '')::numeric,
        NULLIF(v_component->>'weekly_contact_hours', '')::numeric
      );
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'ROOM_TYPE_COMPONENT_CONTRACT_INVALID: invalid hours for %', v_type
        USING ERRCODE = '22023';
    END;
    IF v_hours IS NULL OR v_hours < 0 THEN
      RAISE EXCEPTION 'ROOM_TYPE_COMPONENT_CONTRACT_INVALID: hours must be non-negative for %', v_type
        USING ERRCODE = '22023';
    END IF;
    v_timetabled := COALESCE((v_component->>'is_timetabled')::boolean, false);

    IF v_type = 'summer_training' THEN
      IF v_timetabled OR NULLIF(v_component->>'required_room_type_id', '') IS NOT NULL THEN
        RAISE EXCEPTION 'SUMMER_TRAINING_ROOM_POLICY_REQUIRED'
          USING ERRCODE = '22023';
      END IF;
      CONTINUE;
    END IF;

    IF v_hours <= 0 OR NOT v_timetabled THEN
      IF NULLIF(v_component->>'required_room_type_id', '') IS NOT NULL THEN
        RAISE EXCEPTION 'ROOM_TYPE_COMPONENT_CONTRACT_INVALID: zero/non-timetabled % has room type', v_type
          USING ERRCODE = '22023';
      END IF;
      CONTINUE;
    END IF;

    IF NULLIF(v_component->>'required_room_type_id', '') IS NULL THEN
      RAISE EXCEPTION 'ROOM_TYPE_REQUIRED_ATOMIC: component_type=%', v_type
        USING ERRCODE = '22023';
    END IF;
    IF (v_component->>'required_room_type_id') !~
       '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
      RAISE EXCEPTION 'ROOM_TYPE_COMPONENT_CONTRACT_INVALID: room type UUID for %', v_type
        USING ERRCODE = '22023';
    END IF;
    v_room_id := (v_component->>'required_room_type_id')::uuid;
    SELECT * INTO v_room FROM public.room_types WHERE id = v_room_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ROOM_TYPE_NOT_FOUND_ATOMIC: %', v_room_id
        USING ERRCODE = '22023';
    END IF;
    IF v_room.college_id IS DISTINCT FROM p_college THEN
      RAISE EXCEPTION 'ROOM_TYPE_WRONG_COLLEGE_ATOMIC: %', v_room_id
        USING ERRCODE = '42501';
    END IF;
    IF NOT COALESCE(v_room.is_active, false) THEN
      RAISE EXCEPTION 'ROOM_TYPE_INACTIVE_ATOMIC: %', v_room_id
        USING ERRCODE = '22023';
    END IF;
    IF COALESCE(v_room.default_capacity, 0) <= 0 THEN
      RAISE EXCEPTION 'ROOM_TYPE_ZERO_CAPACITY_ATOMIC: %', v_room_id
        USING ERRCODE = '22023';
    END IF;
    v_expected := v_expected + 1;
  END LOOP;
  RETURN v_expected;
END;
$fn$;

CREATE OR REPLACE FUNCTION public._import_sync_plan_components_atomic_v2(
  p_college uuid,
  p_plan_course uuid,
  p_components jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_component jsonb;
  v_type text;
  v_hours numeric;
  v_room_id uuid;
  v_exists boolean;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_room_saved integer := 0;
BEGIN
  PERFORM public._import_validate_plan_component_payload_v2(p_college, p_components);

  FOR v_component IN SELECT value FROM jsonb_array_elements(p_components)
  LOOP
    v_type := v_component->>'component_type';
    v_hours := COALESCE(
      NULLIF(v_component->>'hours', '')::numeric,
      NULLIF(v_component->>'weekly_contact_hours', '')::numeric
    );
    v_room_id := NULLIF(v_component->>'required_room_type_id', '')::uuid;
    SELECT EXISTS (
      SELECT 1 FROM public.plan_course_components
      WHERE plan_course_id = p_plan_course AND component_type = v_type
    ) INTO v_exists;

    INSERT INTO public.plan_course_components (
      college_id, plan_course_id, component_type, weekly_contact_hours,
      is_timetabled, counts_toward_regular_load, counts_toward_overtime,
      compensation_mode, required_room_type_id
    ) VALUES (
      p_college, p_plan_course, v_type, v_hours,
      COALESCE((v_component->>'is_timetabled')::boolean, false),
      COALESCE((v_component->>'counts_toward_regular_load')::boolean, false),
      COALESCE((v_component->>'counts_toward_overtime')::boolean, false),
      COALESCE(NULLIF(v_component->>'compensation_mode', ''), 'none'),
      v_room_id
    )
    ON CONFLICT (plan_course_id, component_type) DO UPDATE SET
      weekly_contact_hours = EXCLUDED.weekly_contact_hours,
      is_timetabled = EXCLUDED.is_timetabled,
      counts_toward_regular_load = EXCLUDED.counts_toward_regular_load,
      counts_toward_overtime = EXCLUDED.counts_toward_overtime,
      compensation_mode = EXCLUDED.compensation_mode,
      required_room_type_id = EXCLUDED.required_room_type_id;

    IF v_exists THEN v_updated := v_updated + 1;
    ELSE v_inserted := v_inserted + 1;
    END IF;
    IF v_room_id IS NOT NULL THEN v_room_saved := v_room_saved + 1; END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'inserted', v_inserted,
    'updated', v_updated,
    'room_types_saved', v_room_saved
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.commit_plan_component_import_job_atomic_v2(
  p_job_id uuid,
  p_expected_updated_at timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_job public.import_jobs%ROWTYPE;
  v_actor uuid;
  v_row jsonb;
  v jsonb;
  v_idx integer := 0;
  v_program_college uuid;
  v_existing_plan uuid;
  v_existing_course uuid;
  v_existing_plan_course uuid;
  v_should_sync boolean;
  v_expected integer := 0;
  v_persisted integer := 0;
  v_component_inserted integer := 0;
  v_component_updated integer := 0;
  v_plan uuid;
  v_course uuid;
  v_plan_course uuid;
  v_sync jsonb;
  v_legacy jsonb;
  v_result jsonb;
  v_replay jsonb;
  v_plan_ids jsonb := '[]'::jsonb;
  v_component jsonb;
  v_row_component_inserted integer;
  v_row_component_updated integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;
  SELECT * INTO v_job FROM public.import_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'import job not found' USING ERRCODE = '55000';
  END IF;
  IF v_job.target_entity NOT IN ('study_plan_courses', 'full_study_plan') THEN
    RAISE EXCEPTION 'ROOM_TYPE_COMPONENT_CONTRACT_INVALID: V2 accepts plan imports only'
      USING ERRCODE = '22023';
  END IF;
  v_actor := public.import_manager_actor(v_job.college_id);
  IF v_job.created_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'import job actor mismatch' USING ERRCODE = '42501';
  END IF;

  IF v_job.status = 'committed' THEN
    SELECT details->'result' INTO v_replay
    FROM public.audit_logs
    WHERE entity_id = v_job.id
      AND action = 'import_plan_components_atomic_v2'
      AND college_id = v_job.college_id
    ORDER BY created_at DESC, id DESC LIMIT 1;
    IF v_replay IS NULL THEN
      RAISE EXCEPTION 'ATOMIC_PLAN_COMPONENT_PERSISTENCE_RPC_UNAVAILABLE: legacy committed job'
        USING ERRCODE = '55000';
    END IF;
    RETURN jsonb_set(v_replay, '{idempotent_replay}', 'true'::jsonb, true);
  END IF;
  IF v_job.status <> 'preview' THEN
    RAISE EXCEPTION 'import job is not committable' USING ERRCODE = '55000';
  END IF;
  IF p_expected_updated_at IS NOT NULL
     AND v_job.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'import job stale' USING ERRCODE = '40001';
  END IF;
  IF jsonb_typeof(v_job.validated_payload) <> 'array'
     OR v_job.payload_manifest IS DISTINCT FROM md5(v_job.validated_payload::text) THEN
    RAISE EXCEPTION 'import payload manifest mismatch' USING ERRCODE = '23000';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _atomic_plan_apply_rows (
    row_index integer PRIMARY KEY,
    should_sync boolean NOT NULL,
    components_inserted integer NOT NULL,
    components_updated integer NOT NULL
  ) ON COMMIT DROP;
  TRUNCATE _atomic_plan_apply_rows;

  -- Validate every row and acquire deterministic locks before operational DML.
  FOR v_row IN SELECT value FROM jsonb_array_elements(v_job.validated_payload)
  LOOP
    v := public._import_row_values(v_row);
    v_row_component_inserted := 0;
    v_row_component_updated := 0;
    SELECT college_id INTO v_program_college
    FROM public.academic_programs WHERE id = NULLIF(v->>'_program_id', '')::uuid;
    IF NOT FOUND OR v_program_college IS DISTINCT FROM v_job.college_id THEN
      RAISE EXCEPTION 'ROOM_TYPE_WRONG_COLLEGE_ATOMIC: program college mismatch'
        USING ERRCODE = '42501';
    END IF;
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        (v->>'_program_id') || '|' || COALESCE(v->>'plan_code', '') || '|' ||
        COALESCE(NULLIF(v->>'plan_version', ''), '1'),
        0
      )
    );

    v_should_sync := false;
    IF NOT (
      COALESCE(NULLIF(v->>'is_elective_slot', '')::boolean, false)
      OR public._import_is_elective_placeholder(
        COALESCE(NULLIF(v->>'course_code', ''), v->>'elective_slot_code')
      )
    ) THEN
      v_expected := v_expected +
        public._import_validate_plan_component_payload_v2(
          v_job.college_id, v->'_plan_component_sync'
        );
      SELECT sp.id INTO v_existing_plan
      FROM public.study_plans sp
      JOIN public.academic_programs ap ON ap.id = sp.program_id
      WHERE sp.program_id = (v->>'_program_id')::uuid
        AND sp.code = v->>'plan_code'
        AND sp.version = COALESCE(NULLIF(v->>'plan_version', ''), '1')
        AND ap.college_id = v_job.college_id
      ORDER BY sp.id LIMIT 1 FOR UPDATE OF sp;
      SELECT id INTO v_existing_course FROM public.courses
      WHERE college_id = v_job.college_id AND code = v->>'course_code'
      ORDER BY id LIMIT 1;
      v_existing_plan_course := NULL;
      IF v_existing_plan IS NOT NULL AND v_existing_course IS NOT NULL THEN
        SELECT id INTO v_existing_plan_course FROM public.plan_courses
        WHERE study_plan_id = v_existing_plan AND course_id = v_existing_course
          AND college_id = v_job.college_id
        ORDER BY id LIMIT 1 FOR UPDATE;
      END IF;
      v_should_sync := public._import_mode_action(
        v_job.mode, v_existing_plan_course IS NOT NULL
      ) <> 'skip';
      IF NOT v_should_sync THEN
        v_expected := v_expected -
          public._import_validate_plan_component_payload_v2(
            v_job.college_id, v->'_plan_component_sync'
          );
      ELSE
        FOR v_component IN
          SELECT value FROM jsonb_array_elements(v->'_plan_component_sync')
        LOOP
          IF v_existing_plan_course IS NOT NULL AND EXISTS (
            SELECT 1
            FROM public.plan_course_components pcc
            WHERE pcc.plan_course_id = v_existing_plan_course
              AND pcc.component_type = v_component->>'component_type'
          ) THEN
            v_row_component_updated := v_row_component_updated + 1;
          ELSE
            v_row_component_inserted := v_row_component_inserted + 1;
          END IF;
        END LOOP;
      END IF;
    END IF;
    INSERT INTO _atomic_plan_apply_rows VALUES (
      v_idx, v_should_sync, v_row_component_inserted, v_row_component_updated
    );
    v_idx := v_idx + 1;
  END LOOP;

  -- One nested server call performs plan-course writes, job transition and its
  -- historical audit. Any later exception still rolls the outer transaction back.
  v_legacy := public.commit_import_job_atomic_legacy_impl(
    p_job_id, p_expected_updated_at
  );

  v_idx := 0;
  FOR v_row IN SELECT value FROM jsonb_array_elements(v_job.validated_payload)
  LOOP
    SELECT should_sync, components_inserted, components_updated
      INTO v_should_sync, v_row_component_inserted, v_row_component_updated
    FROM _atomic_plan_apply_rows WHERE row_index = v_idx;
    v_idx := v_idx + 1;
    IF NOT v_should_sync THEN CONTINUE; END IF;
    v := public._import_row_values(v_row);
    SELECT sp.id INTO STRICT v_plan
    FROM public.study_plans sp
    JOIN public.academic_programs ap ON ap.id = sp.program_id
    WHERE sp.program_id = (v->>'_program_id')::uuid
      AND sp.code = v->>'plan_code'
      AND sp.version = COALESCE(NULLIF(v->>'plan_version', ''), '1')
      AND ap.college_id = v_job.college_id
    ORDER BY sp.id LIMIT 1 FOR UPDATE OF sp;
    PERFORM pg_advisory_xact_lock(hashtextextended(v_plan::text, 0));
    SELECT id INTO STRICT v_course FROM public.courses
    WHERE college_id = v_job.college_id AND code = v->>'course_code'
    ORDER BY id LIMIT 1;
    SELECT id INTO STRICT v_plan_course FROM public.plan_courses
    WHERE college_id = v_job.college_id
      AND study_plan_id = v_plan AND course_id = v_course
    ORDER BY id LIMIT 1 FOR UPDATE;

    v_sync := public._import_sync_plan_components_atomic_v2(
      v_job.college_id, v_plan_course, v->'_plan_component_sync'
    );
    v_component_inserted := v_component_inserted + v_row_component_inserted;
    v_component_updated := v_component_updated + v_row_component_updated;
    v_persisted := v_persisted + (v_sync->>'room_types_saved')::integer;
    IF NOT (v_plan_ids @> jsonb_build_array(v_plan)) THEN
      v_plan_ids := v_plan_ids || jsonb_build_array(v_plan);
    END IF;
  END LOOP;

  IF v_expected IS DISTINCT FROM v_persisted THEN
    RAISE EXCEPTION
      'ATOMIC_ROOM_TYPE_PERSISTENCE_COUNT_MISMATCH: expected=% persisted=%',
      v_expected, v_persisted USING ERRCODE = '23000';
  END IF;

  v_result := jsonb_build_object(
    'status', 'ok',
    'study_plan_id', v_plan_ids->>0,
    'study_plan_ids', v_plan_ids,
    'inserted', COALESCE((v_legacy->>'inserted')::integer, 0),
    'updated', COALESCE((v_legacy->>'updated')::integer, 0),
    'skipped', COALESCE((v_legacy->>'skipped')::integer, 0),
    'failed', 0,
    'plan_courses_inserted', COALESCE((v_legacy->>'inserted')::integer, 0),
    'plan_courses_updated', COALESCE((v_legacy->>'updated')::integer, 0),
    'components_inserted', v_component_inserted,
    'components_updated', v_component_updated,
    'expected_required_room_components', v_expected,
    'persisted_components_with_required_room_type_id', v_persisted,
    'idempotent_replay', false,
    'replay', false,
    'job_id', v_job.id,
    'entity', v_job.target_entity,
    'mode', v_job.mode,
    'college_id', v_job.college_id,
    'payload_manifest', v_job.payload_manifest,
    'warnings', '[]'::jsonb
  );

  INSERT INTO public.audit_logs (
    actor_id, action, entity, entity_id, college_id, details
  ) VALUES (
    v_actor, 'import_plan_components_atomic_v2', 'import_' || v_job.target_entity,
    v_job.id, v_job.college_id, jsonb_build_object('result', v_result)
  );
  RETURN v_result;
END;
$fn$;

-- Compatibility entrypoint: all non-plan entities retain historical semantics;
-- plan imports cannot bypass V2.
CREATE OR REPLACE FUNCTION public.commit_import_job_atomic(
  p_job_id uuid,
  p_expected_updated_at timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_entity text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;
  SELECT target_entity INTO v_entity FROM public.import_jobs WHERE id = p_job_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'import job not found' USING ERRCODE = '55000'; END IF;
  IF v_entity IN ('study_plan_courses', 'full_study_plan') THEN
    RAISE EXCEPTION
      'ATOMIC_PLAN_COMPONENT_PERSISTENCE_RPC_UNAVAILABLE: plan imports require commit_plan_component_import_job_atomic_v2'
      USING ERRCODE = '55000';
  END IF;
  RETURN public.commit_import_job_atomic_legacy_impl(p_job_id, p_expected_updated_at);
END;
$fn$;

REVOKE ALL ON FUNCTION public._import_validate_plan_component_payload_v2(uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._import_sync_plan_components_atomic_v2(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.commit_plan_component_import_job_atomic_v2(uuid, timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commit_plan_component_import_job_atomic_v2(uuid, timestamptz)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.commit_import_job_atomic(uuid, timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commit_import_job_atomic(uuid, timestamptz)
  TO authenticated, service_role;

ALTER FUNCTION public._import_validate_plan_component_payload_v2(uuid, jsonb) OWNER TO postgres;
ALTER FUNCTION public._import_sync_plan_components_atomic_v2(uuid, uuid, jsonb) OWNER TO postgres;
ALTER FUNCTION public.commit_plan_component_import_job_atomic_v2(uuid, timestamptz) OWNER TO postgres;
ALTER FUNCTION public.commit_import_job_atomic(uuid, timestamptz) OWNER TO postgres;
ALTER FUNCTION public.commit_import_job_atomic_legacy_impl(uuid, timestamptz) OWNER TO postgres;

COMMIT;
