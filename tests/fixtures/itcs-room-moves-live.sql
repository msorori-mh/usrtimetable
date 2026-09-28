CREATE OR REPLACE FUNCTION public.schedule_version_session_snapshot(p_version uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT md5(coalesce(string_agg(concat_ws('|', s.id, s.teaching_assignment_id, s.instructor_id,
           s.day_of_week, s.start_time, s.end_time, s.room_id, s.delivery_group_id,
           s.cohort_id, s.schedule_version_id), E'\n' ORDER BY s.id), ''))
  FROM public.schedule_sessions s WHERE s.schedule_version_id = p_version
$function$;

CREATE OR REPLACE FUNCTION public.preview_version_session_moves(p_version uuid, p_manifest jsonb)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH m AS (SELECT (x->>'session_id')::uuid id, (x->>'day_of_week')::smallint d,
                    (x->>'start_time')::time st, (x->>'end_time')::time et, (x->>'room_id')::uuid r
             FROM jsonb_array_elements(p_manifest) x)
  SELECT md5(coalesce(string_agg(concat_ws('|', s.id, s.teaching_assignment_id, s.instructor_id,
           coalesce(m.d, s.day_of_week), coalesce(m.st, s.start_time), coalesce(m.et, s.end_time),
           CASE WHEN m.id IS NULL THEN s.room_id ELSE m.r END, s.delivery_group_id,
           s.cohort_id, s.schedule_version_id), E'\n' ORDER BY s.id), ''))
  FROM public.schedule_sessions s LEFT JOIN m ON m.id = s.id
  WHERE s.schedule_version_id = p_version
$function$;

CREATE OR REPLACE FUNCTION public.apply_version_session_moves(p_version uuid, p_manifest jsonb, p_expected_count integer, p_expected_before text, p_expected_after text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_manifest) x JOIN public.schedule_sessions s
             ON s.id = (x->>'session_id')::uuid WHERE s.is_locked) THEN
    RAISE EXCEPTION 'MOVE_LOCKED_SESSION' USING ERRCODE = 'check_violation'; END IF;
  -- Ordinary UPDATE: live session triggers (room, college, coordination) fire.
  UPDATE public.schedule_sessions s
  SET day_of_week = (x->>'day_of_week')::smallint, start_time = (x->>'start_time')::time,
      end_time = (x->>'end_time')::time, room_id = (x->>'room_id')::uuid
  FROM jsonb_array_elements(p_manifest) x
  WHERE s.id = (x->>'session_id')::uuid AND s.schedule_version_id = p_version;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  SET CONSTRAINTS public.coordination_sessions_final, public.instructor_daily_session_cap_final IMMEDIATE;
  SET CONSTRAINTS public.coordination_sessions_final, public.instructor_daily_session_cap_final DEFERRED;
  v_after := public.schedule_version_session_snapshot(p_version);
  IF v_n <> p_expected_count OR v_after <> p_expected_after THEN
    RAISE EXCEPTION 'MOVE_AFTER_SNAPSHOT_MISMATCH' USING ERRCODE = 'check_violation'; END IF;
  INSERT INTO assignment_version_private.move_receipts VALUES (p_version, p_expected_before, v_after, v_n, v_uid);
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (v_uid, 'version_session_moves', 'schedule_versions', p_version, v_ver.college_id,
    jsonb_build_object('moved', v_n, 'before', p_expected_before, 'after', v_after));
  RETURN jsonb_build_object('ok', true, 'moved', v_n, 'after_snapshot', v_after);
END $function$;

CREATE OR REPLACE FUNCTION public.seal_version_publish_expectation(p_version uuid, p_expected_sessions integer, p_expected_snapshot text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_col uuid; v_n int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501'; END IF;
  SELECT college_id INTO v_col FROM public.schedule_versions WHERE id = p_version AND status = 'draft' FOR UPDATE;
  IF v_col IS NULL OR NOT public.can_manage_college(v_uid, v_col) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  SELECT count(*) INTO v_n FROM public.schedule_sessions WHERE schedule_version_id = p_version;
  IF v_n <> p_expected_sessions OR public.schedule_version_session_snapshot(p_version) <> p_expected_snapshot THEN
    RAISE EXCEPTION 'SEAL_SNAPSHOT_MISMATCH' USING ERRCODE = 'check_violation'; END IF;
  INSERT INTO assignment_version_private.publish_expectation VALUES (p_version, v_n, p_expected_snapshot, v_uid)
  ON CONFLICT (version_id) DO UPDATE SET expected_sessions = EXCLUDED.expected_sessions,
    expected_snapshot = EXCLUDED.expected_snapshot, set_by = EXCLUDED.set_by, set_at = now();
  RETURN jsonb_build_object('ok', true, 'sessions', v_n);
END $function$;

CREATE OR REPLACE FUNCTION public.is_assignment_room_compatible(p_college_id uuid, p_teaching_assignment_id uuid, p_room_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case
    when p_teaching_assignment_id is null or p_room_id is null then true
    when ta.required_room_type is null then true
    when r.room_type = ta.required_room_type then true
    when pcc.component_type = 'practical'
         and lower(btrim(ta.required_room_type)) = 'computer_lab'
         and lower(btrim(r.room_type)) = 'lecture_hall' then true
    else false
  end
  from public.teaching_assignments ta
  join public.rooms r
    on r.id = p_room_id
   and r.college_id = p_college_id
  left join public.plan_course_components pcc
    on pcc.id = ta.plan_course_component_id
  where ta.id = p_teaching_assignment_id
    and ta.college_id = p_college_id;
$function$;
