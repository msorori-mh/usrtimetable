-- SOURCE ONLY — local post-apply verification companion for Phase-6
-- migrations:
--   20260715130000_reset_experimental_schedule_data.sql
--   20260715130100_harden_schedule_room_references.sql
--
-- Do not auto-apply. Run manually after an OWNER_CONFIRMED experimental
-- reset + room hardening apply to assert catalog and integrity invariants.

-- 1) No official / published / approved schedule versions remain gated incorrectly
SELECT COUNT(*) AS official_or_published_versions
FROM public.schedule_versions
WHERE status IN ('published', 'approved');

-- 2) Experimental operational tables empty after disposable reset (when reset applied)
SELECT
  (SELECT COUNT(*) FROM public.schedule_versions) AS schedule_versions,
  (SELECT COUNT(*) FROM public.schedule_sessions) AS schedule_sessions,
  (SELECT COUNT(*) FROM public.section_subgroups) AS section_subgroups;

-- 3) Protected masters untouched (spot counts — compare to pre-apply audit)
SELECT
  (SELECT COUNT(*) FROM public.rooms) AS rooms,
  (SELECT COUNT(*) FROM public.courses) AS courses,
  (SELECT COUNT(*) FROM public.sections) AS sections,
  (SELECT COUNT(*) FROM public.course_offerings) AS course_offerings,
  (SELECT COUNT(*) FROM public.teaching_assignments) AS teaching_assignments,
  (SELECT COUNT(*) FROM public.instructors) AS instructors,
  (SELECT COUNT(*) FROM public.colleges) AS colleges,
  (SELECT COUNT(*) FROM public.departments) AS departments,
  (SELECT COUNT(*) FROM public.programs) AS programs,
  (SELECT COUNT(*) FROM public.terms) AS terms;

-- 4) Room FK hardening: index present, FK RESTRICT, no orphans
SELECT EXISTS (
  SELECT 1
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'i'
    AND c.relname = 'idx_schedule_sessions_room_id'
) AS idx_schedule_sessions_room_id_exists;

SELECT
  c.conname,
  c.convalidated,
  CASE c.confdeltype
    WHEN 'r' THEN 'RESTRICT'
    WHEN 'a' THEN 'NO ACTION'
    WHEN 'c' THEN 'CASCADE'
    ELSE c.confdeltype::text
  END AS on_delete_behavior
FROM pg_constraint c
WHERE c.conname = 'schedule_sessions_room_id_fkey'
  AND c.conrelid = 'public.schedule_sessions'::regclass;

SELECT COUNT(*) AS orphan_room_references
FROM public.schedule_sessions s
WHERE s.room_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.rooms r WHERE r.id = s.room_id);

-- Expect: orphan_room_references = 0 AND on_delete_behavior IN ('RESTRICT','NO ACTION')
-- CASCADE is forbidden (ROOM_FK_CASCADE_FORBIDDEN).

-- 5) Delete-integrity trigger present
SELECT
  t.tgname,
  p.proname
FROM pg_trigger t
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE t.tgrelid = 'public.rooms'::regclass
  AND t.tgname = 'trg_rooms_delete_integrity'
  AND p.proname = 'enforce_room_delete_integrity';

-- 6) Recent migration_executor audit markers (when applied)
SELECT action, details->>'actor' AS actor, created_at
FROM public.audit_logs
WHERE action IN (
  'EXPERIMENTAL_SCHEDULE_RESET',
  'ROOM_REFERENCE_HARDENING'
)
ORDER BY created_at DESC
LIMIT 20;
