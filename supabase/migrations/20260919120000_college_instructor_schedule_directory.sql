-- The selected college scopes the picker for every role, including super admin.
-- Cross-college timetable access remains a separate, existing admin capability.
CREATE OR REPLACE FUNCTION public.get_college_instructor_schedule_directory(p_college_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = '' AS $$
DECLARE v_university uuid; v_result jsonb;
BEGIN
 IF auth.uid() IS NULL OR p_college_id IS NULL
  OR NOT public.can_view_college(auth.uid(), p_college_id) THEN
  RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
 END IF;
 SELECT university_id INTO v_university FROM public.colleges
 WHERE id = p_college_id AND name !~* 'TEST_ONLY';
 IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;

 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'id', h.source_instructor_id, 'identity_id', h.identity_id,
  'record_ids', aliases.ids, 'university_number', h.university_number,
  'full_name', h.full_name, 'college_id', i.college_id,
  'home_college_id', h.home_college_id, 'home_college_name', h.home_college_name,
  'instructor_type_code', h.type_code, 'employment_type', h.employment_type,
  'recorded_quota', h.recorded_quota, 'recorded_release', h.recorded_release,
  'authoritative_quota', h.quota
 ) ORDER BY h.full_name, h.identity_id), '[]'::jsonb) INTO v_result
 FROM faculty_private.home_profiles h
 JOIN public.instructors i ON i.id = h.source_instructor_id
 CROSS JOIN LATERAL (
  SELECT array_agg(l.instructor_id ORDER BY l.instructor_id) AS ids
  FROM public.faculty_identity_links l WHERE l.identity_id = h.identity_id
 ) aliases
 WHERE h.university_id = v_university AND h.full_name !~* 'TEST_ONLY'
  AND (
   (h.home_college_id = p_college_id AND h.is_active)
   OR EXISTS (
    SELECT 1 FROM public.teaching_assignments a
    JOIN public.course_offerings o ON o.id = a.course_offering_id
    LEFT JOIN public.delivery_groups g ON g.id = a.delivery_group_id
    WHERE a.college_id = p_college_id AND o.college_id = p_college_id
     AND a.instructor_id = ANY(aliases.ids) AND a.is_active AND o.is_active
     AND (a.delivery_group_id IS NULL OR (g.active AND NOT coalesce(g.is_obsolete, false)))
   )
   OR EXISTS (
    SELECT 1 FROM public.schedule_sessions s
    JOIN public.schedule_versions v ON v.id = s.schedule_version_id
    WHERE s.college_id = p_college_id AND v.college_id = p_college_id
     AND v.status IN ('draft','review','approved','published')
     AND NOT coalesce(v.disposable_test, false) AND v.name !~* 'TEST_ONLY'
     AND NOT coalesce(s.replaced_by_split, false)
     AND (
      s.instructor_id = ANY(aliases.ids)
      OR EXISTS (
       SELECT 1 FROM public.existing_schedule_source_rows src
       WHERE src.college_id = p_college_id AND src.schedule_session_id = s.id
        AND src.instructor_ids && aliases.ids
      )
     )
   )
  );
 RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_college_instructor_schedule_directory(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_college_instructor_schedule_directory(uuid) TO authenticated;
