-- Approve imported elective choices with the signed-in manager's identity.
BEGIN;

CREATE OR REPLACE FUNCTION public.approve_cohort_elective_selections(p_cohort_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_cohort public.academic_cohorts%ROWTYPE;
  v_plan uuid;
  v_plan_count integer;
  v_semester integer;
  v_count integer;
  v_approved integer;
BEGIN
  IF v_actor IS NULL OR p_cohort_id IS NULL THEN
    RAISE EXCEPTION 'COHORT_NOT_FOUND_OR_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(9262, 1);
  SELECT * INTO v_cohort FROM public.academic_cohorts
    WHERE id = p_cohort_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_manage_college(v_actor, v_cohort.college_id) THEN
    RAISE EXCEPTION 'COHORT_NOT_FOUND_OR_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  SELECT CASE term_type WHEN 'first' THEN 1 WHEN 'second' THEN 2 END
    INTO v_semester FROM public.academic_terms
    WHERE id = v_cohort.term_id AND college_id = v_cohort.college_id;
  IF v_semester IS NULL THEN
    RAISE EXCEPTION 'COHORT_TERM_TYPE_UNSUPPORTED' USING ERRCODE = '23514';
  END IF;
  SELECT count(*)::integer, (array_agg(id))[1] INTO v_plan_count, v_plan
    FROM public.study_plans WHERE college_id = v_cohort.college_id
      AND program_id = v_cohort.program_id AND is_active AND archived_at IS NULL;
  IF v_plan_count <> 1 THEN
    RAISE EXCEPTION 'ACTIVE_STUDY_PLAN_NOT_UNIQUE' USING ERRCODE = '23514';
  END IF;
  SELECT count(*) INTO v_count FROM public.cohort_elective_selections
    WHERE cohort_id = p_cohort_id AND college_id = v_cohort.college_id;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'NO_ELECTIVE_SELECTIONS' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.cohort_elective_selections s
    LEFT JOIN public.elective_slots slot ON slot.id = s.elective_slot_id
    WHERE s.cohort_id = p_cohort_id AND s.college_id = v_cohort.college_id
      AND (slot.id IS NULL OR slot.college_id <> v_cohort.college_id
        OR slot.study_plan_id <> v_plan OR slot.semester <> v_semester
        OR (slot.level_id IS NOT NULL AND slot.level_id <> v_cohort.level_id)
        OR NOT coalesce(slot.active, true)
        OR NOT EXISTS (
          SELECT 1 FROM public.elective_slot_courses m
          JOIN public.courses c ON c.id = m.course_id
          WHERE m.elective_slot_id = s.elective_slot_id
            AND m.course_id = s.selected_course_id
            AND m.college_id = v_cohort.college_id AND c.college_id = v_cohort.college_id
            AND coalesce(m.active, true)
            AND c.code !~* '\(E\)\s*$'
            AND c.code !~* '^[A-Z]{2,}[0-9]+XX\(E\)$'))
  ) THEN
    RAISE EXCEPTION 'ELECTIVE_SELECTION_CONTEXT_MISMATCH' USING ERRCODE = '23514';
  END IF;
  UPDATE public.cohort_elective_selections SET
    decided_at = now(), decided_by = v_actor
    WHERE cohort_id = p_cohort_id AND college_id = v_cohort.college_id
      AND (decided_at IS NULL OR decided_by IS NULL);
  GET DIAGNOSTICS v_approved = ROW_COUNT;
  INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, college_id, details)
    VALUES(v_actor, 'approve_elective_selections', 'academic_cohorts', p_cohort_id,
      v_cohort.college_id, pg_catalog.jsonb_build_object(
        'study_plan_id', v_plan, 'term_id', v_cohort.term_id,
        'selection_count', v_count, 'approved_count', v_approved));
  RETURN pg_catalog.jsonb_build_object('approved', v_approved, 'total', v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.approve_cohort_elective_selections(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_cohort_elective_selections(uuid) TO authenticated;
COMMIT;
