-- Keep the historical Physics assignment intact while counting the published
-- Math/Physics lecture once through Maryam's Mathematics anchor.
BEGIN;
DO $$
DECLARE d text;
BEGIN
 d:=pg_get_functiondef('assignment_version_private.is_counted(uuid)'::regprocedure);
 IF position('SELECT CASE' IN d)=0 THEN RAISE EXCEPTION 'SHARED_WORKLOAD_POLICY_DRIFT'; END IF;
 EXECUTE replace(d,'SELECT CASE', $patch$SELECT CASE
 WHEN a='4af99df9-ac82-481b-8464-79a45da3b319'::uuid AND EXISTS(
   SELECT 1 FROM public.schedule_versions v
   JOIN schedule_version_delivery_private.shared_link_facts l ON l.version_id=v.id
   JOIN public.schedule_sessions s ON s.schedule_version_id=v.id AND s.delivery_group_id=l.anchor_group_id
   WHERE v.id='badcb000-9280-4260-8000-000000000001'::uuid AND v.status='published'
     AND v.academic_term_id='93705393-609d-4605-ae94-9572cd8b2090'::uuid
     AND l.anchor_group_id='94776001-8c09-4907-8662-dc24b93114be'::uuid
     AND l.member_group_id='d183a739-2122-401c-9ecb-1de07213ae94'::uuid
     AND s.teaching_assignment_id='13a3d53f-daca-42bc-925f-e5963443c646'::uuid
     AND s.instructor_id='48ee97d1-ed6f-4242-8da9-3df094150b75'::uuid
     AND public.education_source_revision_session_allowed(s)
     AND NOT EXISTS(SELECT 1 FROM public.schedule_sessions other
       WHERE other.schedule_version_id=v.id AND other.teaching_assignment_id=a)
 ) THEN false
 $patch$);
END;
$$;
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.schedule_versions WHERE id='badcb000-9280-4260-8000-000000000001' AND status='published') THEN
   IF assignment_version_private.is_counted('4af99df9-ac82-481b-8464-79a45da3b319')
   OR NOT assignment_version_private.is_counted('13a3d53f-daca-42bc-925f-e5963443c646')
   OR NOT EXISTS(SELECT 1 FROM public.version_effective_assignments('7430bad7-2de7-5c90-9368-b214a199d6c3') WHERE assignment_id='4af99df9-ac82-481b-8464-79a45da3b319') THEN
     RAISE EXCEPTION 'SHARED_WORKLOAD_HISTORY_REGRESSION';
   END IF;
 END IF;
END;
$$;
COMMIT;
