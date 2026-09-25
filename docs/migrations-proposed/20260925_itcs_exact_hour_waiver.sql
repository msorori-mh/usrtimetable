-- Stage ITCS-ISO-02f. An exact six-assignment ledger is populated atomically
-- with the draft. It records the user's aggregate-hour waiver and permission
-- to clone the same lecturer's already published assignment onto a new group.
-- All unrelated faculty requests, quotas and pending-allocation gates remain.
BEGIN;
SET LOCAL lock_timeout='5s';

CREATE TABLE schedule_version_delivery_private.instructor_hour_waivers (
  assignment_id uuid PRIMARY KEY,
  version_id uuid NOT NULL REFERENCES public.schedule_versions(id),
  college_id uuid NOT NULL REFERENCES public.colleges(id),
  term_id uuid NOT NULL REFERENCES public.academic_terms(id),
  instructor_id uuid NOT NULL REFERENCES public.instructors(id),
  group_id uuid NOT NULL REFERENCES public.delivery_groups(id),
  source_assignment_id uuid NOT NULL REFERENCES public.teaching_assignments(id),
  reason text NOT NULL DEFAULT 'ITCS first-year 2026 regrouping, user-approved aggregate-hour exception',
  CHECK (version_id='d68d8d22-9a6d-4f21-935f-cebf18bb969b'::uuid),
  CHECK (college_id='7168345f-cf9d-4789-b2ad-547abb687dc8'::uuid),
  CHECK (term_id='18dd364a-76d7-40b8-a217-fa929c082a7f'::uuid),
  UNIQUE (version_id, group_id, instructor_id)
);
COMMENT ON TABLE schedule_version_delivery_private.instructor_hour_waivers IS
  'Exact six draft assignments: aggregate-hour waiver and published-source lecturer clone authorization.';
REVOKE ALL ON schedule_version_delivery_private.instructor_hour_waivers
  FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.enforce_instructor_extra_hours_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $body$
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
  -- The exact published-source clone also covers a missing institutional
  -- quota rule; no rank or home-college value is fabricated for a lecturer.
  IF v_quota IS NULL AND NOT v_waived THEN
    RAISE EXCEPTION 'INSTRUCTOR_QUOTA_REQUIRED: يجب اعتماد النصاب من الكلية الأصلية' USING ERRCODE='23514';
  END IF;
  IF (v_load->>'allocation_pending')::boolean THEN
    RAISE EXCEPTION 'FACULTY_ALLOCATION_REVIEW_REQUIRED' USING ERRCODE='23514';
  END IF;
  IF (v_load->>'standard_assigned_hours')::numeric>v_quota+12 AND NOT v_waived THEN
    RAISE EXCEPTION 'INSTRUCTOR_EXTRA_HOURS_LIMIT_EXCEEDED: الساعات الزائدة لا يجوز أن تتجاوز 12 ساعة أسبوعيًا' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$body$;

REVOKE ALL ON FUNCTION public.enforce_instructor_extra_hours_limit() FROM PUBLIC,anon,authenticated;

-- The normal guard requires a new approval request for every cross-college
-- group, even when this lecturer already teaches the same offering/component
-- in published V2. The exception has an exact target ID and frozen source.
DO $patch$
DECLARE d text; anchor text;
BEGIN
  d:=pg_get_functiondef('faculty_private.guard_assignment_request()'::regprocedure);
  anchor:='IF h.home_college_id IS NULL THEN RAISE EXCEPTION ''FACULTY_HOME_REVIEW_REQUIRED''; END IF;';
  IF position(anchor in d)=0 THEN
    RAISE EXCEPTION 'FACULTY_REQUEST_GUARD_ANCHOR_CHANGED';
  END IF;
  d:=replace(d,anchor,$injection$
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
 $injection$||anchor);
  EXECUTE d;
END
$patch$;
COMMIT;
