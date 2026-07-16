-- PHASE-9.2-ACADEMIC-DELIVERY-MODEL-V2-IMPORT-GENERATOR
-- SOURCE ONLY — CREATED — NOT APPLIED
-- Explicit RPC generator for cohort academic delivery (idempotent).
-- No wide triggers. Does not delete teaching_assignments or schedule_sessions.

BEGIN;

-- ---------------------------------------------------------------------------
-- Helper: map academic_terms.term_type → plan semester (1|2)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._adm_v2_term_semester(p_term_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT CASE
    WHEN t.term_type = 'second' THEN 2
    WHEN t.term_type = 'first' THEN 1
    ELSE NULL
  END
  FROM public.academic_terms t
  WHERE t.id = p_term_id;
$$;

REVOKE ALL ON FUNCTION public._adm_v2_term_semester(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._adm_v2_term_semester(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public._adm_v2_term_semester(uuid) IS
  'Phase 9.2: map term_type to plan semester (1/2).';

-- ---------------------------------------------------------------------------
-- Helper: compute delivery group count (mirrors TS group-count rules)
-- Returns jsonb: {ok, group_count, capacity_limit, error_code, message_ar, warning}
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._adm_v2_group_count(
  p_component_type text,
  p_student_count integer,
  p_room_type_id uuid,
  p_explicit_group_count integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_students integer := GREATEST(COALESCE(p_student_count, 0), 0);
  v_cap integer;
  v_strict boolean;
  v_count integer;
BEGIN
  IF p_component_type = 'summer_training' THEN
    RETURN jsonb_build_object('ok', true, 'group_count', 0, 'capacity_limit', NULL);
  END IF;

  IF p_component_type = 'project' THEN
    IF p_explicit_group_count IS NOT NULL THEN
      IF p_explicit_group_count < 1 THEN
        RETURN jsonb_build_object(
          'ok', false, 'group_count', 0, 'capacity_limit', NULL,
          'error_code', 'invalid_project_group_count',
          'message_ar', 'عدد مجموعات المشروع يجب أن يكون عددًا صحيحًا ≥ 1.'
        );
      END IF;
      RETURN jsonb_build_object('ok', true, 'group_count', p_explicit_group_count, 'capacity_limit', NULL);
    END IF;
    RETURN jsonb_build_object('ok', true, 'group_count', 1, 'capacity_limit', NULL);
  END IF;

  IF p_component_type = 'practical' THEN
    IF p_room_type_id IS NULL THEN
      RETURN jsonb_build_object(
        'ok', false, 'group_count', 0, 'capacity_limit', NULL,
        'error_code', 'missing_strict_lab_capacity',
        'message_ar', 'المكوّن العملي يتطلب نوع قاعة بسعة صارمة (strict_capacity) وسعة افتراضية موجبة. لا يتم التخمين.'
      );
    END IF;
    SELECT rt.default_capacity, rt.strict_capacity
      INTO v_cap, v_strict
    FROM public.room_types rt
    WHERE rt.id = p_room_type_id;

    IF NOT FOUND OR v_strict IS DISTINCT FROM TRUE OR COALESCE(v_cap, 0) <= 0 THEN
      RETURN jsonb_build_object(
        'ok', false, 'group_count', 0, 'capacity_limit', NULL,
        'error_code', 'missing_strict_lab_capacity',
        'message_ar', 'المكوّن العملي يتطلب نوع قاعة بسعة صارمة (strict_capacity) وسعة افتراضية موجبة. لا يتم التخمين.'
      );
    END IF;

    v_count := CASE WHEN v_students <= 0 THEN 1 ELSE CEIL(v_students::numeric / v_cap)::integer END;
    RETURN jsonb_build_object('ok', true, 'group_count', v_count, 'capacity_limit', v_cap);
  END IF;

  IF p_component_type IN ('theory', 'tutorial') THEN
    IF p_room_type_id IS NULL THEN
      RETURN jsonb_build_object(
        'ok', true, 'group_count', 1, 'capacity_limit', NULL,
        'warning', CASE WHEN p_component_type = 'theory'
          THEN 'theory_capacity_missing_kept_single_group'
          ELSE 'tutorial_capacity_missing_kept_single_group' END
      );
    END IF;
    SELECT rt.default_capacity INTO v_cap
    FROM public.room_types rt
    WHERE rt.id = p_room_type_id;

    IF NOT FOUND OR COALESCE(v_cap, 0) <= 0 THEN
      RETURN jsonb_build_object(
        'ok', true, 'group_count', 1, 'capacity_limit', NULL,
        'warning', CASE WHEN p_component_type = 'theory'
          THEN 'theory_capacity_missing_kept_single_group'
          ELSE 'tutorial_capacity_missing_kept_single_group' END
      );
    END IF;

    IF v_students <= v_cap THEN
      RETURN jsonb_build_object('ok', true, 'group_count', 1, 'capacity_limit', v_cap);
    END IF;
    v_count := CEIL(v_students::numeric / v_cap)::integer;
    RETURN jsonb_build_object('ok', true, 'group_count', v_count, 'capacity_limit', v_cap);
  END IF;

  RETURN jsonb_build_object(
    'ok', false, 'group_count', 0, 'capacity_limit', NULL,
    'error_code', 'unsupported_component',
    'message_ar', 'مكوّن غير معتمد للتقسيم: ' || COALESCE(p_component_type, '')
  );
END;
$$;

REVOKE ALL ON FUNCTION public._adm_v2_group_count(text, integer, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._adm_v2_group_count(text, integer, uuid, integer) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Main explicit generator RPC (idempotent; scoped to explicit cohort ids)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_academic_delivery_for_cohorts(
  p_college_id uuid,
  p_cohort_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_cohort public.academic_cohorts%ROWTYPE;
  v_cohort_id uuid;
  v_semester integer;
  v_study_plan_id uuid;
  v_summary jsonb := jsonb_build_object(
    'cohorts_processed', 0,
    'offerings_created', 0,
    'offerings_updated', 0,
    'delivery_groups_created', 0,
    'delivery_groups_updated', 0,
    'unchanged', 0,
    'warnings', '[]'::jsonb,
    'validation_errors', '[]'::jsonb
  );
  v_pc record;
  v_comp record;
  v_slot record;
  v_sel record;
  v_gc jsonb;
  v_group_count integer;
  v_cap_limit integer;
  v_i integer;
  v_code text;
  v_exp integer;
  v_base integer;
  v_rem integer;
  v_offering_id uuid;
  v_existing_offering uuid;
  v_existing_dg uuid;
  v_max_groups integer;
  v_notes text;
  v_display_course_id uuid;
  v_display_plan_course_id uuid;
  v_is_elective boolean;
  v_course_name text;
  v_processed_courses uuid[] := ARRAY[]::uuid[];
  v_course_failed boolean;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'UNAUTHORIZED',
      'message_ar', 'يجب تسجيل الدخول.',
      'summary', v_summary
    );
  END IF;

  IF p_college_id IS NULL OR p_cohort_ids IS NULL OR cardinality(p_cohort_ids) = 0 THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'INVALID_ARGS',
      'message_ar', 'حدّد كلية ومعرّفات دفعات صراحة.',
      'summary', v_summary
    );
  END IF;

  IF NOT public.can_manage_college(v_uid, p_college_id) THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'FORBIDDEN_COLLEGE',
      'message_ar', 'لا تملك صلاحية إدارة هذه الكلية.',
      'summary', v_summary
    );
  END IF;

  FOREACH v_cohort_id IN ARRAY p_cohort_ids LOOP
    SELECT * INTO v_cohort
    FROM public.academic_cohorts
    WHERE id = v_cohort_id
    FOR UPDATE;

    IF NOT FOUND OR v_cohort.college_id IS DISTINCT FROM p_college_id THEN
      v_summary := jsonb_set(
        v_summary, '{validation_errors}',
        (v_summary->'validation_errors') || jsonb_build_array(jsonb_build_object(
          'code', 'cohort_not_found',
          'message_ar', 'دفعة غير موجودة أو خارج الكلية.',
          'cohort_id', v_cohort_id
        ))
      );
      CONTINUE;
    END IF;

    v_summary := jsonb_set(
      v_summary, '{cohorts_processed}',
      to_jsonb((v_summary->>'cohorts_processed')::integer + 1)
    );

    v_semester := public._adm_v2_term_semester(v_cohort.term_id);
    IF v_semester IS NULL THEN
      v_summary := jsonb_set(
        v_summary, '{validation_errors}',
        (v_summary->'validation_errors') || jsonb_build_array(jsonb_build_object(
          'code', 'term_semester_unmapped',
          'message_ar', 'لا يمكن استنتاج الفصل من نوع الترم (first/second).',
          'cohort_id', v_cohort.id
        ))
      );
      CONTINUE;
    END IF;

    -- Active study plan for program (latest effective_year, then updated_at)
    SELECT sp.id INTO v_study_plan_id
    FROM public.study_plans sp
    WHERE sp.college_id = p_college_id
      AND sp.program_id = v_cohort.program_id
      AND COALESCE(sp.is_active, true) = true
    ORDER BY sp.effective_year DESC NULLS LAST, sp.updated_at DESC
    LIMIT 1;

    IF v_study_plan_id IS NULL THEN
      v_summary := jsonb_set(
        v_summary, '{validation_errors}',
        (v_summary->'validation_errors') || jsonb_build_array(jsonb_build_object(
          'code', 'missing_study_plan',
          'message_ar', 'لا توجد خطة دراسية مرتبطة ببرنامج الدفعة.',
          'cohort_id', v_cohort.id
        ))
      );
      CONTINUE;
    END IF;

    v_processed_courses := ARRAY[]::uuid[];

    -- Required / regular plan courses for level + semester
    FOR v_pc IN
      SELECT pc.id AS plan_course_id, pc.course_id, c.name AS course_name, c.code AS course_code
      FROM public.plan_courses pc
      JOIN public.courses c ON c.id = pc.course_id
      WHERE pc.college_id = p_college_id
        AND pc.study_plan_id = v_study_plan_id
        AND pc.level_id = v_cohort.level_id
        AND pc.semester = v_semester
        AND COALESCE(pc.is_required, true) = true
    LOOP
      -- Skip if this course_id is only an elective placeholder matching a slot_code
      IF EXISTS (
        SELECT 1 FROM public.elective_slots es
        WHERE es.study_plan_id = v_study_plan_id
          AND es.semester = v_semester
          AND es.slot_code = (SELECT code FROM public.courses WHERE id = v_pc.course_id)
          AND COALESCE(es.active, true)
      ) THEN
        CONTINUE;
      END IF;

      v_display_course_id := v_pc.course_id;
      v_display_plan_course_id := v_pc.plan_course_id;
      v_is_elective := false;
      v_course_name := v_pc.course_name;
      v_notes := 'adm_v2:auto';

      -- process course body (shared via label)
      <<process_course>>
      BEGIN
        IF v_display_course_id = ANY (v_processed_courses) THEN
          v_summary := jsonb_set(
            v_summary, '{warnings}',
            (v_summary->'warnings') || jsonb_build_array(jsonb_build_object(
              'code', 'duplicate_course_skipped',
              'message_ar', 'تخطي مقرر مكرر داخل الدفعة.',
              'cohort_id', v_cohort.id,
              'detail', v_pc.course_code
            ))
          );
          EXIT process_course;
        END IF;
        v_processed_courses := array_append(v_processed_courses, v_display_course_id);

        IF NOT EXISTS (
          SELECT 1 FROM public.plan_course_components pcc
          WHERE pcc.plan_course_id = v_display_plan_course_id
        ) THEN
          v_summary := jsonb_set(
            v_summary, '{validation_errors}',
            (v_summary->'validation_errors') || jsonb_build_array(jsonb_build_object(
              'code', 'missing_plan_components',
              'message_ar', 'لا توجد مكونات خطة للمقرر: ' || COALESCE(v_course_name, ''),
              'cohort_id', v_cohort.id
            ))
          );
          EXIT process_course;
        END IF;

        v_max_groups := 1;
        v_course_failed := false;

        FOR v_comp IN
          SELECT * FROM public.plan_course_components pcc
          WHERE pcc.plan_course_id = v_display_plan_course_id
        LOOP
          IF v_comp.component_type = 'summer_training' THEN
            v_summary := jsonb_set(
              v_summary, '{warnings}',
              (v_summary->'warnings') || jsonb_build_array(jsonb_build_object(
                'code', 'summer_training_skipped',
                'message_ar', 'التدريب الصيفي خارج الجدولة الأسبوعية — لم تُنشأ مجموعات تسليم.',
                'cohort_id', v_cohort.id
              ))
            );
            CONTINUE;
          END IF;

          IF COALESCE(v_comp.is_timetabled, true) IS FALSE THEN
            CONTINUE;
          END IF;

          v_gc := public._adm_v2_group_count(
            v_comp.component_type,
            v_cohort.expected_students,
            v_comp.required_room_type_id,
            NULL
          );

          IF COALESCE((v_gc->>'ok')::boolean, false) IS NOT TRUE THEN
            v_summary := jsonb_set(
              v_summary, '{validation_errors}',
              (v_summary->'validation_errors') || jsonb_build_array(jsonb_build_object(
                'code', COALESCE(v_gc->>'error_code', 'group_count_failed'),
                'message_ar', COALESCE(v_gc->>'message_ar', 'فشل حساب عدد المجموعات'),
                'cohort_id', v_cohort.id,
                'detail', v_comp.component_type
              ))
            );
            v_course_failed := true;
            EXIT;
          END IF;

          IF v_gc ? 'warning' THEN
            v_summary := jsonb_set(
              v_summary, '{warnings}',
              (v_summary->'warnings') || jsonb_build_array(jsonb_build_object(
                'code', v_gc->>'warning',
                'message_ar', 'تم الإبقاء على مجموعة واحدة لغياب سعة مناسبة.',
                'cohort_id', v_cohort.id
              ))
            );
          END IF;

          v_group_count := (v_gc->>'group_count')::integer;
          v_cap_limit := CASE WHEN v_gc->>'capacity_limit' IS NULL OR v_gc->>'capacity_limit' = ''
            THEN NULL ELSE (v_gc->>'capacity_limit')::integer END;
          IF v_group_count > v_max_groups THEN
            v_max_groups := v_group_count;
          END IF;

          IF v_group_count <= 0 THEN
            CONTINUE;
          END IF;

          v_base := v_cohort.expected_students / v_group_count;
          v_rem := v_cohort.expected_students % v_group_count;

          FOR v_i IN 1..v_group_count LOOP
            v_code := 'G' || v_i::text;
            v_exp := v_base + CASE WHEN v_i <= v_rem THEN 1 ELSE 0 END;

            SELECT dg.id INTO v_existing_dg
            FROM public.delivery_groups dg
            WHERE dg.component_id = v_comp.id
              AND dg.cohort_id = v_cohort.id
              AND dg.group_code = v_code;

            IF v_existing_dg IS NOT NULL THEN
              UPDATE public.delivery_groups SET
                expected_students = v_exp,
                capacity_limit = v_cap_limit,
                plan_course_id = v_display_plan_course_id,
                active = true,
                updated_at = now()
              WHERE id = v_existing_dg;
              v_summary := jsonb_set(
                v_summary, '{delivery_groups_updated}',
                to_jsonb((v_summary->>'delivery_groups_updated')::integer + 1)
              );
            ELSE
              INSERT INTO public.delivery_groups (
                college_id, cohort_id, plan_course_id, component_id,
                group_code, expected_students, capacity_limit, active
              ) VALUES (
                p_college_id, v_cohort.id, v_display_plan_course_id, v_comp.id,
                v_code, v_exp, v_cap_limit, true
              );
              v_summary := jsonb_set(
                v_summary, '{delivery_groups_created}',
                to_jsonb((v_summary->>'delivery_groups_created')::integer + 1)
              );
            END IF;
          END LOOP;
        END LOOP; -- components

        IF v_course_failed THEN
          EXIT process_course;
        END IF;

        -- Compatibility course_offerings upsert (natural key via co_unique expression)
        SELECT co.id INTO v_existing_offering
        FROM public.course_offerings co
        WHERE co.college_id = p_college_id
          AND co.term_id = v_cohort.term_id
          AND co.course_id = v_display_course_id
          AND co.program_id IS NOT DISTINCT FROM v_cohort.program_id
          AND co.level_id IS NOT DISTINCT FROM v_cohort.level_id
          AND co.study_system IS NOT DISTINCT FROM v_cohort.study_system
        LIMIT 1;

        IF v_is_elective THEN
          v_notes := 'elective:' || COALESCE(v_course_name, '');
        END IF;

        IF v_existing_offering IS NOT NULL THEN
          UPDATE public.course_offerings SET
            expected_students = v_cohort.expected_students,
            sections_count = GREATEST(1, v_max_groups),
            study_plan_id = v_study_plan_id,
            plan_course_id = v_display_plan_course_id,
            program_id = v_cohort.program_id,
            level_id = v_cohort.level_id,
            study_system = v_cohort.study_system,
            is_active = true,
            notes = COALESCE(v_notes, notes),
            updated_at = now()
          WHERE id = v_existing_offering;
          v_summary := jsonb_set(
            v_summary, '{offerings_updated}',
            to_jsonb((v_summary->>'offerings_updated')::integer + 1)
          );
        ELSE
          INSERT INTO public.course_offerings (
            college_id, term_id, course_id, program_id, level_id, study_system,
            study_plan_id, plan_course_id, expected_students, sections_count,
            status, is_active, notes
          ) VALUES (
            p_college_id, v_cohort.term_id, v_display_course_id,
            v_cohort.program_id, v_cohort.level_id, v_cohort.study_system,
            v_study_plan_id, v_display_plan_course_id,
            v_cohort.expected_students, GREATEST(1, v_max_groups),
            'draft', true, v_notes
          );
          v_summary := jsonb_set(
            v_summary, '{offerings_created}',
            to_jsonb((v_summary->>'offerings_created')::integer + 1)
          );
        END IF;
      END;
    END LOOP; -- required plan courses

    -- Elective slots → selected actual courses
    FOR v_slot IN
      SELECT es.*
      FROM public.elective_slots es
      WHERE es.study_plan_id = v_study_plan_id
        AND es.semester = v_semester
        AND (es.level_id IS NULL OR es.level_id = v_cohort.level_id)
        AND COALESCE(es.active, true)
    LOOP
      SELECT ces.*, c.name AS course_name, c.code AS course_code, c.id AS cid
      INTO v_sel
      FROM public.cohort_elective_selections ces
      JOIN public.courses c ON c.id = ces.selected_course_id
      WHERE ces.cohort_id = v_cohort.id
        AND ces.elective_slot_id = v_slot.id;

      IF NOT FOUND THEN
        v_summary := jsonb_set(
          v_summary, '{validation_errors}',
          (v_summary->'validation_errors') || jsonb_build_array(jsonb_build_object(
            'code', 'elective_slot_unselected',
            'message_ar', 'خانة اختيارية بلا اختيار فعلي: ' || v_slot.slot_code,
            'cohort_id', v_cohort.id,
            'detail', v_slot.slot_code
          ))
        );
        CONTINUE;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM public.elective_slot_courses esc
        WHERE esc.elective_slot_id = v_slot.id
          AND esc.course_id = v_sel.cid
          AND COALESCE(esc.active, true)
      ) THEN
        v_summary := jsonb_set(
          v_summary, '{validation_errors}',
          (v_summary->'validation_errors') || jsonb_build_array(jsonb_build_object(
            'code', 'elective_course_not_allowed',
            'message_ar', 'المقرر المختار غير مسموح في الخانة ' || v_slot.slot_code,
            'cohort_id', v_cohort.id,
            'detail', v_sel.course_code
          ))
        );
        CONTINUE;
      END IF;

      SELECT pc.id INTO v_display_plan_course_id
      FROM public.plan_courses pc
      WHERE pc.study_plan_id = v_study_plan_id
        AND pc.course_id = v_sel.cid
      LIMIT 1;

      IF v_display_plan_course_id IS NULL THEN
        v_summary := jsonb_set(
          v_summary, '{validation_errors}',
          (v_summary->'validation_errors') || jsonb_build_array(jsonb_build_object(
            'code', 'elective_plan_course_missing',
            'message_ar', 'المقرر الاختياري المختار غير مربوط بمقرر خطة: ' || v_sel.course_code,
            'cohort_id', v_cohort.id
          ))
        );
        CONTINUE;
      END IF;

      v_display_course_id := v_sel.cid;
      v_is_elective := true;
      v_course_name := 'مقرر اختياري (' || v_sel.course_name || ')';
      v_notes := 'elective:' || v_sel.course_name;

      IF v_display_course_id = ANY (v_processed_courses) THEN
        v_summary := jsonb_set(
          v_summary, '{warnings}',
          (v_summary->'warnings') || jsonb_build_array(jsonb_build_object(
            'code', 'duplicate_course_skipped',
            'message_ar', 'تخطي مقرر مكرر داخل الدفعة.',
            'cohort_id', v_cohort.id
          ))
        );
        CONTINUE;
      END IF;
      v_processed_courses := array_append(v_processed_courses, v_display_course_id);

      IF NOT EXISTS (
        SELECT 1 FROM public.plan_course_components pcc
        WHERE pcc.plan_course_id = v_display_plan_course_id
      ) THEN
        v_summary := jsonb_set(
          v_summary, '{validation_errors}',
          (v_summary->'validation_errors') || jsonb_build_array(jsonb_build_object(
            'code', 'missing_plan_components',
            'message_ar', 'لا توجد مكونات خطة للمقرر: ' || COALESCE(v_course_name, ''),
            'cohort_id', v_cohort.id
          ))
        );
        CONTINUE;
      END IF;

      v_max_groups := 1;
      v_course_failed := false;

      FOR v_comp IN
        SELECT * FROM public.plan_course_components pcc
        WHERE pcc.plan_course_id = v_display_plan_course_id
      LOOP
        IF v_comp.component_type = 'summer_training' THEN
          v_summary := jsonb_set(
            v_summary, '{warnings}',
            (v_summary->'warnings') || jsonb_build_array(jsonb_build_object(
              'code', 'summer_training_skipped',
              'message_ar', 'التدريب الصيفي خارج الجدولة الأسبوعية — لم تُنشأ مجموعات تسليم.',
              'cohort_id', v_cohort.id
            ))
          );
          CONTINUE;
        END IF;
        IF COALESCE(v_comp.is_timetabled, true) IS FALSE THEN
          CONTINUE;
        END IF;

        v_gc := public._adm_v2_group_count(
          v_comp.component_type,
          v_cohort.expected_students,
          v_comp.required_room_type_id,
          NULL
        );
        IF COALESCE((v_gc->>'ok')::boolean, false) IS NOT TRUE THEN
          v_summary := jsonb_set(
            v_summary, '{validation_errors}',
            (v_summary->'validation_errors') || jsonb_build_array(jsonb_build_object(
              'code', COALESCE(v_gc->>'error_code', 'group_count_failed'),
              'message_ar', COALESCE(v_gc->>'message_ar', 'فشل حساب عدد المجموعات'),
              'cohort_id', v_cohort.id
            ))
          );
          v_course_failed := true;
          EXIT;
        END IF;

        v_group_count := (v_gc->>'group_count')::integer;
        v_cap_limit := CASE WHEN v_gc->>'capacity_limit' IS NULL OR v_gc->>'capacity_limit' = ''
          THEN NULL ELSE (v_gc->>'capacity_limit')::integer END;
        IF v_group_count > v_max_groups THEN v_max_groups := v_group_count; END IF;
        IF v_group_count <= 0 THEN CONTINUE; END IF;

        v_base := v_cohort.expected_students / v_group_count;
        v_rem := v_cohort.expected_students % v_group_count;
        FOR v_i IN 1..v_group_count LOOP
          v_code := 'G' || v_i::text;
          v_exp := v_base + CASE WHEN v_i <= v_rem THEN 1 ELSE 0 END;
          SELECT dg.id INTO v_existing_dg
          FROM public.delivery_groups dg
          WHERE dg.component_id = v_comp.id AND dg.cohort_id = v_cohort.id AND dg.group_code = v_code;
          IF v_existing_dg IS NOT NULL THEN
            UPDATE public.delivery_groups SET
              expected_students = v_exp, capacity_limit = v_cap_limit,
              plan_course_id = v_display_plan_course_id, active = true, updated_at = now()
            WHERE id = v_existing_dg;
            v_summary := jsonb_set(
              v_summary, '{delivery_groups_updated}',
              to_jsonb((v_summary->>'delivery_groups_updated')::integer + 1)
            );
          ELSE
            INSERT INTO public.delivery_groups (
              college_id, cohort_id, plan_course_id, component_id,
              group_code, expected_students, capacity_limit, active
            ) VALUES (
              p_college_id, v_cohort.id, v_display_plan_course_id, v_comp.id,
              v_code, v_exp, v_cap_limit, true
            );
            v_summary := jsonb_set(
              v_summary, '{delivery_groups_created}',
              to_jsonb((v_summary->>'delivery_groups_created')::integer + 1)
            );
          END IF;
        END LOOP;
      END LOOP;

      IF v_course_failed THEN CONTINUE; END IF;

      SELECT co.id INTO v_existing_offering
      FROM public.course_offerings co
      WHERE co.college_id = p_college_id
        AND co.term_id = v_cohort.term_id
        AND co.course_id = v_display_course_id
        AND co.program_id IS NOT DISTINCT FROM v_cohort.program_id
        AND co.level_id IS NOT DISTINCT FROM v_cohort.level_id
        AND co.study_system IS NOT DISTINCT FROM v_cohort.study_system
      LIMIT 1;

      IF v_existing_offering IS NOT NULL THEN
        UPDATE public.course_offerings SET
          expected_students = v_cohort.expected_students,
          sections_count = GREATEST(1, v_max_groups),
          study_plan_id = v_study_plan_id,
          plan_course_id = v_display_plan_course_id,
          program_id = v_cohort.program_id,
          level_id = v_cohort.level_id,
          study_system = v_cohort.study_system,
          is_active = true,
          notes = v_notes,
          updated_at = now()
        WHERE id = v_existing_offering;
        v_summary := jsonb_set(
          v_summary, '{offerings_updated}',
          to_jsonb((v_summary->>'offerings_updated')::integer + 1)
        );
      ELSE
        INSERT INTO public.course_offerings (
          college_id, term_id, course_id, program_id, level_id, study_system,
          study_plan_id, plan_course_id, expected_students, sections_count,
          status, is_active, notes
        ) VALUES (
          p_college_id, v_cohort.term_id, v_display_course_id,
          v_cohort.program_id, v_cohort.level_id, v_cohort.study_system,
          v_study_plan_id, v_display_plan_course_id,
          v_cohort.expected_students, GREATEST(1, v_max_groups),
          'draft', true, v_notes
        );
        v_summary := jsonb_set(
          v_summary, '{offerings_created}',
          to_jsonb((v_summary->>'offerings_created')::integer + 1)
        );
      END IF;
    END LOOP; -- elective slots
  END LOOP; -- cohorts

  RETURN jsonb_build_object(
    'ok', jsonb_array_length(v_summary->'validation_errors') = 0,
    'code', CASE WHEN jsonb_array_length(v_summary->'validation_errors') = 0
      THEN 'OK' ELSE 'VALIDATION_ERRORS' END,
    'message_ar', CASE WHEN jsonb_array_length(v_summary->'validation_errors') = 0
      THEN 'اكتمل توليد نموذج التسليم الأكاديمي للدفعة.'
      ELSE 'اكتمل مع أخطاء تحقق — راجع validation_errors.' END,
    'summary', v_summary,
    'cohorts_processed', (v_summary->>'cohorts_processed')::integer,
    'offerings_created', (v_summary->>'offerings_created')::integer,
    'offerings_updated', (v_summary->>'offerings_updated')::integer,
    'delivery_groups_created', (v_summary->>'delivery_groups_created')::integer,
    'delivery_groups_updated', (v_summary->>'delivery_groups_updated')::integer,
    'unchanged', (v_summary->>'unchanged')::integer,
    'warnings', v_summary->'warnings',
    'validation_errors', v_summary->'validation_errors'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.generate_academic_delivery_for_cohorts(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_academic_delivery_for_cohorts(uuid, uuid[]) TO authenticated, service_role;

COMMENT ON FUNCTION public.generate_academic_delivery_for_cohorts(uuid, uuid[]) IS
  'Phase 9.2: Explicit idempotent generator for cohort delivery groups + compatibility course_offerings. NOT a trigger.';

COMMIT;
