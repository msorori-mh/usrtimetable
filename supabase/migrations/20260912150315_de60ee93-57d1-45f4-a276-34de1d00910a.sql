-- Official source of truth: anonymous student partitions per cohort.
-- Idempotent, fail-closed, college/cohort isolated. Never touches schedule_sessions.
CREATE OR REPLACE FUNCTION public.rebuild_cohort_student_partitions(p_cohort_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_college uuid;
  v_parts integer;
  v_maps integer;
  v_bad integer;
BEGIN
  IF p_cohort_id IS NULL THEN
    RAISE EXCEPTION 'COHORT_ID_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  SELECT ac.college_id INTO v_college
  FROM public.academic_cohorts ac
  WHERE ac.id = p_cohort_id
    AND COALESCE(ac.active, false) = true
    AND public.can_manage_college(v_uid, ac.college_id);
  IF v_college IS NULL THEN
    RAISE EXCEPTION 'COHORT_NOT_FOUND_OR_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.delivery_group_partition_members WHERE cohort_id = p_cohort_id;
  DELETE FROM public.cohort_student_partitions WHERE cohort_id = p_cohort_id;

  WITH grp AS (
    SELECT dg.component_id, dg.group_number, dg.expected_students,
           SUM(dg.expected_students) OVER (
             PARTITION BY dg.component_id ORDER BY dg.group_number
             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS end_idx
    FROM public.delivery_groups dg
    WHERE dg.cohort_id = p_cohort_id
      AND dg.college_id = v_college
      AND dg.active = true
      AND COALESCE(dg.is_obsolete, false) = false
      AND COALESCE(dg.expected_students, 0) > 0
  ), bounds AS (
    SELECT 0::bigint AS b UNION SELECT DISTINCT end_idx FROM grp
  ), ord AS (
    SELECT b, lag(b) OVER (ORDER BY b) AS prev_b, row_number() OVER (ORDER BY b) AS rn FROM bounds
  )
  INSERT INTO public.cohort_student_partitions (college_id, cohort_id, partition_code, headcount, active)
  SELECT v_college, p_cohort_id, 'A' || lpad((rn - 1)::text, 3, '0'), (b - prev_b)::int, true
  FROM ord
  WHERE prev_b IS NOT NULL AND b > prev_b;

  WITH grp AS (
    SELECT dg.id AS delivery_group_id, dg.component_id, dg.group_number, dg.expected_students,
           (SUM(dg.expected_students) OVER (
             PARTITION BY dg.component_id ORDER BY dg.group_number
             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) - dg.expected_students + 1)::int AS start_idx,
           (SUM(dg.expected_students) OVER (
             PARTITION BY dg.component_id ORDER BY dg.group_number
             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW))::int AS end_idx
    FROM public.delivery_groups dg
    WHERE dg.cohort_id = p_cohort_id
      AND dg.college_id = v_college
      AND dg.active = true
      AND COALESCE(dg.is_obsolete, false) = false
      AND COALESCE(dg.expected_students, 0) > 0
  ), parts AS (
    SELECT id, headcount,
           (SUM(headcount) OVER (ORDER BY partition_code) - headcount + 1)::int AS start_idx,
           (SUM(headcount) OVER (ORDER BY partition_code))::int AS end_idx
    FROM public.cohort_student_partitions
    WHERE cohort_id = p_cohort_id AND active = true
  )
  INSERT INTO public.delivery_group_partition_members (college_id, cohort_id, delivery_group_id, partition_id)
  SELECT v_college, p_cohort_id, g.delivery_group_id, p.id
  FROM grp g
  JOIN parts p ON p.start_idx >= g.start_idx AND p.end_idx <= g.end_idx;

  SELECT count(*) INTO v_bad
  FROM public.delivery_groups dg
  WHERE dg.cohort_id = p_cohort_id
    AND dg.college_id = v_college
    AND dg.active = true
    AND COALESCE(dg.is_obsolete, false) = false
    AND COALESCE(dg.expected_students, 0) > 0
    AND COALESCE((
      SELECT SUM(p.headcount)
      FROM public.delivery_group_partition_members m
      JOIN public.cohort_student_partitions p ON p.id = m.partition_id AND p.active
      WHERE m.delivery_group_id = dg.id
    ), 0) <> dg.expected_students;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'PARTITION_COVERAGE_MISMATCH %', v_bad USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO v_parts FROM public.cohort_student_partitions
    WHERE cohort_id = p_cohort_id AND active = true;
  SELECT count(*) INTO v_maps FROM public.delivery_group_partition_members
    WHERE cohort_id = p_cohort_id;

  RETURN jsonb_build_object('cohort_id', p_cohort_id, 'college_id', v_college,
    'partitions', v_parts, 'mappings', v_maps, 'bad', v_bad);
END;
$function$;

REVOKE ALL ON FUNCTION public.rebuild_cohort_student_partitions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rebuild_cohort_student_partitions(uuid) TO authenticated;

-- Delivery group generation now rebuilds the student partitions in the same
-- transaction, after groups are created / updated / marked obsolete.
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
  v_partitions jsonb;
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
      -- Effective capacity: uniform active-room capacity when available,
      -- otherwise the room type default capacity (no guessing).
      COALESCE(
        public.effective_room_type_capacity(pcc.college_id, pcc.required_room_type_id),
        rt.default_capacity
      ) AS room_default_capacity,
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

    IF r.component_type = 'project'
       AND COALESCE(r.counts_toward_regular_load, false) = false THEN
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

    v_excluded := (COALESCE(r.counts_toward_regular_load, true) = false);
    v_capacity := NULL;
    v_required := NULL;

    IF r.component_type = 'project' AND COALESCE(r.counts_toward_regular_load, false) = false THEN
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
      IF COALESCE(v_row.is_obsolete, false) THEN
        CONTINUE;
      END IF;

      v_groups_obsolete := v_groups_obsolete + 1;

      UPDATE public.delivery_groups
      SET is_obsolete = true
      WHERE id = v_row.id;

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

  -- Anonymous student partitions are part of the same transaction: they always
  -- reflect the delivery-group boundaries produced above (fail-closed).
  v_partitions := public.rebuild_cohort_student_partitions(p_cohort_id);

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
    'student_partitions', v_partitions,
    'skipped_components', v_skipped,
    'warnings', v_warnings || COALESCE(v_curriculum->'warnings', '[]'::jsonb),
    'validation_errors', v_validation_errors
  );
END;
$function$;