\set ON_ERROR_STOP on
-- Disposable proof for docs/migrations-proposed/20260927_itcs_version_scoped_assignments.sql
-- Never run against production. Live functions that the migration patches are
-- reproduced here with the exact text fragments the patch replaces; the live
-- request guard is modelled on faculty_private.guard_assignment_request.
SET client_min_messages = warning;
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE SCHEMA faculty_private;

CREATE TABLE public.managers(user_id uuid, college_id uuid);
CREATE FUNCTION public.can_manage_college(u uuid, c uuid) RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT EXISTS (SELECT 1 FROM public.managers WHERE user_id = u AND college_id = c) $$;
CREATE TABLE public.schedule_versions(id uuid PRIMARY KEY, college_id uuid NOT NULL,
  academic_term_id uuid NOT NULL DEFAULT '018dd364-0000-4000-8000-000000000001', status text NOT NULL);
CREATE TABLE public.instructors(id uuid PRIMARY KEY, college_id uuid NOT NULL,
  is_active boolean NOT NULL DEFAULT true, availability_status text NOT NULL DEFAULT 'available');
CREATE TABLE public.faculty_identity_links(identity_id uuid, instructor_id uuid);
CREATE TABLE faculty_private.home_profiles(identity_id uuid PRIMARY KEY, home_college_id uuid, is_active boolean);
CREATE TABLE public.plan_course_components(id uuid PRIMARY KEY, weekly_contact_hours numeric);
CREATE TABLE public.teaching_assignments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL, course_offering_id uuid NOT NULL, instructor_id uuid NOT NULL,
  section_number text, session_type text, weekly_hours numeric, required_room_type text, notes text,
  expected_students int, section_id uuid, cohort_id uuid, plan_course_component_id uuid,
  delivery_group_id uuid, assigned_component_hours numeric, is_active boolean DEFAULT true);
CREATE TABLE public.schedule_sessions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid, schedule_version_id uuid NOT NULL, teaching_assignment_id uuid, instructor_id uuid NOT NULL,
  room_id uuid, day_of_week smallint NOT NULL, start_time time NOT NULL, end_time time NOT NULL,
  delivery_group_id uuid, cohort_id uuid);
CREATE TABLE public.faculty_teaching_requests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id uuid NOT NULL, instructor_id uuid NOT NULL, home_college_id uuid NOT NULL,
  college_id uuid NOT NULL, delivery_group_id uuid NOT NULL, term_id uuid NOT NULL,
  component_hours numeric NOT NULL, assigned_hours numeric NOT NULL, assignment_id uuid, notes text,
  status text NOT NULL DEFAULT 'pending', requested_by uuid NOT NULL, decided_by uuid,
  decision_note text, decided_at timestamptz, created_at timestamptz DEFAULT now());
CREATE TABLE public.audit_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid,
  action text, entity text, entity_id uuid, college_id uuid, details jsonb);

-- Live body of validate_assignment_allocation_locked (copied 2026-09-27).
CREATE OR REPLACE FUNCTION public.validate_assignment_allocation_locked(p_delivery_group_id uuid, p_exclude_assignment_id uuid, p_new_hours numeric, p_component_hours numeric, p_include_new_row boolean DEFAULT true)
 RETURNS void LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $function$
DECLARE
  v_co_count integer;
  v_null_split_count integer;
  v_sum_assigned numeric;
BEGIN
  SELECT COUNT(*)::integer,
         COUNT(*) FILTER (
           WHERE ta.assigned_component_hours IS NULL
             AND (p_exclude_assignment_id IS NULL OR ta.id IS DISTINCT FROM p_exclude_assignment_id)
         )::integer
           + CASE WHEN p_include_new_row AND p_new_hours IS NULL THEN 1 ELSE 0 END,
         COALESCE(
           SUM(ta.assigned_component_hours) FILTER (
             WHERE p_exclude_assignment_id IS NULL OR ta.id IS DISTINCT FROM p_exclude_assignment_id
           ),
           0
         )
           + CASE WHEN p_include_new_row THEN COALESCE(p_new_hours, 0) ELSE 0 END
    INTO v_co_count, v_null_split_count, v_sum_assigned
  FROM public.teaching_assignments ta
  WHERE ta.delivery_group_id = p_delivery_group_id
    AND ta.is_active = TRUE;

  IF p_include_new_row
     AND (
       p_exclude_assignment_id IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM public.teaching_assignments ta2
         WHERE ta2.id = p_exclude_assignment_id
           AND ta2.delivery_group_id = p_delivery_group_id
           AND ta2.is_active = TRUE
       )
     ) THEN
    v_co_count := v_co_count + 1;
  END IF;

  IF v_co_count > 1 AND v_null_split_count > 0 THEN
    RAISE EXCEPTION 'CO_TEACHING_HOURS_SPLIT_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;
  IF p_component_hours IS NOT NULL AND v_sum_assigned > p_component_hours THEN
    RAISE EXCEPTION 'CO_TEACHING_HOURS_OVER_ALLOCATED' USING ERRCODE = 'check_violation';
  END IF;
END;
$function$;

-- Coverage reduced to the live assignments CTE (verbatim) + the multi/unassigned outputs.
CREATE FUNCTION public.schedule_version_delivery_coverage(p_college_id uuid, p_schedule_version_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE v_result jsonb;
BEGIN
  WITH expected AS (
    SELECT DISTINCT s.delivery_group_id FROM public.schedule_sessions s
    WHERE s.schedule_version_id = p_schedule_version_id AND s.college_id = p_college_id
  ), assignments AS (
    SELECT ta.delivery_group_id,
           count(*) FILTER (WHERE ta.is_active=true)::integer AS active_assignments
    FROM public.teaching_assignments ta
    WHERE ta.college_id = p_college_id
    GROUP BY ta.delivery_group_id
  ), a AS (
    SELECT e.delivery_group_id, COALESCE(x.active_assignments,0) AS active_assignments
    FROM expected e LEFT JOIN assignments x ON x.delivery_group_id=e.delivery_group_id
  )
  SELECT jsonb_build_object(
    'total_groups', count(*),
    'unassigned_groups', count(*) FILTER (WHERE active_assignments=0),
    'multi_assigned_groups', count(*) FILTER (WHERE active_assignments>1),
    'complete', count(*) > 0 AND count(*) FILTER (WHERE active_assignments<>1) = 0)
  INTO v_result FROM a;
  RETURN v_result;
END;
$function$;

-- Model of the create path used by decide for non-scoped requests.
CREATE FUNCTION faculty_private.apply_create_assignment(uuid, uuid, numeric, text)
RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"ok":true,"assignment_id":null}'::jsonb $$;

-- decide_faculty_teaching_request model: live authorisation + decision + the exact create line.
CREATE FUNCTION public.decide_faculty_teaching_request(p_request_id uuid, p_decision text, p_note text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE r public.faculty_teaching_requests%ROWTYPE; v_result jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM faculty_teaching_requests WHERE id=p_request_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'REQUEST_NOT_FOUND'; END IF;
 IF (p_decision='cancelled' AND NOT can_manage_college(auth.uid(),r.college_id)) OR
    (p_decision<>'cancelled' AND NOT can_manage_college(auth.uid(),r.home_college_id)) THEN
  RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE='42501'; END IF;
 IF r.status<>'pending' THEN RAISE EXCEPTION 'REQUEST_ALREADY_DECIDED'; END IF;
 IF length(btrim(coalesce(p_note,'')))<3 THEN RAISE EXCEPTION 'REQUEST_DECISION_NOTE_REQUIRED'; END IF;
 UPDATE faculty_teaching_requests SET status=p_decision,decided_by=auth.uid(),decision_note=btrim(p_note),decided_at=now() WHERE id=r.id;
 IF p_decision='approved' THEN
  IF r.assignment_id IS NULL THEN
   v_result:=faculty_private.apply_create_assignment(r.delivery_group_id,r.instructor_id,r.assigned_hours,r.notes);
  END IF;
  UPDATE faculty_teaching_requests SET assignment_id=(v_result->>'assignment_id')::uuid WHERE id=r.id;
 END IF;
 RETURN coalesce(v_result,jsonb_build_object('ok',true,'action',p_decision))||jsonb_build_object('request_id',r.id);
END $function$;

-- Guard models (enabled, never bypassed).
CREATE FUNCTION faculty_private.guard_assignment_request() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE h record; v_request uuid;
BEGIN
  IF NOT NEW.is_active THEN RETURN NEW; END IF;
  SELECT hp.* INTO h FROM faculty_private.home_profiles hp JOIN faculty_identity_links l
    ON l.identity_id=hp.identity_id WHERE l.instructor_id=NEW.instructor_id;
  IF h.home_college_id IS NULL THEN RAISE EXCEPTION 'FACULTY_HOME_REVIEW_REQUIRED'; END IF;
  IF EXISTS (SELECT 1 FROM teaching_assignments a JOIN faculty_identity_links l ON l.instructor_id=a.instructor_id
    WHERE a.delivery_group_id=NEW.delivery_group_id AND a.is_active AND a.id<>NEW.id AND l.identity_id=h.identity_id)
  THEN RAISE EXCEPTION 'DUPLICATE_FACULTY_ASSIGNMENT'; END IF;
  IF h.home_college_id=NEW.college_id THEN RETURN NEW; END IF;
  SELECT id INTO v_request FROM faculty_teaching_requests r WHERE r.identity_id=h.identity_id
   AND r.instructor_id=NEW.instructor_id AND r.home_college_id=h.home_college_id AND r.college_id=NEW.college_id
   AND r.delivery_group_id=NEW.delivery_group_id AND r.status='approved'
   AND r.assigned_hours=coalesce(NEW.assigned_component_hours,NEW.weekly_hours)
   AND (r.assignment_id IS NULL OR r.assignment_id=NEW.id)
   AND r.decided_by=auth.uid() AND r.decided_at=now();
  IF v_request IS NULL THEN RAISE EXCEPTION 'HOME_COLLEGE_APPROVAL_REQUIRED_BY_GUARD'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER zz_faculty_assignment_request BEFORE INSERT OR UPDATE ON public.teaching_assignments
FOR EACH ROW EXECUTE FUNCTION faculty_private.guard_assignment_request();
CREATE FUNCTION public.fixture_allocation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_active THEN
    PERFORM public.validate_assignment_allocation_locked(NEW.delivery_group_id, NULL, NEW.assigned_component_hours,
      (SELECT weekly_contact_hours FROM public.plan_course_components WHERE id = NEW.plan_course_component_id));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fixture_allocation_guard BEFORE INSERT ON public.teaching_assignments
FOR EACH ROW EXECUTE FUNCTION public.fixture_allocation_guard();

-- Fixture.
\set ITCS '''7168345f-cf9d-4789-b2ad-547abb687dc8'''
INSERT INTO public.schedule_versions(id,college_id,status) VALUES
  ('30f8a76d-1cb9-4944-a5d7-483dcaea7692',:ITCS,'published'),
  ('d68d8d22-9a6d-4f21-935f-cebf18bb969b',:ITCS,'draft'),
  ('00000000-0000-4000-8000-0000000000aa','00000000-0000-4000-8000-00000000000f','published');
INSERT INTO public.managers VALUES
  ('11111111-1111-1111-1111-111111111111',:ITCS),
  ('33333333-3333-3333-3333-333333333333','00000000-0000-4000-8000-0000000000c1'),
  ('33333333-3333-3333-3333-333333333333','00000000-0000-4000-8000-0000000000c2');
CREATE TABLE fx AS
SELECT n, gen_random_uuid() ta, gen_random_uuid() grp, gen_random_uuid() comp,
       gen_random_uuid() ins, gen_random_uuid() room, gen_random_uuid() room2, gen_random_uuid() ident,
       ('aaaaaaaa-0000-4000-8000-' || lpad(((n + 1) / 2)::text, 12, '0'))::uuid cohort,
       (((n + 1) / 2) % 5)::smallint dow,
       CASE WHEN n % 2 = 1 THEN time '08:00' ELSE time '10:00' END st
FROM generate_series(1, 282) n;
INSERT INTO public.instructors(id, college_id) SELECT ins,:ITCS FROM fx;
INSERT INTO public.faculty_identity_links SELECT ident, ins FROM fx;
INSERT INTO faculty_private.home_profiles SELECT ident, :ITCS, true FROM fx;
INSERT INTO public.plan_course_components SELECT comp, 2 FROM fx;
INSERT INTO public.teaching_assignments(id,college_id,course_offering_id,instructor_id,cohort_id,
  plan_course_component_id,delivery_group_id,assigned_component_hours)
SELECT ta,:ITCS,gen_random_uuid(),ins,cohort,comp,grp,2 FROM fx;
INSERT INTO public.schedule_sessions(college_id,schedule_version_id,teaching_assignment_id,instructor_id,room_id,
  day_of_week,start_time,end_time,delivery_group_id,cohort_id)
SELECT :ITCS,'d68d8d22-9a6d-4f21-935f-cebf18bb969b',ta,ins,room,dow,st,st + interval '2 hour',grp,cohort FROM fx;
INSERT INTO public.schedule_sessions(college_id,schedule_version_id,teaching_assignment_id,instructor_id,room_id,
  day_of_week,start_time,end_time,delivery_group_id,cohort_id)
SELECT :ITCS,'30f8a76d-1cb9-4944-a5d7-483dcaea7692',ta,ins,room,dow,st,st + interval '2 hour',grp,cohort
FROM fx WHERE n <= 274;
-- Other college: assignment + published session.
INSERT INTO public.instructors VALUES ('00000000-0000-4000-8000-0000000000e1','00000000-0000-4000-8000-00000000000f');
INSERT INTO public.faculty_identity_links VALUES ('00000000-0000-4000-8000-0000000000e9','00000000-0000-4000-8000-0000000000e1');
INSERT INTO faculty_private.home_profiles VALUES ('00000000-0000-4000-8000-0000000000e9','00000000-0000-4000-8000-00000000000f',true);
INSERT INTO public.teaching_assignments(id,college_id,course_offering_id,instructor_id,delivery_group_id,assigned_component_hours)
VALUES ('00000000-0000-4000-8000-0000000000e2','00000000-0000-4000-8000-00000000000f',gen_random_uuid(),
        '00000000-0000-4000-8000-0000000000e1','00000000-0000-4000-8000-0000000000e3',2);
INSERT INTO public.schedule_sessions(college_id,schedule_version_id,teaching_assignment_id,instructor_id,room_id,
  day_of_week,start_time,end_time,delivery_group_id)
VALUES ('00000000-0000-4000-8000-00000000000f','00000000-0000-4000-8000-0000000000aa',
  '00000000-0000-4000-8000-0000000000e2','00000000-0000-4000-8000-0000000000e1',gen_random_uuid(),1,'08:00','10:00',
  '00000000-0000-4000-8000-0000000000e3');
-- Replacements: 1-7 shared with P (same college); 8-10 D-only, cross-college.
CREATE TABLE rep AS
SELECT n, gen_random_uuid() new_ins, gen_random_uuid() ident,
  CASE WHEN n = 8 THEN '00000000-0000-4000-8000-0000000000c1'::uuid
       WHEN n IN (9, 10) THEN '00000000-0000-4000-8000-0000000000c2'::uuid
       ELSE '7168345f-cf9d-4789-b2ad-547abb687dc8'::uuid END home,
  CASE WHEN n <= 7 THEN n ELSE 272 + n END fxn
FROM generate_series(1, 10) n;
INSERT INTO public.instructors(id, college_id) SELECT new_ins, home FROM rep;
INSERT INTO public.faculty_identity_links SELECT ident, new_ins FROM rep;
INSERT INTO faculty_private.home_profiles SELECT ident, home, true FROM rep;

CREATE TABLE baseline AS SELECT
  pg_get_functiondef('public.validate_assignment_allocation_locked(uuid,uuid,numeric,numeric,boolean)'::regprocedure) f1,
  pg_get_functiondef('public.schedule_version_delivery_coverage(uuid,uuid)'::regprocedure) f2,
  pg_get_functiondef('public.decide_faculty_teaching_request(uuid,text,text)'::regprocedure) f3,
  public.schedule_version_delivery_coverage('00000000-0000-4000-8000-00000000000f','00000000-0000-4000-8000-0000000000aa') other_cov,
  public.schedule_version_delivery_coverage(:ITCS,'30f8a76d-1cb9-4944-a5d7-483dcaea7692') pub_cov,
  (SELECT md5(string_agg(t::text, '' ORDER BY id)) FROM public.teaching_assignments t
   WHERE college_id <> :ITCS) other_ta;

-- R1: migration -> rollback restores the three live bodies byte-for-byte -> re-apply.
\ir ../docs/migrations-proposed/20260927_itcs_version_scoped_assignments.sql
\ir ../docs/migrations-proposed/20260927_itcs_version_scoped_assignments_rollback.sql
DO $r$ BEGIN
  IF pg_get_functiondef('public.validate_assignment_allocation_locked(uuid,uuid,numeric,numeric,boolean)'::regprocedure) <> (SELECT f1 FROM baseline)
     OR pg_get_functiondef('public.schedule_version_delivery_coverage(uuid,uuid)'::regprocedure) <> (SELECT f2 FROM baseline)
     OR pg_get_functiondef('public.decide_faculty_teaching_request(uuid,text,text)'::regprocedure) <> (SELECT f3 FROM baseline) THEN
    RAISE EXCEPTION 'R1 FAIL rollback did not restore originals'; END IF;
END $r$;
\ir ../docs/migrations-proposed/20260927_itcs_version_scoped_assignments.sql
-- Pre-publish snapshot of P taken after migration (migration itself writes no session data).
CREATE TABLE pub_snap AS SELECT public.schedule_version_session_snapshot('30f8a76d-1cb9-4944-a5d7-483dcaea7692') s,
  public.schedule_version_session_snapshot('00000000-0000-4000-8000-0000000000aa') o;

DO $t$
DECLARE d uuid := 'd68d8d22-9a6d-4f21-935f-cebf18bb969b'; p uuid := '30f8a76d-1cb9-4944-a5d7-483dcaea7692';
  itcs uuid := '7168345f-cf9d-4789-b2ad-547abb687dc8';
  r record; items jsonb := '[]'; snap text; res jsonb; req uuid; manifest jsonb; before_s text; after_s text;
  reqs uuid[] := '{}';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  -- T1 global rule still blocks an ordinary second assignment on a shared group.
  SELECT fx.* INTO r FROM fx WHERE n = 1;
  BEGIN
    INSERT INTO public.teaching_assignments(college_id,course_offering_id,instructor_id,plan_course_component_id,delivery_group_id,assigned_component_hours)
    VALUES (itcs,gen_random_uuid(),(SELECT new_ins FROM rep WHERE n=1),r.comp,r.grp,2);
    RAISE EXCEPTION 'T1 FAIL';
  EXCEPTION WHEN check_violation THEN NULL; END;
  -- T2 no auth / published version / over-allocation in version.
  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN PERFORM public.create_version_scoped_replacement_assignment(d, r.ta, (SELECT new_ins FROM rep WHERE n=1), 2);
    RAISE EXCEPTION 'T2a FAIL'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  BEGIN PERFORM public.create_version_scoped_replacement_assignment(p, r.ta, (SELECT new_ins FROM rep WHERE n=1), 2);
    RAISE EXCEPTION 'T2b FAIL'; EXCEPTION WHEN check_violation THEN IF SQLERRM<>'VERSION_NOT_DRAFT' THEN RAISE; END IF; END;
  BEGIN PERFORM public.create_version_scoped_replacement_assignment(d, r.ta, (SELECT new_ins FROM rep WHERE n=1), 3);
    RAISE EXCEPTION 'T2c FAIL'; EXCEPTION WHEN check_violation THEN IF SQLERRM<>'VERSION_CO_TEACHING_HOURS_OVER_ALLOCATED' THEN RAISE; END IF; END;

  -- T3 7 same-college replacements, CAS on the 275 untouched sessions.
  FOR r IN SELECT rep.*, fx.ta FROM rep JOIN fx ON fx.n = rep.fxn WHERE rep.n <= 7 ORDER BY rep.n LOOP
    items := items || jsonb_build_object('replaces', r.ta, 'instructor', r.new_ins, 'hours', 2);
  END LOOP;
  BEGIN PERFORM public.apply_version_scoped_replacements(d, items, 275, 'x');
    RAISE EXCEPTION 'T3a FAIL'; EXCEPTION WHEN check_violation THEN IF SQLERRM<>'BATCH_SNAPSHOT_MISMATCH' THEN RAISE; END IF; END;
  SELECT md5(string_agg(concat_ws('|', s.id, s.teaching_assignment_id, s.instructor_id, s.day_of_week,
      s.start_time, s.end_time, s.room_id, s.delivery_group_id), E'\n' ORDER BY s.id)) INTO snap
  FROM public.schedule_sessions s WHERE s.schedule_version_id = d
    AND NOT s.teaching_assignment_id IN (SELECT (x->>'replaces')::uuid FROM jsonb_array_elements(items) x);
  res := public.apply_version_scoped_replacements(d, items, 275, snap);
  IF jsonb_array_length(res->'replacements') <> 7 THEN RAISE EXCEPTION 'T3b FAIL %', res; END IF;

  -- T4 cross-college: direct write refused, host cannot approve, home college approves via decide.
  SELECT rep.*, fx.ta, fx.grp, fx.comp INTO r FROM rep JOIN fx ON fx.n = rep.fxn WHERE rep.n = 8;
  BEGIN PERFORM public.create_version_scoped_replacement_assignment(d, r.ta, r.new_ins, 2);
    RAISE EXCEPTION 'T4a FAIL'; EXCEPTION WHEN check_violation THEN IF SQLERRM<>'CROSS_COLLEGE_REQUIRES_HOME_DECISION' THEN RAISE; END IF; END;
  FOR r IN SELECT rep.*, fx.ta FROM rep JOIN fx ON fx.n = rep.fxn WHERE rep.n >= 8 ORDER BY rep.n LOOP
    res := public.submit_version_scoped_teaching_request(d, r.ta, r.new_ins, 2, 'ITCS draft replacement');
    reqs := reqs || (res->>'request_id')::uuid;
  END LOOP;
  BEGIN PERFORM public.decide_faculty_teaching_request(reqs[1], 'approved', 'host tries');
    RAISE EXCEPTION 'T4b FAIL'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
  FOREACH req IN ARRAY reqs LOOP
    res := public.decide_faculty_teaching_request(req, 'approved', 'approved by home college');
    IF res->>'action' <> 'version_scoped_created' THEN RAISE EXCEPTION 'T4c FAIL %', res; END IF;
  END LOOP;
  PERFORM set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  IF (SELECT count(*) FROM public.faculty_teaching_requests q JOIN assignment_version_private.scope s
      ON s.assignment_id = q.assignment_id AND s.request_id = q.id
      WHERE q.status='approved' AND q.decided_by='33333333-3333-3333-3333-333333333333') <> 3 THEN
    RAISE EXCEPTION 'T4d FAIL request not linked'; END IF;

  -- T5 history and other colleges untouched; per-version coverage.
  IF public.schedule_version_session_snapshot(p) <> (SELECT s FROM pub_snap)
     OR public.schedule_version_session_snapshot('00000000-0000-4000-8000-0000000000aa') <> (SELECT o FROM pub_snap)
     OR (SELECT md5(string_agg(t::text, '' ORDER BY id)) FROM public.teaching_assignments t WHERE college_id <> itcs) <> (SELECT other_ta FROM baseline)
     OR public.schedule_version_delivery_coverage('00000000-0000-4000-8000-00000000000f','00000000-0000-4000-8000-0000000000aa') <> (SELECT other_cov FROM baseline) THEN
    RAISE EXCEPTION 'T5a FAIL history/other college changed'; END IF;
  IF (SELECT count(*) FROM (SELECT delivery_group_id FROM public.teaching_assignments WHERE is_active AND college_id=itcs
      GROUP BY 1 HAVING count(*) > 1) x) <> 10 THEN RAISE EXCEPTION 'T5b FAIL old logic would not see 10 multi'; END IF;
  res := public.schedule_version_delivery_coverage(itcs, d);
  IF (res->>'multi_assigned_groups')::int <> 0 OR (res->>'unassigned_groups')::int <> 0 OR (res->>'total_groups')::int <> 282 THEN
    RAISE EXCEPTION 'T5c FAIL draft coverage %', res; END IF;
  IF public.schedule_version_delivery_coverage(itcs, p) <> (SELECT pub_cov FROM baseline) THEN
    RAISE EXCEPTION 'T5d FAIL published coverage changed %', public.schedule_version_delivery_coverage(itcs, p); END IF;
  IF (SELECT count(*) FROM public.teaching_assignments t JOIN fx ON fx.ta=t.id JOIN rep ON rep.fxn=fx.n WHERE t.is_active) <> 10 THEN
    RAISE EXCEPTION 'T5e FAIL old assignment deactivated'; END IF;

  -- T6 moves: 272 room changes, CAS before and after.
  SELECT jsonb_agg(jsonb_build_object('session_id', s.id, 'day_of_week', s.day_of_week,
      'start_time', s.start_time, 'end_time', s.end_time, 'room_id', fx.room2))
    INTO manifest FROM public.schedule_sessions s JOIN fx ON fx.ta = s.teaching_assignment_id
  WHERE s.schedule_version_id = d AND fx.n NOT IN (SELECT fxn FROM rep);
  IF jsonb_array_length(manifest) <> 272 THEN RAISE EXCEPTION 'T6 FAIL manifest %', jsonb_array_length(manifest); END IF;
  before_s := public.schedule_version_session_snapshot(d);
  after_s := public.preview_version_session_moves(d, manifest);
  BEGIN PERFORM public.apply_version_session_moves(d, manifest, 272, 'stale', after_s);
    RAISE EXCEPTION 'T6a FAIL'; EXCEPTION WHEN check_violation THEN IF SQLERRM<>'MOVE_BEFORE_SNAPSHOT_MISMATCH' THEN RAISE; END IF; END;
  BEGIN PERFORM public.apply_version_session_moves(d, manifest, 272, before_s, 'wrong');
    RAISE EXCEPTION 'T6b FAIL'; EXCEPTION WHEN check_violation THEN IF SQLERRM<>'MOVE_MANIFEST_AFTER_MISMATCH' THEN RAISE; END IF; END;
  BEGIN PERFORM public.apply_version_session_moves(d, manifest, 271, before_s, after_s);
    RAISE EXCEPTION 'T6c FAIL'; EXCEPTION WHEN check_violation THEN IF SQLERRM<>'MOVE_MANIFEST_INVALID' THEN RAISE; END IF; END;
  res := public.apply_version_session_moves(d, manifest, 272, before_s, after_s);
  IF (res->>'moved')::int <> 272 OR public.schedule_version_session_snapshot(d) <> after_s THEN RAISE EXCEPTION 'T6d FAIL'; END IF;

  -- T7 publish gate: unsealed blocked; sealed ok; edit after seal blocked.
  BEGIN UPDATE public.schedule_versions SET status='published' WHERE id=d;
    RAISE EXCEPTION 'T7a FAIL'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN PERFORM public.seal_version_publish_expectation(d, 282, before_s);
    RAISE EXCEPTION 'T7b FAIL'; EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM public.seal_version_publish_expectation(d, 282, after_s);
  BEGIN
    UPDATE public.schedule_sessions SET room_id = gen_random_uuid()
    WHERE id = (SELECT id FROM public.schedule_sessions WHERE schedule_version_id=d LIMIT 1);
    UPDATE public.schedule_versions SET status='published' WHERE id=d;
    RAISE EXCEPTION 'T7c FAIL'; EXCEPTION WHEN check_violation THEN NULL; END;
  -- T8 published session cannot point to a draft-scoped assignment.
  BEGIN
    UPDATE public.schedule_sessions SET teaching_assignment_id=(SELECT assignment_id FROM assignment_version_private.scope LIMIT 1)
    WHERE id=(SELECT id FROM public.schedule_sessions WHERE schedule_version_id=p LIMIT 1);
    RAISE EXCEPTION 'T8 FAIL'; EXCEPTION WHEN check_violation THEN NULL; END;
  IF NOT (public.version_scoped_publish_gate(d)->>'ok')::boolean THEN
    RAISE EXCEPTION 'T9 FAIL gate %', public.version_scoped_publish_gate(d); END IF;
  UPDATE public.schedule_versions SET status='published' WHERE id=d;
  UPDATE public.schedule_versions SET status='archived' WHERE id=p;
  IF public.schedule_version_session_snapshot(p) <> (SELECT s FROM pub_snap) THEN RAISE EXCEPTION 'T9 FAIL history'; END IF;
  RAISE WARNING 'ALL VERSION-SCOPED ASSIGNMENT TESTS PASSED (R1, T1-T9)';
END;
$t$;
