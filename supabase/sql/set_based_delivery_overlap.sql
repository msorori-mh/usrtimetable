-- Set-based equivalent of the conservative student-overlap check.
-- Compute permissions and membership coverage once per candidate set, not once per pair.
CREATE OR REPLACE FUNCTION public._sb_v2_delivery_group_overlap(
 p_schedule_version_id uuid,p_delivery_group_id uuid,p_cohort_id uuid,
 p_day_of_week integer,p_start_time time,p_end_time time,p_exclude_session_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
WITH peers AS MATERIALIZED (
 SELECT s.id,s.delivery_group_id,s.cohort_id FROM public.schedule_sessions s
 WHERE s.schedule_version_id=p_schedule_version_id AND s.day_of_week=p_day_of_week
 AND s.start_time<p_end_time AND p_start_time<s.end_time
 AND (p_exclude_session_id IS NULL OR s.id<>p_exclude_session_id)
 AND ((p_delivery_group_id IS NOT NULL AND s.delivery_group_id IS NOT NULL)
 OR (p_cohort_id IS NOT NULL AND s.cohort_id=p_cohort_id))
), ids AS MATERIALIZED (
 SELECT p_delivery_group_id id UNION SELECT delivery_group_id FROM peers
), groups AS MATERIALIZED (
 SELECT g.* FROM public.operational_delivery_groups g JOIN ids ON ids.id=g.id
), access AS MATERIALIZED (
 SELECT college_id,public.can_view_college(auth.uid(),college_id) allowed
 FROM (SELECT DISTINCT college_id FROM groups) colleges
), visible AS MATERIALIZED (
 SELECT g.* FROM groups g JOIN access a USING(college_id)
 WHERE auth.uid() IS NOT NULL AND a.allowed AND g.active AND NOT coalesce(g.is_obsolete,false)
), cohorts AS MATERIALIZED (
 SELECT i.id,g.cohort_id FROM ids i
 CROSS JOIN LATERAL public.shared_lecture_group_ids(i.id) shared
 JOIN public.delivery_groups g ON g.id=shared.group_id
), members AS MATERIALIZED (
 SELECT m.delivery_group_id,m.partition_id,p.headcount,p.active
 FROM public.operational_group_members m JOIN ids i ON i.id=m.delivery_group_id
 JOIN public.cohort_student_partitions p ON p.id=m.partition_id
), coverage AS MATERIALIZED (
 SELECT delivery_group_id,count(*) n,sum(headcount) total FROM members WHERE active GROUP BY delivery_group_id
), conflicts AS (
 SELECT peer.* FROM peers peer
 LEFT JOIN visible a ON a.id=p_delivery_group_id
 LEFT JOIN visible b ON b.id=peer.delivery_group_id
 LEFT JOIN coverage ac ON ac.delivery_group_id=a.id
 LEFT JOIN coverage bc ON bc.delivery_group_id=b.id
 WHERE CASE
 WHEN p_delivery_group_id IS NULL OR peer.delivery_group_id IS NULL OR peer.delivery_group_id=p_delivery_group_id THEN true
 WHEN auth.uid() IS NULL OR a.cohort_id IS NULL OR b.cohort_id IS NULL THEN true
 WHEN NOT EXISTS(SELECT 1 FROM cohorts ca JOIN cohorts cb USING(cohort_id)
 WHERE ca.id=p_delivery_group_id AND cb.id=peer.delivery_group_id) THEN false
 WHEN coalesce(ac.n,0)=0 OR coalesce(bc.n,0)=0 OR coalesce(a.expected_students,0)<=0 OR coalesce(b.expected_students,0)<=0
 OR ac.total<>a.expected_students OR bc.total<>b.expected_students THEN true
 ELSE EXISTS(SELECT 1 FROM public.operational_group_members ma JOIN public.operational_group_members mb USING(partition_id)
 WHERE ma.delivery_group_id=p_delivery_group_id AND mb.delivery_group_id=peer.delivery_group_id) END
)
SELECT coalesce(jsonb_agg(jsonb_build_object(
 'code','delivery_group_conflict','severity','hard',
 'message_ar','تعارض مجموعة التدريس / الدفعة: توجد جلسة متداخلة لنفس المجموعة أو لطلاب مشتركين.',
 'message_en','Delivery group / cohort conflict: overlapping session sharing students.',
 'related_session_id',id,'metadata',jsonb_build_object('delivery_group_id',delivery_group_id,'cohort_id',cohort_id,'shared_students',true)
)), '[]'::jsonb) FROM conflicts;
$function$;
