-- ITCS draft-only lab split, 2026-09-26.
-- Approved distribution: 55 -> 28+27; 60 -> 30+30; the 42-student
-- practical session moves to a 42-seat computer lab.
-- Additional four draft-only session moves keep instructor/room/student
-- overlap at zero within approved 08:00-14:00 instructor availability.
-- Yasser teaches four days after this change (within the hard cap of four).
-- Published V2 session digest is verified before and after; all writes are atomic.
-- Preflight executed with ROLLBACK and deferred constraints forced IMMEDIATE.
BEGIN;
SET LOCAL lock_timeout='8s';
SET LOCAL statement_timeout='90s';
SELECT pg_advisory_xact_lock(9262,20260926);
DO $pre$
BEGIN
  IF (SELECT status FROM public.schedule_versions WHERE id='d68d8d22-9a6d-4f21-935f-cebf18bb969b') <> 'draft'
    OR (SELECT status FROM public.schedule_versions WHERE id='30f8a76d-1cb9-4944-a5d7-483dcaea7692') <> 'published'
    OR (SELECT count(*) FROM public.schedule_sessions WHERE schedule_version_id='d68d8d22-9a6d-4f21-935f-cebf18bb969b') <> 281
    OR (SELECT sum(extract(epoch from end_time-start_time)/3600) FROM public.schedule_sessions WHERE schedule_version_id='d68d8d22-9a6d-4f21-935f-cebf18bb969b') <> 642
    OR (SELECT count(*) FROM public.schedule_sessions WHERE schedule_version_id='30f8a76d-1cb9-4944-a5d7-483dcaea7692') <> 275
    OR EXISTS (
      SELECT 1 FROM public.schedule_version_delivery_baselines b
      WHERE b.schedule_version_id='30f8a76d-1cb9-4944-a5d7-483dcaea7692' AND b.published_version_digest IS DISTINCT FROM
      (SELECT md5(coalesce(string_agg(to_jsonb(s)::text,'|' ORDER BY s.id),''))
       FROM public.schedule_sessions s WHERE s.schedule_version_id='30f8a76d-1cb9-4944-a5d7-483dcaea7692')
    )
    OR (SELECT count(*) FROM public.delivery_groups g WHERE g.cohort_id IN
      ('8cb7ec1a-b911-49c7-80af-1a23ff53c542',
       '73eabe25-85e3-4ed3-8314-a7563bd00b1a',
       '113ae77d-2f58-4685-847f-066a308aff17')) <> 31
    OR EXISTS (
      SELECT 1 FROM schedule_version_delivery_private.scope
      WHERE version_id IN ('d68d8d22-9a6d-4f21-935f-cebf18bb969b','30f8a76d-1cb9-4944-a5d7-483dcaea7692') AND cohort_id IN
      ('8cb7ec1a-b911-49c7-80af-1a23ff53c542',
       '73eabe25-85e3-4ed3-8314-a7563bd00b1a',
       '113ae77d-2f58-4685-847f-066a308aff17')
    ) THEN RAISE EXCEPTION 'ITCS_LAB_SPLIT_BASELINE_CHANGED'; END IF;
END $pre$;
CREATE TEMP TABLE _lab_sources ON COMMIT DROP AS
SELECT s.*,ta.section_number AS source_section,ta.required_room_type AS source_room_type,
  dg.group_code AS source_group_code,pcc.component_type,
  ac.expected_students AS cohort_students
FROM public.schedule_sessions s
JOIN public.teaching_assignments ta ON ta.id=s.teaching_assignment_id
JOIN public.delivery_groups dg ON dg.id=s.delivery_group_id
JOIN public.plan_course_components pcc ON pcc.id=s.plan_course_component_id
JOIN public.academic_cohorts ac ON ac.id=s.cohort_id
WHERE s.id IN ('1a87f35c-5e7b-474d-bc33-506cfd402262',
'3372eccc-d04b-49c2-94d0-c87ef698bc02',
'f690b359-1189-4070-8f36-c695e4e250e3');
DO $source$
BEGIN
 IF (SELECT count(*) FROM _lab_sources)<>3 OR EXISTS(
   SELECT 1 FROM _lab_sources WHERE schedule_version_id<>'d68d8d22-9a6d-4f21-935f-cebf18bb969b'
   OR source_section<>'G1' OR source_group_code<>'G1'
   OR source_room_type<>'lecture_hall' OR component_type<>'practical'
   OR session_type<>'lab' OR is_locked OR replaced_by_split
   OR expected_students NOT IN (55,42,60)
 ) THEN RAISE EXCEPTION 'ITCS_LAB_SOURCE_CHANGED'; END IF;
END $source$;
CREATE TABLE schedule_version_delivery_private.component_room_type_facts (
  version_id uuid NOT NULL REFERENCES public.schedule_versions(id) ON DELETE CASCADE,
  component_id uuid NOT NULL REFERENCES public.plan_course_components(id),
  room_type_id uuid NOT NULL REFERENCES public.room_types(id),
  PRIMARY KEY(version_id,component_id),
  CHECK(version_id='d68d8d22-9a6d-4f21-935f-cebf18bb969b'::uuid)
);
REVOKE ALL ON schedule_version_delivery_private.component_room_type_facts FROM PUBLIC,anon,authenticated;
CREATE TRIGGER component_room_fact_lock BEFORE UPDATE OR DELETE
  ON schedule_version_delivery_private.component_room_type_facts FOR EACH ROW
  EXECUTE FUNCTION schedule_version_delivery_private.guard_published_fact();
CREATE OR REPLACE FUNCTION public.sync_component_room_type_from_assignments(p_component_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pcc public.plan_course_components%ROWTYPE;
  v_codes text[];
  v_code text;
  v_room_id uuid;
  v_changed boolean:=false;
BEGIN
  SELECT * INTO v_pcc FROM public.plan_course_components WHERE id=p_component_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','COMPONENT_NOT_FOUND'); END IF;
  SELECT array_agg(DISTINCT lower(btrim(ta.required_room_type)) ORDER BY lower(btrim(ta.required_room_type)))
    FILTER(WHERE ta.is_active AND NULLIF(btrim(ta.required_room_type),'') IS NOT NULL)
    INTO v_codes
  FROM public.teaching_assignments ta
  WHERE ta.plan_course_component_id=p_component_id
    AND NOT EXISTS (
      SELECT 1 FROM schedule_version_delivery_private.instructor_hour_waivers w
      WHERE w.assignment_id=ta.id
    );
  IF COALESCE(cardinality(v_codes),0)=0 THEN RETURN jsonb_build_object('ok',true,'changed',false); END IF;
  IF cardinality(v_codes)>1 THEN
    RAISE EXCEPTION 'ROOM_TYPE_ASSIGNMENT_CONFLICT: %',array_to_string(v_codes,',') USING ERRCODE='23514';
  END IF;
  v_code:=v_codes[1];
  SELECT id INTO v_room_id FROM public.room_types
  WHERE college_id=v_pcc.college_id AND code=v_code AND is_active AND default_capacity>0 LIMIT 1;
  IF v_room_id IS NULL THEN RAISE EXCEPTION 'ASSIGNMENT_ROOM_TYPE_INVALID: %',v_code USING ERRCODE='23514'; END IF;
  IF v_pcc.required_room_type_id IS DISTINCT FROM v_room_id THEN
    UPDATE public.plan_course_components SET required_room_type_id=v_room_id,updated_at=now() WHERE id=p_component_id;
    v_changed:=true;
  END IF;
  IF v_pcc.component_type='practical' THEN
    UPDATE public.plan_courses SET required_room_type_for_lab=v_code,updated_at=now()
    WHERE id=v_pcc.plan_course_id AND required_room_type_for_lab IS DISTINCT FROM v_code;
  ELSIF v_pcc.component_type IN ('theory','tutorial') THEN
    UPDATE public.plan_courses SET required_room_type_for_lecture=v_code,updated_at=now()
    WHERE id=v_pcc.plan_course_id AND required_room_type_for_lecture IS DISTINCT FROM v_code;
  END IF;
  RETURN jsonb_build_object('ok',true,'changed',v_changed,'room_type',v_code,'room_type_id',v_room_id);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.delivery_group_derivation_status(p_group uuid, p_version uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'schedule_version_delivery_private'
AS $function$
DECLARE
  g public.delivery_groups%ROWTYPE;
  c public.academic_cohorts%ROWTYPE;
  component public.plan_course_components%ROWTYPE;
  v_college uuid;
  v_headcount integer;
  v_capacity integer;
  v_room_type uuid;
  v_room_default integer;
  v_room_code text;
  v_override_room uuid;
  v_versioned_component boolean;
  v_assignment_codes text[];
  v_count integer;
  v_students integer;
  v_bad integer;
  v_expected integer;
  v_base integer;
  v_rem integer;
BEGIN
  SELECT * INTO g FROM public.delivery_groups WHERE id=p_group;
  SELECT college_id INTO v_college FROM public.schedule_versions WHERE id=p_version;
  IF g.id IS NULL OR v_college IS NULL OR g.college_id IS DISTINCT FROM v_college THEN
    RETURN jsonb_build_object('ok',false,'code','VERSION_GROUP_SCOPE_MISMATCH');
  END IF;
  IF auth.uid() IS NOT NULL AND NOT public.can_view_college(auth.uid(),v_college) THEN
    RETURN jsonb_build_object('ok',false,'code','FORBIDDEN');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM schedule_version_delivery_private.scope s
                 WHERE s.version_id=p_version AND s.cohort_id=g.cohort_id) THEN
    RETURN public.delivery_group_derivation_status(p_group);
  END IF;
  IF NOT coalesce(g.active,true) OR coalesce(g.is_obsolete,false) THEN
    RETURN jsonb_build_object('ok',true,'current',true,'code','SOURCE_INACTIVE_OR_OBSOLETE');
  END IF;
  SELECT * INTO c FROM public.academic_cohorts WHERE id=g.cohort_id;
  IF c.id IS NULL OR NOT coalesce(c.active,false)
     OR c.term_id IS DISTINCT FROM (SELECT academic_term_id FROM public.schedule_versions WHERE id=p_version) THEN
    RETURN jsonb_build_object('ok',false,'code','COHORT_INACTIVE_OR_MISSING');
  END IF;
  SELECT * INTO component FROM public.plan_course_components WHERE id=g.component_id;
  IF component.id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','COMPONENT_NOT_FOUND'); END IF;

  SELECT o.room_type_id INTO v_override_room
  FROM schedule_version_delivery_private.component_room_type_facts o
  WHERE o.version_id=p_version AND o.component_id=g.component_id;
  SELECT EXISTS (
    SELECT 1 FROM schedule_version_delivery_private.component_room_type_facts o
    WHERE o.component_id=g.component_id
  ) INTO v_versioned_component;
  SELECT rt.code INTO v_room_code FROM public.room_types rt
  WHERE rt.id=coalesce(v_override_room,component.required_room_type_id)
    AND rt.college_id=v_college;
  IF v_versioned_component THEN
    SELECT array_agg(DISTINCT lower(btrim(ta.required_room_type))
      ORDER BY lower(btrim(ta.required_room_type)))
      FILTER (WHERE ta.is_active AND nullif(btrim(ta.required_room_type),'') IS NOT NULL)
    INTO v_assignment_codes FROM public.teaching_assignments ta
    WHERE ta.plan_course_component_id=g.component_id AND ta.cohort_id=g.cohort_id
      AND (
        (v_override_room IS NOT NULL AND EXISTS (
          SELECT 1 FROM schedule_version_delivery_private.instructor_hour_waivers w
          WHERE w.assignment_id=ta.id AND w.version_id=p_version
        ))
        OR (v_override_room IS NULL AND EXISTS (
          SELECT 1 FROM public.schedule_sessions ss
          WHERE ss.teaching_assignment_id=ta.id AND ss.schedule_version_id=p_version
            AND NOT coalesce(ss.replaced_by_split,false)
        ))
      );
  ELSE
    SELECT array_agg(DISTINCT lower(btrim(ta.required_room_type))
      ORDER BY lower(btrim(ta.required_room_type)))
      FILTER (WHERE ta.is_active AND nullif(btrim(ta.required_room_type),'') IS NOT NULL)
    INTO v_assignment_codes FROM public.teaching_assignments ta
    WHERE ta.plan_course_component_id=g.component_id AND ta.cohort_id=g.cohort_id;
  END IF;
  IF coalesce(cardinality(v_assignment_codes),0)>1 THEN
    RETURN jsonb_build_object('ok',false,'code','ROOM_TYPE_ASSIGNMENT_CONFLICT');
  END IF;
  IF coalesce(cardinality(v_assignment_codes),0)=1 THEN
    IF v_room_code IS DISTINCT FROM v_assignment_codes[1] THEN
      RETURN jsonb_build_object('ok',false,'code','ROOM_TYPE_SOURCE_MISMATCH');
    END IF;
    SELECT rt.id,rt.default_capacity INTO v_room_type,v_room_default
    FROM public.room_types rt WHERE rt.college_id=v_college
      AND rt.code=v_assignment_codes[1] AND rt.is_active LIMIT 1;
  ELSE
    v_room_type:=coalesce(v_override_room,component.required_room_type_id);
    SELECT rt.default_capacity INTO v_room_default FROM public.room_types rt
    WHERE rt.id=v_room_type AND rt.college_id=v_college AND rt.is_active;
  END IF;
  IF component.component_type='practical' THEN
    v_capacity:=coalesce(public.effective_room_type_capacity(v_college,v_room_type),v_room_default);
  ELSE
    v_capacity:=coalesce(nullif(component.explicit_group_size,0),
      public.effective_room_type_capacity(v_college,v_room_type),v_room_default);
  END IF;
  IF v_capacity IS NULL OR v_capacity<=0 THEN
    RETURN jsonb_build_object('ok',false,'code','GROUP_CAPACITY_MISSING');
  END IF;
  SELECT f.scheduling_headcount INTO v_headcount
  FROM schedule_version_delivery_private.cohort_facts f
  WHERE f.version_id=p_version AND f.cohort_id=g.cohort_id;
  IF v_headcount IS NULL OR v_headcount<=0 THEN
    RETURN jsonb_build_object('ok',false,'code','VERSION_COHORT_FACT_MISSING');
  END IF;
  v_expected:=ceil(v_headcount::numeric/v_capacity::numeric)::integer;
  v_base:=v_headcount/v_expected;
  v_rem:=v_headcount%v_expected;
  SELECT count(*)::integer,coalesce(sum(f.expected_students),0)::integer,
    count(*) FILTER (WHERE raw.cohort_id IS DISTINCT FROM g.cohort_id
      OR raw.component_id IS DISTINCT FROM g.component_id
      OR raw.group_number IS NULL
      OR (raw.group_number-CASE WHEN v_override_room IS NOT NULL THEN 1 ELSE 0 END)<1
      OR (raw.group_number-CASE WHEN v_override_room IS NOT NULL THEN 1 ELSE 0 END)>v_expected
      OR f.group_code IS DISTINCT FROM
        (CASE WHEN v_override_room IS NOT NULL
          THEN 'G'||(raw.group_number-1)::text ELSE raw.group_code END)
      OR f.capacity_limit IS DISTINCT FROM v_capacity
      OR f.expected_students IS DISTINCT FROM
         v_base+CASE WHEN
           (raw.group_number-CASE WHEN v_override_room IS NOT NULL THEN 1 ELSE 0 END)<=v_rem
           THEN 1 ELSE 0 END)::integer
  INTO v_count,v_students,v_bad
  FROM schedule_version_delivery_private.group_facts f
  JOIN public.delivery_groups raw ON raw.id=f.group_id
  WHERE f.version_id=p_version AND f.cohort_id=g.cohort_id
    AND raw.component_id=g.component_id AND raw.active
    AND NOT coalesce(raw.is_obsolete,false);
  IF NOT EXISTS (SELECT 1 FROM schedule_version_delivery_private.group_facts f
                 WHERE f.version_id=p_version AND f.group_id=p_group) THEN
    RETURN jsonb_build_object('ok',false,'code','VERSION_GROUP_FACT_MISSING');
  END IF;
  IF v_count<>v_expected OR v_students<>v_headcount OR v_bad>0 THEN
    RETURN jsonb_build_object('ok',false,'code','STALE_DELIVERY_GROUPS_REGENERATE',
      'headcount',v_headcount,'capacity',v_capacity,'expected_groups',v_expected,
      'actual_groups',v_count,'actual_students',v_students,'bad_groups',v_bad);
  END IF;
  RETURN jsonb_build_object('ok',true,'current',true,'code','CURRENT',
    'headcount',v_headcount,'capacity',v_capacity,'expected_groups',v_expected);
END;
$function$
;
-- A published insert guard is paused only inside this transaction to freeze
-- current facts of these three cohorts. Session rows remain immutable.
ALTER TABLE schedule_version_delivery_private.scope DISABLE TRIGGER scope_insert_lock;
ALTER TABLE schedule_version_delivery_private.cohort_facts DISABLE TRIGGER cohort_insert_lock;
ALTER TABLE schedule_version_delivery_private.partition_facts DISABLE TRIGGER partition_insert_lock;
ALTER TABLE schedule_version_delivery_private.group_facts DISABLE TRIGGER group_insert_lock;
ALTER TABLE schedule_version_delivery_private.group_partition_facts DISABLE TRIGGER membership_insert_lock;
CREATE TEMP TABLE _lab_cohorts ON COMMIT DROP AS
SELECT id,college_id,expected_students FROM public.academic_cohorts
WHERE id IN ('8cb7ec1a-b911-49c7-80af-1a23ff53c542',
'73eabe25-85e3-4ed3-8314-a7563bd00b1a',
'113ae77d-2f58-4685-847f-066a308aff17');
INSERT INTO schedule_version_delivery_private.scope(version_id,cohort_id,college_id)
SELECT v.id,c.id,c.college_id FROM public.schedule_versions v CROSS JOIN _lab_cohorts c
WHERE v.id IN ('d68d8d22-9a6d-4f21-935f-cebf18bb969b','30f8a76d-1cb9-4944-a5d7-483dcaea7692');
INSERT INTO schedule_version_delivery_private.cohort_facts
(version_id,cohort_id,college_id,expected_students,scheduling_headcount)
SELECT v.id,c.id,c.college_id,c.expected_students,c.expected_students
FROM public.schedule_versions v CROSS JOIN _lab_cohorts c WHERE v.id IN ('d68d8d22-9a6d-4f21-935f-cebf18bb969b','30f8a76d-1cb9-4944-a5d7-483dcaea7692');
INSERT INTO schedule_version_delivery_private.partition_facts
(version_id,partition_id,cohort_id,college_id,partition_code,headcount)
SELECT v.id,p.id,p.cohort_id,p.college_id,p.partition_code,p.headcount
FROM public.schedule_versions v JOIN public.cohort_student_partitions p
 ON p.cohort_id IN (SELECT id FROM _lab_cohorts) AND p.active
WHERE v.id IN ('d68d8d22-9a6d-4f21-935f-cebf18bb969b','30f8a76d-1cb9-4944-a5d7-483dcaea7692');
INSERT INTO schedule_version_delivery_private.group_facts
(version_id,group_id,cohort_id,college_id,group_code,expected_students,capacity_limit)
SELECT v.id,g.id,g.cohort_id,g.college_id,g.group_code,g.expected_students,g.capacity_limit
FROM public.schedule_versions v JOIN public.delivery_groups g
 ON g.cohort_id IN (SELECT id FROM _lab_cohorts)
WHERE v.id IN ('d68d8d22-9a6d-4f21-935f-cebf18bb969b','30f8a76d-1cb9-4944-a5d7-483dcaea7692');
INSERT INTO schedule_version_delivery_private.group_partition_facts
(version_id,group_id,partition_id)
SELECT v.id,m.delivery_group_id,m.partition_id
FROM public.schedule_versions v JOIN public.delivery_group_partition_members m
 ON m.cohort_id IN (SELECT id FROM _lab_cohorts)
WHERE v.id IN ('d68d8d22-9a6d-4f21-935f-cebf18bb969b','30f8a76d-1cb9-4944-a5d7-483dcaea7692');
ALTER TABLE schedule_version_delivery_private.group_partition_facts ENABLE TRIGGER membership_insert_lock;
ALTER TABLE schedule_version_delivery_private.group_facts ENABLE TRIGGER group_insert_lock;
ALTER TABLE schedule_version_delivery_private.partition_facts ENABLE TRIGGER partition_insert_lock;
ALTER TABLE schedule_version_delivery_private.cohort_facts ENABLE TRIGGER cohort_insert_lock;
ALTER TABLE schedule_version_delivery_private.scope ENABLE TRIGGER scope_insert_lock;
INSERT INTO schedule_version_delivery_private.component_room_type_facts
(version_id,component_id,room_type_id)
SELECT 'd68d8d22-9a6d-4f21-935f-cebf18bb969b',s.plan_course_component_id,rt.id FROM _lab_sources s
JOIN public.room_types rt ON rt.college_id=s.college_id AND rt.code='computer_lab';
CREATE TEMP TABLE _lab_plan ON COMMIT DROP AS
SELECT src.id source_id, src.college_id, src.schedule_version_id,
  src.course_offering_id,src.teaching_assignment_id source_assignment_id,
  src.delivery_group_id source_group_id,src.cohort_id,src.plan_course_component_id,
  src.instructor_id,src.study_system, src.session_type,
  p.partition_id,p.partition_code,p.headcount expected_students,
  spec.day_of_week,spec.start_time,spec.end_time,spec.room_id,
  md5('itcs-lab-20260926:'||src.id::text||':'||p.partition_code||':group')::uuid group_id,
  md5('itcs-lab-20260926:'||src.id::text||':'||p.partition_code||':assignment')::uuid assignment_id,
  CASE WHEN p.partition_code='A001' THEN src.id
       ELSE md5('itcs-lab-20260926:'||src.id::text||':session2')::uuid END session_id
FROM _lab_sources src
JOIN (VALUES
 ('1a87f35c-5e7b-474d-bc33-506cfd402262'::uuid,'A001',2,'08:00'::time,'10:00'::time,'1c2cfa20-4df5-4186-bbc0-10f16e4c2841'::uuid),
 ('1a87f35c-5e7b-474d-bc33-506cfd402262'::uuid,'A002',3,'10:00'::time,'12:00'::time,'a914a469-9762-4240-897f-d0a001357807'::uuid),
 ('3372eccc-d04b-49c2-94d0-c87ef698bc02'::uuid,'A001',3,'12:00'::time,'14:00'::time,'1c2cfa20-4df5-4186-bbc0-10f16e4c2841'::uuid),
 ('f690b359-1189-4070-8f36-c695e4e250e3'::uuid,'A001',4,'10:00'::time,'12:00'::time,'1c2cfa20-4df5-4186-bbc0-10f16e4c2841'::uuid),
 ('f690b359-1189-4070-8f36-c695e4e250e3'::uuid,'A002',4,'08:00'::time,'10:00'::time,'5273162a-52d3-42bb-b0ea-0beb380b8673'::uuid)
) AS spec(source_id,partition_code,day_of_week,start_time,end_time,room_id)
 ON spec.source_id=src.id
JOIN schedule_version_delivery_private.partition_facts p ON p.version_id='d68d8d22-9a6d-4f21-935f-cebf18bb969b'
 AND p.cohort_id=src.cohort_id AND p.partition_code=spec.partition_code;
CREATE TEMP TABLE _lab_moves ON COMMIT DROP AS
SELECT s.id,s.instructor_id,s.delivery_group_id,s.room_id AS old_room_id,
 s.day_of_week AS old_day,s.start_time AS old_start,s.end_time AS old_end,
 spec.day_of_week,spec.start_time,spec.end_time,spec.room_id
FROM public.schedule_sessions s JOIN (VALUES
 ('4c5d68a6-6c8f-4981-b292-beee37972891'::uuid,3,'08:00'::time,'10:00'::time,'5273162a-52d3-42bb-b0ea-0beb380b8673'::uuid),
 ('fa962659-1cb9-40e7-99b2-ca2da184ef2c'::uuid,3,'08:00'::time,'10:00'::time,'2ec1bb97-4cd3-4760-bf8a-bdf22f176b3c'::uuid),
 ('b8517328-972f-41a4-aa57-446b80ef7f0a'::uuid,2,'08:00'::time,'10:00'::time,'d3a435cd-6c82-4250-a542-a47db8ab7551'::uuid),
 ('1e623a74-4322-4a27-b963-27c292e401bb'::uuid,4,'12:00'::time,'14:00'::time,'d3a435cd-6c82-4250-a542-a47db8ab7551'::uuid)
) spec(id,day_of_week,start_time,end_time,room_id) ON spec.id=s.id
WHERE s.schedule_version_id='d68d8d22-9a6d-4f21-935f-cebf18bb969b';
CREATE TEMP TABLE _lab_proposed ON COMMIT DROP AS
SELECT p.session_id id,p.instructor_id,p.room_id,p.day_of_week,p.start_time,p.end_time,
  ARRAY[p.partition_id] AS partition_ids FROM _lab_plan p
UNION ALL
SELECT m.id,m.instructor_id,m.room_id,m.day_of_week,m.start_time,m.end_time,
  ARRAY(SELECT x.partition_id FROM public.delivery_group_partition_members x
    WHERE x.delivery_group_id=m.delivery_group_id) FROM _lab_moves m;
DO $plan$
BEGIN
 IF (SELECT count(*) FROM _lab_plan)<>5 OR (SELECT count(*) FROM _lab_moves)<>4
 OR (SELECT sum(expected_students) FROM _lab_plan WHERE source_id='1a87f35c-5e7b-474d-bc33-506cfd402262')<>55
 OR (SELECT sum(expected_students) FROM _lab_plan WHERE source_id='f690b359-1189-4070-8f36-c695e4e250e3')<>60
 OR EXISTS(SELECT 1 FROM _lab_moves m WHERE
  (m.id='4c5d68a6-6c8f-4981-b292-beee37972891' AND
   (m.old_day<>3 OR m.old_start<>'10:00' OR m.old_end<>'12:00'))
  OR (m.id='fa962659-1cb9-40e7-99b2-ca2da184ef2c' AND
   (m.old_day<>4 OR m.old_start<>'10:00' OR m.old_end<>'12:00'))
  OR (m.id='b8517328-972f-41a4-aa57-446b80ef7f0a' AND
   (m.old_day<>4 OR m.old_start<>'12:00' OR m.old_end<>'14:00'))
  OR (m.id='1e623a74-4322-4a27-b963-27c292e401bb' AND
   (m.old_day<>4 OR m.old_start<>'11:00' OR m.old_end<>'13:00')))
 OR EXISTS(SELECT 1 FROM _lab_plan p JOIN public.rooms r ON r.id=p.room_id
  WHERE r.college_id IS DISTINCT FROM p.college_id OR r.room_type<>'computer_lab'
    OR r.capacity<p.expected_students OR NOT r.is_active)
 OR EXISTS(SELECT 1 FROM _lab_proposed p JOIN public.rooms r ON r.id=p.room_id
  WHERE r.college_id<>'7168345f-cf9d-4789-b2ad-547abb687dc8'
    OR r.room_type<>'computer_lab' OR NOT r.is_active
    OR NOT EXISTS(SELECT 1 FROM public.room_availability ra WHERE ra.room_id=p.room_id
      AND ra.day_of_week=p.day_of_week AND ra.start_time<=p.start_time
      AND ra.end_time>=p.end_time)
    OR NOT EXISTS(SELECT 1 FROM public.instructor_availability ia
      WHERE ia.instructor_id=p.instructor_id AND ia.day_of_week=p.day_of_week
      AND ia.availability_type='available' AND ia.start_time<=p.start_time
      AND ia.end_time>=p.end_time)
    OR EXISTS(SELECT 1 FROM public.room_unavailability ru WHERE ru.room_id=p.room_id
      AND ru.day_of_week=p.day_of_week AND ru.start_time<p.end_time
      AND ru.end_time>p.start_time))
 OR EXISTS(SELECT 1 FROM _lab_proposed p JOIN public.schedule_sessions s
  ON s.schedule_version_id='d68d8d22-9a6d-4f21-935f-cebf18bb969b'
  AND s.id NOT IN (SELECT id FROM _lab_sources)
  AND s.id NOT IN (SELECT id FROM _lab_moves)
  AND s.day_of_week=p.day_of_week AND s.start_time<p.end_time
  AND s.end_time>p.start_time AND NOT s.replaced_by_split
  WHERE s.room_id=p.room_id OR s.instructor_id=p.instructor_id
  OR EXISTS(SELECT 1 FROM public.delivery_group_partition_members pm
    WHERE pm.delivery_group_id=s.delivery_group_id AND pm.partition_id=ANY(p.partition_ids)))
 OR EXISTS(SELECT 1 FROM _lab_proposed a JOIN _lab_proposed b ON a.id<b.id
  AND a.day_of_week=b.day_of_week AND a.start_time<b.end_time
  AND b.start_time<a.end_time WHERE a.room_id=b.room_id
  OR a.instructor_id=b.instructor_id OR a.partition_ids&&b.partition_ids)
 OR EXISTS(SELECT 1 FROM (
  SELECT instructor_id,count(distinct day_of_week) days FROM (
   SELECT instructor_id,day_of_week FROM public.schedule_sessions
   WHERE schedule_version_id='d68d8d22-9a6d-4f21-935f-cebf18bb969b'
     AND id NOT IN (SELECT id FROM _lab_sources)
     AND id NOT IN (SELECT id FROM _lab_moves)
   UNION ALL SELECT instructor_id,day_of_week FROM _lab_proposed
  ) all_rows GROUP BY instructor_id
 ) daily WHERE days>4)
 OR EXISTS(SELECT 1 FROM (
  SELECT instructor_id,day_of_week,count(*) sessions FROM (
   SELECT instructor_id,day_of_week FROM public.schedule_sessions
   WHERE schedule_version_id='d68d8d22-9a6d-4f21-935f-cebf18bb969b'
     AND id NOT IN (SELECT id FROM _lab_sources)
     AND id NOT IN (SELECT id FROM _lab_moves)
   UNION ALL SELECT instructor_id,day_of_week FROM _lab_proposed
  ) all_rows GROUP BY instructor_id,day_of_week
 ) daily WHERE sessions>3)
 THEN RAISE EXCEPTION 'ITCS_LAB_PLAN_INVALID_OR_COLLISION'; END IF;
END $plan$;
DELETE FROM schedule_version_delivery_private.group_partition_facts f
USING _lab_sources s WHERE f.version_id='d68d8d22-9a6d-4f21-935f-cebf18bb969b'
 AND f.group_id=s.delivery_group_id;
DELETE FROM schedule_version_delivery_private.group_facts f
USING _lab_sources s WHERE f.version_id='d68d8d22-9a6d-4f21-935f-cebf18bb969b'
 AND f.group_id=s.delivery_group_id;
INSERT INTO public.delivery_groups
(id,college_id,cohort_id,plan_course_id,component_id,group_code,group_number,
 expected_students,capacity_limit,active,is_obsolete)
SELECT p.group_id,p.college_id,p.cohort_id,g.plan_course_id,g.component_id,
 CASE WHEN p.partition_code='A001' THEN 'G2' ELSE 'G3' END,
 CASE WHEN p.partition_code='A001' THEN 2 ELSE 3 END,
 p.expected_students,42,true,false
FROM _lab_plan p JOIN public.delivery_groups g ON g.id=p.source_group_id;
INSERT INTO public.delivery_group_partition_members
(id,college_id,cohort_id,delivery_group_id,partition_id)
SELECT gen_random_uuid(),p.college_id,p.cohort_id,p.group_id,pf.partition_id
FROM _lab_plan p JOIN schedule_version_delivery_private.partition_facts pf
 ON pf.version_id='d68d8d22-9a6d-4f21-935f-cebf18bb969b' AND pf.cohort_id=p.cohort_id
 AND pf.partition_code=p.partition_code;
INSERT INTO schedule_version_delivery_private.group_facts
(version_id,group_id,cohort_id,college_id,group_code,expected_students,capacity_limit)
SELECT 'd68d8d22-9a6d-4f21-935f-cebf18bb969b',p.group_id,p.cohort_id,p.college_id,
 CASE WHEN p.partition_code='A001' THEN 'G1' ELSE 'G2' END,p.expected_students,42
FROM _lab_plan p;
INSERT INTO schedule_version_delivery_private.group_partition_facts
(version_id,group_id,partition_id)
SELECT 'd68d8d22-9a6d-4f21-935f-cebf18bb969b',p.group_id,pf.partition_id
FROM _lab_plan p JOIN schedule_version_delivery_private.partition_facts pf
 ON pf.version_id='d68d8d22-9a6d-4f21-935f-cebf18bb969b' AND pf.cohort_id=p.cohort_id
 AND pf.partition_code=p.partition_code;
INSERT INTO schedule_version_delivery_private.instructor_hour_waivers
(assignment_id,version_id,college_id,term_id,instructor_id,group_id,source_assignment_id)
SELECT p.assignment_id,'d68d8d22-9a6d-4f21-935f-cebf18bb969b',p.college_id,'18dd364a-76d7-40b8-a217-fa929c082a7f',p.instructor_id,
 p.group_id,p.source_assignment_id FROM _lab_plan p;
INSERT INTO public.teaching_assignments
(id,college_id,course_offering_id,instructor_id,section_number,
 session_type,weekly_hours,required_room_type,notes,cohort_id,
 plan_course_component_id,delivery_group_id,assigned_component_hours,
 expected_students,is_active)
SELECT p.assignment_id,src.college_id,src.course_offering_id,src.instructor_id,
 CASE WHEN p.partition_code='A001' THEN 'G2' ELSE 'G3' END,
 src.session_type,src.weekly_hours,'computer_lab',
 src.notes,src.cohort_id,src.plan_course_component_id,p.group_id,
 src.assigned_component_hours,p.expected_students,true
FROM _lab_plan p JOIN public.teaching_assignments src ON src.id=p.source_assignment_id;
UPDATE public.schedule_sessions s SET day_of_week=m.day_of_week,
 start_time=m.start_time,end_time=m.end_time,room_id=m.room_id
FROM _lab_moves m WHERE s.id=m.id AND s.schedule_version_id='d68d8d22-9a6d-4f21-935f-cebf18bb969b';
UPDATE public.schedule_sessions s
SET teaching_assignment_id=p.assignment_id,delivery_group_id=p.group_id,
 expected_students=p.expected_students,room_id=p.room_id,day_of_week=p.day_of_week,
 start_time=p.start_time,end_time=p.end_time
FROM _lab_plan p WHERE p.partition_code='A001' AND s.id=p.source_id
 AND s.schedule_version_id='d68d8d22-9a6d-4f21-935f-cebf18bb969b';
INSERT INTO public.schedule_sessions
(id,college_id,schedule_version_id,course_offering_id,teaching_assignment_id,
 delivery_group_id,cohort_id,plan_course_component_id,instructor_id,
 room_id,day_of_week,start_time,end_time,session_type,study_system,expected_students,source_type)
SELECT p.session_id,p.college_id,'d68d8d22-9a6d-4f21-935f-cebf18bb969b',p.course_offering_id,p.assignment_id,
 p.group_id,p.cohort_id,p.plan_course_component_id,p.instructor_id,
 p.room_id,p.day_of_week,p.start_time,p.end_time,p.session_type,p.study_system,
 p.expected_students,'cloned'
FROM _lab_plan p WHERE p.partition_code='A002';
SET CONSTRAINTS ALL IMMEDIATE;
DO $post$
DECLARE p record;
BEGIN
 IF (SELECT count(*) FROM public.schedule_sessions WHERE schedule_version_id='d68d8d22-9a6d-4f21-935f-cebf18bb969b')<>283
 OR (SELECT sum(extract(epoch from end_time-start_time)/3600) FROM public.schedule_sessions WHERE schedule_version_id='d68d8d22-9a6d-4f21-935f-cebf18bb969b')<>646
 OR (SELECT count(*) FROM public.schedule_sessions WHERE schedule_version_id='30f8a76d-1cb9-4944-a5d7-483dcaea7692')<>275
 OR EXISTS(SELECT 1 FROM public.schedule_version_delivery_baselines b
 WHERE b.schedule_version_id='30f8a76d-1cb9-4944-a5d7-483dcaea7692' AND b.published_version_digest IS DISTINCT FROM
 (SELECT md5(coalesce(string_agg(to_jsonb(s)::text,'|' ORDER BY s.id),''))
 FROM public.schedule_sessions s WHERE s.schedule_version_id='30f8a76d-1cb9-4944-a5d7-483dcaea7692'))
 OR EXISTS(SELECT 1 FROM _lab_plan x JOIN public.schedule_sessions s ON s.id=x.session_id
 WHERE s.expected_students<>x.expected_students OR s.room_id<>x.room_id
 OR s.teaching_assignment_id<>x.assignment_id OR s.delivery_group_id<>x.group_id)
 OR EXISTS(SELECT 1 FROM _lab_moves m JOIN public.schedule_sessions s ON s.id=m.id
 WHERE s.room_id<>m.room_id OR s.day_of_week<>m.day_of_week
 OR s.start_time<>m.start_time OR s.end_time<>m.end_time)
 THEN RAISE EXCEPTION 'ITCS_LAB_POSTCHECK_FAILED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.schedule_versions v WHERE v.id='d68d8d22-9a6d-4f21-935f-cebf18bb969b'
   AND v.created_by IS NOT NULL AND public.can_view_college(v.created_by,v.college_id))
 THEN RAISE EXCEPTION 'ITCS_DRAFT_VIEWER_MISSING'; END IF;
 PERFORM set_config('request.jwt.claim.sub',
  (SELECT created_by::text FROM public.schedule_versions
   WHERE id='d68d8d22-9a6d-4f21-935f-cebf18bb969b'),true);
 FOR p IN SELECT * FROM _lab_plan LOOP
 IF NOT coalesce((public.delivery_group_derivation_status(p.group_id,'d68d8d22-9a6d-4f21-935f-cebf18bb969b')->>'ok')::boolean,false)
 OR NOT coalesce((public._sb_v2_assignment_guard(p.assignment_id,'d68d8d22-9a6d-4f21-935f-cebf18bb969b')->>'ok')::boolean,false)
 OR NOT public.is_assignment_room_compatible(p.college_id,p.assignment_id,p.room_id)
 OR (SELECT count(*) FROM public.schedule_version_student_memberships(
     'd68d8d22-9a6d-4f21-935f-cebf18bb969b',ARRAY[p.group_id]) m
     WHERE m.partition_id=p.partition_id AND m.partition_headcount=p.expected_students)<>1
 OR jsonb_array_length(public._sb_v2_delivery_group_overlap(
   'd68d8d22-9a6d-4f21-935f-cebf18bb969b',p.group_id,p.cohort_id,
   p.day_of_week,p.start_time,p.end_time,p.session_id))<>0
 THEN RAISE EXCEPTION 'ITCS_LAB_GUARD_FAILED: %',p.session_id; END IF;
 END LOOP;
END $post$;
SELECT 'ITCS_LAB_SPLIT_POSTCHECK_PASS' AS result,
 (SELECT count(*) FROM public.schedule_sessions WHERE schedule_version_id='d68d8d22-9a6d-4f21-935f-cebf18bb969b') AS draft_sessions,
 (SELECT sum(extract(epoch from end_time-start_time)/3600) FROM public.schedule_sessions WHERE schedule_version_id='d68d8d22-9a6d-4f21-935f-cebf18bb969b') AS draft_hours;
COMMIT;
