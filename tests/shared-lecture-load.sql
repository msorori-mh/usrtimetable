-- Read-only invariant: in the newest published timetable of every college and
-- term, a merged member group without a session of its own adds no standard
-- load. Returns zero rows when the invariant holds.
WITH newest AS (
  SELECT DISTINCT ON (v.college_id, v.academic_term_id) v.id
  FROM public.schedule_versions v
  WHERE v.status = 'published'
  ORDER BY v.college_id, v.academic_term_id, v.created_at DESC
), member AS (
  SELECT DISTINCT l.member_group_id AS group_id
  FROM schedule_version_delivery_private.shared_link_facts l
  JOIN newest n ON n.id = l.version_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.schedule_sessions s
    WHERE s.schedule_version_id = l.version_id AND s.delivery_group_id = l.member_group_id)
)
SELECT m.group_id, public.delivery_group_shared_in_published(m.group_id) AS recognised
FROM member m
WHERE NOT public.delivery_group_shared_in_published(m.group_id);
