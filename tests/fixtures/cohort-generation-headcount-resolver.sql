-- Snapshot of the production approved-headcount resolver used by the disposable database test.
CREATE OR REPLACE FUNCTION public.resolve_scheduling_headcount(p_college_id uuid, p_cohort_id uuid, p_term_id uuid, p_course_offering_id uuid DEFAULT NULL::uuid, p_plan_course_component_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_base public.scheduling_cohort_term_headcounts%ROWTYPE;
  v_override public.scheduling_headcount_overrides%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR NOT public.can_view_college(v_uid, p_college_id) THEN RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'College view permission required'); END IF;
  SELECT * INTO v_base FROM public.scheduling_cohort_term_headcounts
    WHERE college_id = p_college_id AND cohort_id = p_cohort_id AND term_id = p_term_id AND approval_status = 'approved';
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'SCHEDULING_HEADCOUNT_MISSING', 'blocker', true, 'message', 'Approved scheduling headcount is required before generation'); END IF;
  SELECT * INTO v_override FROM public.scheduling_headcount_overrides
    WHERE headcount_id = v_base.id AND active AND approval_status = 'approved'
      AND (course_offering_id IS NULL OR course_offering_id = p_course_offering_id)
      AND (plan_course_component_id IS NULL OR plan_course_component_id = p_plan_course_component_id)
    ORDER BY (course_offering_id IS NOT NULL)::int + (plan_course_component_id IS NOT NULL)::int DESC
    LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('ok', true, 'source', 'override', 'headcount_id', v_base.id, 'override_id', v_override.id, 'scheduling_headcount', v_override.scheduling_headcount, 'exam_eligible_count', coalesce(v_override.exam_eligible_count, v_base.exam_eligible_count), 'reserve_margin', coalesce(v_override.reserve_margin, v_base.reserve_margin)); END IF;
  RETURN jsonb_build_object('ok', true, 'source', 'base', 'headcount_id', v_base.id, 'scheduling_headcount', v_base.scheduling_headcount, 'exam_eligible_count', v_base.exam_eligible_count, 'reserve_margin', v_base.reserve_margin);
END; $function$

