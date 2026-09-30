BEGIN;
SET LOCAL lock_timeout = '5s';

-- Intake links represent already verified physical lectures and keep their
-- separate source-row rules. Ordinary groups may share a theory component
-- across any number of cohorts in one term, within or across study systems.
CREATE OR REPLACE FUNCTION public.validate_shared_lecture_link()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
DECLARE a public.delivery_groups%ROWTYPE; b public.delivery_groups%ROWTYPE;
        ca public.academic_cohorts%ROWTYPE; cb public.academic_cohorts%ROWTYPE;
        total integer; smallest_capacity integer; missing_capacity boolean;
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
  IF a.id IS NULL OR b.id IS NULL OR a.id=b.id
     OR a.college_id IS DISTINCT FROM NEW.college_id OR b.college_id IS DISTINCT FROM NEW.college_id
     OR a.cohort_id=b.cohort_id OR ca.term_id IS DISTINCT FROM cb.term_id
     OR ca.existing_schedule OR cb.existing_schedule
     OR ca.study_system NOT IN ('regular','parallel') OR cb.study_system NOT IN ('regular','parallel')
     OR ca.program_id IS DISTINCT FROM cb.program_id OR ca.level_id IS DISTINCT FROM cb.level_id
     OR a.plan_course_id IS DISTINCT FROM b.plan_course_id OR a.component_id IS DISTINCT FROM b.component_id
     OR NOT ca.active OR NOT cb.active OR NOT a.active OR NOT b.active
     OR a.is_obsolete OR b.is_obsolete OR COALESCE(a.expected_students,0)<=0 OR COALESCE(b.expected_students,0)<=0
     OR NOT EXISTS (SELECT 1 FROM public.plan_course_components p WHERE p.id=a.component_id
                    AND p.component_type='theory' AND p.is_timetabled AND p.weekly_contact_hours>0)
  THEN RAISE EXCEPTION 'SHARED_LECTURE_CONTEXT_MISMATCH' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM public.shared_lecture_links l
            WHERE l.member_group_id=NEW.anchor_group_id OR l.anchor_group_id=NEW.member_group_id)
  THEN RAISE EXCEPTION 'SHARED_LECTURE_CHAIN_FORBIDDEN' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM public.schedule_sessions WHERE delivery_group_id IN(a.id,b.id))
  THEN RAISE EXCEPTION 'SHARED_LECTURE_SCHEDULED' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM public.teaching_assignments WHERE delivery_group_id IN(a.id,b.id) AND is_active)
  THEN RAISE EXCEPTION 'SHARED_LECTURE_ACTIVE_ASSIGNMENTS_EXIST' USING ERRCODE='23514'; END IF;
  SELECT a.expected_students+b.expected_students+COALESCE(sum(g.expected_students),0),
         LEAST(a.capacity_limit,b.capacity_limit,min(g.capacity_limit)),
         COALESCE(bool_or(g.capacity_limit IS NULL),false)
    INTO total,smallest_capacity,missing_capacity
    FROM public.shared_lecture_links l JOIN public.delivery_groups g ON g.id=l.member_group_id
   WHERE l.anchor_group_id=a.id AND l.member_group_id<>b.id;
  IF a.capacity_limit IS NULL OR b.capacity_limit IS NULL OR missing_capacity OR total>smallest_capacity
  THEN RAISE EXCEPTION 'SHARED_LECTURE_CAPACITY_EXCEEDED' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.validate_shared_lecture_link() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.shared_lecture_candidates(p_college uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $fn$
 SELECT COALESCE(jsonb_agg(jsonb_build_object(
   'anchor_group_id',a.id,'member_group_id',b.id,'course_name',course.name,
   'anchor_cohort_code',ca.code,'member_cohort_code',cb.code,
   'anchor_study_system',ca.study_system,'member_study_system',cb.study_system,
   'anchor_students',a.expected_students,'member_students',b.expected_students,
   'total_students',a.expected_students+b.expected_students+COALESCE(links.students,0),
   'capacity_limit',LEAST(a.capacity_limit,b.capacity_limit,links.minimum_capacity),
   'weekly_hours',p.weekly_contact_hours) ORDER BY course.name,ca.code,cb.code),'[]'::jsonb)
 FROM public.delivery_groups a
 JOIN public.delivery_groups b ON b.component_id=a.component_id AND b.college_id=a.college_id
   AND b.plan_course_id=a.plan_course_id AND b.cohort_id<>a.cohort_id
 JOIN public.academic_cohorts ca ON ca.id=a.cohort_id
 JOIN public.academic_cohorts cb ON cb.id=b.cohort_id
 JOIN public.plan_course_components p ON p.id=a.component_id
 JOIN public.plan_courses pc ON pc.id=a.plan_course_id
 JOIN public.courses course ON course.id=pc.course_id
 LEFT JOIN LATERAL (
   SELECT sum(g.expected_students)::integer students,min(g.capacity_limit) minimum_capacity
   FROM public.shared_lecture_links l JOIN public.delivery_groups g ON g.id=l.member_group_id
   WHERE l.anchor_group_id=a.id
 ) links ON true
 WHERE a.college_id=p_college AND public.can_manage_college(auth.uid(),p_college)
   AND ca.active AND cb.active AND ca.term_id=cb.term_id AND ca.program_id=cb.program_id AND ca.level_id=cb.level_id
   AND NOT ca.existing_schedule AND NOT cb.existing_schedule
   AND ca.study_system IN ('regular','parallel') AND cb.study_system IN ('regular','parallel')
   AND a.active AND b.active AND NOT a.is_obsolete AND NOT b.is_obsolete
   AND p.component_type='theory' AND p.is_timetabled AND p.weekly_contact_hours>0
   AND a.expected_students>0 AND b.expected_students>0
   AND a.capacity_limit IS NOT NULL AND b.capacity_limit IS NOT NULL
   AND NOT EXISTS(SELECT 1 FROM public.shared_lecture_links l JOIN public.delivery_groups g ON g.id=l.member_group_id
                  WHERE l.anchor_group_id=a.id AND g.capacity_limit IS NULL)
   AND a.expected_students+b.expected_students+COALESCE(links.students,0)
       <=LEAST(a.capacity_limit,b.capacity_limit,links.minimum_capacity)
   AND NOT EXISTS(SELECT 1 FROM public.shared_lecture_links l WHERE l.member_group_id=a.id OR l.member_group_id=b.id OR l.anchor_group_id=b.id)
   AND NOT EXISTS(SELECT 1 FROM public.shared_lecture_links l JOIN public.delivery_groups g ON g.id=l.member_group_id
                  WHERE l.anchor_group_id=a.id AND g.cohort_id=b.cohort_id)
   AND NOT EXISTS(SELECT 1 FROM public.schedule_sessions s WHERE s.delivery_group_id IN(a.id,b.id))
   AND NOT EXISTS(SELECT 1 FROM public.teaching_assignments t WHERE t.delivery_group_id IN(a.id,b.id) AND t.is_active);
$fn$;
REVOKE ALL ON FUNCTION public.shared_lecture_candidates(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.shared_lecture_candidates(uuid) TO authenticated;

-- A single RPC makes selection of multiple cohorts all-or-nothing.
CREATE OR REPLACE FUNCTION public.merge_shared_lectures(p_anchor uuid,p_members uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE member uuid; college uuid;
BEGIN
  IF auth.uid() IS NULL OR p_members IS NULL OR cardinality(p_members)<1
     OR array_position(p_members,NULL) IS NOT NULL
     OR (SELECT count(DISTINCT x) FROM unnest(p_members) x)<>cardinality(p_members)
  THEN RAISE EXCEPTION 'SHARED_LECTURE_SELECTION_INVALID' USING ERRCODE='23514'; END IF;
  SELECT college_id INTO college FROM public.delivery_groups WHERE id=p_anchor;
  IF college IS NULL OR NOT public.can_manage_college(auth.uid(),college)
  THEN RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE='42501'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(9262,1);
  FOREACH member IN ARRAY p_members LOOP
    PERFORM public.merge_shared_lecture(p_anchor,member);
  END LOOP;
  RETURN jsonb_build_object('ok',true,'anchor_group_id',p_anchor,
                            'expected_students',(public.operational_delivery_group(p_anchor)).expected_students);
END;
$fn$;
REVOKE ALL ON FUNCTION public.merge_shared_lectures(uuid,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.merge_shared_lectures(uuid,uuid[]) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
