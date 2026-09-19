-- Bounded rearrangement + missing sessions in one guarded, idempotent transaction.
-- Requires the current shared-lecture relayout and V2 assignment guard functions.
CREATE OR REPLACE FUNCTION public.apply_schedule_generation(
  p_college_id uuid, p_version_id uuid, p_operation_id uuid,
  p_expected_revision bigint, p_expected_version_updated_at timestamptz,
  p_moves jsonb, p_additions jsonb, p_day_cap integer, p_note text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
SET statement_timeout = '120s'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_version public.schedule_versions%ROWTYPE;
  v_receipt public.schedule_compaction_receipts%ROWTYPE;
  v_hash text;
  v_result jsonb;
  v_addition jsonb;
  v_created jsonb := '[]'::jsonb;
  v_moves integer;
  v_count integer;
  v_id uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.can_manage_college(v_uid,p_college_id) THEN
    RETURN jsonb_build_object('ok',false,'code','FORBIDDEN','applied',0);
  END IF;
  IF p_college_id IS NULL OR p_version_id IS NULL OR p_operation_id IS NULL
     OR p_expected_revision IS NULL OR p_expected_revision < 0
     OR p_expected_version_updated_at IS NULL
     OR p_day_cap IS NULL OR p_day_cap NOT BETWEEN 3 AND 5
     OR jsonb_typeof(p_moves) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_additions) IS DISTINCT FROM 'array' THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_REQUEST','applied',0);
  END IF;
  v_moves := jsonb_array_length(p_moves);
  v_count := jsonb_array_length(p_additions);
  IF v_moves > 32 OR v_count NOT BETWEEN 1 AND 512
     OR octet_length(p_moves::text)+octet_length(p_additions::text)>1048576
     OR length(coalesce(p_note,''))>2000 THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_BATCH_SIZE','applied',0);
  END IF;
  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'mode','generation','college',p_college_id,'version',p_version_id,
    'revision',p_expected_revision,'updated_at',p_expected_version_updated_at,
    'moves',p_moves,'additions',p_additions,'day_cap',p_day_cap,'note',p_note
  )::text,'UTF8')),'hex');
  IF NOT pg_try_advisory_xact_lock(hashtextextended(p_version_id::text,9174)) THEN
    RETURN jsonb_build_object('ok',false,'code','VERSION_BUSY','applied',0);
  END IF;
  SELECT * INTO v_version FROM public.schedule_versions
    WHERE id=p_version_id AND college_id=p_college_id FOR UPDATE NOWAIT;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'code','VERSION_NOT_FOUND','applied',0);
  END IF;
  SELECT * INTO v_receipt FROM public.schedule_compaction_receipts WHERE operation_id=p_operation_id;
  IF FOUND THEN
    IF v_receipt.college_id=p_college_id AND v_receipt.schedule_version_id=p_version_id
       AND v_receipt.actor_id=v_uid AND v_receipt.request_hash=v_hash THEN RETURN v_receipt.result; END IF;
    RETURN jsonb_build_object('ok',false,'code','OPERATION_ID_CONFLICT','applied',0);
  END IF;
  IF v_version.status IS DISTINCT FROM 'draft' THEN
    RETURN jsonb_build_object('ok',false,'code','VERSION_LOCKED','applied',0);
  END IF;
  IF v_version.eligibility_revision IS DISTINCT FROM p_expected_revision
     OR v_version.updated_at IS DISTINCT FROM p_expected_version_updated_at THEN
    RETURN jsonb_build_object('ok',false,'code','STALE_SNAPSHOT','applied',0);
  END IF;
  -- Lock added assignments in stable order; no caller-supplied identity is inserted.
  FOR v_id IN SELECT DISTINCT (a->>'teaching_assignment_id')::uuid
    FROM jsonb_array_elements(p_additions) a ORDER BY 1 LOOP
    PERFORM 1 FROM public.teaching_assignments WHERE id=v_id AND college_id=p_college_id FOR UPDATE NOWAIT;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok',false,'code','ASSIGNMENT_SCOPE_MISMATCH','applied',0);
    END IF;
  END LOOP;
  IF v_moves>0 THEN
    v_result := public.apply_schedule_relayout(p_college_id,p_version_id,gen_random_uuid(),
      p_expected_revision,p_expected_version_updated_at,p_moves,p_day_cap);
    IF coalesce((v_result->>'ok')::boolean,false) IS NOT TRUE THEN
      RAISE EXCEPTION 'GENERATION_REJECTED' USING ERRCODE='P7502';
    END IF;
  END IF;
  FOR v_addition IN SELECT value FROM jsonb_array_elements(p_additions) LOOP
    IF jsonb_typeof(v_addition) IS DISTINCT FROM 'object'
       OR v_addition->>'teaching_assignment_id' IS NULL
       OR v_addition->>'day_of_week' IS NULL OR v_addition->>'start_time' IS NULL
       OR v_addition->>'end_time' IS NULL OR v_addition->>'room_id' IS NULL THEN
      v_result:=jsonb_build_object('code','INVALID_REQUEST');
      RAISE EXCEPTION 'GENERATION_REJECTED' USING ERRCODE='P7502';
    END IF;
    SELECT * INTO v_version FROM public.schedule_versions WHERE id=p_version_id;
    v_result := public.create_schedule_session_from_assignment_v2(
      p_version_id,(v_addition->>'teaching_assignment_id')::uuid,
      (v_addition->>'day_of_week')::integer,(v_addition->>'start_time')::time,
      (v_addition->>'end_time')::time,(v_addition->>'room_id')::uuid,v_version.updated_at,p_note);
    IF coalesce((v_result->>'ok')::boolean,false) IS NOT TRUE OR v_result->'session' IS NULL THEN
      RAISE EXCEPTION 'GENERATION_REJECTED' USING ERRCODE='P7502';
    END IF;
    v_created := v_created || jsonb_build_array(v_result->'session');
  END LOOP;
  -- Independent final-state gates run before the transaction can commit.
  -- An explicit max_attendance_days_per_week is the real hard ceiling and may
  -- tighten the generic four-day limit. A target alone may only raise it.
  IF EXISTS(SELECT 1 FROM public.schedule_sessions s
    JOIN public.instructors i ON i.id=s.instructor_id AND i.college_id=p_college_id
    WHERE s.college_id=p_college_id AND s.schedule_version_id=p_version_id
      AND NOT coalesce(s.replaced_by_split,false)
    GROUP BY i.id,i.target_attendance_days_per_week,i.max_attendance_days_per_week
    HAVING count(DISTINCT s.day_of_week)>
      CASE
        WHEN i.max_attendance_days_per_week IS NOT NULL THEN i.max_attendance_days_per_week
        ELSE greatest(4,coalesce(i.target_attendance_days_per_week,4))
      END) THEN
    v_result:=jsonb_build_object('code','INSTRUCTOR_ATTENDANCE_DAYS_EXCEEDED');
    RAISE EXCEPTION 'GENERATION_REJECTED' USING ERRCODE='P7502';
  END IF;
  IF EXISTS(SELECT 1 FROM public.schedule_sessions s
    LEFT JOIN public.shared_lecture_group_ids(s.delivery_group_id) shared ON true
    LEFT JOIN public.delivery_groups source_group ON source_group.id=shared.group_id
    JOIN public.academic_cohorts c ON c.id=coalesce(source_group.cohort_id,s.cohort_id)
    WHERE s.college_id=p_college_id AND s.schedule_version_id=p_version_id
      AND NOT coalesce(s.replaced_by_split,false)
    GROUP BY c.program_id,c.level_id,c.study_system,c.term_id
    HAVING count(DISTINCT s.day_of_week)>p_day_cap) THEN
    v_result:=jsonb_build_object('code','ATTENDANCE_DAY_LIMIT');
    RAISE EXCEPTION 'GENERATION_REJECTED' USING ERRCODE='P7502';
  END IF;
  IF EXISTS(SELECT 1 FROM public.schedule_extended_day_counts(p_college_id,p_version_id) e
    JOIN public.scheduling_settings cfg ON cfg.college_id=p_college_id
    WHERE cfg.extended_day_policy_enabled AND e.days>cfg.max_extended_days_per_partition) THEN
    v_result:=jsonb_build_object('code','PARTITION_EXTENDED_DAY_LIMIT');
    RAISE EXCEPTION 'GENERATION_REJECTED' USING ERRCODE='P7502';
  END IF;
  SELECT * INTO v_version FROM public.schedule_versions WHERE id=p_version_id;
  v_result:=jsonb_build_object('ok',true,'code','SAVED','operation_id',p_operation_id,
    'applied',v_moves+v_count,'relocated',v_moves,'sessions',v_created,
    'revision',v_version.eligibility_revision::text,'schedule_version_updated_at',v_version.updated_at);
  INSERT INTO public.schedule_compaction_receipts(operation_id,college_id,schedule_version_id,actor_id,request_hash,result)
    VALUES(p_operation_id,p_college_id,p_version_id,v_uid,v_hash,v_result);
  INSERT INTO public.audit_logs(actor_id,action,entity,entity_id,college_id,details)
    VALUES(v_uid,'automatic_generation','schedule_versions',p_version_id,p_college_id,
      jsonb_build_object('operation_id',p_operation_id,'moves',v_moves,'created',v_count,'request_hash',v_hash));
  RETURN v_result;
EXCEPTION
  -- The exception subtransaction rolls back moves, creates, receipts, revisions and audits.
  WHEN SQLSTATE 'P7502' THEN
    RETURN jsonb_build_object('ok',false,'code',coalesce(v_result->>'code','GENERATION_REJECTED'),
      'applied',0,'blocking_conflicts',coalesce(v_result->'blocking_conflicts','[]'::jsonb));
  WHEN lock_not_available OR deadlock_detected OR serialization_failure THEN
    RETURN jsonb_build_object('ok',false,'code','VERSION_BUSY','applied',0);
  WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_REQUEST','applied',0);
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok',false,'code','GENERATION_FAILED','applied',0);
END;
$function$;
REVOKE ALL ON FUNCTION public.apply_schedule_generation(uuid,uuid,uuid,bigint,timestamptz,jsonb,jsonb,integer,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.apply_schedule_generation(uuid,uuid,uuid,bigint,timestamptz,jsonb,jsonb,integer,text)
  TO authenticated;
NOTIFY pgrst,'reload schema';
