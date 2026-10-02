-- Live lifecycle definition read on 2026-10-02. Tests preserve all existing
-- authentication, status CAS, coverage and quality gates around the new guard.
CREATE OR REPLACE FUNCTION public.transition_schedule_version(p_college_id uuid, p_schedule_version_id uuid, p_expected_status text, p_target_status text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_version public.schedule_versions%ROWTYPE;
  v_event_type text;
  v_session_count integer;
  v_quality_score numeric;
  v_hard_conflicts integer;
  v_quality_revision bigint;
  v_coverage jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_schedule_version_id::text, 9174));
  SELECT * INTO v_version FROM public.schedule_versions
  WHERE id = p_schedule_version_id AND college_id = p_college_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SCHEDULE_VERSION_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.can_manage_college(v_actor, p_college_id) THEN
    RAISE EXCEPTION 'SCHEDULE_VERSION_TRANSITION_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF v_version.status <> p_expected_status THEN
    RAISE EXCEPTION 'STALE_VERSION_STATUS' USING ERRCODE = '40001';
  END IF;
  IF NOT ((p_expected_status, p_target_status) IN (
    ('draft', 'review'), ('review', 'approved'), ('approved', 'published'),
    ('published', 'archived'), ('review', 'draft'), ('approved', 'review')
  )) THEN
    RAISE EXCEPTION 'INVALID_SCHEDULE_VERSION_TRANSITION' USING ERRCODE = '23514';
  END IF;

  IF p_target_status IN ('review', 'approved', 'published') THEN
    SELECT count(*)::integer INTO v_session_count FROM public.schedule_sessions
    WHERE schedule_version_id = p_schedule_version_id AND college_id = p_college_id;
    IF v_session_count = 0 THEN
      RAISE EXCEPTION 'PUBLISH_BLOCKER:NO_SESSIONS' USING ERRCODE = '23514';
    END IF;

    v_coverage := public.schedule_version_delivery_coverage(p_college_id, p_schedule_version_id);
    IF COALESCE((v_coverage->>'complete')::boolean,false) = false THEN
      RAISE EXCEPTION 'PUBLISH_BLOCKER:INCOMPLETE_DELIVERY_COVERAGE'
        USING ERRCODE = '23514', DETAIL = v_coverage::text;
    END IF;

    SELECT total_score, hard_conflicts_count, eligibility_revision
    INTO v_quality_score, v_hard_conflicts, v_quality_revision
    FROM public.schedule_quality_runs
    WHERE schedule_version_id = p_schedule_version_id AND college_id = p_college_id
    ORDER BY created_at DESC, id DESC LIMIT 1;
    IF v_quality_revision IS NULL THEN
      RAISE EXCEPTION 'PUBLISH_BLOCKER:QUALITY_RUN_REQUIRED' USING ERRCODE = '23514';
    END IF;
    IF v_quality_revision IS DISTINCT FROM v_version.eligibility_revision THEN
      RAISE EXCEPTION 'PUBLISH_BLOCKER:QUALITY_RUN_STALE' USING ERRCODE = '23514';
    END IF;
    IF COALESCE(v_hard_conflicts, 0) > 0 THEN
      RAISE EXCEPTION 'PUBLISH_BLOCKER:UNAPPROVED_HARD_CONFLICTS' USING ERRCODE = '23514';
    END IF;
  END IF;

  v_event_type := CASE p_expected_status || '->' || p_target_status
    WHEN 'draft->review' THEN 'submitted_for_review'
    WHEN 'review->approved' THEN 'approved'
    WHEN 'approved->published' THEN 'published'
    WHEN 'published->archived' THEN 'archived'
    WHEN 'review->draft' THEN 'rolled_back_to_draft'
    WHEN 'approved->review' THEN 'rolled_back_to_review'
  END;
  UPDATE public.schedule_versions SET status = p_target_status
  WHERE id = p_schedule_version_id AND college_id = p_college_id AND status = p_expected_status;
  IF NOT FOUND THEN RAISE EXCEPTION 'STALE_VERSION_STATUS' USING ERRCODE = '40001'; END IF;

  INSERT INTO public.schedule_version_events (
    college_id, schedule_version_id, event_type, from_status, to_status,
    performed_by, notes, metadata
  ) VALUES (
    p_college_id, p_schedule_version_id, v_event_type, p_expected_status,
    p_target_status, v_actor, p_notes,
    jsonb_build_object('atomic', true, 'quality_score', v_quality_score,
      'eligibility_revision', v_version.eligibility_revision,
      'unapproved_hard_conflicts', COALESCE(v_hard_conflicts, 0),
      'delivery_coverage', v_coverage)
  );
  RETURN jsonb_build_object('id', p_schedule_version_id, 'status', p_target_status,
                            'delivery_coverage', v_coverage);
END;
$function$
;
REVOKE ALL ON FUNCTION public.transition_schedule_version(uuid,uuid,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_schedule_version(uuid,uuid,text,text,text) TO authenticated;
