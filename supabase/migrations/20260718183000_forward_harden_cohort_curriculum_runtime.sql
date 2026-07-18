-- SOURCE ONLY / NOT APPLIED: forward-only hardening for cohort curriculum generation.
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.study_plans
    WHERE COALESCE(is_active, false)
    GROUP BY college_id, program_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'ACTIVE_STUDY_PLAN_PRECHECK_FAILED' USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_study_plans_one_active_per_program
  ON public.study_plans (college_id, program_id)
  WHERE COALESCE(is_active, false);

CREATE OR REPLACE FUNCTION public.lock_cohort_curriculum_inputs()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(9262, 1);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.lock_cohort_curriculum_inputs() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_curriculum_lock_study_plans ON public.study_plans;
CREATE TRIGGER trg_curriculum_lock_study_plans BEFORE INSERT OR UPDATE OR DELETE ON public.study_plans
FOR EACH STATEMENT EXECUTE FUNCTION public.lock_cohort_curriculum_inputs();
DROP TRIGGER IF EXISTS trg_curriculum_lock_plan_courses ON public.plan_courses;
CREATE TRIGGER trg_curriculum_lock_plan_courses BEFORE INSERT OR UPDATE OR DELETE ON public.plan_courses
FOR EACH STATEMENT EXECUTE FUNCTION public.lock_cohort_curriculum_inputs();
DROP TRIGGER IF EXISTS trg_curriculum_lock_plan_components ON public.plan_course_components;
CREATE TRIGGER trg_curriculum_lock_plan_components BEFORE INSERT OR UPDATE OR DELETE ON public.plan_course_components
FOR EACH STATEMENT EXECUTE FUNCTION public.lock_cohort_curriculum_inputs();
DROP TRIGGER IF EXISTS trg_curriculum_lock_elective_slots ON public.elective_slots;
CREATE TRIGGER trg_curriculum_lock_elective_slots BEFORE INSERT OR UPDATE OR DELETE ON public.elective_slots
FOR EACH STATEMENT EXECUTE FUNCTION public.lock_cohort_curriculum_inputs();
DROP TRIGGER IF EXISTS trg_curriculum_lock_slot_courses ON public.elective_slot_courses;
CREATE TRIGGER trg_curriculum_lock_slot_courses BEFORE INSERT OR UPDATE OR DELETE ON public.elective_slot_courses
FOR EACH STATEMENT EXECUTE FUNCTION public.lock_cohort_curriculum_inputs();
DROP TRIGGER IF EXISTS trg_curriculum_lock_cohort_selections ON public.cohort_elective_selections;
CREATE TRIGGER trg_curriculum_lock_cohort_selections BEFORE INSERT OR UPDATE OR DELETE ON public.cohort_elective_selections
FOR EACH STATEMENT EXECUTE FUNCTION public.lock_cohort_curriculum_inputs();
DROP TRIGGER IF EXISTS trg_curriculum_lock_cohorts ON public.academic_cohorts;
CREATE TRIGGER trg_curriculum_lock_cohorts BEFORE INSERT OR UPDATE OR DELETE ON public.academic_cohorts
FOR EACH STATEMENT EXECUTE FUNCTION public.lock_cohort_curriculum_inputs();
DROP TRIGGER IF EXISTS trg_curriculum_lock_terms ON public.academic_terms;
CREATE TRIGGER trg_curriculum_lock_terms BEFORE INSERT OR UPDATE OR DELETE ON public.academic_terms
FOR EACH STATEMENT EXECUTE FUNCTION public.lock_cohort_curriculum_inputs();
DROP TRIGGER IF EXISTS trg_curriculum_lock_courses ON public.courses;
CREATE TRIGGER trg_curriculum_lock_courses BEFORE INSERT OR UPDATE OR DELETE ON public.courses
FOR EACH STATEMENT EXECUTE FUNCTION public.lock_cohort_curriculum_inputs();

ALTER FUNCTION public.generate_cohort_curriculum(uuid)
  RENAME TO generate_cohort_curriculum_legacy_impl;
REVOKE ALL ON FUNCTION public.generate_cohort_curriculum_legacy_impl(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.generate_cohort_curriculum(p_cohort_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_cohort public.academic_cohorts%ROWTYPE;
  v_plan_id uuid;
  v_plan_count integer;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  IF p_cohort_id IS NULL THEN
    RAISE EXCEPTION 'COHORT_ID_REQUIRED' USING ERRCODE = '23514';
  END IF;

  -- Same lock is taken by every writer of a curriculum input table.
  PERFORM pg_catalog.pg_advisory_xact_lock(9262, 1);
  SELECT * INTO v_cohort
  FROM public.academic_cohorts
  WHERE id = p_cohort_id
    AND public.can_manage_college(v_uid, college_id)
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COHORT_NOT_FOUND_OR_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT count(*)::integer, (array_agg(id ORDER BY id))[1]
    INTO v_plan_count, v_plan_id
  FROM public.study_plans
  WHERE college_id = v_cohort.college_id
    AND program_id = v_cohort.program_id
    AND COALESCE(is_active, false);
  IF v_plan_count = 0 THEN
    RAISE EXCEPTION 'STUDY_PLAN_MISSING_FOR_COHORT_PROGRAM' USING ERRCODE = '23514';
  ELSIF v_plan_count <> 1 THEN
    RAISE EXCEPTION 'STUDY_PLAN_AMBIGUOUS_FOR_COHORT_PROGRAM' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.cohort_elective_selections
    WHERE cohort_id = p_cohort_id AND college_id = v_cohort.college_id
      AND (decided_at IS NULL OR decided_by IS NULL)
  ) THEN
    RAISE EXCEPTION 'ELECTIVE_DECISION_NOT_APPROVED' USING ERRCODE = '23514';
  END IF;

  v_result := public.generate_cohort_curriculum_legacy_impl(p_cohort_id);
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (v_uid, 'generate_cohort_curriculum', 'academic_cohorts', p_cohort_id,
    v_cohort.college_id, pg_catalog.jsonb_build_object(
      'study_plan_id', v_plan_id, 'term_id', v_cohort.term_id,
      'study_system', v_cohort.study_system,
      'inserted_offerings', v_result->'inserted_offerings',
      'skipped_existing', v_result->'skipped_existing',
      'skipped_unselected_elective', v_result->'skipped_unselected_elective'));
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_cohort_curriculum(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_cohort_curriculum(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.generate_cohort_curriculum(uuid) IS
  'Forward-hardened cohort curriculum generation: authenticated, one active plan, approved electives, serialized input snapshot, atomic audit.';

COMMIT;
