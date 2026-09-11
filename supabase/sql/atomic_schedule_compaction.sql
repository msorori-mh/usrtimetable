-- Stage 2 source for review and disposable PostgreSQL verification.
-- Apply as one transaction through the approved migration workflow before the client release.
BEGIN;

-- Audit logs permit client inserts; they cannot be trusted as idempotency receipts.
CREATE TABLE public.schedule_compaction_receipts (
  operation_id uuid PRIMARY KEY,
  college_id uuid NOT NULL REFERENCES public.colleges(id),
  schedule_version_id uuid NOT NULL REFERENCES public.schedule_versions(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL,
  request_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.schedule_compaction_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.schedule_compaction_receipts FROM PUBLIC, anon, authenticated, service_role;

-- Complete revision coverage for the compaction snapshot and move validator inputs.
-- Reuse the existing college-scoped lifecycle lock; do not replace its authorization.
DO $coverage$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'academic_cohorts', 'delivery_groups', 'delivery_group_partition_members',
    'cohort_student_partitions', 'instructor_types', 'room_unavailability',
    'scheduling_settings', 'plan_course_components', 'daily_breaks'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_compaction_input_revision BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.invalidate_college_schedule_eligibility()',
      v_table
    );
  END LOOP;
END;
$coverage$;

CREATE FUNCTION public.get_schedule_compaction_result(
  p_college_id uuid, p_version_id uuid, p_operation_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_manage_college(auth.uid(), p_college_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;
  SELECT r.result INTO v_result FROM public.schedule_compaction_receipts r
  WHERE r.operation_id = p_operation_id AND r.college_id = p_college_id
    AND r.schedule_version_id = p_version_id AND r.actor_id = auth.uid();
  -- Absence is not proof of rollback: the original transaction may still be running.
  RETURN COALESCE(v_result, jsonb_build_object('ok', false, 'code', 'UNCONFIRMED'));
END;
$function$;

CREATE FUNCTION public.apply_schedule_compaction(
  p_college_id uuid,
  p_version_id uuid,
  p_operation_id uuid,
  p_expected_revision bigint,
  p_expected_version_updated_at timestamptz,
  p_moves jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
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
  v_days_before jsonb;
  v_index integer := 0;
  v_count integer;
BEGIN
  IF v_uid IS NULL OR NOT public.can_manage_college(v_uid, p_college_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'applied', 0);
  END IF;
  IF p_operation_id IS NULL OR p_version_id IS NULL OR p_college_id IS NULL
     OR p_expected_revision IS NULL OR p_expected_revision < 0
     OR p_expected_version_updated_at IS NULL
     OR jsonb_typeof(p_moves) IS DISTINCT FROM 'array' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_REQUEST', 'applied', 0);
  END IF;
  v_count := jsonb_array_length(p_moves);
  IF v_count < 1 OR v_count > 512 OR octet_length(p_moves::text) > 1048576 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_BATCH_SIZE', 'applied', 0);
  END IF;
  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'college', p_college_id, 'version', p_version_id, 'revision', p_expected_revision,
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
    IF v_move->>'start_time' IS NULL OR v_move->>'end_time' IS NULL
       OR v_move->>'room_id' IS NULL OR v_move->>'day_of_week' IS NULL
       OR (v_move->>'end_time')::time - (v_move->>'start_time')::time
          IS DISTINCT FROM v_session.end_time - v_session.start_time THEN
      RETURN jsonb_build_object('ok', false, 'code', 'DURATION_OR_TARGET_INVALID', 'applied', 0);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.rooms r
      WHERE r.id = (v_move->>'room_id')::uuid AND r.college_id = p_college_id AND r.is_active) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'ROOM_SCOPE_MISMATCH', 'applied', 0);
    END IF;
  END LOOP;

  SELECT COALESCE(jsonb_object_agg(d.level_key, d.days), '{}'::jsonb) INTO v_days_before
  FROM (
    SELECT jsonb_build_array(c.program_id,c.level_id,c.study_system,c.term_id)::text AS level_key,
      count(DISTINCT s.day_of_week) AS days
    FROM public.schedule_sessions s JOIN public.academic_cohorts c ON c.id = s.cohort_id
    WHERE s.schedule_version_id = p_version_id AND s.college_id = p_college_id
      AND NOT COALESCE(s.replaced_by_split, false)
    GROUP BY c.program_id,c.level_id,c.study_system,c.term_id
  ) d;

  FOR v_move IN SELECT value FROM jsonb_array_elements(p_moves) LOOP
    v_index := v_index + 1;
    SELECT * INTO v_session FROM public.schedule_sessions WHERE id = (v_move->>'id')::uuid;
    v_result := public.move_or_reschedule_schedule_session(
      v_session.id, v_session.updated_at, (v_move->>'day_of_week')::integer,
      (v_move->>'start_time')::time, (v_move->>'end_time')::time, (v_move->>'room_id')::uuid,
      'تحسين ذري لتتابع الطلاب والمدرسين'
    );
    IF COALESCE((v_result->>'ok')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'COMPACTION_MOVE_REJECTED' USING ERRCODE = 'P7501';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.schedule_sessions s JOIN public.academic_cohorts c ON c.id = s.cohort_id
      WHERE s.schedule_version_id = p_version_id AND s.college_id = p_college_id
        AND NOT COALESCE(s.replaced_by_split, false)
      GROUP BY c.program_id,c.level_id,c.study_system,c.term_id
      HAVING count(DISTINCT s.day_of_week) > greatest(5, COALESCE((v_days_before->>
        jsonb_build_array(c.program_id,c.level_id,c.study_system,c.term_id)::text)::integer, 0))
    ) THEN
      v_result := jsonb_build_object('code', 'ATTENDANCE_DAY_LIMIT');
      RAISE EXCEPTION 'COMPACTION_MOVE_REJECTED' USING ERRCODE = 'P7501';
    END IF;
  END LOOP;

  v_result := jsonb_build_object('ok', true, 'code', 'SAVED', 'applied', v_count,
    'operation_id', p_operation_id);
  INSERT INTO public.schedule_compaction_receipts
    (operation_id,college_id,schedule_version_id,actor_id,request_hash,result)
  VALUES (p_operation_id,p_college_id,p_version_id,v_uid,v_hash,v_result);
  INSERT INTO public.audit_logs(actor_id,action,entity,entity_id,college_id,details)
  VALUES (v_uid,'atomic_compaction','schedule_versions',p_version_id,p_college_id,
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

REVOKE ALL ON FUNCTION public.apply_schedule_compaction(uuid,uuid,uuid,bigint,timestamptz,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_schedule_compaction_result(uuid,uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_schedule_compaction(uuid,uuid,uuid,bigint,timestamptz,jsonb)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_schedule_compaction_result(uuid,uuid,uuid) TO authenticated;

COMMIT;
