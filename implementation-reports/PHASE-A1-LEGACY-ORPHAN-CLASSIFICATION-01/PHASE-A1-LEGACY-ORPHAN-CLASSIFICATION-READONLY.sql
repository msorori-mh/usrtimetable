-- PHASE-A1-LEGACY-ORPHAN-CLASSIFICATION-READONLY.sql
-- =============================================================================
-- READ-ONLY — SELECT / WITH...SELECT ONLY.
-- No INSERT / UPDATE / DELETE / TRUNCATE / DDL / RPC / UDF / temp objects /
-- dynamic SQL.
--
-- Classifies every in-scope Legacy orphan row using proven public columns only:
--   - teaching_assignments WHERE section_id IS NOT NULL  (expect 174)
--   - course_offering_sections                          (expect 5)
--
-- Allowed classification labels (evidence required; otherwise UNKNOWN):
--   TEST | LEGACY_HISTORICAL | MIGRATABLE_TO_V2 | SAFE_TO_UNLINK
--   | REQUIRED_FOR_OPERATION | UNKNOWN
--
-- Execution of THIS file is safe. Acting on its output requires
-- APPROVE_LEGACY_DATA_REMEDIATION. Do not modify 174 TA or 5 COS here.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- §0 Snapshot counters (coordination facts)
-- -----------------------------------------------------------------------------
SELECT 'sections' AS metric, count(*)::bigint AS actual, 0::bigint AS expected
FROM public.sections
UNION ALL
SELECT 'course_offering_sections', count(*)::bigint, 5::bigint
FROM public.course_offering_sections
UNION ALL
SELECT 'ta_with_section_id', count(*)::bigint, 174::bigint
FROM public.teaching_assignments
WHERE section_id IS NOT NULL
UNION ALL
SELECT 'ta_v2_with_section_id', count(*)::bigint, 0::bigint
FROM public.teaching_assignments
WHERE section_id IS NOT NULL
  AND delivery_group_id IS NOT NULL
UNION ALL
SELECT 'academic_programs', count(*)::bigint, 0::bigint
FROM public.academic_programs;

-- -----------------------------------------------------------------------------
-- §1 Schema preflight — every column used below must appear
-- -----------------------------------------------------------------------------
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'teaching_assignments' AND column_name IN (
      'id', 'college_id', 'course_offering_id', 'instructor_id', 'section_id',
      'delivery_group_id', 'cohort_id', 'is_active', 'created_at', 'updated_at',
      'session_type', 'expected_students', 'notes', 'plan_course_component_id'
    ))
    OR (table_name = 'course_offering_sections' AND column_name IN (
      'id', 'college_id', 'course_offering_id', 'section_id', 'section_number',
      'expected_students', 'created_at', 'updated_at'
    ))
    OR (table_name = 'course_offerings' AND column_name IN (
      'id', 'college_id', 'course_id', 'term_id', 'study_system', 'is_active'
    ))
    OR (table_name = 'courses' AND column_name IN ('id', 'code', 'name', 'college_id'))
    OR (table_name = 'instructors' AND column_name IN ('id', 'full_name', 'college_id'))
    OR (table_name = 'academic_cohorts' AND column_name IN (
      'id', 'college_id', 'study_system', 'term_id', 'code', 'active'
    ))
    OR (table_name = 'delivery_groups' AND column_name IN (
      'id', 'college_id', 'cohort_id', 'course_offering_id', 'group_code'
    ))
    OR (table_name = 'sections' AND column_name IN ('id', 'college_id'))
    OR (table_name = 'schedule_sessions' AND column_name IN (
      'id', 'teaching_assignment_id', 'section_id', 'delivery_group_id'
    ))
    OR (table_name = 'academic_terms' AND column_name IN ('id', 'name', 'college_id'))
  )
ORDER BY table_name, column_name;

-- -----------------------------------------------------------------------------
-- §2 Teaching assignments orphan classification (expect 174 rows)
-- Default UNKNOWN unless a positive evidence rule matches.
-- -----------------------------------------------------------------------------
WITH ta_base AS (
  SELECT
    t.id,
    t.college_id,
    t.course_offering_id,
    t.instructor_id,
    t.section_id,
    t.delivery_group_id,
    t.cohort_id,
    t.is_active,
    t.created_at,
    t.updated_at,
    t.session_type,
    t.expected_students,
    t.notes,
    t.plan_course_component_id
  FROM public.teaching_assignments t
  WHERE t.section_id IS NOT NULL
),
ta_enriched AS (
  SELECT
    b.*,
    o.term_id,
    o.course_id,
    o.study_system AS offering_study_system,
    o.is_active AS offering_is_active,
    c.code AS course_code,
    c.name AS course_name,
    i.full_name AS instructor_name,
    ac.study_system AS cohort_study_system,
    ac.code AS cohort_code,
    at.name AS term_name,
    (EXISTS (SELECT 1 FROM public.sections s WHERE s.id = b.section_id)) AS section_row_exists,
    (EXISTS (
      SELECT 1 FROM public.delivery_groups dg
      WHERE dg.college_id = b.college_id
        AND dg.course_offering_id = b.course_offering_id
        AND (b.cohort_id IS NULL OR dg.cohort_id = b.cohort_id)
    )) AS matching_delivery_group_exists,
    (EXISTS (
      SELECT 1 FROM public.teaching_assignments v2
      WHERE v2.college_id = b.college_id
        AND v2.course_offering_id = b.course_offering_id
        AND v2.instructor_id = b.instructor_id
        AND v2.delivery_group_id IS NOT NULL
        AND v2.section_id IS NULL
        AND v2.id <> b.id
    )) AS v2_ta_alternative_exists,
    (EXISTS (
      SELECT 1 FROM public.schedule_sessions ss
      WHERE ss.teaching_assignment_id = b.id
    )) AS has_schedule_session_dependency,
    (EXISTS (
      SELECT 1 FROM public.schedule_sessions ss
      WHERE ss.section_id = b.section_id
    )) AS section_used_by_any_session,
    (
      coalesce(i.full_name, '') ILIKE '%test%'
      OR coalesce(i.full_name, '') ILIKE '%dummy%'
      OR coalesce(i.full_name, '') LIKE '%تجريب%'
      OR coalesce(c.code, '') ILIKE 'TEST%'
      OR coalesce(b.notes, '') ILIKE '%test%'
    ) AS test_name_signal
  FROM ta_base b
  LEFT JOIN public.course_offerings o ON o.id = b.course_offering_id
  LEFT JOIN public.courses c ON c.id = o.course_id
  LEFT JOIN public.instructors i ON i.id = b.instructor_id
  LEFT JOIN public.academic_cohorts ac ON ac.id = b.cohort_id
  LEFT JOIN public.academic_terms at ON at.id = o.term_id
),
ta_classified AS (
  SELECT
    e.*,
    CASE
      WHEN e.test_name_signal THEN 'TEST'
      WHEN e.v2_ta_alternative_exists
        AND NOT e.has_schedule_session_dependency
        AND NOT e.section_row_exists
        THEN 'MIGRATABLE_TO_V2'
      WHEN NOT e.section_row_exists
        AND NOT e.has_schedule_session_dependency
        AND NOT e.section_used_by_any_session
        AND e.matching_delivery_group_exists
        THEN 'SAFE_TO_UNLINK'
      WHEN e.has_schedule_session_dependency
        OR e.section_used_by_any_session
        THEN 'REQUIRED_FOR_OPERATION'
      WHEN NOT e.section_row_exists
        AND e.delivery_group_id IS NULL
        THEN 'LEGACY_HISTORICAL'
      ELSE 'UNKNOWN'
    END AS classification,
    CASE
      WHEN e.test_name_signal THEN 'instructor/course/notes test marker'
      WHEN e.v2_ta_alternative_exists
        AND NOT e.has_schedule_session_dependency
        AND NOT e.section_row_exists
        THEN 'same offering+instructor has V2 TA; no session dependency; section missing'
      WHEN NOT e.section_row_exists
        AND NOT e.has_schedule_session_dependency
        AND NOT e.section_used_by_any_session
        AND e.matching_delivery_group_exists
        THEN 'dangling section_id; no sessions; matching delivery_group present'
      WHEN e.has_schedule_session_dependency
        OR e.section_used_by_any_session
        THEN 'schedule_sessions still reference this TA or section_id'
      WHEN NOT e.section_row_exists
        AND e.delivery_group_id IS NULL
        THEN 'legacy shape with missing section row; no stronger evidence'
      ELSE 'insufficient evidence for a non-UNKNOWN label'
    END AS classification_evidence
  FROM ta_enriched e
)
SELECT
  'teaching_assignments' AS entity,
  id,
  college_id,
  term_id,
  term_name,
  course_offering_id,
  course_id,
  course_code,
  course_name,
  instructor_id,
  instructor_name,
  cohort_id,
  cohort_code,
  delivery_group_id,
  section_id,
  coalesce(cohort_study_system, offering_study_system) AS study_system,
  is_active,
  created_at,
  updated_at,
  NULL::uuid AS import_job_id,
  'column_absent_on_teaching_assignments' AS audit_source_note,
  matching_delivery_group_exists AS has_matching_delivery_group,
  v2_ta_alternative_exists AS has_teaching_assignment_v2_alternative,
  (matching_delivery_group_exists OR v2_ta_alternative_exists) AS has_new_flow_alternative,
  has_schedule_session_dependency,
  section_row_exists,
  section_used_by_any_session,
  classification,
  classification_evidence
FROM ta_classified
ORDER BY classification, college_id, id;

-- -----------------------------------------------------------------------------
-- §3 course_offering_sections orphan classification (expect 5 rows)
-- -----------------------------------------------------------------------------
WITH cos_base AS (
  SELECT
    cos.id,
    cos.college_id,
    cos.course_offering_id,
    cos.section_id,
    cos.section_number,
    cos.expected_students,
    cos.created_at,
    cos.updated_at
  FROM public.course_offering_sections cos
),
cos_enriched AS (
  SELECT
    b.*,
    o.term_id,
    o.course_id,
    o.study_system,
    o.is_active AS offering_is_active,
    c.code AS course_code,
    c.name AS course_name,
    at.name AS term_name,
    (EXISTS (SELECT 1 FROM public.sections s WHERE s.id = b.section_id)) AS section_row_exists,
    (EXISTS (
      SELECT 1 FROM public.delivery_groups dg
      WHERE dg.college_id = b.college_id
        AND dg.course_offering_id = b.course_offering_id
    )) AS matching_delivery_group_exists,
    (EXISTS (
      SELECT 1 FROM public.teaching_assignments t
      WHERE t.section_id = b.section_id
    )) AS ta_still_references_section,
    (EXISTS (
      SELECT 1 FROM public.schedule_sessions ss
      WHERE ss.section_id = b.section_id
    )) AS section_used_by_any_session,
    (
      coalesce(c.code, '') ILIKE 'TEST%'
      OR coalesce(b.section_number, '') ILIKE '%test%'
    ) AS test_name_signal
  FROM cos_base b
  LEFT JOIN public.course_offerings o ON o.id = b.course_offering_id
  LEFT JOIN public.courses c ON c.id = o.course_id
  LEFT JOIN public.academic_terms at ON at.id = o.term_id
),
cos_classified AS (
  SELECT
    e.*,
    CASE
      WHEN e.test_name_signal THEN 'TEST'
      WHEN e.ta_still_references_section
        OR e.section_used_by_any_session
        THEN 'REQUIRED_FOR_OPERATION'
      WHEN NOT e.section_row_exists
        AND e.matching_delivery_group_exists
        AND NOT e.ta_still_references_section
        THEN 'SAFE_TO_UNLINK'
      WHEN NOT e.section_row_exists
        THEN 'LEGACY_HISTORICAL'
      ELSE 'UNKNOWN'
    END AS classification,
    CASE
      WHEN e.test_name_signal THEN 'course code / section_number test marker'
      WHEN e.ta_still_references_section
        OR e.section_used_by_any_session
        THEN 'TA or schedule_sessions still reference section_id'
      WHEN NOT e.section_row_exists
        AND e.matching_delivery_group_exists
        AND NOT e.ta_still_references_section
        THEN 'dangling COS section; delivery_group exists; no TA refs'
      WHEN NOT e.section_row_exists
        THEN 'dangling COS section; no stronger evidence'
      ELSE 'insufficient evidence for a non-UNKNOWN label'
    END AS classification_evidence
  FROM cos_enriched e
)
SELECT
  'course_offering_sections' AS entity,
  id,
  college_id,
  term_id,
  term_name,
  course_offering_id,
  course_id,
  course_code,
  course_name,
  NULL::uuid AS instructor_id,
  NULL::text AS instructor_name,
  NULL::uuid AS cohort_id,
  NULL::text AS cohort_code,
  NULL::uuid AS delivery_group_id,
  section_id,
  study_system,
  offering_is_active AS is_active,
  created_at,
  updated_at,
  NULL::uuid AS import_job_id,
  'column_absent_on_course_offering_sections' AS audit_source_note,
  matching_delivery_group_exists AS has_matching_delivery_group,
  false AS has_teaching_assignment_v2_alternative,
  matching_delivery_group_exists AS has_new_flow_alternative,
  ta_still_references_section,
  section_row_exists,
  section_used_by_any_session,
  classification,
  classification_evidence
FROM cos_classified
ORDER BY classification, college_id, id;

-- -----------------------------------------------------------------------------
-- §4 Classification tally
-- -----------------------------------------------------------------------------
WITH ta AS (
  SELECT id,
    CASE
      WHEN coalesce(i.full_name, '') ILIKE '%test%'
        OR coalesce(i.full_name, '') ILIKE '%dummy%'
        OR coalesce(i.full_name, '') LIKE '%تجريب%'
        OR coalesce(c.code, '') ILIKE 'TEST%'
        OR coalesce(t.notes, '') ILIKE '%test%'
        THEN 'TEST'
      WHEN EXISTS (
        SELECT 1 FROM public.teaching_assignments v2
        WHERE v2.college_id = t.college_id
          AND v2.course_offering_id = t.course_offering_id
          AND v2.instructor_id = t.instructor_id
          AND v2.delivery_group_id IS NOT NULL
          AND v2.section_id IS NULL
          AND v2.id <> t.id
      )
        AND NOT EXISTS (
          SELECT 1 FROM public.schedule_sessions ss WHERE ss.teaching_assignment_id = t.id
        )
        AND NOT EXISTS (SELECT 1 FROM public.sections s WHERE s.id = t.section_id)
        THEN 'MIGRATABLE_TO_V2'
      WHEN NOT EXISTS (SELECT 1 FROM public.sections s WHERE s.id = t.section_id)
        AND NOT EXISTS (
          SELECT 1 FROM public.schedule_sessions ss WHERE ss.teaching_assignment_id = t.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.schedule_sessions ss WHERE ss.section_id = t.section_id
        )
        AND EXISTS (
          SELECT 1 FROM public.delivery_groups dg
          WHERE dg.college_id = t.college_id
            AND dg.course_offering_id = t.course_offering_id
            AND (t.cohort_id IS NULL OR dg.cohort_id = t.cohort_id)
        )
        THEN 'SAFE_TO_UNLINK'
      WHEN EXISTS (
        SELECT 1 FROM public.schedule_sessions ss WHERE ss.teaching_assignment_id = t.id
      )
        OR EXISTS (
          SELECT 1 FROM public.schedule_sessions ss WHERE ss.section_id = t.section_id
        )
        THEN 'REQUIRED_FOR_OPERATION'
      WHEN NOT EXISTS (SELECT 1 FROM public.sections s WHERE s.id = t.section_id)
        AND t.delivery_group_id IS NULL
        THEN 'LEGACY_HISTORICAL'
      ELSE 'UNKNOWN'
    END AS classification
  FROM public.teaching_assignments t
  LEFT JOIN public.instructors i ON i.id = t.instructor_id
  LEFT JOIN public.course_offerings o ON o.id = t.course_offering_id
  LEFT JOIN public.courses c ON c.id = o.course_id
  WHERE t.section_id IS NOT NULL
),
cos AS (
  SELECT cos.id,
    CASE
      WHEN coalesce(c.code, '') ILIKE 'TEST%'
        OR coalesce(cos.section_number, '') ILIKE '%test%'
        THEN 'TEST'
      WHEN EXISTS (
        SELECT 1 FROM public.teaching_assignments t WHERE t.section_id = cos.section_id
      )
        OR EXISTS (
          SELECT 1 FROM public.schedule_sessions ss WHERE ss.section_id = cos.section_id
        )
        THEN 'REQUIRED_FOR_OPERATION'
      WHEN NOT EXISTS (SELECT 1 FROM public.sections s WHERE s.id = cos.section_id)
        AND EXISTS (
          SELECT 1 FROM public.delivery_groups dg
          WHERE dg.college_id = cos.college_id
            AND dg.course_offering_id = cos.course_offering_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.teaching_assignments t WHERE t.section_id = cos.section_id
        )
        THEN 'SAFE_TO_UNLINK'
      WHEN NOT EXISTS (SELECT 1 FROM public.sections s WHERE s.id = cos.section_id)
        THEN 'LEGACY_HISTORICAL'
      ELSE 'UNKNOWN'
    END AS classification
  FROM public.course_offering_sections cos
  LEFT JOIN public.course_offerings o ON o.id = cos.course_offering_id
  LEFT JOIN public.courses c ON c.id = o.course_id
)
SELECT entity, classification, count(*)::bigint AS n
FROM (
  SELECT 'teaching_assignments' AS entity, classification FROM ta
  UNION ALL
  SELECT 'course_offering_sections', classification FROM cos
) x
GROUP BY entity, classification
ORDER BY entity, classification;

-- -----------------------------------------------------------------------------
-- §5 Exact-ID manifests (checksum helpers)
-- -----------------------------------------------------------------------------
SELECT
  'teaching_assignments' AS entity,
  count(*)::bigint AS row_count,
  md5(string_agg(id::text, ',' ORDER BY id)) AS id_manifest_md5
FROM public.teaching_assignments
WHERE section_id IS NOT NULL;

SELECT
  'course_offering_sections' AS entity,
  count(*)::bigint AS row_count,
  md5(string_agg(id::text, ',' ORDER BY id)) AS id_manifest_md5
FROM public.course_offering_sections;
