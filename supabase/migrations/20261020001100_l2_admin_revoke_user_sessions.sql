-- L-2: server-side session revocation for a user (used after disabling an
-- account, removing roles, or an admin password reset). Deletes the user's
-- refresh tokens and sessions so existing logins cannot be refreshed.
-- Works whether or not the GoTrue tables exist (to_regclass). service_role only.
CREATE OR REPLACE FUNCTION public.admin_revoke_user_sessions(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'USER_ID_REQUIRED';
  END IF;

  -- refresh_tokens.user_id is varchar in GoTrue; compare as text.
  IF to_regclass('auth.refresh_tokens') IS NOT NULL THEN
    EXECUTE 'DELETE FROM auth.refresh_tokens WHERE user_id::text = $1::text' USING p_user_id;
  END IF;
  IF to_regclass('auth.sessions') IS NOT NULL THEN
    EXECUTE 'DELETE FROM auth.sessions WHERE user_id = $1' USING p_user_id;
  END IF;
END
$function$;
REVOKE ALL ON FUNCTION public.admin_revoke_user_sessions(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_revoke_user_sessions(uuid) TO service_role;
