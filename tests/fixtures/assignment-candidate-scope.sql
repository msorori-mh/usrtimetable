-- Function-only production baseline; no instructor or timetable records.
CREATE OR REPLACE FUNCTION public.get_delivery_group_assignment_candidates(p_delivery_group_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_dg public.delivery_groups%ROWTYPE;
  v_pcc public.plan_course_components%ROWTYPE;
  v_candidates jsonb := '[]'::jsonb;
  v_colleges jsonb := '[]'::jsonb;
  v_alloc jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  IF p_delivery_group_id IS NULL THEN
    RAISE EXCEPTION 'DELIVERY_GROUP_ID_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_dg FROM public.operational_delivery_groups WHERE id = p_delivery_group_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DELIVERY_GROUP_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT public.can_view_college(v_uid, v_dg.college_id) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_pcc FROM public.plan_course_components WHERE id = v_dg.component_id;
  v_alloc := public.compute_delivery_group_allocation(p_delivery_group_id);

  SELECT COALESCE(jsonb_agg(x ORDER BY x.is_home_college DESC, x.college_name, x.full_name), '[]'::jsonb)
  INTO v_candidates
  FROM (
    SELECT
      i.id AS instructor_id,
      i.full_name,
      i.academic_rank,
      hp.home_college_id AS home_college_id,
      c.name AS college_name,
      (hp.home_college_id = v_dg.college_id) AS is_home_college,
      CASE WHEN hp.home_college_id = v_dg.college_id THEN i.employee_number ELSE NULL END AS employee_number,
      EXISTS (
        SELECT 1 FROM public.teaching_assignments ta
        WHERE ta.delivery_group_id = p_delivery_group_id
          AND EXISTS(SELECT 1 FROM public.faculty_identity_links al WHERE al.instructor_id=ta.instructor_id AND al.identity_id=hp.identity_id)
          AND ta.is_active = TRUE
      ) AS already_assigned
    FROM faculty_private.home_profiles hp
    JOIN public.instructors i ON i.id=hp.source_instructor_id
    JOIN public.colleges c ON c.id=hp.home_college_id
    WHERE i.is_active = TRUE AND i.availability_status = 'available' AND c.university_id=(SELECT university_id FROM colleges WHERE id=v_dg.college_id)
  ) x;

  SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
      'college_id', c.id,
      'college_name', c.name,
      'is_home_college', (c.id = v_dg.college_id)
    )), '[]'::jsonb)
  INTO v_colleges
  FROM public.colleges c
  WHERE c.university_id=(SELECT university_id FROM colleges WHERE id=v_dg.college_id) AND EXISTS (SELECT 1 FROM faculty_private.home_profiles hp WHERE hp.home_college_id=c.id AND hp.is_active);

  RETURN jsonb_build_object(
    'ok', true,
    'delivery_group_id', p_delivery_group_id,
    'college_id', v_dg.college_id,
    'is_obsolete', COALESCE(v_dg.is_obsolete, false),
    'active', COALESCE(v_dg.active, true),
    'component_type', v_pcc.component_type,
    'component_hours', v_pcc.weekly_contact_hours,
    'allocation', v_alloc,
    'candidates', v_candidates,
    'candidate_colleges', v_colleges,
    'assignable', NOT COALESCE(v_dg.is_obsolete, false)
      AND COALESCE(v_dg.active, true)
      AND COALESCE(v_pcc.component_type, '') IS DISTINCT FROM 'summer_training'
      AND public.can_manage_college(v_uid, v_dg.college_id)
  );
END;
$function$
;
