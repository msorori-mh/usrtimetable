-- INSTRUCTOR-ACTIVE-ASSIGNMENT-GUARD-01
-- Keep instructor status and active teaching assignments consistent.
-- 1) An instructor cannot be deactivated while any active assignment remains.
-- 2) An active assignment cannot be created/reactivated for an inactive instructor.

CREATE OR REPLACE FUNCTION public.guard_instructor_deactivation_with_active_assignments()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(OLD.is_active, FALSE) = TRUE
     AND COALESCE(NEW.is_active, FALSE) = FALSE
     AND EXISTS (
       SELECT 1
       FROM public.teaching_assignments ta
       WHERE ta.instructor_id = OLD.id
         AND ta.is_active = TRUE
     ) THEN
    RAISE EXCEPTION 'لا يمكن تحويل المحاضر إلى غير نشط لأن لديه إسنادات تدريسية فعالة. فك الإسنادات أو أعد إسنادها لمحاضر آخر أولاً.'
      USING ERRCODE = '23514',
            DETAIL = 'INSTRUCTOR_HAS_ACTIVE_ASSIGNMENTS',
            HINT = 'Deactivate or reassign active teaching assignments before deactivating the instructor.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_instructor_deactivation_with_active_assignments
  ON public.instructors;

CREATE TRIGGER trg_guard_instructor_deactivation_with_active_assignments
BEFORE UPDATE OF is_active ON public.instructors
FOR EACH ROW
WHEN (OLD.is_active IS DISTINCT FROM NEW.is_active)
EXECUTE FUNCTION public.guard_instructor_deactivation_with_active_assignments();

CREATE OR REPLACE FUNCTION public.guard_active_assignment_instructor_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_instructor_active boolean;
BEGIN
  IF COALESCE(NEW.is_active, FALSE) = TRUE THEN
    SELECT i.is_active
      INTO v_instructor_active
    FROM public.instructors i
    WHERE i.id = NEW.instructor_id;

    IF NOT FOUND OR COALESCE(v_instructor_active, FALSE) = FALSE THEN
      RAISE EXCEPTION 'لا يمكن إنشاء أو تفعيل إسناد لمحاضر غير نشط. فعّل المحاضر أولاً أو اختر محاضراً نشطاً.'
        USING ERRCODE = '23514',
              DETAIL = 'ACTIVE_ASSIGNMENT_REQUIRES_ACTIVE_INSTRUCTOR',
              HINT = 'Activate the instructor or choose another active instructor before activating the assignment.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_active_assignment_instructor_status
  ON public.teaching_assignments;

CREATE TRIGGER trg_guard_active_assignment_instructor_status
BEFORE INSERT OR UPDATE OF instructor_id, is_active ON public.teaching_assignments
FOR EACH ROW
EXECUTE FUNCTION public.guard_active_assignment_instructor_status();
