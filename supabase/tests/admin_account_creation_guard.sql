-- Run after migrations; all fixture accounts and effects roll back.
-- H-2: account creation requires a consumed single-use provisioning grant; only
-- raw_app_meta_data is trusted; every app_role value can be provisioned.
BEGIN;
-- Seed a super admin directly (bootstrap is an operator action).
ALTER TABLE auth.users DISABLE TRIGGER USER;
INSERT INTO auth.users(id,email) VALUES('00000000-0000-0000-0000-0000000005a1','guard-sa@example.invalid');
ALTER TABLE auth.users ENABLE TRIGGER USER;
INSERT INTO public.user_roles(user_id,role) VALUES('00000000-0000-0000-0000-0000000005a1','super_admin') ON CONFLICT DO NOTHING;
DO $test$
DECLARE uid uuid; role_name text; rejected boolean; v_email text; v_nonce text;
  v_admin constant uuid := '00000000-0000-0000-0000-0000000005a1';
BEGIN
 -- Every real role can be provisioned with a grant (nonce and role in app_metadata).
 FOREACH role_name IN ARRAY enum_range(NULL::public.app_role)::text[] LOOP
  uid:=gen_random_uuid(); v_email:='rollback-'||uid||'@example.invalid';
  SELECT nonce INTO v_nonce FROM public.issue_account_provisioning_grant(v_email, role_name, v_admin);
  INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
  VALUES(uid,v_email,'{"provider":"email"}','{"full_name":"Rollback diagnostic"}');
  UPDATE auth.users SET raw_app_meta_data=raw_app_meta_data||jsonb_build_object('provisioning_role',role_name,'provisioning_nonce',v_nonce) WHERE id=uid;
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  -- grant must be consumed exactly once
  IF NOT EXISTS (SELECT 1 FROM provisioning_private.account_provisioning_grants
                 WHERE email_normalized=v_email AND consumed_user_id=uid) THEN
   RAISE EXCEPTION 'Grant for % not consumed', role_name;
  END IF;
 END LOOP;
 -- Untrusted user metadata must never authorize account creation.
 FOREACH role_name IN ARRAY ARRAY['super_admin','university_leadership',''] LOOP
  rejected:=false;
  BEGIN
   uid:=gen_random_uuid();
   INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
   VALUES(uid,'rollback-'||uid||'@example.invalid','{}',jsonb_build_object('provisioning_role',role_name));
   SET CONSTRAINTS ALL IMMEDIATE;
  EXCEPTION WHEN insufficient_privilege THEN
   IF SQLERRM <> 'ACCOUNT_CREATION_ADMIN_ONLY' THEN RAISE; END IF;
   rejected:=true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Untrusted creation incorrectly accepted'; END IF;
  SET CONSTRAINTS ALL DEFERRED;
 END LOOP;
 -- app_metadata role without a grant is rejected too.
 rejected:=false;
 BEGIN
  uid:=gen_random_uuid();
  INSERT INTO auth.users(id,email,raw_app_meta_data)
  VALUES(uid,'rollback-'||uid||'@example.invalid','{"provisioning_role":"college_admin"}');
  SET CONSTRAINTS ALL IMMEDIATE;
 EXCEPTION WHEN insufficient_privilege THEN rejected:=true;
 END;
 IF NOT rejected THEN RAISE EXCEPTION 'Grantless app_metadata creation incorrectly accepted'; END IF;
 SET CONSTRAINTS ALL DEFERRED;
END $test$;
ROLLBACK;
