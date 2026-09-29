-- Run after migration DDL inside its open transaction; always rolls back.
CREATE TEMP TABLE jawf_revision_test_result AS SELECT jawf_revision_private.prepare_withdrawals('aeb571c59efcef43e6172017c4e2a321','f2230633fe95308d454930fdb99af3c5') result;
DO $test$ DECLARE vid uuid; sid uuid; BEGIN
 SELECT (result->>'version_id')::uuid INTO vid FROM jawf_revision_test_result;
 SELECT id INTO sid FROM public.schedule_sessions WHERE schedule_version_id=vid LIMIT 1;
 IF has_function_privilege('authenticated','jawf_revision_private.prepare_withdrawals(text,text)','execute')
 OR has_function_privilege('anon','jawf_revision_private.prepare_withdrawals(text,text)','execute') THEN RAISE EXCEPTION 'TEST_PRIVILEGE_LEAK'; END IF;
 BEGIN
 UPDATE public.schedule_sessions SET start_time=start_time+interval '1 hour' WHERE id=sid;
 RAISE EXCEPTION 'TEST_CHANGED_COPY_ACCEPTED';
 EXCEPTION WHEN check_violation THEN
 IF SQLERRM<>'JAWF_REVISION_SEALED' THEN RAISE; END IF;
 END;
 BEGIN
 DELETE FROM public.schedule_sessions WHERE id=sid;
 RAISE EXCEPTION 'TEST_DELETE_COPY_ACCEPTED';
 EXCEPTION WHEN check_violation THEN
 IF SQLERRM<>'JAWF_REVISION_SEALED' THEN RAISE; END IF;
 END;
 IF (SELECT md5(jsonb_agg(to_jsonb(s) ORDER BY id)::text) FROM public.schedule_sessions s WHERE schedule_version_id='286e37d4-d45c-5942-b8e0-facdfed3081f')<>'aeb571c59efcef43e6172017c4e2a321'
 OR (SELECT md5(jsonb_agg(to_jsonb(s) ORDER BY id)::text) FROM public.existing_schedule_source_rows s WHERE schedule_version_id='286e37d4-d45c-5942-b8e0-facdfed3081f')<>'f2230633fe95308d454930fdb99af3c5'
 THEN RAISE EXCEPTION 'TEST_PUBLISHED_HISTORY_MUTATED'; END IF;
 IF (SELECT status FROM public.schedule_versions WHERE id='286e37d4-d45c-5942-b8e0-facdfed3081f')<>'published' THEN RAISE EXCEPTION 'TEST_PUBLISHED_STATUS_CHANGED'; END IF;
END; $test$;
SET CONSTRAINTS ALL IMMEDIATE;
SELECT result, 'history preserved; sealed copies reject edits/deletes; operator-only preparation' AS verification FROM jawf_revision_test_result;
ROLLBACK;
