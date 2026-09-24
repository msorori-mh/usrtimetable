
-- 1) Events table
CREATE TABLE public.schedule_version_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL,
  schedule_version_id uuid NOT NULL REFERENCES public.schedule_versions(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN (
    'submitted_for_review','approved','published','archived','cloned',
    'rolled_back_to_draft','rolled_back_to_review','reverted'
  )),
  from_status text,
  to_status text,
  performed_by uuid,
  notes text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sve_version ON public.schedule_version_events(schedule_version_id, created_at DESC);
CREATE INDEX idx_sve_college ON public.schedule_version_events(college_id, created_at DESC);

GRANT SELECT, INSERT ON public.schedule_version_events TO authenticated;
GRANT ALL ON public.schedule_version_events TO service_role;

ALTER TABLE public.schedule_version_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY sve_select ON public.schedule_version_events
  FOR SELECT TO authenticated
  USING (public.can_view_college(auth.uid(), college_id));

CREATE POLICY sve_insert ON public.schedule_version_events
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_college(auth.uid(), college_id) AND performed_by = auth.uid());

-- College isolation trigger for events
CREATE OR REPLACE FUNCTION public.ensure_sve_college()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE vc uuid;
BEGIN
  SELECT college_id INTO vc FROM public.schedule_versions WHERE id = NEW.schedule_version_id;
  IF vc IS NULL OR vc <> NEW.college_id THEN
    RAISE EXCEPTION 'version/college mismatch';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_sve_college BEFORE INSERT ON public.schedule_version_events
  FOR EACH ROW EXECUTE FUNCTION public.ensure_sve_college();

-- 2) Publish-lock: block any write on schedule_sessions when parent version is published/archived
CREATE OR REPLACE FUNCTION public.enforce_schedule_session_lock()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE st text; vid uuid;
BEGIN
  vid := COALESCE(NEW.schedule_version_id, OLD.schedule_version_id);
  SELECT status INTO st FROM public.schedule_versions WHERE id = vid;
  IF st IN ('published','archived') THEN
    RAISE EXCEPTION 'schedule_sessions are locked: version status is %', st
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER trg_ss_lock_iud
  BEFORE INSERT OR UPDATE OR DELETE ON public.schedule_sessions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_schedule_session_lock();

-- 3) Enforce allowed status transitions on schedule_versions
CREATE OR REPLACE FUNCTION public.enforce_sv_transition()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    -- Allowed transitions
    IF NOT (
      (OLD.status = 'draft'     AND NEW.status = 'review')   OR
      (OLD.status = 'review'    AND NEW.status = 'approved') OR
      (OLD.status = 'approved'  AND NEW.status = 'published')OR
      (OLD.status = 'published' AND NEW.status = 'archived') OR
      -- optional rollbacks
      (OLD.status = 'review'    AND NEW.status = 'draft')    OR
      (OLD.status = 'approved'  AND NEW.status = 'review')
    ) THEN
      RAISE EXCEPTION 'invalid status transition: % -> %', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_sv_transition
  BEFORE UPDATE OF status ON public.schedule_versions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_sv_transition();
