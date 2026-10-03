-- Apply after same_system_shared_lectures.sql. Approved Arabic/Islamic first-term distribution.
BEGIN;
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
    IF NOT public.shared_lecture_time_allowed(NEW.college_id,NEW.day_of_week,NEW.start_time,NEW.end_time) THEN
      RAISE EXCEPTION 'SHARED_LECTURE_TIME_WINDOW' USING ERRCODE='23514';
    END IF;
    SELECT c.study_system INTO NEW.study_system FROM public.delivery_groups d JOIN public.academic_cohorts c ON c.id=d.cohort_id WHERE d.id=NEW.delivery_group_id;
    NEW.expected_students := (public.operational_delivery_group(NEW.delivery_group_id)).expected_students;
  END IF;
  IF EXISTS(SELECT 1 FROM public.delivery_groups d JOIN public.plan_courses pc ON pc.id=d.plan_course_id WHERE d.id=NEW.delivery_group_id AND pc.course_id IN ('45829120-871a-4875-b0ed-ad37dbfc1aa2','7d367abd-5429-4b44-9bb6-e7d2b8fd006e') AND d.college_id='7168345f-cf9d-4789-b2ad-547abb687dc8')
  AND NEW.room_id IS DISTINCT FROM 'ae561b8b-a6ba-40a6-a1bf-a3ed39a243f7'::uuid
  THEN RAISE EXCEPTION 'APPROVED_LARGE_HALL_REQUIRED' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.validate_shared_lecture_link()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE a public.delivery_groups%ROWTYPE; b public.delivery_groups%ROWTYPE;
 ca public.academic_cohorts%ROWTYPE; cb public.academic_cohorts%ROWTYPE; n integer;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(9262,1);
 SELECT * INTO a FROM public.delivery_groups WHERE id=NEW.anchor_group_id FOR UPDATE;
 SELECT * INTO b FROM public.delivery_groups WHERE id=NEW.member_group_id FOR UPDATE;
 SELECT * INTO ca FROM public.academic_cohorts WHERE id=a.cohort_id;
 SELECT * INTO cb FROM public.academic_cohorts WHERE id=b.cohort_id;
 IF a.college_id IS DISTINCT FROM NEW.college_id OR b.college_id IS DISTINCT FROM NEW.college_id
 OR NOT public.same_system_lecture_pair(a.id,b.id)
 THEN RAISE EXCEPTION 'SHARED_LECTURE_CONTEXT_MISMATCH' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM public.shared_lecture_links WHERE anchor_group_id=a.id AND member_group_id<>b.id)
 AND NOT EXISTS(SELECT 1 FROM public.plan_courses pc WHERE pc.id=a.plan_course_id AND pc.course_id IN ('45829120-871a-4875-b0ed-ad37dbfc1aa2','7d367abd-5429-4b44-9bb6-e7d2b8fd006e'))
 THEN RAISE EXCEPTION 'SHARED_LECTURE_PAIR_ONLY' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM public.schedule_sessions WHERE delivery_group_id IN(a.id,b.id))
 THEN RAISE EXCEPTION 'SHARED_LECTURE_SCHEDULED' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM public.shared_lecture_links l WHERE l.member_group_id=NEW.anchor_group_id OR l.anchor_group_id=NEW.member_group_id)
 THEN RAISE EXCEPTION 'SHARED_LECTURE_CHAIN_FORBIDDEN' USING ERRCODE='23514'; END IF;
 SELECT a.expected_students+b.expected_students+COALESCE(sum(g.expected_students),0) INTO n
 FROM public.shared_lecture_links l JOIN public.delivery_groups g ON g.id=l.member_group_id
 WHERE l.anchor_group_id=a.id AND l.member_group_id<>b.id;
 IF n>LEAST(a.capacity_limit,b.capacity_limit, (SELECT min(d.capacity_limit) FROM public.shared_lecture_links l JOIN public.delivery_groups d ON d.id=l.member_group_id WHERE l.anchor_group_id=a.id)) OR a.capacity_limit IS NULL OR b.capacity_limit IS NULL
 THEN RAISE EXCEPTION 'SHARED_LECTURE_CAPACITY_EXCEEDED' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM public.teaching_assignments WHERE delivery_group_id IN(a.id,b.id) AND is_active)
 THEN RAISE EXCEPTION 'SHARED_LECTURE_ACTIVE_ASSIGNMENTS_EXIST' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$function$;

DO $$ BEGIN
PERFORM pg_advisory_xact_lock(9262,1);
IF EXISTS(SELECT 1 FROM schedule_sessions WHERE college_id='7168345f-cf9d-4789-b2ad-547abb687dc8') OR EXISTS(SELECT 1 FROM teaching_assignments WHERE is_active AND college_id='7168345f-cf9d-4789-b2ad-547abb687dc8') THEN RAISE EXCEPTION 'RESET_BASELINE_CHANGED'; END IF;
END $$;
DELETE FROM shared_lecture_links l USING delivery_groups d,plan_courses pc WHERE d.id=l.anchor_group_id AND pc.id=d.plan_course_id AND pc.course_id IN ('45829120-871a-4875-b0ed-ad37dbfc1aa2','7d367abd-5429-4b44-9bb6-e7d2b8fd006e') AND d.college_id='7168345f-cf9d-4789-b2ad-547abb687dc8';
UPDATE delivery_groups dg SET capacity_limit=220 FROM plan_courses pc WHERE pc.id=dg.plan_course_id AND pc.course_id IN ('45829120-871a-4875-b0ed-ad37dbfc1aa2','7d367abd-5429-4b44-9bb6-e7d2b8fd006e') AND dg.college_id='7168345f-cf9d-4789-b2ad-547abb687dc8' AND dg.component_id IN(SELECT id FROM plan_course_components WHERE component_type='theory') AND dg.active AND NOT dg.is_obsolete;
UPDATE delivery_group_partition_members SET delivery_group_id='7d749462-5cf3-4d08-8cff-ed10338b1f16' WHERE delivery_group_id='b3994d26-0e16-4df7-a6fe-769d253faa99';
UPDATE delivery_group_partition_members SET delivery_group_id='118e43df-d461-4da3-8400-3c4fdc160ce1' WHERE delivery_group_id='95764466-90a1-4915-add8-b214d02f26c6';
UPDATE delivery_groups SET active=false,is_obsolete=true WHERE id IN ('b3994d26-0e16-4df7-a6fe-769d253faa99','95764466-90a1-4915-add8-b214d02f26c6');
UPDATE delivery_groups SET expected_students=120 WHERE id='7d749462-5cf3-4d08-8cff-ed10338b1f16';
UPDATE delivery_groups SET expected_students=110 WHERE id='118e43df-d461-4da3-8400-3c4fdc160ce1';
UPDATE plan_course_components p SET explicit_group_size=220 FROM plan_courses pc WHERE pc.id=p.plan_course_id AND pc.college_id='7168345f-cf9d-4789-b2ad-547abb687dc8' AND p.component_type='theory' AND pc.course_id IN ('45829120-871a-4875-b0ed-ad37dbfc1aa2','7d367abd-5429-4b44-9bb6-e7d2b8fd006e');
UPDATE rooms SET available_days=ARRAY[1,4,6],available_start_time='08:00',available_end_time='14:00' WHERE id='ae561b8b-a6ba-40a6-a1bf-a3ed39a243f7';
INSERT INTO shared_lecture_links(anchor_group_id,member_group_id,college_id) VALUES ('7d749462-5cf3-4d08-8cff-ed10338b1f16'::uuid,'d7cfe463-784c-47e8-85d4-dc20f72bac5e'::uuid,'7168345f-cf9d-4789-b2ad-547abb687dc8'::uuid),
('eb1cbffe-a5c1-4f3d-93ef-030b70b3d027'::uuid,'990647dd-b43d-42dc-8fb7-3feaf9e3a365'::uuid,'7168345f-cf9d-4789-b2ad-547abb687dc8'::uuid),
('0ee6ae31-2949-494d-b3a5-dc8aee41c726'::uuid,'89795b72-cad1-4f27-a165-406a9dbf4683'::uuid,'7168345f-cf9d-4789-b2ad-547abb687dc8'::uuid),
('118e43df-d461-4da3-8400-3c4fdc160ce1'::uuid,'1e77bb39-8838-4e36-a782-f4b30f27dcc4'::uuid,'7168345f-cf9d-4789-b2ad-547abb687dc8'::uuid),
('118e43df-d461-4da3-8400-3c4fdc160ce1'::uuid,'ccc0fd81-e781-4a35-9877-551dfdb211b2'::uuid,'7168345f-cf9d-4789-b2ad-547abb687dc8'::uuid),
('9e150a62-21a9-480a-9e27-512f4eb0f3a4'::uuid,'26129825-19a4-4f52-a233-0785012f1b51'::uuid,'7168345f-cf9d-4789-b2ad-547abb687dc8'::uuid),
('68df46df-62c1-4865-ad2a-9047b048fe38'::uuid,'2c72754d-0547-4cfe-852c-7b1f237f0458'::uuid,'7168345f-cf9d-4789-b2ad-547abb687dc8'::uuid),
('efdb7626-2b2c-47d5-9df7-db954f129587'::uuid,'d276feab-a210-40cb-becf-5c42d0b5ed81'::uuid,'7168345f-cf9d-4789-b2ad-547abb687dc8'::uuid),
('efdb7626-2b2c-47d5-9df7-db954f129587'::uuid,'2f0ff93c-90e6-4353-a357-0f2b3c64fa09'::uuid,'7168345f-cf9d-4789-b2ad-547abb687dc8'::uuid),
('243f364e-d11f-4e4d-b8ac-da564f6fe448'::uuid,'bc2e4818-35b7-4a6b-a2f0-a4dd9a15bbe8'::uuid,'7168345f-cf9d-4789-b2ad-547abb687dc8'::uuid),
('243f364e-d11f-4e4d-b8ac-da564f6fe448'::uuid,'cec161e9-be8e-423e-8c57-5bf51d57009d'::uuid,'7168345f-cf9d-4789-b2ad-547abb687dc8'::uuid),
('243f364e-d11f-4e4d-b8ac-da564f6fe448'::uuid,'3bbdc1b7-ffc7-4073-b26b-073934800dea'::uuid,'7168345f-cf9d-4789-b2ad-547abb687dc8'::uuid);

SELECT c.name,count(*) AS groups,sum(dg.expected_students) AS students,sum(p.weekly_contact_hours) AS hours,array_agg(dg.expected_students ORDER BY dg.expected_students) AS group_sizes
FROM operational_delivery_groups dg JOIN plan_courses pc ON pc.id=dg.plan_course_id JOIN courses c ON c.id=pc.course_id JOIN plan_course_components p ON p.id=dg.component_id
WHERE dg.active AND NOT dg.is_obsolete AND dg.college_id='7168345f-cf9d-4789-b2ad-547abb687dc8'
AND pc.course_id IN ('45829120-871a-4875-b0ed-ad37dbfc1aa2','7d367abd-5429-4b44-9bb6-e7d2b8fd006e') AND p.component_type='theory' GROUP BY c.name;
COMMIT;
