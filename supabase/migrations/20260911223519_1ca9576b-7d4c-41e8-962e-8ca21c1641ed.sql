-- TUTORIAL-LECTURE-HALL-PERMANENT-RULE-01
-- Permanent platform rule: component_type='tutorial' is always delivered in a
-- lecture_hall room type. practical/project/theory behaviour is untouched.

CREATE OR REPLACE FUNCTION public.tutorial_required_room_type_id(p_college uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  SELECT rt.id
  FROM public.room_types rt
  WHERE rt.college_id = p_college
    AND lower(btrim(rt.code)) = 'lecture_hall'
    AND rt.is_active
    AND COALESCE(rt.default_capacity, 0) > 0
  ORDER BY rt.id
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.tutorial_required_room_type_id(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tutorial_required_room_type_id(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Guard 1: plan_course_components (import sync, editor, any writer)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_tutorial_lecture_hall_component()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_code text;
  v_lh uuid;
BEGIN
  IF NEW.component_type IS DISTINCT FROM 'tutorial' THEN
    RETURN NEW;
  END IF;

  IF NEW.required_room_type_id IS NOT NULL THEN
    SELECT lower(btrim(rt.code)) INTO v_code
    FROM public.room_types rt
    WHERE rt.id = NEW.required_room_type_id;
    IF v_code IS DISTINCT FROM 'lecture_hall' THEN
      RAISE EXCEPTION 'TUTORIAL_ROOM_TYPE_MUST_BE_LECTURE_HALL'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.is_timetabled, false) AND COALESCE(NEW.weekly_contact_hours, 0) > 0 THEN
    v_lh := public.tutorial_required_room_type_id(NEW.college_id);
    IF v_lh IS NULL THEN
      RAISE EXCEPTION 'TUTORIAL_LECTURE_HALL_ROOM_TYPE_MISSING: college %', NEW.college_id
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.required_room_type_id := v_lh;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tutorial_lecture_hall_component ON public.plan_course_components;
CREATE TRIGGER trg_tutorial_lecture_hall_component
BEFORE INSERT OR UPDATE ON public.plan_course_components
FOR EACH ROW EXECUTE FUNCTION public.enforce_tutorial_lecture_hall_component();

-- ---------------------------------------------------------------------------
-- Guard 2: teaching_assignments (assignment RPC + import commit paths)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_tutorial_lecture_hall_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_type text;
BEGIN
  IF NEW.plan_course_component_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT pcc.component_type INTO v_type
  FROM public.plan_course_components pcc
  WHERE pcc.id = NEW.plan_course_component_id;

  IF v_type IS DISTINCT FROM 'tutorial' THEN
    RETURN NEW;
  END IF;

  IF NEW.required_room_type IS NOT NULL
     AND lower(btrim(NEW.required_room_type)) <> 'lecture_hall' THEN
    RAISE EXCEPTION 'TUTORIAL_ROOM_TYPE_MUST_BE_LECTURE_HALL'
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.required_room_type := 'lecture_hall';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tutorial_lecture_hall_assignment ON public.teaching_assignments;
CREATE TRIGGER trg_tutorial_lecture_hall_assignment
BEFORE INSERT OR UPDATE ON public.teaching_assignments
FOR EACH ROW EXECUTE FUNCTION public.enforce_tutorial_lecture_hall_assignment();

-- ---------------------------------------------------------------------------
-- Idempotent backfill (no component ids, groups, or group counts change)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  v_lh uuid;
BEGIN
  FOR r IN
    SELECT pcc.id, pcc.college_id
    FROM public.plan_course_components pcc
    LEFT JOIN public.room_types rt ON rt.id = pcc.required_room_type_id
    WHERE pcc.component_type = 'tutorial'
      AND (
        (pcc.required_room_type_id IS NOT NULL
          AND lower(btrim(rt.code)) IS DISTINCT FROM 'lecture_hall')
        OR (pcc.required_room_type_id IS NULL
          AND COALESCE(pcc.is_timetabled, false)
          AND COALESCE(pcc.weekly_contact_hours, 0) > 0)
      )
  LOOP
    v_lh := public.tutorial_required_room_type_id(r.college_id);
    IF v_lh IS NULL THEN
      RAISE EXCEPTION 'TUTORIAL_LECTURE_HALL_ROOM_TYPE_MISSING: college %', r.college_id
        USING ERRCODE = 'check_violation';
    END IF;
    UPDATE public.plan_course_components
      SET required_room_type_id = v_lh
      WHERE id = r.id;
  END LOOP;
END;
$$;

UPDATE public.teaching_assignments ta
SET required_room_type = 'lecture_hall'
WHERE ta.plan_course_component_id IN (
    SELECT pcc.id FROM public.plan_course_components pcc WHERE pcc.component_type = 'tutorial'
  )
  AND COALESCE(lower(btrim(ta.required_room_type)), '') <> 'lecture_hall';
