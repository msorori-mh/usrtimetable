\set ON_ERROR_STOP on
-- Disposable integration proof for
-- docs/migrations-proposed/20260927b_itcs_version_scoped_workload_guards.sql.
-- Never production. The view, faculty_private.workload(),
-- faculty_private.guard_assignment_request() and
-- public.enforce_instructor_extra_hours_limit() below are VERBATIM copies of
-- the live definitions read on 2026-09-27; the Rev2 writer functions are
-- extracted from the Rev2 proposal by the runner (tests/.rev2-writers.sql).
SET client_min_messages = warning;
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE SCHEMA faculty_private; CREATE SCHEMA schedule_version_delivery_private;
CREATE SCHEMA assignment_version_private;

CREATE TABLE public.colleges(id uuid PRIMARY KEY, university_id uuid NOT NULL);
CREATE TABLE public.academic_terms(id uuid PRIMARY KEY, college_id uuid, academic_year text, name text, term_type text);
CREATE TABLE public.academic_cohorts(id uuid PRIMARY KEY, term_id uuid);
CREATE TABLE public.course_offerings(id uuid PRIMARY KEY, term_id uuid);
CREATE TABLE public.instructor_types(id uuid PRIMARY KEY, code text);
CREATE TABLE public.instructors(id uuid PRIMARY KEY, college_id uuid, academic_rank text,
  employment_type text, instructor_type_id uuid, is_active boolean DEFAULT true,
  availability_status text DEFAULT 'available');
CREATE TABLE public.faculty_identity_links(identity_id uuid, instructor_id uuid);
CREATE TABLE faculty_private.home_profiles(identity_id uuid PRIMARY KEY, home_college_id uuid,
  university_id uuid, academic_rank text, quota numeric, type_code text, employment_type text,
  is_active boolean DEFAULT true);
CREATE FUNCTION faculty_private.quota_applicability(text,text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT true $$;
CREATE TABLE public.plan_course_components(id uuid PRIMARY KEY, component_type text,
  counts_toward_regular_load boolean, weekly_contact_hours numeric);
CREATE TABLE public.delivery_groups(id uuid PRIMARY KEY, cohort_id uuid, component_id uuid,
  plan_course_id uuid, excluded_from_standard_workload boolean);
CREATE TABLE public.teaching_assignments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL, course_offering_id uuid NOT NULL, instructor_id uuid NOT NULL,
  section_number text, session_type text, weekly_hours numeric, required_room_type text, notes text,
  expected_students int, section_id uuid, cohort_id uuid, plan_course_component_id uuid,
  delivery_group_id uuid, assigned_component_hours numeric, is_active boolean DEFAULT true);
CREATE TABLE public.existing_schedule_intake(college_id uuid, term_id uuid, enabled boolean);
CREATE TABLE public.schedule_versions(id uuid PRIMARY KEY, college_id uuid, academic_term_id uuid, status text);
CREATE TABLE public.schedule_sessions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), college_id uuid,
  schedule_version_id uuid, teaching_assignment_id uuid, instructor_id uuid, room_id uuid,
  day_of_week smallint, start_time time, end_time time, delivery_group_id uuid, cohort_id uuid,
  is_locked boolean NOT NULL DEFAULT false);
CREATE TABLE public.faculty_teaching_requests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id uuid, instructor_id uuid, home_college_id uuid, college_id uuid, delivery_group_id uuid,
  term_id uuid, assigned_hours numeric, assignment_id uuid, status text, decided_by uuid,
  decided_at timestamptz, created_at timestamptz DEFAULT now());
CREATE TABLE public.audit_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid,
  action text, entity text, entity_id uuid, college_id uuid, details jsonb);
CREATE TABLE schedule_version_delivery_private.instructor_hour_waivers(assignment_id uuid,
  version_id uuid, college_id uuid, term_id uuid, instructor_id uuid, group_id uuid, source_assignment_id uuid);
CREATE FUNCTION public.can_manage_college(uuid,uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
-- Rev2 objects Rev3 depends on.
CREATE TABLE assignment_version_private.original_defs(signature text PRIMARY KEY, definition text NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE assignment_version_private.scope(assignment_id uuid PRIMARY KEY, version_id uuid NOT NULL,
  replaces_assignment_id uuid NOT NULL, request_id uuid, created_by uuid,
  created_at timestamptz DEFAULT now(), UNIQUE(version_id, replaces_assignment_id));
CREATE TABLE assignment_version_private.move_receipts(version_id uuid, before_snapshot text,
  after_snapshot text, moved int, actor uuid, applied_at timestamptz DEFAULT now());

-- ===== Live view, verbatim =====
CREATE VIEW public.v_instructor_delivery_workload AS
 SELECT ta.college_id, ta.instructor_id, i.academic_rank, ta.cohort_id, ac.term_id,
    sum(CASE
            WHEN (pcc.component_type = 'summer_training'::text) THEN (0)::numeric
            WHEN (COALESCE(dg.excluded_from_standard_workload, false) OR (COALESCE(pcc.counts_toward_regular_load, true) = false)) THEN (0)::numeric
            WHEN (( SELECT (count(*))::integer AS count FROM teaching_assignments ta2
              WHERE ((ta2.delivery_group_id = ta.delivery_group_id) AND (ta2.delivery_group_id IS NOT NULL) AND (ta2.is_active = true))) > 1) THEN COALESCE(ta.assigned_component_hours, (0)::numeric)
            ELSE COALESCE(ta.assigned_component_hours, pcc.weekly_contact_hours, (0)::numeric)
        END) AS standard_assigned_hours,
    sum(CASE
            WHEN ((pcc.component_type = 'project'::text) AND (COALESCE(pcc.counts_toward_regular_load, true) = false)) THEN
            CASE
                WHEN (( SELECT (count(*))::integer AS count FROM teaching_assignments ta2
                  WHERE ((ta2.delivery_group_id = ta.delivery_group_id) AND (ta2.delivery_group_id IS NOT NULL) AND (ta2.is_active = true))) > 1) THEN COALESCE(ta.assigned_component_hours, (0)::numeric)
                ELSE COALESCE(ta.assigned_component_hours, pcc.weekly_contact_hours, (0)::numeric)
            END
            ELSE (0)::numeric
        END) AS project_supervision_hours
   FROM ((((teaching_assignments ta
     JOIN instructors i ON ((i.id = ta.instructor_id)))
     LEFT JOIN delivery_groups dg ON ((dg.id = ta.delivery_group_id)))
     LEFT JOIN plan_course_components pcc ON ((pcc.id = COALESCE(ta.plan_course_component_id, dg.component_id))))
     LEFT JOIN academic_cohorts ac ON ((ac.id = COALESCE(ta.cohort_id, dg.cohort_id))))
  WHERE ((ta.delivery_group_id IS NOT NULL) AND (ta.is_active = true))
  GROUP BY ta.college_id, ta.instructor_id, i.academic_rank, ta.cohort_id, ac.term_id;

-- ===== Live faculty_private.workload, verbatim =====
CREATE OR REPLACE FUNCTION faculty_private.workload(p_instructor_id uuid, p_term_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE h record;v_ids uuid[];v_terms uuid[];v_year text;v_type text;
 v_hours numeric;v_project numeric;v_colleges jsonb;v_pending boolean;
BEGIN
 SELECT hp.* INTO h FROM faculty_private.home_profiles hp JOIN faculty_identity_links l ON l.identity_id=hp.identity_id WHERE l.instructor_id=p_instructor_id;
 IF h.identity_id IS NULL THEN RAISE EXCEPTION 'FACULTY_IDENTITY_NOT_FOUND'; END IF;
 SELECT array_agg(instructor_id) INTO v_ids FROM faculty_identity_links WHERE identity_id=h.identity_id;
 IF p_term_id IS NOT NULL THEN
  SELECT coalesce(nullif(btrim(academic_year),''),substring(t.name from '[0-9]{4}-[0-9]{4}')),t.term_type INTO v_year,v_type FROM academic_terms t
  JOIN colleges c ON c.id=t.college_id WHERE t.id=p_term_id AND c.university_id=h.university_id;
  IF v_year IS NULL OR v_type IS NULL THEN RAISE EXCEPTION 'FACULTY_REPORT_TERM_METADATA_REQUIRED'; END IF;
  SELECT array_agg(t.id) INTO v_terms FROM academic_terms t JOIN colleges c ON c.id=t.college_id
  WHERE c.university_id=h.university_id AND coalesce(nullif(btrim(t.academic_year),''),substring(t.name from '[0-9]{4}-[0-9]{4}'))=v_year AND t.term_type=v_type;
 END IF;
 SELECT coalesce(sum(standard_assigned_hours),0),coalesce(sum(project_supervision_hours),0)
 INTO v_hours,v_project FROM v_instructor_delivery_workload WHERE instructor_id=ANY(v_ids) AND (p_term_id IS NULL OR term_id=ANY(v_terms));
 SELECT EXISTS(SELECT 1 FROM teaching_assignments a JOIN course_offerings o ON o.id=a.course_offering_id
 WHERE a.instructor_id=ANY(v_ids) AND a.is_active AND (p_term_id IS NULL OR o.term_id=ANY(v_terms))
 AND (a.delivery_group_id IS NULL OR (a.assigned_component_hours IS NULL AND
  (SELECT count(*) FROM teaching_assignments b WHERE b.delivery_group_id=a.delivery_group_id AND b.is_active)>1)))
 OR EXISTS(SELECT 1 FROM teaching_assignments a JOIN course_offerings o ON o.id=a.course_offering_id
 WHERE a.instructor_id=ANY(v_ids) AND a.is_active AND a.delivery_group_id IS NOT NULL AND (p_term_id IS NULL OR o.term_id=ANY(v_terms))
 GROUP BY a.delivery_group_id HAVING count(*)>1) INTO v_pending;
 SELECT coalesce(jsonb_agg(x),'[]') INTO v_colleges FROM (
 SELECT college_id,college_id=h.home_college_id AS is_home_college,sum(standard_assigned_hours) AS standard_assigned_hours,
 sum(project_supervision_hours) AS project_supervision_hours FROM v_instructor_delivery_workload
 WHERE instructor_id=ANY(v_ids) AND (p_term_id IS NULL OR term_id=ANY(v_terms)) GROUP BY college_id) x;
 RETURN jsonb_build_object('instructor_id',p_instructor_id,'identity_id',h.identity_id,'college_id',h.home_college_id,
 'term_id',p_term_id,'rank_code',NULL,'academic_rank',h.academic_rank,'required_load_hours',h.quota,
 'quota_applicable',faculty_private.quota_applicability(h.type_code,h.employment_type),
 'standard_assigned_hours',v_hours,'project_supervision_hours',v_project,'hours_by_college',v_colleges,'allocation_pending',v_pending,
 'deficit_hours',CASE WHEN NOT v_pending AND h.quota IS NOT NULL THEN greatest(0,h.quota-v_hours) END,
 'overload_hours',CASE WHEN NOT v_pending AND h.quota IS NOT NULL THEN greatest(0,v_hours-h.quota) END,
 'status',CASE WHEN v_pending THEN 'allocation_pending'
 WHEN faculty_private.quota_applicability(h.type_code,h.employment_type) IS FALSE THEN 'not_applicable'
 WHEN h.quota IS NULL THEN 'policy_missing'
 WHEN v_hours=0 THEN 'unassigned' WHEN v_hours>h.quota THEN 'overload' WHEN v_hours<h.quota THEN 'deficit' ELSE 'ok' END);
END $function$;

-- ===== Live faculty_private.guard_assignment_request, verbatim =====
CREATE OR REPLACE FUNCTION faculty_private.guard_assignment_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE h record; v_request uuid;
BEGIN
 IF NOT NEW.is_active THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND OLD.is_active AND NEW.instructor_id=OLD.instructor_id
  AND NEW.delivery_group_id IS NOT DISTINCT FROM OLD.delivery_group_id AND NEW.college_id=OLD.college_id
  AND NEW.assigned_component_hours IS NOT DISTINCT FROM OLD.assigned_component_hours
  AND NEW.weekly_hours IS NOT DISTINCT FROM OLD.weekly_hours THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(180600,1);
 SELECT hp.* INTO h FROM faculty_private.home_profiles hp JOIN faculty_identity_links l ON l.identity_id=hp.identity_id
 WHERE l.instructor_id=NEW.instructor_id;
 
 IF EXISTS (
   SELECT 1 FROM schedule_version_delivery_private.instructor_hour_waivers w
   JOIN public.schedule_versions draft ON draft.id=w.version_id
   JOIN public.teaching_assignments src ON src.id=w.source_assignment_id
   JOIN public.delivery_groups target ON target.id=w.group_id
   JOIN public.delivery_groups old_group ON old_group.id=src.delivery_group_id
   JOIN public.schedule_sessions published ON published.teaching_assignment_id=src.id
     AND published.delivery_group_id=src.delivery_group_id
   JOIN public.schedule_versions v2 ON v2.id=published.schedule_version_id
   WHERE w.assignment_id=NEW.id AND w.instructor_id=NEW.instructor_id
     AND w.group_id=NEW.delivery_group_id AND w.college_id=NEW.college_id
     AND draft.status='draft' AND draft.college_id=NEW.college_id
     AND draft.academic_term_id=w.term_id
     AND v2.id='30f8a76d-1cb9-4944-a5d7-483dcaea7692'::uuid
     AND v2.status='published' AND v2.college_id=NEW.college_id
     AND v2.academic_term_id=w.term_id
     AND src.is_active AND src.instructor_id=NEW.instructor_id
     AND src.college_id=NEW.college_id
     AND src.course_offering_id=NEW.course_offering_id
     AND src.cohort_id=NEW.cohort_id
     AND src.plan_course_component_id=NEW.plan_course_component_id
     AND src.session_type=NEW.session_type
     AND src.weekly_hours=NEW.weekly_hours
     AND src.assigned_component_hours IS NOT DISTINCT FROM NEW.assigned_component_hours
     AND src.required_room_type IS NOT DISTINCT FROM NEW.required_room_type
     AND target.cohort_id=old_group.cohort_id
     AND target.component_id=old_group.component_id
     AND target.plan_course_id=old_group.plan_course_id
     AND NOT EXISTS (
       SELECT 1 FROM public.teaching_assignments other
       WHERE other.delivery_group_id=NEW.delivery_group_id
         AND other.is_active AND other.id<>NEW.id
         AND (other.instructor_id=NEW.instructor_id OR EXISTS (
           SELECT 1 FROM public.faculty_identity_links a
           JOIN public.faculty_identity_links b ON b.identity_id=a.identity_id
           WHERE a.instructor_id=other.instructor_id AND b.instructor_id=NEW.instructor_id))
     )
 ) THEN RETURN NEW; END IF;
 IF h.home_college_id IS NULL THEN RAISE EXCEPTION 'FACULTY_HOME_REVIEW_REQUIRED'; END IF;
 IF NEW.delivery_group_id IS NOT NULL AND EXISTS(
  SELECT 1 FROM teaching_assignments a JOIN faculty_identity_links l ON l.instructor_id=a.instructor_id
  WHERE a.delivery_group_id=NEW.delivery_group_id AND a.is_active AND a.id<>NEW.id AND l.identity_id=h.identity_id)
 THEN RAISE EXCEPTION 'DUPLICATE_FACULTY_ASSIGNMENT'; END IF;
 IF h.home_college_id=NEW.college_id THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'اعتماد التكليف من الكلية الأصلية مطلوب قبل الإسناد';
END $function$;
-- (Only the cross-college request tail is shortened; Rev3 does not patch it.)

-- ===== Live public.enforce_instructor_extra_hours_limit, verbatim =====
CREATE OR REPLACE FUNCTION public.existing_schedule_intake_enabled(p_college uuid, p_term uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.existing_schedule_intake i
    WHERE i.college_id = p_college AND i.term_id = p_term AND i.enabled);
$function$;
CREATE OR REPLACE FUNCTION public.enforce_instructor_extra_hours_limit()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_term uuid; v_load jsonb; v_quota numeric; v_waived boolean;
BEGIN
  IF NOT coalesce(NEW.is_active,false) THEN RETURN NEW; END IF;
  SELECT term_id INTO v_term FROM public.course_offerings WHERE id=NEW.course_offering_id;
  IF public.existing_schedule_intake_enabled(NEW.college_id,v_term) THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(180600,1);
  v_load:=faculty_private.workload(NEW.instructor_id,v_term);
  v_quota:=(v_load->>'required_load_hours')::numeric;
  SELECT EXISTS (
    SELECT 1 FROM schedule_version_delivery_private.instructor_hour_waivers w
    JOIN public.schedule_versions v ON v.id=w.version_id
    JOIN public.delivery_groups g ON g.id=w.group_id
    WHERE w.assignment_id=NEW.id AND w.instructor_id=NEW.instructor_id
      AND w.college_id=NEW.college_id AND w.term_id=v_term
      AND w.group_id=NEW.delivery_group_id
      AND v.status='draft' AND v.college_id=w.college_id
      AND v.academic_term_id=w.term_id
      AND g.cohort_id=NEW.cohort_id
      AND EXISTS (
        SELECT 1 FROM public.teaching_assignments src
        WHERE src.id=w.source_assignment_id AND src.instructor_id=NEW.instructor_id
          AND src.course_offering_id=NEW.course_offering_id
          AND src.plan_course_component_id=NEW.plan_course_component_id
      )
  ) INTO v_waived;
  IF (v_load->>'allocation_pending')::boolean THEN
    RAISE EXCEPTION 'FACULTY_ALLOCATION_REVIEW_REQUIRED' USING ERRCODE='23514';
  END IF;
  IF (v_load->>'quota_applicable')::boolean IS FALSE AND EXISTS (
    SELECT 1 FROM public.instructors i
    JOIN public.instructor_types t ON t.id=i.instructor_type_id
    WHERE i.id=NEW.instructor_id AND i.employment_type='contract' AND t.code='con'
  ) THEN RETURN NEW; END IF;
  IF v_quota IS NULL AND NOT v_waived THEN
    RAISE EXCEPTION 'INSTRUCTOR_QUOTA_REQUIRED: يجب اعتماد النصاب من الكلية الأصلية' USING ERRCODE='23514';
  END IF;
  IF (v_load->>'standard_assigned_hours')::numeric>v_quota+12 AND NOT v_waived THEN
    RAISE EXCEPTION 'INSTRUCTOR_EXTRA_HOURS_LIMIT_EXCEEDED: الساعات الزائدة لا يجوز أن تتجاوز 12 ساعة أسبوعيًا' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER zz_faculty_assignment_request BEFORE INSERT OR UPDATE ON public.teaching_assignments
FOR EACH ROW EXECUTE FUNCTION faculty_private.guard_assignment_request();
CREATE CONSTRAINT TRIGGER enforce_instructor_extra_hours_limit AFTER INSERT OR UPDATE ON public.teaching_assignments
FOR EACH ROW EXECUTE FUNCTION public.enforce_instructor_extra_hours_limit();

-- Deferred session constraint stand-ins with the live names.
CREATE FUNCTION public.fixture_instructor_overlap() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.schedule_sessions o WHERE o.id<>NEW.id
     AND o.schedule_version_id=NEW.schedule_version_id AND o.instructor_id=NEW.instructor_id
     AND o.day_of_week=NEW.day_of_week AND o.start_time<NEW.end_time AND NEW.start_time<o.end_time) THEN
    RAISE EXCEPTION 'FIXTURE_DEFERRED_INSTRUCTOR_CLASH' USING ERRCODE='check_violation';
  END IF; RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER coordination_sessions_final AFTER INSERT OR UPDATE ON public.schedule_sessions
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.fixture_instructor_overlap();
CREATE CONSTRAINT TRIGGER instructor_daily_session_cap_final AFTER INSERT OR UPDATE ON public.schedule_sessions
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.fixture_instructor_overlap();

-- ===== Data =====
-- U university, C=ITCS, X=other college, T term; A, B lecturers home C; Q lecturer home X.
INSERT INTO public.colleges VALUES ('c0000000-0000-4000-8000-00000000000c','a0000000-0000-4000-8000-000000000001'),
  ('c0000000-0000-4000-8000-00000000000f','a0000000-0000-4000-8000-000000000001');
INSERT INTO public.academic_terms VALUES ('70000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-00000000000c','2026-2027','S1','first');
INSERT INTO public.academic_cohorts VALUES ('ac000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001');
INSERT INTO public.course_offerings VALUES ('0f000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001');
INSERT INTO public.plan_course_components VALUES ('9c000000-0000-4000-8000-000000000001','theory',true,3),
  ('9c000000-0000-4000-8000-000000000002','theory',true,18);
INSERT INTO public.delivery_groups VALUES
  ('d0000000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-000000000001','9c000000-0000-4000-8000-000000000001',null,false),
  ('d0000000-0000-4000-8000-000000000002','ac000000-0000-4000-8000-000000000001','9c000000-0000-4000-8000-000000000002',null,false),
  ('d0000000-0000-4000-8000-000000000003','ac000000-0000-4000-8000-000000000001','9c000000-0000-4000-8000-000000000001',null,false);
INSERT INTO public.instructors(id,college_id) VALUES
  ('1a000000-0000-4000-8000-00000000000a','c0000000-0000-4000-8000-00000000000c'),
  ('1b000000-0000-4000-8000-00000000000b','c0000000-0000-4000-8000-00000000000c'),
  ('1f000000-0000-4000-8000-00000000000f','c0000000-0000-4000-8000-00000000000f');
INSERT INTO faculty_private.home_profiles(identity_id,home_college_id,university_id,quota) VALUES
  ('1d000000-0000-4000-8000-00000000000a','c0000000-0000-4000-8000-00000000000c','a0000000-0000-4000-8000-000000000001',12),
  ('1d000000-0000-4000-8000-00000000000b','c0000000-0000-4000-8000-00000000000c','a0000000-0000-4000-8000-000000000001',12),
  ('1d000000-0000-4000-8000-00000000000f','c0000000-0000-4000-8000-00000000000f','a0000000-0000-4000-8000-000000000001',12);
INSERT INTO public.faculty_identity_links VALUES
  ('1d000000-0000-4000-8000-00000000000a','1a000000-0000-4000-8000-00000000000a'),
  ('1d000000-0000-4000-8000-00000000000b','1b000000-0000-4000-8000-00000000000b'),
  ('1d000000-0000-4000-8000-00000000000f','1f000000-0000-4000-8000-00000000000f');
INSERT INTO public.schedule_versions VALUES
  ('30f8a76d-1cb9-4944-a5d7-483dcaea7692','c0000000-0000-4000-8000-00000000000c','70000000-0000-4000-8000-000000000001','published'),
  ('d68d8d22-9a6d-4f21-935f-cebf18bb969b','c0000000-0000-4000-8000-00000000000c','70000000-0000-4000-8000-000000000001','draft'),
  ('e0000000-0000-4000-8000-00000000000e','c0000000-0000-4000-8000-00000000000c','70000000-0000-4000-8000-000000000001','draft');
-- A: OLD (group 1, NULL hours -> 3h from component) + 18h other load = 21h.
INSERT INTO public.teaching_assignments(id,college_id,course_offering_id,instructor_id,cohort_id,plan_course_component_id,delivery_group_id,weekly_hours,session_type) VALUES
  ('01d00000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-00000000000c','0f000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-00000000000a','ac000000-0000-4000-8000-000000000001','9c000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001',3,'lecture'),
  ('01d00000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-00000000000c','0f000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-00000000000a','ac000000-0000-4000-8000-000000000001','9c000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000002',18,'lecture'),
  ('01d00000-0000-4000-8000-000000000003','c0000000-0000-4000-8000-00000000000c','0f000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-00000000000a','ac000000-0000-4000-8000-000000000001','9c000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000003',3,'lecture');
INSERT INTO public.schedule_sessions(id,college_id,schedule_version_id,teaching_assignment_id,instructor_id,day_of_week,start_time,end_time,delivery_group_id) VALUES
  ('5e000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-00000000000c','30f8a76d-1cb9-4944-a5d7-483dcaea7692','01d00000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-00000000000a',0,'08:00','11:00','d0000000-0000-4000-8000-000000000001'),
  ('5e000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-00000000000c','d68d8d22-9a6d-4f21-935f-cebf18bb969b','01d00000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-00000000000a',0,'08:00','11:00','d0000000-0000-4000-8000-000000000001'),
  ('5e000000-0000-4000-8000-000000000003','c0000000-0000-4000-8000-00000000000c','d68d8d22-9a6d-4f21-935f-cebf18bb969b','01d00000-0000-4000-8000-000000000003','1a000000-0000-4000-8000-00000000000a',1,'08:00','11:00','d0000000-0000-4000-8000-000000000003'),
  ('5e000000-0000-4000-8000-000000000004','c0000000-0000-4000-8000-00000000000c','d68d8d22-9a6d-4f21-935f-cebf18bb969b','01d00000-0000-4000-8000-000000000002','1a000000-0000-4000-8000-00000000000a',2,'08:00','11:00','d0000000-0000-4000-8000-000000000002');

CREATE TEMP TABLE baseline AS SELECT faculty_private.workload('1a000000-0000-4000-8000-00000000000a','70000000-0000-4000-8000-000000000001') w,
  (SELECT md5(string_agg(v::text, ',' ORDER BY v::text)) FROM public.v_instructor_delivery_workload v) vw;

-- ===== PRE-Rev3: reproduce the P0 on the verbatim live functions =====
DO $pre$
BEGIN
  -- Same-identity clone (A replaces A in the draft): live guard refuses.
  INSERT INTO assignment_version_private.scope(assignment_id,version_id,replaces_assignment_id)
  VALUES ('0e000000-0000-4000-8000-000000000001','d68d8d22-9a6d-4f21-935f-cebf18bb969b','01d00000-0000-4000-8000-000000000001');
  BEGIN
    INSERT INTO public.teaching_assignments(id,college_id,course_offering_id,instructor_id,cohort_id,plan_course_component_id,delivery_group_id,assigned_component_hours,weekly_hours,session_type)
    VALUES ('0e000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-00000000000c','0f000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-00000000000a','ac000000-0000-4000-8000-000000000001','9c000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001',3,3,'lecture');
    RAISE EXCEPTION 'PRE_EXPECTED_DUPLICATE';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'DUPLICATE_FACULTY_ASSIGNMENT' THEN RAISE EXCEPTION 'pre clone: %', SQLERRM; END IF;
  END;
  DELETE FROM assignment_version_private.scope;
  -- Different lecturer B: row is accepted, but A's published workload is corrupted.
  INSERT INTO assignment_version_private.scope(assignment_id,version_id,replaces_assignment_id)
  VALUES ('0e000000-0000-4000-8000-000000000002','d68d8d22-9a6d-4f21-935f-cebf18bb969b','01d00000-0000-4000-8000-000000000001');
  INSERT INTO public.teaching_assignments(id,college_id,course_offering_id,instructor_id,cohort_id,plan_course_component_id,delivery_group_id,assigned_component_hours,weekly_hours,session_type)
  VALUES ('0e000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-00000000000c','0f000000-0000-4000-8000-000000000001','1b000000-0000-4000-8000-00000000000b','ac000000-0000-4000-8000-000000000001','9c000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001',3,3,'lecture');
  IF faculty_private.workload('1a000000-0000-4000-8000-00000000000a','70000000-0000-4000-8000-000000000001')->>'status' <> 'allocation_pending' THEN
    RAISE EXCEPTION 'pre: expected published lecturer to become allocation_pending'; END IF;
  -- Any later write for A now fails the live hours trigger.
  BEGIN
    UPDATE public.teaching_assignments SET weekly_hours=18 WHERE id='01d00000-0000-4000-8000-000000000002';
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'PRE_EXPECTED_PENDING';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'FACULTY_ALLOCATION_REVIEW_REQUIRED' THEN RAISE EXCEPTION 'pre pending: %', SQLERRM; END IF;
  END;
  SET CONSTRAINTS ALL DEFERRED;
  RAISE EXCEPTION 'PRE_OK';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'PRE_OK' THEN RAISE; END IF;
END $pre$;
SELECT 'PRE-Rev3 reproduced: DUPLICATE_FACULTY_ASSIGNMENT + allocation_pending on published lecturer' AS result;

-- ===== Apply Rev2 writer functions (extracted) and Rev3 =====
\ir .rev2-writers.sql
\ir ../docs/migrations-proposed/20260927b_itcs_version_scoped_workload_guards.sql

DO $post$
DECLARE wl jsonb;
BEGIN
  -- No scope rows: every definition behaves exactly like live.
  IF (SELECT md5(string_agg(v::text, ',' ORDER BY v::text)) FROM public.v_instructor_delivery_workload v) <> (SELECT vw FROM baseline)
     OR faculty_private.workload('1a000000-0000-4000-8000-00000000000a','70000000-0000-4000-8000-000000000001') <> (SELECT b.w FROM baseline b) THEN
    RAISE EXCEPTION 'post: no-scope behaviour changed'; END IF;

  -- (1) Different lecturer B in the enabled draft.
  INSERT INTO assignment_version_private.scope(assignment_id,version_id,replaces_assignment_id)
  VALUES ('0e000000-0000-4000-8000-000000000002','d68d8d22-9a6d-4f21-935f-cebf18bb969b','01d00000-0000-4000-8000-000000000001');
  INSERT INTO public.teaching_assignments(id,college_id,course_offering_id,instructor_id,cohort_id,plan_course_component_id,delivery_group_id,assigned_component_hours,weekly_hours,session_type)
  VALUES ('0e000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-00000000000c','0f000000-0000-4000-8000-000000000001','1b000000-0000-4000-8000-00000000000b','ac000000-0000-4000-8000-000000000001','9c000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001',3,3,'lecture');
  SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED;
  IF faculty_private.workload('1a000000-0000-4000-8000-00000000000a','70000000-0000-4000-8000-000000000001') <> (SELECT b.w FROM baseline b) THEN
    RAISE EXCEPTION 'post(1): published lecturer workload changed'; END IF;
  wl := faculty_private.workload('1b000000-0000-4000-8000-00000000000b','70000000-0000-4000-8000-000000000001');
  IF (wl->>'standard_assigned_hours')::numeric <> 3 OR (wl->>'allocation_pending')::boolean THEN
    RAISE EXCEPTION 'post(1): replacement lecturer workload %', wl; END IF;

  -- (2) Same-identity clone of A on group 3: guard passes, hours NOT doubled.
  INSERT INTO assignment_version_private.scope(assignment_id,version_id,replaces_assignment_id)
  VALUES ('0e000000-0000-4000-8000-000000000003','d68d8d22-9a6d-4f21-935f-cebf18bb969b','01d00000-0000-4000-8000-000000000003');
  INSERT INTO public.teaching_assignments(id,college_id,course_offering_id,instructor_id,cohort_id,plan_course_component_id,delivery_group_id,assigned_component_hours,weekly_hours,session_type)
  VALUES ('0e000000-0000-4000-8000-000000000003','c0000000-0000-4000-8000-00000000000c','0f000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-00000000000a','ac000000-0000-4000-8000-000000000001','9c000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000003',3,3,'lecture');
  SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED;
  wl := faculty_private.workload('1a000000-0000-4000-8000-00000000000a','70000000-0000-4000-8000-000000000001');
  IF (wl->>'standard_assigned_hours')::numeric <> 24 OR (wl->>'allocation_pending')::boolean THEN
    RAISE EXCEPTION 'post(2): clone doubled or pending %', wl; END IF;

  -- (3) Non-enabled draft: identical to live -> duplicate still refused.
  BEGIN
    INSERT INTO assignment_version_private.scope(assignment_id,version_id,replaces_assignment_id)
    VALUES ('0e000000-0000-4000-8000-000000000004','e0000000-0000-4000-8000-00000000000e','01d00000-0000-4000-8000-000000000002');
    INSERT INTO public.teaching_assignments(id,college_id,course_offering_id,instructor_id,cohort_id,plan_course_component_id,delivery_group_id,assigned_component_hours,weekly_hours,session_type)
    VALUES ('0e000000-0000-4000-8000-000000000004','c0000000-0000-4000-8000-00000000000c','0f000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-00000000000a','ac000000-0000-4000-8000-000000000001','9c000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000002',18,18,'lecture');
    RAISE EXCEPTION 'post(3): non-enabled version accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'DUPLICATE_FACULTY_ASSIGNMENT' THEN RAISE EXCEPTION 'post(3): %', SQLERRM; END IF;
  END;

  -- (4) Plain global duplicate (no scope) still refused.
  BEGIN
    INSERT INTO public.teaching_assignments(college_id,course_offering_id,instructor_id,cohort_id,plan_course_component_id,delivery_group_id,assigned_component_hours,weekly_hours,session_type)
    VALUES ('c0000000-0000-4000-8000-00000000000c','0f000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-00000000000a','ac000000-0000-4000-8000-000000000001','9c000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000002',18,18,'lecture');
    RAISE EXCEPTION 'post(4): global duplicate accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'DUPLICATE_FACULTY_ASSIGNMENT' THEN RAISE EXCEPTION 'post(4): %', SQLERRM; END IF;
  END;

  -- (5) Once the draft is no longer draft, pairs stop counting (fail closed).
  UPDATE public.schedule_versions SET status='review' WHERE id='d68d8d22-9a6d-4f21-935f-cebf18bb969b';
  IF NOT (faculty_private.workload('1a000000-0000-4000-8000-00000000000a','70000000-0000-4000-8000-000000000001')->>'allocation_pending')::boolean THEN
    RAISE EXCEPTION 'post(5): pair still honoured outside draft'; END IF;
  UPDATE public.schedule_versions SET status='draft' WHERE id='d68d8d22-9a6d-4f21-935f-cebf18bb969b';
END $post$;
SELECT 'POST-Rev3 PASS: published workload unchanged, clone not doubled, non-enabled/global duplicates refused' AS result;

-- ===== Writer / moves patches =====
SET request.jwt.claim.sub = '99999999-9999-4999-8999-999999999999';
DO $w$
BEGIN
  -- Same identity may not raise hours through a scoped clone.
  BEGIN
    PERFORM assignment_version_private.apply_replacement('d68d8d22-9a6d-4f21-935f-cebf18bb969b',
      '01d00000-0000-4000-8000-000000000002','1a000000-0000-4000-8000-00000000000a',19,NULL);
    RAISE EXCEPTION 'writer accepted hours increase';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'SAME_IDENTITY_REPLACEMENT_HOURS_INCREASE' THEN RAISE EXCEPTION 'writer: %', SQLERRM; END IF;
  END;
  -- Not allow-listed version.
  BEGIN
    PERFORM assignment_version_private.apply_replacement('e0000000-0000-4000-8000-00000000000e',
      '01d00000-0000-4000-8000-000000000002','1b000000-0000-4000-8000-00000000000b',18,NULL);
    RAISE EXCEPTION 'writer accepted non-enabled version';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT IN ('VERSION_NOT_ENABLED_FOR_SCOPED_ASSIGNMENTS','REPLACED_ASSIGNMENT_NOT_IN_VERSION') THEN RAISE EXCEPTION 'writer2: %', SQLERRM; END IF;
  END;
  -- Locked draft session.
  UPDATE public.schedule_sessions SET is_locked=true WHERE id='5e000000-0000-4000-8000-000000000004';
  BEGIN
    PERFORM assignment_version_private.apply_replacement('d68d8d22-9a6d-4f21-935f-cebf18bb969b',
      '01d00000-0000-4000-8000-000000000002','1b000000-0000-4000-8000-00000000000b',18,NULL);
    RAISE EXCEPTION 'writer accepted locked session';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'REPLACED_SESSION_LOCKED' THEN RAISE EXCEPTION 'writer3: %', SQLERRM; END IF;
  END;
  BEGIN
    PERFORM public.apply_version_session_moves('d68d8d22-9a6d-4f21-935f-cebf18bb969b',
      '[{"session_id":"5e000000-0000-4000-8000-000000000004","day_of_week":3,"start_time":"08:00","end_time":"11:00","room_id":null}]',1,
      public.schedule_version_session_snapshot('d68d8d22-9a6d-4f21-935f-cebf18bb969b'),
      public.preview_version_session_moves('d68d8d22-9a6d-4f21-935f-cebf18bb969b',
      '[{"session_id":"5e000000-0000-4000-8000-000000000004","day_of_week":3,"start_time":"08:00","end_time":"11:00","room_id":null}]'));
    RAISE EXCEPTION 'moves accepted locked session';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'MOVE_LOCKED_SESSION' THEN RAISE EXCEPTION 'moves1: %', SQLERRM; END IF;
  END;
  UPDATE public.schedule_sessions SET is_locked=false WHERE id='5e000000-0000-4000-8000-000000000004';
  -- Deferred conflict surfaces INSIDE the call (caught here, not at COMMIT).
  BEGIN
    PERFORM public.apply_version_session_moves('d68d8d22-9a6d-4f21-935f-cebf18bb969b',
      '[{"session_id":"5e000000-0000-4000-8000-000000000004","day_of_week":1,"start_time":"09:00","end_time":"12:00","room_id":null}]',1,
      public.schedule_version_session_snapshot('d68d8d22-9a6d-4f21-935f-cebf18bb969b'),
      public.preview_version_session_moves('d68d8d22-9a6d-4f21-935f-cebf18bb969b',
      '[{"session_id":"5e000000-0000-4000-8000-000000000004","day_of_week":1,"start_time":"09:00","end_time":"12:00","room_id":null}]'));
    RAISE EXCEPTION 'moves accepted deferred clash';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'FIXTURE_DEFERRED_INSTRUCTOR_CLASH' THEN RAISE EXCEPTION 'moves2: %', SQLERRM; END IF;
  END;
  IF EXISTS (SELECT 1 FROM assignment_version_private.move_receipts) THEN
    RAISE EXCEPTION 'receipt written despite deferred clash'; END IF;
END $w$;
SELECT 'WRITER/MOVES PASS: hours-increase, allow-list, locked rows, deferred conflict inside call' AS result;

-- ===== Rollback restores live definitions =====
DELETE FROM public.teaching_assignments WHERE id IN (SELECT assignment_id FROM assignment_version_private.scope);
DELETE FROM assignment_version_private.scope;
\ir ../docs/migrations-proposed/20260927b_itcs_version_scoped_workload_guards_rollback.sql
DO $rb$ BEGIN
  IF (SELECT md5(string_agg(v::text, ',' ORDER BY v::text)) FROM public.v_instructor_delivery_workload v) <> (SELECT vw FROM baseline)
     OR position('is_replacement_pair' IN pg_get_functiondef('faculty_private.workload(uuid,uuid)'::regprocedure)) > 0
     OR position('is_replacement_pair' IN pg_get_functiondef('faculty_private.guard_assignment_request()'::regprocedure)) > 0
     OR position('enabled_versions' IN pg_get_functiondef('assignment_version_private.apply_replacement(uuid,uuid,uuid,numeric,uuid)'::regprocedure)) > 0 THEN
    RAISE EXCEPTION 'rollback incomplete'; END IF;
END $rb$;
SELECT 'ROLLBACK PASS' AS result;
