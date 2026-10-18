-- Rollback of 20261021030000_server_computed_publish_gate.sql: previous definitions (as replayed).
BEGIN;
CREATE OR REPLACE FUNCTION public.persist_schedule_quality_run(p_college_id uuid, p_schedule_version_id uuid, p_expected_eligibility_revision bigint, p_total_score integer, p_hard_conflicts_count integer, p_soft_conflicts_count integer, p_total_deductions integer, p_metrics_breakdown jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_revision bigint;
  v_run_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_manage_college(v_actor, p_college_id) THEN
    RAISE EXCEPTION 'SCHEDULE_QUALITY_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_schedule_version_id::text, 9174));
  SELECT eligibility_revision INTO v_revision
  FROM public.schedule_versions
  WHERE id = p_schedule_version_id AND college_id = p_college_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SCHEDULE_VERSION_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_revision IS DISTINCT FROM p_expected_eligibility_revision THEN
    RAISE EXCEPTION 'STALE_QUALITY_SNAPSHOT' USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.schedule_quality_runs (
    college_id, schedule_version_id, eligibility_revision, total_score,
    hard_conflicts_count, soft_conflicts_count, total_deductions,
    metrics_breakdown, run_by
  ) VALUES (
    p_college_id, p_schedule_version_id, v_revision, p_total_score,
    p_hard_conflicts_count, p_soft_conflicts_count, p_total_deductions,
    p_metrics_breakdown, v_actor
  ) RETURNING id INTO v_run_id;
  RETURN v_run_id;
END;
$function$

;
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
    IF (p_expected_status, p_target_status) IN (
      ('draft', 'review'), ('review', 'approved'), ('approved', 'published')
    ) THEN
      PERFORM public._assert_schedule_version_assignment_integrity(p_college_id, p_schedule_version_id);
    END IF;
    SELECT count(*)::integer INTO v_session_count FROM public.schedule_sessions
    WHERE schedule_version_id = p_schedule_version_id AND college_id = p_college_id;
    IF p_target_status = 'review' AND v_session_count = 0 THEN
      RAISE EXCEPTION 'PUBLISH_BLOCKER:NO_SESSIONS' USING ERRCODE = '23514';
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
      'unapproved_hard_conflicts', COALESCE(v_hard_conflicts, 0))
  );
  RETURN jsonb_build_object('id', p_schedule_version_id, 'status', p_target_status);
END;
$function$

;
CREATE OR REPLACE FUNCTION public.delivery_group_shared_in_published(p_group uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM schedule_version_delivery_private.shared_link_facts l
    JOIN public.schedule_versions v ON v.id = l.version_id
    WHERE l.member_group_id = p_group
      AND v.status = 'published'
      -- Only the newest published timetable of that college and term decides.
      AND NOT EXISTS (
        SELECT 1 FROM public.schedule_versions later
        WHERE later.college_id = v.college_id
          AND later.academic_term_id = v.academic_term_id
          AND later.status = 'published'
          AND later.created_at > v.created_at)
      -- A member that is taught separately in that timetable still counts.
      AND NOT EXISTS (
        SELECT 1 FROM public.schedule_sessions s
        WHERE s.schedule_version_id = v.id AND s.delivery_group_id = p_group)
  )
$function$;
DROP INDEX IF EXISTS public.uq_schedule_versions_one_published;
DROP FUNCTION IF EXISTS public.validate_schedule_version(uuid);
DROP FUNCTION IF EXISTS public.compute_version_hard_conflicts(uuid);
DROP FUNCTION IF EXISTS public._sv_classify_conflicts(uuid, jsonb);
DROP FUNCTION IF EXISTS public._sv_version_student_overlaps(uuid);
DROP FUNCTION IF EXISTS public._sv_policy_waiver(uuid, text);
DROP FUNCTION IF EXISTS public.current_published_version(uuid, uuid);
COMMIT;
