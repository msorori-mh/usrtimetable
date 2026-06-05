-- Phase 6B: Soft Constraints & Scoring Foundation

-- 1. Extend conflict_results: severity already exists; add score_impact
ALTER TABLE public.conflict_results
  ADD COLUMN IF NOT EXISTS score_impact integer NOT NULL DEFAULT 0;

-- Loosen severity check (allow hard|soft). If a check constraint exists, drop+recreate.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conflict_results_severity_check'
  ) THEN
    ALTER TABLE public.conflict_results DROP CONSTRAINT conflict_results_severity_check;
  END IF;
END $$;
ALTER TABLE public.conflict_results
  ADD CONSTRAINT conflict_results_severity_check CHECK (severity IN ('hard','soft'));

-- Same for conflict_checks.check_type, allow 'soft' and 'full'
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conflict_checks_check_type_check'
  ) THEN
    ALTER TABLE public.conflict_checks DROP CONSTRAINT conflict_checks_check_type_check;
  END IF;
END $$;
ALTER TABLE public.conflict_checks
  ADD CONSTRAINT conflict_checks_check_type_check CHECK (check_type IN ('hard','soft','full'));

-- 2. schedule_quality_runs
CREATE TABLE IF NOT EXISTS public.schedule_quality_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL,
  schedule_version_id uuid NOT NULL,
  total_score integer NOT NULL DEFAULT 100,
  hard_conflicts_count integer NOT NULL DEFAULT 0,
  soft_conflicts_count integer NOT NULL DEFAULT 0,
  total_deductions integer NOT NULL DEFAULT 0,
  metrics_breakdown jsonb,
  run_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.schedule_quality_runs TO authenticated;
GRANT ALL ON public.schedule_quality_runs TO service_role;
ALTER TABLE public.schedule_quality_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY sqr_select ON public.schedule_quality_runs FOR SELECT TO authenticated
  USING (can_view_college(auth.uid(), college_id));
CREATE POLICY sqr_insert ON public.schedule_quality_runs FOR INSERT TO authenticated
  WITH CHECK (can_manage_college(auth.uid(), college_id));
CREATE POLICY sqr_delete ON public.schedule_quality_runs FOR DELETE TO authenticated
  USING (can_manage_college(auth.uid(), college_id));
CREATE INDEX IF NOT EXISTS idx_sqr_version ON public.schedule_quality_runs(schedule_version_id);
CREATE INDEX IF NOT EXISTS idx_sqr_college ON public.schedule_quality_runs(college_id);

-- 3. quality_metrics (global catalog)
CREATE TABLE IF NOT EXISTS public.quality_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name_ar text NOT NULL,
  name_en text,
  description text,
  default_weight integer NOT NULL DEFAULT 5,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.quality_metrics TO authenticated;
GRANT ALL ON public.quality_metrics TO service_role;
ALTER TABLE public.quality_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY qm_select ON public.quality_metrics FOR SELECT TO authenticated USING (true);
CREATE POLICY qm_insert ON public.quality_metrics FOR INSERT TO authenticated
  WITH CHECK (is_super_admin(auth.uid()));
CREATE POLICY qm_update ON public.quality_metrics FOR UPDATE TO authenticated
  USING (is_super_admin(auth.uid())) WITH CHECK (is_super_admin(auth.uid()));
CREATE POLICY qm_delete ON public.quality_metrics FOR DELETE TO authenticated
  USING (is_super_admin(auth.uid()));
CREATE TRIGGER trg_qm_set_updated_at BEFORE UPDATE ON public.quality_metrics
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed default metrics
INSERT INTO public.quality_metrics (code, name_ar, name_en, default_weight, description) VALUES
  ('preferred_days', 'تفضيل الأيام/الأوقات', 'Preferred days/times', 5, 'احترام تفضيلات المحاضر المرنة'),
  ('workload_balance', 'توازن أعباء التدريس', 'Workload balance', 10, 'اقتراب الأعباء بين المحاضرين'),
  ('gap_penalty', 'الفجوات بين الجلسات', 'Gap penalty', 3, 'تقليل الفجوات في يوم المحاضر'),
  ('distribution_balance', 'توزيع أسبوعي متوازن', 'Distribution balance', 5, 'توزيع الجلسات على أيام الأسبوع')
ON CONFLICT (code) DO NOTHING;

-- 4. college_quality_settings (per-college weights/toggles)
CREATE TABLE IF NOT EXISTS public.college_quality_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL,
  quality_metric_id uuid NOT NULL REFERENCES public.quality_metrics(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  weight integer NOT NULL DEFAULT 5,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (college_id, quality_metric_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.college_quality_settings TO authenticated;
GRANT ALL ON public.college_quality_settings TO service_role;
ALTER TABLE public.college_quality_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY cqs_select ON public.college_quality_settings FOR SELECT TO authenticated
  USING (can_view_college(auth.uid(), college_id));
CREATE POLICY cqs_insert ON public.college_quality_settings FOR INSERT TO authenticated
  WITH CHECK (can_manage_college(auth.uid(), college_id));
CREATE POLICY cqs_update ON public.college_quality_settings FOR UPDATE TO authenticated
  USING (can_manage_college(auth.uid(), college_id)) WITH CHECK (can_manage_college(auth.uid(), college_id));
CREATE POLICY cqs_delete ON public.college_quality_settings FOR DELETE TO authenticated
  USING (can_manage_college(auth.uid(), college_id));
CREATE INDEX IF NOT EXISTS idx_cqs_college ON public.college_quality_settings(college_id);
CREATE TRIGGER trg_cqs_set_updated_at BEFORE UPDATE ON public.college_quality_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
