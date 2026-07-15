-- READ-ONLY expected shape after create fixture apply (not a migration).
-- Marker: SCHEDULE_BUILDER_PHASE6_UAT

SELECT
  v.id AS uat_version_id,
  v.name,
  v.status,
  v.notes AS marker,
  s.id AS section_id,
  s.section_number,
  sess.id AS session_id,
  sess.replaced_by_split,
  sess.room_id,
  r.code AS room_code,
  r.room_type,
  r.capacity AS room_capacity,
  co.id AS offering_id,
  co.expected_students,
  co.enrollment_count_status,
  co.enrollment_count_updated_at,
  ta.id AS teaching_assignment_id,
  ta.session_type,
  ta.required_room_type,
  (r.capacity + 5) AS threshold_capacity_plus_5,
  (2 * (r.capacity + 5)) AS designed_expected_students,
  2 AS proposed_groups_count,
  ARRAY[r.capacity + 5, r.capacity + 5] AS proposed_group_sizes
FROM public.schedule_versions v
JOIN public.schedule_sessions sess ON sess.schedule_version_id = v.id
JOIN public.sections s ON s.id = sess.section_id
JOIN public.rooms r ON r.id = sess.room_id
JOIN public.course_offerings co ON co.id = sess.course_offering_id
LEFT JOIN public.teaching_assignments ta ON ta.id = sess.teaching_assignment_id
WHERE v.id = '6a015200-0001-4000-8000-000000000003'
  AND v.notes = 'SCHEDULE_BUILDER_PHASE6_UAT';

SELECT COUNT(*)::int AS section_subgroups_before_approval
FROM public.section_subgroups
WHERE section_id = '6a015200-0001-4000-8000-000000000001';

SELECT COUNT(*)::int AS sessions_on_uat_version
FROM public.schedule_sessions
WHERE schedule_version_id = '6a015200-0001-4000-8000-000000000003';
