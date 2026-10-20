-- Rollback for H-2: restores the previous (insecure) guard, issuer and
-- handle_new_user definitions. The grant table is kept (it pre-existed).
ALTER TABLE provisioning_private.account_provisioning_grants DROP CONSTRAINT IF EXISTS grant_role_allowed;
ALTER TABLE provisioning_private.account_provisioning_grants
  ADD CONSTRAINT grant_role_allowed CHECK (provisioning_role IN
    ('super_admin','college_admin','read_only','institutional_viewer','university_leadership')) NOT VALID;

CREATE OR REPLACE FUNCTION public.issue_account_provisioning_grant(p_email text, p_role text, p_created_by uuid)
 RETURNS TABLE(grant_id uuid, nonce text, expires_at timestamp with time zone)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_email text := lower(btrim(coalesce(p_email, '')));
BEGIN
  IF v_email = '' OR p_created_by IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PROVISIONING_GRANT_INVALID_INPUT';
  END IF;
  IF coalesce(p_role, '') NOT IN
     ('super_admin','college_admin','read_only','institutional_viewer','university_leadership') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PROVISIONING_GRANT_ROLE_NOT_ALLOWED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = p_created_by AND ur.role = 'super_admin'::public.app_role) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PROVISIONING_GRANT_REQUIRES_SUPER_ADMIN';
  END IF;
  DELETE FROM provisioning_private.account_provisioning_grants g
   WHERE g.email_normalized = v_email AND g.consumed_at IS NULL AND g.expires_at <= now();
  RETURN QUERY
  INSERT INTO provisioning_private.account_provisioning_grants
    (email_normalized, provisioning_role, created_by, expires_at)
  VALUES (v_email, p_role, p_created_by, now() + interval '60 seconds')
  RETURNING account_provisioning_grants.id, account_provisioning_grants.nonce, account_provisioning_grants.expires_at;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_admin_account_creation()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_email text; v_meta_role text; v_meta_nonce text; v_granted_role text;
BEGIN
  SELECT u.email,
         coalesce(u.raw_app_meta_data->>'provisioning_role', u.raw_user_meta_data->>'provisioning_role'),
         coalesce(u.raw_app_meta_data->>'provisioning_nonce', u.raw_user_meta_data->>'provisioning_nonce')
    INTO v_email, v_meta_role, v_meta_nonce
  FROM auth.users u WHERE u.id = NEW.id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_granted_role := provisioning_private.consume_grant(v_email, NEW.id, v_meta_nonce);
  IF v_granted_role IS NOT NULL THEN
    IF v_meta_role IS NOT NULL AND v_meta_role <> v_granted_role THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ACCOUNT_CREATION_ADMIN_ONLY';
    END IF;
    RETURN NULL;
  END IF;
  IF coalesce(v_meta_role, '') NOT IN
     ('super_admin','college_admin','read_only','institutional_viewer','university_leadership') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ACCOUNT_CREATION_ADMIN_ONLY';
  END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE sa_count INT;
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)))
  ON CONFLICT (id) DO NOTHING;
  SELECT COUNT(*) INTO sa_count FROM public.user_roles WHERE role = 'super_admin';
  IF sa_count = 0 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'super_admin') ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'read_only') ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;
