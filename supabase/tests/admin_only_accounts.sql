-- Run after migration. TEST_ONLY inserts never persist.
BEGIN;
DO $test$
DECLARE rid uuid; role_name text; rejected boolean; before_count bigint;
BEGIN
 SELECT count(*) INTO before_count FROM auth.users;
 FOREACH role_name IN ARRAY ARRAY['','read_only','super_admin'] LOOP
  rejected:=false;
  BEGIN
   INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data)
   VALUES(gen_random_uuid(),'test-only-public-block@test-only.invalid',jsonb_build_object('full_name','TEST_ONLY public signup','provisioning_role',role_name,'app_metadata',jsonb_build_object('provisioning_role',role_name)),'{"provider":"email"}');
  EXCEPTION WHEN insufficient_privilege THEN
   IF SQLERRM<>'ACCOUNT_CREATION_ADMIN_ONLY' THEN RAISE; END IF;
   rejected:=true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Public signup accepted'; END IF;
 END LOOP;
 FOREACH role_name IN ARRAY ARRAY['super_admin','college_admin','read_only','institutional_viewer','university_leadership'] LOOP
  rid:=gen_random_uuid();
  INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data)
  VALUES(rid,'test-only-admin-'||rid||'@test-only.invalid','{"full_name":"TEST_ONLY admin provision"}',jsonb_build_object('provider','email','provisioning_role',role_name));
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=rid) THEN RAISE EXCEPTION 'Admin provision failed'; END IF;
  IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=rid AND (raw_app_meta_data->>'must_change_password')::boolean=(role_name<>'super_admin')) THEN RAISE EXCEPTION 'Password onboarding mismatch'; END IF;
 END LOOP;
 IF (SELECT count(*) FROM auth.users)<>before_count+5 THEN RAISE EXCEPTION 'Unexpected count'; END IF;
END;
$test$;
ROLLBACK;
