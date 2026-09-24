CREATE OR REPLACE FUNCTION public.apply_schedule_relayout(p_college_id uuid, p_version_id uuid, p_operation_id uuid, p_expected_revision bigint, p_expected_version_updated_at timestamp with time zone, p_moves jsonb, p_day_cap integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_version public.schedule_versions%ROWTYPE;
  v_session public.schedule_sessions%ROWTYPE;
  v_receipt public.schedule_compaction_receipts%ROWTYPE;
  v_move jsonb;
  v_result jsonb;
  v_hash text;
  v_id uuid;
  v_before_rows jsonb;
  v_guard jsonb;
  v_assigned numeric;
  v_bundle jsonb;
  v_index integer := 0;
  v_count integer;
  v_term record;
  v_closure record;
  v_first_date date;
  v_last_date date;
BEGIN
  IF v_uid IS NULL OR NOT public.can_manage_college(v_uid, p_college_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'applied', 0);
  END IF;
  IF p_operation_id IS NULL OR p_version_id IS NULL OR p_college_id IS NULL
     OR p_expected_revision IS NULL OR p_expected_revision < 0
     OR p_expected_version_updated_at IS NULL
     OR p_day_cap IS NULL OR p_day_cap NOT BETWEEN 3 AND 5
     OR jsonb_typeof(p_moves) IS DISTINCT FROM 'array' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_REQUEST', 'applied', 0);
  END IF;
  v_count := jsonb_array_length(p_moves);
  IF v_count < 1 OR v_count > 512 OR octet_length(p_moves::text) > 1048576 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_BATCH_SIZE', 'applied', 0);
  END IF;
  IF (SELECT count(DISTINCT m->>'id') FROM jsonb_array_elements(p_moves) m) <> v_count THEN
    RETURN jsonb_build_object('ok',false,'code','DUPLICATE_SESSION','applied',0);
  END IF;
  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'mode','simultaneous','day_cap',p_day_cap,'college', p_college_id, 'version', p_version_id, 'revision', p_expected_revision,
    'updated_at', p_expected_version_updated_at, 'moves', p_moves
  )::text, 'UTF8')), 'hex');

  -- Existing writers can acquire a session/assignment before the version lock.
  -- Every potentially inverted lock here is nonblocking: reject instead of deadlocking.
  IF NOT pg_try_advisory_xact_lock(hashtextextended(p_version_id::text, 9174)) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'VERSION_BUSY', 'applied', 0);
  END IF;
  SELECT * INTO v_version FROM public.schedule_versions
  WHERE id = p_version_id AND college_id = p_college_id FOR UPDATE NOWAIT;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'VERSION_NOT_FOUND', 'applied', 0);
  END IF;

  -- Check the receipt before staleness/status: a successful retry must not run twice.
  SELECT * INTO v_receipt FROM public.schedule_compaction_receipts
  WHERE operation_id = p_operation_id;
  IF FOUND THEN
    IF v_receipt.college_id = p_college_id AND v_receipt.schedule_version_id = p_version_id
       AND v_receipt.actor_id = v_uid AND v_receipt.request_hash = v_hash THEN
      RETURN v_receipt.result;
    END IF;
    RETURN jsonb_build_object('ok', false, 'code', 'OPERATION_ID_CONFLICT', 'applied', 0);
  END IF;
  IF v_version.status IS DISTINCT FROM 'draft' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'VERSION_LOCKED', 'applied', 0);
  END IF;
  IF v_version.eligibility_revision IS DISTINCT FROM p_expected_revision
     OR v_version.updated_at IS DISTINCT FROM p_expected_version_updated_at THEN
    RETURN jsonb_build_object('ok', false, 'code', 'STALE_SNAPSHOT', 'applied', 0);
  END IF;
  SELECT start_date,end_date INTO v_term FROM public.academic_terms
  WHERE id = v_version.academic_term_id AND college_id = p_college_id;

  -- Lock all affected sessions and assignments in a stable order before any mutation.
  FOR v_id IN SELECT DISTINCT (m->>'id')::uuid FROM jsonb_array_elements(p_moves) m
    ORDER BY 1 LOOP
    SELECT * INTO v_session FROM public.schedule_sessions
    WHERE id = v_id AND college_id = p_college_id AND schedule_version_id = p_version_id
    FOR UPDATE NOWAIT;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'code', 'SESSION_SCOPE_MISMATCH', 'applied', 0);
    END IF;
    IF COALESCE(v_session.is_locked, false) OR COALESCE(v_session.replaced_by_split, false) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'SESSION_LOCKED', 'applied', 0);
    END IF;
  END LOOP;
  FOR v_id IN SELECT DISTINCT s.teaching_assignment_id FROM public.schedule_sessions s
    WHERE s.id IN (SELECT (m->>'id')::uuid FROM jsonb_array_elements(p_moves) m)
      AND s.teaching_assignment_id IS NOT NULL ORDER BY 1 LOOP
    PERFORM 1 FROM public.teaching_assignments WHERE id = v_id FOR UPDATE NOWAIT;
  END LOOP;

  -- Every occurrence carries the timestamp from the original preview, even repeated moves.
  FOR v_move IN SELECT value FROM jsonb_array_elements(p_moves) LOOP
    SELECT * INTO v_session FROM public.schedule_sessions WHERE id = (v_move->>'id')::uuid;
    IF jsonb_typeof(v_move) IS DISTINCT FROM 'object'
       OR v_move->>'expected_updated_at' IS NULL
       OR v_session.updated_at IS DISTINCT FROM (v_move->>'expected_updated_at')::timestamptz THEN
      RETURN jsonb_build_object('ok', false, 'code', 'STALE_SESSION', 'applied', 0);
    END IF;
    IF (v_move->>'day_of_week')::integer NOT BETWEEN 0 AND 6
       OR (v_move->>'end_time')::time <= (v_move->>'start_time')::time
       OR v_move->>'start_time' IS NULL OR v_move->>'end_time' IS NULL
       OR v_move->>'room_id' IS NULL OR v_move->>'day_of_week' IS NULL
       OR (v_move->>'end_time')::time - (v_move->>'start_time')::time
          IS DISTINCT FROM v_session.end_time - v_session.start_time THEN
      RETURN jsonb_build_object('ok', false, 'code', 'DURATION_OR_TARGET_INVALID', 'applied', 0);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.rooms r
      WHERE r.id = (v_move->>'room_id')::uuid AND r.college_id = p_college_id AND r.is_active) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'ROOM_SCOPE_MISMATCH', 'applied', 0);
    END IF;
    -- The legacy move collector does not inspect room_unavailability. Validate both
    -- weekly and date-bounded closures here before the ordered transaction starts.
    FOR v_closure IN SELECT * FROM public.room_unavailability ru
      WHERE ru.college_id = p_college_id AND ru.room_id = (v_move->>'room_id')::uuid
        AND (ru.day_of_week IS NULL OR ru.day_of_week = (v_move->>'day_of_week')::integer)
        AND COALESCE(ru.start_time,'00:00'::time) < (v_move->>'end_time')::time
        AND COALESCE(ru.end_time,'24:00'::time) > (v_move->>'start_time')::time
    LOOP
      IF v_closure.start_date IS NULL AND v_closure.end_date IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ROOM_CLOSED', 'applied', 0);
      END IF;
      IF v_term.start_date IS NULL OR v_term.end_date IS NULL OR v_term.end_date < v_term.start_date THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ROOM_CLOSURE_REQUIRES_TERM_DATES', 'applied', 0);
      END IF;
      v_first_date := greatest(v_term.start_date,COALESCE(v_closure.start_date,v_term.start_date));
      v_last_date := least(v_term.end_date,COALESCE(v_closure.end_date,v_term.end_date));
      IF v_first_date + (((v_move->>'day_of_week')::integer - extract(dow FROM v_first_date)::integer + 7) % 7)
         <= v_last_date THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ROOM_CLOSED', 'applied', 0);
      END IF;
    END LOOP;
  END LOOP;

  SELECT jsonb_agg(to_jsonb(s)) INTO v_before_rows FROM public.schedule_sessions s
   WHERE s.id IN (SELECT (m->>'id')::uuid FROM jsonb_array_elements(p_moves) m);

  -- One UPDATE, retaining all lifecycle, scope and lock triggers. The extended-day
  -- statement guard sees the final state; every final placement is then revalidated.
  UPDATE public.schedule_sessions s SET day_of_week=m.day_of_week,start_time=m.start_time,end_time=m.end_time,room_id=m.room_id
  FROM jsonb_to_recordset(p_moves) m(id uuid,day_of_week integer,start_time time,end_time time,room_id uuid)
  WHERE s.id=m.id AND s.college_id=p_college_id AND s.schedule_version_id=p_version_id;
  GET DIAGNOSTICS v_index = ROW_COUNT;
  IF v_index <> v_count THEN RAISE EXCEPTION 'INCOMPLETE_BATCH' USING ERRCODE='P7501'; END IF;

  FOR v_session IN SELECT * FROM public.schedule_sessions WHERE college_id=p_college_id
    AND schedule_version_id=p_version_id AND NOT coalesce(replaced_by_split,false) LOOP
    IF v_session.teaching_assignment_id IS NOT NULL THEN
      v_guard := public._sb_v2_assignment_guard(v_session.teaching_assignment_id);
      IF coalesce((v_guard->>'is_v2')::boolean,false) THEN
        IF NOT coalesce((v_guard->>'ok')::boolean,false) THEN
          v_result:=jsonb_build_object('code','ASSIGNMENT_BLOCKED'); RAISE EXCEPTION 'RELAYOUT_REJECTED' USING ERRCODE='P7501';
        END IF;
        SELECT coalesce(a.assigned_component_hours,c.weekly_contact_hours,0) INTO v_assigned
         FROM public.teaching_assignments a LEFT JOIN public.plan_course_components c ON c.id=a.plan_course_component_id WHERE a.id=v_session.teaching_assignment_id;
        IF public._sb_v2_scheduled_hours_for_assignment(p_version_id,v_session.teaching_assignment_id,NULL)>v_assigned THEN
          v_result:=jsonb_build_object('code','OVER_SCHEDULED'); RAISE EXCEPTION 'RELAYOUT_REJECTED' USING ERRCODE='P7501';
        END IF;
      END IF;
    END IF;
    v_bundle:=public._collect_schedule_session_move_conflicts(v_session.id,p_college_id,p_version_id,v_session.instructor_id,
     v_session.section_id,v_session.course_offering_id,v_session.teaching_assignment_id,v_session.study_system,v_session.expected_students,
     v_session.day_of_week,v_session.start_time,v_session.end_time,v_session.room_id);
    IF coalesce(jsonb_array_length(v_bundle->'blocking_conflicts'),0)>0 OR coalesce(jsonb_array_length(v_bundle->'warnings'),0)>0
      OR jsonb_array_length(public._sb_v2_delivery_group_overlap(p_version_id,v_session.delivery_group_id,v_session.cohort_id,
       v_session.day_of_week,v_session.start_time,v_session.end_time,v_session.id))>0 THEN
      v_result:=jsonb_build_object('code','FINAL_STATE_CONFLICT'); RAISE EXCEPTION 'RELAYOUT_REJECTED' USING ERRCODE='P7501';
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM public.schedule_sessions s JOIN public.academic_cohorts c ON c.id=s.cohort_id
    WHERE s.college_id=p_college_id AND s.schedule_version_id=p_version_id AND NOT coalesce(s.replaced_by_split,false)
    GROUP BY c.program_id,c.level_id,c.study_system,c.term_id HAVING count(DISTINCT s.day_of_week)>p_day_cap) THEN
    v_result:=jsonb_build_object('code','ATTENDANCE_DAY_LIMIT'); RAISE EXCEPTION 'RELAYOUT_REJECTED' USING ERRCODE='P7501';
  END IF;
  IF EXISTS(SELECT 1 FROM public.schedule_extended_day_counts(p_college_id,p_version_id) e
    JOIN public.scheduling_settings cfg ON cfg.college_id=p_college_id
    WHERE cfg.extended_day_policy_enabled AND e.days>cfg.max_extended_days_per_partition) THEN
    v_result:=jsonb_build_object('code','PARTITION_EXTENDED_DAY_LIMIT'); RAISE EXCEPTION 'RELAYOUT_REJECTED' USING ERRCODE='P7501';
  END IF;
  INSERT INTO public.audit_logs(actor_id,action,entity,entity_id,college_id,details)
   SELECT v_uid,'simultaneous_reschedule','schedule_sessions',s.id,p_college_id,
    jsonb_build_object('operation_id',p_operation_id,'before',b,'after',to_jsonb(s))
   FROM jsonb_array_elements(v_before_rows) b JOIN public.schedule_sessions s ON s.id=(b->>'id')::uuid;

  v_result := jsonb_build_object('ok', true, 'code', 'SAVED', 'applied', v_count,
    'operation_id', p_operation_id);
  INSERT INTO public.schedule_compaction_receipts
    (operation_id,college_id,schedule_version_id,actor_id,request_hash,result)
  VALUES (p_operation_id,p_college_id,p_version_id,v_uid,v_hash,v_result);
  INSERT INTO public.audit_logs(actor_id,action,entity,entity_id,college_id,details)
  VALUES (v_uid,'simultaneous_relayout','schedule_versions',p_version_id,p_college_id,
    jsonb_build_object('operation_id',p_operation_id,'moves',v_count,'request_hash',v_hash));
  RETURN v_result;
EXCEPTION
  -- This handler covers the entire write block. PostgreSQL rolls back moves, revision
  -- increments, per-move audits and the receipt before returning applied=0.
  WHEN SQLSTATE 'P7501' THEN
    RETURN jsonb_build_object('ok', false, 'code', COALESCE(v_result->>'code','MOVE_REJECTED'),
      'applied', 0, 'failed_move', v_index);
  WHEN lock_not_available OR deadlock_detected OR serialization_failure THEN
    RETURN jsonb_build_object('ok', false, 'code', 'VERSION_BUSY', 'applied', 0);
  WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_REQUEST', 'applied', 0);
  WHEN OTHERS THEN
    -- Do not expose table names, identifiers from other tenants, or raw SQL errors.
    RETURN jsonb_build_object('ok', false, 'code', 'BATCH_FAILED', 'applied', 0);
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_schedule_relayout(uuid,uuid,uuid,bigint,timestamptz,jsonb,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.apply_schedule_relayout(uuid,uuid,uuid,bigint,timestamptz,jsonb,integer) TO authenticated;
