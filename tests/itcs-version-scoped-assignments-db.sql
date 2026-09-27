\set ON_ERROR_STOP on
-- Disposable proof for docs/migrations-proposed/20260927_itcs_version_scoped_assignments.sql
-- Never run against production. Models only the columns the migration reads.
SET client_min_messages = warning;
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

CREATE TABLE public.managers(user_id uuid, college_id uuid);
CREATE FUNCTION public.can_manage_college(u uuid, c uuid) RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT EXISTS (SELECT 1 FROM public.managers WHERE user_id = u AND college_id = c) $$;
CREATE TABLE public.schedule_versions(id uuid PRIMARY KEY, college_id uuid NOT NULL, status text NOT NULL);
CREATE TABLE public.instructors(id uuid PRIMARY KEY, college_id uuid NOT NULL,
  is_active boolean NOT NULL DEFAULT true, availability_status text NOT NULL DEFAULT 'available');
CREATE TABLE public.plan_course_components(id uuid PRIMARY KEY, weekly_contact_hours numeric);
CREATE TABLE public.teaching_assignments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL, course_offering_id uuid NOT NULL, instructor_id uuid NOT NULL,
  section_number text, session_type text, weekly_hours numeric, required_room_type text, notes text,
  expected_students int, section_id uuid, cohort_id uuid, plan_course_component_id uuid,
  delivery_group_id uuid, assigned_component_hours numeric, is_active boolean DEFAULT true);
CREATE TABLE public.schedule_sessions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_version_id uuid NOT NULL, teaching_assignment_id uuid, instructor_id uuid NOT NULL,
  room_id uuid, day_of_week smallint NOT NULL, start_time time NOT NULL, end_time time NOT NULL,
  delivery_group_id uuid, cohort_id uuid);
CREATE TABLE public.faculty_teaching_requests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instructor_id uuid NOT NULL, home_college_id uuid NOT NULL, college_id uuid NOT NULL,
  delivery_group_id uuid NOT NULL, assigned_hours numeric NOT NULL, assignment_id uuid,
  status text NOT NULL DEFAULT 'pending', decided_by uuid);
CREATE TABLE public.audit_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid,
  action text, entity text, entity_id uuid, college_id uuid, details jsonb);

-- Model of the live assignment guard (it calls the global validator); stays enabled.
CREATE TABLE public._stub(x int);
\ir ../docs/migrations-proposed/20260927_itcs_version_scoped_assignments.sql
CREATE FUNCTION public.fixture_allocation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_active THEN
    PERFORM public.validate_assignment_allocation_locked(NEW.delivery_group_id,
      CASE WHEN TG_OP = 'UPDATE' THEN NEW.id END, NEW.assigned_component_hours,
      (SELECT weekly_contact_hours FROM public.plan_course_components WHERE id = NEW.plan_course_component_id));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fixture_allocation_guard BEFORE INSERT ON public.teaching_assignments
FOR EACH ROW EXECUTE FUNCTION public.fixture_allocation_guard();

-- Fixture: ITCS college, published P (274 sessions), draft D (282 sessions).
INSERT INTO public.schedule_versions VALUES
  ('30f8a76d-1cb9-4944-a5d7-483dcaea7692','7168345f-cf9d-4789-b2ad-547abb687dc8','published'),
  ('d68d8d22-9a6d-4f21-935f-cebf18bb969b','7168345f-cf9d-4789-b2ad-547abb687dc8','draft'),
  ('00000000-0000-4000-8000-0000000000aa','00000000-0000-4000-8000-00000000000f','published');
INSERT INTO public.managers VALUES
  ('11111111-1111-1111-1111-111111111111','7168345f-cf9d-4789-b2ad-547abb687dc8'),
  ('33333333-3333-3333-3333-333333333333','00000000-0000-4000-8000-0000000000c1'),
  ('33333333-3333-3333-3333-333333333333','00000000-0000-4000-8000-0000000000c2');

CREATE TEMP TABLE fx AS
SELECT n, gen_random_uuid() ta, gen_random_uuid() grp, gen_random_uuid() comp,
       gen_random_uuid() ins, gen_random_uuid() room,
       ('aaaaaaaa-0000-4000-8000-' || lpad(((n + 1) / 2)::text, 12, '0'))::uuid cohort,
       (((n + 1) / 2) % 5)::smallint dow,
       CASE WHEN n % 2 = 1 THEN time '08:00' ELSE time '10:00' END st
FROM generate_series(1, 282) n;
INSERT INTO public.instructors(id, college_id) SELECT ins,'7168345f-cf9d-4789-b2ad-547abb687dc8' FROM fx;
INSERT INTO public.plan_course_components SELECT comp, 2 FROM fx;
INSERT INTO public.teaching_assignments(id,college_id,course_offering_id,instructor_id,cohort_id,
  plan_course_component_id,delivery_group_id,assigned_component_hours)
SELECT ta,'7168345f-cf9d-4789-b2ad-547abb687dc8',gen_random_uuid(),ins,cohort,comp,grp,2 FROM fx;
INSERT INTO public.schedule_sessions(schedule_version_id,teaching_assignment_id,instructor_id,room_id,
  day_of_week,start_time,end_time,delivery_group_id,cohort_id)
SELECT 'd68d8d22-9a6d-4f21-935f-cebf18bb969b',ta,ins,room,dow,st,st + interval '2 hour',grp,cohort FROM fx;
INSERT INTO public.schedule_sessions(schedule_version_id,teaching_assignment_id,instructor_id,room_id,
  day_of_week,start_time,end_time,delivery_group_id,cohort_id)
SELECT '30f8a76d-1cb9-4944-a5d7-483dcaea7692',ta,ins,room,dow,st,st + interval '2 hour',grp,cohort
FROM fx WHERE n <= 274;
-- Another college's assignment and published session (must stay untouched).
INSERT INTO public.instructors VALUES ('00000000-0000-4000-8000-0000000000e1','00000000-0000-4000-8000-00000000000f');
INSERT INTO public.teaching_assignments(id,college_id,course_offering_id,instructor_id,delivery_group_id,assigned_component_hours)
VALUES ('00000000-0000-4000-8000-0000000000e2','00000000-0000-4000-8000-00000000000f',gen_random_uuid(),
        '00000000-0000-4000-8000-0000000000e1',gen_random_uuid(),2);
-- Replacement lecturers: 7 same-college, 3 cross-college (homes c1, c2, c2).
CREATE TEMP TABLE rep AS
SELECT n, gen_random_uuid() new_ins,
  CASE WHEN n = 8 THEN '00000000-0000-4000-8000-0000000000c1'::uuid
       WHEN n IN (9, 10) THEN '00000000-0000-4000-8000-0000000000c2'::uuid
       ELSE '7168345f-cf9d-4789-b2ad-547abb687dc8'::uuid END home
FROM generate_series(1, 10) n;
-- Items 1-7 replace assignments shared with P (fx 1..7); 8-10 replace D-only ones (fx 280..282).
ALTER TABLE rep ADD COLUMN fxn int;
UPDATE rep SET fxn = CASE WHEN n <= 7 THEN n ELSE 272 + n END;
INSERT INTO public.instructors(id, college_id) SELECT new_ins, home FROM rep;

CREATE TEMP TABLE baseline AS SELECT
  public.schedule_version_session_snapshot('30f8a76d-1cb9-4944-a5d7-483dcaea7692') pub,
  public.schedule_version_session_snapshot('00000000-0000-4000-8000-0000000000aa') other,
  (SELECT md5(string_agg(t::text, '' ORDER BY id)) FROM public.teaching_assignments t
   WHERE college_id <> '7168345f-cf9d-4789-b2ad-547abb687dc8') other_ta;
GRANT SELECT ON ALL TABLES IN SCHEMA pg_temp TO PUBLIC;

DO $t$
DECLARE d uuid := 'd68d8d22-9a6d-4f21-935f-cebf18bb969b'; p uuid := '30f8a76d-1cb9-4944-a5d7-483dcaea7692';
  r record; items jsonb := '[]'; snap text; res jsonb; req uuid; ok boolean;
BEGIN
  -- T1: the old global rule still blocks an unscoped second assignment on a shared group.
  SELECT fx.* INTO r FROM fx WHERE n = 1;
  BEGIN
    INSERT INTO public.teaching_assignments(college_id,course_offering_id,instructor_id,
      plan_course_component_id,delivery_group_id,assigned_component_hours)
    VALUES ('7168345f-cf9d-4789-b2ad-547abb687dc8',gen_random_uuid(),r.ins,r.comp,r.grp,2);
    RAISE EXCEPTION 'T1 FAIL global over-allocation accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- T2: no auth.uid -> refused.
  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN PERFORM public.create_version_scoped_replacement_assignment(d, r.ta,
    (SELECT new_ins FROM rep WHERE n = 1), 2);
    RAISE EXCEPTION 'T2 FAIL';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);

  -- T3: published version cannot be edited.
  BEGIN PERFORM public.create_version_scoped_replacement_assignment(p, r.ta,
    (SELECT new_ins FROM rep WHERE n = 1), 2);
    RAISE EXCEPTION 'T3 FAIL';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'VERSION_NOT_DRAFT' THEN RAISE; END IF; END;

  -- T4: over-allocation inside the version is refused.
  BEGIN PERFORM public.create_version_scoped_replacement_assignment(d, r.ta,
    (SELECT new_ins FROM rep WHERE n = 1), 3);
    RAISE EXCEPTION 'T4 FAIL';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'VERSION_CO_TEACHING_HOURS_OVER_ALLOCATED' THEN RAISE; END IF; END;

  -- T5: cross-college without approval / approved by a non-home manager -> refused.
  SELECT fx.* INTO r FROM fx WHERE n = 280;
  BEGIN PERFORM public.create_version_scoped_replacement_assignment(d, r.ta,
    (SELECT new_ins FROM rep WHERE n = 8), 2, NULL);
    RAISE EXCEPTION 'T5a FAIL';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'HOME_COLLEGE_APPROVAL_REQUIRED' THEN RAISE; END IF; END;
  INSERT INTO public.faculty_teaching_requests(instructor_id,home_college_id,college_id,
    delivery_group_id,assigned_hours,status,decided_by)
  VALUES ((SELECT new_ins FROM rep WHERE n = 8),'00000000-0000-4000-8000-0000000000c1',
    '7168345f-cf9d-4789-b2ad-547abb687dc8', r.grp, 2, 'approved',
    '11111111-1111-1111-1111-111111111111') RETURNING id INTO req;
  BEGIN PERFORM public.create_version_scoped_replacement_assignment(d, r.ta,
    (SELECT new_ins FROM rep WHERE n = 8), 2, req);
    RAISE EXCEPTION 'T5b FAIL';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'HOME_COLLEGE_APPROVAL_REQUIRED' THEN RAISE; END IF; END;
  DELETE FROM public.faculty_teaching_requests WHERE id = req;

  -- Home-college managers approve the 3 requests (models decide_faculty_teaching_request by auth.uid).
  FOR r IN SELECT rep.*, fx.ta, fx.grp FROM rep JOIN fx ON fx.n = rep.fxn ORDER BY rep.n LOOP
    req := NULL;
    IF r.n >= 8 THEN
      INSERT INTO public.faculty_teaching_requests(instructor_id,home_college_id,college_id,
        delivery_group_id,assigned_hours,status,decided_by)
      VALUES (r.new_ins, r.home, '7168345f-cf9d-4789-b2ad-547abb687dc8', r.grp, 2, 'approved',
        '33333333-3333-3333-3333-333333333333') RETURNING id INTO req;
    END IF;
    items := items || jsonb_build_object('replaces', r.ta, 'instructor', r.new_ins,
      'hours', 2, 'request_id', req);
  END LOOP;

  -- T6: wrong snapshot of the 272 unchanged sessions -> whole batch refused.
  BEGIN PERFORM public.apply_version_scoped_replacements(d, items, 282, 272, 'x');
    RAISE EXCEPTION 'T6 FAIL';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'BATCH_SNAPSHOT_MISMATCH' THEN RAISE; END IF; END;

  SELECT md5(string_agg(concat_ws('|', s.id, s.teaching_assignment_id, s.instructor_id,
      s.day_of_week, s.start_time, s.end_time, s.room_id, s.delivery_group_id), E'\n' ORDER BY s.id))
    INTO snap FROM public.schedule_sessions s
  WHERE s.schedule_version_id = d AND NOT s.teaching_assignment_id IN
    (SELECT (x->>'replaces')::uuid FROM jsonb_array_elements(items) x);

  -- T7: correct batch succeeds atomically.
  res := public.apply_version_scoped_replacements(d, items, 282, 272, snap);
  IF (res->>'sessions')::int <> 282 OR (res->>'unchanged')::int <> 272
     OR jsonb_array_length(res->'replacements') <> 10 THEN
    RAISE EXCEPTION 'T7 FAIL %', res; END IF;

  -- T8: history preserved.
  IF public.schedule_version_session_snapshot(p) <> (SELECT pub FROM baseline)
     OR public.schedule_version_session_snapshot('00000000-0000-4000-8000-0000000000aa') <> (SELECT other FROM baseline)
     OR (SELECT md5(string_agg(t::text, '' ORDER BY id)) FROM public.teaching_assignments t
         WHERE college_id <> '7168345f-cf9d-4789-b2ad-547abb687dc8') <> (SELECT other_ta FROM baseline) THEN
    RAISE EXCEPTION 'T8 FAIL history changed'; END IF;
  IF EXISTS (SELECT 1 FROM rep JOIN fx ON fx.n = rep.fxn JOIN public.teaching_assignments t
             ON t.id = fx.ta WHERE NOT t.is_active) THEN
    RAISE EXCEPTION 'T8 FAIL old assignment deactivated'; END IF;
  IF (SELECT count(*) FROM public.schedule_sessions s JOIN rep ON rep.new_ins = s.instructor_id
      WHERE s.schedule_version_id = d) <> 10
     OR (SELECT count(*) FROM public.schedule_sessions s WHERE s.schedule_version_id = p
         AND s.teaching_assignment_id IN (SELECT fx.ta FROM fx JOIN rep ON fx.n = rep.fxn)) <> 7 THEN
    RAISE EXCEPTION 'T8 FAIL relink counts'; END IF;
  IF (SELECT count(*) FROM public.faculty_teaching_requests WHERE assignment_id IS NOT NULL) <> 3
     OR (SELECT count(*) FROM public.audit_logs WHERE action = 'version_scoped_assignment_replacement') <> 10 THEN
    RAISE EXCEPTION 'T8 FAIL request links/audit'; END IF;

  -- T9: coverage per version: 282 groups fully covered in D and 274 in P, no over-allocation.
  IF (SELECT count(DISTINCT delivery_group_id) FROM public.version_effective_assignments(d)
      WHERE delivery_group_id IN (SELECT grp FROM fx)) <> 282
     OR (SELECT sum(assigned_component_hours) FROM public.version_effective_assignments(d)
         WHERE delivery_group_id IN (SELECT grp FROM fx)) <> 564
     OR (SELECT count(*) FROM public.version_effective_assignments(p)
         WHERE delivery_group_id IN (SELECT grp FROM fx WHERE n <= 7)) <> 7
     OR EXISTS (SELECT 1 FROM public.version_effective_assignments(p) e
                JOIN rep ON true JOIN public.teaching_assignments t ON t.id = e.assignment_id
                WHERE t.instructor_id = rep.new_ins) THEN
    RAISE EXCEPTION 'T9 FAIL version coverage'; END IF;

  -- T10: second replacement of the same assignment in the version is refused.
  BEGIN PERFORM public.create_version_scoped_replacement_assignment(d,
      (SELECT fx.ta FROM fx WHERE n = 1), (SELECT ins FROM fx WHERE n = 100), 2);
    RAISE EXCEPTION 'T10 FAIL';
  EXCEPTION WHEN unique_violation THEN NULL; END;

  -- T11: a published session cannot point to a draft-scoped assignment.
  BEGIN
    UPDATE public.schedule_sessions SET teaching_assignment_id =
      (SELECT assignment_id FROM assignment_version_private.scope LIMIT 1)
    WHERE id = (SELECT id FROM public.schedule_sessions WHERE schedule_version_id = p LIMIT 1);
    RAISE EXCEPTION 'T11 FAIL';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'VERSION_SCOPED_ASSIGNMENT_OTHER_VERSION' THEN RAISE; END IF; END;

  -- T12: publish gate refuses each violation, then passes on the clean draft.
  IF NOT (public.version_scoped_publish_readiness(d)->>'ok')::boolean THEN
    RAISE EXCEPTION 'T12 FAIL clean draft not ready %', public.version_scoped_publish_readiness(d); END IF;
  BEGIN  -- one lecturer on 5 days
    UPDATE public.schedule_sessions s SET instructor_id = (SELECT ins FROM fx WHERE n = 1)
    WHERE s.schedule_version_id = d AND s.teaching_assignment_id IN
      (SELECT ta FROM fx WHERE n IN (3, 5, 7, 9));
    UPDATE public.schedule_versions SET status = 'published' WHERE id = d;
    RAISE EXCEPTION 'T12a FAIL';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE 'VERSION_SCOPED_PUBLISH_BLOCKED%' THEN RAISE; END IF; END;
  BEGIN  -- student day with a single lecture (also breaks snapshot)
    UPDATE public.schedule_sessions SET day_of_week = 5
    WHERE schedule_version_id = d AND teaching_assignment_id = (SELECT ta FROM fx WHERE n = 100);
    UPDATE public.schedule_versions SET status = 'published' WHERE id = d;
    RAISE EXCEPTION 'T12b FAIL';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE 'VERSION_SCOPED_PUBLISH_BLOCKED%' THEN RAISE; END IF; END;
  BEGIN  -- room clash
    UPDATE public.schedule_sessions SET room_id = (SELECT room FROM fx WHERE n = 1)
    WHERE schedule_version_id = d AND teaching_assignment_id = (SELECT ta FROM fx WHERE n = 2);
    UPDATE public.schedule_sessions SET start_time = '08:00', end_time = '10:00'
    WHERE schedule_version_id = d AND teaching_assignment_id = (SELECT ta FROM fx WHERE n = 2);
    UPDATE public.schedule_versions SET status = 'published' WHERE id = d;
    RAISE EXCEPTION 'T12c FAIL';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE 'VERSION_SCOPED_PUBLISH_BLOCKED%' THEN RAISE; END IF; END;
  BEGIN  -- missing lecture (281 of 282)
    DELETE FROM public.schedule_sessions WHERE schedule_version_id = d
      AND teaching_assignment_id = (SELECT ta FROM fx WHERE n = 200);
    UPDATE public.schedule_versions SET status = 'published' WHERE id = d;
    RAISE EXCEPTION 'T12d FAIL';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE 'VERSION_SCOPED_PUBLISH_BLOCKED%' THEN RAISE; END IF; END;

  UPDATE public.schedule_versions SET status = 'published' WHERE id = d;
  UPDATE public.schedule_versions SET status = 'archived' WHERE id = p;
  IF public.schedule_version_session_snapshot(p) <> (SELECT pub FROM baseline) THEN
    RAISE EXCEPTION 'T13 FAIL archived history changed'; END IF;
  RAISE NOTICE 'ALL VERSION-SCOPED ASSIGNMENT TESTS PASSED (13 groups)';
END;
$t$;
