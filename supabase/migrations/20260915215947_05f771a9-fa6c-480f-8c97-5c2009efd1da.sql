-- CROSS-COLLEGE-INSTRUCTOR-01
-- 1) Canonical instructor categories for every college (non-destructive).
CREATE OR REPLACE FUNCTION public.seed_college_instructor_types(p_college_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted integer := 0;
  v_row record;
BEGIN
  IF p_college_id IS NULL THEN
    RETURN 0;
  END IF;
  FOR v_row IN
    SELECT * FROM (
      VALUES
        ('permanent', 'مثبت', 'Permanent', false, 1),
        ('con', 'متعاقد بالساعات', 'Hourly Contract', false, 2),
        ('from_other_college', 'محاضر من كلية أخرى', 'From Other College', true, 3)
    ) AS t(code, name_ar, name_en, is_external, display_order)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.instructor_types it
      WHERE it.college_id = p_college_id AND it.code = v_row.code
    ) THEN
      INSERT INTO public.instructor_types
        (college_id, code, name_ar, name_en, is_external, display_order, is_active)
      VALUES
        (p_college_id, v_row.code, v_row.name_ar, v_row.name_en, v_row.is_external, v_row.display_order, true);
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;
  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_college_instructor_types(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seed_college_instructor_types(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.seed_new_college_instructor_types()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.seed_college_instructor_types(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_college_instructor_types ON public.colleges;
CREATE TRIGGER trg_seed_college_instructor_types
AFTER INSERT ON public.colleges
FOR EACH ROW EXECUTE FUNCTION public.seed_new_college_instructor_types();

DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT id FROM public.colleges LOOP
    PERFORM public.seed_college_instructor_types(c.id);
  END LOOP;
END $$;

-- 2) Allow cross-college teaching assignments (identity untouched).
DO $$
DECLARE v_def text; v_new text;
BEGIN
  v_def := pg_get_functiondef('public.ensure_ta_college()'::regprocedure);
  v_new := replace(
    v_def,
    'IF oc IS NULL OR ic IS NULL OR oc <> NEW.college_id OR ic <> NEW.college_id THEN',
    'IF oc IS NULL OR ic IS NULL OR oc <> NEW.college_id THEN -- CROSS-COLLEGE-01: instructor may belong to another college'
  );
  IF v_new = v_def THEN
    RAISE EXCEPTION 'PATCH_ENSURE_TA_COLLEGE_ANCHOR_NOT_FOUND';
  END IF;
  EXECUTE v_new;
END $$;

DO $$
DECLARE v_def text; v_new text;
BEGIN
  v_def := pg_get_functiondef('public.create_teaching_assignment_v2(uuid,uuid,numeric,text)'::regprocedure);
  v_new := replace(
    v_def,
    E'  IF v_instructor.college_id <> v_dg.college_id THEN\n    RAISE EXCEPTION ''ASSIGNMENT_CROSS_COLLEGE_FORBIDDEN'' USING ERRCODE = ''check_violation'';\n  END IF;',
    '  -- CROSS-COLLEGE-01: assigning an instructor from another college is allowed;'
    || E'\n  -- the assignment row stays in the delivery group''s college and the instructor profile is never modified.'
  );
  IF v_new = v_def THEN
    RAISE EXCEPTION 'PATCH_CREATE_TA_V2_ANCHOR_NOT_FOUND';
  END IF;
  EXECUTE v_new;
END $$;

DO $$
DECLARE v_def text; v_new text;
BEGIN
  v_def := pg_get_functiondef('public.preview_instructor_workload_after_assignment(uuid,uuid,numeric,uuid)'::regprocedure);
  v_new := replace(
    v_def,
    E'  IF NOT public.can_view_college(v_uid, v_instructor.college_id)\n     OR NOT public.can_view_college(v_uid, v_dg.college_id) THEN',
    '  IF NOT public.can_view_college(v_uid, v_dg.college_id) THEN'
  );
  IF v_new = v_def THEN
    RAISE EXCEPTION 'PATCH_PREVIEW_VIEW_ANCHOR_NOT_FOUND';
  END IF;
  v_def := v_new;
  v_new := replace(
    v_def,
    E'  IF v_instructor.college_id <> v_dg.college_id THEN\n    v_conflicts := v_conflicts || jsonb_build_array(''ASSIGNMENT_CROSS_COLLEGE_FORBIDDEN'');\n  END IF;',
    E'  IF v_instructor.college_id <> v_dg.college_id THEN\n    v_warnings := v_warnings || jsonb_build_array(''CROSS_COLLEGE_ASSIGNMENT'');\n  END IF;'
  );
  IF v_new = v_def THEN
    RAISE EXCEPTION 'PATCH_PREVIEW_CONFLICT_ANCHOR_NOT_FOUND';
  END IF;
  EXECUTE v_new;
END $$;

-- 3) Candidate picker: all colleges, no private profile fields.
CREATE OR REPLACE FUNCTION public.get_delivery_group_assignment_candidates(p_delivery_group_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_dg public.delivery_groups%ROWTYPE;
  v_pcc public.plan_course_components%ROWTYPE;
  v_candidates jsonb := '[]'::jsonb;
  v_colleges jsonb := '[]'::jsonb;
  v_alloc jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  IF p_delivery_group_id IS NULL THEN
    RAISE EXCEPTION 'DELIVERY_GROUP_ID_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_dg FROM public.operational_delivery_groups WHERE id = p_delivery_group_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DELIVERY_GROUP_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT public.can_view_college(v_uid, v_dg.college_id) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_pcc FROM public.plan_course_components WHERE id = v_dg.component_id;
  v_alloc := public.compute_delivery_group_allocation(p_delivery_group_id);

  SELECT COALESCE(jsonb_agg(x ORDER BY x.is_home_college DESC, x.college_name, x.full_name), '[]'::jsonb)
  INTO v_candidates
  FROM (
    SELECT
      i.id AS instructor_id,
      i.full_name,
      i.academic_rank,
      i.college_id AS home_college_id,
      c.name AS college_name,
      (i.college_id = v_dg.college_id) AS is_home_college,
      CASE WHEN i.college_id = v_dg.college_id THEN i.employee_number ELSE NULL END AS employee_number,
      EXISTS (
        SELECT 1 FROM public.teaching_assignments ta
        WHERE ta.delivery_group_id = p_delivery_group_id
          AND ta.instructor_id = i.id
          AND ta.is_active = TRUE
      ) AS already_assigned
    FROM public.instructors i
    JOIN public.colleges c ON c.id = i.college_id
    WHERE i.is_active = TRUE
  ) x;

  SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
      'college_id', c.id,
      'college_name', c.name,
      'is_home_college', (c.id = v_dg.college_id)
    )), '[]'::jsonb)
  INTO v_colleges
  FROM public.colleges c
  WHERE EXISTS (SELECT 1 FROM public.instructors i WHERE i.college_id = c.id AND i.is_active = TRUE);

  RETURN jsonb_build_object(
    'ok', true,
    'delivery_group_id', p_delivery_group_id,
    'college_id', v_dg.college_id,
    'is_obsolete', COALESCE(v_dg.is_obsolete, false),
    'active', COALESCE(v_dg.active, true),
    'component_type', v_pcc.component_type,
    'component_hours', v_pcc.weekly_contact_hours,
    'allocation', v_alloc,
    'candidates', v_candidates,
    'candidate_colleges', v_colleges,
    'assignable', NOT COALESCE(v_dg.is_obsolete, false)
      AND COALESCE(v_dg.active, true)
      AND COALESCE(v_pcc.component_type, '') IS DISTINCT FROM 'summer_training'
      AND public.can_manage_college(v_uid, v_dg.college_id)
  );
END;
$function$;
