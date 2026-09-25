\set ON_ERROR_STOP on

-- Disposable PostgreSQL fixture for proposed Stage ITCS-ISO-01.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
CREATE FUNCTION public.can_view_college(p_user uuid, p_college uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT p_user = '11111111-1111-1111-1111-111111111111'::uuid
     AND p_college = '7168345f-cf9d-4789-b2ad-547abb687dc8'::uuid
$$;

CREATE TABLE public.colleges(id uuid PRIMARY KEY);
CREATE TABLE public.schedule_versions(
  id uuid PRIMARY KEY, college_id uuid NOT NULL, academic_term_id uuid NOT NULL, status text NOT NULL
);
CREATE TABLE public.academic_cohorts(
  id uuid PRIMARY KEY, college_id uuid NOT NULL, term_id uuid NOT NULL,
  code text NOT NULL, expected_students integer NOT NULL
);
CREATE TABLE public.scheduling_cohort_term_headcounts(
  id uuid PRIMARY KEY, cohort_id uuid NOT NULL, college_id uuid NOT NULL,
  term_id uuid NOT NULL, approval_status text NOT NULL, scheduling_headcount integer NOT NULL
);
CREATE TABLE public.cohort_student_partitions(
  id uuid PRIMARY KEY, cohort_id uuid NOT NULL, partition_code text NOT NULL, headcount integer NOT NULL
);
CREATE TABLE public.delivery_groups(
  id uuid PRIMARY KEY, cohort_id uuid NOT NULL, college_id uuid NOT NULL,
  group_code text NOT NULL, expected_students integer NOT NULL
);
CREATE TABLE public.delivery_group_partition_members(
  id uuid PRIMARY KEY, cohort_id uuid NOT NULL, delivery_group_id uuid NOT NULL, partition_id uuid NOT NULL
);
CREATE TABLE public.shared_lecture_links(anchor_group_id uuid NOT NULL, member_group_id uuid NOT NULL);
CREATE TABLE public.teaching_assignments(id uuid PRIMARY KEY, cohort_id uuid NOT NULL, delivery_group_id uuid NOT NULL);
CREATE TABLE public.course_offerings(id uuid PRIMARY KEY, expected_students integer NOT NULL);
CREATE TABLE public.schedule_sessions(
  id uuid PRIMARY KEY, schedule_version_id uuid NOT NULL, cohort_id uuid,
  course_offering_id uuid NOT NULL
);

INSERT INTO public.colleges VALUES ('7168345f-cf9d-4789-b2ad-547abb687dc8');
INSERT INTO public.schedule_versions VALUES (
  '30f8a76d-1cb9-4944-a5d7-483dcaea7692',
  '7168345f-cf9d-4789-b2ad-547abb687dc8',
  '18dd364a-76d7-40b8-a217-fa929c082a7f', 'published'
);
INSERT INTO public.schedule_versions VALUES (
  'd68d8d22-9a6d-4f21-935f-cebf18bb969b',
  '7168345f-cf9d-4789-b2ad-547abb687dc8',
  '18dd364a-76d7-40b8-a217-fa929c082a7f', 'draft'
);
INSERT INTO public.academic_cohorts VALUES
  ('ebfc0dee-f291-4f6d-a974-d3ed1df96f3e','7168345f-cf9d-4789-b2ad-547abb687dc8','18dd364a-76d7-40b8-a217-fa929c082a7f','CYB-P-L1-2026',110),
  ('f8188b18-207a-4543-a3f7-89b4e8fad293','7168345f-cf9d-4789-b2ad-547abb687dc8','18dd364a-76d7-40b8-a217-fa929c082a7f','IT-P-L1-2026',75),
  ('961e5b4e-12a6-4abd-a899-a317e73b102c','7168345f-cf9d-4789-b2ad-547abb687dc8','18dd364a-76d7-40b8-a217-fa929c082a7f','CIS-JF-L1-2026',120),
  ('e1b6b48f-fe69-4020-b5b1-188397298174','7168345f-cf9d-4789-b2ad-547abb687dc8','18dd364a-76d7-40b8-a217-fa929c082a7f','CS-P-L1-2026',75),
  ('862518d3-7d85-414e-92d2-a4c3feefc2b8','7168345f-cf9d-4789-b2ad-547abb687dc8','18dd364a-76d7-40b8-a217-fa929c082a7f','CIS-P-L1-2026',40);
INSERT INTO public.scheduling_cohort_term_headcounts
  SELECT gen_random_uuid(), id, college_id, term_id, 'approved', expected_students
  FROM public.academic_cohorts;
INSERT INTO public.cohort_student_partitions
  SELECT gen_random_uuid(), id, 'A001', expected_students FROM public.academic_cohorts;
INSERT INTO public.delivery_groups
  SELECT gen_random_uuid(), id, college_id, 'G1', expected_students FROM public.academic_cohorts;
INSERT INTO public.delivery_group_partition_members
  SELECT gen_random_uuid(), g.cohort_id, g.id, p.id
  FROM public.delivery_groups g JOIN public.cohort_student_partitions p ON p.cohort_id = g.cohort_id;
INSERT INTO public.shared_lecture_links
  SELECT a.id, m.id FROM public.delivery_groups a CROSS JOIN public.delivery_groups m
  WHERE a.cohort_id = 'ebfc0dee-f291-4f6d-a974-d3ed1df96f3e'
    AND m.cohort_id = '862518d3-7d85-414e-92d2-a4c3feefc2b8';
INSERT INTO public.teaching_assignments
  SELECT gen_random_uuid(), cohort_id, id FROM public.delivery_groups;
INSERT INTO public.course_offerings
  SELECT gen_random_uuid(), expected_students FROM public.academic_cohorts;

-- Five target cohort sessions plus 270 other ITCS sessions: exactly 275.
WITH numbered AS (
  SELECT id, row_number() OVER (ORDER BY id) AS n FROM public.academic_cohorts
), offerings AS (
  SELECT id, row_number() OVER (ORDER BY id) AS n FROM public.course_offerings
)
INSERT INTO public.schedule_sessions
SELECT gen_random_uuid(), '30f8a76d-1cb9-4944-a5d7-483dcaea7692',
  CASE WHEN s.n <= 5 THEN (SELECT id FROM numbered WHERE n = s.n) ELSE NULL END,
  (SELECT id FROM offerings WHERE n = 1)
FROM generate_series(1,275) AS s(n);
INSERT INTO public.schedule_sessions
SELECT gen_random_uuid(), 'd68d8d22-9a6d-4f21-935f-cebf18bb969b', NULL,
  (SELECT id FROM public.course_offerings ORDER BY id LIMIT 1)
FROM generate_series(1,275);

\ir ../docs/migrations-proposed/20260925_itcs_v2_delivery_baseline.sql

DO $assert$
DECLARE n integer; v jsonb;
BEGIN
  SELECT count(*) INTO n FROM public.schedule_version_delivery_baselines;
  IF n <> 5 THEN RAISE EXCEPTION 'expected five baseline rows, got %', n; END IF;
  IF (SELECT count(*) FROM public.schedule_sessions WHERE schedule_version_id =
      '30f8a76d-1cb9-4944-a5d7-483dcaea7692') <> 275 THEN
    RAISE EXCEPTION 'published sessions changed';
  END IF;
  IF (SELECT sum(expected_students) FROM public.academic_cohorts) <> 420 THEN
    RAISE EXCEPTION 'global counts changed';
  END IF;
  SELECT payload INTO v FROM public.schedule_version_delivery_baselines
  WHERE cohort_id = 'ebfc0dee-f291-4f6d-a974-d3ed1df96f3e';
  IF jsonb_array_length(v->'shared_links') <> 1
    OR jsonb_array_length(v->'shared_partner_groups') <> 1
    OR (v->'cohort'->>'expected_students')::int <> 110 THEN
    RAISE EXCEPTION 'shared published baseline incomplete';
  END IF;
  BEGIN
    UPDATE public.schedule_version_delivery_baselines SET payload='{}';
    RAISE EXCEPTION 'update should have been rejected';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    DELETE FROM public.schedule_version_delivery_baselines;
    RAISE EXCEPTION 'delete should have been rejected';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$assert$;

\ir ../docs/migrations-proposed/20260925_itcs_version_scoped_facts.sql

DO $assert$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM schedule_version_delivery_private.scope;
  IF n <> 10 THEN RAISE EXCEPTION 'expected ten version/cohort scope rows, got %', n; END IF;
  IF (SELECT count(*) FROM schedule_version_delivery_private.group_facts) <> 10
     OR (SELECT count(*) FROM schedule_version_delivery_private.partition_facts) <> 10
     OR (SELECT count(*) FROM schedule_version_delivery_private.group_partition_facts) <> 10
     OR (SELECT count(*) FROM schedule_version_delivery_private.shared_link_facts) <> 2 THEN
    RAISE EXCEPTION 'versioned group or partition seed incomplete';
  END IF;
  BEGIN
    UPDATE schedule_version_delivery_private.cohort_facts SET expected_students=140
    WHERE version_id='30f8a76d-1cb9-4944-a5d7-483dcaea7692'
      AND cohort_id='ebfc0dee-f291-4f6d-a974-d3ed1df96f3e';
    RAISE EXCEPTION 'published cohort fact must be immutable';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO schedule_version_delivery_private.partition_facts
      (version_id,partition_id,cohort_id,college_id,partition_code,headcount)
    VALUES (
      '30f8a76d-1cb9-4944-a5d7-483dcaea7692',
      '00000000-0000-0000-0000-000000000099',
      'ebfc0dee-f291-4f6d-a974-d3ed1df96f3e',
      '7168345f-cf9d-4789-b2ad-547abb687dc8','UNAPPROVED',1
    );
    RAISE EXCEPTION 'published version must reject appended facts';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE schedule_version_delivery_private.cohort_facts
  SET expected_students=140,scheduling_headcount=140
  WHERE version_id='d68d8d22-9a6d-4f21-935f-cebf18bb969b'
    AND cohort_id='ebfc0dee-f291-4f6d-a974-d3ed1df96f3e';
  IF (SELECT expected_students FROM schedule_version_delivery_private.cohort_facts
      WHERE version_id='30f8a76d-1cb9-4944-a5d7-483dcaea7692'
        AND cohort_id='ebfc0dee-f291-4f6d-a974-d3ed1df96f3e') <> 110 THEN
    RAISE EXCEPTION 'published fact changed with draft';
  END IF;
  BEGIN
    UPDATE schedule_version_delivery_private.group_facts SET expected_students=999
    WHERE version_id='30f8a76d-1cb9-4944-a5d7-483dcaea7692'
      AND cohort_id='ebfc0dee-f291-4f6d-a974-d3ed1df96f3e';
    RAISE EXCEPTION 'published group fact must be immutable';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE schedule_version_delivery_private.scope SET college_id='00000000-0000-0000-0000-000000000000'
    WHERE version_id='d68d8d22-9a6d-4f21-935f-cebf18bb969b'
      AND cohort_id='ebfc0dee-f291-4f6d-a974-d3ed1df96f3e';
    RAISE EXCEPTION 'cross-college scope must be rejected';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO schedule_version_delivery_private.group_partition_facts
      (version_id,group_id,partition_id)
    SELECT 'd68d8d22-9a6d-4f21-935f-cebf18bb969b',g.group_id,p.partition_id
    FROM schedule_version_delivery_private.group_facts g
    CROSS JOIN schedule_version_delivery_private.partition_facts p
    WHERE g.version_id='d68d8d22-9a6d-4f21-935f-cebf18bb969b'
      AND p.version_id=g.version_id
      AND g.cohort_id='ebfc0dee-f291-4f6d-a974-d3ed1df96f3e'
      AND p.cohort_id='862518d3-7d85-414e-92d2-a4c3feefc2b8';
    RAISE EXCEPTION 'cross-cohort student membership must be rejected';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    DELETE FROM schedule_version_delivery_private.group_partition_facts m
    USING schedule_version_delivery_private.group_facts g
    WHERE m.version_id=g.version_id AND m.group_id=g.group_id
      AND g.version_id='d68d8d22-9a6d-4f21-935f-cebf18bb969b'
      AND g.cohort_id='ebfc0dee-f291-4f6d-a974-d3ed1df96f3e';
    DELETE FROM schedule_version_delivery_private.group_facts
    WHERE version_id='d68d8d22-9a6d-4f21-935f-cebf18bb969b'
      AND cohort_id='ebfc0dee-f291-4f6d-a974-d3ed1df96f3e';
    PERFORM set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);
    PERFORM public.effective_schedule_group_fact(
      'd68d8d22-9a6d-4f21-935f-cebf18bb969b',
      (SELECT id FROM public.delivery_groups
       WHERE cohort_id='ebfc0dee-f291-4f6d-a974-d3ed1df96f3e' LIMIT 1));
    RAISE EXCEPTION 'missing scoped group fact must fail closed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF (SELECT count(*) FROM schedule_version_delivery_private.group_facts) <> 10 THEN
    RAISE EXCEPTION 'negative test left a deleted group fact';
  END IF;
END;
$assert$;

SET ROLE authenticated;
SET request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
DO $assert$
BEGIN
  IF (SELECT count(*) FROM public.schedule_version_delivery_baselines) <> 5 THEN
    RAISE EXCEPTION 'ITCS viewer cannot read its baseline';
  END IF;
  IF (public.effective_schedule_cohort_fact(
       '30f8a76d-1cb9-4944-a5d7-483dcaea7692',
       'ebfc0dee-f291-4f6d-a974-d3ed1df96f3e')->>'expected_students')::int <> 110
     OR (public.effective_schedule_cohort_fact(
       'd68d8d22-9a6d-4f21-935f-cebf18bb969b',
       'ebfc0dee-f291-4f6d-a974-d3ed1df96f3e')->>'expected_students')::int <> 140 THEN
    RAISE EXCEPTION 'versioned cohort read did not isolate published and draft';
  END IF;
  IF (SELECT scheduling_headcount FROM public.schedule_version_cohort_facts(
       '30f8a76d-1cb9-4944-a5d7-483dcaea7692',
       ARRAY['ebfc0dee-f291-4f6d-a974-d3ed1df96f3e']::uuid[])) <> 110
     OR (SELECT scheduling_headcount FROM public.schedule_version_cohort_facts(
       'd68d8d22-9a6d-4f21-935f-cebf18bb969b',
       ARRAY['ebfc0dee-f291-4f6d-a974-d3ed1df96f3e']::uuid[])) <> 140 THEN
    RAISE EXCEPTION 'batch versioned read did not preserve source headcounts';
  END IF;
END;
$assert$;
SET request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
DO $assert$
BEGIN
  IF (SELECT count(*) FROM public.schedule_version_delivery_baselines) <> 0 THEN
    RAISE EXCEPTION 'cross-college viewer saw the baseline';
  END IF;
  BEGIN
    PERFORM public.effective_schedule_cohort_fact(
      '30f8a76d-1cb9-4944-a5d7-483dcaea7692',
      'ebfc0dee-f291-4f6d-a974-d3ed1df96f3e');
    RAISE EXCEPTION 'cross-college viewer obtained a cohort fact';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.schedule_version_cohort_facts(
      '30f8a76d-1cb9-4944-a5d7-483dcaea7692',
      ARRAY['ebfc0dee-f291-4f6d-a974-d3ed1df96f3e']::uuid[]);
    RAISE EXCEPTION 'cross-college viewer obtained batch facts';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$assert$;
RESET ROLE;
