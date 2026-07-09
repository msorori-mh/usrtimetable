
DO $$
DECLARE
  t1 boolean := false;
  t2 boolean := false;
  t3 boolean := false;
  t4 boolean := false;
  t5 boolean := false;
  v_target uuid := '482af19b-0d44-4631-b80a-753f5ead4089';
  v_college uuid := '7168345f-cf9d-4789-b2ad-547abb687dc8';
  v_target_sess uuid := '57a7781c-f463-4212-8738-b76cae714f05';
  v_target_sess2 uuid := '86630e15-97c8-4222-aa60-37ea8540ec91';
  v_other_sess uuid := '4794a10a-a406-4a19-9780-8f744fb43167'; -- belongs to a90aa87e-...
  v_bogus_college uuid := '00000000-0000-0000-0000-000000000001';
BEGIN
  -- Test 1: session belongs to another version
  BEGIN
    INSERT INTO public.schedule_version_conflict_exceptions
      (college_id, schedule_version_id, conflict_code, session_id, related_session_id,
       approval_type, reason, source, status, approved_at)
    VALUES (v_college, v_target, 'instructor_conflict', v_other_sess, v_target_sess2,
            'test', 'test', 'rejection_test', 'approved', now());
  EXCEPTION WHEN OTHERS THEN t1 := true;
  END;

  -- Test 2: related session belongs to another version
  BEGIN
    INSERT INTO public.schedule_version_conflict_exceptions
      (college_id, schedule_version_id, conflict_code, session_id, related_session_id,
       approval_type, reason, source, status, approved_at)
    VALUES (v_college, v_target, 'instructor_conflict', v_target_sess, v_other_sess,
            'test', 'test', 'rejection_test', 'approved', now());
  EXCEPTION WHEN OTHERS THEN t2 := true;
  END;

  -- Test 3: same-session pair (CHECK constraint)
  BEGIN
    INSERT INTO public.schedule_version_conflict_exceptions
      (college_id, schedule_version_id, conflict_code, session_id, related_session_id,
       approval_type, reason, source, status, approved_at)
    VALUES (v_college, v_target, 'instructor_conflict', v_target_sess, v_target_sess,
            'test', 'test', 'rejection_test', 'approved', now());
  EXCEPTION WHEN OTHERS THEN t3 := true;
  END;

  -- Test 4: college mismatch
  BEGIN
    INSERT INTO public.schedule_version_conflict_exceptions
      (college_id, schedule_version_id, conflict_code, session_id, related_session_id,
       approval_type, reason, source, status, approved_at)
    VALUES (v_bogus_college, v_target, 'instructor_conflict', v_target_sess, v_target_sess2,
            'test', 'test', 'rejection_test', 'approved', now());
  EXCEPTION WHEN OTHERS THEN t4 := true;
  END;

  -- Test 5: duplicate normalized pair (unique index)
  BEGIN
    INSERT INTO public.schedule_version_conflict_exceptions
      (college_id, schedule_version_id, conflict_code, session_id, related_session_id,
       approval_type, reason, source, status, approved_at)
    VALUES (v_college, v_target, 'instructor_conflict', v_target_sess2, v_target_sess,
            'test', 'test', 'rejection_test', 'approved', now());
  EXCEPTION WHEN OTHERS THEN t5 := true;
  END;

  IF NOT (t1 AND t2 AND t3 AND t4 AND t5) THEN
    RAISE EXCEPTION 'rejection tests failed: t1=% t2=% t3=% t4=% t5=%', t1,t2,t3,t4,t5;
  END IF;
  RAISE NOTICE 'rejection tests: all 5 rejected as expected';
END $$;

-- Confirm no rejection_test rows were persisted
DO $$
DECLARE c int;
BEGIN
  SELECT count(*) INTO c FROM public.schedule_version_conflict_exceptions WHERE source='rejection_test';
  IF c <> 0 THEN RAISE EXCEPTION 'rejection test leaked % row(s)', c; END IF;
END $$;
