-- Natural assignment identity also covers inactive rows. Reuse an exact,
-- unreferenced inactive identity through the same scoped approval transaction;
-- never weaken either unique index or rewrite an assignment used by a version.
BEGIN;
DO $patch$
DECLARE d text:=pg_get_functiondef(
 'assignment_version_private.apply_replacement(uuid,uuid,uuid,numeric,uuid)'::regprocedure);
 old_text text; new_text text;
BEGIN
 old_text:='  v_component numeric;';
 new_text:='  v_component numeric;
  v_reuse public.teaching_assignments%ROWTYPE; v_reuse_before jsonb;';
 IF (length(d)-length(replace(d,old_text,'')))/length(old_text)<>1 THEN
  RAISE EXCEPTION 'SCOPED_REUSE_DECLARATION_DRIFT'; END IF;
 d:=replace(d,old_text,new_text);

 old_text:='  INSERT INTO assignment_version_private.scope
    (assignment_id, version_id, replaces_assignment_id, request_id, created_by)';
 new_text:='  SELECT * INTO v_reuse FROM public.teaching_assignments t
  WHERE t.college_id=v_old.college_id AND t.course_offering_id=v_old.course_offering_id
    AND t.instructor_id=p_instructor AND t.session_type=v_old.session_type
    AND coalesce(t.section_number,'''')=coalesce(v_old.section_number,'''') FOR UPDATE;
  IF FOUND THEN
    IF v_reuse.is_active IS DISTINCT FROM false
       OR v_reuse.delivery_group_id IS DISTINCT FROM v_old.delivery_group_id
       OR v_reuse.cohort_id IS DISTINCT FROM v_old.cohort_id
       OR v_reuse.plan_course_component_id IS DISTINCT FROM v_old.plan_course_component_id
       OR v_reuse.section_id IS DISTINCT FROM v_old.section_id
       OR v_reuse.expected_students IS DISTINCT FROM v_old.expected_students
       OR v_reuse.weekly_hours IS DISTINCT FROM v_old.weekly_hours
       OR v_reuse.assigned_component_hours IS DISTINCT FROM p_hours
       OR (v_reuse.required_room_type IS NOT NULL
           AND v_reuse.required_room_type IS DISTINCT FROM v_old.required_room_type)
       OR EXISTS(SELECT 1 FROM public.schedule_sessions WHERE teaching_assignment_id=v_reuse.id)
       OR EXISTS(SELECT 1 FROM assignment_version_private.scope
         WHERE assignment_id=v_reuse.id OR replaces_assignment_id=v_reuse.id)
       OR EXISTS(SELECT 1 FROM assignment_version_private.request_scope WHERE replaces_assignment_id=v_reuse.id)
       OR EXISTS(SELECT 1 FROM public.existing_schedule_source_rows WHERE teaching_assignment_id=v_reuse.id)
       OR EXISTS(SELECT 1 FROM schedule_version_delivery_private.instructor_hour_waivers
         WHERE assignment_id=v_reuse.id OR source_assignment_id=v_reuse.id)
       OR EXISTS(SELECT 1 FROM public.faculty_teaching_requests r WHERE r.assignment_id=v_reuse.id
         AND (r.status IS DISTINCT FROM ''approved'' OR r.instructor_id IS DISTINCT FROM p_instructor
           OR r.delivery_group_id IS DISTINCT FROM v_old.delivery_group_id
           OR r.college_id IS DISTINCT FROM v_old.college_id OR r.assigned_hours IS DISTINCT FROM p_hours))
    THEN RAISE EXCEPTION ''INACTIVE_ASSIGNMENT_NOT_REUSABLE'' USING ERRCODE=''23514''; END IF;
    v_new:=v_reuse.id;
    v_reuse_before:=to_jsonb(v_reuse);
  END IF;

  INSERT INTO assignment_version_private.scope
    (assignment_id, version_id, replaces_assignment_id, request_id, created_by)';
 IF (length(d)-length(replace(d,old_text,'')))/length(old_text)<>1 THEN
  RAISE EXCEPTION 'SCOPED_REUSE_SCOPE_DRIFT'; END IF;
 d:=replace(d,old_text,new_text);

 old_text:='  INSERT INTO public.teaching_assignments
    (id, college_id, course_offering_id, instructor_id, section_number, session_type,';
 new_text:='  IF v_reuse_before IS NOT NULL THEN
    UPDATE public.teaching_assignments
    SET is_active=true, required_room_type=v_old.required_room_type
    WHERE id=v_new AND is_active=false;
    IF NOT FOUND THEN RAISE EXCEPTION ''INACTIVE_ASSIGNMENT_REUSE_DRIFT'' USING ERRCODE=''23514''; END IF;
  ELSE
  INSERT INTO public.teaching_assignments
    (id, college_id, course_offering_id, instructor_id, section_number, session_type,';
 IF (length(d)-length(replace(d,old_text,'')))/length(old_text)<>1 THEN
  RAISE EXCEPTION 'SCOPED_REUSE_WRITE_DRIFT'; END IF;
 d:=replace(d,old_text,new_text);
 old_text:='     v_old.delivery_group_id, p_hours, true);';
 new_text:=old_text||E'\n  END IF;';
 IF (length(d)-length(replace(d,old_text,'')))/length(old_text)<>1 THEN
  RAISE EXCEPTION 'SCOPED_REUSE_WRITE_END_DRIFT'; END IF;
 d:=replace(d,old_text,new_text);

 old_text:='''request_id'', p_request_id, ''draft_sessions_relinked'', v_after, ''historical_hash'', v_hist_b';
 new_text:=old_text||', ''reused_inactive_assignment'', v_reuse_before IS NOT NULL,
      ''inactive_assignment_before'', v_reuse_before';
 IF (length(d)-length(replace(d,old_text,'')))/length(old_text)<>1 THEN
  RAISE EXCEPTION 'SCOPED_REUSE_AUDIT_DRIFT'; END IF;
 EXECUTE replace(d,old_text,new_text);
END $patch$;
COMMIT;
