-- Shared lecture membership preserves the source cohorts and practical groups.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE TABLE IF NOT EXISTS public.shared_lecture_links (
  member_group_id uuid PRIMARY KEY REFERENCES public.delivery_groups(id) ON DELETE RESTRICT,
  anchor_group_id uuid NOT NULL REFERENCES public.delivery_groups(id) ON DELETE RESTRICT,
  college_id uuid NOT NULL REFERENCES public.colleges(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (member_group_id <> anchor_group_id)
);
CREATE INDEX IF NOT EXISTS shared_lecture_anchor_idx ON public.shared_lecture_links(anchor_group_id);
ALTER TABLE public.shared_lecture_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shared_lecture_read ON public.shared_lecture_links;
CREATE POLICY shared_lecture_read ON public.shared_lecture_links FOR SELECT TO authenticated
  USING (public.can_view_college((SELECT auth.uid()),college_id));
REVOKE ALL ON public.shared_lecture_links FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.shared_lecture_links TO authenticated;

CREATE OR REPLACE FUNCTION public.shared_lecture_group_ids(p_group uuid)
RETURNS TABLE(group_id uuid) LANGUAGE sql STABLE SET search_path = '' AS $fn$
  WITH anchor AS (SELECT COALESCE((SELECT anchor_group_id FROM public.shared_lecture_links WHERE member_group_id=p_group),p_group) id)
  SELECT id FROM anchor UNION SELECT l.member_group_id FROM public.shared_lecture_links l JOIN anchor a ON a.id=l.anchor_group_id;
$fn$;

CREATE OR REPLACE FUNCTION public.operational_delivery_group(p_group uuid)
RETURNS public.delivery_groups LANGUAGE plpgsql STABLE SET search_path = '' AS $fn$
DECLARE g public.delivery_groups%ROWTYPE; total integer;
BEGIN
  SELECT * INTO g FROM public.delivery_groups WHERE id=p_group;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF EXISTS(SELECT 1 FROM public.shared_lecture_links WHERE member_group_id=p_group) THEN
    g.active := false;
    g.is_obsolete := true;
  ELSIF EXISTS(SELECT 1 FROM public.shared_lecture_links WHERE anchor_group_id=p_group) THEN
    SELECT sum(d.expected_students)::integer INTO total FROM public.delivery_groups d
      JOIN public.shared_lecture_group_ids(p_group) m ON m.group_id=d.id;
    g.expected_students := total;
    g.group_code := g.group_code || ' — عام + موازٍ';
  END IF;
  RETURN g;
END;
$fn$;
CREATE OR REPLACE VIEW public.operational_delivery_groups WITH (security_invoker=true) AS
  SELECT (public.operational_delivery_group(g.id)).* FROM public.delivery_groups g;
CREATE OR REPLACE VIEW public.operational_group_members WITH (security_invoker=true) AS
  SELECT m.id,m.college_id,m.cohort_id,m.delivery_group_id,m.partition_id,p.headcount AS partition_headcount,p.active AS partition_active,
    EXISTS(SELECT 1 FROM public.shared_lecture_links WHERE anchor_group_id=m.delivery_group_id) AS shared_lecture
  FROM public.delivery_group_partition_members m JOIN public.cohort_student_partitions p ON p.id=m.partition_id
  UNION ALL
  SELECT m.id,m.college_id,m.cohort_id,l.anchor_group_id,m.partition_id,p.headcount,p.active,true
  FROM public.shared_lecture_links l JOIN public.delivery_group_partition_members m ON m.delivery_group_id=l.member_group_id
  JOIN public.cohort_student_partitions p ON p.id=m.partition_id;
REVOKE ALL ON public.operational_delivery_groups,public.operational_group_members FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.operational_delivery_groups,public.operational_group_members TO authenticated;

CREATE OR REPLACE FUNCTION public.shared_lecture_matches(p_group uuid,p_cohort uuid DEFAULT NULL,p_system text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $fn$
 SELECT EXISTS(SELECT 1 FROM public.shared_lecture_group_ids(p_group) m
 JOIN public.delivery_groups g ON g.id=m.group_id JOIN public.academic_cohorts c ON c.id=g.cohort_id
 WHERE (p_cohort IS NULL OR c.id=p_cohort) AND (p_system IS NULL OR c.study_system=p_system));
$fn$;

-- A shared lecture must fit an approved window for each participating system.
CREATE OR REPLACE FUNCTION public.shared_lecture_time_allowed(p_college uuid,p_day integer,p_start time,p_end time)
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $fn$
 SELECT bool_and(EXISTS(SELECT 1 FROM public.time_slot_templates t WHERE t.college_id=p_college
   AND t.is_active AND t.day_of_week=p_day AND t.study_system IN(system,'both')
   AND t.start_time<=p_start AND t.end_time>=p_end)) FROM unnest(ARRAY['regular','parallel']) system;
$fn$;

-- Only theory in the SAME plan component, program, level and term is supported.
-- The scope deliberately excludes cross-program equivalence and partial regrouping.
CREATE OR REPLACE FUNCTION public.validate_shared_lecture_link()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
DECLARE a public.delivery_groups%ROWTYPE; b public.delivery_groups%ROWTYPE;
 ca public.academic_cohorts%ROWTYPE; cb public.academic_cohorts%ROWTYPE; n integer;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(9262,1);
 SELECT * INTO a FROM public.delivery_groups WHERE id=NEW.anchor_group_id FOR UPDATE;
 SELECT * INTO b FROM public.delivery_groups WHERE id=NEW.member_group_id FOR UPDATE;
 SELECT * INTO ca FROM public.academic_cohorts WHERE id=a.cohort_id;
 SELECT * INTO cb FROM public.academic_cohorts WHERE id=b.cohort_id;
 IF a.id IS NULL OR b.id IS NULL OR a.id=b.id OR a.college_id<>NEW.college_id OR b.college_id<>NEW.college_id
   OR ca.id=cb.id OR NOT ca.active OR NOT cb.active OR ca.program_id<>cb.program_id OR ca.level_id<>cb.level_id
   OR ca.study_system IS DISTINCT FROM 'regular' OR cb.study_system IS DISTINCT FROM 'parallel'
   OR ca.term_id<>cb.term_id OR a.component_id<>b.component_id OR a.plan_course_id<>b.plan_course_id
   OR NOT a.active OR NOT b.active OR a.is_obsolete OR b.is_obsolete
   OR a.expected_students<=0 OR b.expected_students<=0
   OR NOT EXISTS(SELECT 1 FROM public.plan_course_components p WHERE p.id=a.component_id AND p.component_type='theory' AND p.is_timetabled AND p.weekly_contact_hours>0)
 THEN RAISE EXCEPTION 'SHARED_LECTURE_CONTEXT_MISMATCH' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM public.shared_lecture_links l WHERE l.member_group_id=NEW.anchor_group_id OR l.anchor_group_id=NEW.member_group_id)
 THEN RAISE EXCEPTION 'SHARED_LECTURE_CHAIN_FORBIDDEN' USING ERRCODE='23514'; END IF;
 SELECT a.expected_students+b.expected_students+COALESCE(sum(g.expected_students),0) INTO n
 FROM public.shared_lecture_links l JOIN public.delivery_groups g ON g.id=l.member_group_id
 WHERE l.anchor_group_id=a.id AND l.member_group_id<>b.id;
 IF n>LEAST(a.capacity_limit,b.capacity_limit) OR a.capacity_limit IS NULL OR b.capacity_limit IS NULL
 THEN RAISE EXCEPTION 'SHARED_LECTURE_CAPACITY_EXCEEDED' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM public.teaching_assignments WHERE delivery_group_id IN(a.id,b.id) AND is_active)
 THEN RAISE EXCEPTION 'SHARED_LECTURE_ACTIVE_ASSIGNMENTS_EXIST' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS validate_shared_lecture_link ON public.shared_lecture_links;
CREATE TRIGGER validate_shared_lecture_link BEFORE INSERT OR UPDATE ON public.shared_lecture_links
 FOR EACH ROW EXECUTE FUNCTION public.validate_shared_lecture_link();

CREATE OR REPLACE FUNCTION public.merge_shared_lecture(p_anchor uuid,p_member uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE c uuid; existing uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE='42501'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(9262,1);
 SELECT college_id INTO c FROM public.delivery_groups WHERE id=p_anchor;
 IF c IS NULL OR NOT public.can_manage_college(auth.uid(),c) THEN RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE='42501'; END IF;
 SELECT anchor_group_id INTO existing FROM public.shared_lecture_links WHERE member_group_id=p_member;
 IF existing IS NOT NULL AND existing<>p_anchor THEN RAISE EXCEPTION 'SHARED_LECTURE_ALREADY_LINKED' USING ERRCODE='23514'; END IF;
 IF existing IS NULL THEN
   INSERT INTO public.shared_lecture_links(member_group_id,anchor_group_id,college_id) VALUES(p_member,p_anchor,c);
   INSERT INTO public.audit_logs(actor_id,action,entity,entity_id,college_id,details)
   VALUES(auth.uid(),'merge_shared_lecture','delivery_groups',p_anchor,c,jsonb_build_object('member_group_id',p_member));
 END IF;
 RETURN jsonb_build_object('ok',true,'anchor_group_id',p_anchor,'expected_students',(public.operational_delivery_group(p_anchor)).expected_students);
END;
$fn$;
REVOKE ALL ON FUNCTION public.merge_shared_lecture(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.merge_shared_lecture(uuid,uuid) TO authenticated;

-- Re-generation may retain a merge only if its exact source counts and scope survive.
CREATE OR REPLACE FUNCTION public.guard_shared_lecture_source()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
 IF EXISTS(SELECT 1 FROM public.shared_lecture_links WHERE anchor_group_id=OLD.id OR member_group_id=OLD.id)
   AND (TG_OP='DELETE' OR NEW.cohort_id IS DISTINCT FROM OLD.cohort_id OR NEW.component_id IS DISTINCT FROM OLD.component_id
   OR NEW.plan_course_id IS DISTINCT FROM OLD.plan_course_id OR NEW.college_id IS DISTINCT FROM OLD.college_id
   OR NEW.expected_students IS DISTINCT FROM OLD.expected_students OR NEW.capacity_limit IS DISTINCT FROM OLD.capacity_limit
   OR NEW.active IS DISTINCT FROM OLD.active OR NEW.is_obsolete IS DISTINCT FROM OLD.is_obsolete)
 THEN RAISE EXCEPTION 'SHARED_LECTURE_REVIEW_REQUIRED' USING ERRCODE='23514'; END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$fn$;
DROP TRIGGER IF EXISTS guard_shared_lecture_source ON public.delivery_groups;
CREATE TRIGGER guard_shared_lecture_source BEFORE UPDATE OR DELETE ON public.delivery_groups
 FOR EACH ROW EXECUTE FUNCTION public.guard_shared_lecture_source();
CREATE OR REPLACE FUNCTION public.guard_shared_lecture_cohort()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
DECLARE cid uuid;
BEGIN
 cid:=CASE WHEN TG_TABLE_NAME='academic_cohorts' THEN OLD.id ELSE OLD.cohort_id END;
 IF EXISTS(SELECT 1 FROM public.shared_lecture_links l JOIN public.delivery_groups g ON g.id IN(l.anchor_group_id,l.member_group_id) WHERE g.cohort_id=cid)
 AND (TG_OP='DELETE' OR (to_jsonb(NEW)-'updated_at'-'notes'-'source') IS DISTINCT FROM (to_jsonb(OLD)-'updated_at'-'notes'-'source'))
 THEN RAISE EXCEPTION 'SHARED_LECTURE_REVIEW_REQUIRED' USING ERRCODE='23514'; END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$fn$;
DROP TRIGGER IF EXISTS guard_shared_lecture_cohort ON public.academic_cohorts;
CREATE TRIGGER guard_shared_lecture_cohort BEFORE UPDATE OR DELETE ON public.academic_cohorts
 FOR EACH ROW EXECUTE FUNCTION public.guard_shared_lecture_cohort();
DROP TRIGGER IF EXISTS guard_shared_lecture_headcount ON public.scheduling_cohort_term_headcounts;
CREATE TRIGGER guard_shared_lecture_headcount BEFORE UPDATE OR DELETE ON public.scheduling_cohort_term_headcounts
 FOR EACH ROW EXECUTE FUNCTION public.guard_shared_lecture_cohort();
CREATE OR REPLACE FUNCTION public.shared_lecture_catalog(p_college uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $fn$
 SELECT COALESCE(jsonb_agg(jsonb_build_object('anchor_group_id',l.anchor_group_id,
 'member_group_id',l.member_group_id,'cohort_id',g.cohort_id,'cohort_code',c.code,
 'anchor_cohort_id',a.cohort_id,'expected_students',g.expected_students,
 'total_students',(public.operational_delivery_group(a.id)).expected_students,
 'course_name',course.name,'study_system',c.study_system)),'[]'::jsonb)
 FROM public.shared_lecture_links l JOIN public.delivery_groups g ON g.id=l.member_group_id
 JOIN public.delivery_groups a ON a.id=l.anchor_group_id JOIN public.academic_cohorts c ON c.id=g.cohort_id
 JOIN public.plan_courses pc ON pc.id=g.plan_course_id JOIN public.courses course ON course.id=pc.course_id
 WHERE l.college_id=p_college;
$fn$;
REVOKE ALL ON FUNCTION public.shared_lecture_catalog(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.shared_lecture_catalog(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.unmerge_shared_lecture(p_member uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE l public.shared_lecture_links%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE='42501'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(9262,1);
 SELECT * INTO l FROM public.shared_lecture_links WHERE member_group_id=p_member FOR UPDATE;
 IF NOT FOUND OR NOT public.can_manage_college(auth.uid(),l.college_id) THEN RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.delivery_groups WHERE id=l.anchor_group_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.schedule_sessions WHERE delivery_group_id=l.anchor_group_id AND study_system='both')
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
CREATE OR REPLACE FUNCTION public.shared_lecture_candidates(p_college uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $fn$
 SELECT COALESCE(jsonb_agg(jsonb_build_object('anchor_group_id',a.id,'member_group_id',b.id,
 'course_name',course.name,'anchor_cohort_code',ca.code,'member_cohort_code',cb.code,
 'total_students',a.expected_students+b.expected_students,'weekly_hours',p.weekly_contact_hours)
 ORDER BY course.name),'[]'::jsonb)
 FROM public.delivery_groups a JOIN public.delivery_groups b ON b.component_id=a.component_id AND b.college_id=a.college_id AND b.cohort_id<>a.cohort_id
 JOIN public.academic_cohorts ca ON ca.id=a.cohort_id JOIN public.academic_cohorts cb ON cb.id=b.cohort_id
 JOIN public.plan_course_components p ON p.id=a.component_id JOIN public.plan_courses pc ON pc.id=a.plan_course_id JOIN public.courses course ON course.id=pc.course_id
 WHERE a.college_id=p_college AND public.can_manage_college(auth.uid(),p_college)
 AND ca.study_system='regular' AND cb.study_system='parallel' AND ca.active AND cb.active
 AND ca.program_id=cb.program_id AND ca.level_id=cb.level_id AND ca.term_id=cb.term_id
 AND a.plan_course_id=b.plan_course_id AND a.active AND b.active AND NOT a.is_obsolete AND NOT b.is_obsolete
 AND p.component_type='theory' AND p.is_timetabled AND p.weekly_contact_hours>0
 AND a.expected_students>0 AND b.expected_students>0 AND a.expected_students+b.expected_students<=LEAST(a.capacity_limit,b.capacity_limit)
 AND NOT EXISTS(SELECT 1 FROM public.shared_lecture_links l WHERE l.anchor_group_id IN(a.id,b.id) OR l.member_group_id IN(a.id,b.id))
 AND NOT EXISTS(SELECT 1 FROM public.teaching_assignments t WHERE t.delivery_group_id IN(a.id,b.id) AND t.is_active);
$fn$;
REVOKE ALL ON FUNCTION public.shared_lecture_candidates(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.shared_lecture_candidates(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.shared_lecture_revision()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
 UPDATE public.schedule_versions SET eligibility_revision=COALESCE(eligibility_revision,0)+1
 WHERE college_id=COALESCE(NEW.college_id,OLD.college_id) AND status='draft';
 RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shared_lecture_revision() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS shared_lecture_revision ON public.shared_lecture_links;
CREATE TRIGGER shared_lecture_revision AFTER INSERT OR UPDATE OR DELETE ON public.shared_lecture_links
 FOR EACH ROW EXECUTE FUNCTION public.shared_lecture_revision();
NOTIFY pgrst,'reload schema';
COMMIT;
