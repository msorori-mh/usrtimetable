-- Match cohort curriculum to its level/semester; reject ambiguous or empty generation.
-- Re-runnable forward fix. No study plans, cohorts or existing groups are deleted.
BEGIN;
-- Multiple active plans per program are legitimate when their level/term scopes differ.
DROP INDEX IF EXISTS public.uq_study_plans_one_active_per_program;

CREATE OR REPLACE FUNCTION public.generate_cohort_curriculum(p_cohort_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_cohort public.academic_cohorts%ROWTYPE;
  v_term_type text;
  v_semester integer;
  v_plan_id uuid;
  v_plan_count integer;
  v_plan_code text;
  v_inserted integer := 0;
  v_skipped_existing integer := 0;
  v_skipped_summer integer := 0;
  v_skipped_unselected_elective integer := 0;
  v_required_candidates integer := 0;
  v_elective_candidates integer := 0;
  v_null_uuid uuid := '00000000-0000-0000-0000-000000000000';
  v_warnings jsonb := '[]'::jsonb;
  r record;
BEGIN
  IF p_cohort_id IS NULL THEN
    RAISE EXCEPTION 'COHORT_ID_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(9262, 1);
  SELECT * INTO v_cohort FROM public.academic_cohorts
  WHERE id = p_cohort_id AND public.can_manage_college(v_uid, college_id)
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COHORT_NOT_FOUND_OR_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF NOT COALESCE(v_cohort.active, false) THEN
    RAISE EXCEPTION 'COHORT_INACTIVE' USING ERRCODE = '23514';
  END IF;
  -- Keep plan selection and its inputs stable until generation commits.
  LOCK TABLE public.study_plans, public.plan_courses, public.plan_course_components,
    public.courses, public.elective_slots, public.elective_slot_courses,
    public.cohort_elective_selections IN SHARE MODE;

  SELECT t.term_type INTO v_term_type
  FROM public.academic_terms t
  WHERE t.id = v_cohort.term_id
    AND t.college_id = v_cohort.college_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COHORT_TERM_MISSING' USING ERRCODE = 'check_violation';
  END IF;

  IF v_term_type = 'first' THEN
    v_semester := 1;
  ELSIF v_term_type = 'second' THEN
    v_semester := 2;
  ELSE
    RAISE EXCEPTION 'COHORT_TERM_TYPE_UNSUPPORTED' USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.study_plans sp
    WHERE sp.college_id = v_cohort.college_id AND sp.program_id = v_cohort.program_id
      AND COALESCE(sp.is_active, false)) THEN
    RAISE EXCEPTION 'STUDY_PLAN_MISSING_FOR_COHORT_PROGRAM' USING ERRCODE = '23514';
  END IF;

  -- A program can have different active plans for different levels.
  -- Never pick the latest plan arbitrarily or combine overlapping versions.
  SELECT count(*)::integer, (array_agg(sp.id ORDER BY sp.id))[1]
    INTO v_plan_count, v_plan_id
  FROM public.study_plans sp
  WHERE sp.college_id = v_cohort.college_id
    AND sp.program_id = v_cohort.program_id
    AND COALESCE(sp.is_active, false)
    AND (EXISTS (
      SELECT 1 FROM public.plan_courses pc
      WHERE pc.study_plan_id = sp.id AND pc.college_id = v_cohort.college_id
        AND pc.level_id = v_cohort.level_id AND pc.semester = v_semester
    ) OR EXISTS (
      SELECT 1 FROM public.elective_slots es
      WHERE es.study_plan_id = sp.id AND es.college_id = v_cohort.college_id
        AND (es.level_id IS NULL OR es.level_id = v_cohort.level_id)
        AND es.semester = v_semester AND COALESCE(es.active, true)
    ));
  IF v_plan_count = 0 THEN
    RAISE EXCEPTION 'STUDY_PLAN_MISSING_FOR_COHORT_LEVEL_TERM' USING ERRCODE = '23514';
  ELSIF v_plan_count <> 1 THEN
    RAISE EXCEPTION 'STUDY_PLAN_AMBIGUOUS_FOR_COHORT_LEVEL_TERM' USING ERRCODE = '23514';
  END IF;
  SELECT code INTO v_plan_code FROM public.study_plans WHERE id = v_plan_id;

  IF EXISTS (SELECT 1 FROM public.cohort_elective_selections
    WHERE cohort_id = p_cohort_id AND college_id = v_cohort.college_id
      AND (decided_at IS NULL OR decided_by IS NULL)) THEN
    RAISE EXCEPTION 'ELECTIVE_DECISION_NOT_APPROVED' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.course_offerings co
    WHERE co.college_id = v_cohort.college_id AND co.term_id = v_cohort.term_id
      AND co.program_id = v_cohort.program_id AND co.level_id = v_cohort.level_id
      AND co.study_system = v_cohort.study_system AND COALESCE(co.is_active, true)
      AND co.study_plan_id IS DISTINCT FROM v_plan_id) THEN
    RAISE EXCEPTION 'COHORT_EXISTING_PLAN_CONFLICT' USING ERRCODE = '23514';
  END IF;

  FOR r IN
    SELECT
      pc.id AS plan_course_id,
      pc.course_id,
      c.code AS course_code,
      c.name AS course_name,
      EXISTS (
        SELECT 1 FROM public.plan_course_components pcc
        WHERE pcc.plan_course_id = pc.id
          AND pcc.component_type = 'summer_training'
          AND pcc.is_timetabled = false
          AND NOT EXISTS (
            SELECT 1 FROM public.plan_course_components pcc2
            WHERE pcc2.plan_course_id = pc.id
              AND pcc2.component_type <> 'summer_training'
              AND pcc2.is_timetabled = true
          )
      ) AS summer_only
    FROM public.plan_courses pc
    JOIN public.courses c ON c.id = pc.course_id AND c.college_id = pc.college_id
    WHERE pc.college_id = v_cohort.college_id
      AND pc.study_plan_id = v_plan_id
      AND pc.level_id = v_cohort.level_id
      AND pc.semester = v_semester
      AND COALESCE(pc.is_required, true) = true
      AND c.code !~* '\(E\)\s*$'
      AND c.code !~* '^[A-Z]{2,}\dXX\(E\)$'
  LOOP
    v_required_candidates := v_required_candidates + 1;
    IF r.summer_only THEN
      v_skipped_summer := v_skipped_summer + 1;
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.course_offerings co
      WHERE co.college_id = v_cohort.college_id
        AND co.term_id = v_cohort.term_id
        AND co.course_id = r.course_id
        AND COALESCE(co.program_id, v_null_uuid) = COALESCE(v_cohort.program_id, v_null_uuid)
        AND COALESCE(co.level_id, v_null_uuid) = COALESCE(v_cohort.level_id, v_null_uuid)
        AND co.study_system = v_cohort.study_system
    ) THEN
      v_skipped_existing := v_skipped_existing + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.course_offerings (
      college_id, term_id, course_id, program_id, level_id, study_system,
      study_plan_id, plan_course_id, expected_students, sections_count,
      status, is_active, notes, enrollment_count_status
    ) VALUES (
      v_cohort.college_id, v_cohort.term_id, r.course_id, v_cohort.program_id, v_cohort.level_id,
      v_cohort.study_system, v_plan_id, r.plan_course_id, COALESCE(v_cohort.expected_students, 0), 0,
      'draft', true, NULL, 'unverified'
    );
    v_inserted := v_inserted + 1;
  END LOOP;

  FOR r IN
    SELECT es.id AS elective_slot_id, es.slot_code
    FROM public.elective_slots es
    WHERE es.college_id = v_cohort.college_id
      AND es.study_plan_id = v_plan_id
      AND es.semester = v_semester
      AND COALESCE(es.active, true) = true
      AND (es.level_id IS NULL OR es.level_id = v_cohort.level_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.cohort_elective_selections ces
        WHERE ces.cohort_id = p_cohort_id
          AND ces.elective_slot_id = es.id
          AND ces.college_id = v_cohort.college_id
      )
  LOOP
    v_skipped_unselected_elective := v_skipped_unselected_elective + 1;
    v_warnings := v_warnings || jsonb_build_array(
      jsonb_build_object(
        'code', 'ELECTIVE_SLOT_UNSELECTED',
        'elective_slot_id', r.elective_slot_id,
        'slot_code', r.slot_code,
        'message_ar', 'خانة اختيارية بلا اختيار — لم يُنشأ طرح ولا مقرر وهمي.'
      )
    );
  END LOOP;

  FOR r IN
    SELECT
      ces.selected_course_id AS course_id,
      c.code AS course_code,
      c.name AS course_name,
      ces.elective_slot_id,
      es.slot_code,
      es.study_plan_id AS slot_plan_id,
      es.semester AS slot_semester,
      es.level_id AS slot_level_id,
      es.active AS slot_active,
      pc.id AS plan_course_id
    FROM public.cohort_elective_selections ces
    JOIN public.courses c ON c.id = ces.selected_course_id AND c.college_id = ces.college_id
    JOIN public.elective_slots es ON es.id = ces.elective_slot_id AND es.college_id = ces.college_id
    LEFT JOIN public.plan_courses pc
      ON pc.study_plan_id = v_plan_id
     AND pc.course_id = ces.selected_course_id
     AND pc.college_id = v_cohort.college_id
     AND pc.semester = v_semester
     AND pc.level_id = v_cohort.level_id
    WHERE ces.cohort_id = p_cohort_id
      AND ces.college_id = v_cohort.college_id
  LOOP
    IF r.slot_plan_id IS DISTINCT FROM v_plan_id
       OR r.slot_semester IS DISTINCT FROM v_semester
       OR COALESCE(r.slot_active, true) = false
       OR (r.slot_level_id IS NOT NULL AND r.slot_level_id IS DISTINCT FROM v_cohort.level_id) THEN
      RAISE EXCEPTION 'ELECTIVE_SLOT_CONTEXT_MISMATCH'
        USING ERRCODE = 'check_violation',
              DETAIL = format('slot=%s plan/semester/level does not match cohort curriculum context', r.slot_code);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.elective_slot_courses esc
      WHERE esc.elective_slot_id = r.elective_slot_id
        AND esc.course_id = r.course_id
        AND esc.college_id = v_cohort.college_id
        AND COALESCE(esc.active, true) = true
    ) THEN
      RAISE EXCEPTION 'ELECTIVE_COURSE_NOT_IN_SLOT'
        USING ERRCODE = 'check_violation',
              DETAIL = format('course=%s is not allowed for elective_slot=%s', r.course_code, r.slot_code);
    END IF;

    IF r.course_code ~* '\(E\)\s*$' OR r.course_code ~* '^[A-Z]{2,}\dXX\(E\)$' THEN
      RAISE EXCEPTION 'ELECTIVE_PLACEHOLDER_FORBIDDEN'
        USING ERRCODE = 'check_violation',
              DETAIL = format('placeholder course code not allowed: %s', r.course_code);
    END IF;

    IF r.plan_course_id IS NULL THEN
      RAISE EXCEPTION 'ELECTIVE_PLAN_COURSE_MISSING' USING ERRCODE = '23514';
    END IF;
    v_elective_candidates := v_elective_candidates + 1;

    IF EXISTS (
      SELECT 1 FROM public.course_offerings co
      WHERE co.college_id = v_cohort.college_id
        AND co.term_id = v_cohort.term_id
        AND co.course_id = r.course_id
        AND COALESCE(co.program_id, v_null_uuid) = COALESCE(v_cohort.program_id, v_null_uuid)
        AND COALESCE(co.level_id, v_null_uuid) = COALESCE(v_cohort.level_id, v_null_uuid)
        AND co.study_system = v_cohort.study_system
    ) THEN
      v_skipped_existing := v_skipped_existing + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.course_offerings (
      college_id, term_id, course_id, program_id, level_id, study_system,
      study_plan_id, plan_course_id, expected_students, sections_count,
      status, is_active, notes, enrollment_count_status
    ) VALUES (
      v_cohort.college_id, v_cohort.term_id, r.course_id, v_cohort.program_id, v_cohort.level_id,
      v_cohort.study_system, v_plan_id, r.plan_course_id,
      COALESCE(v_cohort.expected_students, 0), 0,
      'draft', true,
      'مقرر اختياري (' || COALESCE(r.course_name, r.course_code) || ')',
      'unverified'
    );
    v_inserted := v_inserted + 1;
  END LOOP;

  IF v_inserted = 0 AND v_skipped_existing = 0 THEN
    RAISE EXCEPTION 'COHORT_CURRICULUM_EMPTY' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, college_id, details)
  VALUES (v_uid, 'generate_cohort_curriculum', 'academic_cohorts', p_cohort_id,
    v_cohort.college_id, jsonb_build_object('study_plan_id', v_plan_id,
      'term_id', v_cohort.term_id, 'inserted_offerings', v_inserted,
      'skipped_existing', v_skipped_existing));
  RETURN jsonb_build_object(
    'operation' , 'generate_cohort_curriculum',
    'cohort_id', p_cohort_id,
    'study_plan_id', v_plan_id,
    'study_plan_code', v_plan_code,
    'semester', v_semester,
    'term_type', v_term_type,
    'inserted_offerings', v_inserted,
    'skipped_existing', v_skipped_existing,
    'skipped_summer_only', v_skipped_summer,
    'skipped_unselected_elective', v_skipped_unselected_elective,
    'required_candidates', v_required_candidates,
    'elective_candidates', v_elective_candidates,
    'warnings', v_warnings,
    'created_sections', 0,
    'created_delivery_groups', 0,
    'created_sessions', 0,
    'result', 'success'
  );
END;
$function$;


CREATE OR REPLACE FUNCTION public.generate_cohort_delivery_groups(p_cohort_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_cohort public.academic_cohorts%ROWTYPE;
  v_components_processed integer := 0;
  v_groups_created integer := 0;
  v_groups_updated integer := 0;
  v_groups_unchanged integer := 0;
  v_groups_obsolete integer := 0;
  v_warnings jsonb := '[]'::jsonb;
  v_validation_errors jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  r record;
  v_student_count integer;
  v_capacity integer;
  v_required integer;
  v_group_num integer;
  v_has_links boolean;
  v_expected_for_group integer;
  v_group_code text;
  v_excluded boolean;
  v_row public.delivery_groups%ROWTYPE;
  v_changed boolean;
  v_base integer;
  v_rem integer;
  v_status text;
  v_curriculum jsonb;
  v_headcount jsonb;
BEGIN
  IF p_cohort_id IS NULL THEN
    RAISE EXCEPTION 'COHORT_ID_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(9262, 1);
  SELECT * INTO v_cohort FROM public.academic_cohorts
  WHERE id = p_cohort_id AND public.can_manage_college(v_uid, college_id)
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COHORT_NOT_FOUND_OR_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF NOT COALESCE(v_cohort.active, false) THEN
    RAISE EXCEPTION 'COHORT_INACTIVE' USING ERRCODE = '23514';
  END IF;
  LOCK TABLE public.scheduling_cohort_term_headcounts,
    public.scheduling_headcount_overrides IN SHARE MODE;
  v_headcount := public.resolve_scheduling_headcount(v_cohort.college_id, p_cohort_id, v_cohort.term_id);
  IF COALESCE((v_headcount->>'ok')::boolean, false) = false THEN
    RAISE EXCEPTION 'SCHEDULING_HEADCOUNT_MISSING' USING ERRCODE = '23514';
  END IF;
  v_student_count := (v_headcount->>'scheduling_headcount')::integer;
  IF v_student_count IS NULL OR v_student_count <= 0 THEN
    RAISE EXCEPTION 'INVALID_STUDENT_COUNT' USING ERRCODE = '23514';
  END IF;
  -- One explicit click prepares curriculum and groups in the same transaction.
  v_curriculum := public.generate_cohort_curriculum(p_cohort_id);

  DROP TABLE IF EXISTS pg_temp._dg_gen_components;
  CREATE TEMP TABLE _dg_gen_components (
    component_id uuid PRIMARY KEY,
    plan_course_id uuid NOT NULL,
    component_type text NOT NULL,
    weekly_contact_hours numeric,
    room_is_active boolean,
    required_room_type_id uuid,
    explicit_group_size integer,
    is_timetabled boolean,
    counts_toward_regular_load boolean,
    room_default_capacity integer,
    strict_capacity boolean,
    course_offering_id uuid,
    offering_count integer NOT NULL DEFAULT 1
  ) ON COMMIT DROP;

  TRUNCATE pg_temp._dg_gen_components;

  INSERT INTO pg_temp._dg_gen_components (
    component_id, plan_course_id, component_type, weekly_contact_hours, room_is_active,
    required_room_type_id, explicit_group_size, is_timetabled, counts_toward_regular_load,
    room_default_capacity, strict_capacity, course_offering_id, offering_count
  )
  SELECT
    x.component_id,
    x.plan_course_id,
    x.component_type,
    x.weekly_contact_hours,
    x.room_is_active,
    x.required_room_type_id,
    x.explicit_group_size,
    x.is_timetabled,
    x.counts_toward_regular_load,
    x.room_default_capacity,
    x.strict_capacity,
    x.course_offering_id,
    x.offering_count
  FROM (
    SELECT DISTINCT ON (pcc.id)
      pcc.id AS component_id,
      pcc.plan_course_id,
      pcc.component_type,
      pcc.weekly_contact_hours,
      rt.is_active AS room_is_active,
      pcc.required_room_type_id,
      pcc.explicit_group_size,
      pcc.is_timetabled,
      pcc.counts_toward_regular_load,
      rt.default_capacity AS room_default_capacity,
      COALESCE(rt.strict_capacity, false) AS strict_capacity,
      co.id AS course_offering_id,
      COUNT(*) OVER (PARTITION BY pcc.id) AS offering_count
    FROM public.course_offerings co
    JOIN public.plan_course_components pcc
      ON pcc.plan_course_id = co.plan_course_id
     AND pcc.college_id = co.college_id
    LEFT JOIN public.room_types rt
      ON rt.id = pcc.required_room_type_id
     AND rt.college_id = pcc.college_id
    WHERE co.college_id = v_cohort.college_id
      AND co.term_id = v_cohort.term_id
      AND co.program_id = v_cohort.program_id
      AND co.level_id = v_cohort.level_id
      AND co.study_system = v_cohort.study_system
      AND co.study_plan_id = (v_curriculum->>'study_plan_id')::uuid
      AND co.plan_course_id IS NOT NULL
      AND COALESCE(pcc.is_timetabled, true)
      AND COALESCE(pcc.weekly_contact_hours, 0) > 0
      AND COALESCE(co.is_active, true) = true
    ORDER BY pcc.id, co.created_at DESC NULLS LAST, co.id ASC
  ) x;

  IF NOT EXISTS (SELECT 1 FROM pg_temp._dg_gen_components) THEN
    RAISE EXCEPTION 'COHORT_TIMETABLED_COMPONENTS_EMPTY' USING ERRCODE = '23514';
  END IF;

  FOR r IN
    SELECT * FROM pg_temp._dg_gen_components
    ORDER BY plan_course_id, component_type, component_id
  LOOP
    v_components_processed := v_components_processed + 1;

    IF r.component_type = 'summer_training' THEN
      CONTINUE;
    END IF;

    IF r.component_type = 'project' THEN
      IF COALESCE(r.weekly_contact_hours, 0) <= 0 THEN
        CONTINUE;
      END IF;
      IF r.explicit_group_size IS NULL OR r.explicit_group_size <= 0 THEN
        v_validation_errors := v_validation_errors || jsonb_build_array(
          jsonb_build_object(
            'code', 'MISSING_PROJECT_GROUP_SIZE',
            'component_id', r.component_id,
            'component_type', r.component_type,
            'message', 'project requires explicit_group_size; capacity must not be guessed'
          )
        );
      END IF;
      CONTINUE;
    END IF;

    IF r.component_type = 'tutorial' AND r.explicit_group_size IS NOT NULL AND r.explicit_group_size > 0 THEN
      CONTINUE;
    END IF;

    IF r.room_is_active IS DISTINCT FROM true
       OR r.required_room_type_id IS NULL
       OR r.room_default_capacity IS NULL
       OR r.room_default_capacity <= 0 THEN
      v_validation_errors := v_validation_errors || jsonb_build_array(
        jsonb_build_object(
          'code', 'MISSING_CAPACITY',
          'component_id', r.component_id,
          'component_type', r.component_type,
          'message', 'missing room type capacity reference; refuse to guess'
        )
      );
    END IF;
  END LOOP;

  IF jsonb_array_length(v_validation_errors) > 0 THEN
    RAISE EXCEPTION 'DELIVERY_GROUP_CAPACITY_INVALID'
      USING ERRCODE = '23514', DETAIL = v_validation_errors::text;
  END IF;

  v_components_processed := 0;

  FOR r IN
    SELECT * FROM pg_temp._dg_gen_components
    ORDER BY plan_course_id, component_type, component_id
  LOOP
    v_components_processed := v_components_processed + 1;

    IF r.offering_count > 1 THEN
      v_warnings := v_warnings || jsonb_build_array(
        jsonb_build_object(
          'code', 'COMPATIBILITY_OFFERING_RESOLVED_DETERMINISTICALLY',
          'component_id', r.component_id,
          'plan_course_id', r.plan_course_id,
          'offering_count', r.offering_count,
          'chosen_course_offering_id', r.course_offering_id,
          'message', 'multiple compatibility offerings; chose newest created_at then id; one component pass only'
        )
      );
    END IF;

    IF r.component_type = 'summer_training' THEN
      v_skipped := v_skipped || jsonb_build_array(
        jsonb_build_object(
          'code', 'skipped_non_weekly_component',
          'component_id', r.component_id,
          'component_type', r.component_type,
          'course_offering_id', r.course_offering_id
        )
      );
      CONTINUE;
    END IF;

    v_headcount := public.resolve_scheduling_headcount(v_cohort.college_id, p_cohort_id,
      v_cohort.term_id, r.course_offering_id, r.component_id);
    v_student_count := (v_headcount->>'scheduling_headcount')::integer;
    IF COALESCE((v_headcount->>'ok')::boolean, false) = false
       OR v_student_count IS NULL OR v_student_count <= 0 THEN
      RAISE EXCEPTION 'SCHEDULING_HEADCOUNT_MISSING' USING ERRCODE = '23514';
    END IF;

    v_excluded := (r.component_type = 'project')
      OR (COALESCE(r.counts_toward_regular_load, true) = false);
    v_capacity := NULL;
    v_required := NULL;

    IF r.component_type = 'project' THEN
      IF COALESCE(r.weekly_contact_hours, 0) <= 0 THEN
        v_skipped := v_skipped || jsonb_build_array(
          jsonb_build_object(
            'code', 'project_zero_hours',
            'component_id', r.component_id,
            'component_type', r.component_type
          )
        );
        CONTINUE;
      END IF;
      v_capacity := r.explicit_group_size;
      IF v_student_count = 0 THEN
        v_required := 1;
      ELSE
        v_required := CEIL(v_student_count::numeric / v_capacity::numeric)::integer;
      END IF;
    ELSIF r.component_type = 'tutorial' AND r.explicit_group_size IS NOT NULL AND r.explicit_group_size > 0 THEN
      v_capacity := r.explicit_group_size;
      IF v_student_count = 0 THEN
        v_required := 1;
      ELSE
        v_required := CEIL(v_student_count::numeric / v_capacity::numeric)::integer;
      END IF;
    ELSE
      v_capacity := r.room_default_capacity;
      IF r.component_type = 'theory' THEN
        IF v_student_count <= v_capacity THEN
          v_required := 1;
        ELSE
          v_required := CEIL(v_student_count::numeric / v_capacity::numeric)::integer;
        END IF;
      ELSE
        IF v_student_count = 0 THEN
          v_required := 1;
        ELSE
          v_required := CEIL(v_student_count::numeric / v_capacity::numeric)::integer;
        END IF;
      END IF;
    END IF;

    v_base := CASE WHEN v_required > 0 THEN v_student_count / v_required ELSE 0 END;
    v_rem := CASE WHEN v_required > 0 THEN v_student_count % v_required ELSE 0 END;

    FOR v_group_num IN 1..v_required LOOP
      v_expected_for_group := v_base + CASE WHEN v_group_num <= v_rem THEN 1 ELSE 0 END;
      v_group_code := 'G' || v_group_num::text;

      SELECT * INTO v_row
      FROM public.delivery_groups dg
      WHERE dg.cohort_id = p_cohort_id
        AND dg.component_id = r.component_id
        AND dg.group_number = v_group_num;

      IF NOT FOUND THEN
        INSERT INTO public.delivery_groups (
          college_id, cohort_id, plan_course_id, component_id,
          group_code, group_number, expected_students, capacity_limit,
          active, excluded_from_standard_workload, is_obsolete
        ) VALUES (
          v_cohort.college_id, p_cohort_id, r.plan_course_id, r.component_id,
          v_group_code, v_group_num, v_expected_for_group, v_capacity,
          true, v_excluded, false
        );
        v_groups_created := v_groups_created + 1;
      ELSE
        v_changed := (
          v_row.expected_students IS DISTINCT FROM v_expected_for_group
          OR v_row.capacity_limit IS DISTINCT FROM v_capacity
          OR v_row.excluded_from_standard_workload IS DISTINCT FROM v_excluded
          OR v_row.active IS DISTINCT FROM true
          OR COALESCE(v_row.is_obsolete, false) IS DISTINCT FROM false
        );
        IF v_changed THEN
          UPDATE public.delivery_groups
          SET expected_students = v_expected_for_group,
              capacity_limit = v_capacity,
              excluded_from_standard_workload = v_excluded,
              active = true,
              is_obsolete = false,
              group_code = COALESCE(NULLIF(v_row.group_code, ''), v_group_code)
          WHERE id = v_row.id;
          v_groups_updated := v_groups_updated + 1;
        ELSE
          v_groups_unchanged := v_groups_unchanged + 1;
        END IF;
      END IF;
    END LOOP;

    FOR v_row IN
      SELECT *
      FROM public.delivery_groups dg
      WHERE dg.cohort_id = p_cohort_id
        AND dg.component_id = r.component_id
        AND dg.group_number IS NOT NULL
        AND dg.group_number > v_required
    LOOP
      v_groups_obsolete := v_groups_obsolete + 1;

      IF NOT COALESCE(v_row.is_obsolete, false) THEN
        UPDATE public.delivery_groups
        SET is_obsolete = true
        WHERE id = v_row.id;
      END IF;

      SELECT EXISTS (
        SELECT 1 FROM public.teaching_assignments ta WHERE ta.delivery_group_id = v_row.id
      ) OR EXISTS (
        SELECT 1 FROM public.schedule_sessions ss WHERE ss.delivery_group_id = v_row.id
      ) INTO v_has_links;

      IF v_has_links THEN
        v_warnings := v_warnings || jsonb_build_array(
          jsonb_build_object(
            'code', 'OBSOLETE_GROUP_LINKED',
            'delivery_group_id', v_row.id,
            'group_number', v_row.group_number,
            'component_id', r.component_id,
            'message', 'obsolete group has operational links; marked obsolete, not deleted'
          )
        );
      ELSE
        v_warnings := v_warnings || jsonb_build_array(
          jsonb_build_object(
            'code', 'OBSOLETE_GROUP_UNUSED',
            'delivery_group_id', v_row.id,
            'group_number', v_row.group_number,
            'component_id', r.component_id,
            'message', 'obsolete unused group marked obsolete and retained (non-destructive)'
          )
        );
      END IF;
    END LOOP;
  END LOOP;

  IF v_groups_created = 0 AND v_groups_updated = 0 AND v_groups_obsolete = 0 THEN
    v_status := 'NO_CHANGES';
  ELSE
    v_status := 'SUCCESS';
  END IF;

  RETURN jsonb_build_object(
    'curriculum', v_curriculum,
    'status', v_status,
    'cohorts_processed', 1,
    'cohort_id', p_cohort_id,
    'college_id', v_cohort.college_id,
    'student_count', (public.resolve_scheduling_headcount(v_cohort.college_id, p_cohort_id, v_cohort.term_id)->>'scheduling_headcount')::integer,
    'components_processed', v_components_processed,
    'groups_created', v_groups_created,
    'groups_updated', v_groups_updated,
    'groups_unchanged', v_groups_unchanged,
    'groups_obsolete', v_groups_obsolete,
    'skipped_components', v_skipped,
    'warnings', v_warnings || COALESCE(v_curriculum->'warnings', '[]'::jsonb),
    'validation_errors', v_validation_errors
  );
END;
$function$;


REVOKE ALL ON FUNCTION public.generate_cohort_curriculum(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.generate_cohort_delivery_groups(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_cohort_curriculum(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.generate_cohort_delivery_groups(uuid) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
