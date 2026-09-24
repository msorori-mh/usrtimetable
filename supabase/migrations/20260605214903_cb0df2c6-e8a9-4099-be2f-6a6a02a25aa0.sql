CREATE TABLE public.auto_schedule_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL,
  schedule_version_id uuid NOT NULL REFERENCES public.schedule_versions(id) ON DELETE CASCADE,
  algorithm text NOT NULL DEFAULT 'greedy',
  status text NOT NULL DEFAULT 'completed',
  total_offerings integer NOT NULL DEFAULT 0,
  placed_sessions integer NOT NULL DEFAULT 0,
  unplaced_sessions integer NOT NULL DEFAULT 0,
  hard_conflicts_after integer NOT NULL DEFAULT 0,
  soft_violations_after integer NOT NULL DEFAULT 0,
  quality_score_after integer,
  duration_ms integer,
  summary jsonb,
  unplaced jsonb,
  run_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auto_sr_status_check CHECK (status IN ('running','completed','failed','partial'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.auto_schedule_runs TO authenticated;
GRANT ALL ON public.auto_schedule_runs TO service_role;

ALTER TABLE public.auto_schedule_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "asr_select" ON public.auto_schedule_runs FOR SELECT TO authenticated
  USING (public.can_view_college(auth.uid(), college_id));
CREATE POLICY "asr_insert" ON public.auto_schedule_runs FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY "asr_update" ON public.auto_schedule_runs FOR UPDATE TO authenticated
  USING (public.can_manage_college(auth.uid(), college_id))
  WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY "asr_delete" ON public.auto_schedule_runs FOR DELETE TO authenticated
  USING (public.can_manage_college(auth.uid(), college_id));

CREATE INDEX idx_asr_version ON public.auto_schedule_runs(schedule_version_id, created_at DESC);
CREATE INDEX idx_asr_college ON public.auto_schedule_runs(college_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.ensure_asr_college() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public AS $$
DECLARE vc uuid;
BEGIN
  SELECT college_id INTO vc FROM public.schedule_versions WHERE id = NEW.schedule_version_id;
  IF vc IS NULL OR vc <> NEW.college_id THEN RAISE EXCEPTION 'version/college mismatch'; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_asr_college BEFORE INSERT OR UPDATE ON public.auto_schedule_runs
  FOR EACH ROW EXECUTE FUNCTION public.ensure_asr_college();