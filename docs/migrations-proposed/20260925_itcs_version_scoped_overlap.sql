-- Stage ITCS-ISO-02c. Replace the server student overlap read with the
-- selected-version membership RPC. Depends on Stage 02b.
-- No sessions, counts, assignments or global delivery rows are edited here.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public._sb_v2_delivery_group_overlap(
  p_schedule_version_id uuid, p_delivery_group_id uuid, p_cohort_id uuid,
  p_day_of_week integer, p_start_time time, p_end_time time,
  p_exclude_session_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','public' AS $function$
WITH peers AS MATERIALIZED (
  SELECT s.id,s.delivery_group_id,s.cohort_id
  FROM public.schedule_sessions s
  WHERE s.schedule_version_id=p_schedule_version_id AND s.day_of_week=p_day_of_week
    AND s.start_time<p_end_time AND p_start_time<s.end_time
    AND (p_exclude_session_id IS NULL OR s.id<>p_exclude_session_id)
    AND ((p_delivery_group_id IS NOT NULL AND s.delivery_group_id IS NOT NULL)
      OR (p_cohort_id IS NOT NULL AND s.cohort_id=p_cohort_id))
), ids AS MATERIALIZED (
  SELECT p_delivery_group_id AS id WHERE p_delivery_group_id IS NOT NULL
  UNION
  SELECT delivery_group_id FROM peers WHERE delivery_group_id IS NOT NULL
), members AS MATERIALIZED (
  SELECT m.*
  FROM public.schedule_version_student_memberships(
    p_schedule_version_id,
    ARRAY(SELECT id FROM ids)
  ) m
), cohorts AS MATERIALIZED (
  SELECT DISTINCT delivery_group_id,cohort_id FROM members
), coverage AS MATERIALIZED (
  SELECT delivery_group_id,count(partition_id) AS n,
    sum(partition_headcount) AS total,max(expected_students) AS expected_students
  FROM members GROUP BY delivery_group_id
), conflicts AS (
  SELECT peer.* FROM peers peer
  LEFT JOIN coverage a ON a.delivery_group_id=p_delivery_group_id
  LEFT JOIN coverage b ON b.delivery_group_id=peer.delivery_group_id
  WHERE CASE
    WHEN p_delivery_group_id IS NULL OR peer.delivery_group_id IS NULL
      OR peer.delivery_group_id=p_delivery_group_id THEN true
    WHEN NOT EXISTS (
      SELECT 1 FROM cohorts ca JOIN cohorts cb USING(cohort_id)
      WHERE ca.delivery_group_id=p_delivery_group_id
        AND cb.delivery_group_id=peer.delivery_group_id
    ) THEN false
    WHEN coalesce(a.n,0)=0 OR coalesce(b.n,0)=0
      OR coalesce(a.expected_students,0)<=0 OR coalesce(b.expected_students,0)<=0
      OR a.total IS DISTINCT FROM a.expected_students
      OR b.total IS DISTINCT FROM b.expected_students THEN true
    ELSE EXISTS (
      SELECT 1 FROM members ma JOIN members mb USING(partition_id)
      WHERE ma.delivery_group_id=p_delivery_group_id
        AND mb.delivery_group_id=peer.delivery_group_id
        AND ma.partition_id IS NOT NULL
    )
  END
)
SELECT coalesce(jsonb_agg(jsonb_build_object(
  'code','delivery_group_conflict','severity','hard',
  'message_ar','تعارض مجموعة التدريس / الدفعة: توجد جلسة متداخلة لنفس المجموعة أو لطلاب مشتركين.',
  'message_en','Delivery group / cohort conflict: overlapping session sharing students.',
  'related_session_id',id,
  'metadata',jsonb_build_object('delivery_group_id',delivery_group_id,
    'cohort_id',cohort_id,'shared_students',true)
)), '[]'::jsonb) FROM conflicts;
$function$;

-- Retain the preceding function's grants; no direct web-client entrypoint is
-- introduced. Its existing V2 write callers continue to use the same signature.
COMMIT;
