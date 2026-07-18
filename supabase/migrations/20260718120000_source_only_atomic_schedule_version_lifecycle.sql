-- SOURCE-ONLY / NOT APPLIED: atomic, tenant-scoped schedule-version lifecycle.
-- Do not apply automatically. This migration performs no data backfill or publication.

BEGIN;

ALTER TABLE public.schedule_versions
ADD COLUMN IF NOT EXISTS eligibility_updated_at timestamptz NOT NULL DEFAULT clock_timestamp();

CREATE OR REPLACE FUNCTION public.transition_schedule_version(
  p_college_id uuid,
  p_schedule_version_id uuid,
  p_expected_status text,
  p_target_status text,
  p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_version public.schedule_versions%ROWTYPE;
  v_event_type text;
  v_session_count integer;
  v_quality_score numeric;
  v_hard_conflicts integer;
  v_quality_created_at timestamptz;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING ERRCODE = '42501';
  END IF;

  -- One transaction-scoped lock serializes the version row and all eligibility
  -- inputs. Writers covered by the triggers below take the identical lock.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_schedule_version_id::text, 9174));

  SELECT * INTO v_version
  FROM public.schedule_versions
  WHERE id = p_schedule_version_id AND college_id = p_college_id
  FOR UPDATE;

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
    SELECT count(*)::integer INTO v_session_count
    FROM public.schedule_sessions
    WHERE schedule_version_id = p_schedule_version_id AND college_id = p_college_id;

    IF p_target_status = 'review' AND v_session_count = 0 THEN
      RAISE EXCEPTION 'PUBLISH_BLOCKER:NO_SESSIONS' USING ERRCODE = '23514';
    END IF;

    SELECT total_score, hard_conflicts_count, created_at
    INTO v_quality_score, v_hard_conflicts, v_quality_created_at
    FROM public.schedule_quality_runs
    WHERE schedule_version_id = p_schedule_version_id AND college_id = p_college_id
    ORDER BY created_at DESC, id DESC
    LIMIT 1;

    IF v_quality_created_at IS NULL THEN
      RAISE EXCEPTION 'PUBLISH_BLOCKER:QUALITY_RUN_REQUIRED' USING ERRCODE = '23514';
    END IF;
    IF v_quality_created_at < v_version.eligibility_updated_at THEN
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
  WHERE id = p_schedule_version_id AND college_id = p_college_id
    AND status = p_expected_status;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'STALE_VERSION_STATUS' USING ERRCODE = '40001';
  END IF;

  -- Any insert error aborts this function statement and rolls back the update.
  INSERT INTO public.schedule_version_events (
    college_id, schedule_version_id, event_type, from_status, to_status,
    performed_by, notes, metadata
  ) VALUES (
    p_college_id, p_schedule_version_id, v_event_type, p_expected_status,
    p_target_status, v_actor, p_notes,
    jsonb_build_object('atomic', true, 'quality_score', v_quality_score,
      'unapproved_hard_conflicts', COALESCE(v_hard_conflicts, 0))
  );

  RETURN jsonb_build_object('id', p_schedule_version_id, 'status', p_target_status);
END;
$$;

REVOKE ALL ON FUNCTION public.transition_schedule_version(uuid, uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_schedule_version(uuid, uuid, text, text, text) TO authenticated;

-- Status is RPC-only. Ordinary metadata edits retain column-scoped access.
REVOKE UPDATE ON public.schedule_versions FROM authenticated;
GRANT UPDATE (name, notes) ON public.schedule_versions TO authenticated;

CREATE OR REPLACE FUNCTION public.lock_schedule_version_lifecycle_dependency()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_version_id uuid;
BEGIN
  v_version_id := COALESCE(NEW.schedule_version_id, OLD.schedule_version_id);
  PERFORM pg_advisory_xact_lock(hashtextextended(v_version_id::text, 9174));
  IF TG_TABLE_NAME <> 'schedule_quality_runs' THEN
    UPDATE public.schedule_versions
    SET eligibility_updated_at = clock_timestamp()
    WHERE id = v_version_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_ss_lifecycle_dependency_lock ON public.schedule_sessions;
CREATE TRIGGER trg_ss_lifecycle_dependency_lock BEFORE INSERT OR UPDATE OR DELETE
ON public.schedule_sessions FOR EACH ROW EXECUTE FUNCTION public.lock_schedule_version_lifecycle_dependency();

DROP TRIGGER IF EXISTS trg_sqr_lifecycle_dependency_lock ON public.schedule_quality_runs;
CREATE TRIGGER trg_sqr_lifecycle_dependency_lock BEFORE INSERT OR UPDATE OR DELETE
ON public.schedule_quality_runs FOR EACH ROW EXECUTE FUNCTION public.lock_schedule_version_lifecycle_dependency();

DROP TRIGGER IF EXISTS trg_cc_lifecycle_dependency_lock ON public.conflict_checks;
CREATE TRIGGER trg_cc_lifecycle_dependency_lock BEFORE INSERT OR UPDATE OR DELETE
ON public.conflict_checks FOR EACH ROW EXECUTE FUNCTION public.lock_schedule_version_lifecycle_dependency();

DROP TRIGGER IF EXISTS trg_svce_lifecycle_dependency_lock ON public.schedule_version_conflict_exceptions;
CREATE TRIGGER trg_svce_lifecycle_dependency_lock BEFORE INSERT OR UPDATE OR DELETE
ON public.schedule_version_conflict_exceptions FOR EACH ROW EXECUTE FUNCTION public.lock_schedule_version_lifecycle_dependency();

CREATE OR REPLACE FUNCTION public.enforce_schedule_version_immutability()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.status IN ('published', 'archived') AND
     (NEW.id, NEW.college_id, NEW.academic_term_id, NEW.name, NEW.notes,
      NEW.created_by, NEW.created_at) IS DISTINCT FROM
     (OLD.id, OLD.college_id, OLD.academic_term_id, OLD.name, OLD.notes,
      OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'IMMUTABLE_SCHEDULE_VERSION:%', OLD.status USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sv_immutability ON public.schedule_versions;
CREATE TRIGGER trg_sv_immutability BEFORE UPDATE ON public.schedule_versions
FOR EACH ROW EXECUTE FUNCTION public.enforce_schedule_version_immutability();

CREATE OR REPLACE FUNCTION public.prevent_locked_schedule_version_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.status IN ('published', 'archived') THEN
    RAISE EXCEPTION 'IMMUTABLE_SCHEDULE_VERSION:%', OLD.status USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_sv_delete_immutability ON public.schedule_versions;
CREATE TRIGGER trg_sv_delete_immutability BEFORE DELETE ON public.schedule_versions
FOR EACH ROW EXECUTE FUNCTION public.prevent_locked_schedule_version_delete();

COMMIT;
