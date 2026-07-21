-- SOURCE ONLY — NOT APPLIED — DRAFT pending A1.3b remediation + APPROVE_DB_MIGRATION_APPLY
-- =============================================================================
-- A1.3c — Legacy write hardening (DB level), DRAFT.
--
-- Blocks new writes to the Legacy tables `sections` and `course_offering_sections`
-- at the database layer, independently of any client behavior (A1.3a already
-- blocks the UI/import-client paths).
--
-- APPLY ORDER (mandatory):
--   1) A1.3b orphan remediation (174 TA + 5 COS) executed and verified under
--      APPROVE_LEGACY_DATA_REMEDIATION.
--   2) Only then this migration, under APPROVE_DB_MIGRATION_APPLY.
-- This migration performs NO data mutation, NO backfill, NO deletion; it adds
-- triggers and revokes grants only.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) Blocking trigger function.
--    Rejects INSERT/UPDATE/DELETE on Legacy tables with a clear, coded message.
--    Why a trigger (not grants alone): SECURITY DEFINER RPCs (e.g. the historical
--    import dispatcher) execute as the function owner and would bypass plain
--    grant revokes; a row trigger fires for every role.
--
--    Maintenance/history allowlist: writes are permitted only inside an explicit
--    operator maintenance window, opened by setting the transaction-local GUC
--    `app.legacy_write_allow = 'on'` (SET LOCAL) in a direct SQL session by an
--    approved operator. PostgREST roles (anon/authenticated) cannot set custom
--    GUCs through the API, so the New Flow can never open this window.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.legacy_write_blocked()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_setting('app.legacy_write_allow', true) = 'on' THEN
    -- Explicit operator maintenance window (A1.3b-class procedures only).
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'LEGACY_WRITE_BLOCKED: % is a Legacy table; new writes are blocked (A1.3c). Historical data remains readable.', TG_TABLE_NAME
    USING ERRCODE = '42501';
END;
$$;

COMMENT ON FUNCTION public.legacy_write_blocked() IS
  'A1.3c: rejects INSERT/UPDATE/DELETE on Legacy tables unless the transaction-local GUC app.legacy_write_allow=on is set by an approved operator maintenance window.';

-- -----------------------------------------------------------------------------
-- 2) Triggers on the Legacy tables.
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS legacy_write_block ON public.sections;
CREATE TRIGGER legacy_write_block
  BEFORE INSERT OR UPDATE OR DELETE ON public.sections
  FOR EACH ROW
  EXECUTE FUNCTION public.legacy_write_blocked();

DROP TRIGGER IF EXISTS legacy_write_block ON public.course_offering_sections;
CREATE TRIGGER legacy_write_block
  BEFORE INSERT OR UPDATE OR DELETE ON public.course_offering_sections
  FOR EACH ROW
  EXECUTE FUNCTION public.legacy_write_blocked();

-- -----------------------------------------------------------------------------
-- 3) Belt-and-suspenders grant hardening for PostgREST roles.
--    SELECT remains granted: historical data stays readable (reports, audits).
-- -----------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON public.sections FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.course_offering_sections FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4) Documented follow-ups (NOT part of this draft, applied in later approved
--    migrations):
--    a) Replace the historical import apply helpers
--       (_import_apply_sections, _import_apply_section_groups,
--        _import_apply_teaching_assignments V1 branch) with versions that raise
--       LEGACY_WRITE_BLOCKED, copying their exact signatures from
--       20260718210000_source_only_atomic_import_job_commit.sql.
--    b) Optional: extend the same trigger to section_groups /
--       section_group_members once their remediation is designed.
--    c) Optional: deny schedule_sessions.section_id writes once the builder /
--       greedy / clone propagation paths are remediated (see A1 inventory
--       write-paths #7 and #8).
-- -----------------------------------------------------------------------------

COMMIT;
