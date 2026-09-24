-- JAWF-STUDENT-PARTITIONS-02 — scoped DATA apply for Jawf Level 1 only.
-- PROPOSED ONLY. Not applied by the agent. Root applies through run_sql after
-- the schema migration succeeds. Idempotent; touches no schedule sessions.
--
-- Approved model: 120 students = 4 anonymous partitions of 30 (P1..P4).
--   theory G1  -> P1, P2      theory G2  -> P3, P4
--   practical G1 -> P1   G2 -> P2   G3 -> P3   G4 -> P4
-- Applies to every course of the cohort. Obsolete/inactive groups are skipped.

BEGIN;

-- Guard: exactly one target cohort in the target college/program/term.
DO $$
DECLARE v_ok integer;
BEGIN
  SELECT count(*) INTO v_ok
  FROM public.academic_cohorts ac
  WHERE ac.id = 'a54be564-b9cc-4c23-8b02-504453100123'
    AND ac.college_id = '7168345f-cf9d-4789-b2ad-547abb687dc8'
    AND ac.program_id = 'dd991d15-aef5-4e3e-a59d-724a89ee1f66'
    AND ac.term_id = '18dd364a-76d7-40b8-a217-fa929c082a7f';
  IF v_ok <> 1 THEN
    RAISE EXCEPTION 'TARGET_COHORT_MISMATCH: aborting scoped data apply';
  END IF;
END $$;

-- 1. Four anonymous partitions of 30.
INSERT INTO public.cohort_student_partitions
  (college_id, cohort_id, partition_code, headcount, active)
SELECT '7168345f-cf9d-4789-b2ad-547abb687dc8',
       'a54be564-b9cc-4c23-8b02-504453100123',
       code, 30, true
FROM (VALUES ('P1'), ('P2'), ('P3'), ('P4')) AS v(code)
ON CONFLICT (cohort_id, partition_code) DO NOTHING;

-- 2. Theory groups: G1 -> P1,P2 ; G2 -> P3,P4.
INSERT INTO public.delivery_group_partition_members
  (college_id, cohort_id, delivery_group_id, partition_id)
SELECT dg.college_id, dg.cohort_id, dg.id, p.id
FROM public.delivery_groups dg
JOIN public.plan_course_components pcc ON pcc.id = dg.component_id
JOIN public.cohort_student_partitions p ON p.cohort_id = dg.cohort_id
WHERE dg.cohort_id = 'a54be564-b9cc-4c23-8b02-504453100123'
  AND dg.college_id = '7168345f-cf9d-4789-b2ad-547abb687dc8'
  AND dg.active AND NOT dg.is_obsolete
  AND pcc.component_type IN ('theory', 'tutorial')
  AND (
       (dg.group_number = 1 AND p.partition_code IN ('P1', 'P2'))
    OR (dg.group_number = 2 AND p.partition_code IN ('P3', 'P4'))
  )
ON CONFLICT (delivery_group_id, partition_id) DO NOTHING;

-- 3. Practical groups: Gn -> Pn.
INSERT INTO public.delivery_group_partition_members
  (college_id, cohort_id, delivery_group_id, partition_id)
SELECT dg.college_id, dg.cohort_id, dg.id, p.id
FROM public.delivery_groups dg
JOIN public.plan_course_components pcc ON pcc.id = dg.component_id
JOIN public.cohort_student_partitions p ON p.cohort_id = dg.cohort_id
WHERE dg.cohort_id = 'a54be564-b9cc-4c23-8b02-504453100123'
  AND dg.college_id = '7168345f-cf9d-4789-b2ad-547abb687dc8'
  AND dg.active AND NOT dg.is_obsolete
  AND pcc.component_type IN ('practical', 'lab')
  AND dg.group_number BETWEEN 1 AND 4
  AND p.partition_code = 'P' || dg.group_number::text
ON CONFLICT (delivery_group_id, partition_id) DO NOTHING;

-- 4. Coverage guard: every active group must be fully covered, or abort.
DO $$
DECLARE v_bad integer;
BEGIN
  SELECT count(*) INTO v_bad
  FROM public.delivery_groups dg
  WHERE dg.cohort_id = 'a54be564-b9cc-4c23-8b02-504453100123'
    AND dg.active AND NOT dg.is_obsolete
    AND COALESCE((
      SELECT sum(p.headcount)
      FROM public.delivery_group_partition_members m
      JOIN public.cohort_student_partitions p ON p.id = m.partition_id AND p.active
      WHERE m.delivery_group_id = dg.id
    ), 0) < dg.expected_students;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'PARTITION_COVERAGE_INCOMPLETE: % groups uncovered', v_bad;
  END IF;
END $$;

COMMIT;
