-- JAWF-STUDENT-PARTITIONS-02 — preflight / postverify / rollback.
-- PROPOSED ONLY, read-only except the clearly marked rollback section.

-- ============================ PREFLIGHT (read-only) ==========================
-- P1. target cohort identity (expect exactly 1)
SELECT count(*) AS target_cohort_rows
FROM public.academic_cohorts ac
WHERE ac.id = 'a54be564-b9cc-4c23-8b02-504453100123'
  AND ac.college_id = '7168345f-cf9d-4789-b2ad-547abb687dc8'
  AND ac.program_id = 'dd991d15-aef5-4e3e-a59d-724a89ee1f66'
  AND ac.term_id = '18dd364a-76d7-40b8-a217-fa929c082a7f';

-- P2. active non-obsolete delivery groups (expect 18)
SELECT count(*) AS active_groups
FROM public.delivery_groups
WHERE cohort_id = 'a54be564-b9cc-4c23-8b02-504453100123'
  AND active AND NOT is_obsolete;

-- P3. tables must not exist yet (expect 0)
SELECT count(*) AS partition_tables
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('cohort_student_partitions', 'delivery_group_partition_members');

-- P4. current overlap helper fingerprint (record before/after)
SELECT md5(pg_get_functiondef(p.oid)) AS overlap_fn_md5
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = '_sb_v2_delivery_group_overlap';

-- P5. sessions of the working draft version (record; must not change)
SELECT count(*) AS draft_sessions
FROM public.schedule_sessions
WHERE schedule_version_id = '9ed1e0a2-bd5c-4515-bd62-6ab5854062c7';

-- =========================== POSTVERIFY (read-only) ==========================
-- V1. partitions (expect 4 rows, headcount 30 each, total 120)
SELECT partition_code, headcount, active
FROM public.cohort_student_partitions
WHERE cohort_id = 'a54be564-b9cc-4c23-8b02-504453100123'
ORDER BY partition_code;

-- V2. membership counts per group (theory expect 2, practical expect 1)
SELECT pcc.component_type, dg.group_code, count(m.id) AS partitions
FROM public.delivery_groups dg
JOIN public.plan_course_components pcc ON pcc.id = dg.component_id
LEFT JOIN public.delivery_group_partition_members m ON m.delivery_group_id = dg.id
WHERE dg.cohort_id = 'a54be564-b9cc-4c23-8b02-504453100123'
  AND dg.active AND NOT dg.is_obsolete
GROUP BY 1, 2 ORDER BY 1, 2;

-- V3. coverage complete for every active group (expect 0 rows)
SELECT dg.id, dg.group_code, dg.expected_students
FROM public.delivery_groups dg
WHERE dg.cohort_id = 'a54be564-b9cc-4c23-8b02-504453100123'
  AND dg.active AND NOT dg.is_obsolete
  AND COALESCE((
    SELECT sum(p.headcount) FROM public.delivery_group_partition_members m
    JOIN public.cohort_student_partitions p ON p.id = m.partition_id AND p.active
    WHERE m.delivery_group_id = dg.id
  ), 0) < dg.expected_students;

-- V4. semantics probe on real ids of JIS-L1-003 (theory G1/G2, practical G1..G4)
--     expect: theory G1 vs theory G2 = false (disjoint)
--             theory G1 vs practical G1 = true, vs practical G2 = true
--             theory G1 vs practical G3 = false, vs practical G4 = false
--             practical G1 vs practical G2 = false
SELECT a.group_code AS a_group, ca.component_type AS a_type,
       b.group_code AS b_group, cb.component_type AS b_type,
       public.delivery_groups_share_students(a.id, b.id) AS share_students
FROM public.delivery_groups a
JOIN public.plan_course_components ca ON ca.id = a.component_id
JOIN public.delivery_groups b ON b.cohort_id = a.cohort_id AND b.id <> a.id
JOIN public.plan_course_components cb ON cb.id = b.component_id
WHERE a.cohort_id = 'a54be564-b9cc-4c23-8b02-504453100123'
  AND a.active AND NOT a.is_obsolete AND b.active AND NOT b.is_obsolete
ORDER BY a_type, a_group, b_type, b_group;

-- V5. cross-cohort pairs must never be reported as sharing (expect 0 rows)
SELECT count(*) AS cross_cohort_shared
FROM public.delivery_groups a
JOIN public.delivery_groups b ON b.cohort_id <> a.cohort_id
WHERE a.cohort_id = 'a54be564-b9cc-4c23-8b02-504453100123'
  AND public.delivery_groups_share_students(a.id, b.id) IS TRUE;

-- V6. security posture (expect fixed search_path, no anon EXECUTE)
SELECT p.proname, p.prosecdef, p.proconfig, p.proacl
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('delivery_groups_share_students', '_sb_v2_delivery_group_overlap',
                    'ensure_csp_cohort_college', 'ensure_dgpm_consistency');

-- V7. RLS enabled + policy counts (expect 4 policies each, rowsecurity true)
SELECT c.relname, c.relrowsecurity, count(pol.polname) AS policies
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
LEFT JOIN pg_policy pol ON pol.polrelid = c.oid
WHERE c.relname IN ('cohort_student_partitions', 'delivery_group_partition_members')
GROUP BY 1, 2;

-- V8. no schedule sessions were touched (compare with P5)
SELECT count(*) AS draft_sessions
FROM public.schedule_sessions
WHERE schedule_version_id = '9ed1e0a2-bd5c-4515-bd62-6ab5854062c7';

-- ============================== ROLLBACK (writes) ============================
-- Restores the previous cohort-wide behaviour and removes the mapping.
-- BEGIN;
--   CREATE OR REPLACE FUNCTION public._sb_v2_delivery_group_overlap(
--     p_schedule_version_id uuid, p_delivery_group_id uuid, p_cohort_id uuid,
--     p_day_of_week integer, p_start_time time without time zone,
--     p_end_time time without time zone, p_exclude_session_id uuid DEFAULT NULL::uuid)
--   RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
--   AS $function$
--   DECLARE v_peer record; v_conflicts jsonb := '[]'::jsonb;
--   BEGIN
--     IF p_delivery_group_id IS NULL AND p_cohort_id IS NULL THEN RETURN v_conflicts; END IF;
--     FOR v_peer IN
--       SELECT ss.id, ss.delivery_group_id, ss.cohort_id
--       FROM public.schedule_sessions ss
--       WHERE ss.schedule_version_id = p_schedule_version_id
--         AND ss.day_of_week = p_day_of_week
--         AND ss.start_time < p_end_time AND p_start_time < ss.end_time
--         AND (p_exclude_session_id IS NULL OR ss.id <> p_exclude_session_id)
--         AND ((p_delivery_group_id IS NOT NULL AND ss.delivery_group_id = p_delivery_group_id)
--           OR (p_cohort_id IS NOT NULL AND ss.cohort_id = p_cohort_id))
--     LOOP
--       v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
--         'code', 'delivery_group_conflict', 'severity', 'hard',
--         'message_ar', 'تعارض مجموعة التدريس / الدفعة: توجد جلسة متداخلة لنفس المجموعة.',
--         'message_en', 'Delivery group / cohort conflict: overlapping session for the same group.',
--         'related_session_id', v_peer.id,
--         'metadata', jsonb_build_object('delivery_group_id', v_peer.delivery_group_id,
--                                        'cohort_id', v_peer.cohort_id)));
--     END LOOP;
--     RETURN v_conflicts;
--   END; $function$;
--   DROP TRIGGER IF EXISTS trg_dgpm_consistency ON public.delivery_group_partition_members;
--   DROP TRIGGER IF EXISTS trg_csp_cohort_college ON public.cohort_student_partitions;
--   DROP TABLE IF EXISTS public.delivery_group_partition_members;
--   DROP TABLE IF EXISTS public.cohort_student_partitions;
--   DROP FUNCTION IF EXISTS public.delivery_groups_share_students(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.ensure_dgpm_consistency();
--   DROP FUNCTION IF EXISTS public.ensure_csp_cohort_college();
-- COMMIT;
