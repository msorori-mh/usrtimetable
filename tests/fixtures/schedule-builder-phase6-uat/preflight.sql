-- READ-ONLY expected shape after harden + isolated create (not a migration).
-- Marker: SCHEDULE_BUILDER_PHASE6_ISOLATED_UAT

SELECT
  v.id AS uat_version_id,
  v.name,
  v.status,
  v.notes AS marker,
  co.id AS offering_id,
  co.notes AS offering_marker,
  co.term_id,
  t.id AS term_exists,
  t.college_id AS term_college_id,
  co.college_id AS offering_college_id,
  s.id AS section_id,
  ta.id AS teaching_assignment_id,
  sess.id AS session_id,
  sess.replaced_by_split,
  sess.section_subgroup_id,
  sess.split_source_session_id,
  r.code AS room_code,
  r.room_type,
  r.capacity AS room_capacity,
  co.expected_students,
  co.enrollment_count_status,
  (r.capacity + 5) AS threshold,
  (2 * (r.capacity + 5)) AS designed_expected_students
FROM public.schedule_versions v
JOIN public.schedule_sessions sess ON sess.schedule_version_id = v.id
JOIN public.course_offerings co ON co.id = sess.course_offering_id
JOIN public.academic_terms t ON t.id = co.term_id
JOIN public.sections s ON s.id = sess.section_id
JOIN public.rooms r ON r.id = sess.room_id
LEFT JOIN public.teaching_assignments ta ON ta.id = sess.teaching_assignment_id
WHERE v.id = '6a015203-0001-4000-8000-000000000005'
  AND v.notes = 'SCHEDULE_BUILDER_PHASE6_ISOLATED_UAT'
  AND co.notes = 'SCHEDULE_BUILDER_PHASE6_ISOLATED_UAT';

SELECT COUNT(*)::int AS section_subgroups_before_approval
FROM public.section_subgroups
WHERE section_id = '6a015203-0001-4000-8000-000000000003';

SELECT COUNT(*)::int AS sessions_on_uat_version
FROM public.schedule_sessions
WHERE schedule_version_id = '6a015203-0001-4000-8000-000000000005';

-- FK catalog
SELECT conname, convalidated, confdeltype,
  CASE confdeltype WHEN 'r' THEN 'RESTRICT' WHEN 'a' THEN 'NO ACTION' WHEN 'c' THEN 'CASCADE' ELSE confdeltype::text END AS on_delete
FROM pg_constraint
WHERE conname = 'course_offerings_term_id_fkey';

-- Legacy offerings untouched count (expect same as pre-create baseline minus 0; UAT offering excluded)
SELECT COUNT(*)::bigint AS non_uat_offerings
FROM public.course_offerings
WHERE id <> '6a015203-0001-4000-8000-000000000001';
