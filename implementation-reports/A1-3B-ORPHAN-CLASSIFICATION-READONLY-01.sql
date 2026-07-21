-- A1-3B-ORPHAN-CLASSIFICATION-READONLY-01.sql
-- =============================================================================
-- READ-ONLY — SELECT STATEMENTS ONLY. No INSERT / UPDATE / DELETE / DDL.
-- Purpose: classify every in-scope Legacy row (174 teaching_assignments carrying
-- section_id + 5 course_offering_sections) and generate the exact-IDs manifest
-- with checksums that will drive — and only after explicit approval — the A1.3b
-- remediation described in implementation-reports/A1-3B-LEGACY-ORPHAN-REMEDIATION-PLAN-01.md.
--
-- Execution gate: running THIS file is safe (read-only). Acting on its output
-- requires APPROVE_LEGACY_DATA_REMEDIATION. The A1.3c hardening migration
-- additionally requires APPROVE_DB_MIGRATION_APPLY.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- §0 Production snapshot — verify the coordination facts before anything else.
-- Expected: sections=0, course_offering_sections=5, ta_with_section_id=174,
-- academic_programs=0.
-- -----------------------------------------------------------------------------
SELECT 'sections' AS metric, count(*)::text AS actual, '0' AS expected FROM public.sections
UNION ALL
SELECT 'course_offering_sections', count(*)::text, '5' FROM public.course_offering_sections
UNION ALL
SELECT 'teaching_assignments_total', count(*)::text, '(unknown)' FROM public.teaching_assignments
UNION ALL
SELECT 'ta_with_section_id', count(*)::text, '174' FROM public.teaching_assignments WHERE section_id IS NOT NULL
UNION ALL
SELECT 'academic_programs', count(*)::text, '0' FROM public.academic_programs;

-- -----------------------------------------------------------------------------
-- §1 Schema preflight — confirm every column used below exists. If an expected
-- row is missing, STOP and reconcile the column name before using §2+.
-- -----------------------------------------------------------------------------
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'teaching_assignments', 'course_offering_sections', 'sections',
    'course_offerings', 'courses', 'instructors', 'schedule_sessions',
    'section_group_members'
  )
  AND column_name IN (
    'id', 'college_id', 'section_id', 'course_offering_id', 'instructor_id',
    'delivery_group_id', 'session_type', 'course_id', 'code', 'name',
    'full_name', 'teaching_assignment_id'
  )
ORDER BY table_name, column_name;

-- -----------------------------------------------------------------------------
-- §2a Classification + exact-IDs manifest — teaching_assignments (expect 174).
-- Classification priority: test > orphan > legacy historical > generated(reserved)
-- > real > unknown. Signals are emitted for auditability.
-- -----------------------------------------------------------------------------
WITH ta_scope AS (
  SELECT
    t.id, t.college_id, t.course_offering_id, t.instructor_id,
    t.section_id, t.delivery_group_id, t.session_type
  FROM public.teaching_assignments t
  WHERE t.section_id IS NOT NULL
),
ta_signals AS (
  SELECT
    s.*,
    (s.section_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.sections sec WHERE sec.id = s.section_id)) AS has_dangling_section,
    (s.course_offering_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.course_offerings co WHERE co.id = s.course_offering_id)) AS has_dangling_offering,
    ((s.section_id IS NOT NULL) OR (s.delivery_group_id IS NULL)) AS legacy_shape,
    (s.delivery_group_id IS NOT NULL AND s.section_id IS NULL) AS v2_shape,
    (coalesce(i.full_name, '') ILIKE '%test%'
      OR coalesce(i.full_name, '') ILIKE '%dummy%'
      OR coalesce(i.full_name, '') LIKE '%تجريب%'
      OR coalesce(c.code, '') ILIKE 'TEST%') AS test_signal
  FROM ta_scope s
  LEFT JOIN public.instructors i ON i.id = s.instructor_id
  LEFT JOIN public.course_offerings o ON o.id = s.course_offering_id
  LEFT JOIN public.courses c ON c.id = o.course_id
),
ta_classified AS (
  SELECT
    *,
    CASE
      WHEN test_signal THEN 'test'
      WHEN has_dangling_section OR has_dangling_offering THEN 'orphan'
      WHEN legacy_shape THEN 'legacy historical'
      WHEN false THEN 'generated' -- reserved: no source-marker column exists on TA
      WHEN v2_shape THEN 'real'
      ELSE 'unknown'
    END AS classification
  FROM ta_signals
)
SELECT
  'teaching_assignments' AS table_name,
  id,
  classification,
  jsonb_build_object(
    'has_dangling_section', has_dangling_section,
    'has_dangling_offering', has_dangling_offering,
    'legacy_shape', legacy_shape,
    'v2_shape', v2_shape,
    'test_signal', test_signal
  ) AS signals,
  md5(concat_ws('|', id, section_id, course_offering_id, instructor_id, delivery_group_id, session_type)) AS row_checksum
FROM ta_classified
ORDER BY id;

-- -----------------------------------------------------------------------------
-- §2b Classification + exact-IDs manifest — course_offering_sections (expect 5).
-- -----------------------------------------------------------------------------
WITH cos_scope AS (
  SELECT c.id, c.course_offering_id, c.section_id
  FROM public.course_offering_sections c
),
cos_signals AS (
  SELECT
    s.*,
    (s.section_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.sections sec WHERE sec.id = s.section_id)) AS has_dangling_section,
    (s.course_offering_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.course_offerings co WHERE co.id = s.course_offering_id)) AS has_dangling_offering,
    true AS legacy_shape,  -- COS is a Legacy-only join table
    false AS v2_shape,
    (coalesce(c.code, '') ILIKE 'TEST%'
      OR coalesce(c.name, '') ILIKE '%test%'
      OR coalesce(c.name, '') LIKE '%تجريب%') AS test_signal
  FROM cos_scope s
  LEFT JOIN public.course_offerings o ON o.id = s.course_offering_id
  LEFT JOIN public.courses c ON c.id = o.course_id
),
cos_classified AS (
  SELECT
    *,
    CASE
      WHEN test_signal THEN 'test'
      WHEN has_dangling_section OR has_dangling_offering THEN 'orphan'
      WHEN legacy_shape THEN 'legacy historical'
      WHEN false THEN 'generated' -- reserved
      WHEN v2_shape THEN 'real'
      ELSE 'unknown'
    END AS classification
  FROM cos_signals
)
SELECT
  'course_offering_sections' AS table_name,
  id,
  classification,
  jsonb_build_object(
    'has_dangling_section', has_dangling_section,
    'has_dangling_offering', has_dangling_offering,
    'legacy_shape', legacy_shape,
    'v2_shape', v2_shape,
    'test_signal', test_signal
  ) AS signals,
  md5(concat_ws('|', id, section_id, course_offering_id)) AS row_checksum
FROM cos_classified
ORDER BY id;

-- -----------------------------------------------------------------------------
-- §3 Combined manifest (export this as A1-3B-MANIFEST-<date>.csv at the gate)
-- plus per-table summary and the global manifest checksum used for
-- before/after verification.
-- -----------------------------------------------------------------------------
WITH ta_scope AS (
  SELECT t.id, t.section_id, t.course_offering_id, t.instructor_id, t.delivery_group_id, t.session_type
  FROM public.teaching_assignments t WHERE t.section_id IS NOT NULL
),
ta_classified AS (
  SELECT s.id,
    CASE
      WHEN (coalesce(i.full_name, '') ILIKE '%test%' OR coalesce(i.full_name, '') ILIKE '%dummy%'
            OR coalesce(i.full_name, '') LIKE '%تجريب%' OR coalesce(c.code, '') ILIKE 'TEST%') THEN 'test'
      WHEN (s.section_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.sections sec WHERE sec.id = s.section_id))
        OR (s.course_offering_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.course_offerings co WHERE co.id = s.course_offering_id))
        THEN 'orphan'
      WHEN (s.section_id IS NOT NULL) OR (s.delivery_group_id IS NULL) THEN 'legacy historical'
      WHEN s.delivery_group_id IS NOT NULL AND s.section_id IS NULL THEN 'real'
      ELSE 'unknown'
    END AS classification
  FROM ta_scope s
  LEFT JOIN public.instructors i ON i.id = s.instructor_id
  LEFT JOIN public.course_offerings o ON o.id = s.course_offering_id
  LEFT JOIN public.courses c ON c.id = o.course_id
),
cos_classified AS (
  SELECT s.id,
    CASE
      WHEN (coalesce(c.code, '') ILIKE 'TEST%' OR coalesce(c.name, '') ILIKE '%test%'
            OR coalesce(c.name, '') LIKE '%تجريب%') THEN 'test'
      WHEN (s.section_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.sections sec WHERE sec.id = s.section_id))
        OR (s.course_offering_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.course_offerings co WHERE co.id = s.course_offering_id))
        THEN 'orphan'
      ELSE 'legacy historical'
    END AS classification
  FROM public.course_offering_sections s
  LEFT JOIN public.course_offerings o ON o.id = s.course_offering_id
  LEFT JOIN public.courses c ON c.id = o.course_id
),
manifest AS (
  SELECT 'teaching_assignments' AS table_name, id, classification FROM ta_classified
  UNION ALL
  SELECT 'course_offering_sections' AS table_name, id, classification FROM cos_classified
)
SELECT table_name, classification, count(*) AS rows_in_class
FROM manifest
GROUP BY table_name, classification
ORDER BY table_name, classification;

-- §3b Global manifest checksums (before-state). Recompute after dry-run /
-- execution / rollback and compare bit-for-bit.
WITH ta_scope AS (
  SELECT t.id FROM public.teaching_assignments t WHERE t.section_id IS NOT NULL
),
cos_scope AS (
  SELECT c.id FROM public.course_offering_sections c
),
manifest AS (
  SELECT 'teaching_assignments' AS table_name, id FROM ta_scope
  UNION ALL
  SELECT 'course_offering_sections' AS table_name, id FROM cos_scope
)
SELECT
  table_name,
  count(*) AS manifest_rows,
  md5(string_agg(id::text, ',' ORDER BY id::text)) AS manifest_id_checksum
FROM manifest
GROUP BY table_name
ORDER BY table_name;

-- -----------------------------------------------------------------------------
-- §4 Reference scan — decide between nullify vs delete options (plan §5).
-- Counts of operational rows referencing the in-scope IDs. schedule_sessions
-- references are informational (sessions are not remediated in A1.3b).
-- -----------------------------------------------------------------------------
SELECT 'schedule_sessions_referencing_scoped_ta' AS check_name, count(*) AS refs
FROM public.schedule_sessions ss
WHERE ss.teaching_assignment_id IN (
  SELECT t.id FROM public.teaching_assignments t WHERE t.section_id IS NOT NULL
)
UNION ALL
SELECT 'schedule_sessions_with_legacy_section_id', count(*)
FROM public.schedule_sessions ss
WHERE ss.section_id IS NOT NULL
UNION ALL
SELECT 'section_group_members_total', count(*)
FROM public.section_group_members;

-- -----------------------------------------------------------------------------
-- §5 Expected-state checklist (informational booleans; investigate any false).
-- -----------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM public.sections) = 0 AS sections_empty,
  (SELECT count(*) FROM public.teaching_assignments WHERE section_id IS NOT NULL) = 174 AS ta_scope_matches_174,
  (SELECT count(*) FROM public.course_offering_sections) = 5 AS cos_scope_matches_5,
  (SELECT count(*) FROM public.teaching_assignments t
   WHERE t.section_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.sections s WHERE s.id = t.section_id)) = 174 AS all_scoped_ta_orphan;

-- END OF READ-ONLY FILE — no mutations above this line, none below it.
