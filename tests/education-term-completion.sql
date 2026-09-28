-- Run after the migration inside BEGIN/ROLLBACK, before production creation.
SELECT education_source_revision_private.create_term_completion();
DO $$
DECLARE v constant uuid:='badcb000-9280-4260-8000-000000000001'; n integer; hours numeric; rejected boolean:=false;
BEGIN
 IF NOT public.education_source_revision_verified(v) THEN RAISE EXCEPTION 'NOT_VERIFIED'; END IF;
 SELECT count(*),sum(extract(epoch FROM(end_time-start_time))/3600) INTO n,hours FROM public.schedule_sessions WHERE schedule_version_id=v AND instructor_id='48ee97d1-ed6f-4242-8da9-3df094150b75';
 IF n<>4 OR hours<>8 THEN RAISE EXCEPTION 'MARYAM_NOT_FOUR_SESSIONS_EIGHT_HOURS'; END IF;
 IF (SELECT count(*) FROM public.schedule_sessions WHERE schedule_version_id=v)<>341 THEN RAISE EXCEPTION 'SESSION_COUNT'; END IF;
 IF (SELECT count(*) FROM public.schedule_sessions WHERE schedule_version_id='7430bad7-2de7-5c90-9368-b214a199d6c3')<>339 THEN RAISE EXCEPTION 'BASELINE_CHANGED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.schedule_sessions s WHERE s.schedule_version_id=v AND s.instructor_id='3c1e2a05-d2bc-498f-8bd1-84fd5cf6f5af' AND s.delivery_group_id='7bb207c6-d02c-41d0-ad0c-9e2b88ca0ae4' AND s.day_of_week=2 AND s.start_time='12:00' AND s.end_time='14:00' AND s.room_id='d3f3d7bb-10a6-4682-b1b3-d7447314c7e3') THEN RAISE EXCEPTION 'YUSUF_WRONG'; END IF;
 IF NOT EXISTS(SELECT 1 FROM education_source_revision_private.sessions f JOIN public.schedule_sessions s ON s.id=f.session_id WHERE f.version_id=v AND f.source_session_id='4124d9b4-7367-4e2b-a742-29fa59b031ff' AND s.instructor_id='728e3cb5-920f-49ca-948d-76ed413701c3') THEN RAISE EXCEPTION 'AKRAM_LOST'; END IF;
 IF (SELECT expected_students FROM public.schedule_sessions WHERE schedule_version_id=v AND delivery_group_id='94776001-8c09-4907-8662-dc24b93114be')<>80 THEN RAISE EXCEPTION 'SHARED_CAPACITY'; END IF;
 IF (public.operational_delivery_group(v,'d183a739-2122-401c-9ecb-1de07213ae94')).active THEN RAISE EXCEPTION 'SHARED_MEMBER_DUPLICATED'; END IF;
 IF EXISTS(SELECT 1 FROM public.schedule_sessions s JOIN public.rooms r ON r.id=s.room_id WHERE s.schedule_version_id=v AND s.expected_students>r.capacity) THEN RAISE EXCEPTION 'ROOM_CAPACITY'; END IF;
 -- Prove sealed writes cannot alter an accepted session.
 BEGIN
 UPDATE public.schedule_sessions SET start_time='07:00' WHERE schedule_version_id=v AND delivery_group_id='268c3280-3f9b-43a3-91a8-51948b699e99';
 EXCEPTION WHEN check_violation THEN rejected:=true;
 END;
 IF NOT rejected THEN RAISE EXCEPTION 'SEAL_TAMPER_ACCEPTED'; END IF;
 IF has_table_privilege('authenticated','education_source_revision_private.additions','INSERT') OR has_function_privilege('authenticated','education_source_revision_private.create_term_completion()','EXECUTE') THEN RAISE EXCEPTION 'PRIVATE_ACCESS_LEAK'; END IF;
END;
$$;
