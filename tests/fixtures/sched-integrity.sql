-- Track C scheduling-integrity fixture. Disposable database only; no production data.
-- Two colleges, one term each (overlapping dates), one draft version in college A with
-- :n_sessions conflict-free sessions (default 300), plus a merged lecture and two disjoint
-- lab partitions of one cohort. Runs inside the caller's transaction.
\if :{?n_sessions}
\else
\set n_sessions 300
\endif
CREATE SCHEMA IF NOT EXISTS tsched;
CREATE OR REPLACE FUNCTION tsched.id(text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT md5('tsched:'||$1)::uuid $$;
CREATE OR REPLACE FUNCTION tsched.as_user(p text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', tsched.id(p)::text, false),
         set_config('request.jwt.claims', json_build_object('sub', tsched.id(p), 'role', 'authenticated', 'aal', 'aal2')::text, false);
$$;
CREATE OR REPLACE FUNCTION tsched.assert(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'ASSERTION FAILED: %', msg; END IF; END $$;
GRANT USAGE ON SCHEMA tsched TO authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA tsched TO authenticated, service_role;

INSERT INTO public.universities(id, name) VALUES (tsched.id('uni'), 'جامعة اختبار');
INSERT INTO public.colleges(id, university_id, name, code) VALUES
  (tsched.id('A'), tsched.id('uni'), 'كلية أ', 'TSTA'),
  (tsched.id('B'), tsched.id('uni'), 'كلية ب', 'TSTB');
-- Account provisioning triggers are outside this fixture's scope.
ALTER TABLE auth.users DISABLE TRIGGER USER;
INSERT INTO auth.users(id, email) VALUES
  (tsched.id('admin-a'), 'a@test.invalid'), (tsched.id('admin-b'), 'b@test.invalid'),
  (tsched.id('super'), 's@test.invalid'), (tsched.id('viewer-a'), 'v@test.invalid');
ALTER TABLE auth.users ENABLE TRIGGER USER;
INSERT INTO public.user_roles(user_id, role) VALUES
  (tsched.id('admin-a'), 'college_admin'), (tsched.id('admin-b'), 'college_admin'),
  (tsched.id('super'), 'super_admin'), (tsched.id('viewer-a'), 'read_only')
ON CONFLICT DO NOTHING;
INSERT INTO public.user_colleges(user_id, college_id) VALUES
  (tsched.id('admin-a'), tsched.id('A')), (tsched.id('admin-b'), tsched.id('B')),
  (tsched.id('viewer-a'), tsched.id('A'))
ON CONFLICT DO NOTHING;

INSERT INTO public.academic_terms(id, college_id, name, code, start_date, end_date, is_active) VALUES
  (tsched.id('term-a'), tsched.id('A'), 'الفصل الأول', 'T1', '2026-09-01', '2027-01-15', true),
  (tsched.id('term-b'), tsched.id('B'), 'الفصل الأول', 'T1', '2026-09-01', '2027-01-15', true);
INSERT INTO public.departments(id, college_id, name, code) VALUES (tsched.id('dep-a'), tsched.id('A'), 'قسم', 'D');
INSERT INTO public.academic_programs(id, college_id, department_id, name, code)
  VALUES (tsched.id('prog-a'), tsched.id('A'), tsched.id('dep-a'), 'برنامج', 'P');
INSERT INTO public.academic_levels(id, college_id, program_id, name, level_number)
  VALUES (tsched.id('lvl-a'), tsched.id('A'), tsched.id('prog-a'), 'المستوى 1', 1);
INSERT INTO public.study_plans(id, college_id, program_id, name, code)
  VALUES (tsched.id('plan-a'), tsched.id('A'), tsched.id('prog-a'), 'خطة', 'SP');

INSERT INTO public.courses(id, college_id, department_id, code, name)
SELECT tsched.id('course-'||n), tsched.id('A'), tsched.id('dep-a'), 'C'||n, 'مقرر '||n FROM generate_series(0, 29) n;
INSERT INTO public.course_offerings(id, college_id, term_id, course_id, expected_students, enrollment_count_status)
SELECT tsched.id('off-'||n), tsched.id('A'), tsched.id('term-a'), tsched.id('course-'||n), 30, 'confirmed' FROM generate_series(0, 29) n;
-- Replay drift: a later HR trigger expects this column (absent when its migration failed to replay).
ALTER TABLE public.instructors ADD COLUMN IF NOT EXISTS administrative_support_department_id uuid;
INSERT INTO public.instructors(id, college_id, full_name, availability_status)
SELECT tsched.id('ins-'||n), tsched.id('A'), 'محاضر '||n, 'available' FROM generate_series(0, 44) n;
INSERT INTO public.rooms(id, college_id, code, name, capacity, room_type)
SELECT tsched.id('room-'||n), tsched.id('A'), 'R'||n, 'قاعة '||n, 100, 'lecture_hall' FROM generate_series(0, 44) n;

-- Replay drift: session triggers read shared_lecture_links (installed from supabase/sql in production).
CREATE TABLE IF NOT EXISTS public.shared_lecture_links (
  member_group_id uuid PRIMARY KEY, anchor_group_id uuid NOT NULL, college_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now());
DO $drift$ BEGIN
  IF to_regprocedure('public.shared_lecture_group_ids(uuid)') IS NULL THEN
    -- Same definition as supabase/sql/shared_lectures.sql.
    EXECUTE $f$CREATE FUNCTION public.shared_lecture_group_ids(p_group uuid)
      RETURNS TABLE(group_id uuid) LANGUAGE sql STABLE SET search_path = '' AS $b$
      WITH anchor AS (SELECT COALESCE((SELECT anchor_group_id FROM public.shared_lecture_links WHERE member_group_id=p_group),p_group) id)
      SELECT id FROM anchor UNION SELECT l.member_group_id FROM public.shared_lecture_links l JOIN anchor a ON a.id=l.anchor_group_id;
      $b$$f$;
  END IF;
END $drift$;
INSERT INTO public.schedule_versions(id, college_id, academic_term_id, name, status)
VALUES (tsched.id('ver-a'), tsched.id('A'), tsched.id('term-a'), 'مسودة الاختبار', 'draft');

-- :n_sessions (<= 600) conflict-free sessions: room r / instructor r (40 of each), 3 slots/day,
-- days 0-4. Instructors/rooms 40-44 stay free for tests; 30-32 also teach the Friday groups.
-- Perf runs may skip row triggers for this synthetic bulk setup only (the pre-existing
-- per-row coordination check is quadratic); the data is conflict-free by construction.
\if :{?fast_fixture}
SET LOCAL session_replication_role = replica;
\endif
INSERT INTO public.schedule_sessions(id, college_id, schedule_version_id, course_offering_id,
  instructor_id, room_id, study_system, day_of_week, start_time, end_time, session_type, expected_students)
SELECT tsched.id('s-'||i), tsched.id('A'), tsched.id('ver-a'), tsched.id('off-'||(i % 30)),
  tsched.id('ins-'||(i % 40)), tsched.id('room-'||(i % 40)), 'regular',
  (i / 120) % 5, time '08:00' + ((i / 40) % 3) * interval '2 hours',
  time '10:00' + ((i / 40) % 3) * interval '2 hours', 'lecture', 30
FROM generate_series(0, :n_sessions - 1) i;
\if :{?fast_fixture}
SET LOCAL session_replication_role = origin;
\endif

-- Student structure: cohort c1 with two disjoint partitions (two labs + one member group of a
-- merged lecture), cohort c2 owning the anchor group of that merged lecture.
INSERT INTO public.plan_courses(id, college_id, study_plan_id, course_id)
  VALUES (tsched.id('pc'), tsched.id('A'), tsched.id('plan-a'), tsched.id('course-29'));
INSERT INTO public.plan_course_components(id, college_id, plan_course_id, component_type, weekly_contact_hours) VALUES
  (tsched.id('cmp-th'), tsched.id('A'), tsched.id('pc'), 'theory', 2),
  (tsched.id('cmp-pr'), tsched.id('A'), tsched.id('pc'), 'practical', 2);
INSERT INTO public.academic_cohorts(id, college_id, program_id, level_id, study_system, entry_year, term_id, expected_students) VALUES
  (tsched.id('c1'), tsched.id('A'), tsched.id('prog-a'), tsched.id('lvl-a'), 'regular', 2026, tsched.id('term-a'), 40),
  (tsched.id('c2'), tsched.id('A'), tsched.id('prog-a'), tsched.id('lvl-a'), 'parallel', 2026, tsched.id('term-a'), 20);
INSERT INTO public.cohort_student_partitions(id, college_id, cohort_id, partition_code, headcount) VALUES
  (tsched.id('p1'), tsched.id('A'), tsched.id('c1'), 'P1', 20),
  (tsched.id('p2'), tsched.id('A'), tsched.id('c1'), 'P2', 20),
  (tsched.id('p3'), tsched.id('A'), tsched.id('c2'), 'P3', 20);
INSERT INTO public.delivery_groups(id, college_id, cohort_id, plan_course_id, component_id, group_code, expected_students) VALUES
  (tsched.id('dg-lab1'), tsched.id('A'), tsched.id('c1'), tsched.id('pc'), tsched.id('cmp-pr'), 'LAB1', 20),
  (tsched.id('dg-lab2'), tsched.id('A'), tsched.id('c1'), tsched.id('pc'), tsched.id('cmp-pr'), 'LAB2', 20),
  (tsched.id('dg-member'), tsched.id('A'), tsched.id('c1'), tsched.id('pc'), tsched.id('cmp-th'), 'TH-C1', 40),
  (tsched.id('dg-anchor'), tsched.id('A'), tsched.id('c2'), tsched.id('pc'), tsched.id('cmp-th'), 'TH-C2', 20);
INSERT INTO public.delivery_group_partition_members(college_id, cohort_id, delivery_group_id, partition_id) VALUES
  (tsched.id('A'), tsched.id('c1'), tsched.id('dg-lab1'), tsched.id('p1')),
  (tsched.id('A'), tsched.id('c1'), tsched.id('dg-lab2'), tsched.id('p2')),
  (tsched.id('A'), tsched.id('c1'), tsched.id('dg-member'), tsched.id('p1')),
  (tsched.id('A'), tsched.id('c1'), tsched.id('dg-member'), tsched.id('p2')),
  (tsched.id('A'), tsched.id('c2'), tsched.id('dg-anchor'), tsched.id('p3'));

-- Group sessions on Friday (day 5), outside the generated grid. Delivery-group freshness
-- derivation is outside this fixture's scope; its guard is disabled for the setup inserts only.
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE public.schedule_sessions DISABLE TRIGGER trg_schedule_session_current_delivery_group;
INSERT INTO public.schedule_sessions(id, college_id, schedule_version_id, course_offering_id, instructor_id,
  room_id, day_of_week, start_time, end_time, session_type, expected_students, cohort_id, delivery_group_id, plan_course_component_id)
VALUES
  -- the merged lecture, stored once on the anchor group (cohort c2)
  (tsched.id('s-anchor'), tsched.id('A'), tsched.id('ver-a'), tsched.id('off-29'), tsched.id('ins-30'),
   tsched.id('room-30'), 5, '08:00', '10:00', 'lecture', 60, tsched.id('c2'), tsched.id('dg-anchor'), tsched.id('cmp-th')),
  -- two disjoint lab partitions of c1 in parallel, 10:00-12:00
  (tsched.id('s-lab1'), tsched.id('A'), tsched.id('ver-a'), tsched.id('off-29'), tsched.id('ins-31'),
   tsched.id('room-31'), 5, '10:00', '12:00', 'lab', 20, tsched.id('c1'), tsched.id('dg-lab1'), tsched.id('cmp-pr')),
  (tsched.id('s-lab2'), tsched.id('A'), tsched.id('ver-a'), tsched.id('off-29'), tsched.id('ins-32'),
   tsched.id('room-32'), 5, '10:00', '12:00', 'lab', 20, tsched.id('c1'), tsched.id('dg-lab2'), tsched.id('cmp-pr'));
ALTER TABLE public.schedule_sessions ENABLE TRIGGER trg_schedule_session_current_delivery_group;
SET CONSTRAINTS ALL DEFERRED;
-- Link the merged member after the anchor session exists (shared-lecture windows are out of scope).
INSERT INTO public.shared_lecture_links(member_group_id, anchor_group_id, college_id)
  VALUES (tsched.id('dg-member'), tsched.id('dg-anchor'), tsched.id('A'));


-- Fresh quality evidence helper (the gate still requires a quality run at the current revision).
CREATE OR REPLACE FUNCTION tsched.quality(p_version uuid, p_forged_hard integer DEFAULT 0) RETURNS uuid
LANGUAGE sql AS $$
  SELECT public.persist_schedule_quality_run(v.college_id, v.id, v.eligibility_revision, 100,
    p_forged_hard, 0, 0, '{}'::jsonb)
  FROM public.schedule_versions v WHERE v.id = p_version
$$;
GRANT EXECUTE ON FUNCTION tsched.quality(uuid, integer) TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA tsched TO authenticated;
