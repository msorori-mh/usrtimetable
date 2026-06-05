
-- import_jobs
CREATE TABLE IF NOT EXISTS public.import_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  college_id uuid NOT NULL,
  target_entity text NOT NULL,
  mode text NOT NULL DEFAULT 'insert_only',
  status text NOT NULL DEFAULT 'preview',
  file_name text,
  total_rows integer NOT NULL DEFAULT 0,
  valid_rows integer NOT NULL DEFAULT 0,
  invalid_rows integer NOT NULL DEFAULT 0,
  inserted_rows integer NOT NULL DEFAULT 0,
  updated_rows integer NOT NULL DEFAULT 0,
  skipped_rows integer NOT NULL DEFAULT 0,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ij_mode_check CHECK (mode IN ('insert_only','update_existing','upsert')),
  CONSTRAINT ij_status_check CHECK (status IN ('preview','committed','failed','cancelled'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_jobs TO authenticated;
GRANT ALL ON public.import_jobs TO service_role;
ALTER TABLE public.import_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY ij_select ON public.import_jobs FOR SELECT TO authenticated
  USING (can_view_college(auth.uid(), college_id));
CREATE POLICY ij_insert ON public.import_jobs FOR INSERT TO authenticated
  WITH CHECK (can_manage_college(auth.uid(), college_id) AND created_by = auth.uid());
CREATE POLICY ij_update ON public.import_jobs FOR UPDATE TO authenticated
  USING (can_manage_college(auth.uid(), college_id))
  WITH CHECK (can_manage_college(auth.uid(), college_id));
CREATE POLICY ij_delete ON public.import_jobs FOR DELETE TO authenticated
  USING (can_manage_college(auth.uid(), college_id));

CREATE INDEX IF NOT EXISTS idx_ij_college_created ON public.import_jobs(college_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ij_entity ON public.import_jobs(target_entity);

DROP TRIGGER IF EXISTS trg_ij_updated_at ON public.import_jobs;
CREATE TRIGGER trg_ij_updated_at BEFORE UPDATE ON public.import_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- import_errors
CREATE TABLE IF NOT EXISTS public.import_errors (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  college_id uuid NOT NULL,
  job_id uuid NOT NULL,
  row_number integer NOT NULL,
  column_name text,
  error_code text NOT NULL,
  message text NOT NULL,
  raw_value text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_errors TO authenticated;
GRANT ALL ON public.import_errors TO service_role;
ALTER TABLE public.import_errors ENABLE ROW LEVEL SECURITY;

CREATE POLICY ie_select ON public.import_errors FOR SELECT TO authenticated
  USING (can_view_college(auth.uid(), college_id));
CREATE POLICY ie_insert ON public.import_errors FOR INSERT TO authenticated
  WITH CHECK (can_manage_college(auth.uid(), college_id));
CREATE POLICY ie_delete ON public.import_errors FOR DELETE TO authenticated
  USING (can_manage_college(auth.uid(), college_id));

CREATE INDEX IF NOT EXISTS idx_ie_job ON public.import_errors(job_id);
CREATE INDEX IF NOT EXISTS idx_ie_college ON public.import_errors(college_id);

-- Cross-college validation
CREATE OR REPLACE FUNCTION public.ensure_ie_college()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE jc uuid;
BEGIN
  SELECT college_id INTO jc FROM public.import_jobs WHERE id = NEW.job_id;
  IF jc IS NULL OR jc <> NEW.college_id THEN
    RAISE EXCEPTION 'job/college mismatch';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_ie_college ON public.import_errors;
CREATE TRIGGER trg_ie_college BEFORE INSERT OR UPDATE ON public.import_errors
  FOR EACH ROW EXECUTE FUNCTION public.ensure_ie_college();
