-- SOURCE-ONLY / NOT APPLIED: first-class data_classification on schedule_versions.
-- Do not apply automatically. This migration performs no Legacy data rewrites and no
-- Operational backfill. Controlled apply only after explicit APPROVE_DB_MIGRATION_APPLY.
--
-- Spec notes:
--   * Do NOT auto-classify existing rows as Operational.
--   * Targeted Demo backfill for the delivery-demo version is NOT applied in this mission.
--   * Protected accepted schedule version id: 835e50fe-3ad2-4232-8c15-0f403c668a7f
--     (must remain untouched by any data UPDATE in this file).
--
-- import_runs: table does not exist in the current public schema / generated types.
-- Skip import_runs column addition (see comment block at end).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Nullable classification column (DEFAULT NULL — no Operational conversion).
-- ---------------------------------------------------------------------------
ALTER TABLE public.schedule_versions
  ADD COLUMN IF NOT EXISTS data_classification text DEFAULT NULL;

COMMENT ON COLUMN public.schedule_versions.data_classification IS
  'Data classification: test | demo | operational | archived. NULL = unclassified (transition). Never auto-set to operational by this migration. Demo backfill of current delivery-demo version is intentionally NOT applied here.';

ALTER TABLE public.schedule_versions
  DROP CONSTRAINT IF EXISTS schedule_versions_data_classification_check;

ALTER TABLE public.schedule_versions
  ADD CONSTRAINT schedule_versions_data_classification_check
  CHECK (
    data_classification IS NULL
    OR data_classification IN ('test', 'demo', 'operational', 'archived')
  );

-- ---------------------------------------------------------------------------
-- 2) Fail-closed: only super_admin may set or change data_classification.
--    No PUBLIC/anon grants. Fixed search_path. No data UPDATEs.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_data_classification_super_admin_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.data_classification IS NOT NULL AND NOT public.is_super_admin(auth.uid()) THEN
      RAISE EXCEPTION 'DATA_CLASSIFICATION_SUPER_ADMIN_REQUIRED' USING ERRCODE = '42501';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.data_classification IS DISTINCT FROM OLD.data_classification
       AND NOT public.is_super_admin(auth.uid()) THEN
      RAISE EXCEPTION 'DATA_CLASSIFICATION_SUPER_ADMIN_REQUIRED' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sv_data_classification_super_admin ON public.schedule_versions;
CREATE TRIGGER trg_sv_data_classification_super_admin
  BEFORE INSERT OR UPDATE OF data_classification ON public.schedule_versions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_data_classification_super_admin_only();

REVOKE ALL ON FUNCTION public.enforce_data_classification_super_admin_only() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) import_runs — SKIPPED
-- ---------------------------------------------------------------------------
-- public.import_runs does not exist in current schema / src/integrations/supabase/types.ts.
-- When that table is introduced, add a follow-up source-only migration for:
--   ALTER TABLE public.import_runs
--     ADD COLUMN IF NOT EXISTS data_classification text DEFAULT NULL;
--   with the same CHECK and super_admin enforcement pattern.
-- Do not invent the table here.

COMMIT;
