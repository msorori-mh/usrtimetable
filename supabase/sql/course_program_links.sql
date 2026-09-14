-- Reuse existing course_programs links; do not infer or overwrite user choices.
CREATE OR REPLACE FUNCTION public.save_course_programs(
  p_college_id uuid, p_course_id uuid, p_nature text,
  p_program_ids uuid[], p_expected_updated_at timestamptz, p_is_shared boolean
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $fn$
DECLARE v_updated timestamptz; v_ids uuid[];
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_manage_college(auth.uid(), p_college_id) THEN
    RAISE EXCEPTION 'غير مخول لتعديل مقررات الكلية';
  END IF;
  IF p_nature IS NULL OR p_nature NOT IN ('department', 'college', 'university') OR p_program_ids IS NULL OR p_is_shared IS NULL THEN
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
  UPDATE public.courses SET course_nature = p_nature, is_shared = p_is_shared,
    updated_at = clock_timestamp() WHERE id = p_course_id AND college_id = p_college_id;
END
$fn$;
REVOKE ALL ON FUNCTION public.save_course_programs(uuid,uuid,text,uuid[],timestamptz,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_course_programs(uuid,uuid,text,uuid[],timestamptz,boolean) TO authenticated;
NOTIFY pgrst, 'reload schema';
