-- Independent course/program memberships. Never edits plans or scheduled sessions.
DO $migration$
BEGIN
  IF to_regclass('public.course_programs') IS NULL THEN
    CREATE TABLE public.course_programs (
      college_id uuid NOT NULL REFERENCES public.colleges(id),
      course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
      program_id uuid NOT NULL REFERENCES public.academic_programs(id) ON DELETE CASCADE,
      PRIMARY KEY (course_id, program_id)
    );
    ALTER TABLE public.course_programs ENABLE ROW LEVEL SECURITY;
    CREATE POLICY course_programs_read ON public.course_programs FOR SELECT TO authenticated
      USING (public.can_view_college(auth.uid(), college_id));
    CREATE POLICY course_programs_insert ON public.course_programs FOR INSERT TO authenticated
      WITH CHECK (public.can_manage_college(auth.uid(), college_id)
        AND EXISTS (SELECT 1 FROM public.courses c WHERE c.id = course_id AND c.college_id = course_programs.college_id)
        AND EXISTS (SELECT 1 FROM public.academic_programs p WHERE p.id = program_id AND p.college_id = course_programs.college_id));
    CREATE POLICY course_programs_delete ON public.course_programs FOR DELETE TO authenticated
      USING (public.can_manage_college(auth.uid(), college_id));
    CREATE INDEX course_programs_college_idx ON public.course_programs(college_id);
    -- One-time initial selections only; rerunning must never restore removed links.
    INSERT INTO public.course_programs(college_id, course_id, program_id)
      SELECT DISTINCT pc.college_id, pc.course_id, sp.program_id
      FROM public.plan_courses pc
      JOIN public.study_plans sp ON sp.id = pc.study_plan_id AND sp.college_id = pc.college_id
      JOIN public.courses c ON c.id = pc.course_id AND c.college_id = pc.college_id
      JOIN public.academic_programs p ON p.id = sp.program_id AND p.college_id = pc.college_id
      WHERE sp.is_active;
  END IF;
END
$migration$;
REVOKE ALL ON public.course_programs FROM anon, PUBLIC;
GRANT SELECT, INSERT, DELETE ON public.course_programs TO authenticated;

CREATE OR REPLACE FUNCTION public.save_course_programs(
  p_college_id uuid, p_course_id uuid, p_nature text,
  p_program_ids uuid[], p_expected_updated_at timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $fn$
DECLARE v_updated timestamptz; v_ids uuid[];
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_manage_college(auth.uid(), p_college_id) THEN
    RAISE EXCEPTION 'غير مخول لتعديل مقررات الكلية';
  END IF;
  IF p_nature IS NULL OR p_nature NOT IN ('department', 'college', 'university') OR p_program_ids IS NULL THEN
    RAISE EXCEPTION 'بيانات الربط غير صالحة';
  END IF;
  SELECT updated_at INTO v_updated FROM public.courses
    WHERE id = p_course_id AND college_id = p_college_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المقرر غير موجود في الكلية'; END IF;
  IF p_expected_updated_at IS NULL OR v_updated IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'تغيرت بيانات المقرر؛ أغلق النموذج وحدّث الصفحة ثم أعد المحاولة';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_program_ids) x WHERE x IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.academic_programs p WHERE p.id = x AND p.college_id = p_college_id
  )) THEN RAISE EXCEPTION 'اختر برامج من الكلية نفسها'; END IF;
  SELECT coalesce(array_agg(DISTINCT x), '{}'::uuid[]) INTO v_ids FROM unnest(p_program_ids) x;
  DELETE FROM public.course_programs WHERE course_id = p_course_id AND college_id = p_college_id;
  INSERT INTO public.course_programs(college_id, course_id, program_id)
    SELECT p_college_id, p_course_id, x FROM unnest(v_ids) x;
  UPDATE public.courses SET course_nature = p_nature, is_shared = cardinality(v_ids) > 1,
    updated_at = clock_timestamp() WHERE id = p_course_id AND college_id = p_college_id;
END
$fn$;
REVOKE ALL ON FUNCTION public.save_course_programs(uuid,uuid,text,uuid[],timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_course_programs(uuid,uuid,text,uuid[],timestamptz) TO authenticated;
NOTIFY pgrst, 'reload schema';
