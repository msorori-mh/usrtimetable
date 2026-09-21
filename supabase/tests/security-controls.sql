BEGIN;

UPDATE public.security_settings SET require_admin_mfa=true;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub','716f0f62-26ad-4db5-b2cf-7a2e6c4daefa','aal','aal1','session_id',(SELECT id FROM auth.sessions WHERE user_id='716f0f62-26ad-4db5-b2cf-7a2e6c4daefa' LIMIT 1))::text,true);
SELECT set_config('request.path','/instructors',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF NOT public.security_session_valid() THEN RAISE EXCEPTION 'Session unexpectedly invalid'; END IF;
 IF NOT public.security_mfa_required() THEN RAISE EXCEPTION 'MFA bypass'; END IF;
 IF EXISTS(SELECT 1 FROM public.instructors) THEN RAISE EXCEPTION 'RLS MFA bypass'; END IF;
 BEGIN PERFORM public.enforce_initial_password_change(); RAISE EXCEPTION 'pre-request MFA bypass'; EXCEPTION WHEN SQLSTATE 'PT403' THEN NULL; END;
END $$;
SELECT set_config('request.path','/rpc/security_access_status',true);
SELECT public.enforce_initial_password_change();
SELECT set_config('request.jwt.claims',(current_setting('request.jwt.claims')::jsonb||'{"aal":"aal2"}')::text,true);
DO $$ BEGIN
 IF public.security_mfa_required() THEN RAISE EXCEPTION 'AAL2 unexpectedly blocked'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.instructors) THEN RAISE EXCEPTION 'AAL2 RLS denied'; END IF;
 BEGIN UPDATE public.security_events SET event='tampered'; RAISE EXCEPTION 'Audit mutable'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claims',(current_setting('request.jwt.claims')::jsonb||'{"session_id":"00000000-0000-0000-0000-000000000000"}')::text,true);
DO $$ BEGIN
 IF public.security_session_valid() THEN RAISE EXCEPTION 'Revoked session accepted'; END IF;
 BEGIN PERFORM public.enforce_initial_password_change(); RAISE EXCEPTION 'Revoked session bypass'; EXCEPTION WHEN SQLSTATE 'PT401' THEN NULL; END;
END $$;
RESET ROLE;
DO $$ DECLARE i integer; BEGIN
 FOR i IN 1..5 LOOP
 IF NOT public.consume_security_limit('00000000-0000-4000-8000-000000000055','password_change') THEN RAISE EXCEPTION 'Early throttle'; END IF;
 END LOOP;
 IF public.consume_security_limit('00000000-0000-4000-8000-000000000055','password_change') THEN RAISE EXCEPTION 'Limit bypass'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.security_events WHERE event='rate_limit_exceeded') THEN RAISE EXCEPTION 'Missing alert'; END IF;
END $$;

ROLLBACK;
