-- SOURCE-ONLY / NOT APPLIED: atomic, tenant-scoped schedule-version lifecycle.
-- Do not apply automatically. This migration performs no publication or operational data writes.

BEGIN;

ALTER TABLE public.schedule_versions
  ADD COLUMN IF NOT EXISTS eligibility_revision bigint NOT NULL DEFAULT 0;
ALTER TABLE public.schedule_quality_runs
  ADD COLUMN IF NOT EXISTS eligibility_revision bigint NOT NULL DEFAULT 0;

-- Capture the revision before the scorer reads any eligibility input.
CREATE OR REPLACE FUNCTION public.begin_schedule_quality_snapshot(
  p_college_id uuid,
  p_schedule_version_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_revision bigint;
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
  WHERE id = p_schedule_version_id AND college_id = p_college_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SCHEDULE_VERSION_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'schedule_version_id', p_schedule_version_id,
    'college_id', p_college_id,
    'eligibility_revision', v_revision
  );
END;
$$;

REVOKE ALL ON FUNCTION public.begin_schedule_quality_snapshot(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.begin_schedule_quality_snapshot(uuid, uuid) TO authenticated;

-- Persist only if all scorer reads still describe the current revision.
CREATE OR REPLACE FUNCTION public.persist_schedule_quality_run(
  p_college_id uuid,
  p_schedule_version_id uuid,
  p_expected_eligibility_revision bigint,
  p_total_score integer,
  p_hard_conflicts_count integer,
  p_soft_conflicts_count integer,
  p_total_deductions integer,
  p_metrics_breakdown jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
$$;

REVOKE ALL ON FUNCTION public.persist_schedule_quality_run(
  uuid, uuid, bigint, integer, integer, integer, integer, jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.persist_schedule_quality_run(
  uuid, uuid, bigint, integer, integer, integer, integer, jsonb
) TO authenticated;

-- Quality evidence is RPC-only so callers cannot forge its revision.
REVOKE INSERT, UPDATE, DELETE ON public.schedule_quality_runs FROM authenticated;

CREATE OR REPLACE FUNCTION public.transition_schedule_version(
  p_college_id uuid,
  p_schedule_version_id uuid,
  p_expected_status text,
  p_target_status text,
  p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
$$;

REVOKE ALL ON FUNCTION public.transition_schedule_version(uuid, uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_schedule_version(uuid, uuid, text, text, text) TO authenticated;
REVOKE UPDATE ON public.schedule_versions FROM authenticated;
GRANT UPDATE (name, notes) ON public.schedule_versions TO authenticated;

-- Invalidate every affected version, including both sides of a reassignment.
CREATE OR REPLACE FUNCTION public.invalidate_schedule_version_eligibility()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_old_id uuid := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD.schedule_version_id END;
  v_new_id uuid := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN NEW.schedule_version_id END;
  v_id uuid;
  v_row_college uuid;
  v_version_college uuid;
BEGIN
  -- Lock in lexical UUID order so opposite reassignments cannot deadlock.
  FOR v_id IN
    SELECT ids.x
    FROM (SELECT DISTINCT x FROM unnest(ARRAY[v_old_id, v_new_id]) x WHERE x IS NOT NULL) ids
    ORDER BY ids.x::text
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(v_id::text, 9174));
  END LOOP;

  IF v_old_id IS NOT NULL THEN
    v_row_college := OLD.college_id;
    SELECT college_id INTO v_version_college FROM public.schedule_versions WHERE id = v_old_id;
    IF NOT FOUND OR v_version_college IS DISTINCT FROM v_row_college THEN
      RAISE EXCEPTION 'LIFECYCLE_DEPENDENCY_TENANT_MISMATCH' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF v_new_id IS NOT NULL THEN
    v_row_college := NEW.college_id;
    SELECT college_id INTO v_version_college FROM public.schedule_versions WHERE id = v_new_id;
    IF NOT FOUND OR v_version_college IS DISTINCT FROM v_row_college THEN
      RAISE EXCEPTION 'LIFECYCLE_DEPENDENCY_TENANT_MISMATCH' USING ERRCODE = '23514';
    END IF;
  END IF;

  UPDATE public.schedule_versions
  SET eligibility_revision = eligibility_revision + 1
  WHERE id IN (v_old_id, v_new_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_ss_lifecycle_dependency_lock ON public.schedule_sessions;
CREATE TRIGGER trg_ss_lifecycle_dependency_lock BEFORE INSERT OR UPDATE OR DELETE
ON public.schedule_sessions FOR EACH ROW EXECUTE FUNCTION public.invalidate_schedule_version_eligibility();
DROP TRIGGER IF EXISTS trg_cc_lifecycle_dependency_lock ON public.conflict_checks;
CREATE TRIGGER trg_cc_lifecycle_dependency_lock BEFORE INSERT OR UPDATE OR DELETE
ON public.conflict_checks FOR EACH ROW EXECUTE FUNCTION public.invalidate_schedule_version_eligibility();
DROP TRIGGER IF EXISTS trg_svce_lifecycle_dependency_lock ON public.schedule_version_conflict_exceptions;
CREATE TRIGGER trg_svce_lifecycle_dependency_lock BEFORE INSERT OR UPDATE OR DELETE
ON public.schedule_version_conflict_exceptions FOR EACH ROW EXECUTE FUNCTION public.invalidate_schedule_version_eligibility();
DROP TRIGGER IF EXISTS trg_sqr_lifecycle_dependency_lock ON public.schedule_quality_runs;

-- College-wide scorer inputs have no schedule_version_id. Conservatively
-- invalidate every version in OLD and NEW colleges; global metric changes
-- invalidate every version. Locks are always acquired in UUID order.
CREATE OR REPLACE FUNCTION public.invalidate_college_schedule_eligibility()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_old_college uuid := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') AND TG_TABLE_NAME <> 'quality_metrics' THEN OLD.college_id END;
  v_new_college uuid := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') AND TG_TABLE_NAME <> 'quality_metrics' THEN NEW.college_id END;
  v_version_id uuid;
BEGIN
  IF TG_TABLE_NAME <> 'quality_metrics'
     AND ((TG_OP IN ('UPDATE', 'DELETE') AND v_old_college IS NULL)
       OR (TG_OP IN ('INSERT', 'UPDATE') AND v_new_college IS NULL)) THEN
    RAISE EXCEPTION 'LIFECYCLE_INPUT_TENANT_REQUIRED' USING ERRCODE = '23514';
  END IF;

  FOR v_version_id IN
    SELECT sv.id
    FROM public.schedule_versions sv
    WHERE TG_TABLE_NAME = 'quality_metrics'
       OR sv.college_id IN (v_old_college, v_new_college)
    ORDER BY sv.id::text
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(v_version_id::text, 9174));
  END LOOP;

  UPDATE public.schedule_versions sv
  SET eligibility_revision = eligibility_revision + 1
  WHERE TG_TABLE_NAME = 'quality_metrics'
     OR sv.college_id IN (v_old_college, v_new_college);
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_rooms_lifecycle_invalidate ON public.rooms;
CREATE TRIGGER trg_rooms_lifecycle_invalidate BEFORE INSERT OR UPDATE OR DELETE ON public.rooms
FOR EACH ROW EXECUTE FUNCTION public.invalidate_college_schedule_eligibility();
DROP TRIGGER IF EXISTS trg_ra_lifecycle_invalidate ON public.room_availability;
CREATE TRIGGER trg_ra_lifecycle_invalidate BEFORE INSERT OR UPDATE OR DELETE ON public.room_availability
FOR EACH ROW EXECUTE FUNCTION public.invalidate_college_schedule_eligibility();
DROP TRIGGER IF EXISTS trg_ia_lifecycle_invalidate ON public.instructor_availability;
CREATE TRIGGER trg_ia_lifecycle_invalidate BEFORE INSERT OR UPDATE OR DELETE ON public.instructor_availability
FOR EACH ROW EXECUTE FUNCTION public.invalidate_college_schedule_eligibility();
DROP TRIGGER IF EXISTS trg_co_lifecycle_invalidate ON public.course_offerings;
CREATE TRIGGER trg_co_lifecycle_invalidate BEFORE INSERT OR UPDATE OR DELETE ON public.course_offerings
FOR EACH ROW EXECUTE FUNCTION public.invalidate_college_schedule_eligibility();
DROP TRIGGER IF EXISTS trg_tst_lifecycle_invalidate ON public.time_slot_templates;
CREATE TRIGGER trg_tst_lifecycle_invalidate BEFORE INSERT OR UPDATE OR DELETE ON public.time_slot_templates
FOR EACH ROW EXECUTE FUNCTION public.invalidate_college_schedule_eligibility();
DROP TRIGGER IF EXISTS trg_instructors_lifecycle_invalidate ON public.instructors;
CREATE TRIGGER trg_instructors_lifecycle_invalidate BEFORE INSERT OR UPDATE OR DELETE ON public.instructors
FOR EACH ROW EXECUTE FUNCTION public.invalidate_college_schedule_eligibility();
DROP TRIGGER IF EXISTS trg_ta_lifecycle_invalidate ON public.teaching_assignments;
CREATE TRIGGER trg_ta_lifecycle_invalidate BEFORE INSERT OR UPDATE OR DELETE ON public.teaching_assignments
FOR EACH ROW EXECUTE FUNCTION public.invalidate_college_schedule_eligibility();
DROP TRIGGER IF EXISTS trg_cqs_lifecycle_invalidate ON public.college_quality_settings;
CREATE TRIGGER trg_cqs_lifecycle_invalidate BEFORE INSERT OR UPDATE OR DELETE ON public.college_quality_settings
FOR EACH ROW EXECUTE FUNCTION public.invalidate_college_schedule_eligibility();
DROP TRIGGER IF EXISTS trg_qm_lifecycle_invalidate ON public.quality_metrics;
CREATE TRIGGER trg_qm_lifecycle_invalidate BEFORE INSERT OR UPDATE OR DELETE ON public.quality_metrics
FOR EACH ROW EXECUTE FUNCTION public.invalidate_college_schedule_eligibility();

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
