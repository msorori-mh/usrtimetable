
CREATE TABLE public.schedule_version_conflict_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL,
  schedule_version_id uuid NOT NULL REFERENCES public.schedule_versions(id) ON DELETE CASCADE,
  conflict_code text NOT NULL,
  session_id uuid NOT NULL REFERENCES public.schedule_sessions(id) ON DELETE CASCADE,
  related_session_id uuid REFERENCES public.schedule_sessions(id) ON DELETE CASCADE,
  approval_type text NOT NULL,
  reason text NOT NULL,
  source text,
  status text NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'revoked')),
  approved_by uuid,
  approved_at timestamptz,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT svce_session_pair_distinct CHECK (
    related_session_id IS NULL OR session_id <> related_session_id
  ),
  CONSTRAINT svce_approved_at_when_approved CHECK (
    status <> 'approved' OR approved_at IS NOT NULL
  )
);

GRANT SELECT, INSERT, UPDATE ON public.schedule_version_conflict_exceptions TO authenticated;
GRANT ALL ON public.schedule_version_conflict_exceptions TO service_role;

ALTER TABLE public.schedule_version_conflict_exceptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY svce_select ON public.schedule_version_conflict_exceptions
  FOR SELECT TO authenticated
  USING (public.can_view_college(auth.uid(), college_id));

CREATE POLICY svce_insert ON public.schedule_version_conflict_exceptions
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_college(auth.uid(), college_id));

CREATE POLICY svce_update ON public.schedule_version_conflict_exceptions
  FOR UPDATE TO authenticated
  USING (public.can_manage_college(auth.uid(), college_id))
  WITH CHECK (public.can_manage_college(auth.uid(), college_id));

CREATE UNIQUE INDEX uq_svce_active_pair ON public.schedule_version_conflict_exceptions (
  schedule_version_id,
  conflict_code,
  LEAST(session_id, COALESCE(related_session_id, session_id)),
  GREATEST(session_id, COALESCE(related_session_id, session_id))
) WHERE status = 'approved';

CREATE INDEX idx_svce_version_code ON public.schedule_version_conflict_exceptions (
  schedule_version_id,
  conflict_code
);
CREATE INDEX idx_svce_college_version ON public.schedule_version_conflict_exceptions (
  college_id,
  schedule_version_id
);
CREATE INDEX idx_svce_session ON public.schedule_version_conflict_exceptions (session_id);

CREATE TRIGGER trg_svce_updated
  BEFORE UPDATE ON public.schedule_version_conflict_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.ensure_svce_session_version_integrity()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  vc uuid;
  sc_college uuid;
  sv_session uuid;
  rc_college uuid;
  sv_related uuid;
BEGIN
  SELECT college_id INTO vc FROM public.schedule_versions WHERE id = NEW.schedule_version_id;
  IF vc IS NULL THEN
    RAISE EXCEPTION 'schedule_version not found: %', NEW.schedule_version_id;
  END IF;
  IF vc <> NEW.college_id THEN
    RAISE EXCEPTION 'version/college mismatch';
  END IF;

  SELECT college_id, schedule_version_id INTO sc_college, sv_session
  FROM public.schedule_sessions WHERE id = NEW.session_id;
  IF sv_session IS NULL THEN
    RAISE EXCEPTION 'session not found: %', NEW.session_id;
  END IF;
  IF sc_college <> NEW.college_id THEN
    RAISE EXCEPTION 'session/college mismatch';
  END IF;
  IF sv_session <> NEW.schedule_version_id THEN
    RAISE EXCEPTION 'session/schedule_version mismatch: session % belongs to version %, expected %',
      NEW.session_id, sv_session, NEW.schedule_version_id;
  END IF;

  IF NEW.related_session_id IS NOT NULL THEN
    IF NEW.related_session_id = NEW.session_id THEN
      RAISE EXCEPTION 'related_session_id must differ from session_id for pair exceptions';
    END IF;

    SELECT college_id, schedule_version_id INTO rc_college, sv_related
    FROM public.schedule_sessions WHERE id = NEW.related_session_id;
    IF sv_related IS NULL THEN
      RAISE EXCEPTION 'related_session not found: %', NEW.related_session_id;
    END IF;
    IF rc_college <> NEW.college_id THEN
      RAISE EXCEPTION 'related_session/college mismatch';
    END IF;
    IF sv_related <> NEW.schedule_version_id THEN
      RAISE EXCEPTION 'related_session/schedule_version mismatch: session % belongs to version %, expected %',
        NEW.related_session_id, sv_related, NEW.schedule_version_id;
    END IF;
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER trg_svce_session_version_integrity
  BEFORE INSERT OR UPDATE OF schedule_version_id, session_id, related_session_id, college_id
  ON public.schedule_version_conflict_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.ensure_svce_session_version_integrity();
