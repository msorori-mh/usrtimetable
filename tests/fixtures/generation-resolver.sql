-- Exact resolver from 20260717043000_teaching_assignments_v2_runtime_foundation.sql.
CREATE OR REPLACE FUNCTION public.resolve_offering_for_delivery_group(p_delivery_group_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_dg public.delivery_groups%ROWTYPE;
  v_cohort public.academic_cohorts%ROWTYPE;
  v_offering_id uuid;
BEGIN
  SELECT * INTO v_dg FROM public.delivery_groups WHERE id = p_delivery_group_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_cohort FROM public.academic_cohorts WHERE id = v_dg.cohort_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT co.id INTO v_offering_id
  FROM public.course_offerings co
  WHERE co.college_id = v_dg.college_id
    AND co.plan_course_id = v_dg.plan_course_id
    AND co.term_id = v_cohort.term_id
    AND COALESCE(co.program_id, v_cohort.program_id) = v_cohort.program_id
    AND COALESCE(co.level_id, v_cohort.level_id) = v_cohort.level_id
    AND co.study_system = v_cohort.study_system
    AND COALESCE(co.is_active, true) = true
  ORDER BY co.created_at DESC NULLS LAST, co.id ASC
  LIMIT 1;

  RETURN v_offering_id;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_offering_for_delivery_group(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_offering_for_delivery_group(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.resolve_offering_for_delivery_group(uuid) FROM authenticated;