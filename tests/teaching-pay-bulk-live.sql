-- Synthetic rates are used only inside BEGIN ... ROLLBACK, never a committed migration.
DO $test$
DECLARE u record; c uuid; p jsonb; r jsonb; before_n bigint; after_n bigint;
BEGIN
 SELECT id INTO c FROM public.colleges WHERE name !~* 'TEST_ONLY|اختبار' ORDER BY id LIMIT 1;
 SELECT user_id INTO u FROM public.user_roles WHERE role='institutional_viewer' ORDER BY user_id LIMIT 1;
 IF u.user_id IS NULL THEN SELECT user_id INTO u FROM public.user_roles WHERE role='super_admin' ORDER BY user_id LIMIT 1; END IF;
 PERFORM set_config('request.jwt.claim.sub',u.user_id::text,true);
 p:=jsonb_build_object('rank','معيد','kind','all','system','all','effective_from','2199-01-01','hourly_rate',1,'currency','YER','decision_ref','TEST_ONLY bulk rate transaction rollback');
 SELECT count(*) INTO before_n FROM teaching_pay_private.rates;
 r:=public.save_teaching_pay_rates(c,p);
 IF (r->>'count')::int<>4 THEN RAISE EXCEPTION 'Expected four rates'; END IF;
 r:=public.save_teaching_pay_rates(c,p||'{"system":"regular","effective_from":"2199-01-02"}'::jsonb);
 IF (r->>'count')::int<>2 THEN RAISE EXCEPTION 'Expected two rates'; END IF;
 r:=public.save_teaching_pay_rates(c,p||'{"kind":"contractual","system":"parallel","effective_from":"2199-01-03"}'::jsonb);
 IF (r->>'count')::int<>1 THEN RAISE EXCEPTION 'Expected one rate'; END IF;
 SELECT count(*) INTO after_n FROM teaching_pay_private.rates;
 IF after_n-before_n<>7 THEN RAISE EXCEPTION 'Incorrect expansion'; END IF;
 BEGIN
  PERFORM public.save_teaching_pay_rates(c,p||'{"effective_from":"2199-01-03"}'::jsonb);
  RAISE EXCEPTION 'Duplicate accepted';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 IF (SELECT count(*) FROM teaching_pay_private.rates)<>after_n THEN RAISE EXCEPTION 'Partial rate batch survived'; END IF;
 FOR u IN SELECT DISTINCT user_id FROM public.user_roles WHERE NOT public.has_role(user_id,'super_admin') AND NOT public.has_role(user_id,'institutional_viewer') LOOP
  PERFORM set_config('request.jwt.claim.sub',u.user_id::text,true);
  BEGIN PERFORM public.save_teaching_pay_rates(c,p);RAISE EXCEPTION 'Unauthorized bulk rates accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 END LOOP;
END $test$;
SELECT 'PASS: 4/2/1 rate expansion, atomic duplicate rollback and restricted roles' result;
