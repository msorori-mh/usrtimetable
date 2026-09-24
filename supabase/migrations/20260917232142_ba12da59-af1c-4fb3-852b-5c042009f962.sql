CREATE OR REPLACE FUNCTION public._import_apply_academic_structure(
  p_college uuid, p_entity text, p_mode text, p_rows jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v jsonb;
  v_ins integer := 0;
  v_upd integer := 0;
  v_skp integer := 0;
  v_id uuid;
  v_dept uuid;
  v_dept_input text;
  v_code text;
  v_name text;
  v_action text;
  v_current_dept uuid;
BEGIN
  IF p_entity NOT IN ('departments', 'academic_programs') THEN
    RAISE EXCEPTION 'unsupported academic structure entity: %', p_entity USING ERRCODE = '22023';
  END IF;

  FOR v IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_id := NULL;
    v_dept := NULL;
    v_code := NULLIF(btrim(v->>'code'), '');
    v_name := NULLIF(btrim(v->>'name'), '');
    IF v_code IS NULL THEN
      RAISE EXCEPTION 'الرمز مفقود' USING ERRCODE = '22023';
    END IF;
    IF v_name IS NULL THEN
      RAISE EXCEPTION 'الاسم مفقود' USING ERRCODE = '22023';
    END IF;

    IF p_entity = 'departments' THEN
      SELECT id INTO v_id FROM public.departments
        WHERE college_id = p_college AND lower(btrim(code)) = lower(v_code)
        ORDER BY id ASC LIMIT 1 FOR UPDATE;
      IF v_id IS NULL THEN
        SELECT id INTO v_id FROM public.departments
          WHERE college_id = p_college AND lower(btrim(name)) = lower(v_name)
          ORDER BY id ASC LIMIT 1 FOR UPDATE;
      END IF;
      v_action := public._import_mode_action(p_mode, v_id IS NOT NULL);
      IF v_action = 'skip' THEN
        v_skp := v_skp + 1;
      ELSIF v_action = 'insert' THEN
        INSERT INTO public.departments (college_id, code, name, study_system)
        VALUES (p_college, v_code, v_name,
                COALESCE(NULLIF(v->>'study_system', ''), 'regular'));
        v_ins := v_ins + 1;
      ELSE
        UPDATE public.departments SET
          code = v_code,
          name = v_name,
          study_system = COALESCE(NULLIF(v->>'study_system', ''), study_system),
          updated_at = now()
        WHERE id = v_id;
        v_upd := v_upd + 1;
      END IF;

    ELSE
      v_dept_input := NULLIF(btrim(v->>'department_code'), '');
      v_dept := NULLIF(v->>'_department_id', '')::uuid;
      IF v_dept IS NOT NULL THEN
        PERFORM 1 FROM public.departments WHERE id = v_dept AND college_id = p_college;
        IF NOT FOUND THEN
          v_dept := NULL;
        END IF;
      END IF;
      IF v_dept IS NULL AND v_dept_input IS NOT NULL THEN
        SELECT id INTO v_dept FROM public.departments
          WHERE college_id = p_college AND lower(btrim(code)) = lower(v_dept_input)
          ORDER BY id ASC LIMIT 1;
        IF v_dept IS NULL THEN
          SELECT id INTO v_dept FROM public.departments
            WHERE college_id = p_college AND lower(btrim(name)) = lower(v_dept_input)
            ORDER BY id ASC LIMIT 1;
        END IF;
      END IF;
      IF v_dept IS NULL THEN
        RAISE EXCEPTION 'القسم % غير موجود ضمن الكلية المحددة', COALESCE(v_dept_input, '')
          USING ERRCODE = '22023';
      END IF;

      SELECT id, department_id INTO v_id, v_current_dept FROM public.academic_programs
        WHERE college_id = p_college AND lower(btrim(code)) = lower(v_code)
        ORDER BY id ASC LIMIT 1 FOR UPDATE;
      IF v_id IS NULL THEN
        SELECT id, department_id INTO v_id, v_current_dept FROM public.academic_programs
          WHERE college_id = p_college AND department_id = v_dept
            AND lower(btrim(name)) = lower(v_name)
          ORDER BY id ASC LIMIT 1 FOR UPDATE;
      END IF;
      IF v_id IS NOT NULL AND v_current_dept IS DISTINCT FROM v_dept THEN
        RAISE EXCEPTION 'لا يمكن نقل برنامج قائم إلى قسم آخر عبر الاستيراد: %', v_code
          USING ERRCODE = '22023';
      END IF;

      v_action := public._import_mode_action(p_mode, v_id IS NOT NULL);
      IF v_action = 'skip' THEN
        v_skp := v_skp + 1;
      ELSIF v_action = 'insert' THEN
        INSERT INTO public.academic_programs (
          college_id, department_id, code, name, degree_type, duration_years
        ) VALUES (
          p_college, v_dept, v_code, v_name,
          COALESCE(NULLIF(v->>'degree_type', ''), 'bachelor'),
          COALESCE(NULLIF(v->>'duration_years', '')::int, 4)
        );
        v_ins := v_ins + 1;
      ELSE
        UPDATE public.academic_programs SET
          code = v_code,
          name = v_name,
          degree_type = COALESCE(NULLIF(v->>'degree_type', ''), degree_type),
          duration_years = COALESCE(NULLIF(v->>'duration_years', '')::int, duration_years),
          updated_at = now()
        WHERE id = v_id;
        v_upd := v_upd + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'skipped', v_skp);
END;
$function$;

REVOKE ALL ON FUNCTION public._import_apply_academic_structure(uuid, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._import_apply_academic_structure(uuid, text, text, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public._import_dispatch(p_college uuid, p_entity text, p_mode text, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'import payload must be a jsonb array' USING ERRCODE = '22023';
  END IF;
  CASE p_entity
    WHEN 'departments', 'academic_programs' THEN
      RETURN public._import_apply_academic_structure(p_college, p_entity, p_mode, p_rows);
    WHEN 'instructors', 'rooms', 'academic_terms', 'daily_breaks' THEN
      RETURN public._import_apply_table_entity(p_college, p_entity, p_mode, p_rows);
    WHEN 'sections' THEN
      RETURN public._import_apply_sections(p_college, p_mode, p_rows);
    WHEN 'academic_cohorts' THEN
      RETURN public._import_apply_academic_cohorts(p_college, p_mode, p_rows);
    WHEN 'course_offerings' THEN
      RETURN public._import_apply_course_offerings(p_college, p_mode, p_rows);
    WHEN 'teaching_assignments' THEN
      RETURN public._import_apply_teaching_assignments(p_college, p_mode, p_rows);
    WHEN 'course_programs' THEN
      RETURN public._import_apply_course_programs(p_college, p_mode, p_rows);
    WHEN 'section_groups' THEN
      RETURN public._import_apply_section_groups(p_college, p_mode, p_rows);
    WHEN 'elective_slot_courses' THEN
      RETURN public._import_apply_elective_slot_courses(p_college, p_mode, p_rows);
    WHEN 'cohort_elective_selections' THEN
      RETURN public._import_apply_cohort_elective_selections(p_college, p_mode, p_rows);
    WHEN 'study_plan_courses', 'full_study_plan' THEN
      RETURN public._import_apply_study_plan(p_college, p_mode, p_rows);
    WHEN 'teaching_assignments_v2' THEN
      RETURN public._import_apply_teaching_assignments_v2(p_college, p_mode, p_rows);
    ELSE
      RAISE EXCEPTION 'unknown import entity: %', p_entity USING ERRCODE = '22023';
  END CASE;
END;
$function$;