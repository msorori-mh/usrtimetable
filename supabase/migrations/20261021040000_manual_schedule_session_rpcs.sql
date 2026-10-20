-- H-6 / M-19 (track C): the legacy timetable editor writes through server RPCs only.
--
-- * public.preview_manual_schedule_session(session, payload)  read-only conflict preview.
-- * public.save_manual_schedule_session(session, expected_updated_at, payload)
--     create (session NULL; payload.schedule_version_id required) or full edit of a session.
--     Whitelisted fields only, optimistic concurrency on updated_at, authoritative collector
--     (public._ss_gather via _collect_schedule_session_move_conflicts) plus the membership-aware
--     student overlap; raises SCHEDULE_HARD_CONFLICTS with the conflict list as JSON in DETAIL.
-- * public.delete_schedule_session(session, expected_updated_at)  (contract with other tracks)
--     checks college, version lock, session lock and updated_at, and writes an audit row.
-- Moves keep using public.move_or_reschedule_schedule_session.
BEGIN;

CREATE OR REPLACE FUNCTION public._sv_manual_session_evaluate(p_session_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_old public.schedule_sessions%ROWTYPE;
  v_new public.schedule_sessions%ROWTYPE;
  v_ver public.schedule_versions%ROWTYPE;
  v_ta_college uuid; v_ta_active boolean; v_ta_offering uuid; v_ta_instructor uuid;
  v_ta_dg uuid; v_ta_cohort uuid; v_ta_component uuid;
  v_off_college uuid; v_off_term uuid;
  v_p jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_bundle jsonb;
  v_dg jsonb := '[]'::jsonb;
  v_class jsonb;
  v_key text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(v_p) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'INVALID_SESSION_PAYLOAD' USING ERRCODE = '22023';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(v_p) LOOP
    IF v_key NOT IN ('schedule_version_id', 'course_offering_id', 'teaching_assignment_id',
      'instructor_id', 'room_id', 'section_id', 'section_group_id', 'study_system',
      'day_of_week', 'start_time', 'end_time', 'session_type', 'expected_students',
      'is_locked', 'lock_reason') THEN
      RAISE EXCEPTION 'SESSION_FIELD_NOT_ALLOWED:%', v_key USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF p_session_id IS NOT NULL THEN
    SELECT * INTO v_old FROM public.schedule_sessions WHERE id = p_session_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
    IF v_p ? 'schedule_version_id'
       AND (v_p->>'schedule_version_id')::uuid IS DISTINCT FROM v_old.schedule_version_id THEN
      RAISE EXCEPTION 'SESSION_VERSION_IMMUTABLE' USING ERRCODE = '22023';
    END IF;
    v_new := v_old;
  ELSE
    v_new.id := gen_random_uuid();
    v_new.schedule_version_id := (v_p->>'schedule_version_id')::uuid;
    v_new.study_system := 'regular';
    v_new.session_type := 'lecture';
    v_new.expected_students := 0;
    v_new.is_locked := false;
    v_new.source_type := 'manual';
    v_new.replaced_by_split := false;
  END IF;

  SELECT * INTO v_ver FROM public.schedule_versions WHERE id = v_new.schedule_version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'SCHEDULE_VERSION_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.can_manage_college(v_uid, v_ver.college_id) THEN
    RAISE EXCEPTION 'SCHEDULE_SESSION_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF v_ver.status NOT IN ('draft', 'review') THEN
    RAISE EXCEPTION 'VERSION_LOCKED:%', v_ver.status USING ERRCODE = '23514';
  END IF;
  v_new.college_id := v_ver.college_id;

  IF v_p ? 'course_offering_id' THEN v_new.course_offering_id := (v_p->>'course_offering_id')::uuid; END IF;
  IF v_p ? 'teaching_assignment_id' THEN v_new.teaching_assignment_id := NULLIF(v_p->>'teaching_assignment_id', '')::uuid; END IF;
  IF v_p ? 'instructor_id' THEN v_new.instructor_id := (v_p->>'instructor_id')::uuid; END IF;
  IF v_p ? 'room_id' THEN v_new.room_id := NULLIF(v_p->>'room_id', '')::uuid; END IF;
  IF v_p ? 'section_id' THEN v_new.section_id := NULLIF(v_p->>'section_id', '')::uuid; END IF;
  IF v_p ? 'section_group_id' THEN v_new.section_group_id := NULLIF(v_p->>'section_group_id', '')::uuid; END IF;
  IF v_p ? 'study_system' THEN v_new.study_system := v_p->>'study_system'; END IF;
  IF v_p ? 'day_of_week' THEN v_new.day_of_week := (v_p->>'day_of_week')::smallint; END IF;
  IF v_p ? 'start_time' THEN v_new.start_time := (v_p->>'start_time')::time; END IF;
  IF v_p ? 'end_time' THEN v_new.end_time := (v_p->>'end_time')::time; END IF;
  IF v_p ? 'session_type' THEN v_new.session_type := v_p->>'session_type'; END IF;
  IF v_p ? 'expected_students' THEN v_new.expected_students := COALESCE((v_p->>'expected_students')::integer, 0); END IF;
  IF v_p ? 'is_locked' THEN v_new.is_locked := COALESCE((v_p->>'is_locked')::boolean, false); END IF;
  IF v_p ? 'lock_reason' THEN v_new.lock_reason := NULLIF(btrim(v_p->>'lock_reason'), ''); END IF;
  IF NOT v_new.is_locked THEN v_new.lock_reason := NULL; END IF;

  IF v_new.course_offering_id IS NULL OR v_new.instructor_id IS NULL
     OR v_new.day_of_week IS NULL OR v_new.start_time IS NULL OR v_new.end_time IS NULL THEN
    RAISE EXCEPTION 'SESSION_REQUIRED_FIELDS' USING ERRCODE = '22023';
  END IF;
  IF v_new.day_of_week NOT BETWEEN 0 AND 6 OR v_new.end_time <= v_new.start_time THEN
    RAISE EXCEPTION 'INVALID_SESSION_TIME' USING ERRCODE = '22023';
  END IF;
  IF v_new.study_system NOT IN ('regular', 'parallel', 'both') THEN
    RAISE EXCEPTION 'INVALID_STUDY_SYSTEM' USING ERRCODE = '22023';
  END IF;
  IF v_new.expected_students < 0 THEN RAISE EXCEPTION 'INVALID_EXPECTED_STUDENTS' USING ERRCODE = '22023'; END IF;

  SELECT o.college_id, o.term_id INTO v_off_college, v_off_term
  FROM public.course_offerings o WHERE o.id = v_new.course_offering_id;
  IF v_off_college IS DISTINCT FROM v_ver.college_id OR v_off_term IS DISTINCT FROM v_ver.academic_term_id THEN
    RAISE EXCEPTION 'OFFERING_SCOPE_MISMATCH' USING ERRCODE = '23514';
  END IF;

  IF v_new.teaching_assignment_id IS NOT NULL THEN
    SELECT ta.college_id, ta.is_active, ta.course_offering_id, ta.instructor_id,
           ta.delivery_group_id, ta.cohort_id, ta.plan_course_component_id
      INTO v_ta_college, v_ta_active, v_ta_offering, v_ta_instructor, v_ta_dg, v_ta_cohort, v_ta_component
    FROM public.teaching_assignments ta WHERE ta.id = v_new.teaching_assignment_id;
    IF v_ta_college IS DISTINCT FROM v_ver.college_id OR v_ta_active IS NOT TRUE
       OR v_ta_offering IS DISTINCT FROM v_new.course_offering_id THEN
      RAISE EXCEPTION 'ASSIGNMENT_SCOPE_MISMATCH' USING ERRCODE = '23514';
    END IF;
    IF v_ta_instructor IS DISTINCT FROM v_new.instructor_id THEN
      RAISE EXCEPTION 'ASSIGNMENT_INSTRUCTOR_MISMATCH' USING ERRCODE = '23514';
    END IF;
  END IF;
  -- Delivery identity follows the assignment; an unchanged assignment keeps the stored identity.
  IF p_session_id IS NULL OR v_new.teaching_assignment_id IS DISTINCT FROM v_old.teaching_assignment_id THEN
    v_new.delivery_group_id := v_ta_dg;
    v_new.cohort_id := v_ta_cohort;
    v_new.plan_course_component_id := v_ta_component;
  END IF;

  v_bundle := public._collect_schedule_session_move_conflicts(
    v_new.id, v_new.college_id, v_new.schedule_version_id, v_new.instructor_id, v_new.section_id,
    v_new.course_offering_id, v_new.teaching_assignment_id, v_new.study_system, v_new.expected_students,
    v_new.day_of_week, v_new.start_time, v_new.end_time, v_new.room_id);
  IF v_new.delivery_group_id IS NOT NULL OR v_new.cohort_id IS NOT NULL THEN
    v_dg := public._sb_v2_delivery_group_overlap(v_new.schedule_version_id, v_new.delivery_group_id,
      v_new.cohort_id, v_new.day_of_week, v_new.start_time, v_new.end_time, v_new.id);
    SELECT COALESCE(jsonb_agg(c || jsonb_build_object('schedule_session_id', v_new.id)), '[]'::jsonb)
      INTO v_dg FROM jsonb_array_elements(v_dg) c;
  END IF;
  v_class := public._sv_classify_conflicts(v_new.schedule_version_id,
    COALESCE(v_bundle->'all_conflicts', '[]'::jsonb) || v_dg);

  RETURN jsonb_build_object(
    'row', to_jsonb(v_new),
    'blocking_conflicts', COALESCE((SELECT jsonb_agg(c) FROM jsonb_array_elements(v_class->'conflicts') c
      WHERE c->>'severity' = 'hard' AND NOT (c->>'approved_exception')::boolean), '[]'::jsonb),
    'approved_exceptions', COALESCE((SELECT jsonb_agg(c) FROM jsonb_array_elements(v_class->'conflicts') c
      WHERE c->>'severity' = 'hard' AND (c->>'approved_exception')::boolean), '[]'::jsonb),
    'warnings', COALESCE((SELECT jsonb_agg(c) FROM jsonb_array_elements(v_class->'conflicts') c
      WHERE c->>'severity' = 'soft'), '[]'::jsonb));
END $fn$;
REVOKE ALL ON FUNCTION public._sv_manual_session_evaluate(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._sv_manual_session_evaluate(uuid, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.preview_manual_schedule_session(p_session_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE r jsonb;
BEGIN
  r := public._sv_manual_session_evaluate(p_session_id, p_payload);
  RETURN jsonb_build_object(
    'valid', jsonb_array_length(r->'blocking_conflicts') = 0,
    'blocking_conflicts', r->'blocking_conflicts',
    'approved_exceptions', r->'approved_exceptions',
    'warnings', r->'warnings');
END $fn$;
REVOKE ALL ON FUNCTION public.preview_manual_schedule_session(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_manual_schedule_session(uuid, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.save_manual_schedule_session(
  p_session_id uuid, p_expected_updated_at timestamptz, p_payload jsonb)
RETURNS public.schedule_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_old public.schedule_sessions%ROWTYPE;
  v_new public.schedule_sessions%ROWTYPE;
  v_eval jsonb;
  v_version uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING ERRCODE = '42501'; END IF;
  v_version := CASE WHEN p_session_id IS NULL THEN NULLIF(p_payload->>'schedule_version_id', '')::uuid
    ELSE (SELECT schedule_version_id FROM public.schedule_sessions WHERE id = p_session_id) END;
  IF v_version IS NULL THEN RAISE EXCEPTION 'SESSION_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  -- Same advisory key as every other writer of this version's sessions.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_version::text, 9174));

  IF p_session_id IS NOT NULL THEN
    SELECT * INTO v_old FROM public.schedule_sessions WHERE id = p_session_id FOR UPDATE;
    IF p_expected_updated_at IS NULL OR v_old.updated_at IS DISTINCT FROM p_expected_updated_at THEN
      RAISE EXCEPTION 'STALE_SESSION' USING ERRCODE = '40001';
    END IF;
  END IF;

  v_eval := public._sv_manual_session_evaluate(p_session_id, p_payload);
  IF jsonb_array_length(v_eval->'blocking_conflicts') > 0 THEN
    RAISE EXCEPTION 'SCHEDULE_HARD_CONFLICTS'
      USING ERRCODE = 'P0001', DETAIL = (v_eval->'blocking_conflicts')::text,
            HINT = 'تعارضات إلزامية تمنع الحفظ';
  END IF;
  v_new := jsonb_populate_record(NULL::public.schedule_sessions, v_eval->'row');

  IF p_session_id IS NULL THEN
    INSERT INTO public.schedule_sessions (
      id, college_id, schedule_version_id, course_offering_id, teaching_assignment_id, instructor_id,
      room_id, section_id, section_group_id, study_system, day_of_week, start_time, end_time,
      session_type, expected_students, is_locked, lock_reason, source_type,
      cohort_id, delivery_group_id, plan_course_component_id)
    VALUES (
      v_new.id, v_new.college_id, v_new.schedule_version_id, v_new.course_offering_id,
      v_new.teaching_assignment_id, v_new.instructor_id, v_new.room_id, v_new.section_id,
      v_new.section_group_id, v_new.study_system, v_new.day_of_week, v_new.start_time, v_new.end_time,
      v_new.session_type, v_new.expected_students, v_new.is_locked, v_new.lock_reason, 'manual',
      v_new.cohort_id, v_new.delivery_group_id, v_new.plan_course_component_id)
    RETURNING * INTO v_new;
  ELSE
    UPDATE public.schedule_sessions SET
      course_offering_id = v_new.course_offering_id,
      teaching_assignment_id = v_new.teaching_assignment_id,
      instructor_id = v_new.instructor_id,
      room_id = v_new.room_id,
      section_id = v_new.section_id,
      section_group_id = v_new.section_group_id,
      study_system = v_new.study_system,
      day_of_week = v_new.day_of_week,
      start_time = v_new.start_time,
      end_time = v_new.end_time,
      session_type = v_new.session_type,
      expected_students = v_new.expected_students,
      is_locked = v_new.is_locked,
      lock_reason = v_new.lock_reason,
      cohort_id = v_new.cohort_id,
      delivery_group_id = v_new.delivery_group_id,
      plan_course_component_id = v_new.plan_course_component_id
    WHERE id = p_session_id
    RETURNING * INTO v_new;
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (v_uid, CASE WHEN p_session_id IS NULL THEN 'create' ELSE 'update' END,
    'schedule_sessions', v_new.id, v_new.college_id,
    jsonb_build_object('rpc', 'save_manual_schedule_session',
      'before', CASE WHEN p_session_id IS NULL THEN NULL ELSE to_jsonb(v_old) END,
      'after', to_jsonb(v_new),
      'approved_exceptions', v_eval->'approved_exceptions',
      'warnings', v_eval->'warnings'));
  RETURN v_new;
END $fn$;
REVOKE ALL ON FUNCTION public.save_manual_schedule_session(uuid, timestamptz, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_manual_schedule_session(uuid, timestamptz, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.delete_schedule_session(p_session_id uuid, p_expected_updated_at timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_s public.schedule_sessions%ROWTYPE;
  v_status text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_s FROM public.schedule_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.can_manage_college(v_uid, v_s.college_id) THEN
    RAISE EXCEPTION 'SCHEDULE_SESSION_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_s.schedule_version_id::text, 9174));
  SELECT * INTO v_s FROM public.schedule_sessions WHERE id = p_session_id FOR UPDATE;
  SELECT status INTO v_status FROM public.schedule_versions WHERE id = v_s.schedule_version_id;
  IF v_status NOT IN ('draft', 'review') THEN
    RAISE EXCEPTION 'VERSION_LOCKED:%', v_status USING ERRCODE = '23514';
  END IF;
  IF v_s.is_locked THEN RAISE EXCEPTION 'SESSION_LOCKED' USING ERRCODE = '23514'; END IF;
  IF p_expected_updated_at IS NULL OR v_s.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'STALE_SESSION' USING ERRCODE = '40001';
  END IF;
  DELETE FROM public.schedule_sessions WHERE id = p_session_id;
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (v_uid, 'delete', 'schedule_sessions', p_session_id, v_s.college_id,
    jsonb_build_object('rpc', 'delete_schedule_session', 'before', to_jsonb(v_s)));
END $fn$;
REVOKE ALL ON FUNCTION public.delete_schedule_session(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_schedule_session(uuid, timestamptz) TO authenticated, service_role;

COMMIT;
