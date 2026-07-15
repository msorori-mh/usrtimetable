-- Expected live baseline for 20260715200500_remediate_course_offering_term_references.sql
-- Documentation only — migration embeds these as constants and RAISE EXCEPTION on mismatch.

-- Remap term (orphan) → target current first term
-- ca5146f1-2f61-46e7-be4b-2a29099d2d23 → 18dd364a-76d7-40b8-a217-fa929c082a7f  (84)
-- Delete term (orphan)
-- 3e59d219-bfde-435f-a65e-cc55876c64ab  (129 offerings)

SELECT
  213 AS course_offerings_total,
  84 AS remap_offerings,
  129 AS delete_offerings,
  163 AS delete_teaching_assignments,
  129 AS delete_course_offering_sections,
  174 AS keep_teaching_assignments,
  5 AS keep_course_offering_sections,
  0 AS co_unique_conflicts,
  0 AS delete_schedule_sessions,
  213 AS orphan_term_references_before,
  84 AS remaining_offerings_after,
  0 AS orphan_term_references_after;
