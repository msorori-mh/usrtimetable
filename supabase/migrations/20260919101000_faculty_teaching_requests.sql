CREATE OR REPLACE FUNCTION faculty_private.apply_create_assignment(p_delivery_group_id uuid, p_instructor_id uuid, p_assigned_component_hours numeric DEFAULT NULL::numeric, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_dg public.delivery_groups%ROWTYPE;
  v_pcc public.plan_course_components%ROWTYPE;
  v_instructor public.instructors%ROWTYPE;
  v_offering_id uuid;
  v_session_type text;
  v_effective_hours numeric;
  v_existing public.teaching_assignments%ROWTYPE;
  v_row public.teaching_assignments%ROWTYPE;
  v_action text;
  v_audit_action text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  IF p_delivery_group_id IS NULL OR p_instructor_id IS NULL THEN
    RAISE EXCEPTION 'DELIVERY_GROUP_AND_INSTRUCTOR_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;

  -- Lock order: delivery_group → active assignment rows
  v_dg := public.lock_delivery_group_for_assignment(p_delivery_group_id);

  -- Permission checked by the request/decision RPC; this core is not exposed.

  PERFORM public.assert_delivery_group_assignable(v_dg.is_obsolete, v_dg.active);

  SELECT * INTO v_instructor FROM public.instructors WHERE id = p_instructor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INSTRUCTOR_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;
  -- CROSS-COLLEGE-01: assigning an instructor from another college is allowed;
  -- the assignment row stays in the delivery group's college and the instructor profile is never modified.

  SELECT * INTO v_pcc FROM public.plan_course_components WHERE id = v_dg.component_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ASSIGNMENT_COMPONENT_MISMATCH' USING ERRCODE = 'check_violation';
  END IF;
  IF v_pcc.component_type = 'summer_training' THEN
    RAISE EXCEPTION 'SUMMER_TRAINING_WEEKLY_ASSIGNMENT_FORBIDDEN' USING ERRCODE = 'check_violation';
  END IF;

  IF p_assigned_component_hours IS NOT NULL AND p_assigned_component_hours <= 0 THEN
    RAISE EXCEPTION 'ASSIGNED_HOURS_MUST_BE_POSITIVE' USING ERRCODE = 'check_violation';
  END IF;

  -- Reactivate inactive natural key if present (target row lock)
  SELECT * INTO v_existing
  FROM public.teaching_assignments ta
  WHERE ta.college_id = v_dg.college_id
    AND ta.delivery_group_id = p_delivery_group_id
    AND ta.instructor_id = p_instructor_id
  ORDER BY ta.is_active DESC, ta.updated_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_existing.id IS NOT NULL AND v_existing.is_active THEN
    RAISE EXCEPTION 'DUPLICATE_ACTIVE_ASSIGNMENT' USING ERRCODE = 'unique_violation';
  END IF;

  v_offering_id := public.resolve_offering_for_delivery_group(p_delivery_group_id);
  IF v_offering_id IS NULL THEN
    RAISE EXCEPTION 'NO_COMPATIBILITY_OFFERING' USING ERRCODE = 'check_violation';
  END IF;

  v_session_type := CASE v_pcc.component_type
    WHEN 'theory' THEN 'lecture'
    WHEN 'practical' THEN 'lab'
    WHEN 'tutorial' THEN 'tutorial'
    WHEN 'project' THEN 'seminar'
    ELSE 'lecture'
  END;

  v_effective_hours := COALESCE(p_assigned_component_hours, v_pcc.weekly_contact_hours, 0);

  PERFORM public.validate_assignment_allocation_locked(
    p_delivery_group_id,
    CASE WHEN v_existing.id IS NOT NULL AND NOT v_existing.is_active THEN v_existing.id ELSE NULL END,
    p_assigned_component_hours,
    v_pcc.weekly_contact_hours,
    true
  );

  IF v_existing.id IS NOT NULL AND NOT v_existing.is_active THEN
    UPDATE public.teaching_assignments SET
      is_active = TRUE,
      assigned_component_hours = p_assigned_component_hours,
      weekly_hours = v_effective_hours,
      notes = COALESCE(p_notes, notes),
      course_offering_id = v_offering_id,
      cohort_id = v_dg.cohort_id,
      plan_course_component_id = v_dg.component_id,
      session_type = v_session_type,
      expected_students = COALESCE(v_dg.expected_students, expected_students)
    WHERE id = v_existing.id
    RETURNING * INTO v_row;
    v_action := 'reactivated';
    v_audit_action := 'teaching_assignment_reactivated';
  ELSE
    INSERT INTO public.teaching_assignments (
      college_id,
      course_offering_id,
      instructor_id,
      section_number,
      session_type,
      weekly_hours,
      notes,
      expected_students,
      cohort_id,
      plan_course_component_id,
      delivery_group_id,
      assigned_component_hours,
      is_active
    ) VALUES (
      v_dg.college_id,
      v_offering_id,
      p_instructor_id,
      COALESCE(v_dg.group_code, v_dg.group_number::text),
      v_session_type,
      v_effective_hours,
      p_notes,
      COALESCE(v_dg.expected_students, 0),
      v_dg.cohort_id,
      v_dg.component_id,
      p_delivery_group_id,
      p_assigned_component_hours,
      TRUE
    )
    RETURNING * INTO v_row;
    v_action := 'created';
    v_audit_action := 'teaching_assignment_created';
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (
    v_uid,
    v_audit_action,
    'teaching_assignments',
    v_row.id,
    v_dg.college_id,
    jsonb_build_object(
      'assignment_id', v_row.id,
      'delivery_group_id', p_delivery_group_id,
      'instructor_id', p_instructor_id,
      'component_type', v_pcc.component_type,
      'old_assigned_hours', NULL,
      'new_assigned_hours', p_assigned_component_hours,
      'lifecycle_action', v_action
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'action', v_action,
    'assignment_id', v_row.id,
    'delivery_group_id', p_delivery_group_id,
    'instructor_id', p_instructor_id,
    'assigned_component_hours', v_row.assigned_component_hours,
    'is_active', v_row.is_active,
    'updated_at', v_row.updated_at,
    'allocation', public.compute_delivery_group_allocation(p_delivery_group_id)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION faculty_private.apply_update_assignment(p_assignment_id uuid, p_expected_updated_at timestamp with time zone, p_assigned_component_hours numeric DEFAULT NULL::numeric, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.teaching_assignments%ROWTYPE;
  v_dg public.delivery_groups%ROWTYPE;
  v_old_hours numeric;
  v_pcc_type text;
  v_pcc_hours numeric;
  v_effective numeric;
  v_dg_id uuid;
  v_college_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  IF p_assignment_id IS NULL OR p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'ASSIGNMENT_ID_AND_EXPECTED_UPDATED_AT_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;

  -- Resolve context without locking assignment first (stable lock order)
  SELECT ta.delivery_group_id, ta.college_id
    INTO v_dg_id, v_college_id
  FROM public.teaching_assignments ta
  WHERE ta.id = p_assignment_id;
  IF v_college_id IS NULL THEN
    RAISE EXCEPTION 'ASSIGNMENT_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;
  -- Permission checked by the request/decision RPC; this core is not exposed.
  IF v_dg_id IS NULL THEN
    RAISE EXCEPTION 'LEGACY_ASSIGNMENT_NOT_SUPPORTED_BY_V2_RPC' USING ERRCODE = 'check_violation';
  END IF;

  v_dg := public.lock_delivery_group_for_assignment(v_dg_id);
  PERFORM public.assert_delivery_group_assignable(v_dg.is_obsolete, v_dg.active);

  SELECT * INTO v_row
  FROM public.teaching_assignments
  WHERE id = p_assignment_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ASSIGNMENT_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_row.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'STALE_ASSIGNMENT_UPDATE' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT v_row.is_active THEN
    RAISE EXCEPTION 'INACTIVE_ASSIGNMENT_UPDATE_FORBIDDEN' USING ERRCODE = 'check_violation';
  END IF;

  IF p_assigned_component_hours IS NOT NULL AND p_assigned_component_hours <= 0 THEN
    RAISE EXCEPTION 'ASSIGNED_HOURS_MUST_BE_POSITIVE' USING ERRCODE = 'check_violation';
  END IF;

  v_old_hours := v_row.assigned_component_hours;
  SELECT pcc.component_type,
         pcc.weekly_contact_hours,
         COALESCE(p_assigned_component_hours, v_row.assigned_component_hours, pcc.weekly_contact_hours, 0)
    INTO v_pcc_type, v_pcc_hours, v_effective
  FROM public.plan_course_components pcc
  WHERE pcc.id = v_row.plan_course_component_id;

  PERFORM public.validate_assignment_allocation_locked(
    v_dg_id,
    p_assignment_id,
    COALESCE(p_assigned_component_hours, v_row.assigned_component_hours),
    v_pcc_hours,
    true
  );

  UPDATE public.teaching_assignments SET
    assigned_component_hours = COALESCE(p_assigned_component_hours, assigned_component_hours),
    weekly_hours = v_effective,
    notes = COALESCE(p_notes, notes)
  WHERE id = p_assignment_id
  RETURNING * INTO v_row;

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (
    v_uid,
    'teaching_assignment_hours_updated',
    'teaching_assignments',
    v_row.id,
    v_row.college_id,
    jsonb_build_object(
      'assignment_id', v_row.id,
      'delivery_group_id', v_row.delivery_group_id,
      'instructor_id', v_row.instructor_id,
      'component_type', v_pcc_type,
      'old_assigned_hours', v_old_hours,
      'new_assigned_hours', v_row.assigned_component_hours
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'action', 'updated',
    'assignment_id', v_row.id,
    'assigned_component_hours', v_row.assigned_component_hours,
    'updated_at', v_row.updated_at,
    'allocation', public.compute_delivery_group_allocation(v_row.delivery_group_id)
  );
END;
$function$;
CREATE TABLE public.faculty_teaching_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 identity_id uuid NOT NULL REFERENCES public.faculty_identities(id),
 instructor_id uuid NOT NULL REFERENCES public.instructors(id),
 home_college_id uuid NOT NULL REFERENCES public.colleges(id),
 college_id uuid NOT NULL REFERENCES public.colleges(id),
 delivery_group_id uuid NOT NULL REFERENCES public.delivery_groups(id),
 term_id uuid NOT NULL REFERENCES public.academic_terms(id),
 component_hours numeric NOT NULL,
 assigned_hours numeric NOT NULL CHECK(assigned_hours>0),
 assignment_id uuid REFERENCES public.teaching_assignments(id),
 expected_assignment_updated_at timestamptz,
 notes text,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','cancelled')),
 requested_by uuid NOT NULL,decided_by uuid,decision_note text,
 created_at timestamptz NOT NULL DEFAULT now(),decided_at timestamptz
);
CREATE UNIQUE INDEX faculty_one_pending_request ON public.faculty_teaching_requests(identity_id,delivery_group_id) WHERE status='pending';
ALTER TABLE public.faculty_teaching_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.faculty_teaching_requests FROM PUBLIC,anon,authenticated;

CREATE FUNCTION faculty_private.submit_request(p_delivery_group_id uuid,p_instructor_id uuid,p_hours numeric,p_notes text,
 p_assignment_id uuid DEFAULT NULL,p_expected_updated_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE h record; g public.delivery_groups%ROWTYPE; a public.teaching_assignments%ROWTYPE;
 v_term uuid;v_component_hours numeric;v_hours numeric;r public.faculty_teaching_requests%ROWTYPE;
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
 PERFORM validate_assignment_allocation_locked(g.id,p_assignment_id,v_hours,v_component_hours,true);
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
END $$;

CREATE FUNCTION public.decide_faculty_teaching_request(p_request_id uuid,p_decision text,p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.faculty_teaching_requests%ROWTYPE;h record;g public.delivery_groups%ROWTYPE;v_result jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(180600,1);
 SELECT * INTO r FROM faculty_teaching_requests WHERE id=p_request_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'REQUEST_NOT_FOUND'; END IF;
 IF p_decision NOT IN ('approved','rejected','cancelled') THEN RAISE EXCEPTION 'INVALID_REQUEST_DECISION'; END IF;
 IF (p_decision='cancelled' AND NOT can_manage_college(auth.uid(),r.college_id)) OR
    (p_decision<>'cancelled' AND NOT can_manage_college(auth.uid(),r.home_college_id)) THEN
  RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE='42501'; END IF;
 IF r.status<>'pending' THEN RAISE EXCEPTION 'REQUEST_ALREADY_DECIDED'; END IF;
 IF length(btrim(coalesce(p_note,'')))<3 THEN RAISE EXCEPTION 'REQUEST_DECISION_NOTE_REQUIRED'; END IF;
 IF p_decision='approved' THEN
  SELECT * INTO h FROM faculty_private.home_profiles WHERE identity_id=r.identity_id;
  IF h.home_college_id IS DISTINCT FROM r.home_college_id OR NOT coalesce(h.is_active,false) OR NOT EXISTS(
    SELECT 1 FROM faculty_identity_links WHERE instructor_id=r.instructor_id AND identity_id=r.identity_id)
    OR (r.assignment_id IS NULL AND h.source_instructor_id IS DISTINCT FROM r.instructor_id)
  THEN RAISE EXCEPTION 'REQUEST_FACULTY_CHANGED'; END IF;
  g:=lock_delivery_group_for_assignment(r.delivery_group_id);
  IF g.college_id IS DISTINCT FROM r.college_id OR NOT EXISTS(
    SELECT 1 FROM academic_cohorts c JOIN plan_course_components p ON p.id=g.component_id
    WHERE c.id=g.cohort_id AND c.term_id=r.term_id AND p.weekly_contact_hours=r.component_hours)
  THEN RAISE EXCEPTION 'REQUEST_CONTEXT_CHANGED'; END IF;
 END IF;
 UPDATE faculty_teaching_requests SET status=p_decision,decided_by=auth.uid(),decision_note=btrim(p_note),decided_at=now() WHERE id=r.id;
 IF p_decision='approved' THEN
  IF r.assignment_id IS NULL THEN
   v_result:=faculty_private.apply_create_assignment(r.delivery_group_id,r.instructor_id,r.assigned_hours,r.notes);
  ELSE
   v_result:=faculty_private.apply_update_assignment(r.assignment_id,r.expected_assignment_updated_at,r.assigned_hours,r.notes);
  END IF;
  UPDATE faculty_teaching_requests SET assignment_id=(v_result->>'assignment_id')::uuid WHERE id=r.id;
 END IF;
 INSERT INTO audit_logs(actor_id,action,entity,entity_id,college_id,details)
 VALUES(auth.uid(),'faculty_teaching_'||p_decision,'faculty_teaching_requests',r.id,r.college_id,jsonb_build_object('note',p_note));
 RETURN coalesce(v_result,jsonb_build_object('ok',true,'action',p_decision))||jsonb_build_object('request_id',r.id);
END $$;

CREATE OR REPLACE FUNCTION public.create_teaching_assignment_v2(p_delivery_group_id uuid,p_instructor_id uuid,
 p_assigned_component_hours numeric DEFAULT NULL,p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT faculty_private.submit_request(p_delivery_group_id,p_instructor_id,p_assigned_component_hours,p_notes)
$$;
CREATE OR REPLACE FUNCTION public.update_teaching_assignment_v2(p_assignment_id uuid,p_expected_updated_at timestamptz,
 p_assigned_component_hours numeric DEFAULT NULL,p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a public.teaching_assignments%ROWTYPE;
BEGIN
 SELECT * INTO a FROM teaching_assignments WHERE id=p_assignment_id;
 RETURN faculty_private.submit_request(a.delivery_group_id,a.instructor_id,coalesce(p_assigned_component_hours,a.assigned_component_hours),p_notes,a.id,p_expected_updated_at);
END $$;

-- Importers and direct writes also require an approved request. Existing rows remain intact.
CREATE FUNCTION faculty_private.guard_assignment_request() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp AS $$
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
 IF h.home_college_id IS NULL THEN RAISE EXCEPTION 'FACULTY_HOME_REVIEW_REQUIRED'; END IF;
 IF NEW.delivery_group_id IS NOT NULL AND EXISTS(
  SELECT 1 FROM teaching_assignments a JOIN faculty_identity_links l ON l.instructor_id=a.instructor_id
  WHERE a.delivery_group_id=NEW.delivery_group_id AND a.is_active AND a.id<>NEW.id AND l.identity_id=h.identity_id)
 THEN RAISE EXCEPTION 'DUPLICATE_FACULTY_ASSIGNMENT'; END IF;
 IF h.home_college_id=NEW.college_id THEN RETURN NEW; END IF;
 SELECT id INTO v_request FROM faculty_teaching_requests r WHERE r.identity_id=h.identity_id
 AND r.instructor_id=NEW.instructor_id AND r.home_college_id=h.home_college_id AND r.college_id=NEW.college_id
 AND r.delivery_group_id=NEW.delivery_group_id AND r.status='approved'
 AND r.assigned_hours=coalesce(NEW.assigned_component_hours,NEW.weekly_hours)
 AND (r.assignment_id IS NULL OR r.assignment_id=NEW.id)
 AND r.decided_by=auth.uid() AND r.decided_at=now() ORDER BY r.created_at DESC LIMIT 1;
 IF v_request IS NULL THEN RAISE EXCEPTION 'اعتماد التكليف من الكلية الأصلية مطلوب قبل الإسناد'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER zz_faculty_assignment_request BEFORE INSERT OR UPDATE ON public.teaching_assignments
 FOR EACH ROW EXECUTE FUNCTION faculty_private.guard_assignment_request();

CREATE FUNCTION public.list_faculty_teaching_requests(p_college_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT can_manage_college(auth.uid(),p_college_id) THEN RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'name',h.full_name,'university_number',h.university_number,
 'home_college',hc.name,'college',bc.name,'home_college_id',r.home_college_id,'college_id',r.college_id,
 'group',g.group_code,'hours',r.assigned_hours,'status',r.status,'term',t.name,'notes',r.notes,
 'created_at',r.created_at,'decision_note',r.decision_note,'is_update',r.assignment_id IS NOT NULL,
 'can_decide',can_manage_college(auth.uid(),r.home_college_id),'can_cancel',can_manage_college(auth.uid(),r.college_id))
 ORDER BY r.created_at DESC),'[]') INTO v
 FROM faculty_teaching_requests r JOIN faculty_private.home_profiles h ON h.identity_id=r.identity_id
 JOIN colleges hc ON hc.id=r.home_college_id JOIN colleges bc ON bc.id=r.college_id
 JOIN academic_terms t ON t.id=r.term_id JOIN delivery_groups g ON g.id=r.delivery_group_id
 WHERE r.college_id=p_college_id OR r.home_college_id=p_college_id;
 RETURN v;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA faculty_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.decide_faculty_teaching_request(uuid,text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.list_faculty_teaching_requests(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.decide_faculty_teaching_request(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_faculty_teaching_requests(uuid) TO authenticated;
