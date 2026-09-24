-- Post-apply verification helpers (manual / apply phase — not executed by design PR).

-- Remaining offerings on target term
SELECT COUNT(*) AS remaining_on_target
FROM public.course_offerings
WHERE term_id = '18dd364a-76d7-40b8-a217-fa929c082a7f';

-- Orphan term references
SELECT COUNT(*) AS orphan_term_references
FROM public.course_offerings co
WHERE NOT EXISTS (SELECT 1 FROM public.academic_terms t WHERE t.id = co.term_id);

-- FK validated + RESTRICT
SELECT c.convalidated, c.confdeltype
FROM pg_constraint c
WHERE c.conname = 'course_offerings_term_id_fkey'
  AND c.conrelid = 'public.course_offerings'::regclass;
-- expect convalidated=true, confdeltype='r'
