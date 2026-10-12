-- Read-only reports. Reuse the canonical workload view: merged members and
-- unpromoted draft replacements must never acquire a second teaching load.
CREATE OR REPLACE FUNCTION public.get_system_hours_report(
  p_college_id uuid, p_term_id uuid, p_kind text
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_university uuid; v_year text; v_type text; v_terms uuid[];
  h record; v_ids uuid[]; v_load jsonb; v_rows jsonb := '[]'::jsonb;
  v_regular numeric; v_parallel numeric; v_unknown numeric; v_project numeric;
  v_pending boolean;
BEGIN
  IF auth.uid() IS NULL OR public.can_view_college(auth.uid(), p_college_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('overload_system', 'contractual') THEN
    RAISE EXCEPTION 'SYSTEM_HOURS_INVALID_KIND' USING ERRCODE = '22023';
  END IF;
  SELECT c.university_id,
    coalesce(nullif(btrim(t.academic_year), ''), substring(t.name from '[0-9]{4}-[0-9]{4}')),
    t.term_type INTO v_university, v_year, v_type
  FROM public.academic_terms t JOIN public.colleges c ON c.id = t.college_id
  WHERE t.id = p_term_id AND t.college_id = p_college_id;
  IF v_year IS NULL OR v_type IS NULL THEN
    RAISE EXCEPTION 'FACULTY_REPORT_TERM_METADATA_REQUIRED' USING ERRCODE = '22023';
  END IF;
  SELECT array_agg(t.id) INTO v_terms
  FROM public.academic_terms t JOIN public.colleges c ON c.id = t.college_id
  WHERE c.university_id = v_university AND t.term_type = v_type
    AND coalesce(nullif(btrim(t.academic_year), ''), substring(t.name from '[0-9]{4}-[0-9]{4}')) = v_year;

  FOR h IN
    SELECT hp.* FROM faculty_private.home_profiles hp
    WHERE hp.university_id = v_university AND (
      (p_kind = 'overload_system' AND hp.home_college_id = p_college_id
        AND faculty_private.quota_applicability(hp.type_code, hp.employment_type) IS TRUE)
      OR (p_kind = 'contractual'
        AND faculty_private.quota_applicability(hp.type_code, hp.employment_type) IS FALSE
        AND EXISTS (
          SELECT 1 FROM public.faculty_identity_links l
          JOIN public.v_instructor_delivery_workload w ON w.instructor_id = l.instructor_id
          WHERE l.identity_id = hp.identity_id AND w.college_id = p_college_id
            AND w.term_id = p_term_id)))
    ORDER BY hp.full_name, hp.identity_id
  LOOP
    SELECT array_agg(l.instructor_id) INTO v_ids FROM public.faculty_identity_links l
    WHERE l.identity_id = h.identity_id;
    -- Same identity and equivalent-term rules as faculty_private.workload.
    -- Overload is a university aggregate for HOME members only, as in the
    -- existing guarded workload RPC. Contracts expose the requested college only.
    SELECT coalesce(sum(w.standard_assigned_hours) FILTER (WHERE ac.study_system = 'regular'), 0),
      coalesce(sum(w.standard_assigned_hours) FILTER (WHERE ac.study_system = 'parallel'), 0),
      coalesce(sum(w.standard_assigned_hours) FILTER (WHERE ac.study_system IS NULL OR ac.study_system NOT IN ('regular', 'parallel')), 0),
      coalesce(sum(w.project_supervision_hours), 0)
    INTO v_regular, v_parallel, v_unknown, v_project
    FROM public.v_instructor_delivery_workload w
    LEFT JOIN public.academic_cohorts ac ON ac.id = w.cohort_id
    WHERE w.instructor_id = ANY(v_ids)
      AND CASE WHEN p_kind = 'contractual'
        THEN w.college_id = p_college_id AND w.term_id = p_term_id
        ELSE w.term_id = ANY(v_terms) END;
    v_load := faculty_private.workload(h.source_instructor_id, p_term_id);
    v_pending := (v_load->>'allocation_pending')::boolean;
    IF p_kind = 'contractual' THEN
      SELECT EXISTS (
        SELECT 1 FROM public.teaching_assignments a
        JOIN public.course_offerings o ON o.id = a.course_offering_id
        WHERE a.instructor_id = ANY(v_ids) AND a.college_id = p_college_id
          AND o.term_id = p_term_id AND a.is_active
          AND assignment_version_private.is_counted(a.id)
          AND (a.delivery_group_id IS NULL OR (a.assigned_component_hours IS NULL AND
            (SELECT count(*) FROM public.teaching_assignments b
             WHERE b.delivery_group_id = a.delivery_group_id AND b.is_active
               AND NOT assignment_version_private.is_replacement_pair(a.id,b.id)) > 1)))
        OR EXISTS (
          SELECT 1 FROM public.teaching_assignments a
          JOIN public.course_offerings o ON o.id = a.course_offering_id
          WHERE a.instructor_id = ANY(v_ids) AND a.college_id = p_college_id
            AND o.term_id = p_term_id AND a.is_active
            AND assignment_version_private.is_counted(a.id) AND a.delivery_group_id IS NOT NULL
          GROUP BY a.delivery_group_id HAVING count(*) > 1)
      INTO v_pending;
    END IF;
    IF p_kind = 'overload_system' AND
      abs(v_regular + v_parallel + v_unknown - (v_load->>'standard_assigned_hours')::numeric) > 0.001 THEN
      RAISE EXCEPTION 'SYSTEM_HOURS_TOTAL_MISMATCH';
    END IF;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'identity_id', h.identity_id, 'instructor', h.full_name,
      'university_number', h.university_number, 'rank', h.academic_rank,
      'quota', CASE WHEN p_kind = 'overload_system' THEN h.quota END,
      'regular', v_regular, 'parallel', v_parallel, 'unknown', v_unknown,
      'project', v_project, 'allocation_pending', v_pending));
  END LOOP;
  RETURN jsonb_build_object('college_id', p_college_id, 'term_id', p_term_id,
    'kind', p_kind, 'rows', v_rows);
END
$function$;
REVOKE ALL ON FUNCTION public.get_system_hours_report(uuid,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_system_hours_report(uuid,uuid,text) TO authenticated;
