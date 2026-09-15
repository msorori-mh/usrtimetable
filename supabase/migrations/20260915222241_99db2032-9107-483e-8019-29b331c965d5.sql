CREATE OR REPLACE FUNCTION public.compute_instructor_standard_workload(p_instructor_id uuid, p_term_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_instructor public.instructors%ROWTYPE;
  v_required numeric;
  v_rank_code text;
  v_standard numeric := 0;
  v_project numeric := 0;
  v_status text;
  v_deficit numeric := 0;
  v_overload numeric := 0;
  v_by_college jsonb := '[]'::jsonb;
BEGIN
  IF p_instructor_id IS NULL THEN
    RAISE EXCEPTION 'INSTRUCTOR_ID_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_instructor FROM public.instructors WHERE id = p_instructor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INSTRUCTOR_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    public.can_view_college(v_uid, v_instructor.college_id)
    OR public.can_manage_college(v_uid, v_instructor.college_id)
  ) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  SELECT fwp.required_load_hours, fwp.rank_code
    INTO v_required, v_rank_code
  FROM public.faculty_workload_policies fwp
  WHERE fwp.college_id = v_instructor.college_id
    AND fwp.active = true
    AND (
      lower(fwp.rank_code) = lower(COALESCE(v_instructor.academic_rank, ''))
      OR EXISTS (
        SELECT 1
        FROM unnest(fwp.rank_aliases) alias
        WHERE lower(alias) = lower(COALESCE(v_instructor.academic_rank, ''))
      )
    )
  ORDER BY fwp.rank_code
  LIMIT 1;

  -- The instructor form is authoritative; rank policy is a fallback.
  -- Zero is a valid saved load, not a missing value.
  IF v_instructor.max_weekly_hours IS NOT NULL THEN
    v_required := GREATEST(0, v_instructor.max_weekly_hours
      - COALESCE(v_instructor.administrative_release_hours, 0));
  ELSIF v_required IS NOT NULL THEN
    v_required := GREATEST(0, v_required
      - COALESCE(v_instructor.administrative_release_hours, 0));
  END IF;

  -- CROSS-COLLEGE-INSTRUCTOR-01: an instructor is registered once in the home
  -- college but may teach delivery groups of other colleges. The applied weekly
  -- load must therefore aggregate every college's hours, not only the home one.
  SELECT
    COALESCE(SUM(w.standard_assigned_hours), 0),
    COALESCE(SUM(w.project_supervision_hours), 0)
  INTO v_standard, v_project
  FROM public.v_instructor_delivery_workload w
  WHERE w.instructor_id = p_instructor_id
    AND (p_term_id IS NULL OR w.term_id = p_term_id);

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'college_id'), '[]'::jsonb)
  INTO v_by_college
  FROM (
    SELECT jsonb_build_object(
             'college_id', w.college_id,
             'is_home_college', (w.college_id = v_instructor.college_id),
             'standard_assigned_hours', COALESCE(SUM(w.standard_assigned_hours), 0),
             'project_supervision_hours', COALESCE(SUM(w.project_supervision_hours), 0)
           ) AS x
    FROM public.v_instructor_delivery_workload w
    WHERE w.instructor_id = p_instructor_id
      AND (p_term_id IS NULL OR w.term_id = p_term_id)
    GROUP BY w.college_id
  ) s;

  IF v_required IS NULL THEN
    v_status := 'policy_missing';
  ELSIF v_standard = 0 THEN
    v_status := 'unassigned';
  ELSIF v_standard > v_required THEN
    v_status := 'overload';
    v_overload := v_standard - v_required;
  ELSIF v_standard < v_required THEN
    v_status := 'deficit';
    v_deficit := v_required - v_standard;
  ELSE
    v_status := 'ok';
  END IF;

  RETURN jsonb_build_object(
    'instructor_id', p_instructor_id,
    'college_id', v_instructor.college_id,
    'term_id', p_term_id,
    'rank_code', v_rank_code,
    'academic_rank', v_instructor.academic_rank,
    'required_load_hours', v_required,
    'standard_assigned_hours', v_standard,
    'project_supervision_hours', v_project,
    'hours_by_college', v_by_college,
    'deficit_hours', v_deficit,
    'overload_hours', v_overload,
    'status', v_status
  );
END;
$function$;