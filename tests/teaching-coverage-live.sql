-- Run with migrations in a transaction ending ROLLBACK. Read-only fixture checks.
DO $test$
DECLARE s uuid; c record; r record; data jsonb; cats jsonb; contracts jsonb; expected numeric; actual numeric; u record; allowed boolean; n integer:=0;
BEGIN
 SELECT user_id INTO s FROM public.user_roles WHERE role='super_admin' ORDER BY user_id LIMIT 1;
 IF s IS NULL THEN RAISE EXCEPTION 'Missing authorized admin'; END IF;
 PERFORM set_config('request.jwt.claim.sub',s::text,true);
 FOR c IN SELECT co.id college_id,t.id term_id FROM public.colleges co
 JOIN LATERAL(SELECT id FROM public.academic_terms WHERE college_id=co.id ORDER BY is_active DESC,start_date DESC NULLS LAST,id LIMIT 1)t ON true
 WHERE co.name !~* 'TEST_ONLY|اختبار' LOOP
  data:=public.get_teaching_coverage_report(c.college_id,c.term_id);
  cats:=public.get_faculty_reporting_categories(c.college_id);
  SELECT coalesce(sum(standard_assigned_hours),0) INTO expected FROM public.v_instructor_delivery_workload WHERE college_id=c.college_id AND term_id=c.term_id;
  SELECT coalesce(sum((v->>'hours')::numeric),0) INTO actual FROM jsonb_array_elements(data->'rows')v;
  IF abs(expected-actual)>0.001 THEN RAISE EXCEPTION 'Coverage canonical mismatch'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(data->'rows')v JOIN jsonb_array_elements(cats->'rows')h ON h->>'identity_id'=v->>'identity_id' WHERE h->>'category' IS DISTINCT FROM v->>'category') THEN RAISE EXCEPTION 'Directory classification mismatch'; END IF;
  contracts:=public.get_system_hours_report(c.college_id,c.term_id,'contractual');
  SELECT coalesce(sum((v->>'regular')::numeric+(v->>'parallel')::numeric+(v->>'unknown')::numeric),0) INTO expected FROM jsonb_array_elements(contracts->'rows')v WHERE NOT (v->>'allocation_pending')::boolean AND NOT (v->>'classification_pending')::boolean;
  SELECT coalesce(sum((v->>'hours')::numeric),0) INTO actual FROM jsonb_array_elements(data->'rows')v WHERE v->>'category'='contractual' AND NOT (v->>'allocation_pending')::boolean;
  IF abs(expected-actual)>0.001 THEN RAISE EXCEPTION 'Contract report mismatch'; END IF;
  n:=n+1;
 END LOOP;
 IF n=0 THEN RAISE EXCEPTION 'No college scopes tested'; END IF;
 FOR u IN SELECT DISTINCT user_id FROM public.user_roles LOOP
  PERFORM set_config('request.jwt.claim.sub',u.user_id::text,true);
  SELECT id INTO s FROM public.colleges WHERE public.can_view_college(u.user_id,id) ORDER BY id LIMIT 1;
  IF s IS NULL THEN CONTINUE; END IF;
  allowed:=public.has_role(u.user_id,'super_admin') OR public.has_role(u.user_id,'institutional_viewer');
  IF allowed THEN
   data:=public.teaching_payroll(s,'read','{}');
   IF NOT data ? 'rates' THEN RAISE EXCEPTION 'Missing permitted payroll report'; END IF;
  ELSE
   BEGIN PERFORM public.teaching_payroll(s,'read','{}'); RAISE EXCEPTION 'Unauthorized payroll read permitted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
   BEGIN PERFORM public.teaching_payroll(s,'save_rate','{}'); RAISE EXCEPTION 'Unauthorized rate mutation permitted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END IF;
  -- All readers retain exact college boundaries for both new RPCs.
  FOR c IN SELECT co.id college_id,t.id term_id FROM public.colleges co JOIN LATERAL(SELECT id FROM public.academic_terms WHERE college_id=co.id LIMIT 1)t ON true LOOP
   IF public.can_view_college(u.user_id,c.college_id) IS TRUE THEN
    PERFORM public.get_teaching_coverage_report(c.college_id,c.term_id);
    PERFORM public.get_faculty_reporting_categories(c.college_id);
   ELSE
    BEGIN PERFORM public.get_teaching_coverage_report(c.college_id,c.term_id);RAISE EXCEPTION 'Coverage scope leak';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
    BEGIN PERFORM public.get_faculty_reporting_categories(c.college_id);RAISE EXCEPTION 'Category scope leak';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
   END IF;
  END LOOP;
 END LOOP;
 PERFORM set_config('request.jwt.claim.sub','',true);
 SELECT id INTO s FROM public.colleges LIMIT 1;
 BEGIN PERFORM public.get_faculty_reporting_categories(s);RAISE EXCEPTION 'Anonymous categories permitted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 IF has_function_privilege('anon','public.get_teaching_coverage_report(uuid,uuid)','EXECUTE') OR has_function_privilege('anon','public.get_faculty_reporting_categories(uuid)','EXECUTE') OR has_function_privilege('anon','public.teaching_payroll(uuid,text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Anonymous execute grant'; END IF;
END $test$;
SELECT 'PASS: canonical totals, contract totals, directory categories, real role scope and payroll denial' AS result,
 (SELECT count(*) FROM public.teaching_assignments) assignments,(SELECT count(*) FROM public.schedule_sessions) sessions;
