
-- Phase 5C: Scheduling Constraints Configuration

CREATE TABLE public.constraint_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name_ar text NOT NULL,
  name_en text,
  constraint_category text NOT NULL CHECK (constraint_category IN ('hard','soft')),
  default_weight integer NOT NULL DEFAULT 1,
  is_hard boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.constraint_types TO authenticated;
GRANT ALL ON public.constraint_types TO service_role;
ALTER TABLE public.constraint_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY ct_select ON public.constraint_types FOR SELECT TO authenticated USING (true);
CREATE POLICY ct_insert ON public.constraint_types FOR INSERT TO authenticated WITH CHECK (public.is_super_admin(auth.uid()));
CREATE POLICY ct_update ON public.constraint_types FOR UPDATE TO authenticated USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));
CREATE POLICY ct_delete ON public.constraint_types FOR DELETE TO authenticated USING (public.is_super_admin(auth.uid()));
CREATE TRIGGER ct_set_updated_at BEFORE UPDATE ON public.constraint_types FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.college_constraint_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL,
  constraint_type_id uuid NOT NULL REFERENCES public.constraint_types(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  weight integer NOT NULL DEFAULT 1,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (college_id, constraint_type_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.college_constraint_settings TO authenticated;
GRANT ALL ON public.college_constraint_settings TO service_role;
ALTER TABLE public.college_constraint_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY ccs_select ON public.college_constraint_settings FOR SELECT TO authenticated USING (public.can_view_college(auth.uid(), college_id));
CREATE POLICY ccs_insert ON public.college_constraint_settings FOR INSERT TO authenticated WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY ccs_update ON public.college_constraint_settings FOR UPDATE TO authenticated USING (public.can_manage_college(auth.uid(), college_id)) WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY ccs_delete ON public.college_constraint_settings FOR DELETE TO authenticated USING (public.can_manage_college(auth.uid(), college_id));
CREATE TRIGGER ccs_set_updated_at BEFORE UPDATE ON public.college_constraint_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_ccs_college ON public.college_constraint_settings(college_id);

-- Seed default constraint types
INSERT INTO public.constraint_types (code, name_ar, name_en, constraint_category, is_hard, default_weight, description) VALUES
  ('instructor_conflict',     'تعارض المحاضر',          'Instructor conflict',     'hard', true,  100, 'محاضر مجدول في فصلين بنفس الوقت'),
  ('room_conflict',           'تعارض القاعة',           'Room conflict',           'hard', true,  100, 'قاعة محجوزة لأكثر من جلسة في نفس الوقت'),
  ('section_conflict',        'تعارض الشعبة',           'Section conflict',        'hard', true,  100, 'شعبة لها جلستان متزامنتان'),
  ('room_capacity',           'سعة القاعة',             'Room capacity',           'hard', true,  100, 'عدد الطلاب يتجاوز سعة القاعة'),
  ('instructor_availability', 'توفر المحاضر',           'Instructor availability', 'hard', true,  100, 'الجلسة خارج أوقات توفر المحاضر الإلزامية'),
  ('room_availability',       'توفر القاعة',            'Room availability',       'hard', true,  100, 'الجلسة خارج أوقات توفر القاعة'),
  ('preferred_days',          'الأيام المفضلة',         'Preferred days',          'soft', false,   5, 'احترام أيام المحاضر المفضلة'),
  ('workload_balance',        'توازن العبء التدريسي',    'Workload balance',        'soft', false,  10, 'توزيع متوازن لساعات المحاضرين'),
  ('gap_penalty',             'عقوبة الفجوات',          'Gap penalty',             'soft', false,   3, 'تقليل الفجوات الزمنية في جدول المحاضر/الشعبة')
ON CONFLICT (code) DO NOTHING;
