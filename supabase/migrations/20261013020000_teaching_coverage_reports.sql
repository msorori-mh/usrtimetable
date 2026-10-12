-- Read-only reporting; canonical identity, employment and workload rules are retained.
CREATE OR REPLACE FUNCTION faculty_private.reporting_category(p_home uuid, p_college uuid, p_type text, p_employment text)
RETURNS text LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp' AS $$
 SELECT CASE
  WHEN faculty_private.quota_applicability(p_type,p_employment) IS FALSE THEN 'contractual'
  WHEN faculty_private.quota_applicability(p_type,p_employment) IS NULL OR p_home IS NULL THEN 'unknown'
  WHEN p_home=p_college THEN 'internal' ELSE 'other_college' END
$$;
REVOKE ALL ON FUNCTION faculty_private.reporting_category(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.get_faculty_reporting_categories(p_college_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE v_rows jsonb;
BEGIN
 IF auth.uid() IS NULL OR public.can_view_college(auth.uid(),p_college_id) IS NOT TRUE THEN
  RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE='42501';
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('identity_id',h.identity_id,
  'category',faculty_private.reporting_category(h.home_college_id,p_college_id,h.type_code,h.employment_type))),'[]') INTO v_rows
 FROM faculty_private.home_profiles h JOIN public.colleges c ON c.id=p_college_id AND c.university_id=h.university_id
 WHERE h.home_college_id=p_college_id OR EXISTS(
  SELECT 1 FROM public.faculty_identity_links l JOIN public.instructors i ON i.id=l.instructor_id
  WHERE l.identity_id=h.identity_id AND i.college_id=p_college_id
 ) OR EXISTS(
  SELECT 1 FROM public.faculty_identity_links l JOIN public.teaching_assignments a ON a.instructor_id=l.instructor_id
  WHERE l.identity_id=h.identity_id AND a.college_id=p_college_id AND a.is_active
 );
 RETURN jsonb_build_object('college_id',p_college_id,'rows',v_rows);
END $$;
REVOKE ALL ON FUNCTION public.get_faculty_reporting_categories(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_faculty_reporting_categories(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_teaching_coverage_report(p_college_id uuid,p_term_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE v_university uuid; v_rows jsonb;
BEGIN
 IF auth.uid() IS NULL OR public.can_view_college(auth.uid(),p_college_id) IS NOT TRUE THEN
  RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE='42501';
 END IF;
 SELECT c.university_id INTO v_university FROM public.colleges c
 JOIN public.academic_terms t ON t.college_id=c.id WHERE c.id=p_college_id AND t.id=p_term_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'COVERAGE_TERM_SCOPE_MISMATCH' USING ERRCODE='22023'; END IF;
 WITH facts AS (
  SELECT coalesce(h.identity_id,w.instructor_id) identity_id,
   coalesce(h.full_name,i.full_name_ar,i.full_name) instructor,
   h.university_number, h.home_college_name,
   CASE WHEN h.identity_id IS NULL THEN 'unknown' ELSE faculty_private.reporting_category(h.home_college_id,p_college_id,h.type_code,h.employment_type) END category,
   ac.program_id,p.name program,p.department_id,d.name department,
   CASE WHEN ac.study_system IN ('regular','parallel') THEN ac.study_system ELSE 'unknown' END study_system,
   w.standard_assigned_hours hours,w.project_supervision_hours project,
   EXISTS(SELECT 1 FROM public.teaching_assignments a
    JOIN public.course_offerings o ON o.id=a.course_offering_id
    WHERE a.instructor_id=w.instructor_id AND a.college_id=p_college_id AND o.term_id=p_term_id
     AND a.is_active AND assignment_version_private.is_counted(a.id)
     AND (a.delivery_group_id IS NULL OR (a.assigned_component_hours IS NULL AND
      (SELECT count(*) FROM public.teaching_assignments b WHERE b.delivery_group_id=a.delivery_group_id
       AND b.is_active AND NOT assignment_version_private.is_replacement_pair(a.id,b.id))>1)))
   OR EXISTS(SELECT 1 FROM public.teaching_assignments a
    JOIN public.course_offerings o ON o.id=a.course_offering_id
    WHERE a.instructor_id=w.instructor_id AND a.college_id=p_college_id AND o.term_id=p_term_id
      AND a.is_active AND assignment_version_private.is_counted(a.id) AND a.delivery_group_id IS NOT NULL
    GROUP BY a.delivery_group_id HAVING count(*)>1) allocation_pending
  FROM public.v_instructor_delivery_workload w
  JOIN public.instructors i ON i.id=w.instructor_id
  LEFT JOIN public.faculty_identity_links l ON l.instructor_id=w.instructor_id
  LEFT JOIN faculty_private.home_profiles h ON h.identity_id=l.identity_id AND h.university_id=v_university
  LEFT JOIN public.academic_cohorts ac ON ac.id=w.cohort_id AND ac.college_id=p_college_id
  LEFT JOIN public.academic_programs p ON p.id=ac.program_id AND p.college_id=p_college_id
  LEFT JOIN public.departments d ON d.id=p.department_id AND d.college_id=p_college_id
  WHERE w.college_id=p_college_id AND w.term_id=p_term_id
 ), grouped AS (
  SELECT identity_id,instructor,university_number,home_college_name,category,
   program_id,program,department_id,department,study_system,sum(hours) hours,sum(project) project,
   bool_or(allocation_pending) allocation_pending
  FROM facts GROUP BY identity_id,instructor,university_number,home_college_name,category,
   program_id,program,department_id,department,study_system
 ), identity_pending AS (
  SELECT identity_id,bool_or(allocation_pending) pending FROM facts GROUP BY identity_id
 )
 SELECT coalesce(jsonb_agg(to_jsonb(g)||jsonb_build_object('allocation_pending',ip.pending)
  ORDER BY g.instructor,g.program,g.study_system),'[]') INTO v_rows
 FROM grouped g JOIN identity_pending ip USING(identity_id);
 RETURN jsonb_build_object('college_id',p_college_id,'term_id',p_term_id,'rows',v_rows);
END $$;
REVOKE ALL ON FUNCTION public.get_teaching_coverage_report(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_teaching_coverage_report(uuid,uuid) TO authenticated;
