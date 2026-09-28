-- Keep the one-instructor rule version-specific and transactionally enforced
-- while approving both groups of a cohort through the official decision RPC.
BEGIN;
CREATE TABLE assignment_version_private.revision4_original_defs (
 signature text PRIMARY KEY, definition text NOT NULL);
REVOKE ALL ON assignment_version_private.revision4_original_defs FROM PUBLIC;
INSERT INTO assignment_version_private.revision4_original_defs
SELECT s,pg_get_functiondef(s::regprocedure) FROM unnest(ARRAY[
 'faculty_private.assert_cohort_component_single_instructor(uuid,uuid,uuid)',
 'public.get_cohort_component_instructor_readiness(uuid,uuid)',
 'public._ss_cohort_component_instructor(uuid,uuid)',
 'public.list_teaching_assignment_workspace(uuid,uuid,uuid,uuid,text,uuid,text,text)',
 'assignment_version_private.apply_replacement(uuid,uuid,uuid,numeric,uuid)',
 'public.guard_version_scoped_publish()',
 'public.itcs_cutover_execute(text,uuid,uuid,jsonb,text,text)']) s;

CREATE FUNCTION assignment_version_private.patch_revision4(sig text, old_text text, new_text text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE d text:=pg_get_functiondef(sig::regprocedure); n integer;
BEGIN
 n:=(length(d)-length(replace(d,old_text,'')))/length(old_text);
 IF n<>1 THEN RAISE EXCEPTION 'LIVE_FUNCTION_DRIFT %: %',sig,n; END IF;
 EXECUTE replace(d,old_text,new_text);
END $$;

CREATE FUNCTION assignment_version_private.assert_version_instructors(p_version uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
 IF EXISTS (
  SELECT s.cohort_id,dg.plan_course_id,c.component_type
  FROM public.schedule_sessions s
  JOIN public.delivery_groups dg ON dg.id=s.delivery_group_id
  JOIN public.plan_course_components c ON c.id=dg.component_id
  LEFT JOIN public.faculty_identity_links f ON f.instructor_id=s.instructor_id
  WHERE s.schedule_version_id=p_version AND c.component_type IN ('theory','practical')
  GROUP BY s.cohort_id,dg.plan_course_id,c.component_type
  HAVING count(DISTINCT dg.id)>=2
    AND (count(DISTINCT f.identity_id)>1 OR bool_or(f.identity_id IS NULL))
 ) THEN RAISE EXCEPTION 'VERSION_COHORT_COMPONENT_SINGLE_INSTRUCTOR_REQUIRED' USING ERRCODE='23514'; END IF;
END $$;
REVOKE ALL ON FUNCTION assignment_version_private.assert_version_instructors(uuid) FROM PUBLIC;

CREATE FUNCTION assignment_version_private.check_scoped_instructors_final()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v uuid;
BEGIN
 FOR v IN SELECT sc.version_id FROM assignment_version_private.scope sc
   WHERE sc.assignment_id=NEW.id LOOP
  PERFORM assignment_version_private.assert_version_instructors(v);
 END LOOP;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION assignment_version_private.check_scoped_instructors_final() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER scoped_cohort_instructors_final
AFTER INSERT OR UPDATE ON public.teaching_assignments DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION assignment_version_private.check_scoped_instructors_final();

-- Only a registered scoped writer uses the deferred version-specific check.
-- Ordinary writes retain the original immediate validation of counted rows.
SELECT assignment_version_private.patch_revision4(
 'faculty_private.assert_cohort_component_single_instructor(uuid,uuid,uuid)',
 'BEGIN
  IF p_delivery_group_id IS NULL',
 'BEGIN
  IF p_exclude_assignment_id::text = nullif(current_setting(''app.version_scoped_pending_assignment'',true),'''')
     AND EXISTS (SELECT 1 FROM assignment_version_private.scope sc
       JOIN assignment_version_private.enabled_versions en ON en.version_id=sc.version_id
       JOIN public.schedule_versions sv ON sv.id=sc.version_id AND sv.status=''draft''
       JOIN public.teaching_assignments old ON old.id=sc.replaces_assignment_id
       WHERE sc.assignment_id=p_exclude_assignment_id AND sc.created_by=auth.uid()
         AND old.delivery_group_id=p_delivery_group_id) THEN
    -- scoped_cohort_instructors_final rejects a mixed final cohort at COMMIT.
    RETURN;
  END IF;
  IF p_delivery_group_id IS NULL');
SELECT assignment_version_private.patch_revision4(
 'faculty_private.assert_cohort_component_single_instructor(uuid,uuid,uuid)',
 '    AND ta.id IS DISTINCT FROM p_exclude_assignment_id',
 '    AND ta.id IS DISTINCT FROM p_exclude_assignment_id
    AND assignment_version_private.is_counted(ta.id)');
SELECT assignment_version_private.patch_revision4(
 'public.get_cohort_component_instructor_readiness(uuid,uuid)',
 'ON ta.delivery_group_id = dg.id AND ta.is_active = true',
 'ON ta.delivery_group_id = dg.id AND ta.is_active = true
      AND CASE WHEN p_schedule_version_id IS NULL THEN assignment_version_private.is_counted(ta.id)
        ELSE EXISTS (SELECT 1 FROM public.version_effective_assignments(p_schedule_version_id) e
          WHERE e.assignment_id=ta.id) END');
SELECT assignment_version_private.patch_revision4(
 'public.list_teaching_assignment_workspace(uuid,uuid,uuid,uuid,text,uuid,text,text)',
 '    WHERE ta.is_active = true',
 '    WHERE ta.is_active = true AND assignment_version_private.is_counted(ta.id)');
SELECT assignment_version_private.patch_revision4(
 'public._ss_cohort_component_instructor(uuid,uuid)',
 '  v_cohort_id uuid;',
 '  v_cohort_id uuid;
  v_version uuid := coalesce(
    (SELECT schedule_version_id FROM public.schedule_sessions WHERE id=p_session_id),
    (SELECT version_id FROM assignment_version_private.scope WHERE assignment_id=p_teaching_assignment_id));');
SELECT assignment_version_private.patch_revision4(
 'public._ss_cohort_component_instructor(uuid,uuid)',
 'ON ta.delivery_group_id = dg.id AND ta.is_active = true',
 'ON ta.delivery_group_id = dg.id AND ta.is_active = true
    AND CASE WHEN v_version IS NULL THEN assignment_version_private.is_counted(ta.id)
      ELSE EXISTS (SELECT 1 FROM public.version_effective_assignments(v_version) e
        WHERE e.assignment_id=ta.id) END');

-- The decision already exists in this transaction. Link its new assignment
-- before relinking sessions so the existing session-college guard can verify it.
SELECT assignment_version_private.patch_revision4(
 'assignment_version_private.apply_replacement(uuid,uuid,uuid,numeric,uuid)',
 '  UPDATE public.schedule_sessions SET teaching_assignment_id = v_new, instructor_id = p_instructor',
 '  IF p_request_id IS NOT NULL THEN
    UPDATE public.faculty_teaching_requests r SET assignment_id=v_new
    WHERE r.id=p_request_id AND r.status=''approved'' AND r.decided_by=v_uid AND r.decided_at=now()
      AND r.assignment_id IS NULL AND r.instructor_id=p_instructor
      AND r.delivery_group_id=v_old.delivery_group_id AND r.college_id=v_ver.college_id
      AND r.assigned_hours=p_hours AND EXISTS (SELECT 1 FROM assignment_version_private.request_scope rs
        WHERE rs.request_id=r.id AND rs.version_id=p_version AND rs.replaces_assignment_id=p_replaces);
    IF NOT FOUND THEN RAISE EXCEPTION ''SCOPED_APPROVAL_LINK_INVALID'' USING ERRCODE=''23514''; END IF;
  END IF;
  UPDATE public.schedule_sessions SET teaching_assignment_id = v_new, instructor_id = p_instructor');
SELECT assignment_version_private.patch_revision4(
 'public.guard_version_scoped_publish()',
 '    PERFORM assignment_version_private.assert_projected_load(NEW.id);',
 '    PERFORM assignment_version_private.assert_version_instructors(NEW.id);
    PERFORM assignment_version_private.assert_projected_load(NEW.id);');

-- One authenticated action decides the entire bound batch, retaining the
-- official home-college permission checks and approval records for each item.
SELECT assignment_version_private.patch_revision4(
 'public.itcs_cutover_execute(text,uuid,uuid,jsonb,text,text)',
 'IF p_stage NOT IN (''requests'', ''apply'', ''publish'')',
 'IF p_stage NOT IN (''requests'', ''approve'', ''apply'', ''publish'')');
SELECT assignment_version_private.patch_revision4(
 'public.itcs_cutover_execute(text,uuid,uuid,jsonb,text,text)',
 '  -- ------------------------------------------------------------ apply',
 '  IF p_stage=''approve'' THEN
    FOR z IN SELECT rs.* FROM itcs_cutover_private.replacement_status(p_version,p_manifest) rs
      JOIN public.teaching_assignments old ON old.id=rs.replaces
      ORDER BY CASE WHEN old.instructor_id=''4b2bc566-8799-4501-9ff7-b9d8fa641546''::uuid THEN 0 ELSE 1 END,rs.replaces LOOP
      IF z.state=''awaiting_home_decision'' THEN
        v_out:=v_out||public.decide_faculty_teaching_request(z.scoped_request,''approved'',
          ''اعتماد التوزيع المتكامل بطلب المستخدم؛ ''||p_manifest_sha);
      ELSIF z.state<>''applied'' THEN
        RAISE EXCEPTION ''SCOPED_REQUESTS_REQUIRED_BEFORE_DECISION: %'',z.state USING ERRCODE=''23514'';
      END IF;
    END LOOP;
    SET CONSTRAINTS public.scoped_cohort_instructors_final IMMEDIATE;
    SET CONSTRAINTS public.scoped_cohort_instructors_final DEFERRED;
    PERFORM assignment_version_private.assert_version_instructors(p_version);
    PERFORM itcs_cutover_private.assert_history(p_manifest);
    INSERT INTO public.audit_logs(actor_id,action,entity,entity_id,college_id,details)
    VALUES(v_uid,''itcs_cutover_assignment_decisions'',''schedule_versions'',p_version,v_ver.college_id,
      jsonb_build_object(''manifest_sha'',p_manifest_sha,''decisions'',v_out));
    -- Keep lecturer decisions and placements in the same transaction: old
    -- slots may clash for the new lecturer until the target moves are applied.
    v_prev:=public.itcs_cutover_preview(p_version,p_manifest);
    p_stage:=''apply'';
  END IF;

  -- ------------------------------------------------------------ apply');
DROP FUNCTION assignment_version_private.patch_revision4(text,text,text);
COMMIT;
