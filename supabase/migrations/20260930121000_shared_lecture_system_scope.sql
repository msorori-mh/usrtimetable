BEGIN;
SET LOCAL lock_timeout = '5s';
-- Derive the time window and system tag from participating cohorts, not from
-- the historical assumption that every shared lecture is regular + parallel.
CREATE OR REPLACE FUNCTION public.shared_lecture_system(p_group uuid)
RETURNS text LANGUAGE sql STABLE SET search_path = '' AS $fn$
  SELECT CASE WHEN count(DISTINCT c.study_system)=1 THEN min(c.study_system) ELSE 'both' END
  FROM public.shared_lecture_group_ids(p_group) ids
  JOIN public.delivery_groups g ON g.id=ids.group_id
  JOIN public.academic_cohorts c ON c.id=g.cohort_id;
$fn$;
REVOKE ALL ON FUNCTION public.shared_lecture_system(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.shared_lecture_system(uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.shared_lecture_group_time_allowed(
  p_group uuid,p_college uuid,p_day integer,p_start time,p_end time
) RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $fn$
 SELECT COALESCE(bool_and(EXISTS(
   SELECT 1 FROM public.time_slot_templates t WHERE t.college_id=p_college AND t.is_active
     AND t.day_of_week=p_day AND t.study_system IN(c.study_system,'both')
     AND t.start_time<=p_start AND t.end_time>=p_end
  )),false)
 FROM (SELECT DISTINCT c.study_system FROM public.shared_lecture_group_ids(p_group) ids
       JOIN public.delivery_groups g ON g.id=ids.group_id
       JOIN public.academic_cohorts c ON c.id=g.cohort_id) c;
$fn$;
REVOKE ALL ON FUNCTION public.shared_lecture_group_time_allowed(uuid,uuid,integer,time,time) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.shared_lecture_group_time_allowed(uuid,uuid,integer,time,time) TO authenticated,service_role;

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
  IF ic IS NULL THEN RAISE EXCEPTION 'instructor/college mismatch'; END IF;
  IF ic <> NEW.college_id AND NOT EXISTS (
    SELECT 1 FROM public.teaching_assignments ta
    JOIN public.faculty_teaching_requests fr ON fr.assignment_id=ta.id
    JOIN public.faculty_identity_links fl ON fl.instructor_id=ta.instructor_id AND fl.identity_id=fr.identity_id
    WHERE ta.id=NEW.teaching_assignment_id AND ta.is_active
      AND ta.instructor_id=NEW.instructor_id AND ta.college_id=NEW.college_id
      AND ta.delivery_group_id=NEW.delivery_group_id
      AND ta.course_offering_id=NEW.course_offering_id
      AND ta.cohort_id IS NOT DISTINCT FROM NEW.cohort_id
      AND ta.plan_course_component_id IS NOT DISTINCT FROM NEW.plan_course_component_id
      AND fr.status='approved' AND fr.decided_by IS NOT NULL AND fr.decided_at IS NOT NULL
      AND fr.instructor_id=NEW.instructor_id AND fr.college_id=NEW.college_id
      AND fr.delivery_group_id=NEW.delivery_group_id
      AND fr.assigned_hours=coalesce(ta.assigned_component_hours,ta.weekly_hours)
  ) THEN RAISE EXCEPTION 'instructor/college mismatch'; END IF;

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
    IF NOT (
      (NEW.college_id='d78cf264-3a76-43a1-8601-4d6def12b400'::uuid
       AND EXISTS(SELECT 1 FROM public.schedule_versions v WHERE v.id=NEW.schedule_version_id
         AND v.academic_term_id='d1844735-b1ee-4c92-acc0-7a529fc43928'::uuid)
       AND NOT EXISTS(
         SELECT 1 FROM public.shared_lecture_group_ids(NEW.delivery_group_id) x
         LEFT JOIN public.delivery_groups d ON d.id=x.group_id
         LEFT JOIN public.academic_cohorts c ON c.id=d.cohort_id
         WHERE c.college_id IS DISTINCT FROM NEW.college_id
           OR c.term_id IS DISTINCT FROM 'd1844735-b1ee-4c92-acc0-7a529fc43928'::uuid
           OR c.study_system IS DISTINCT FROM 'regular')
       AND EXISTS(SELECT 1 FROM public.time_slot_templates t
         WHERE t.college_id=NEW.college_id AND t.is_active
           AND t.study_system IN ('regular','both') AND t.day_of_week=NEW.day_of_week
           AND t.start_time<=NEW.start_time AND t.end_time>=NEW.end_time))
      OR public.shared_lecture_group_time_allowed(NEW.delivery_group_id,NEW.college_id,NEW.day_of_week,NEW.start_time,NEW.end_time)
      OR (TG_OP = 'INSERT' AND EXISTS (
        SELECT 1 FROM public.schedule_sessions source_session
        JOIN public.schedule_versions source_version ON source_version.id=source_session.schedule_version_id
        WHERE source_version.college_id=NEW.college_id
          AND source_version.status IN ('approved','published')
          AND source_session.college_id=NEW.college_id
          AND source_session.delivery_group_id=NEW.delivery_group_id
          AND source_session.course_offering_id=NEW.course_offering_id
          AND source_session.teaching_assignment_id IS NOT DISTINCT FROM NEW.teaching_assignment_id
          AND source_session.instructor_id=NEW.instructor_id
          AND source_session.room_id IS NOT DISTINCT FROM NEW.room_id
          AND source_session.section_id IS NOT DISTINCT FROM NEW.section_id
          AND source_session.section_group_id IS NOT DISTINCT FROM NEW.section_group_id
          AND source_session.section_subgroup_id IS NOT DISTINCT FROM NEW.section_subgroup_id
          AND source_session.cohort_id IS NOT DISTINCT FROM NEW.cohort_id
          AND source_session.plan_course_component_id IS NOT DISTINCT FROM NEW.plan_course_component_id
          AND source_session.day_of_week=NEW.day_of_week
          AND source_session.start_time=NEW.start_time
          AND source_session.end_time=NEW.end_time
          AND source_session.session_type=NEW.session_type
          AND NOT coalesce(source_session.replaced_by_split,false)
      ))
    ) THEN
      RAISE EXCEPTION 'SHARED_LECTURE_TIME_WINDOW' USING ERRCODE='23514';
    END IF;
    NEW.study_system := public.shared_lecture_system(NEW.delivery_group_id);
    NEW.expected_students := (public.operational_delivery_group(NEW.delivery_group_id)).expected_students;
  END IF;
  IF EXISTS(SELECT 1 FROM public.delivery_groups d JOIN public.plan_courses pc ON pc.id=d.plan_course_id WHERE d.id=NEW.delivery_group_id AND pc.course_id IN ('45829120-871a-4875-b0ed-ad37dbfc1aa2','7d367abd-5429-4b44-9bb6-e7d2b8fd006e') AND d.college_id='7168345f-cf9d-4789-b2ad-547abb687dc8')
  AND NEW.room_id IS DISTINCT FROM 'ae561b8b-a6ba-40a6-a1bf-a3ed39a243f7'::uuid
  THEN RAISE EXCEPTION 'APPROVED_LARGE_HALL_REQUIRED' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$function$
;
-- A same-system shared session also prevents unlinking while scheduled.
CREATE OR REPLACE FUNCTION public.unmerge_shared_lecture(p_member uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE l public.shared_lecture_links%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE='42501'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(9262,1);
 SELECT * INTO l FROM public.shared_lecture_links WHERE member_group_id=p_member FOR UPDATE;
 IF NOT FOUND OR NOT public.can_manage_college(auth.uid(),l.college_id) THEN RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.delivery_groups WHERE id=l.anchor_group_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.schedule_sessions WHERE delivery_group_id=l.anchor_group_id )
 THEN RAISE EXCEPTION 'SHARED_LECTURE_SCHEDULED' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM public.teaching_assignments WHERE delivery_group_id=l.anchor_group_id AND is_active)
 THEN RAISE EXCEPTION 'SHARED_LECTURE_ACTIVE_ASSIGNMENTS_EXIST' USING ERRCODE='23514'; END IF;
 DELETE FROM public.shared_lecture_links WHERE member_group_id=p_member;
 INSERT INTO public.audit_logs(actor_id,action,entity,entity_id,college_id,details)
 VALUES(auth.uid(),'unmerge_shared_lecture','delivery_groups',l.anchor_group_id,l.college_id,to_jsonb(l));
 RETURN jsonb_build_object('ok',true);
END;
$fn$;
REVOKE ALL ON FUNCTION public.unmerge_shared_lecture(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.unmerge_shared_lecture(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
