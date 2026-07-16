-- PHASE-9.2: generate_cohort_curriculum (SOURCE ONLY — do not auto-apply).
-- Idempotent generation of internal course_offerings from cohort plan + elective selections.
-- Does NOT create sections, COS, subgroups, delivery_groups, or schedule_sessions.
-- Does NOT remove rows or backfill existing masters.
-- Auth: SECURITY DEFINER with mandatory auth.uid + can_manage_college(cohort.college_id).

BEGIN;

CREATE OR REPLACE FUNCTION public.generate_cohort_curriculum(p_cohort_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_cohort public.academic_cohorts%ROWTYPE;
  v_term_type text;
  v_semester integer;
  v_plan_id uuid;
  v_plan_count integer;
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

  -- Resolve cohort first (college_id comes from row — never from client args).
  SELECT * INTO v_cohort FROM public.academic_cohorts WHERE id = p_cohort_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COHORT_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;

  -- Auth gate before any operational reads/writes beyond the cohort lookup above.
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_manage_college(v_uid, v_cohort.college_id) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  SELECT t.term_type INTO v_term_type
  FROM public.academic_terms t
  WHERE t.id = v_cohort.term_id
    AND t.college_id = v_cohort.college_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COHORT_TERM_MISSING' USING ERRCODE = 'check_violation';
  END IF;

  -- Map academic_terms.term_type → plan_courses.semester / elective_slots.semester.
  -- No NULL wildcard: missing/unknown term_type must fail closed.
  IF v_term_type = 'first' THEN
    v_semester := 1;
  ELSIF v_term_type = 'second' THEN
    v_semester := 2;
  ELSE
    RAISE EXCEPTION 'COHORT_TERM_TYPE_UNSUPPORTED' USING ERRCODE = 'check_violation';
  END IF;

  -- Prefer a single active study plan for the cohort program; else latest by created_at.
  SELECT COUNT(*)::integer INTO v_plan_count
  FROM public.study_plans sp
  WHERE sp.college_id = v_cohort.college_id
    AND sp.program_id = v_cohort.program_id;

  IF v_plan_count = 0 THEN
    RAISE EXCEPTION 'STUDY_PLAN_MISSING_FOR_COHORT_PROGRAM' USING ERRCODE = 'check_violation';
  END IF;

  SELECT sp.id INTO v_plan_id
  FROM public.study_plans sp
  WHERE sp.college_id = v_cohort.college_id
    AND sp.program_id = v_cohort.program_id
  ORDER BY COALESCE(sp.is_active, false) DESC, sp.created_at DESC NULLS LAST, sp.id
  LIMIT 1;

  -- Required plan courses at cohort program/level/semester (exclude summer_training / elective placeholders)
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
    JOIN public.courses c ON c.id = pc.course_id
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

  -- Elective slots for this plan/level/semester that lack a selection → warn, never invent placeholders.
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

  -- Elective selections: slot must match cohort plan/semester context; course must be in elective_slot_courses.
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
    JOIN public.courses c ON c.id = ces.selected_course_id
    JOIN public.elective_slots es ON es.id = ces.elective_slot_id
    LEFT JOIN public.plan_courses pc
      ON pc.study_plan_id = v_plan_id
     AND pc.course_id = ces.selected_course_id
     AND pc.college_id = v_cohort.college_id
     AND pc.semester = v_semester
    WHERE ces.cohort_id = p_cohort_id
      AND ces.college_id = v_cohort.college_id
  LOOP
    -- Slot must belong to the resolved plan and semester (and level when set).
    IF r.slot_plan_id IS DISTINCT FROM v_plan_id
       OR r.slot_semester IS DISTINCT FROM v_semester
       OR COALESCE(r.slot_active, true) = false
       OR (r.slot_level_id IS NOT NULL AND r.slot_level_id IS DISTINCT FROM v_cohort.level_id) THEN
      RAISE EXCEPTION 'ELECTIVE_SLOT_CONTEXT_MISMATCH'
        USING ERRCODE = 'check_violation',
              DETAIL = format('slot=%s plan/semester/level does not match cohort curriculum context', r.slot_code);
    END IF;

    -- Selected course must be an active member of elective_slot_courses for that slot.
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

    -- Never create offerings from placeholder elective codes.
    IF r.course_code ~* '\(E\)\s*$' OR r.course_code ~* '^[A-Z]{2,}\dXX\(E\)$' THEN
      RAISE EXCEPTION 'ELECTIVE_PLACEHOLDER_FORBIDDEN'
        USING ERRCODE = 'check_violation',
              DETAIL = format('placeholder course code not allowed: %s', r.course_code);
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

  RETURN jsonb_build_object(
    'operation', 'generate_cohort_curriculum',
    'cohort_id', p_cohort_id,
    'study_plan_id', v_plan_id,
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
$$;

REVOKE ALL ON FUNCTION public.generate_cohort_curriculum(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_cohort_curriculum(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.generate_cohort_curriculum(uuid) IS
  'Phase 9.2: idempotent internal course_offerings generation for a cohort; requires can_manage_college; filters by term semester; validates elective_slot_courses; no sections/sessions/delivery_groups; skips summer_training and elective placeholders.';

COMMIT;
