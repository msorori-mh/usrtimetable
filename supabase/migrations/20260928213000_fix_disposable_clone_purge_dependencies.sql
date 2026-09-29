-- Keep disposable-clone cleanup in sync with the version-scoped delivery,
-- assignment and source-revision tables added after the original purge RPC.
-- The operation remains super-admin-only, draft-only and fully atomic.
BEGIN;

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
  v_source_rows integer := 0;
  v_delivery_facts integer := 0;
  v_assignment_rows integer := 0;
  v_revision_rows integer := 0;
  v_jawf_rows integer := 0;
  v_cutover_runs integer := 0;
  v_versions integer := 0;
  v_cross_college integer := 0;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_super_admin(v_actor) THEN
    RAISE EXCEPTION 'PURGE_SUPER_ADMIN_REQUIRED' USING ERRCODE = '42501';
  END IF;

  IF p_version_id IS NULL THEN
    RAISE EXCEPTION 'PURGE_VERSION_ID_REQUIRED' USING ERRCODE = '22023';
  END IF;

  IF p_version_id = v_protected THEN
    RAISE EXCEPTION 'PURGE_PROTECTED_VERSION' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_version_id::text, 9175));

  SELECT college_id, status, disposable_test
    INTO v_college_id, v_status, v_disposable
  FROM public.schedule_versions
  WHERE id = p_version_id
  FOR UPDATE;

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
        'auto_schedule_runs', 0,
        'source_rows', 0,
        'delivery_facts', 0,
        'assignment_version_rows', 0,
        'source_revision_rows', 0,
        'jawf_source_rows', 0,
        'cutover_runs', 0
      )
    );
  END IF;

  IF v_disposable IS NOT TRUE THEN
    RAISE EXCEPTION 'PURGE_NOT_DISPOSABLE' USING ERRCODE = '42501';
  END IF;

  IF v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'PURGE_STATUS_NOT_DRAFT' USING ERRCODE = '42501';
  END IF;

  IF v_status IN ('approved', 'published', 'archived') THEN
    RAISE EXCEPTION 'PURGE_STATUS_IMMUTABLE' USING ERRCODE = '42501';
  END IF;

  -- A disposable version may be deleted only as a leaf. Never silently remove
  -- provenance required by another clone, correction revision or cutover.
  IF EXISTS (
    SELECT 1
    FROM schedule_version_delivery_private.clone_provenance
    WHERE source_version_id = p_version_id
  ) THEN
    RAISE EXCEPTION 'PURGE_VERSION_HAS_CLONES' USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM education_source_revision_private.revisions
    WHERE source_version_id = p_version_id
  ) THEN
    RAISE EXCEPTION 'PURGE_VERSION_HAS_SOURCE_REVISIONS' USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM itcs_cutover_private.relayout_profiles
    WHERE source_version_id = p_version_id OR draft_version_id = p_version_id
  ) THEN
    RAISE EXCEPTION 'PURGE_VERSION_HAS_CUTOVER_PROFILE' USING ERRCODE = '55000';
  END IF;

  -- Block collateral deletion/nulling through session FKs owned by another
  -- version. Target-owned source ledgers are removed later in this transaction.
  IF EXISTS (
    SELECT 1
    FROM education_source_revision_private.revisions r
    JOIN public.schedule_sessions s
      ON s.id = r.corrected_source_session_id
    WHERE s.schedule_version_id = p_version_id
      AND r.version_id IS DISTINCT FROM p_version_id
    UNION ALL
    SELECT 1
    FROM education_source_revision_private.sessions r
    JOIN public.schedule_sessions s
      ON s.id = r.source_session_id
    WHERE s.schedule_version_id = p_version_id
      AND r.version_id IS DISTINCT FROM p_version_id
    UNION ALL
    SELECT 1
    FROM public.schedule_version_conflict_exceptions e
    WHERE e.schedule_version_id IS DISTINCT FROM p_version_id
      AND (
        e.session_id IN (
          SELECT id FROM public.schedule_sessions
          WHERE schedule_version_id = p_version_id
        )
        OR e.related_session_id IN (
          SELECT id FROM public.schedule_sessions
          WHERE schedule_version_id = p_version_id
        )
      )
    UNION ALL
    SELECT 1
    FROM public.existing_schedule_source_rows r
    JOIN public.schedule_sessions s
      ON s.id = r.schedule_session_id
    WHERE s.schedule_version_id = p_version_id
      AND r.schedule_version_id IS DISTINCT FROM p_version_id
  ) THEN
    RAISE EXCEPTION 'PURGE_EXTERNAL_SESSION_REFERENCE' USING ERRCODE = '55000';
  END IF;

  -- Target-owned imported rows must not be consumed by another version.
  IF EXISTS (
    SELECT 1
    FROM education_source_revision_private.additions a
    JOIN public.existing_schedule_source_rows r ON r.id = a.source_row_id
    WHERE r.schedule_version_id = p_version_id
      AND a.version_id IS DISTINCT FROM p_version_id
    UNION ALL
    SELECT 1
    FROM education_source_revision_private.source_rows a
    JOIN public.existing_schedule_source_rows r ON r.id = a.source_row_id
    WHERE r.schedule_version_id = p_version_id
      AND a.version_id IS DISTINCT FROM p_version_id
    UNION ALL
    SELECT 1
    FROM jawf_term_source_private.sessions a
    JOIN public.existing_schedule_source_rows r ON r.id = a.source_row_id
    WHERE r.schedule_version_id = p_version_id
      AND a.version_id IS DISTINCT FROM p_version_id
  ) THEN
    RAISE EXCEPTION 'PURGE_EXTERNAL_SOURCE_ROW_REFERENCE' USING ERRCODE = '55000';
  END IF;

  -- Tenant-scoped dependent inventory. Any cross-college attachment aborts
  -- the entire transaction before a row is changed.
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
    UNION ALL
    SELECT 1 FROM public.existing_schedule_source_rows
      WHERE schedule_version_id = p_version_id AND college_id IS DISTINCT FROM v_college_id
    UNION ALL
    SELECT 1 FROM public.schedule_compaction_receipts
      WHERE schedule_version_id = p_version_id AND college_id IS DISTINCT FROM v_college_id
    UNION ALL
    SELECT 1 FROM public.schedule_version_delivery_baselines
      WHERE schedule_version_id = p_version_id AND college_id IS DISTINCT FROM v_college_id
    UNION ALL
    SELECT 1 FROM schedule_version_delivery_private.scope
      WHERE version_id = p_version_id AND college_id IS DISTINCT FROM v_college_id
    UNION ALL
    SELECT 1 FROM schedule_version_delivery_private.cohort_facts
      WHERE version_id = p_version_id AND college_id IS DISTINCT FROM v_college_id
    UNION ALL
    SELECT 1 FROM schedule_version_delivery_private.group_facts
      WHERE version_id = p_version_id AND college_id IS DISTINCT FROM v_college_id
    UNION ALL
    SELECT 1 FROM schedule_version_delivery_private.partner_group_facts
      WHERE version_id = p_version_id AND college_id IS DISTINCT FROM v_college_id
    UNION ALL
    SELECT 1 FROM schedule_version_delivery_private.partition_facts
      WHERE version_id = p_version_id AND college_id IS DISTINCT FROM v_college_id
    UNION ALL
    SELECT 1 FROM schedule_version_delivery_private.shared_link_facts
      WHERE version_id = p_version_id AND college_id IS DISTINCT FROM v_college_id
    UNION ALL
    SELECT 1 FROM schedule_version_delivery_private.instructor_hour_waivers
      WHERE version_id = p_version_id AND college_id IS DISTINCT FROM v_college_id
    UNION ALL
    SELECT 1 FROM education_source_revision_private.revisions
      WHERE version_id = p_version_id AND college_id IS DISTINCT FROM v_college_id
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
  SELECT COUNT(*)::integer INTO v_source_rows
    FROM public.existing_schedule_source_rows
    WHERE schedule_version_id = p_version_id AND college_id = v_college_id;

  SELECT (
    (SELECT COUNT(*) FROM schedule_version_delivery_private.clone_provenance WHERE version_id = p_version_id)
    + (SELECT COUNT(*) FROM schedule_version_delivery_private.scope WHERE version_id = p_version_id)
    + (SELECT COUNT(*) FROM schedule_version_delivery_private.cohort_facts WHERE version_id = p_version_id)
    + (SELECT COUNT(*) FROM schedule_version_delivery_private.group_facts WHERE version_id = p_version_id)
    + (SELECT COUNT(*) FROM schedule_version_delivery_private.partner_group_facts WHERE version_id = p_version_id)
    + (SELECT COUNT(*) FROM schedule_version_delivery_private.partition_facts WHERE version_id = p_version_id)
    + (SELECT COUNT(*) FROM schedule_version_delivery_private.group_partition_facts WHERE version_id = p_version_id)
    + (SELECT COUNT(*) FROM schedule_version_delivery_private.shared_link_facts WHERE version_id = p_version_id)
    + (SELECT COUNT(*) FROM schedule_version_delivery_private.partner_partition_facts WHERE version_id = p_version_id)
    + (SELECT COUNT(*) FROM schedule_version_delivery_private.component_room_type_facts WHERE version_id = p_version_id)
    + (SELECT COUNT(*) FROM schedule_version_delivery_private.instructor_hour_waivers WHERE version_id = p_version_id)
  )::integer INTO v_delivery_facts;

  SELECT (
    (SELECT COUNT(*) FROM assignment_version_private.enabled_versions WHERE version_id = p_version_id)
    + (SELECT COUNT(*) FROM assignment_version_private.move_receipts WHERE version_id = p_version_id)
    + (SELECT COUNT(*) FROM assignment_version_private.promotions WHERE version_id = p_version_id)
    + (SELECT COUNT(*) FROM assignment_version_private.publish_expectation WHERE version_id = p_version_id)
    + (SELECT COUNT(*) FROM assignment_version_private.request_scope WHERE version_id = p_version_id)
    + (SELECT COUNT(*) FROM assignment_version_private.scope WHERE version_id = p_version_id)
  )::integer INTO v_assignment_rows;

  SELECT (
    (SELECT COUNT(*) FROM education_source_revision_private.additions WHERE version_id = p_version_id)
    + (SELECT COUNT(*) FROM education_source_revision_private.sessions WHERE version_id = p_version_id)
    + (SELECT COUNT(*) FROM education_source_revision_private.source_rows WHERE version_id = p_version_id)
    + (SELECT COUNT(*) FROM education_source_revision_private.revisions WHERE version_id = p_version_id)
  )::integer INTO v_revision_rows;

  SELECT COUNT(*)::integer INTO v_jawf_rows
    FROM jawf_term_source_private.sessions WHERE version_id = p_version_id;
  SELECT COUNT(*)::integer INTO v_cutover_runs
    FROM itcs_cutover_private.runs WHERE version_id = p_version_id;

  -- Source-revision and import ledgers first, before the sessions/source rows
  -- that they reference.
  DELETE FROM education_source_revision_private.additions WHERE version_id = p_version_id;
  DELETE FROM education_source_revision_private.sessions WHERE version_id = p_version_id;
  DELETE FROM education_source_revision_private.source_rows WHERE version_id = p_version_id;
  DELETE FROM education_source_revision_private.revisions WHERE version_id = p_version_id;
  DELETE FROM jawf_term_source_private.sessions WHERE version_id = p_version_id;
  DELETE FROM itcs_cutover_private.runs WHERE version_id = p_version_id;

  -- Version-scoped assignment metadata has NO ACTION FKs and must be removed
  -- explicitly before the schedule version.
  DELETE FROM assignment_version_private.move_receipts WHERE version_id = p_version_id;
  DELETE FROM assignment_version_private.request_scope WHERE version_id = p_version_id;
  DELETE FROM assignment_version_private.scope WHERE version_id = p_version_id;
  DELETE FROM assignment_version_private.publish_expectation WHERE version_id = p_version_id;
  DELETE FROM assignment_version_private.promotions WHERE version_id = p_version_id;
  DELETE FROM assignment_version_private.enabled_versions WHERE version_id = p_version_id;

  -- Child-before-parent order for immutable delivery facts.
  DELETE FROM schedule_version_delivery_private.group_partition_facts WHERE version_id = p_version_id;
  DELETE FROM schedule_version_delivery_private.partner_partition_facts WHERE version_id = p_version_id;
  DELETE FROM schedule_version_delivery_private.instructor_hour_waivers WHERE version_id = p_version_id;
  DELETE FROM schedule_version_delivery_private.shared_link_facts WHERE version_id = p_version_id;
  DELETE FROM schedule_version_delivery_private.component_room_type_facts WHERE version_id = p_version_id;
  DELETE FROM schedule_version_delivery_private.group_facts WHERE version_id = p_version_id;
  DELETE FROM schedule_version_delivery_private.partition_facts WHERE version_id = p_version_id;
  DELETE FROM schedule_version_delivery_private.partner_group_facts WHERE version_id = p_version_id;
  DELETE FROM schedule_version_delivery_private.cohort_facts WHERE version_id = p_version_id;
  DELETE FROM schedule_version_delivery_private.scope WHERE version_id = p_version_id;
  DELETE FROM schedule_version_delivery_private.clone_provenance WHERE version_id = p_version_id;

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
  DELETE FROM public.existing_schedule_source_rows
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

  -- Exact cleanup assertion, including every later-added version-scoped table.
  IF EXISTS (
    SELECT 1 FROM public.schedule_sessions WHERE schedule_version_id = p_version_id
    UNION ALL SELECT 1 FROM public.schedule_version_events WHERE schedule_version_id = p_version_id
    UNION ALL SELECT 1 FROM public.conflict_checks WHERE schedule_version_id = p_version_id
    UNION ALL SELECT 1 FROM public.schedule_version_conflict_exceptions WHERE schedule_version_id = p_version_id
    UNION ALL SELECT 1 FROM public.schedule_quality_runs WHERE schedule_version_id = p_version_id
    UNION ALL SELECT 1 FROM public.auto_schedule_runs WHERE schedule_version_id = p_version_id
    UNION ALL SELECT 1 FROM public.existing_schedule_source_rows WHERE schedule_version_id = p_version_id
    UNION ALL SELECT 1 FROM public.report_verification_receipts WHERE version_id = p_version_id
    UNION ALL SELECT 1 FROM public.schedule_compaction_receipts WHERE schedule_version_id = p_version_id
    UNION ALL SELECT 1 FROM public.schedule_version_delivery_baselines WHERE schedule_version_id = p_version_id
    UNION ALL SELECT 1 FROM assignment_version_private.enabled_versions WHERE version_id = p_version_id
    UNION ALL SELECT 1 FROM assignment_version_private.move_receipts WHERE version_id = p_version_id
    UNION ALL SELECT 1 FROM assignment_version_private.promotions WHERE version_id = p_version_id
    UNION ALL SELECT 1 FROM assignment_version_private.publish_expectation WHERE version_id = p_version_id
    UNION ALL SELECT 1 FROM assignment_version_private.request_scope WHERE version_id = p_version_id
    UNION ALL SELECT 1 FROM assignment_version_private.scope WHERE version_id = p_version_id
    UNION ALL SELECT 1 FROM education_source_revision_private.revisions WHERE version_id = p_version_id
    UNION ALL SELECT 1 FROM education_source_revision_private.additions WHERE version_id = p_version_id
    UNION ALL SELECT 1 FROM education_source_revision_private.sessions WHERE version_id = p_version_id
    UNION ALL SELECT 1 FROM education_source_revision_private.source_rows WHERE version_id = p_version_id
    UNION ALL SELECT 1 FROM jawf_term_source_private.sessions WHERE version_id = p_version_id
    UNION ALL SELECT 1 FROM itcs_cutover_private.runs WHERE version_id = p_version_id
    UNION ALL SELECT 1 FROM schedule_version_delivery_private.clone_provenance WHERE version_id = p_version_id
    UNION ALL SELECT 1 FROM schedule_version_delivery_private.scope WHERE version_id = p_version_id
    UNION ALL SELECT 1 FROM schedule_version_delivery_private.cohort_facts WHERE version_id = p_version_id
    UNION ALL SELECT 1 FROM schedule_version_delivery_private.group_facts WHERE version_id = p_version_id
    UNION ALL SELECT 1 FROM schedule_version_delivery_private.partner_group_facts WHERE version_id = p_version_id
    UNION ALL SELECT 1 FROM schedule_version_delivery_private.partition_facts WHERE version_id = p_version_id
    UNION ALL SELECT 1 FROM schedule_version_delivery_private.group_partition_facts WHERE version_id = p_version_id
    UNION ALL SELECT 1 FROM schedule_version_delivery_private.shared_link_facts WHERE version_id = p_version_id
    UNION ALL SELECT 1 FROM schedule_version_delivery_private.partner_partition_facts WHERE version_id = p_version_id
    UNION ALL SELECT 1 FROM schedule_version_delivery_private.component_room_type_facts WHERE version_id = p_version_id
    UNION ALL SELECT 1 FROM schedule_version_delivery_private.instructor_hour_waivers WHERE version_id = p_version_id
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
      'auto_schedule_runs', v_auto_runs,
      'source_rows', v_source_rows,
      'delivery_facts', v_delivery_facts,
      'assignment_version_rows', v_assignment_rows,
      'source_revision_rows', v_revision_rows,
      'jawf_source_rows', v_jawf_rows,
      'cutover_runs', v_cutover_runs
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purge_disposable_draft_schedule_version(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_disposable_draft_schedule_version(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.purge_disposable_draft_schedule_version(uuid)
  TO service_role;

COMMIT;
