-- PHASE-6: Explicit capacity-split approval RPC (SOURCE ONLY — do not auto-apply).
-- Creates section_subgroups rows only. Never inserts/updates schedule_sessions.
-- Requires prior schema: section_subgroups + course_offerings enrollment trust columns.

CREATE OR REPLACE FUNCTION public.approve_capacity_split_proposal(
  p_college_id uuid,
  p_course_offering_id uuid,
  p_section_id uuid,
  p_source_session_id uuid,
  p_expected_students integer,
  p_expected_enrollment_count_updated_at timestamptz,
  p_room_id uuid,
  p_room_capacity integer,
  p_groups jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_offering public.course_offerings%ROWTYPE;
  v_section public.sections%ROWTYPE;
  v_session public.schedule_sessions%ROWTYPE;
  v_room public.rooms%ROWTYPE;
  v_group jsonb;
  v_groups_count integer;
  v_sum integer := 0;
  v_min_sz integer;
  v_max_sz integer;
  v_ord integer;
  v_code text;
  v_sz integer;
  v_i integer;
  v_min_groups integer;
  v_cap_plus integer;
  v_existing_count integer;
  v_match boolean;
  v_created jsonb := '[]'::jsonb;
  v_existing jsonb := '[]'::jsonb;
  v_row public.section_subgroups%ROWTYPE;
  v_approval_ref text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'UNAUTHORIZED', 'stale', false,
      'message_ar', 'يجب تسجيل الدخول.',
      'created_subgroup_ids', '[]'::jsonb
    );
  END IF;

  IF p_college_id IS NULL OR p_course_offering_id IS NULL OR p_section_id IS NULL
     OR p_source_session_id IS NULL OR p_room_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'INVALID_ARGS', 'stale', false,
      'message_ar', 'معاملات الاعتماد غير مكتملة.',
      'created_subgroup_ids', '[]'::jsonb
    );
  END IF;

  IF NOT public.can_manage_college(v_uid, p_college_id) THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'FORBIDDEN_COLLEGE', 'stale', false,
      'message_ar', 'لا تملك صلاحية إدارة هذه الكلية.',
      'created_subgroup_ids', '[]'::jsonb
    );
  END IF;

  -- Serialize concurrent approvals for the same section.
  PERFORM pg_advisory_xact_lock(hashtext(p_section_id::text));

  SELECT * INTO v_offering
  FROM public.course_offerings
  WHERE id = p_course_offering_id
  FOR UPDATE;

  IF NOT FOUND OR v_offering.college_id IS DISTINCT FROM p_college_id THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'OFFERING_NOT_FOUND', 'stale', false,
      'message_ar', 'العرض الدراسي غير موجود أو خارج الكلية.',
      'created_subgroup_ids', '[]'::jsonb
    );
  END IF;

  IF v_offering.enrollment_count_status IS DISTINCT FROM 'confirmed' THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'ENROLLMENT_NOT_CONFIRMED', 'stale', false,
      'message_ar', 'لا يمكن اعتماد التقسيم إلا عندما تكون حالة العدد مؤكدة.',
      'created_subgroup_ids', '[]'::jsonb
    );
  END IF;

  IF p_expected_students IS NULL OR p_expected_students < 0
     OR v_offering.expected_students IS DISTINCT FROM p_expected_students THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'ENROLLMENT_COUNT_MISMATCH', 'stale', true,
      'message_ar', 'عدد الطلاب لا يطابق القيمة المؤكدة الحالية. أعد التحميل.',
      'created_subgroup_ids', '[]'::jsonb
    );
  END IF;

  IF p_expected_enrollment_count_updated_at IS NULL
     OR v_offering.enrollment_count_updated_at IS DISTINCT FROM p_expected_enrollment_count_updated_at THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'STALE_ENROLLMENT', 'stale', true,
      'message_ar', 'تغيّر عدد الطلاب أو موثوقيته منذ اقتراح التقسيم. أعد التحميل ثم حاول مجددًا.',
      'created_subgroup_ids', '[]'::jsonb
    );
  END IF;

  SELECT * INTO v_section
  FROM public.sections
  WHERE id = p_section_id
  FOR UPDATE;

  IF NOT FOUND OR v_section.college_id IS DISTINCT FROM p_college_id THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'SECTION_NOT_FOUND', 'stale', false,
      'message_ar', 'الشعبة غير موجودة أو خارج الكلية.',
      'created_subgroup_ids', '[]'::jsonb
    );
  END IF;

  IF v_section.course_id IS DISTINCT FROM v_offering.course_id
     OR v_section.term_id IS DISTINCT FROM v_offering.term_id THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'SECTION_OFFERING_MISMATCH', 'stale', false,
      'message_ar', 'الشعبة لا تطابق مقرر/فصل العرض الدراسي.',
      'created_subgroup_ids', '[]'::jsonb
    );
  END IF;

  -- Source session used for audit context only — never modified.
  SELECT * INTO v_session
  FROM public.schedule_sessions
  WHERE id = p_source_session_id;

  IF NOT FOUND
     OR v_session.college_id IS DISTINCT FROM p_college_id
     OR v_session.course_offering_id IS DISTINCT FROM p_course_offering_id
     OR v_session.section_id IS DISTINCT FROM p_section_id THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'SESSION_CONTEXT_INVALID', 'stale', false,
      'message_ar', 'سياق الجلسة المصدر غير صالح للاعتماد.',
      'created_subgroup_ids', '[]'::jsonb
    );
  END IF;

  SELECT * INTO v_room
  FROM public.rooms
  WHERE id = p_room_id;

  IF NOT FOUND OR v_room.college_id IS DISTINCT FROM p_college_id OR COALESCE(v_room.is_active, false) = false THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'ROOM_NOT_FOUND', 'stale', false,
      'message_ar', 'القاعة غير موجودة أو غير نشطة في الكلية.',
      'created_subgroup_ids', '[]'::jsonb
    );
  END IF;

  IF p_room_capacity IS NULL OR p_room_capacity <= 0
     OR v_room.capacity IS DISTINCT FROM p_room_capacity THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'ROOM_CAPACITY_MISMATCH', 'stale', true,
      'message_ar', 'سعة القاعة لا تطابق المخزون الحي. أعد حساب الاقتراح.',
      'created_subgroup_ids', '[]'::jsonb
    );
  END IF;

  v_cap_plus := p_room_capacity + 5;
  IF p_expected_students <= v_cap_plus THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'SPLIT_NOT_REQUIRED', 'stale', false,
      'message_ar', 'العدد المؤكد لا يتجاوز السعة مع استثناء +5؛ لا حاجة لتقسيم.',
      'created_subgroup_ids', '[]'::jsonb
    );
  END IF;

  IF p_groups IS NULL OR jsonb_typeof(p_groups) <> 'array' THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'INVALID_GROUPS', 'stale', false,
      'message_ar', 'توزيع المجموعات غير صالح.',
      'created_subgroup_ids', '[]'::jsonb
    );
  END IF;

  v_groups_count := jsonb_array_length(p_groups);
  v_min_groups := LEAST(4, GREATEST(2, CEIL(p_expected_students::numeric / v_cap_plus)::integer));

  IF v_groups_count IS DISTINCT FROM v_min_groups OR v_groups_count < 2 OR v_groups_count > 4 THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'GROUPS_COUNT_MISMATCH', 'stale', false,
      'message_ar', 'عدد المجموعات لا يطابق معادلة التقسيم المعتمدة.',
      'created_subgroup_ids', '[]'::jsonb
    );
  END IF;

  v_min_sz := NULL;
  v_max_sz := NULL;
  FOR v_i IN 0 .. (v_groups_count - 1) LOOP
    v_group := p_groups -> v_i;
    v_ord := (v_group ->> 'ordinal')::integer;
    v_code := v_group ->> 'subgroup_code';
    v_sz := (v_group ->> 'expected_students')::integer;

    IF v_ord IS DISTINCT FROM (v_i + 1)
       OR v_code IS DISTINCT FROM (ARRAY['A','B','C','D'])[v_i + 1]
       OR v_sz IS NULL OR v_sz < 0 OR v_sz > v_cap_plus THEN
      RETURN jsonb_build_object(
        'ok', false, 'code', 'INVALID_GROUP_ROW', 'stale', false,
        'message_ar', 'صف مجموعة غير صالح أو يتجاوز سعة القاعة +5.',
        'created_subgroup_ids', '[]'::jsonb
      );
    END IF;

    v_sum := v_sum + v_sz;
    IF v_min_sz IS NULL OR v_sz < v_min_sz THEN v_min_sz := v_sz; END IF;
    IF v_max_sz IS NULL OR v_sz > v_max_sz THEN v_max_sz := v_sz; END IF;
  END LOOP;

  IF v_sum IS DISTINCT FROM p_expected_students OR (v_max_sz - v_min_sz) > 1 THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'UNBALANCED_OR_SUM_MISMATCH', 'stale', false,
      'message_ar', 'توزيع الطلاب غير متوازن أو لا يساوي العدد المؤكد.',
      'created_subgroup_ids', '[]'::jsonb
    );
  END IF;

  v_approval_ref := 'capacity_split:' || p_section_id::text || ':' || p_course_offering_id::text;

  SELECT COUNT(*)::integer INTO v_existing_count
  FROM public.section_subgroups
  WHERE section_id = p_section_id AND is_active = true;

  IF v_existing_count > 0 THEN
    v_match := true;
    IF v_existing_count IS DISTINCT FROM v_groups_count THEN
      v_match := false;
    ELSE
      FOR v_i IN 0 .. (v_groups_count - 1) LOOP
        v_group := p_groups -> v_i;
        SELECT * INTO v_row
        FROM public.section_subgroups
        WHERE section_id = p_section_id
          AND is_active = true
          AND ordinal = (v_group ->> 'ordinal')::smallint
          AND subgroup_code = (v_group ->> 'subgroup_code')
          AND expected_students = (v_group ->> 'expected_students')::integer
          AND source_policy = 'capacity_split_owner_approved'
          AND owner_approval_ref = v_approval_ref;
        IF NOT FOUND THEN
          v_match := false;
          EXIT;
        END IF;
        v_existing := v_existing || jsonb_build_array(v_row.id);
      END LOOP;
    END IF;

    IF v_match THEN
      RETURN jsonb_build_object(
        'ok', true, 'code', 'ALREADY_APPROVED', 'stale', false,
        'message_ar', 'معتمدة — بانتظار الجدولة',
        'status_ar', 'معتمدة — بانتظار الجدولة',
        'created_subgroup_ids', v_existing,
        'sessions_created', false,
        'source_session_modified', false
      );
    END IF;

    RETURN jsonb_build_object(
      'ok', false, 'code', 'EXISTING_SUBGROUPS', 'stale', false,
      'message_ar', 'توجد مجموعات فرعية نشطة لهذه الشعبة بتكوين مختلف.',
      'created_subgroup_ids', '[]'::jsonb
    );
  END IF;

  FOR v_i IN 0 .. (v_groups_count - 1) LOOP
    v_group := p_groups -> v_i;
    INSERT INTO public.section_subgroups (
      college_id, section_id, course_id, academic_term_id, teaching_assignment_id,
      subgroup_code, ordinal, expected_students, study_system, is_active,
      source_policy, owner_approval_ref, notes
    ) VALUES (
      p_college_id,
      p_section_id,
      v_offering.course_id,
      v_offering.term_id,
      v_session.teaching_assignment_id,
      v_group ->> 'subgroup_code',
      (v_group ->> 'ordinal')::smallint,
      (v_group ->> 'expected_students')::integer,
      COALESCE(NULLIF(v_section.study_system, ''), 'regular'),
      true,
      'capacity_split_owner_approved',
      v_approval_ref,
      'Approved split proposal; sessions not created.'
    )
    RETURNING * INTO v_row;

    v_created := v_created || jsonb_build_array(v_row.id);
  END LOOP;

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (
    v_uid,
    'approve_capacity_split_proposal',
    'section_subgroups',
    p_section_id,
    p_college_id,
    jsonb_build_object(
      'course_offering_id', p_course_offering_id,
      'source_session_id', p_source_session_id,
      'expected_students', p_expected_students,
      'enrollment_count_updated_at', p_expected_enrollment_count_updated_at,
      'room_id', p_room_id,
      'room_capacity', p_room_capacity,
      'groups', p_groups,
      'created_subgroup_ids', v_created,
      'sessions_created', false,
      'source_session_modified', false,
      'status_ar', 'معتمدة — بانتظار الجدولة'
    )
  );

  RETURN jsonb_build_object(
    'ok', true, 'code', 'APPROVED', 'stale', false,
    'message_ar', 'معتمدة — بانتظار الجدولة',
    'status_ar', 'معتمدة — بانتظار الجدولة',
    'created_subgroup_ids', v_created,
    'sessions_created', false,
    'source_session_modified', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_capacity_split_proposal(
  uuid, uuid, uuid, uuid, integer, timestamptz, uuid, integer, jsonb
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.approve_capacity_split_proposal(
  uuid, uuid, uuid, uuid, integer, timestamptz, uuid, integer, jsonb
) TO authenticated, service_role;

COMMENT ON FUNCTION public.approve_capacity_split_proposal(
  uuid, uuid, uuid, uuid, integer, timestamptz, uuid, integer, jsonb
) IS
  'Owner-approved capacity split: inserts section_subgroups only. Never creates or modifies schedule_sessions.';