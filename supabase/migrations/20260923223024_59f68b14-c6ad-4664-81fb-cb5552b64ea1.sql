CREATE OR REPLACE FUNCTION public.guard_new_work_requires_available_instructor()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_status text; v_reactivate boolean := false;
BEGIN
  IF NEW.instructor_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'teaching_assignments' THEN
    v_reactivate := (to_jsonb(OLD)->>'is_active')::boolean IS NOT TRUE
                AND (to_jsonb(NEW)->>'is_active')::boolean IS TRUE;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.instructor_id IS NOT DISTINCT FROM OLD.instructor_id AND NOT v_reactivate THEN RETURN NEW; END IF;
  SELECT availability_status INTO v_status FROM public.instructors WHERE id = NEW.instructor_id;
  IF FOUND AND v_status <> 'available' THEN
    RAISE EXCEPTION 'لا يمكن % لهذا المحاضر لأن حالته: %',
      CASE WHEN v_reactivate THEN 'إعادة تفعيل إسناد تدريسي'
           WHEN TG_TABLE_NAME = 'teaching_assignments' THEN 'إنشاء إسناد تدريسي جديد'
           ELSE 'جدولة محاضرة جديدة' END,
      public.instructor_availability_label_ar(v_status)
      USING ERRCODE = '23514', DETAIL = 'INSTRUCTOR_NOT_AVAILABLE:' || v_status;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_ta_requires_available_instructor ON public.teaching_assignments;
CREATE TRIGGER trg_ta_requires_available_instructor
  BEFORE INSERT OR UPDATE OF instructor_id, is_active ON public.teaching_assignments
  FOR EACH ROW EXECUTE FUNCTION public.guard_new_work_requires_available_instructor();

REVOKE ALL ON FUNCTION public.guard_new_work_requires_available_instructor() FROM PUBLIC, anon;