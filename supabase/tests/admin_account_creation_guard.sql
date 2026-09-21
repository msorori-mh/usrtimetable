-- Run after migrations; all fixture accounts and effects roll back.
BEGIN;
DO $test$
DECLARE uid uuid; role_name text; rejected boolean;
BEGIN
 FOREACH role_name IN ARRAY ARRAY['super_admin','college_admin','read_only','institutional_viewer','university_leadership'] LOOP
  uid:=gen_random_uuid();
  INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
  VALUES(uid,'rollback-'||uid||'@example.invalid','{"provider":"email"}','{"full_name":"Rollback diagnostic"}');
  UPDATE auth.users SET raw_app_meta_data=raw_app_meta_data||jsonb_build_object('provisioning_role',role_name) WHERE id=uid;
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
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
END $test$;
ROLLBACK;
