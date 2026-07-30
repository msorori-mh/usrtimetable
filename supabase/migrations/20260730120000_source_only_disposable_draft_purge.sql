-- SOURCE-ONLY / NOT APPLIED: disposable draft schedule version marker + atomic purge RPC.
-- Do not apply automatically. This migration performs no publication or operational data writes.
-- Controlled apply only after explicit APPROVE_DB_MIGRATION_APPLY.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Explicit disposable-test marker (no safe existing metadata field found).
-- ---------------------------------------------------------------------------
ALTER TABLE public.schedule_versions
  ADD COLUMN IF NOT EXISTS disposable_test boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.schedule_versions.disposable_test IS
  'When true, marks a draft schedule version as an explicitly disposable test clone eligible for purge_disposable_draft_schedule_version. Default false — normal clones are never purgable via that RPC.';

-- Only super_admin may set or flip disposable_test.
CREATE OR REPLACE FUNCTION public.enforce_disposable_test_super_admin_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.disposable_test IS TRUE AND NOT public.is_super_admin(auth.uid()) THEN
      RAISE EXCEPTION 'DISPOSABLE_TEST_SUPER_ADMIN_REQUIRED' USING ERRCODE = '42501';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.disposable_test IS DISTINCT FROM OLD.disposable_test
       AND NOT public.is_super_admin(auth.uid()) THEN
      RAISE EXCEPTION 'DISPOSABLE_TEST_SUPER_ADMIN_REQUIRED' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sv_disposable_test_super_admin ON public.schedule_versions;
CREATE TRIGGER trg_sv_disposable_test_super_admin
  BEFORE INSERT OR UPDATE OF disposable_test ON public.schedule_versions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_disposable_test_super_admin_only();

REVOKE ALL ON FUNCTION public.enforce_disposable_test_super_admin_only() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2) Atomic fail-closed purge for explicitly marked disposable drafts only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_disposable_draft_schedule_version(
  p_version_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_protected uuid := '835e50fe-3ad2-4232-8c15-0f403c668a7f'::uuid;
  v_college_id uuid;
  v_status text;
  v_disposable boolean;
  v_sessions integer := 0;
  v_events integer := 0;
  v_conflict_checks integer := 0;
  v_conflict_results integer := 0;
  v_exceptions integer := 0;
  v_quality_runs integer := 0;
  v_auto_runs integer := 0;
  v_versions integer := 0;
  v_cross_college integer := 0;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING ERRCODE = '42501';
  END IF;

  -- Fail closed: college_admin / read_only / any non-super_admin are rejected.
  IF NOT public.is_super_admin(v_actor) THEN
    RAISE EXCEPTION 'PURGE_SUPER_ADMIN_REQUIRED' USING ERRCODE = '42501';
  END IF;

  IF p_version_id IS NULL THEN
    RAISE EXCEPTION 'PURGE_VERSION_ID_REQUIRED' USING ERRCODE = '22023';
  END IF;

  -- Hard guard: accepted production version is never purgeable.
  IF p_version_id = v_protected THEN
    RAISE EXCEPTION 'PURGE_PROTECTED_VERSION' USING ERRCODE = '42501';
  END IF;

  -- Serialize purge for this version id.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_version_id::text, 9175));

  SELECT college_id, status, disposable_test
    INTO v_college_id, v_status, v_disposable
  FROM public.schedule_versions
  WHERE id = p_version_id
  FOR UPDATE;

  -- Idempotent re-call: version already gone → no additional deletes.
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'purged', false,
      'already_absent', true,
      'version_id', p_version_id,
      'counts', jsonb_build_object(
        'schedule_versions', 0,
        'schedule_sessions', 0,
        'schedule_version_events', 0,
        'conflict_checks', 0,
        'conflict_results', 0,
        'schedule_version_conflict_exceptions', 0,
        'schedule_quality_runs', 0,
        'auto_schedule_runs', 0
      )
    );
  END IF;

  IF v_disposable IS NOT TRUE THEN
    RAISE EXCEPTION 'PURGE_NOT_DISPOSABLE' USING ERRCODE = '42501';
  END IF;

  -- Only draft. approved/published/archived/review are rejected.
  IF v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'PURGE_STATUS_NOT_DRAFT' USING ERRCODE = '42501';
  END IF;

  IF v_status IN ('approved', 'published', 'archived') THEN
    RAISE EXCEPTION 'PURGE_STATUS_IMMUTABLE' USING ERRCODE = '42501';
  END IF;

  -- Tenant-scoped dependent inventory (fail closed on cross-college rows).
  SELECT COUNT(*)::integer INTO v_cross_college
  FROM (
    SELECT 1 FROM public.schedule_sessions
      WHERE schedule_version_id = p_version_id AND college_id IS DISTINCT FROM v_college_id
    UNION ALL
    SELECT 1 FROM public.schedule_version_events
      WHERE schedule_version_id = p_version_id AND college_id IS DISTINCT FROM v_college_id
    UNION ALL
    SELECT 1 FROM public.conflict_checks
      WHERE schedule_version_id = p_version_id AND college_id IS DISTINCT FROM v_college_id
    UNION ALL
    SELECT 1 FROM public.schedule_version_conflict_exceptions
      WHERE schedule_version_id = p_version_id AND college_id IS DISTINCT FROM v_college_id
    UNION ALL
    SELECT 1 FROM public.schedule_quality_runs
      WHERE schedule_version_id = p_version_id AND college_id IS DISTINCT FROM v_college_id
    UNION ALL
    SELECT 1 FROM public.auto_schedule_runs
      WHERE schedule_version_id = p_version_id AND college_id IS DISTINCT FROM v_college_id
  ) bad;
  IF v_cross_college > 0 THEN
    RAISE EXCEPTION 'PURGE_CROSS_COLLEGE_DEPENDENT' USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*)::integer INTO v_sessions
    FROM public.schedule_sessions
    WHERE schedule_version_id = p_version_id AND college_id = v_college_id;
  SELECT COUNT(*)::integer INTO v_events
    FROM public.schedule_version_events
    WHERE schedule_version_id = p_version_id AND college_id = v_college_id;
  SELECT COUNT(*)::integer INTO v_conflict_checks
    FROM public.conflict_checks
    WHERE schedule_version_id = p_version_id AND college_id = v_college_id;
  SELECT COUNT(*)::integer INTO v_conflict_results
    FROM public.conflict_results cr
    WHERE cr.conflict_check_id IN (
      SELECT id FROM public.conflict_checks
      WHERE schedule_version_id = p_version_id AND college_id = v_college_id
    );
  SELECT COUNT(*)::integer INTO v_exceptions
    FROM public.schedule_version_conflict_exceptions
    WHERE schedule_version_id = p_version_id AND college_id = v_college_id;
  SELECT COUNT(*)::integer INTO v_quality_runs
    FROM public.schedule_quality_runs
    WHERE schedule_version_id = p_version_id AND college_id = v_college_id;
  SELECT COUNT(*)::integer INTO v_auto_runs
    FROM public.auto_schedule_runs
    WHERE schedule_version_id = p_version_id AND college_id = v_college_id;

  -- Explicit deletes (quality_runs has no FK CASCADE). Single transaction = atomic rollback.
  DELETE FROM public.schedule_quality_runs
    WHERE schedule_version_id = p_version_id AND college_id = v_college_id;

  DELETE FROM public.schedule_version_conflict_exceptions
    WHERE schedule_version_id = p_version_id AND college_id = v_college_id;

  DELETE FROM public.conflict_results
    WHERE conflict_check_id IN (
      SELECT id FROM public.conflict_checks
      WHERE schedule_version_id = p_version_id AND college_id = v_college_id
    );

  DELETE FROM public.conflict_checks
    WHERE schedule_version_id = p_version_id AND college_id = v_college_id;

  DELETE FROM public.auto_schedule_runs
    WHERE schedule_version_id = p_version_id AND college_id = v_college_id;

  DELETE FROM public.schedule_version_events
    WHERE schedule_version_id = p_version_id AND college_id = v_college_id;

  DELETE FROM public.schedule_sessions
    WHERE schedule_version_id = p_version_id AND college_id = v_college_id;

  DELETE FROM public.schedule_versions
    WHERE id = p_version_id
      AND college_id = v_college_id
      AND disposable_test IS TRUE
      AND status = 'draft'
      AND id <> v_protected;

  GET DIAGNOSTICS v_versions = ROW_COUNT;
  IF v_versions <> 1 THEN
    RAISE EXCEPTION 'PURGE_VERSION_DELETE_FAILED' USING ERRCODE = 'P0001';
  END IF;

  -- Orphan fail-closed: no leftover dependents for this version id.
  IF EXISTS (
    SELECT 1 FROM public.schedule_sessions WHERE schedule_version_id = p_version_id
    UNION ALL
    SELECT 1 FROM public.schedule_version_events WHERE schedule_version_id = p_version_id
    UNION ALL
    SELECT 1 FROM public.conflict_checks WHERE schedule_version_id = p_version_id
    UNION ALL
    SELECT 1 FROM public.schedule_version_conflict_exceptions WHERE schedule_version_id = p_version_id
    UNION ALL
    SELECT 1 FROM public.schedule_quality_runs WHERE schedule_version_id = p_version_id
    UNION ALL
    SELECT 1 FROM public.auto_schedule_runs WHERE schedule_version_id = p_version_id
  ) THEN
    RAISE EXCEPTION 'PURGE_ORPHAN_ROWS_REMAIN' USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'purged', true,
    'already_absent', false,
    'version_id', p_version_id,
    'college_id', v_college_id,
    'counts', jsonb_build_object(
      'schedule_versions', v_versions,
      'schedule_sessions', v_sessions,
      'schedule_version_events', v_events,
      'conflict_checks', v_conflict_checks,
      'conflict_results', v_conflict_results,
      'schedule_version_conflict_exceptions', v_exceptions,
      'schedule_quality_runs', v_quality_runs,
      'auto_schedule_runs', v_auto_runs
    )
  );
END;
$$;

-- Clear default grants; official path is authenticated EXECUTE + in-function is_super_admin.
REVOKE ALL ON FUNCTION public.purge_disposable_draft_schedule_version(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_disposable_draft_schedule_version(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.purge_disposable_draft_schedule_version(uuid)
  TO service_role;

COMMIT;
