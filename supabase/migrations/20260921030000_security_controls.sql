BEGIN;
CREATE TABLE public.security_settings (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 require_admin_mfa boolean NOT NULL DEFAULT false
);
INSERT INTO public.security_settings(id) VALUES(true);
ALTER TABLE public.security_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.security_settings FROM PUBLIC, anon, authenticated;

CREATE TABLE public.security_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 created_at timestamptz NOT NULL DEFAULT now(),
 actor_id uuid,
 event text NOT NULL,
 severity text NOT NULL CHECK(severity IN ('info','warning','critical')),
 target_id text,
 details jsonb NOT NULL DEFAULT '{}'
);
ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.security_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.security_events TO authenticated;
GRANT SELECT, INSERT ON public.security_events TO service_role;
GRANT USAGE ON SEQUENCE public.security_events_id_seq TO service_role;
CREATE POLICY security_events_admin_read ON public.security_events FOR SELECT TO authenticated
 USING(public.is_super_admin(auth.uid()) AND auth.jwt()->>'aal'='aal2');
CREATE INDEX security_events_recent ON public.security_events(created_at DESC);

CREATE TABLE public.security_rate_buckets (
 actor_id uuid NOT NULL,
 action text NOT NULL,
 window_start timestamptz NOT NULL,
 attempts integer NOT NULL,
 PRIMARY KEY(actor_id, action)
);
ALTER TABLE public.security_rate_buckets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.security_rate_buckets FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.consume_security_limit(p_actor uuid, p_action text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n integer; cap integer; duration interval;
BEGIN
 CASE p_action
  WHEN 'password_change' THEN cap:=5; duration:=interval '15 minutes';
  WHEN 'user_admin' THEN cap:=20; duration:=interval '1 minute';
  ELSE RAISE EXCEPTION 'Unsupported security action';
 END CASE;
 IF p_actor IS NULL THEN RETURN false; END IF;
 INSERT INTO public.security_rate_buckets AS b(actor_id,action,window_start,attempts)
 VALUES(p_actor,p_action,clock_timestamp(),1)
 ON CONFLICT(actor_id,action) DO UPDATE SET
  attempts=CASE WHEN b.window_start+duration<=clock_timestamp() THEN 1 ELSE least(b.attempts+1,1000000) END,
  window_start=CASE WHEN b.window_start+duration<=clock_timestamp() THEN clock_timestamp() ELSE b.window_start END
 RETURNING attempts INTO n;
 IF n=cap+1 THEN
  INSERT INTO public.security_events(actor_id,event,severity,details)
  VALUES(p_actor,'rate_limit_exceeded','warning',jsonb_build_object('action',p_action));
 END IF;
 RETURN n<=cap;
END $$;
REVOKE ALL ON FUNCTION public.consume_security_limit(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.consume_security_limit(uuid,text) TO service_role;

CREATE FUNCTION public.security_session_valid()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM auth.users u JOIN auth.sessions s ON s.user_id=u.id
 WHERE u.id=auth.uid() AND s.id::text=auth.jwt()->>'session_id'
 AND (u.banned_until IS NULL OR u.banned_until<=now())
 AND (s.not_after IS NULL OR s.not_after>now()));
$$;
CREATE FUNCTION public.security_mfa_required()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid()
 AND role::text IN ('super_admin','college_admin'))
 AND ((SELECT require_admin_mfa FROM public.security_settings WHERE id)
 OR EXISTS(SELECT 1 FROM auth.mfa_factors WHERE user_id=auth.uid() AND status='verified'))
 AND coalesce(auth.jwt()->>'aal','aal1')<>'aal2';
$$;
CREATE FUNCTION public.security_access_status()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('session_valid',public.security_session_valid(),
 'mfa_required',public.security_mfa_required(),
 'password_required',public.password_change_required());
$$;
REVOKE ALL ON FUNCTION public.security_session_valid(),public.security_mfa_required(),public.security_access_status() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.security_session_valid(),public.security_mfa_required(),public.security_access_status() TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.enforce_initial_password_change()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RETURN; END IF;
 IF NOT public.security_session_valid() THEN RAISE SQLSTATE 'PT401' USING MESSAGE='SESSION_REVOKED'; END IF;
 IF trim(both '/' from coalesce(current_setting('request.path',true),'')) IN
 ('rpc/password_change_required','rpc/security_access_status') THEN RETURN; END IF;
 IF public.password_change_required() THEN RAISE SQLSTATE 'PT403' USING MESSAGE='PASSWORD_CHANGE_REQUIRED'; END IF;
 IF public.security_mfa_required() THEN RAISE SQLSTATE 'PT403' USING MESSAGE='MFA_REQUIRED'; END IF;
END $$;

-- Restrictive policies also protect paths outside the PostgREST pre-request hook.
DO $$ DECLARE t record; BEGIN
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public'
 AND tablename NOT IN ('security_settings','security_events','security_rate_buckets') LOOP
 EXECUTE format('CREATE POLICY security_mfa_ready ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.security_mfa_required())) WITH CHECK ((SELECT NOT public.security_mfa_required()))',t.tablename);
 END LOOP;
END $$;

CREATE FUNCTION public.capture_security_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.action IN ('user_created','user_disabled','user_enabled','password_reset_requested','initial_password_changed') THEN
 INSERT INTO public.security_events(actor_id,event,severity,target_id)
 VALUES(NEW.actor_id,NEW.action,CASE WHEN NEW.action='initial_password_changed' THEN 'info' ELSE 'warning' END,NEW.entity_id::text);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER security_audit_capture AFTER INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.capture_security_audit();

CREATE FUNCTION public.capture_security_membership()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r jsonb;
BEGIN
 r:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 INSERT INTO public.security_events(actor_id,event,severity,target_id,details)
 VALUES(auth.uid(),TG_TABLE_NAME||'_'||lower(TG_OP),'warning',r->>'user_id',
 jsonb_strip_nulls(jsonb_build_object('role',r->>'role','college_id',r->>'college_id')));
 RETURN NULL;
END $$;
CREATE TRIGGER security_role_capture AFTER INSERT OR UPDATE OR DELETE ON public.user_roles FOR EACH ROW EXECUTE FUNCTION public.capture_security_membership();
CREATE TRIGGER security_college_capture AFTER INSERT OR UPDATE OR DELETE ON public.user_colleges FOR EACH ROW EXECUTE FUNCTION public.capture_security_membership();
REVOKE ALL ON FUNCTION public.capture_security_audit(),public.capture_security_membership() FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.capture_auth_security_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r jsonb;
BEGIN
 r:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 INSERT INTO public.security_events(actor_id,event,severity,target_id,details)
 VALUES((r->>'user_id')::uuid,TG_TABLE_NAME||'_'||lower(TG_OP),
 CASE WHEN TG_TABLE_NAME='mfa_factors' THEN 'warning' ELSE 'info' END,r->>'id',
 CASE WHEN TG_TABLE_NAME='sessions' THEN jsonb_strip_nulls(jsonb_build_object('ip',r->>'ip','user_agent',left(r->>'user_agent',500)))
 ELSE jsonb_build_object('status',r->>'status','factor_type',r->>'factor_type') END);
 RETURN NULL;
END $$;
CREATE TRIGGER security_session_capture AFTER INSERT OR DELETE ON auth.sessions FOR EACH ROW EXECUTE FUNCTION public.capture_auth_security_event();
CREATE TRIGGER security_factor_capture AFTER INSERT OR DELETE OR UPDATE OF status ON auth.mfa_factors FOR EACH ROW EXECUTE FUNCTION public.capture_auth_security_event();
REVOKE ALL ON FUNCTION public.capture_auth_security_event() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.security_dashboard()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.security_session_valid() OR public.password_change_required() OR public.security_mfa_required() THEN
 RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('sessions',coalesce((SELECT jsonb_agg(x) FROM
 (SELECT s.id,s.created_at,s.user_agent,s.ip,s.id::text=auth.jwt()->>'session_id' AS current
 FROM auth.sessions s WHERE s.user_id=auth.uid() ORDER BY s.created_at DESC LIMIT 100) x),'[]'::jsonb),
 'events',CASE WHEN public.is_super_admin(auth.uid()) AND auth.jwt()->>'aal'='aal2' THEN
 coalesce((SELECT jsonb_agg(x) FROM (SELECT id,created_at,event,severity,actor_id,target_id,details FROM public.security_events ORDER BY id DESC LIMIT 100) x),'[]'::jsonb)
 ELSE '[]'::jsonb END);
END $$;
REVOKE ALL ON FUNCTION public.security_dashboard() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.security_dashboard() TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
