-- M-6: role/membership changes and schedule version status changes/deletes are
-- written to audit_logs by database triggers with actor and db role.
BEGIN;
-- the membership rate limiter depends on security_rate_buckets, which the local
-- replay lacks (production-only); it is unrelated to auditing.
ALTER TABLE public.user_roles DISABLE TRIGGER trg_user_roles_rate_limit;
ALTER TABLE public.user_colleges DISABLE TRIGGER trg_user_colleges_rate_limit;
ALTER TABLE auth.users DISABLE TRIGGER USER;
INSERT INTO auth.users (id, email) VALUES
  ('00000010-0000-0000-0000-000000000001', 'm6-actor@example.invalid'),
  ('00000010-0000-0000-0000-000000000002', 'm6-target@example.invalid');
ALTER TABLE auth.users ENABLE TRIGGER USER;
INSERT INTO public.user_roles (user_id, role) VALUES ('00000010-0000-0000-0000-000000000001', 'super_admin');
INSERT INTO public.universities (id, name) VALUES ('00000010-0000-0000-0000-0000000000f0', 'M6 U');
INSERT INTO public.colleges (id, university_id, name) VALUES ('00000010-0000-0000-0000-0000000000c1', '00000010-0000-0000-0000-0000000000f0', 'M6');
INSERT INTO public.academic_terms (id, college_id, name, code) VALUES ('00000010-0000-0000-0000-0000000000d1', '00000010-0000-0000-0000-0000000000c1', 'T', 'T');
INSERT INTO public.schedule_versions (id, college_id, academic_term_id, name) VALUES
  ('00000010-0000-0000-0000-0000000000e1', '00000010-0000-0000-0000-0000000000c1', '00000010-0000-0000-0000-0000000000d1', 'v1'),
  ('00000010-0000-0000-0000-0000000000e2', '00000010-0000-0000-0000-0000000000c1', '00000010-0000-0000-0000-0000000000d1', 'v2');

SELECT set_config('request.jwt.claim.sub', '00000010-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
DELETE FROM public.audit_logs WHERE details->>'source' = 'db_trigger';

INSERT INTO public.user_roles (user_id, role) VALUES ('00000010-0000-0000-0000-000000000002', 'college_admin');
UPDATE public.user_roles SET role = 'read_only' WHERE user_id = '00000010-0000-0000-0000-000000000002';
DELETE FROM public.user_roles WHERE user_id = '00000010-0000-0000-0000-000000000002';
INSERT INTO public.user_colleges (user_id, college_id) VALUES ('00000010-0000-0000-0000-000000000002', '00000010-0000-0000-0000-0000000000c1');
DELETE FROM public.user_colleges WHERE user_id = '00000010-0000-0000-0000-000000000002';
UPDATE public.schedule_versions SET status = 'review' WHERE id = '00000010-0000-0000-0000-0000000000e1';
UPDATE public.schedule_versions SET name = 'renamed' WHERE id = '00000010-0000-0000-0000-0000000000e1';
DELETE FROM public.schedule_versions WHERE id = '00000010-0000-0000-0000-0000000000e2';

DO $$
DECLARE r record; v_missing text := '';
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('user_roles_insert', 'user_roles'), ('user_roles_update', 'user_roles'), ('user_roles_delete', 'user_roles'),
    ('user_colleges_insert', 'user_colleges'), ('user_colleges_delete', 'user_colleges'),
    ('schedule_version_status_changed', 'schedule_versions'), ('schedule_version_deleted', 'schedule_versions')) t(a, e)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.audit_logs l
                    WHERE l.action = r.a AND l.entity = r.e AND l.details->>'source' = 'db_trigger'
                      AND l.actor_id = '00000010-0000-0000-0000-000000000001'
                      AND l.details->>'db_role' = 'authenticated') THEN
      v_missing := v_missing || r.a || ' ';
    END IF;
  END LOOP;
  IF v_missing <> '' THEN RAISE EXCEPTION 'M-6: missing audit rows: %', v_missing; END IF;
  IF (SELECT count(*) FROM public.audit_logs WHERE action = 'schedule_version_status_changed'
        AND entity_id = '00000010-0000-0000-0000-0000000000e1') <> 1 THEN
    RAISE EXCEPTION 'M-6: non-status update was audited as a status change (or status change missing)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE action = 'schedule_version_status_changed'
        AND details->'old'->>'status' = 'draft' AND details->'new'->>'status' = 'review') THEN
    RAISE EXCEPTION 'M-6: status change details missing';
  END IF;
END $$;

-- service-role path (no end user): actor NULL, db_role service_role
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);
INSERT INTO public.user_roles (user_id, role) VALUES ('00000010-0000-0000-0000-000000000002', 'college_dean');
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE action = 'user_roles_insert' AND actor_id IS NULL
                   AND details->>'db_role' = 'service_role'
                   AND entity_id = '00000010-0000-0000-0000-000000000002') THEN
    RAISE EXCEPTION 'M-6: service-role change not audited';
  END IF;
END $$;
ROLLBACK;
