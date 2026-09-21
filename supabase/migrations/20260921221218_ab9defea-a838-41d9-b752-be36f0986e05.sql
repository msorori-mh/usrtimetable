DO $rev$
DECLARE
 c constant uuid:='8e4bcbb4-4a4c-40c7-a3aa-a53f68bae0bb';
 t constant uuid:='b69f5c5c-8754-4485-9c37-ebdcf6b39092';
 p constant uuid:='7a1c9b2e-5d34-4f18-9a6b-3c2f8e5d0001';
 d constant uuid:='7d2ffbc4-fee3-4ffc-a2c8-4819e5429fe6';
 old_ids constant uuid[]:=ARRAY[
  '369cf17c-66c4-449b-a52b-39116aff81cc','3ad9b69b-a075-4d5a-a605-443571a76129',
  '4d5bd3b8-144b-4e93-be38-83b5e5f7ed98','5f5f4419-6013-42c9-852a-f9c075a2ef13',
  '73fa5074-90f3-45f3-9668-2a3d8f620cad','8235be81-2c08-4a9b-ad00-ca6dce3a591c',
  'd7e9f5bd-72e2-4e29-8301-d450947ba7c5','f55bcc2b-adad-44f7-a47e-4615a8e46b1d']::uuid[];
 new_ids constant uuid[]:=ARRAY[
  'd5f3d7cc-6f01-48ac-874e-3a7cf2413a24','f3b92e2e-fb1b-4b36-8bd3-5ee023693a56',
  '629643e5-4674-4710-9cf2-ad4fd1edd56a','ed4e3ecb-c80d-4fea-a584-201fbe8f3737',
  '63eda38c-61ee-413c-a44e-1a78108bda8f','29df4a0f-408f-4b51-963c-d68d677c0d65',
  '8df9fd74-a495-4971-83b7-06731a09d433','f5697c82-d124-4ba1-a916-470345f7962c']::uuid[];
 before_hash text; after_hash text; n integer; mins integer; affected integer; i integer; r record;
 sid uuid; did uuid; odg uuid; total_updates integer:=0;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(9262,4);

 IF NOT EXISTS(SELECT 1 FROM public.schedule_versions WHERE id=p AND college_id=c AND academic_term_id=t AND status='published')
 OR NOT EXISTS(SELECT 1 FROM public.schedule_versions WHERE id=d AND college_id=c AND academic_term_id=t AND status='draft')
 THEN RAISE EXCEPTION 'REV_VERSION_STATE_CHANGED'; END IF;

 SELECT md5(coalesce(string_agg((to_jsonb(s)-'teaching_assignment_id'-'delivery_group_id')::text,'' ORDER BY s.id),'')),count(*)
 INTO before_hash,n FROM public.schedule_sessions s WHERE s.schedule_version_id IN(p,d);
 IF n<>122 THEN RAISE EXCEPTION 'REV_SESSION_SCOPE_DRIFT count=%',n; END IF;

 FOR r IN SELECT unnest(ARRAY[p,d]) version_id LOOP
  SELECT count(*),coalesce(sum(extract(epoch FROM(end_time-start_time))/60),0)::integer INTO n,mins
  FROM public.schedule_sessions WHERE schedule_version_id=r.version_id;
  IF n<>61 OR mins<>8040 THEN RAISE EXCEPTION 'REV_BASELINE_DRIFT version=% count=% minutes=%',r.version_id,n,mins; END IF;
 END LOOP;

 IF EXISTS(SELECT 1 FROM public.schedule_sessions WHERE schedule_version_id IN(p,d) AND teaching_assignment_id=ANY(old_ids))
 THEN RAISE EXCEPTION 'REV_OLD_REFS_PRESENT'; END IF;
 IF (SELECT count(*) FROM public.schedule_sessions WHERE schedule_version_id IN(p,d) AND teaching_assignment_id=ANY(new_ids))<>32
 THEN RAISE EXCEPTION 'REV_FORWARD_STATE_MISMATCH'; END IF;

 CREATE TEMP TABLE rev_map(old_id uuid, new_id uuid, old_group uuid, pub_session uuid, draft_session uuid) ON COMMIT DROP;

 FOR i IN 1..8 LOOP
  SELECT count(*),(array_agg(x.schedule_session_id))[1],(array_agg(x.delivery_group_id))[1]
  INTO n,sid,odg FROM public.existing_schedule_source_rows x
  WHERE x.teaching_assignment_id=old_ids[i] AND x.college_id=c AND x.term_id=t
    AND x.schedule_version_id=p AND x.schedule_session_id IS NOT NULL AND x.delivery_group_id IS NOT NULL;
  IF n<>1 THEN RAISE EXCEPTION 'REV_SOURCE_ROW_NOT_UNIQUE old=% count=%',old_ids[i],n; END IF;
  IF odg IS DISTINCT FROM (SELECT o.delivery_group_id FROM public.teaching_assignments o WHERE o.id=old_ids[i])
  THEN RAISE EXCEPTION 'REV_SOURCE_GROUP_MISMATCH old=%',old_ids[i]; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.schedule_sessions s WHERE s.id=sid AND s.schedule_version_id=p
    AND s.teaching_assignment_id=new_ids[i]) THEN RAISE EXCEPTION 'REV_PUB_SESSION_MISMATCH old=%',old_ids[i]; END IF;

  SELECT count(*),(array_agg(z.id))[1] INTO n,did
  FROM public.schedule_sessions z JOIN public.schedule_sessions s ON s.id=sid
  WHERE z.schedule_version_id=d AND z.teaching_assignment_id=new_ids[i]
    AND z.day_of_week=s.day_of_week AND z.start_time=s.start_time AND z.end_time=s.end_time
    AND z.room_id IS NOT DISTINCT FROM s.room_id AND z.instructor_id IS NOT DISTINCT FROM s.instructor_id;
  IF n<>1 THEN RAISE EXCEPTION 'REV_DRAFT_TWIN_NOT_UNIQUE old=% count=%',old_ids[i],n; END IF;

  INSERT INTO rev_map VALUES(old_ids[i],new_ids[i],odg,sid,did);
 END LOOP;

 IF (SELECT count(DISTINCT pub_session)+count(DISTINCT draft_session) FROM rev_map)<>16
 THEN RAISE EXCEPTION 'REV_SESSION_SET_NOT_DISTINCT'; END IF;

 IF (SELECT count(*) FROM public.time_slot_templates WHERE college_id=c AND is_active AND study_system='regular'
   AND start_time='08:00' AND end_time='14:00' AND slot_duration_minutes=60 AND day_of_week=ANY(ARRAY[0,1,2,3,4,6]))<>6
 OR (SELECT count(*) FROM public.time_slot_templates WHERE college_id=c AND is_active)<>6
 THEN RAISE EXCEPTION 'REV_TEMPLATE_STATE_MISMATCH'; END IF;

 EXECUTE 'ALTER TABLE public.schedule_sessions DISABLE TRIGGER trg_ss_lock_iud';
 EXECUTE 'ALTER TABLE public.schedule_sessions DISABLE TRIGGER trg_ss_updated';
 EXECUTE 'ALTER TABLE public.schedule_sessions DISABLE TRIGGER trg_ss_lifecycle_dependency_lock';
 EXECUTE 'ALTER TABLE public.schedule_sessions DISABLE TRIGGER trg_schedule_session_current_delivery_group';
 EXECUTE 'ALTER TABLE public.schedule_sessions DISABLE TRIGGER trg_ss_college';

 FOR r IN SELECT * FROM rev_map LOOP
  UPDATE public.schedule_sessions s SET teaching_assignment_id=r.old_id, delivery_group_id=r.old_group
   WHERE s.id IN (r.pub_session,r.draft_session) AND s.teaching_assignment_id=r.new_id;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>2 THEN RAISE EXCEPTION 'REV_UNEXPECTED_ROW_COUNT old=% rows=%',r.old_id,affected; END IF;
  total_updates:=total_updates+affected;
 END LOOP;
 IF total_updates<>16 THEN RAISE EXCEPTION 'REV_TOTAL_UPDATE_COUNT rows=%',total_updates; END IF;

 SET CONSTRAINTS ALL IMMEDIATE;
 EXECUTE 'ALTER TABLE public.schedule_sessions ENABLE TRIGGER trg_ss_college';
 EXECUTE 'ALTER TABLE public.schedule_sessions ENABLE TRIGGER trg_schedule_session_current_delivery_group';
 EXECUTE 'ALTER TABLE public.schedule_sessions ENABLE TRIGGER trg_ss_lifecycle_dependency_lock';
 EXECUTE 'ALTER TABLE public.schedule_sessions ENABLE TRIGGER trg_ss_updated';
 EXECUTE 'ALTER TABLE public.schedule_sessions ENABLE TRIGGER trg_ss_lock_iud';

 DELETE FROM public.time_slot_templates
  WHERE college_id=c AND is_active AND study_system='regular' AND start_time='08:00' AND end_time='14:00'
    AND slot_duration_minutes=60 AND day_of_week=ANY(ARRAY[0,1,2,3,4,6]);
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>6 THEN RAISE EXCEPTION 'REV_TEMPLATE_DELETE_COUNT rows=%',affected; END IF;

 SELECT md5(coalesce(string_agg((to_jsonb(s)-'teaching_assignment_id'-'delivery_group_id')::text,'' ORDER BY s.id),'')),count(*)
 INTO after_hash,n FROM public.schedule_sessions s WHERE s.schedule_version_id IN(p,d);
 IF n<>122 OR after_hash IS DISTINCT FROM before_hash THEN RAISE EXCEPTION 'REV_SESSION_INVARIANT_CHANGED'; END IF;

 FOR r IN SELECT unnest(ARRAY[p,d]) version_id LOOP
  SELECT count(*),coalesce(sum(extract(epoch FROM(end_time-start_time))/60),0)::integer INTO n,mins
  FROM public.schedule_sessions WHERE schedule_version_id=r.version_id;
  IF n<>61 OR mins<>8040 THEN RAISE EXCEPTION 'REV_POSTCHECK_FAILED version=% count=% minutes=%',r.version_id,n,mins; END IF;
  IF (SELECT count(*) FROM public.schedule_sessions WHERE schedule_version_id=r.version_id AND teaching_assignment_id=ANY(old_ids))<>8
  THEN RAISE EXCEPTION 'REV_RESTORE_COUNT_FAILED version=%',r.version_id; END IF;
  IF (SELECT count(*) FROM public.schedule_sessions WHERE schedule_version_id=r.version_id AND teaching_assignment_id=ANY(new_ids))<>8
  THEN RAISE EXCEPTION 'REV_REMAINING_NEW_COUNT_FAILED version=%',r.version_id; END IF;
 END LOOP;

 IF EXISTS(SELECT 1 FROM public.schedule_sessions s JOIN public.teaching_assignments o ON o.id=s.teaching_assignment_id
   WHERE s.schedule_version_id IN(p,d) AND s.delivery_group_id IS DISTINCT FROM o.delivery_group_id)
 THEN RAISE EXCEPTION 'REV_PAIR_MISMATCH'; END IF;

 IF EXISTS(SELECT 1 FROM public.time_slot_templates WHERE college_id=c AND is_active)
 THEN RAISE EXCEPTION 'REV_TEMPLATE_REMAINS'; END IF;
END $rev$;