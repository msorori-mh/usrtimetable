CREATE FUNCTION public.version_effective_assignments(p_version uuid)
RETURNS TABLE (assignment_id uuid, delivery_group_id uuid, college_id uuid, assigned_component_hours numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT ta.id, ta.delivery_group_id, ta.college_id, ta.assigned_component_hours
  FROM public.teaching_assignments ta
  WHERE ta.is_active
    AND (EXISTS (SELECT 1 FROM assignment_version_private.scope s
                 WHERE s.assignment_id = ta.id AND s.version_id = p_version)
      OR (NOT EXISTS (SELECT 1 FROM assignment_version_private.scope s WHERE s.assignment_id = ta.id)
          AND NOT EXISTS (SELECT 1 FROM assignment_version_private.scope s
                          WHERE s.replaces_assignment_id = ta.id AND s.version_id = p_version)))
$$;

CREATE FUNCTION public.validate_version_assignment_allocation(
  p_version uuid, p_delivery_group_id uuid, p_component_hours numeric)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_count integer; v_nulls integer; v_sum numeric;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE e.assigned_component_hours IS NULL),
         coalesce(sum(e.assigned_component_hours), 0)
    INTO v_count, v_nulls, v_sum
  FROM public.version_effective_assignments(p_version) e
  WHERE e.delivery_group_id = p_delivery_group_id;
  IF v_count > 1 AND v_nulls > 0 THEN
    RAISE EXCEPTION 'VERSION_CO_TEACHING_HOURS_SPLIT_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;
  IF p_component_hours IS NOT NULL AND v_sum > p_component_hours THEN
    RAISE EXCEPTION 'VERSION_CO_TEACHING_HOURS_OVER_ALLOCATED' USING ERRCODE = 'check_violation';
  END IF;
END $$;

CREATE FUNCTION public.schedule_version_session_snapshot(p_version uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT md5(coalesce(string_agg(concat_ws('|', s.id, s.teaching_assignment_id, s.instructor_id,
           s.day_of_week, s.start_time, s.end_time, s.room_id, s.delivery_group_id,
           s.cohort_id, s.schedule_version_id), E'\n' ORDER BY s.id), ''))
  FROM public.schedule_sessions s WHERE s.schedule_version_id = p_version
$$;

CREATE FUNCTION assignment_version_private.apply_replacement(
  p_version uuid, p_replaces uuid, p_instructor uuid, p_hours numeric, p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid(); v_ver public.schedule_versions%ROWTYPE;
  v_old public.teaching_assignments%ROWTYPE; v_new uuid := gen_random_uuid();
  v_before int; v_after int; v_hist_b text; v_hist_a text; v_fix_b text; v_fix_a text;
  v_component numeric;
BEGIN
  SELECT * INTO v_ver FROM public.schedule_versions WHERE id = p_version FOR UPDATE;
  IF NOT FOUND OR v_ver.status <> 'draft' THEN
    RAISE EXCEPTION 'VERSION_NOT_DRAFT' USING ERRCODE = 'check_violation'; END IF;
  SELECT * INTO v_old FROM public.teaching_assignments WHERE id = p_replaces FOR UPDATE;
  IF NOT FOUND OR NOT v_old.is_active OR v_old.college_id <> v_ver.college_id THEN
    RAISE EXCEPTION 'REPLACED_ASSIGNMENT_INVALID' USING ERRCODE = 'check_violation'; END IF;
  IF EXISTS (SELECT 1 FROM assignment_version_private.scope WHERE assignment_id = p_replaces) THEN
    RAISE EXCEPTION 'REPLACED_ASSIGNMENT_IS_VERSION_SCOPED' USING ERRCODE = 'check_violation'; END IF;
  IF EXISTS (SELECT 1 FROM assignment_version_private.scope
             WHERE version_id = p_version AND replaces_assignment_id = p_replaces) THEN
    RAISE EXCEPTION 'ASSIGNMENT_ALREADY_REPLACED_IN_VERSION' USING ERRCODE = 'unique_violation'; END IF;
  SELECT count(*) INTO v_before FROM public.schedule_sessions
  WHERE schedule_version_id = p_version AND teaching_assignment_id = p_replaces;
  IF v_before = 0 THEN
    RAISE EXCEPTION 'REPLACED_ASSIGNMENT_NOT_IN_VERSION' USING ERRCODE = 'check_violation'; END IF;

  SELECT md5(coalesce(string_agg(concat_ws('|', s.id, s.schedule_version_id, s.teaching_assignment_id,
      s.instructor_id, s.day_of_week, s.start_time, s.end_time, s.room_id, s.delivery_group_id),
      E'\n' ORDER BY s.id), '')) INTO v_hist_b FROM public.schedule_sessions s
  WHERE s.teaching_assignment_id = p_replaces AND s.schedule_version_id <> p_version;
  SELECT md5(coalesce(string_agg(concat_ws('|', s.id, s.day_of_week, s.start_time, s.end_time,
      s.room_id, s.delivery_group_id, s.cohort_id), E'\n' ORDER BY s.id), '')) INTO v_fix_b
  FROM public.schedule_sessions s WHERE s.schedule_version_id = p_version AND s.teaching_assignment_id = p_replaces;

  INSERT INTO assignment_version_private.scope
    (assignment_id, version_id, replaces_assignment_id, request_id, created_by)
  VALUES (v_new, p_version, p_replaces, p_request_id, v_uid);
  PERFORM set_config('app.version_scoped_pending_assignment', v_new::text, true);
  -- All live triggers on teaching_assignments fire here, including
  -- faculty_private.guard_assignment_request.
  INSERT INTO public.teaching_assignments
    (id, college_id, course_offering_id, instructor_id, section_number, session_type,
     weekly_hours, required_room_type, notes, expected_students, section_id, cohort_id,
     plan_course_component_id, delivery_group_id, assigned_component_hours, is_active)
  VALUES (v_new, v_old.college_id, v_old.course_offering_id, p_instructor, v_old.section_number,
     v_old.session_type, v_old.weekly_hours, v_old.required_room_type,
     concat_ws(' ', v_old.notes, '[version-scoped ' || p_version || ']'),
     v_old.expected_students, v_old.section_id, v_old.cohort_id, v_old.plan_course_component_id,
     v_old.delivery_group_id, p_hours, true);
  PERFORM set_config('app.version_scoped_pending_assignment', '', true);

  SELECT c.weekly_contact_hours INTO v_component FROM public.plan_course_components c
  WHERE c.id = v_old.plan_course_component_id;
  PERFORM public.validate_version_assignment_allocation(p_version, v_old.delivery_group_id, v_component);

  UPDATE public.schedule_sessions SET teaching_assignment_id = v_new, instructor_id = p_instructor
  WHERE schedule_version_id = p_version AND teaching_assignment_id = p_replaces;
  GET DIAGNOSTICS v_after = ROW_COUNT;

  SELECT md5(coalesce(string_agg(concat_ws('|', s.id, s.schedule_version_id, s.teaching_assignment_id,
      s.instructor_id, s.day_of_week, s.start_time, s.end_time, s.room_id, s.delivery_group_id),
      E'\n' ORDER BY s.id), '')) INTO v_hist_a FROM public.schedule_sessions s
  WHERE s.teaching_assignment_id = p_replaces AND s.schedule_version_id <> p_version;
  SELECT md5(coalesce(string_agg(concat_ws('|', s.id, s.day_of_week, s.start_time, s.end_time,
      s.room_id, s.delivery_group_id, s.cohort_id), E'\n' ORDER BY s.id), '')) INTO v_fix_a
  FROM public.schedule_sessions s WHERE s.schedule_version_id = p_version AND s.teaching_assignment_id = v_new;
  IF v_after <> v_before OR v_hist_a IS DISTINCT FROM v_hist_b OR v_fix_a IS DISTINCT FROM v_fix_b
     OR NOT EXISTS (SELECT 1 FROM public.teaching_assignments WHERE id = p_replaces AND is_active) THEN
    RAISE EXCEPTION 'VERSION_SCOPED_REPLACEMENT_INVARIANT_VIOLATION' USING ERRCODE = 'check_violation'; END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (v_uid, 'version_scoped_assignment_replacement', 'teaching_assignments', v_new, v_ver.college_id,
    jsonb_build_object('version_id', p_version, 'old_assignment_id', p_replaces, 'new_assignment_id', v_new,
      'request_id', p_request_id, 'draft_sessions_relinked', v_after, 'historical_hash', v_hist_b));
  RETURN jsonb_build_object('ok', true, 'action', 'version_scoped_created', 'assignment_id', v_new,
    'old_assignment_id', p_replaces, 'draft_sessions_relinked', v_after);
END $$;

CREATE FUNCTION public.preview_version_session_moves(p_version uuid, p_manifest jsonb)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH m AS (SELECT (x->>'session_id')::uuid id, (x->>'day_of_week')::smallint d,
                    (x->>'start_time')::time st, (x->>'end_time')::time et, (x->>'room_id')::uuid r
             FROM jsonb_array_elements(p_manifest) x)
  SELECT md5(coalesce(string_agg(concat_ws('|', s.id, s.teaching_assignment_id, s.instructor_id,
           coalesce(m.d, s.day_of_week), coalesce(m.st, s.start_time), coalesce(m.et, s.end_time),
           CASE WHEN m.id IS NULL THEN s.room_id ELSE m.r END, s.delivery_group_id,
           s.cohort_id, s.schedule_version_id), E'\n' ORDER BY s.id), ''))
  FROM public.schedule_sessions s LEFT JOIN m ON m.id = s.id
  WHERE s.schedule_version_id = p_version
$$;

CREATE FUNCTION public.apply_version_session_moves(
  p_version uuid, p_manifest jsonb, p_expected_count integer,
  p_expected_before text, p_expected_after text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_ver public.schedule_versions%ROWTYPE; v_n int; v_after text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_ver FROM public.schedule_versions WHERE id = p_version FOR UPDATE;
  IF NOT FOUND OR v_ver.status <> 'draft' THEN
    RAISE EXCEPTION 'VERSION_NOT_DRAFT' USING ERRCODE = 'check_violation'; END IF;
  IF NOT public.can_manage_college(v_uid, v_ver.college_id) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF jsonb_array_length(p_manifest) <> p_expected_count
     OR (SELECT count(DISTINCT x->>'session_id') FROM jsonb_array_elements(p_manifest) x) <> p_expected_count
     OR (SELECT count(*) FROM jsonb_array_elements(p_manifest) x JOIN public.schedule_sessions s
         ON s.id = (x->>'session_id')::uuid AND s.schedule_version_id = p_version) <> p_expected_count THEN
    RAISE EXCEPTION 'MOVE_MANIFEST_INVALID' USING ERRCODE = 'check_violation'; END IF;
  IF public.schedule_version_session_snapshot(p_version) <> p_expected_before THEN
    RAISE EXCEPTION 'MOVE_BEFORE_SNAPSHOT_MISMATCH' USING ERRCODE = 'check_violation'; END IF;
  IF public.preview_version_session_moves(p_version, p_manifest) <> p_expected_after THEN
    RAISE EXCEPTION 'MOVE_MANIFEST_AFTER_MISMATCH' USING ERRCODE = 'check_violation'; END IF;
  -- Ordinary UPDATE: live session triggers (room, college, coordination) fire.
  UPDATE public.schedule_sessions s
  SET day_of_week = (x->>'day_of_week')::smallint, start_time = (x->>'start_time')::time,
      end_time = (x->>'end_time')::time, room_id = (x->>'room_id')::uuid
  FROM jsonb_array_elements(p_manifest) x
  WHERE s.id = (x->>'session_id')::uuid AND s.schedule_version_id = p_version;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_after := public.schedule_version_session_snapshot(p_version);
  IF v_n <> p_expected_count OR v_after <> p_expected_after THEN
    RAISE EXCEPTION 'MOVE_AFTER_SNAPSHOT_MISMATCH' USING ERRCODE = 'check_violation'; END IF;
  INSERT INTO assignment_version_private.move_receipts VALUES (p_version, p_expected_before, v_after, v_n, v_uid);
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (v_uid, 'version_session_moves', 'schedule_versions', p_version, v_ver.college_id,
    jsonb_build_object('moved', v_n, 'before', p_expected_before, 'after', v_after));
  RETURN jsonb_build_object('ok', true, 'moved', v_n, 'after_snapshot', v_after);
END $$;
