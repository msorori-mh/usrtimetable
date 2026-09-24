-- Permit an exact clone of an already approved/published shared lecture even
-- when the legacy source time predates the current shared-lecture window.
-- Any new or changed placement outside the configured window remains blocked.
BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.ensure_ss_college()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  vc uuid;
  oc uuid;
  ic uuid;
  rc uuid;
  sc uuid;
  gc uuid;
  tac uuid;
  ta_active boolean;
  ta_dg uuid;
  ta_instructor uuid;
  ta_offering uuid;
  ta_component uuid;
  ta_cohort uuid;
  dg_college uuid;
  dg_obsolete boolean;
  dg_active boolean;
  dg_cohort uuid;
  dg_component uuid;
  pcc_type text;
  pcc_regular boolean;
  v_ta_link_changing boolean;
  v_dg_link_changing boolean;
BEGIN
  SELECT college_id INTO vc FROM public.schedule_versions WHERE id = NEW.schedule_version_id;
  IF vc IS NULL OR vc <> NEW.college_id THEN RAISE EXCEPTION 'version/college mismatch'; END IF;

  SELECT college_id INTO oc FROM public.course_offerings WHERE id = NEW.course_offering_id;
  IF oc IS NULL OR oc <> NEW.college_id THEN RAISE EXCEPTION 'offering/college mismatch'; END IF;

  SELECT college_id INTO ic FROM public.instructors WHERE id = NEW.instructor_id;
  IF ic IS NULL OR ic <> NEW.college_id THEN RAISE EXCEPTION 'instructor/college mismatch'; END IF;

  IF NEW.room_id IS NOT NULL THEN
    SELECT college_id INTO rc FROM public.rooms WHERE id = NEW.room_id;
    IF rc IS NULL OR rc <> NEW.college_id THEN RAISE EXCEPTION 'room/college mismatch'; END IF;
  END IF;

  IF NEW.section_id IS NOT NULL THEN
    SELECT college_id INTO sc FROM public.sections WHERE id = NEW.section_id;
    IF sc IS NULL OR sc <> NEW.college_id THEN RAISE EXCEPTION 'section/college mismatch'; END IF;
  END IF;

  IF NEW.section_group_id IS NOT NULL THEN
    SELECT college_id INTO gc FROM public.section_groups WHERE id = NEW.section_group_id;
    IF gc IS NULL OR gc <> NEW.college_id THEN RAISE EXCEPTION 'section_group/college mismatch'; END IF;
  END IF;

  v_ta_link_changing := (
    TG_OP = 'INSERT'
    OR OLD.teaching_assignment_id IS DISTINCT FROM NEW.teaching_assignment_id
  );
  v_dg_link_changing := (
    TG_OP = 'INSERT'
    OR OLD.delivery_group_id IS DISTINCT FROM NEW.delivery_group_id
  );

  IF NEW.teaching_assignment_id IS NOT NULL THEN
    SELECT ta.college_id, ta.is_active, ta.delivery_group_id,
           ta.instructor_id, ta.course_offering_id, ta.plan_course_component_id, ta.cohort_id
      INTO tac, ta_active, ta_dg, ta_instructor, ta_offering, ta_component, ta_cohort
    FROM public.teaching_assignments ta
    WHERE ta.id = NEW.teaching_assignment_id;
    IF tac IS NULL OR tac <> NEW.college_id THEN
      RAISE EXCEPTION 'teaching_assignment/college mismatch';
    END IF;
    IF v_ta_link_changing AND COALESCE(ta_active, true) = false THEN
      RAISE EXCEPTION 'INACTIVE_ASSIGNMENT_SESSION_FORBIDDEN' USING ERRCODE = 'check_violation';
    END IF;
    IF v_ta_link_changing AND ta_instructor IS DISTINCT FROM NEW.instructor_id THEN
      RAISE EXCEPTION 'ASSIGNMENT_INSTRUCTOR_MISMATCH' USING ERRCODE = 'check_violation';
    END IF;
    IF v_ta_link_changing AND ta_offering IS DISTINCT FROM NEW.course_offering_id THEN
      RAISE EXCEPTION 'ASSIGNMENT_OFFERING_MISMATCH' USING ERRCODE = 'check_violation';
    END IF;
    IF v_ta_link_changing AND ta_dg IS NOT NULL THEN
      SELECT dg.college_id, dg.is_obsolete, dg.active, dg.cohort_id, dg.component_id
        INTO dg_college, dg_obsolete, dg_active, dg_cohort, dg_component
      FROM public.operational_delivery_groups dg
      WHERE dg.id = ta_dg;
      IF dg_college IS NULL THEN
        RAISE EXCEPTION 'DELIVERY_GROUP_NOT_FOUND' USING ERRCODE = 'foreign_key_violation';
      END IF;
      IF dg_college <> NEW.college_id THEN
        RAISE EXCEPTION 'SESSION_DELIVERY_GROUP_CROSS_COLLEGE_FORBIDDEN' USING ERRCODE = 'check_violation';
      END IF;
      IF COALESCE(dg_obsolete, false) THEN
        RAISE EXCEPTION 'OBSOLETE_DELIVERY_GROUP_SESSION_FORBIDDEN' USING ERRCODE = 'check_violation';
      END IF;
      IF COALESCE(dg_active, true) = false THEN
        RAISE EXCEPTION 'DELIVERY_GROUP_INACTIVE_SESSION_FORBIDDEN' USING ERRCODE = 'check_violation';
      END IF;
      SELECT pcc.component_type, COALESCE(pcc.counts_toward_regular_load, true)
        INTO pcc_type, pcc_regular
      FROM public.plan_course_components pcc WHERE pcc.id = dg_component;
      IF pcc_type = 'summer_training' THEN
        RAISE EXCEPTION 'SUMMER_TRAINING_SESSION_FORBIDDEN' USING ERRCODE = 'check_violation';
      END IF;
      IF pcc_type = 'project' AND COALESCE(pcc_regular, true) = false THEN
        RAISE EXCEPTION 'PROJECT_STANDARD_WEEKLY_SESSION_FORBIDDEN' USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.delivery_group_id IS NOT NULL AND NEW.delivery_group_id IS DISTINCT FROM ta_dg THEN
        RAISE EXCEPTION 'SESSION_DELIVERY_GROUP_ASSIGNMENT_MISMATCH' USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.cohort_id IS NOT NULL AND NEW.cohort_id IS DISTINCT FROM dg_cohort THEN
        RAISE EXCEPTION 'SESSION_COHORT_MISMATCH' USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.plan_course_component_id IS NOT NULL
         AND NEW.plan_course_component_id IS DISTINCT FROM dg_component THEN
        RAISE EXCEPTION 'SESSION_COMPONENT_MISMATCH' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  IF NEW.delivery_group_id IS NOT NULL THEN
    SELECT dg.college_id, dg.is_obsolete, dg.active, dg.cohort_id, dg.component_id
      INTO dg_college, dg_obsolete, dg_active, dg_cohort, dg_component
    FROM public.operational_delivery_groups dg
    WHERE dg.id = NEW.delivery_group_id;
    IF dg_college IS NULL THEN
      RAISE EXCEPTION 'DELIVERY_GROUP_NOT_FOUND' USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF dg_college <> NEW.college_id THEN
      RAISE EXCEPTION 'SESSION_DELIVERY_GROUP_CROSS_COLLEGE_FORBIDDEN' USING ERRCODE = 'check_violation';
    END IF;
    IF v_dg_link_changing AND COALESCE(dg_obsolete, false) THEN
      RAISE EXCEPTION 'OBSOLETE_DELIVERY_GROUP_SESSION_FORBIDDEN' USING ERRCODE = 'check_violation';
    END IF;
    IF v_dg_link_changing AND COALESCE(dg_active, true) = false THEN
      RAISE EXCEPTION 'DELIVERY_GROUP_INACTIVE_SESSION_FORBIDDEN' USING ERRCODE = 'check_violation';
    END IF;
    IF v_dg_link_changing THEN
      SELECT pcc.component_type, COALESCE(pcc.counts_toward_regular_load, true)
        INTO pcc_type, pcc_regular
      FROM public.plan_course_components pcc WHERE pcc.id = dg_component;
      IF pcc_type = 'summer_training' THEN
        RAISE EXCEPTION 'SUMMER_TRAINING_SESSION_FORBIDDEN' USING ERRCODE = 'check_violation';
      END IF;
      IF pcc_type = 'project' AND COALESCE(pcc_regular, true) = false THEN
        RAISE EXCEPTION 'PROJECT_STANDARD_WEEKLY_SESSION_FORBIDDEN' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  IF EXISTS(SELECT 1 FROM public.shared_lecture_links WHERE anchor_group_id=NEW.delivery_group_id) THEN
    IF NOT public.shared_lecture_time_allowed(NEW.college_id,NEW.day_of_week,NEW.start_time,NEW.end_time)
       AND NOT (
         TG_OP = 'INSERT'
         AND EXISTS (
           SELECT 1
           FROM public.schedule_sessions source_session
           JOIN public.schedule_versions source_version
             ON source_version.id = source_session.schedule_version_id
           WHERE source_version.college_id = NEW.college_id
             AND source_version.status IN ('approved', 'published')
             AND source_session.college_id = NEW.college_id
             AND source_session.delivery_group_id = NEW.delivery_group_id
             AND source_session.course_offering_id = NEW.course_offering_id
             AND source_session.teaching_assignment_id IS NOT DISTINCT FROM NEW.teaching_assignment_id
             AND source_session.instructor_id = NEW.instructor_id
             AND source_session.room_id IS NOT DISTINCT FROM NEW.room_id
             AND source_session.section_id IS NOT DISTINCT FROM NEW.section_id
             AND source_session.section_group_id IS NOT DISTINCT FROM NEW.section_group_id
             AND source_session.section_subgroup_id IS NOT DISTINCT FROM NEW.section_subgroup_id
             AND source_session.cohort_id IS NOT DISTINCT FROM NEW.cohort_id
             AND source_session.plan_course_component_id IS NOT DISTINCT FROM NEW.plan_course_component_id
             AND source_session.day_of_week = NEW.day_of_week
             AND source_session.start_time = NEW.start_time
             AND source_session.end_time = NEW.end_time
             AND source_session.session_type = NEW.session_type
             AND NOT coalesce(source_session.replaced_by_split, false)
         )
       ) THEN
      RAISE EXCEPTION 'SHARED_LECTURE_TIME_WINDOW' USING ERRCODE='23514';
    END IF;
    NEW.study_system := 'both';
    NEW.expected_students := (public.operational_delivery_group(NEW.delivery_group_id)).expected_students;
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.ensure_ss_college() IS
  'Validates schedule-session scope and shared-lecture windows; exact INSERT clones of approved/published sessions are preserved.';

NOTIFY pgrst, 'reload schema';

COMMIT;
