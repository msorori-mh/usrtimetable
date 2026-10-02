-- TEST_ONLY: pure JSON fixtures; no timetable records are written.
DO $test$
DECLARE
 sid uuid:='00000000-0000-0000-0000-000000000001';
 g1 uuid:='00000000-0000-0000-0000-000000000011';
 cid uuid:='00000000-0000-0000-0000-000000000021';
 members jsonb:='[
 {"delivery_group_id":"00000000-0000-0000-0000-000000000011","cohort_id":"00000000-0000-0000-0000-000000000021","partition_id":"00000000-0000-0000-0000-000000000031","partition_headcount":31,"expected_students":31},
 {"delivery_group_id":"00000000-0000-0000-0000-000000000012","cohort_id":"00000000-0000-0000-0000-000000000021","partition_id":"00000000-0000-0000-0000-000000000032","partition_headcount":31,"expected_students":31},
 {"delivery_group_id":"00000000-0000-0000-0000-000000000013","cohort_id":"00000000-0000-0000-0000-000000000021","partition_id":"00000000-0000-0000-0000-000000000031","partition_headcount":31,"expected_students":62},
 {"delivery_group_id":"00000000-0000-0000-0000-000000000013","cohort_id":"00000000-0000-0000-0000-000000000021","partition_id":"00000000-0000-0000-0000-000000000032","partition_headcount":31,"expected_students":62}
 ]';
 rows jsonb:='[
 {"id":"00000000-0000-0000-0000-000000000041","delivery_group_id":"00000000-0000-0000-0000-000000000013","cohort_id":"00000000-0000-0000-0000-000000000021","kind":"theory","hours":2},
 {"id":"00000000-0000-0000-0000-000000000042","delivery_group_id":"00000000-0000-0000-0000-000000000012","cohort_id":"00000000-0000-0000-0000-000000000021","kind":"practical","hours":2},
 {"id":"00000000-0000-0000-0000-000000000043","delivery_group_id":"00000000-0000-0000-0000-000000000011","cohort_id":"00000000-0000-0000-0000-000000000021","kind":"practical","hours":2}
 ]';
 result jsonb; inherited jsonb;
BEGIN
 result:=public._ss_partition_daily_hours(sid,g1,cid,'practical',2,2,6,6,6,members,rows);
 IF result<>'[]'::jsonb THEN RAISE EXCEPTION 'independent_group_overcount: %',result; END IF;
 result:=public._ss_partition_daily_hours(sid,g1,cid,'practical',2,3,6,6,6,members,rows);
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(result) c WHERE c->>'code'='student_daily_hours') THEN
  RAISE EXCEPTION 'real_seven_hours_not_blocked: %',result; END IF;
 result:=public._ss_partition_daily_hours(sid,'00000000-0000-0000-0000-000000000012',cid,'theory',2,3,6,6,6,members,rows);
 IF result='[]'::jsonb THEN RAISE EXCEPTION 'shared_lecture_missing'; END IF;
 result:=public._ss_partition_daily_hours(sid,g1,cid,'practical',2,2,8,6,3,members,rows);
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(result) c WHERE c->>'code'='student_daily_practical_hours') THEN
  RAISE EXCEPTION 'practical_cap_missing'; END IF;
 result:=public._ss_partition_daily_hours(sid,g1,cid,'theory',2,2,8,3,8,members,rows);
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(result) c WHERE c->>'code'='student_daily_theory_hours') THEN
  RAISE EXCEPTION 'theory_cap_missing'; END IF;
 result:=public._ss_partition_daily_hours(sid,g1,cid,'practical',2,2,6,6,6,'[]',rows);
 IF result='[]'::jsonb THEN RAISE EXCEPTION 'unknown_students_allowed'; END IF;
 result:=public._ss_partition_daily_hours(sid,g1,cid,'practical',2,2,6,6,6,members-'x',rows||
  '[{"id":"00000000-0000-0000-0000-000000000044","delivery_group_id":null,"cohort_id":"00000000-0000-0000-0000-000000000021","kind":"theory","hours":2}]'::jsonb);
 IF result='[]'::jsonb THEN RAISE EXCEPTION 'missing_peer_mapping_allowed'; END IF;
 result:=public._ss_partition_daily_hours(sid,g1,cid,'practical',2,2,6,6,6,
  jsonb_set(members,'{0,partition_headcount}','30'),rows);
 IF result='[]'::jsonb THEN RAISE EXCEPTION 'incomplete_coverage_allowed'; END IF;
 result:=public._ss_partition_daily_hours(sid,g1,cid,'practical',2,2,6,6,6,
  members||jsonb_build_array(members->0),rows);
 IF result='[]'::jsonb THEN RAISE EXCEPTION 'duplicate_partition_allowed'; END IF;
 inherited:=jsonb_set(rows,'{2,id}',to_jsonb(sid::text));
 inherited:=jsonb_set(inherited,'{2,hours}','6');
 result:=public._ss_partition_daily_hours(sid,g1,cid,'practical',2,6,6,6,6,members,inherited);
 IF result<>'[]'::jsonb THEN RAISE EXCEPTION 'unchanged_inherited_load_blocked: %',result; END IF;
 result:=public._ss_partition_daily_hours(sid,g1,cid,'practical',2,7,6,6,6,members,inherited);
 IF result='[]'::jsonb THEN RAISE EXCEPTION 'inherited_load_increase_allowed'; END IF;
 RAISE NOTICE 'PASS: 11 partition daily-hour regression checks';
END $test$;
