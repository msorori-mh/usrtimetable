DO $$
DECLARE
  v_version uuid := '8c2ec388-568a-4bd8-b88c-1cbe7da5f787';
  v_college uuid := '8e4bcbb4-4a4c-40c7-a3aa-a53f68bae0bb';
  v_actor uuid := '716f0f62-26ad-4db5-b2cf-7a2e6c4daefa';
  v_pairs uuid[][] := ARRAY[
    ARRAY['0ae8de50-19bf-43e7-9384-0125e4af16e6'::uuid,'228a233a-c044-4d7d-b92e-81ed3d00d22f'::uuid],
    ARRAY['5b2b2d88-59dc-49e5-9e12-92fa8745e134'::uuid,'c35dc582-8429-4a2d-8d35-84c079b4c2d5'::uuid],
    ARRAY['444b19ba-9295-48f2-b2da-d283636290ed'::uuid,'a0bb657f-3831-43b3-aab4-76cf72c12aa6'::uuid],
    ARRAY['0f4cc9f3-6d5c-414d-ae62-4ada9c7ff96b'::uuid,'d6009f01-abaf-476b-87b8-e5a324bc29a8'::uuid]
  ];
  i int;
  a uuid; b uuid;
  v_cnt int;
BEGIN
  PERFORM pg_advisory_xact_lock(9262, 95);

  -- preflight: sessions must belong to the target draft version
  FOR i IN 1..4 LOOP
    a := v_pairs[i][1]; b := v_pairs[i][2];
    IF (SELECT count(*) FROM public.schedule_sessions s
        WHERE s.id IN (a,b) AND s.schedule_version_id = v_version) <> 2 THEN
      RAISE EXCEPTION 'GATE_FAIL_SESSION_SCOPE pair %', i;
    END IF;
  END LOOP;

  IF (SELECT status FROM public.schedule_versions WHERE id = v_version) <> 'draft' THEN
    RAISE EXCEPTION 'GATE_FAIL_NOT_DRAFT';
  END IF;

  FOR i IN 1..4 LOOP
    a := v_pairs[i][1]; b := v_pairs[i][2];
    IF NOT EXISTS (
      SELECT 1 FROM public.schedule_version_conflict_exceptions e
      WHERE e.schedule_version_id = v_version
        AND e.conflict_code = 'delivery_group_conflict'
        AND e.status = 'approved'
        AND e.related_session_id IS NOT NULL
        AND LEAST(e.session_id, e.related_session_id) = LEAST(a,b)
        AND GREATEST(e.session_id, e.related_session_id) = GREATEST(a,b)
    ) THEN
      INSERT INTO public.schedule_version_conflict_exceptions
        (college_id, schedule_version_id, conflict_code, session_id, related_session_id,
         approval_type, reason, source, status, approved_by, approved_at, metadata)
      VALUES (
        v_college, v_version, 'delivery_group_conflict', LEAST(a,b), GREATEST(a,b),
        'source_file_literal_match',
        'مطابقة حرفية لملف جدول المستوى الرابع المعتمد',
        'user_authorized_version_scoped_exception',
        'approved', v_actor, now(),
        jsonb_build_object(
          'scope','schedule_version_only',
          'level','L4',
          'decision_owner', v_actor,
          'student_counts','source_as_is_not_invented'
        )
      );
    END IF;
  END LOOP;

  SELECT count(*) INTO v_cnt FROM public.schedule_version_conflict_exceptions
   WHERE schedule_version_id = v_version AND status='approved'
     AND conflict_code='delivery_group_conflict';
  IF v_cnt <> 4 THEN RAISE EXCEPTION 'GATE_FAIL_EXCEPTION_COUNT %', v_cnt; END IF;

  SELECT count(*) INTO v_cnt FROM public.schedule_sessions WHERE schedule_version_id = v_version;
  IF v_cnt <> 64 THEN RAISE EXCEPTION 'GATE_FAIL_SESSION_COUNT %', v_cnt; END IF;

  SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (end_time - start_time))/60),0)::int INTO v_cnt
    FROM public.schedule_sessions WHERE schedule_version_id = v_version;
  IF v_cnt <> 8520 THEN RAISE EXCEPTION 'GATE_FAIL_MINUTES %', v_cnt; END IF;

  RAISE NOTICE 'OK exceptions=4 sessions=64 minutes=8520';
END $$;