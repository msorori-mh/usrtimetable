BEGIN;
INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data) VALUES
('a4210000-0000-4000-8000-000000000001','test-only-security-viewer@test-only.invalid','{"full_name":"TEST_ONLY security viewer"}','{"provisioning_role":"read_only"}'),
('a4210000-0000-4000-8000-000000000002','test-only-security-manager@test-only.invalid','{"full_name":"TEST_ONLY security manager"}','{"provisioning_role":"college_admin"}');
UPDATE auth.users SET raw_app_meta_data=raw_app_meta_data||'{"must_change_password":false}'::jsonb WHERE id IN('a4210000-0000-4000-8000-000000000001','a4210000-0000-4000-8000-000000000002');
UPDATE public.user_roles SET role='college_admin' WHERE user_id='a4210000-0000-4000-8000-000000000002';
INSERT INTO public.user_colleges(user_id,college_id) VALUES
('a4210000-0000-4000-8000-000000000001','7168345f-cf9d-4789-b2ad-547abb687dc8'),
('a4210000-0000-4000-8000-000000000002','7168345f-cf9d-4789-b2ad-547abb687dc8');
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM 1 FROM public.instructors LIMIT 1; RAISE EXCEPTION 'ANON_READ_ALLOWED'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public._import_apply_academic_structure(NULL,'departments','insert','[]'); RAISE EXCEPTION 'ANON_HELPER_ALLOWED'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF public.resolve_report_verification('a4210000-0000-4000-8000-000000000099')->>'available'<>'false' THEN RAISE EXCEPTION 'QR contract changed'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"a4210000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","iat":1790000000}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE n integer; BEGIN
 IF (SELECT count(*) FROM public.colleges)<>1 THEN RAISE EXCEPTION 'Viewer college isolation failed'; END IF;
 UPDATE public.rooms SET name=name; GET DIAGNOSTICS n=ROW_COUNT; IF n<>0 THEN RAISE EXCEPTION 'Viewer wrote rooms'; END IF;
 BEGIN INSERT INTO public.user_roles(user_id,role) VALUES(auth.uid(),'super_admin'); RAISE EXCEPTION 'ROLE_ESCALATION'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public._import_apply_academic_structure(NULL,'departments','insert','[]'); RAISE EXCEPTION 'VIEWER_HELPER_ALLOWED'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.seed_college_instructor_types(NULL); RAISE EXCEPTION 'VIEWER_SEED_ALLOWED'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF EXISTS(SELECT 1 FROM public.rooms WHERE college_id<>'7168345f-cf9d-4789-b2ad-547abb687dc8') THEN RAISE EXCEPTION 'Viewer cross-college read'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"a4210000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","iat":1790000000}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE n integer; BEGIN
 IF NOT public.can_manage_college(auth.uid(),'7168345f-cf9d-4789-b2ad-547abb687dc8') THEN RAISE EXCEPTION 'Manager denied own college'; END IF;
 IF public.can_manage_college(auth.uid(),'d78cf264-3a76-43a1-8601-4d6def12b400') THEN RAISE EXCEPTION 'Manager cross-college write allowed'; END IF;
 UPDATE public.rooms SET name=name WHERE college_id='d78cf264-3a76-43a1-8601-4d6def12b400'; GET DIAGNOSTICS n=ROW_COUNT; IF n<>0 THEN RAISE EXCEPTION 'Manager wrote foreign rooms'; END IF;
END $$;
RESET ROLE;
ROLLBACK;

