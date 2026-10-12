-- Run after the migration inside BEGIN ... ROLLBACK. All synthetic data is TEST_ONLY.
DO $test$
DECLARE s uuid; c uuid; candidate record; payload jsonb; x jsonb; eid uuid; rid uuid; rid2 uuid;
BEGIN
  SELECT user_id INTO s FROM public.user_roles WHERE role='super_admin' LIMIT 1;
  IF s IS NULL THEN RAISE EXCEPTION 'test needs super-admin'; END IF;
  SELECT hp.identity_id,hp.academic_rank, w.college_id,ac.program_id,ac.term_id,ac.study_system,
    greatest(t.start_date,least((now() AT TIME ZONE 'Asia/Riyadh')::date,t.end_date)) work_date,
    CASE faculty_private.quota_applicability(hp.type_code,hp.employment_type) WHEN true THEN 'overload' WHEN false THEN 'contractual' END kind
  INTO candidate FROM faculty_private.home_profiles hp
  JOIN public.faculty_identity_links l ON l.identity_id=hp.identity_id
  JOIN public.v_instructor_delivery_workload w ON w.instructor_id=l.instructor_id
  JOIN public.academic_cohorts ac ON ac.id=w.cohort_id
  JOIN public.academic_terms t ON t.id=ac.term_id
  JOIN public.academic_programs p ON p.id=ac.program_id AND NOT p.is_archived
  WHERE w.standard_assigned_hours>0 AND ac.study_system IN ('regular','parallel')
    AND hp.academic_rank IN ('معيد','مدرس','محاضر','أستاذ مساعد','أستاذ مشارك','أستاذ','أستاذ دكتور')
    AND faculty_private.quota_applicability(hp.type_code,hp.employment_type) IS NOT NULL
    AND t.start_date <= (now() AT TIME ZONE 'Asia/Riyadh')::date
  LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'no suitable fixture'; END IF;
  c:=candidate.college_id;
  PERFORM set_config('request.jwt.claim.sub','',true);
  BEGIN
    PERFORM public.teaching_payroll(c,'read','{}');
    RAISE EXCEPTION 'anonymous unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  BEGIN
    PERFORM public.teaching_payroll(c,'read','{}');
    RAISE EXCEPTION 'non-admin unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub',s::text,true);
  IF has_function_privilege('anon','public.teaching_payroll(uuid,text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'anon execute privilege'; END IF;
  IF has_schema_privilege('authenticated','teaching_pay_private','USAGE') THEN RAISE EXCEPTION 'private schema exposed'; END IF;
  x:=public.teaching_payroll(c,'read',jsonb_build_object('term_id',candidate.term_id));
  IF jsonb_typeof(x->'instructors')<>'array' THEN RAISE EXCEPTION 'read contract'; END IF;
  payload:=jsonb_build_object('term_id',candidate.term_id,'identity_id',candidate.identity_id,'program_id',candidate.program_id,
    'kind',candidate.kind,'system',candidate.study_system,'work_date',candidate.work_date,'starts_at','08:00','ends_at','10:00',
    'actual_hours',2,'payable_hours',1.5,'approval_ref','TEST_ONLY actual teaching pay','certified',true);
  x:=public.teaching_payroll(c,'save_execution',payload); eid:=(x->>'id')::uuid;
  BEGIN
    PERFORM public.teaching_payroll(c,'save_execution',payload);
    RAISE EXCEPTION 'duplicate accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM='duplicate accepted' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.teaching_payroll(c,'approve',jsonb_build_object('id',eid));
    RAISE EXCEPTION 'missing rate accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM='missing rate accepted' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.teaching_payroll(c,'save_execution',payload||'{"starts_at":"10:00","ends_at":"11:00","payable_hours":3}'::jsonb);
    RAISE EXCEPTION 'invalid hours accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    PERFORM public.teaching_payroll(c,'save_execution',payload||'{"certified":false}'::jsonb);
    RAISE EXCEPTION 'uncertified accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM='uncertified accepted' THEN RAISE; END IF; END;
  x:=public.teaching_payroll(c,'save_rate',jsonb_build_object('rank',candidate.academic_rank,'kind',candidate.kind,'system',candidate.study_system,
    'effective_from',candidate.work_date-1,'hourly_rate',125.5,'currency','YER','decision_ref','TEST_ONLY rate'));
  rid:=(x->>'id')::uuid;
  BEGIN
    PERFORM public.teaching_payroll(c,'approve',jsonb_build_object('id',eid,'rate_id',gen_random_uuid()));
    RAISE EXCEPTION 'stale price accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM='stale price accepted' THEN RAISE; END IF; END;
  PERFORM public.teaching_payroll(c,'approve',jsonb_build_object('id',eid,'rate_id',rid));
  IF (SELECT amount FROM teaching_pay_private.executions WHERE id=eid)<>188.25 THEN RAISE EXCEPTION 'wrong amount'; END IF;
  BEGIN
    PERFORM public.teaching_payroll(c,'approve',jsonb_build_object('id',eid,'rate_id',rid));
    RAISE EXCEPTION 'second approval accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM='second approval accepted' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.teaching_payroll(c,'void',jsonb_build_object('id',eid,'reason','TEST_ONLY'));
    RAISE EXCEPTION 'approved void accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM='approved void accepted' THEN RAISE; END IF; END;
  x:=public.teaching_payroll(c,'save_rate',jsonb_build_object('rank',candidate.academic_rank,'kind',candidate.kind,'system',candidate.study_system,
    'effective_from',candidate.work_date,'hourly_rate',500,'currency','YER','decision_ref','TEST_ONLY changed rate'));
  rid2:=(x->>'id')::uuid;
  IF (SELECT amount FROM teaching_pay_private.executions WHERE id=eid)<>188.25 THEN RAISE EXCEPTION 'snapshot changed'; END IF;
  x:=public.teaching_payroll(c,'save_execution',payload||'{"starts_at":"10:00","ends_at":"12:00"}'::jsonb);
  PERFORM public.teaching_payroll(c,'void',jsonb_build_object('id',x->>'id','reason','TEST_ONLY correction'));
  IF NOT EXISTS(SELECT 1 FROM public.audit_logs WHERE entity='teaching_payroll' AND entity_id=eid AND action='teaching_pay_approve') THEN
    RAISE EXCEPTION 'audit missing'; END IF;
END
$test$;
