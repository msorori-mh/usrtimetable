-- Targeted production data repair approved on 2026-09-28.
--
-- 1) Enforce the cohort-component instructor rule for Arts / IS101 by using
--    the available, conflict-free instructor (Salwa Al-Haimi) for both active
--    theory groups. Published and archived sessions remain immutable.
-- 2) Preserve the Finance timetable's intentional unknown-instructor rows,
--    but represent the technical placeholder truthfully as «غير محدد» and
--    prevent it from receiving new work until a real instructor is selected.
BEGIN;

DO $repair$
DECLARE
  v_arts_college constant uuid := 'd78cf264-3a76-43a1-8601-4d6def12b400';
  v_finance_college constant uuid := 'f30ff526-3918-4395-b8a0-dff1873534bf';
  v_salwa constant uuid := '505085d5-a762-42c0-a5bf-27ae0f2b9b44';
  v_amer constant uuid := '93e27a29-6eb0-419e-a4ea-ebe4919add6c';
  v_salwa_assignment constant uuid := 'd10e3c16-5f12-43b5-8594-73aaf7d35581';
  v_amer_assignment constant uuid := '6140324f-0b8f-42c4-949c-4b95a82ce4af';
  v_new_assignment constant uuid := '20260928-0003-4000-8000-000000000002';
  v_draft_session constant uuid := '671326c7-4810-42bd-94b6-cba4aafbe065';
  v_placeholder constant uuid := '2437e87e-7890-b284-fed1-fa4554b9fd53';
  v_unspecified_type constant uuid := '20260928-0003-4000-8000-000000000001';
  v_type_id uuid;
  v_draft_version uuid;
  v_start time without time zone;
  v_end time without time zone;
  v_day smallint;
  v_rows integer;
  v_draft_count integer;
  v_immutable_count integer;
  v_conflicts_before uuid[];
  v_conflicts_after uuid[];
  v_active_hours numeric;
  v_max_hours integer;
BEGIN
  -- Fail closed if the target rows no longer match the reviewed baseline.
  IF NOT EXISTS (
    SELECT 1
    FROM public.teaching_assignments ta
    WHERE ta.id = v_salwa_assignment
      AND ta.college_id = v_arts_college
      AND ta.instructor_id = v_salwa
      AND ta.delivery_group_id = '08a3ebbb-111b-421e-ab3d-c9ac211b914a'::uuid
      AND ta.cohort_id = '3df620bf-5ca5-4b0c-9b3e-d5a2ffe2fd07'::uuid
      AND ta.plan_course_component_id = '82cc6a27-351c-472a-8ab9-374d3633d554'::uuid
      AND ta.is_active
  ) THEN
    RAISE EXCEPTION 'IS101_SALWA_ASSIGNMENT_BASELINE_CHANGED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.teaching_assignments ta
    WHERE ta.id = v_amer_assignment
      AND ta.college_id = v_arts_college
      AND ta.instructor_id = v_amer
      AND ta.delivery_group_id = '9b0e0304-ac12-465a-ba6e-3394f2543ead'::uuid
      AND ta.cohort_id = '3df620bf-5ca5-4b0c-9b3e-d5a2ffe2fd07'::uuid
      AND ta.plan_course_component_id = '82cc6a27-351c-472a-8ab9-374d3633d554'::uuid
      AND ta.is_active
  ) THEN
    RAISE EXCEPTION 'IS101_AMER_ASSIGNMENT_BASELINE_CHANGED';
  END IF;

  SELECT ss.schedule_version_id, ss.day_of_week, ss.start_time, ss.end_time
    INTO v_draft_version, v_day, v_start, v_end
  FROM public.schedule_sessions ss
  JOIN public.schedule_versions sv ON sv.id = ss.schedule_version_id
  WHERE ss.id = v_draft_session
    AND ss.teaching_assignment_id = v_amer_assignment
    AND ss.instructor_id = v_amer
    AND ss.delivery_group_id = '9b0e0304-ac12-465a-ba6e-3394f2543ead'::uuid
    AND sv.status = 'draft'
  FOR UPDATE OF ss;

  IF v_draft_version IS NULL THEN
    RAISE EXCEPTION 'IS101_DRAFT_SESSION_BASELINE_CHANGED';
  END IF;

  SELECT
    count(*) FILTER (WHERE sv.status = 'draft'),
    count(*) FILTER (WHERE sv.status IN ('published', 'archived'))
    INTO v_draft_count, v_immutable_count
  FROM public.schedule_sessions ss
  JOIN public.schedule_versions sv ON sv.id = ss.schedule_version_id
  WHERE ss.teaching_assignment_id = v_amer_assignment;

  IF v_draft_count <> 1 OR v_immutable_count <> 3 THEN
    RAISE EXCEPTION
      'IS101_SESSION_SCOPE_CHANGED: draft=%, immutable=%',
      v_draft_count, v_immutable_count;
  END IF;

  -- This legacy draft already contains four unrelated cross-college conflicts.
  -- The final-state constraint therefore rejects every incremental session
  -- repair, even when the changed session adds no conflict. Capture the exact
  -- inherited set and require byte-for-byte parity after this one-row repair.
  SELECT coalesce(array_agg(q.session_id ORDER BY q.session_id), ARRAY[]::uuid[])
    INTO v_conflicts_before
  FROM (
    SELECT DISTINCT s.id AS session_id
    FROM public.schedule_sessions s
    JOIN public.instructors si ON si.id = s.instructor_id
    JOIN schedule_coordination_private.busy(v_draft_version) b
      ON b.instructor_id = s.instructor_id
     AND b.day_of_week = s.day_of_week
     AND b.start_time < s.end_time
     AND s.start_time < b.end_time
    WHERE s.schedule_version_id = v_draft_version
      AND NOT coalesce(s.replaced_by_split, false)
      AND si.employee_number IS DISTINCT FROM 'SYSTEM-NO-INSTRUCTOR-ADMIN'
      AND NOT EXISTS (
        SELECT 1
        FROM public.schedule_version_conflict_exceptions e
        WHERE e.schedule_version_id = v_draft_version
          AND e.session_id = s.id
          AND e.status = 'approved'
          AND e.approval_type = 'cross_college_instructor'
          AND e.conflict_code IN (
            'instructor_conflict', 'cross_college_instructor_conflict'
          )
      )
  ) q;

  IF v_conflicts_before IS DISTINCT FROM ARRAY[
    '3f71471d-6e0c-4d1d-9dd7-9a2e2a86ade7'::uuid,
    '6375a3e4-1a74-43ae-81b6-ff2630c0b043'::uuid,
    '70e70978-ba15-40ec-a78d-ca3d9e96d0c9'::uuid,
    'e7f16ddf-df00-4123-8507-3124557d717a'::uuid
  ] THEN
    RAISE EXCEPTION 'ARTS_DRAFT_INHERITED_CONFLICT_SET_CHANGED: %',
      v_conflicts_before;
  END IF;

  IF v_draft_session = ANY(v_conflicts_before) THEN
    RAISE EXCEPTION 'IS101_TARGET_SESSION_ALREADY_CROSS_COLLEGE_CONFLICTED';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.schedule_sessions peer
    WHERE peer.schedule_version_id = v_draft_version
      AND peer.id <> v_draft_session
      AND peer.instructor_id = v_salwa
      AND peer.day_of_week = v_day
      AND peer.start_time < v_end
      AND v_start < peer.end_time
      AND NOT peer.replaced_by_split
  ) THEN
    RAISE EXCEPTION 'IS101_SALWA_DRAFT_TIME_CONFLICT';
  END IF;

  SELECT i.max_weekly_hours,
         coalesce(sum(coalesce(ta.assigned_component_hours, ta.weekly_hours)), 0)
    INTO v_max_hours, v_active_hours
  FROM public.instructors i
  LEFT JOIN public.teaching_assignments ta
    ON ta.instructor_id = i.id AND ta.is_active
  WHERE i.id = v_salwa
    AND i.is_active
    AND i.availability_status = 'available'
  GROUP BY i.max_weekly_hours;

  IF v_max_hours IS NULL OR v_active_hours + 3 > v_max_hours THEN
    RAISE EXCEPTION
      'IS101_SALWA_LOAD_EXCEEDS_LIMIT: current=%, proposed=%, max=%',
      v_active_hours, v_active_hours + 3, v_max_hours;
  END IF;

  IF EXISTS (SELECT 1 FROM public.teaching_assignments WHERE id = v_new_assignment) THEN
    RAISE EXCEPTION 'IS101_REPAIR_ASSIGNMENT_ID_ALREADY_EXISTS';
  END IF;

  UPDATE public.teaching_assignments
  SET is_active = false,
      notes = concat_ws(
        E'\n', nullif(btrim(notes), ''),
        'أوقف في 2026-09-28 لتوحيد محاضر مجموعتي IS101؛ الجلسات المنشورة والمؤرشفة محفوظة دون تعديل.'
      )
  WHERE id = v_amer_assignment
    AND is_active;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'IS101_OLD_ASSIGNMENT_DEACTIVATION_FAILED';
  END IF;

  INSERT INTO public.teaching_assignments(
    id, college_id, course_offering_id, instructor_id, section_number,
    session_type, weekly_hours, required_room_type, notes,
    expected_students, section_id, cohort_id, plan_course_component_id,
    delivery_group_id, assigned_component_hours, is_active
  )
  SELECT
    v_new_assignment, old.college_id, old.course_offering_id, v_salwa,
    old.section_number, old.session_type, old.weekly_hours,
    old.required_room_type,
    concat_ws(
      E'\n', nullif(btrim(old.notes), ''),
      'توحيد محاضر مجموعتي النظري للمقرر IS101 على د. سلوى الحيمي بتوجيه المستخدم في 2026-09-28.'
    ),
    old.expected_students, old.section_id, old.cohort_id,
    old.plan_course_component_id, old.delivery_group_id,
    old.assigned_component_hours, true
  FROM public.teaching_assignments old
  WHERE old.id = v_amer_assignment;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'IS101_NEW_ASSIGNMENT_INSERT_FAILED';
  END IF;

  -- AccessExclusiveLock prevents concurrent session writes while this single
  -- inherited-draft repair bypasses only the version-wide deferred check.
  -- All row guards and every other constraint trigger remain enabled.
  ALTER TABLE public.schedule_sessions
    DISABLE TRIGGER coordination_sessions_final;

  UPDATE public.schedule_sessions ss
  SET teaching_assignment_id = v_new_assignment,
      instructor_id = v_salwa
  WHERE ss.id = v_draft_session
    AND ss.schedule_version_id = v_draft_version
    AND ss.teaching_assignment_id = v_amer_assignment
    AND ss.instructor_id = v_amer;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'IS101_DRAFT_SESSION_RELINK_FAILED';
  END IF;

  SET CONSTRAINTS ALL IMMEDIATE;
  ALTER TABLE public.schedule_sessions
    ENABLE TRIGGER coordination_sessions_final;

  SELECT coalesce(array_agg(q.session_id ORDER BY q.session_id), ARRAY[]::uuid[])
    INTO v_conflicts_after
  FROM (
    SELECT DISTINCT s.id AS session_id
    FROM public.schedule_sessions s
    JOIN public.instructors si ON si.id = s.instructor_id
    JOIN schedule_coordination_private.busy(v_draft_version) b
      ON b.instructor_id = s.instructor_id
     AND b.day_of_week = s.day_of_week
     AND b.start_time < s.end_time
     AND s.start_time < b.end_time
    WHERE s.schedule_version_id = v_draft_version
      AND NOT coalesce(s.replaced_by_split, false)
      AND si.employee_number IS DISTINCT FROM 'SYSTEM-NO-INSTRUCTOR-ADMIN'
      AND NOT EXISTS (
        SELECT 1
        FROM public.schedule_version_conflict_exceptions e
        WHERE e.schedule_version_id = v_draft_version
          AND e.session_id = s.id
          AND e.status = 'approved'
          AND e.approval_type = 'cross_college_instructor'
          AND e.conflict_code IN (
            'instructor_conflict', 'cross_college_instructor_conflict'
          )
      )
  ) q;

  IF v_conflicts_after IS DISTINCT FROM v_conflicts_before
     OR v_draft_session = ANY(v_conflicts_after) THEN
    RAISE EXCEPTION
      'IS101_REPAIR_CHANGED_CROSS_COLLEGE_CONFLICT_SET: before=%, after=%',
      v_conflicts_before, v_conflicts_after;
  END IF;

  INSERT INTO public.audit_logs(
    actor_id, action, entity, entity_id, college_id, details
  ) VALUES (
    auth.uid(), 'unify_cohort_component_instructor', 'teaching_assignments',
    v_new_assignment, v_arts_college,
    jsonb_build_object(
      'course_code', 'IS101',
      'component', 'theory',
      'selected_instructor_id', v_salwa,
      'replaced_instructor_id', v_amer,
      'deactivated_assignment_id', v_amer_assignment,
      'new_assignment_id', v_new_assignment,
      'draft_session_id', v_draft_session,
      'immutable_sessions_preserved', v_immutable_count,
      'inherited_cross_college_conflicts_unchanged', v_conflicts_after,
      'reason', 'available conflict-free candidate selected by user'
    )
  );

  -- The placeholder is intentional. Give it a truthful non-external category
  -- instead of inventing availability for a person who has not been named.
  SELECT it.id INTO v_type_id
  FROM public.instructor_types it
  WHERE it.college_id = v_finance_college
    AND lower(it.code) = 'unspecified'
  FOR UPDATE;

  IF v_type_id IS NULL THEN
    INSERT INTO public.instructor_types(
      id, college_id, code, name_ar, name_en, is_external,
      description, color, display_order, is_active
    ) VALUES (
      v_unspecified_type, v_finance_college, 'unspecified',
      'غير محدد', 'Unspecified', false,
      'سجل مؤقت لمحاضر لم تُحدد هويته بعد؛ لا يتطلب إتاحة ولا يجوز إسناد عمل جديد إليه.',
      'slate', 99, true
    )
    RETURNING id INTO v_type_id;
  ELSIF EXISTS (
    SELECT 1 FROM public.instructor_types
    WHERE id = v_type_id AND is_external
  ) THEN
    RAISE EXCEPTION 'UNSPECIFIED_INSTRUCTOR_TYPE_MUST_NOT_BE_EXTERNAL';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.instructors i
    WHERE i.id = v_placeholder
      AND i.college_id = v_finance_college
      AND i.affiliation_college_id = v_finance_college
      AND i.external_source = 'system_placeholder'
      AND coalesce(i.full_name_ar, i.full_name) IN ('—', 'غير محدد')
  ) THEN
    RAISE EXCEPTION 'FINANCE_PLACEHOLDER_BASELINE_CHANGED';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.teaching_assignments ta
    WHERE ta.instructor_id = v_placeholder AND ta.is_active
  ) THEN
    RAISE EXCEPTION 'FINANCE_PLACEHOLDER_HAS_ACTIVE_ASSIGNMENTS';
  END IF;

  UPDATE public.instructors
  SET full_name = 'غير محدد',
      full_name_ar = 'غير محدد',
      full_name_en = 'Unspecified',
      instructor_type_id = v_type_id,
      employment_type = 'unknown',
      availability_status = 'unavailable',
      max_weekly_hours = NULL,
      notes = 'سجل مؤقت لمحاضر غير محدد تابع لكلية العلوم الإدارية والمالية؛ لا يمثل هوية شخص بعينه ولا يكتسب نصابًا أو إتاحة مفترضة، ويجب استبداله بمحاضر فعلي قبل الاعتماد النهائي.'
  WHERE id = v_placeholder;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'FINANCE_PLACEHOLDER_UPDATE_FAILED';
  END IF;

  INSERT INTO public.audit_logs(
    actor_id, action, entity, entity_id, college_id, details
  ) VALUES (
    auth.uid(), 'normalize_unspecified_instructor_placeholder', 'instructors',
    v_placeholder, v_finance_college,
    jsonb_build_object(
      'name', 'غير محدد',
      'type_code', 'unspecified',
      'home_college_id', v_finance_college,
      'availability_status', 'unavailable',
      'active_assignments', 0,
      'existing_sessions_preserved', (
        SELECT count(*) FROM public.schedule_sessions
        WHERE instructor_id = v_placeholder
      )
    )
  );
END
$repair$;

COMMIT;
