-- H-2: provisioning guard and handle_new_user.
--  * user_metadata (self-signup controlled) never authorizes creation, even with
--    a valid nonce in it
--  * app_metadata role must match the granted role; wrong nonce rejected
--  * a grant is consumed once (replay rejected)
--  * college_dean is provisionable
--  * no implicit super_admin for the first account
BEGIN;
ALTER TABLE auth.users DISABLE TRIGGER USER;
INSERT INTO auth.users(id,email) VALUES('00000000-0000-0000-0000-0000000005b1','prov-sa@example.invalid');
ALTER TABLE auth.users ENABLE TRIGGER USER;
INSERT INTO public.user_roles(user_id,role) VALUES('00000000-0000-0000-0000-0000000005b1','super_admin') ON CONFLICT DO NOTHING;

CREATE FUNCTION pg_temp.try_create(p_email text, p_app jsonb, p_user jsonb) RETURNS boolean
LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN
    INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
    VALUES(gen_random_uuid(), p_email, p_app, p_user);
    SET CONSTRAINTS ALL IMMEDIATE;
    SET CONSTRAINTS ALL DEFERRED;
    RETURN true;
  EXCEPTION WHEN insufficient_privilege THEN
    SET CONSTRAINTS ALL DEFERRED;
    RETURN false;
  END;
END $f$;

DO $t$
DECLARE v_admin constant uuid := '00000000-0000-0000-0000-0000000005b1'; n text; g record;
BEGIN
  -- nonce only in user_metadata: the email still has a grant, but the guard
  -- consumes by email + app nonce (NULL -> any) -- so put a WRONG nonce in app.
  SELECT * INTO g FROM public.issue_account_provisioning_grant('p1@example.invalid','college_admin',v_admin);
  IF pg_temp.try_create('p1@example.invalid', '{"provisioning_nonce":"bad"}',
       jsonb_build_object('provisioning_role','college_admin','provisioning_nonce',g.nonce)) THEN
    RAISE EXCEPTION 'H-2: user_metadata nonce accepted over wrong app nonce';
  END IF;
  PERFORM public.revoke_account_provisioning_grant(g.grant_id);

  -- role mismatch between app_metadata and grant
  SELECT * INTO g FROM public.issue_account_provisioning_grant('p2@example.invalid','read_only',v_admin);
  IF pg_temp.try_create('p2@example.invalid',
       jsonb_build_object('provisioning_role','super_admin','provisioning_nonce',g.nonce), '{}') THEN
    RAISE EXCEPTION 'H-2: role mismatch accepted';
  END IF;
  PERFORM public.revoke_account_provisioning_grant(g.grant_id);

  -- self-signup with user_metadata only, no grant
  IF pg_temp.try_create('p3@example.invalid', '{}', '{"provisioning_role":"super_admin"}') THEN
    RAISE EXCEPTION 'H-2: grantless self-signup accepted';
  END IF;

  -- college_dean provisionable; replay rejected
  SELECT * INTO g FROM public.issue_account_provisioning_grant('p4@example.invalid','college_dean',v_admin);
  IF NOT pg_temp.try_create('p4@example.invalid',
       jsonb_build_object('provisioning_role','college_dean','provisioning_nonce',g.nonce), '{}') THEN
    RAISE EXCEPTION 'H-2: college_dean grant rejected';
  END IF;
  IF pg_temp.try_create('p4b@example.invalid',
       jsonb_build_object('provisioning_role','college_dean','provisioning_nonce',g.nonce), '{}') THEN
    RAISE EXCEPTION 'H-2: consumed grant replayed';
  END IF;
END $t$;

-- First account in a database without super admins must not become super_admin.
DELETE FROM public.user_roles WHERE role = 'super_admin';
ALTER TABLE auth.users DISABLE TRIGGER admin_only_account_creation;
INSERT INTO auth.users(id,email) VALUES('00000000-0000-0000-0000-0000000005b2','first@example.invalid');
ALTER TABLE auth.users ENABLE TRIGGER admin_only_account_creation;
DO $t$
BEGIN
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id='00000000-0000-0000-0000-0000000005b2' AND role='super_admin') THEN
    RAISE EXCEPTION 'H-2: first account auto-promoted to super_admin';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id='00000000-0000-0000-0000-0000000005b2' AND role='read_only') THEN
    RAISE EXCEPTION 'H-2: new account missing default read_only role';
  END IF;
END $t$;
ROLLBACK;
