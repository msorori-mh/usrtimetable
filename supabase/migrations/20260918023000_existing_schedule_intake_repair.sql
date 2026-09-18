BEGIN;
-- Unknown intake values are nullable; ordinary generation retains its required fields.
ALTER TABLE public.academic_cohorts ADD COLUMN IF NOT EXISTS existing_schedule boolean NOT NULL DEFAULT false;
ALTER TABLE public.course_offerings ADD COLUMN IF NOT EXISTS existing_schedule boolean NOT NULL DEFAULT false;
ALTER TABLE public.academic_cohorts ALTER COLUMN entry_year DROP NOT NULL, ALTER COLUMN expected_students DROP NOT NULL;
ALTER TABLE public.course_offerings ALTER COLUMN expected_students DROP NOT NULL;
ALTER TABLE public.delivery_groups ALTER COLUMN expected_students DROP NOT NULL;
ALTER TABLE public.teaching_assignments ALTER COLUMN expected_students DROP NOT NULL;
ALTER TABLE public.schedule_sessions ALTER COLUMN expected_students DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ac_existing_identity ON public.academic_cohorts(college_id,term_id,study_plan_id,level_id,study_system) WHERE existing_schedule;

CREATE OR REPLACE FUNCTION public.guard_existing_schedule_intake_scope() RETURNS trigger
LANGUAGE plpgsql SET search_path TO public,pg_temp AS $$
DECLARE t public.academic_terms%ROWTYPE;
BEGIN
 SELECT * INTO t FROM public.academic_terms WHERE id=NEW.term_id;
 IF t.college_id IS DISTINCT FROM NEW.college_id THEN RAISE EXCEPTION 'TERM_COLLEGE_MISMATCH'; END IF;
 IF NEW.enabled AND (NEW.college_id='7168345f-cf9d-4789-b2ad-547abb687dc8'::uuid OR t.term_type IS DISTINCT FROM 'first' OR t.academic_year IS DISTINCT FROM '2026-2027') THEN
   RAISE EXCEPTION 'EXISTING_SCHEDULE_SCOPE_FORBIDDEN';
 END IF;
 NEW.updated_at:=now(); RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.guard_intake_unknown_values() RETURNS trigger
LANGUAGE plpgsql SET search_path TO public,pg_temp AS $$
DECLARE term uuid; intake boolean; j jsonb:=to_jsonb(NEW);
BEGIN
 CASE TG_TABLE_NAME
 WHEN 'academic_cohorts' THEN term:=NEW.term_id;
 WHEN 'course_offerings' THEN term:=NEW.term_id;
 WHEN 'delivery_groups' THEN SELECT term_id INTO term FROM public.academic_cohorts WHERE id=NEW.cohort_id AND college_id=NEW.college_id;
 WHEN 'teaching_assignments' THEN SELECT term_id INTO term FROM public.course_offerings WHERE id=NEW.course_offering_id AND college_id=NEW.college_id;
 WHEN 'schedule_sessions' THEN SELECT academic_term_id INTO term FROM public.schedule_versions WHERE id=NEW.schedule_version_id AND college_id=NEW.college_id;
 END CASE;
 intake:=public.existing_schedule_intake_enabled(NEW.college_id,term);
 IF NOT intake AND (NEW.expected_students IS NULL OR (TG_TABLE_NAME='academic_cohorts' AND j->>'entry_year' IS NULL) OR COALESCE((j->>'existing_schedule')::boolean,false)) THEN
   RAISE EXCEPTION 'REQUIRED_GENERATION_VALUES_MISSING';
 END IF;
 IF TG_TABLE_NAME='academic_cohorts' AND j->>'entry_year' IS NULL AND NOT COALESCE((j->>'existing_schedule')::boolean,false) THEN RAISE EXCEPTION 'COHORT_ORIGIN_REQUIRED'; END IF;
 IF COALESCE((j->>'existing_schedule')::boolean,false) AND j->>'study_plan_id' IS NULL THEN RAISE EXCEPTION 'INTAKE_PLAN_REQUIRED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER zzz_intake_unknown_values BEFORE INSERT OR UPDATE ON public.academic_cohorts FOR EACH ROW EXECUTE FUNCTION public.guard_intake_unknown_values();
CREATE TRIGGER zzz_intake_unknown_values BEFORE INSERT OR UPDATE ON public.course_offerings FOR EACH ROW EXECUTE FUNCTION public.guard_intake_unknown_values();
CREATE TRIGGER zzz_intake_unknown_values BEFORE INSERT OR UPDATE ON public.delivery_groups FOR EACH ROW EXECUTE FUNCTION public.guard_intake_unknown_values();
CREATE TRIGGER zzz_intake_unknown_values BEFORE INSERT OR UPDATE ON public.teaching_assignments FOR EACH ROW EXECUTE FUNCTION public.guard_intake_unknown_values();
CREATE TRIGGER zzz_intake_unknown_values BEFORE INSERT OR UPDATE ON public.schedule_sessions FOR EACH ROW EXECUTE FUNCTION public.guard_intake_unknown_values();

REVOKE ALL ON FUNCTION public.import_existing_schedule_intake(uuid,integer) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.link_intake_shared_group(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;

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
 IF a.id IS NOT NULL AND b.id IS NOT NULL AND a.id<>b.id
 AND a.college_id=NEW.college_id AND b.college_id=NEW.college_id
 AND ca.term_id=cb.term_id AND ca.existing_schedule AND cb.existing_schedule
 AND public.existing_schedule_intake_enabled(NEW.college_id,ca.term_id) THEN
   IF EXISTS(SELECT 1 FROM public.shared_lecture_links l WHERE l.member_group_id=a.id OR l.anchor_group_id=b.id)
   OR EXISTS(SELECT 1 FROM public.schedule_sessions s WHERE s.delivery_group_id=b.id)
   OR NOT EXISTS(
     SELECT 1 FROM public.existing_schedule_source_rows sa
     JOIN public.existing_schedule_source_rows sb ON sb.shared_key=sa.shared_key
     JOIN public.plan_course_components pa ON pa.id=a.component_id
     JOIN public.plan_course_components pb ON pb.id=b.component_id
     WHERE sa.delivery_group_id=a.id AND sb.delivery_group_id=b.id
       AND sa.college_id=NEW.college_id AND sb.college_id=NEW.college_id
       AND sa.term_id=ca.term_id AND sb.term_id=ca.term_id
       AND sa.instructor_ids=sb.instructor_ids AND array_length(sa.instructor_ids,1)>0
       AND sa.day_of_week=sb.day_of_week AND sa.start_time=sb.start_time AND sa.end_time=sb.end_time
       AND sa.room_id=sb.room_id AND sa.room_id IS NOT NULL
       AND pa.component_type=pb.component_type AND pa.weekly_contact_hours=pb.weekly_contact_hours
   ) THEN RAISE EXCEPTION 'INTAKE_SHARED_LECTURE_CONTEXT_MISMATCH' USING ERRCODE='23514'; END IF;
   RETURN NEW;
 END IF;
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

CREATE OR REPLACE FUNCTION public.enforce_delivery_group_explicit_size()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_limit integer; v_type text;
BEGIN
  IF EXISTS(SELECT 1 FROM public.academic_cohorts c WHERE c.id=NEW.cohort_id AND c.college_id=NEW.college_id AND public.existing_schedule_intake_enabled(c.college_id,c.term_id)) THEN RETURN NEW; END IF;
  IF COALESCE(NEW.active,true) AND NOT COALESCE(NEW.is_obsolete,false) THEN
    SELECT component_type,explicit_group_size INTO v_type,v_limit
    FROM public.plan_course_components WHERE id=NEW.component_id AND college_id=NEW.college_id;
    -- Practical group size is derived from the current room capacity, not legacy explicit values.
    IF v_type='practical' THEN v_limit:=NULL; END IF;
    IF v_limit IS NOT NULL AND v_limit>0 AND COALESCE(NEW.expected_students,0)>v_limit THEN
      RAISE EXCEPTION 'DELIVERY_GROUP_EXPLICIT_SIZE_EXCEEDED: % > %',NEW.expected_students,v_limit USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ensure_ta_college()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  oc uuid;
  ic uuid;
  dg_college uuid;
  dg_cohort uuid;
  dg_component uuid;
  dg_plan_course uuid;
  dg_obsolete boolean;
  dg_active boolean;
  co_plan_course uuid;
  co_term uuid;
  co_program uuid;
  co_level uuid;
  co_study_system text;
  co_college uuid;
  pcc_type text;
  pcc_plan_course uuid;
  pcc_hours numeric;
  pcc_college uuid;
  v_co_count integer;
  v_null_split_count integer;
  v_sum_assigned numeric;
  v_cohort_term uuid;
  v_cohort_program uuid;
  v_cohort_level uuid;
  v_cohort_study text;
  v_cohort_college uuid;
BEGIN
  SELECT college_id, plan_course_id, term_id, program_id, level_id, study_system
    INTO oc, co_plan_course, co_term, co_program, co_level, co_study_system
  FROM public.course_offerings WHERE id = NEW.course_offering_id;
  co_college := oc;

  SELECT college_id INTO ic FROM public.instructors WHERE id = NEW.instructor_id;
  IF oc IS NULL OR ic IS NULL OR oc <> NEW.college_id THEN -- CROSS-COLLEGE-01: instructor may belong to another college
    RAISE EXCEPTION 'offering/instructor/college mismatch' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.is_active IS NULL THEN
    NEW.is_active := TRUE;
  END IF;

  -- Session-linked: do not silently change instructor or delivery_group
  IF TG_OP = 'UPDATE'
     AND (
       OLD.instructor_id IS DISTINCT FROM NEW.instructor_id
       OR OLD.delivery_group_id IS DISTINCT FROM NEW.delivery_group_id
     )
     AND EXISTS (
       SELECT 1 FROM public.schedule_sessions ss
       WHERE ss.teaching_assignment_id = NEW.id
     ) THEN
    RAISE EXCEPTION 'ASSIGNMENT_LINKED_TO_SESSION_MUTATION_FORBIDDEN'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.delivery_group_id IS NOT NULL THEN
    SELECT dg.college_id, dg.cohort_id, dg.component_id, dg.plan_course_id, dg.is_obsolete, dg.active
      INTO dg_college, dg_cohort, dg_component, dg_plan_course, dg_obsolete, dg_active
    FROM public.operational_delivery_groups dg
    WHERE dg.id = NEW.delivery_group_id;

    IF dg_college IS NULL THEN
      RAISE EXCEPTION 'DELIVERY_GROUP_NOT_FOUND' USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF dg_college <> NEW.college_id THEN
      RAISE EXCEPTION 'ASSIGNMENT_CROSS_COLLEGE_FORBIDDEN' USING ERRCODE = 'check_violation';
    END IF;
    -- Obsolete / inactive groups reject active assignments only (deactivate remains allowed)
    IF COALESCE(dg_obsolete, false) AND COALESCE(NEW.is_active, true) THEN
      RAISE EXCEPTION 'OBSOLETE_DELIVERY_GROUP_ASSIGNMENT_FORBIDDEN' USING ERRCODE = 'check_violation';
    END IF;
    IF COALESCE(dg_active, true) = false AND COALESCE(NEW.is_active, true) THEN
      RAISE EXCEPTION 'DELIVERY_GROUP_INACTIVE_ASSIGNMENT_FORBIDDEN' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.cohort_id IS NOT NULL AND NEW.cohort_id IS DISTINCT FROM dg_cohort THEN
      RAISE EXCEPTION 'ASSIGNMENT_COHORT_MISMATCH' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.plan_course_component_id IS NOT NULL
       AND NEW.plan_course_component_id IS DISTINCT FROM dg_component THEN
      RAISE EXCEPTION 'ASSIGNMENT_COMPONENT_MISMATCH' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.cohort_id IS NULL THEN
      NEW.cohort_id := dg_cohort;
    END IF;
    IF NEW.plan_course_component_id IS NULL THEN
      NEW.plan_course_component_id := dg_component;
    END IF;

    IF (co_plan_course IS NULL OR co_plan_course IS DISTINCT FROM dg_plan_course)
 AND NOT (public.existing_schedule_intake_enabled(NEW.college_id,co_term)
 AND EXISTS(SELECT 1 FROM public.plan_courses pc JOIN public.course_offerings o ON o.course_id=pc.course_id
 WHERE pc.id=dg_plan_course AND pc.college_id=NEW.college_id AND o.id=NEW.course_offering_id AND o.college_id=NEW.college_id)) THEN
      RAISE EXCEPTION 'OFFERING_PLAN_COURSE_MISMATCH' USING ERRCODE = 'check_violation';
    END IF;

    SELECT ac.college_id, ac.term_id, ac.program_id, ac.level_id, ac.study_system
      INTO v_cohort_college, v_cohort_term, v_cohort_program, v_cohort_level, v_cohort_study
    FROM public.academic_cohorts ac
    WHERE ac.id = dg_cohort;

    IF v_cohort_college IS NULL OR v_cohort_college <> NEW.college_id THEN
      RAISE EXCEPTION 'ASSIGNMENT_COHORT_COLLEGE_MISMATCH' USING ERRCODE = 'check_violation';
    END IF;
    IF co_college <> v_cohort_college
       OR co_term IS DISTINCT FROM v_cohort_term
       OR COALESCE(co_program, v_cohort_program) IS DISTINCT FROM v_cohort_program
       OR COALESCE(co_level, v_cohort_level) IS DISTINCT FROM v_cohort_level
       OR co_study_system IS DISTINCT FROM v_cohort_study THEN
      RAISE EXCEPTION 'OFFERING_COHORT_CONTEXT_MISMATCH' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.plan_course_component_id IS NOT NULL THEN
    SELECT pcc.component_type, pcc.plan_course_id, pcc.weekly_contact_hours, pcc.college_id
      INTO pcc_type, pcc_plan_course, pcc_hours, pcc_college
    FROM public.plan_course_components pcc
    WHERE pcc.id = NEW.plan_course_component_id
      AND pcc.college_id = NEW.college_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ASSIGNMENT_COMPONENT_COLLEGE_MISMATCH' USING ERRCODE = 'check_violation';
    END IF;
    IF pcc_type = 'summer_training' THEN
      RAISE EXCEPTION 'SUMMER_TRAINING_WEEKLY_ASSIGNMENT_FORBIDDEN' USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.delivery_group_id IS NOT NULL AND COALESCE(NEW.is_active, true) THEN
      IF pcc_plan_course IS DISTINCT FROM dg_plan_course THEN
        RAISE EXCEPTION 'COMPONENT_PLAN_COURSE_MISMATCH' USING ERRCODE = 'check_violation';
      END IF;

      IF NEW.assigned_component_hours IS NOT NULL AND NEW.assigned_component_hours <= 0 THEN
        RAISE EXCEPTION 'ASSIGNED_HOURS_MUST_BE_POSITIVE' USING ERRCODE = 'check_violation';
      END IF;

      IF NEW.assigned_component_hours IS NOT NULL
         AND pcc_hours IS NOT NULL
         AND NEW.assigned_component_hours > pcc_hours THEN
        RAISE EXCEPTION 'CO_TEACHING_HOURS_OVER_ALLOCATED' USING ERRCODE = 'check_violation';
      END IF;

      SELECT COUNT(*)::integer,
             COUNT(*) FILTER (WHERE ta.assigned_component_hours IS NULL
                               AND ta.id IS DISTINCT FROM NEW.id)::integer
               + CASE WHEN NEW.assigned_component_hours IS NULL THEN 1 ELSE 0 END,
             COALESCE(SUM(ta.assigned_component_hours) FILTER (WHERE ta.id IS DISTINCT FROM NEW.id), 0)
               + COALESCE(NEW.assigned_component_hours, 0)
        INTO v_co_count, v_null_split_count, v_sum_assigned
      FROM public.teaching_assignments ta
      WHERE ta.delivery_group_id = NEW.delivery_group_id
        AND ta.is_active = TRUE;

      IF TG_OP = 'INSERT' THEN
        v_co_count := v_co_count + 1;
      ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.delivery_group_id IS DISTINCT FROM NEW.delivery_group_id
           OR COALESCE(OLD.is_active, true) IS DISTINCT FROM TRUE THEN
          v_co_count := v_co_count + 1;
        END IF;
      END IF;

      IF v_co_count > 1 AND v_null_split_count > 0 AND NOT public.existing_schedule_intake_enabled(NEW.college_id,co_term) THEN
        RAISE EXCEPTION 'CO_TEACHING_HOURS_SPLIT_REQUIRED' USING ERRCODE = 'check_violation';
      END IF;

      IF pcc_hours IS NOT NULL AND v_sum_assigned > pcc_hours THEN
        RAISE EXCEPTION 'CO_TEACHING_HOURS_OVER_ALLOCATED' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  IF NEW.cohort_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.academic_cohorts ac
      WHERE ac.id = NEW.cohort_id AND ac.college_id = NEW.college_id
    ) THEN
      RAISE EXCEPTION 'ASSIGNMENT_COHORT_COLLEGE_MISMATCH' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.is_active AND EXISTS(SELECT 1 FROM public.shared_lecture_links WHERE anchor_group_id=NEW.delivery_group_id) THEN
    NEW.expected_students := (public.operational_delivery_group(NEW.delivery_group_id)).expected_students;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.normalize_theory_delivery_group_capacity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_type text;
  v_explicit integer;
  v_default integer;
BEGIN
  IF EXISTS(SELECT 1 FROM public.academic_cohorts c WHERE c.id=NEW.cohort_id AND c.college_id=NEW.college_id AND public.existing_schedule_intake_enabled(c.college_id,c.term_id)) THEN RETURN NEW; END IF;
  SELECT pcc.component_type, pcc.explicit_group_size, rt.default_capacity
  INTO v_type, v_explicit, v_default
  FROM public.plan_course_components pcc
  LEFT JOIN public.room_types rt ON rt.id=pcc.required_room_type_id AND rt.college_id=pcc.college_id
  WHERE pcc.id=NEW.component_id AND pcc.college_id=NEW.college_id;

  IF v_type='theory'
     AND v_explicit IS NOT NULL
     AND v_explicit > COALESCE(v_default,0) THEN
    NEW.capacity_limit := v_explicit;
  END IF;
  RETURN NEW;
END;
$function$;


CREATE OR REPLACE FUNCTION public.import_existing_schedule_intake(p_version uuid,p_base_year integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,pg_temp AS $$
DECLARE v public.schedule_versions%ROWTYPE; r public.existing_schedule_source_rows%ROWTYPE;
 pc public.plan_courses%ROWTYPE; cp public.plan_course_components%ROWTYPE;
 program uuid; cohort uuid; offering uuid; grp uuid; ta uuid; primary_ta uuid; sess uuid;
 anchor uuid; anchor_group uuid; inst uuid; stype text; added integer:=0; members integer:=0;
BEGIN
 SELECT * INTO v FROM public.schedule_versions WHERE id=p_version FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'VERSION_NOT_FOUND'; END IF;
 IF auth.uid() IS NULL THEN
   IF session_user NOT IN ('postgres','supabase_admin') AND COALESCE(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
 ELSIF NOT public.can_manage_college(auth.uid(),v.college_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF v.status<>'draft' THEN RAISE EXCEPTION 'VERSION_NOT_DRAFT'; END IF;
 IF NOT public.existing_schedule_intake_enabled(v.college_id,v.academic_term_id) THEN RAISE EXCEPTION 'EXISTING_SCHEDULE_INTAKE_DISABLED'; END IF;
 IF v.college_id='7168345f-cf9d-4789-b2ad-547abb687dc8'::uuid OR NOT EXISTS(SELECT 1 FROM public.academic_terms t WHERE t.id=v.academic_term_id AND t.college_id=v.college_id AND t.term_type='first' AND t.academic_year='2026-2027') THEN RAISE EXCEPTION 'EXISTING_SCHEDULE_SCOPE_FORBIDDEN'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_version::text,6027));
 FOR r IN SELECT * FROM public.existing_schedule_source_rows s
   WHERE s.college_id=v.college_id AND s.term_id=v.academic_term_id
     AND (s.schedule_version_id IS NULL OR s.schedule_version_id=p_version)
     AND s.schedule_session_id IS NULL
   ORDER BY s.source_id FOR UPDATE
 LOOP
   SELECT * INTO pc FROM public.plan_courses WHERE id=r.plan_course_id AND college_id=v.college_id;
   SELECT * INTO cp FROM public.plan_course_components WHERE id=r.component_id AND college_id=v.college_id AND plan_course_id=pc.id;
   IF pc.id IS NULL OR cp.id IS NULL OR COALESCE(array_length(r.instructor_ids,1),0)=0 THEN
     UPDATE public.existing_schedule_source_rows SET status='pending',pending_reasons=ARRAY['بيانات المقرر أو المحاضر بانتظار الاستكمال'] WHERE id=r.id;
     CONTINUE;
   END IF;
   IF EXISTS(SELECT 1 FROM unnest(r.instructor_ids) x WHERE NOT EXISTS(SELECT 1 FROM public.instructors i WHERE i.id=x AND i.college_id=v.college_id)) THEN RAISE EXCEPTION 'INTAKE_INSTRUCTOR_CONTEXT_MISMATCH'; END IF;
   SELECT program_id INTO program FROM public.study_plans WHERE id=pc.study_plan_id AND college_id=v.college_id;
   cohort:=NULL;
   SELECT id INTO cohort FROM public.academic_cohorts WHERE college_id=v.college_id AND term_id=v.academic_term_id AND study_plan_id=pc.study_plan_id AND level_id=pc.level_id AND existing_schedule AND study_system='regular';
   IF cohort IS NULL THEN
     INSERT INTO public.academic_cohorts(college_id,program_id,level_id,study_plan_id,term_id,study_system,entry_year,expected_students,count_status,code,existing_schedule)
     VALUES(v.college_id,program,pc.level_id,pc.study_plan_id,v.academic_term_id,'regular',NULL,NULL,'estimated','الجدول القائم — المستوى '||r.level_number,true) RETURNING id INTO cohort;
   END IF;
   offering:=NULL;
   SELECT id INTO offering FROM public.course_offerings WHERE college_id=v.college_id AND term_id=v.academic_term_id AND course_id=pc.course_id AND program_id=program AND level_id=pc.level_id AND study_system='regular';
   IF offering IS NULL THEN
     INSERT INTO public.course_offerings(college_id,term_id,course_id,program_id,level_id,study_plan_id,plan_course_id,expected_students,enrollment_count_status,existing_schedule,notes)
     VALUES(v.college_id,v.academic_term_id,pc.course_id,program,pc.level_id,pc.study_plan_id,pc.id,NULL,'unverified',true,'نقل الجدول القائم؛ عدد الطلاب غير محدد') RETURNING id INTO offering;
   END IF;
   grp:=r.delivery_group_id;
   IF grp IS NULL THEN
     INSERT INTO public.delivery_groups(college_id,cohort_id,plan_course_id,component_id,group_code,expected_students,capacity_limit,group_number)
     VALUES(v.college_id,cohort,pc.id,cp.id,'قائم — '||r.source_id,NULL,NULL,1) RETURNING id INTO grp;
   END IF;
   UPDATE public.existing_schedule_source_rows SET cohort_id=cohort,delivery_group_id=grp,schedule_version_id=p_version WHERE id=r.id;
   anchor:=NULL; anchor_group:=NULL;
   IF r.shared_key IS NOT NULL THEN
     SELECT schedule_session_id,delivery_group_id INTO anchor,anchor_group FROM public.existing_schedule_source_rows
     WHERE college_id=v.college_id AND schedule_version_id=p_version AND shared_key=r.shared_key AND schedule_session_id IS NOT NULL AND NOT shared_member ORDER BY source_id LIMIT 1;
   END IF;
   IF anchor IS NOT NULL THEN
     INSERT INTO public.shared_lecture_links(college_id,member_group_id,anchor_group_id) VALUES(v.college_id,grp,anchor_group) ON CONFLICT(member_group_id) DO NOTHING;
     UPDATE public.existing_schedule_source_rows SET schedule_session_id=anchor,shared_member=true,status='shared_member' WHERE id=r.id;
     members:=members+1; CONTINUE;
   END IF;
   stype:=CASE cp.component_type WHEN 'practical' THEN 'lab' WHEN 'tutorial' THEN 'tutorial' ELSE 'lecture' END;
   primary_ta:=NULL;
   FOREACH inst IN ARRAY r.instructor_ids LOOP
     ta:=NULL;
     SELECT id INTO ta FROM public.teaching_assignments WHERE college_id=v.college_id AND delivery_group_id=grp AND instructor_id=inst AND is_active;
     IF ta IS NULL THEN
       INSERT INTO public.teaching_assignments(college_id,course_offering_id,instructor_id,cohort_id,delivery_group_id,plan_course_component_id,session_type,weekly_hours,assigned_component_hours,expected_students,required_room_type,notes)
       VALUES(v.college_id,offering,inst,cohort,grp,cp.id,stype,cp.weekly_contact_hours,NULL,NULL,NULL,
        CASE WHEN array_length(r.instructor_ids,1)>1 THEN 'تدريس مشترك؛ توزيع الساعات بانتظار الاستكمال' ELSE 'إسناد من الجدول القائم' END) RETURNING id INTO ta;
     END IF;
     IF primary_ta IS NULL THEN primary_ta:=ta; END IF;
   END LOOP;
   IF r.day_of_week IS NULL OR r.start_time IS NULL OR r.end_time IS NULL THEN
     UPDATE public.existing_schedule_source_rows SET teaching_assignment_id=primary_ta,status='pending',pending_reasons=ARRAY['وقت المحاضرة بانتظار الاستكمال'] WHERE id=r.id;
     CONTINUE;
   END IF;
   INSERT INTO public.schedule_sessions(college_id,schedule_version_id,course_offering_id,teaching_assignment_id,instructor_id,room_id,day_of_week,start_time,end_time,session_type,expected_students,cohort_id,delivery_group_id,plan_course_component_id,source_type)
   VALUES(v.college_id,p_version,offering,primary_ta,r.instructor_ids[1],r.room_id,r.day_of_week,r.start_time,r.end_time,stype,NULL,cohort,grp,cp.id,'manual') RETURNING id INTO sess;
   UPDATE public.existing_schedule_source_rows SET schedule_session_id=sess,teaching_assignment_id=primary_ta,status='imported',pending_reasons=
     CASE WHEN r.room_id IS NULL THEN ARRAY['قاعة بانتظار التحديد'] ELSE ARRAY[]::text[] END ||
     CASE WHEN array_length(r.instructor_ids,1)>1 THEN ARRAY['توزيع نصاب التدريس المشترك بانتظار الاستكمال'] ELSE ARRAY[]::text[] END
   WHERE id=r.id;
   added:=added+1;
 END LOOP;
 RETURN jsonb_build_object('new_sessions',added,'new_shared_members',members,
   'source_rows',(SELECT count(*) FROM public.existing_schedule_source_rows WHERE college_id=v.college_id AND term_id=v.academic_term_id),
   'pending',(SELECT count(*) FROM public.existing_schedule_source_rows WHERE college_id=v.college_id AND term_id=v.academic_term_id AND schedule_session_id IS NULL));
END $$;
REVOKE ALL ON FUNCTION public.import_existing_schedule_intake(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.import_existing_schedule_intake(uuid,integer) TO authenticated,service_role;

-- Reconcile only the source-linked Arts draft created by this intake batch.
DO $$
DECLARE r record; pc public.plan_courses%ROWTYPE; target_cohort uuid; target_program uuid; teacher uuid;
BEGIN
 IF EXISTS(SELECT 1 FROM public.schedule_versions WHERE id='38d198db-a391-437e-8e93-b97914e48002' AND status<>'draft') THEN RAISE EXCEPTION 'INTAKE_DRAFT_REQUIRED'; END IF;
 UPDATE public.academic_cohorts c SET existing_schedule=true,entry_year=NULL,expected_students=NULL,
   study_plan_id=(SELECT s.study_plan_id FROM public.existing_schedule_source_rows s WHERE s.cohort_id=c.id AND s.schedule_version_id='38d198db-a391-437e-8e93-b97914e48002' ORDER BY s.source_id LIMIT 1),
   code='الجدول القائم — المستوى '||(SELECT level_number FROM public.academic_levels WHERE id=c.level_id)
 WHERE c.college_id='d78cf264-3a76-43a1-8601-4d6def12b400' AND c.id IN(SELECT cohort_id FROM public.existing_schedule_source_rows WHERE schedule_version_id='38d198db-a391-437e-8e93-b97914e48002');
 UPDATE public.course_offerings o SET expected_students=NULL,existing_schedule=true
 WHERE o.college_id='d78cf264-3a76-43a1-8601-4d6def12b400' AND o.id IN(SELECT course_offering_id FROM public.schedule_sessions WHERE schedule_version_id='38d198db-a391-437e-8e93-b97914e48002');
 UPDATE public.existing_schedule_source_rows s SET room_id=rm.id
 FROM public.study_plans p,public.rooms rm
 WHERE s.college_id='d78cf264-3a76-43a1-8601-4d6def12b400' AND s.term_id='d1844735-b1ee-4c92-acc0-7a529fc43928'
 AND s.study_plan_id=p.id AND s.raw_room='المعمل' AND rm.college_id=s.college_id
 AND rm.code=CASE WHEN p.code LIKE 'AH-AT-%' THEN 'HUM-ARCH-LAB' WHEN p.code LIKE 'AH-MA-%' THEN 'HUM-MEDIA-LAB' END;
 FOR r IN SELECT * FROM public.existing_schedule_source_rows WHERE schedule_version_id='38d198db-a391-437e-8e93-b97914e48002' AND delivery_group_id IS NOT NULL ORDER BY source_id LOOP
   SELECT * INTO pc FROM public.plan_courses WHERE id=r.plan_course_id;
   SELECT program_id INTO target_program FROM public.study_plans WHERE id=pc.study_plan_id;
   SELECT id INTO target_cohort FROM public.academic_cohorts WHERE college_id=r.college_id AND term_id=r.term_id AND study_plan_id=pc.study_plan_id AND level_id=pc.level_id AND existing_schedule;
   IF target_cohort IS NULL THEN
     INSERT INTO public.academic_cohorts(college_id,program_id,level_id,study_plan_id,term_id,study_system,entry_year,expected_students,count_status,code,existing_schedule)
     VALUES(r.college_id,target_program,pc.level_id,pc.study_plan_id,r.term_id,'regular',NULL,NULL,'estimated','الجدول القائم — المستوى '||r.level_number,true) RETURNING id INTO target_cohort;
   END IF;
   UPDATE public.delivery_groups SET cohort_id=target_cohort,plan_course_id=r.plan_course_id,component_id=r.component_id,expected_students=NULL,capacity_limit=NULL,group_code='قائم — '||r.source_id WHERE id=r.delivery_group_id AND college_id=r.college_id;
   UPDATE public.teaching_assignments SET cohort_id=target_cohort,plan_course_component_id=r.component_id,expected_students=NULL WHERE delivery_group_id=r.delivery_group_id AND college_id=r.college_id;
   IF NOT r.shared_member THEN
     UPDATE public.schedule_sessions SET cohort_id=target_cohort,plan_course_component_id=r.component_id,expected_students=NULL,room_id=r.room_id WHERE id=r.schedule_session_id AND college_id=r.college_id;
     IF array_length(r.instructor_ids,1)>1 THEN
       FOREACH teacher IN ARRAY r.instructor_ids LOOP
         IF NOT EXISTS(SELECT 1 FROM public.teaching_assignments WHERE delivery_group_id=r.delivery_group_id AND instructor_id=teacher AND is_active) THEN
           INSERT INTO public.teaching_assignments(college_id,course_offering_id,instructor_id,cohort_id,delivery_group_id,plan_course_component_id,session_type,weekly_hours,assigned_component_hours,expected_students,required_room_type,notes)
           SELECT r.college_id,ss.course_offering_id,teacher,target_cohort,r.delivery_group_id,r.component_id,ss.session_type,c.weekly_contact_hours,NULL,NULL,NULL,'تدريس مشترك؛ توزيع الساعات بانتظار الاستكمال'
           FROM public.schedule_sessions ss JOIN public.plan_course_components c ON c.id=r.component_id WHERE ss.id=r.schedule_session_id;
         END IF;
       END LOOP;
     END IF;
   END IF;
   UPDATE public.existing_schedule_source_rows SET cohort_id=target_cohort,pending_reasons=
     CASE WHEN r.room_id IS NULL THEN ARRAY['قاعة بانتظار التحديد'] ELSE ARRAY[]::text[] END ||
     CASE WHEN array_length(r.instructor_ids,1)>1 THEN ARRAY['توزيع نصاب التدريس المشترك بانتظار الاستكمال'] ELSE ARRAY[]::text[] END
   WHERE id=r.id;
 END LOOP;
 INSERT INTO public.shared_lecture_links(college_id,member_group_id,anchor_group_id)
 SELECT m.college_id,m.delivery_group_id,a.delivery_group_id FROM public.existing_schedule_source_rows m
 JOIN public.existing_schedule_source_rows a ON a.schedule_session_id=m.schedule_session_id AND NOT a.shared_member AND a.college_id=m.college_id
 WHERE m.schedule_version_id='38d198db-a391-437e-8e93-b97914e48002' AND m.shared_member
 ON CONFLICT(member_group_id) DO NOTHING;
END $$;

COMMIT;
