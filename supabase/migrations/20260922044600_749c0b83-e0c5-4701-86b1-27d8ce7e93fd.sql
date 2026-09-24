DO $$
DECLARE v_cnt int; v_min int;
BEGIN
  PERFORM schedule_coordination_private.check_version('8c2ec388-568a-4bd8-b88c-1cbe7da5f787');
  SELECT count(*), COALESCE(SUM(EXTRACT(EPOCH FROM (end_time-start_time))/60),0)::int
    INTO v_cnt, v_min FROM public.schedule_sessions
   WHERE schedule_version_id='8c2ec388-568a-4bd8-b88c-1cbe7da5f787';
  IF v_cnt <> 64 OR v_min <> 8520 THEN RAISE EXCEPTION 'GATE_FAIL_TOTALS % %', v_cnt, v_min; END IF;
  RAISE NOTICE 'PUBLISH_GATE_PASS sessions=% minutes=%', v_cnt, v_min;
END $$;