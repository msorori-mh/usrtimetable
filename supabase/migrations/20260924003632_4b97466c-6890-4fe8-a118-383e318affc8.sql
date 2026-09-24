CREATE OR REPLACE FUNCTION faculty_private.submit_request(p_delivery_group_id uuid, p_instructor_id uuid, p_hours numeric, p_notes text, p_assignment_id uuid DEFAULT NULL::uuid, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE h record; g public.delivery_groups%ROWTYPE; a public.teaching_assignments%ROWTYPE;
 v_term uuid;v_component_hours numeric;v_hours numeric;r public.faculty_teaching_requests%ROWTYPE;
 v_orphan_id uuid; v_orphan_count integer:=0;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE='42501'; END IF;
 -- Match the identity linker lock before taking any delivery-group lock.
 PERFORM pg_advisory_xact_lock(180600,1);
 SELECT hp.* INTO h FROM faculty_private.home_profiles hp JOIN faculty_identity_links l ON l.identity_id=hp.identity_id
 WHERE l.instructor_id=p_instructor_id;
 IF h.identity_id IS NULL OR h.home_college_id IS NULL THEN RAISE EXCEPTION 'FACULTY_HOME_REVIEW_REQUIRED'; END IF;
 IF NOT coalesce(h.is_active,false) THEN RAISE EXCEPTION 'INSTRUCTOR_INACTIVE'; END IF;
 g:=lock_delivery_group_for_assignment(p_delivery_group_id);
 IF NOT can_manage_college(auth.uid(),g.college_id) THEN RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM colleges WHERE id=g.college_id AND university_id=h.university_id) THEN RAISE EXCEPTION 'FACULTY_UNIVERSITY_MISMATCH'; END IF;
 PERFORM assert_delivery_group_assignable(g.is_obsolete,g.active);
 SELECT c.term_id,p.weekly_contact_hours INTO v_term,v_component_hours FROM academic_cohorts c
 JOIN plan_course_components p ON p.id=g.component_id WHERE c.id=g.cohort_id AND p.component_type<>'summer_training';
 IF v_term IS NULL OR v_component_hours IS NULL THEN RAISE EXCEPTION 'REQUEST_COMPONENT_INVALID'; END IF;
 v_hours:=coalesce(p_hours,v_component_hours);
 IF v_hours<=0 THEN RAISE EXCEPTION 'ASSIGNED_HOURS_MUST_BE_POSITIVE'; END IF;
 IF p_assignment_id IS NOT NULL THEN
  SELECT * INTO a FROM teaching_assignments WHERE id=p_assignment_id FOR UPDATE;
  IF a.delivery_group_id IS DISTINCT FROM g.id OR a.instructor_id IS DISTINCT FROM p_instructor_id OR NOT a.is_active
    OR a.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'STALE_ASSIGNMENT_UPDATE'; END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM teaching_assignments ta JOIN faculty_identity_links l ON l.instructor_id=ta.instructor_id
    WHERE ta.delivery_group_id=g.id AND ta.is_active AND l.identity_id=h.identity_id) THEN RAISE EXCEPTION 'DUPLICATE_ACTIVE_ASSIGNMENT'; END IF;
 END IF;
 IF p_assignment_id IS NULL THEN
  -- Same safe orphan rule as apply_create_assignment: active assignment in the shared-lecture scope
  -- whose instructor row no longer exists. Exactly one may be excluded; more than one fails closed.
  SELECT count(*)::integer INTO v_orphan_count FROM teaching_assignments ta LEFT JOIN instructors i ON i.id=ta.instructor_id
  WHERE ta.delivery_group_id IN (SELECT m.group_id FROM shared_lecture_group_ids(g.id) m) AND ta.is_active AND i.id IS NULL;
  IF v_orphan_count>1 THEN RAISE EXCEPTION 'MULTIPLE_ORPHAN_ASSIGNMENTS_REVIEW_REQUIRED' USING ERRCODE='check_violation'; END IF;
  IF v_orphan_count=1 THEN
   SELECT ta.id INTO v_orphan_id FROM teaching_assignments ta LEFT JOIN instructors i ON i.id=ta.instructor_id
   WHERE ta.delivery_group_id IN (SELECT m.group_id FROM shared_lecture_group_ids(g.id) m) AND ta.is_active AND i.id IS NULL
   FOR UPDATE OF ta;
  END IF;
 END IF;
 PERFORM validate_assignment_allocation_locked(g.id,coalesce(p_assignment_id,v_orphan_id),v_hours,v_component_hours,true);
 IF h.home_college_id=g.college_id THEN
   IF p_assignment_id IS NOT NULL THEN RETURN faculty_private.apply_update_assignment(p_assignment_id,p_expected_updated_at,v_hours,p_notes); END IF;
   RETURN faculty_private.apply_create_assignment(g.id,h.source_instructor_id,v_hours,p_notes);
 END IF;
 IF EXISTS(SELECT 1 FROM faculty_teaching_requests WHERE identity_id=h.identity_id AND delivery_group_id=g.id AND status='pending') THEN
   RAISE EXCEPTION 'FACULTY_REQUEST_ALREADY_PENDING';
 END IF;
 INSERT INTO faculty_teaching_requests(identity_id,instructor_id,home_college_id,college_id,delivery_group_id,term_id,
 component_hours,assigned_hours,assignment_id,expected_assignment_updated_at,notes,requested_by)
 VALUES(h.identity_id,CASE WHEN p_assignment_id IS NULL THEN h.source_instructor_id ELSE p_instructor_id END,
 h.home_college_id,g.college_id,g.id,v_term,v_component_hours,v_hours,p_assignment_id,p_expected_updated_at,p_notes,auth.uid()) RETURNING * INTO r;
 INSERT INTO audit_logs(actor_id,action,entity,entity_id,college_id,details)
 VALUES(auth.uid(),'faculty_teaching_requested','faculty_teaching_requests',r.id,r.college_id,jsonb_build_object('home_college_id',r.home_college_id,'hours',v_hours));
 IF is_super_admin(auth.uid()) THEN RETURN public.decide_faculty_teaching_request(r.id,'approved','اعتماد مباشر بواسطة الأدمن'); END IF;
 RETURN jsonb_build_object('ok',true,'action','requested','request_id',r.id,'delivery_group_id',g.id,'instructor_id',r.instructor_id);
END $function$;