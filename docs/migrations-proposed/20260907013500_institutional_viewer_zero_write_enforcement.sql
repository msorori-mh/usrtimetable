-- SOURCE_ONLY_INSTITUTIONAL_VIEWER_RBAC_01 — proposed migration 3 of 3
-- STATUS: NOT APPLIED. File-of-record for review only. When approved, this SQL
-- must be submitted through the platform migration tool (it writes the real
-- supabase/migrations file); do not hand-copy it into supabase/migrations.
--
-- Approved decisions implemented here:
--   (1) institutional_viewer must reach ZERO writes, including audit_logs INSERT.
--       Migration 2 already denies audit_logs INSERT at the RLS policy level;
--       this file adds a trigger-level guard so SECURITY DEFINER RPCs (which
--       bypass RLS) cannot write on behalf of an institutional_viewer actor.
--   (2) institutional_viewer may execute ONLY RPCs proven side-effect free.
--       Verified read-only (no INSERT/UPDATE/DELETE anywhere in the body,
--       authorised through can_view_college):
--         - public.resolve_scheduling_headcount(uuid, uuid, uuid, uuid, uuid)
--         - public.list_scheduling_headcount_revisions(uuid)
--       Every other volatile public RPC is gated by can_manage_college,
--       is_super_admin, or import_manager_actor (which itself calls
--       can_manage_college) and therefore already denies the role, because
--       can_manage_college is intentionally NOT widened. Postgres EXECUTE
--       grants cannot distinguish app roles inside `authenticated`, so the
--       deny side is enforced by the guard below instead of by GRANT.
--       public.validate_schedule_session_move is read-only but stays denied by
--       design: its own gate is can_manage_college and that gate is unchanged.
--       public.lock_delivery_group_for_assignment has no `authenticated`
--       EXECUTE grant at all and stays that way.
--
-- can_manage_college is NOT modified by this migration.

-- 1. Generic zero-write guard -------------------------------------------------
CREATE OR REPLACE FUNCTION public.deny_institutional_viewer_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  -- Service-role, migration, and background contexts have no auth.uid() and
  -- are unaffected.
  IF v_uid IS NOT NULL AND public.is_institutional_viewer(v_uid) THEN
    RAISE EXCEPTION 'INSTITUTIONAL_VIEWER_IS_READ_ONLY: % on %.% is not permitted for this role',
      TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.deny_institutional_viewer_write() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.deny_institutional_viewer_write() TO service_role;

-- 2. Attach the guard to every persistent base table in the public schema -----
--    Idempotent: the trigger is dropped and recreated per table.
DO $do$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relpersistence = 'p'
    ORDER BY c.relname
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_deny_institutional_viewer_write ON public.%I',
      r.relname
    );
    EXECUTE format(
      'CREATE TRIGGER trg_deny_institutional_viewer_write '
      || 'BEFORE INSERT OR UPDATE OR DELETE ON public.%I '
      || 'FOR EACH ROW EXECUTE FUNCTION public.deny_institutional_viewer_write()',
      r.relname
    );
  END LOOP;
END
$do$;

-- 3. RPC surface: keep anon out; keep the two proven read-only RPCs reachable -
REVOKE ALL ON FUNCTION public.resolve_scheduling_headcount(uuid, uuid, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_scheduling_headcount(uuid, uuid, uuid, uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.list_scheduling_headcount_revisions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_scheduling_headcount_revisions(uuid) TO authenticated, service_role;

-- ROLLBACK ------------------------------------------------------------------
-- DO $do$ DECLARE r record; BEGIN
--   FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--            WHERE n.nspname = 'public' AND c.relkind = 'r' LOOP
--     EXECUTE format('DROP TRIGGER IF EXISTS trg_deny_institutional_viewer_write ON public.%I', r.relname);
--   END LOOP;
-- END $do$;
-- DROP FUNCTION IF EXISTS public.deny_institutional_viewer_write();
