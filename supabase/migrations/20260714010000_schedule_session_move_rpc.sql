-- =========================================================
-- Phase 6: schedule session move validate + save RPCs
-- Local migration only — DO NOT auto-apply in agent gates.
-- =========================================================

-- Shared conflict collector for one proposed move (mirrors validateProposed + daily_breaks / working hours).
CREATE OR REPLACE FUNCTION public._collect_schedule_session_move_conflicts(
  p_session_id uuid,
  p_college_id uuid,
  p_version_id uuid,
  p_instructor_id uuid,
  p_section_id uuid,
  p_course_offering_id uuid,
  p_teaching_assignment_id uuid,
  p_study_system text,
  p_expected_students integer,
  p_day_of_week integer,
  p_start_time time,
  p_end_time time,
  p_room_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conflicts jsonb := '[]'::jsonb;
  v_peer record;
  v_room record;
  v_expected integer;
  v_required_type text;
  v_instr_type_code text;
  v_instr_is_external boolean;
  v_requires_avail boolean;
  v_hard_count integer;
  v_fits boolean;
  v_blocked boolean;
  v_tmpl_count integer;
  v_settings record;
  v_break record;
  v_conflict jsonb;
  v_approved boolean;
  v_ex_id uuid;
  v_ex_reason text;
  v_primary uuid;
  v_secondary uuid;
  v_enriched jsonb := '[]'::jsonb;
  v_blocking jsonb := '[]'::jsonb;
  v_approved_list jsonb := '[]'::jsonb;
  v_item jsonb;
BEGIN
  -- Peer overlaps (exclude self)
  FOR v_peer IN
    SELECT id, instructor_id, room_id, section_id, day_of_week, start_time, end_time
    FROM public.schedule_sessions
    WHERE college_id = p_college_id
      AND schedule_version_id = p_version_id
      AND id <> p_session_id
  LOOP
    IF v_peer.instructor_id = p_instructor_id
       AND v_peer.day_of_week = p_day_of_week
       AND v_peer.start_time < p_end_time
       AND p_start_time < v_peer.end_time
    THEN
      v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
        'code', 'instructor_conflict',
        'severity', 'hard',
        'message_ar', 'تعارض المحاضر: نفس المحاضر لديه محاضرة أخرى في نفس الوقت.',
        'message_en', 'Instructor conflict: same instructor has another overlapping session.',
        'schedule_session_id', p_session_id,
        'related_session_id', v_peer.id,
        'metadata', jsonb_build_object('instructor_id', p_instructor_id, 'day_of_week', p_day_of_week)
      ));
    END IF;

    IF p_room_id IS NOT NULL
       AND v_peer.room_id IS NOT NULL
       AND v_peer.room_id = p_room_id
       AND v_peer.day_of_week = p_day_of_week
       AND v_peer.start_time < p_end_time
       AND p_start_time < v_peer.end_time
    THEN
      v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
        'code', 'room_conflict',
        'severity', 'hard',
        'message_ar', 'تعارض القاعة: نفس القاعة محجوزة في نفس الوقت.',
        'message_en', 'Room conflict: same room is booked at the same time.',
        'schedule_session_id', p_session_id,
        'related_session_id', v_peer.id,
        'metadata', jsonb_build_object('room_id', p_room_id, 'day_of_week', p_day_of_week)
      ));
    END IF;

    IF p_section_id IS NOT NULL
       AND v_peer.section_id IS NOT NULL
       AND v_peer.section_id = p_section_id
       AND v_peer.day_of_week = p_day_of_week
       AND v_peer.start_time < p_end_time
       AND p_start_time < v_peer.end_time
    THEN
      v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
        'code', 'section_conflict',
        'severity', 'hard',
        'message_ar', 'تعارض المجموعة: نفس المجموعة لديها محاضرة أخرى في نفس الوقت.',
        'message_en', 'Section conflict: same section has another overlapping session.',
        'schedule_session_id', p_session_id,
        'related_session_id', v_peer.id,
        'metadata', jsonb_build_object('section_id', p_section_id, 'day_of_week', p_day_of_week)
      ));
    END IF;
  END LOOP;

  -- Room capacity / type / college
  IF p_room_id IS NOT NULL THEN
    SELECT id, capacity, college_id, room_type, is_active
      INTO v_room
    FROM public.rooms
    WHERE id = p_room_id;

    IF v_room.id IS NULL OR v_room.college_id <> p_college_id OR COALESCE(v_room.is_active, true) = false THEN
      v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
        'code', 'room_college_mismatch',
        'severity', 'hard',
        'message_ar', 'القاعة غير صالحة أو لا تنتمي إلى الكلية.',
        'message_en', 'Room is invalid or not in the active college.',
        'schedule_session_id', p_session_id,
        'related_session_id', NULL,
        'metadata', jsonb_build_object('room_id', p_room_id)
      ));
    ELSE
      v_expected := COALESCE(p_expected_students, 0);
      IF v_expected = 0 THEN
        SELECT COALESCE(expected_students, 0) INTO v_expected
        FROM public.course_offerings
        WHERE id = p_course_offering_id;
        v_expected := COALESCE(v_expected, 0);
      END IF;
      IF v_expected > 0 AND v_room.capacity < v_expected THEN
        v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
          'code', 'room_capacity',
          'severity', 'hard',
          'message_ar', format('سعة القاعة غير كافية: السعة %s والعدد المتوقع %s.', v_room.capacity, v_expected),
          'message_en', format('Room capacity insufficient: capacity %s, expected %s.', v_room.capacity, v_expected),
          'schedule_session_id', p_session_id,
          'related_session_id', NULL,
          'metadata', jsonb_build_object('capacity', v_room.capacity, 'expected_students', v_expected)
        ));
      END IF;

      IF p_teaching_assignment_id IS NOT NULL THEN
        SELECT required_room_type INTO v_required_type
        FROM public.teaching_assignments
        WHERE id = p_teaching_assignment_id AND college_id = p_college_id;
        IF v_required_type IS NOT NULL AND v_room.room_type IS DISTINCT FROM v_required_type THEN
          v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
            'code', 'room_type_mismatch',
            'severity', 'hard',
            'message_ar', format('نوع القاعة لا يطابق المطلوب: المطلوب %s والقاعة %s.', v_required_type, COALESCE(v_room.room_type, 'unknown')),
            'message_en', format('Room type mismatch: required %s, room is %s.', v_required_type, COALESCE(v_room.room_type, 'unknown')),
            'schedule_session_id', p_session_id,
            'related_session_id', NULL,
            'metadata', jsonb_build_object(
              'required_room_type', v_required_type,
              'room_type', v_room.room_type,
              'room_id', p_room_id,
              'teaching_assignment_id', p_teaching_assignment_id
            )
          ));
        END IF;
      END IF;

      -- Room availability windows (if any for day)
      SELECT COUNT(*) INTO v_hard_count
      FROM public.room_availability
      WHERE room_id = p_room_id AND day_of_week = p_day_of_week AND college_id = p_college_id;
      IF v_hard_count > 0 THEN
        SELECT EXISTS (
          SELECT 1 FROM public.room_availability ra
          WHERE ra.room_id = p_room_id
            AND ra.day_of_week = p_day_of_week
            AND ra.college_id = p_college_id
            AND p_start_time >= ra.start_time
            AND p_end_time <= ra.end_time
        ) INTO v_fits;
        IF NOT v_fits THEN
          v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
            'code', 'room_availability',
            'severity', 'hard',
            'message_ar', 'المحاضرة خارج نطاق توفّر القاعة المحدد.',
            'message_en', 'Session outside room''s defined availability window.',
            'schedule_session_id', p_session_id,
            'related_session_id', NULL,
            'metadata', jsonb_build_object('room_id', p_room_id, 'day_of_week', p_day_of_week)
          ));
        END IF;
      END IF;
    END IF;
  END IF;

  -- Instructor availability (category rules)
  SELECT it.code, it.is_external
    INTO v_instr_type_code, v_instr_is_external
  FROM public.instructors i
  LEFT JOIN public.instructor_types it ON it.id = i.instructor_type_id
  WHERE i.id = p_instructor_id;

  v_requires_avail := (
    lower(COALESCE(v_instr_type_code, '')) = 'from_other_college'
    OR COALESCE(v_instr_is_external, false) = true
  );

  SELECT COUNT(*) INTO v_hard_count
  FROM public.instructor_availability ia
  WHERE ia.instructor_id = p_instructor_id
    AND ia.day_of_week = p_day_of_week
    AND ia.is_preference = false
    AND ia.college_id = p_college_id;

  IF v_hard_count = 0 THEN
    IF v_requires_avail THEN
      v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
        'code', 'instructor_availability_required',
        'severity', 'hard',
        'message_ar', CASE
          WHEN COALESCE(v_instr_is_external, false) THEN 'المحاضر الخارجي يتطلب تعريف أوقات التوفر قبل الجدولة.'
          ELSE 'المحاضر من كلية أخرى يتطلب تعريف أوقات التوفر قبل الجدولة.'
        END,
        'message_en', 'Instructor availability is mandatory for this category and not defined.',
        'schedule_session_id', p_session_id,
        'related_session_id', NULL,
        'metadata', jsonb_build_object('instructor_id', p_instructor_id, 'day_of_week', p_day_of_week)
      ));
    END IF;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM public.instructor_availability ia
      WHERE ia.instructor_id = p_instructor_id
        AND ia.day_of_week = p_day_of_week
        AND ia.is_preference = false
        AND ia.college_id = p_college_id
        AND ia.availability_type IS DISTINCT FROM 'unavailable'
        AND p_start_time >= ia.start_time
        AND p_end_time <= ia.end_time
    ) INTO v_fits;
    SELECT EXISTS (
      SELECT 1 FROM public.instructor_availability ia
      WHERE ia.instructor_id = p_instructor_id
        AND ia.day_of_week = p_day_of_week
        AND ia.is_preference = false
        AND ia.college_id = p_college_id
        AND ia.availability_type = 'unavailable'
        AND ia.start_time < p_end_time
        AND p_start_time < ia.end_time
    ) INTO v_blocked;
    IF (NOT v_fits) OR v_blocked THEN
      v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
        'code', 'instructor_availability',
        'severity', 'hard',
        'message_ar', 'المحاضرة خارج نطاق توفّر المحاضر الإلزامي.',
        'message_en', 'Session outside instructor''s hard availability window.',
        'schedule_session_id', p_session_id,
        'related_session_id', NULL,
        'metadata', jsonb_build_object('instructor_id', p_instructor_id, 'day_of_week', p_day_of_week)
      ));
    END IF;
  END IF;

  -- Study-system time templates
  SELECT COUNT(*) INTO v_tmpl_count
  FROM public.time_slot_templates tt
  WHERE tt.college_id = p_college_id
    AND tt.is_active = true
    AND tt.day_of_week = p_day_of_week
    AND (
      tt.study_system = p_study_system
      OR tt.study_system = 'both'
      OR p_study_system = 'both'
    );

  IF v_tmpl_count > 0 THEN
    SELECT EXISTS (
      SELECT 1 FROM public.time_slot_templates tt
      WHERE tt.college_id = p_college_id
        AND tt.is_active = true
        AND tt.day_of_week = p_day_of_week
        AND (
          tt.study_system = p_study_system
          OR tt.study_system = 'both'
          OR p_study_system = 'both'
        )
        AND p_start_time >= tt.start_time
        AND p_end_time <= tt.end_time
    ) INTO v_fits;
    IF NOT v_fits THEN
      v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
        'code', 'study_system_time_template',
        'severity', 'hard',
        'message_ar', 'المحاضرة خارج قوالب أوقات المحاضرات المسموحة لنظام الدراسة.',
        'message_en', 'Session outside allowed time-slot templates for the study system.',
        'schedule_session_id', p_session_id,
        'related_session_id', NULL,
        'metadata', jsonb_build_object('study_system', p_study_system, 'day_of_week', p_day_of_week)
      ));
    END IF;
  END IF;

  -- Working days / hours from scheduling_settings
  SELECT working_days, day_start_time, day_end_time
    INTO v_settings
  FROM public.scheduling_settings
  WHERE college_id = p_college_id
  LIMIT 1;

  IF v_settings.working_days IS NOT NULL
     AND cardinality(v_settings.working_days) > 0
     AND NOT (p_day_of_week = ANY (v_settings.working_days))
  THEN
    v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
      'code', 'outside_working_days',
      'severity', 'hard',
      'message_ar', 'اليوم المقترح خارج أيام العمل المعتمدة للكلية.',
      'message_en', 'Proposed day is outside configured working days.',
      'schedule_session_id', p_session_id,
      'related_session_id', NULL,
      'metadata', jsonb_build_object('day_of_week', p_day_of_week)
    ));
  END IF;

  IF v_settings.day_start_time IS NOT NULL AND v_settings.day_end_time IS NOT NULL THEN
    IF p_start_time < v_settings.day_start_time OR p_end_time > v_settings.day_end_time THEN
      v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
        'code', 'outside_working_hours',
        'severity', 'hard',
        'message_ar', 'الوقت المقترح خارج ساعات الدوام المعتمدة.',
        'message_en', 'Proposed time is outside configured working hours.',
        'schedule_session_id', p_session_id,
        'related_session_id', NULL,
        'metadata', jsonb_build_object(
          'day_start_time', v_settings.day_start_time,
          'day_end_time', v_settings.day_end_time
        )
      ));
    END IF;
  END IF;

  -- Daily breaks that affect scheduling
  FOR v_break IN
    SELECT id, name, days, start_time, end_time
    FROM public.daily_breaks
    WHERE college_id = p_college_id
      AND affects_scheduling = true
      AND p_day_of_week = ANY (days)
      AND start_time < p_end_time
      AND p_start_time < end_time
  LOOP
    v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
      'code', 'daily_break',
      'severity', 'hard',
      'message_ar', format('التعارض مع استراحة يومية: %s.', v_break.name),
      'message_en', format('Overlaps daily break: %s.', v_break.name),
      'schedule_session_id', p_session_id,
      'related_session_id', NULL,
      'metadata', jsonb_build_object('daily_break_id', v_break.id, 'name', v_break.name)
    ));
  END LOOP;

  -- Enrich with approved exceptions
  FOR v_conflict IN SELECT elem FROM jsonb_array_elements(v_conflicts) AS t(elem)
  LOOP
    v_approved := false;
    v_ex_id := NULL;
    v_ex_reason := NULL;

    IF (v_conflict->>'schedule_session_id') IS NOT NULL THEN
      v_primary := (v_conflict->>'schedule_session_id')::uuid;
      IF v_conflict->>'related_session_id' IS NULL OR v_conflict->>'related_session_id' = 'null' THEN
        SELECT id, reason INTO v_ex_id, v_ex_reason
        FROM public.schedule_version_conflict_exceptions
        WHERE schedule_version_id = p_version_id
          AND conflict_code = v_conflict->>'code'
          AND status = 'approved'
          AND session_id = v_primary
          AND related_session_id IS NULL
        LIMIT 1;
      ELSE
        v_secondary := (v_conflict->>'related_session_id')::uuid;
        SELECT id, reason INTO v_ex_id, v_ex_reason
        FROM public.schedule_version_conflict_exceptions
        WHERE schedule_version_id = p_version_id
          AND conflict_code = v_conflict->>'code'
          AND status = 'approved'
          AND related_session_id IS NOT NULL
          AND LEAST(session_id, related_session_id) = LEAST(v_primary, v_secondary)
          AND GREATEST(session_id, related_session_id) = GREATEST(v_primary, v_secondary)
        LIMIT 1;
      END IF;

      IF FOUND THEN
        v_approved := true;
      ELSE
        v_ex_id := NULL;
        v_ex_reason := NULL;
      END IF;
    END IF;

    v_item := v_conflict || jsonb_build_object(
      'approved_exception', v_approved,
      'exception_id', v_ex_id,
      'exception_reason', v_ex_reason
    );
    v_enriched := v_enriched || jsonb_build_array(v_item);
    IF v_approved THEN
      v_approved_list := v_approved_list || jsonb_build_array(v_item);
    ELSE
      v_blocking := v_blocking || jsonb_build_array(v_item);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'all_conflicts', v_enriched,
    'blocking_conflicts', v_blocking,
    'approved_exceptions', v_approved_list,
    'warnings', '[]'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public._collect_schedule_session_move_conflicts(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, integer, integer, time, time, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._collect_schedule_session_move_conflicts(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, integer, integer, time, time, uuid
) TO service_role;

-- =========================================================
-- Validate only (no writes)
-- =========================================================
CREATE OR REPLACE FUNCTION public.validate_schedule_session_move(
  p_session_id uuid,
  p_expected_updated_at timestamptz,
  p_target_day_of_week integer,
  p_target_start_time time,
  p_target_end_time time,
  p_target_room_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_session public.schedule_sessions%ROWTYPE;
  v_version_status text;
  v_bundle jsonb;
  v_normalized jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object(
      'valid', false,
      'blocking_conflicts', '[]'::jsonb,
      'warnings', '[]'::jsonb,
      'approved_exceptions', '[]'::jsonb,
      'stale', false,
      'normalized_proposal', NULL,
      'code', 'UNAUTHORIZED',
      'message_ar', 'يجب تسجيل الدخول.'
    );
  END IF;

  IF p_target_day_of_week IS NULL OR p_target_day_of_week < 0 OR p_target_day_of_week > 6 THEN
    RETURN jsonb_build_object(
      'valid', false, 'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb,
      'approved_exceptions', '[]'::jsonb, 'stale', false, 'normalized_proposal', NULL,
      'code', 'INVALID_DAY', 'message_ar', 'يوم غير صالح.'
    );
  END IF;

  IF p_target_start_time IS NULL OR p_target_end_time IS NULL OR p_target_end_time <= p_target_start_time THEN
    RETURN jsonb_build_object(
      'valid', false, 'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb,
      'approved_exceptions', '[]'::jsonb, 'stale', false, 'normalized_proposal', NULL,
      'code', 'INVALID_TIME_RANGE', 'message_ar', 'نطاق الوقت غير صالح.'
    );
  END IF;

  SELECT * INTO v_session
  FROM public.schedule_sessions
  WHERE id = p_session_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'valid', false, 'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb,
      'approved_exceptions', '[]'::jsonb, 'stale', false, 'normalized_proposal', NULL,
      'code', 'NOT_FOUND', 'message_ar', 'الجلسة غير موجودة.'
    );
  END IF;

  IF NOT public.can_manage_college(v_uid, v_session.college_id) THEN
    RETURN jsonb_build_object(
      'valid', false, 'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb,
      'approved_exceptions', '[]'::jsonb, 'stale', false, 'normalized_proposal', NULL,
      'code', 'FORBIDDEN_COLLEGE', 'message_ar', 'لا تملك صلاحية إدارة هذه الكلية.'
    );
  END IF;

  SELECT status INTO v_version_status
  FROM public.schedule_versions
  WHERE id = v_session.schedule_version_id;

  IF v_version_status IS NULL THEN
    RETURN jsonb_build_object(
      'valid', false, 'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb,
      'approved_exceptions', '[]'::jsonb, 'stale', false, 'normalized_proposal', NULL,
      'code', 'NOT_FOUND', 'message_ar', 'نسخة الجدول غير موجودة.'
    );
  END IF;

  IF v_version_status IN ('published', 'archived') THEN
    RETURN jsonb_build_object(
      'valid', false, 'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb,
      'approved_exceptions', '[]'::jsonb, 'stale', false, 'normalized_proposal', NULL,
      'code', 'VERSION_LOCKED', 'message_ar', 'هذه النسخة غير قابلة للتعديل.'
    );
  END IF;

  IF COALESCE(v_session.is_locked, false) THEN
    RETURN jsonb_build_object(
      'valid', false, 'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb,
      'approved_exceptions', '[]'::jsonb, 'stale', false, 'normalized_proposal', NULL,
      'code', 'SESSION_LOCKED', 'message_ar', 'هذه الجلسة مقفلة.'
    );
  END IF;

  IF p_expected_updated_at IS NULL OR v_session.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object(
      'valid', false, 'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb,
      'approved_exceptions', '[]'::jsonb, 'stale', true, 'normalized_proposal', NULL,
      'code', 'STALE_SESSION', 'message_ar', 'تغيرت الجلسة منذ تحميلها. أعد التحميل ثم حاول مجددًا.'
    );
  END IF;

  v_normalized := jsonb_build_object(
    'day_of_week', p_target_day_of_week,
    'start_time', p_target_start_time,
    'end_time', p_target_end_time,
    'room_id', p_target_room_id
  );

  v_bundle := public._collect_schedule_session_move_conflicts(
    v_session.id,
    v_session.college_id,
    v_session.schedule_version_id,
    v_session.instructor_id,
    v_session.section_id,
    v_session.course_offering_id,
    v_session.teaching_assignment_id,
    v_session.study_system,
    v_session.expected_students,
    p_target_day_of_week,
    p_target_start_time,
    p_target_end_time,
    p_target_room_id
  );

  RETURN jsonb_build_object(
    'valid',
      jsonb_array_length(COALESCE(v_bundle->'blocking_conflicts', '[]'::jsonb)) = 0
      AND jsonb_array_length(COALESCE(v_bundle->'warnings', '[]'::jsonb)) = 0,
    'blocking_conflicts', COALESCE(v_bundle->'blocking_conflicts', '[]'::jsonb),
    'warnings', COALESCE(v_bundle->'warnings', '[]'::jsonb),
    'approved_exceptions', COALESCE(v_bundle->'approved_exceptions', '[]'::jsonb),
    'stale', false,
    'normalized_proposal', v_normalized,
    'code', CASE
      WHEN jsonb_array_length(COALESCE(v_bundle->'blocking_conflicts', '[]'::jsonb)) > 0 THEN 'BLOCKED_CONFLICTS'
      WHEN jsonb_array_length(COALESCE(v_bundle->'warnings', '[]'::jsonb)) > 0 THEN 'BLOCKED_WARNINGS'
      ELSE 'OK'
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.validate_schedule_session_move(uuid, timestamptz, integer, time, time, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_schedule_session_move(uuid, timestamptz, integer, time, time, uuid)
  TO authenticated, service_role;

-- =========================================================
-- Validate + save (atomic)
-- =========================================================
CREATE OR REPLACE FUNCTION public.move_or_reschedule_schedule_session(
  p_session_id uuid,
  p_expected_updated_at timestamptz,
  p_target_day_of_week integer,
  p_target_start_time time,
  p_target_end_time time,
  p_target_room_id uuid,
  p_change_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_session public.schedule_sessions%ROWTYPE;
  v_version_status text;
  v_bundle jsonb;
  v_before jsonb;
  v_after jsonb;
  v_blocking_len integer;
  v_warning_len integer;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED', 'stale', false,
      'message_ar', 'يجب تسجيل الدخول.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  IF p_target_day_of_week IS NULL OR p_target_day_of_week < 0 OR p_target_day_of_week > 6 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_DAY', 'stale', false,
      'message_ar', 'يوم غير صالح.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  IF p_target_start_time IS NULL OR p_target_end_time IS NULL OR p_target_end_time <= p_target_start_time THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_TIME_RANGE', 'stale', false,
      'message_ar', 'نطاق الوقت غير صالح.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  SELECT * INTO v_session
  FROM public.schedule_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'stale', false,
      'message_ar', 'الجلسة غير موجودة.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  IF NOT public.can_manage_college(v_uid, v_session.college_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN_COLLEGE', 'stale', false,
      'message_ar', 'لا تملك صلاحية إدارة هذه الكلية.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  SELECT status INTO v_version_status
  FROM public.schedule_versions
  WHERE id = v_session.schedule_version_id
  FOR UPDATE;

  IF v_version_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'stale', false,
      'message_ar', 'نسخة الجدول غير موجودة.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  IF v_version_status IN ('published', 'archived') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'VERSION_LOCKED', 'stale', false,
      'message_ar', 'هذه النسخة غير قابلة للتعديل.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  IF COALESCE(v_session.is_locked, false) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'SESSION_LOCKED', 'stale', false,
      'message_ar', 'هذه الجلسة مقفلة.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  IF p_expected_updated_at IS NULL OR v_session.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('ok', false, 'code', 'STALE_SESSION', 'stale', true,
      'message_ar', 'تغيرت الجلسة منذ تحميلها. أعد التحميل ثم حاول مجددًا.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  -- Idempotent no-op
  IF v_session.day_of_week = p_target_day_of_week
     AND v_session.start_time = p_target_start_time
     AND v_session.end_time = p_target_end_time
     AND v_session.room_id IS NOT DISTINCT FROM p_target_room_id
  THEN
    RETURN jsonb_build_object(
      'ok', true,
      'code', 'NOOP',
      'stale', false,
      'session', jsonb_build_object(
        'id', v_session.id,
        'day_of_week', v_session.day_of_week,
        'start_time', v_session.start_time,
        'end_time', v_session.end_time,
        'room_id', v_session.room_id,
        'updated_at', v_session.updated_at
      ),
      'blocking_conflicts', '[]'::jsonb,
      'warnings', '[]'::jsonb
    );
  END IF;

  v_bundle := public._collect_schedule_session_move_conflicts(
    v_session.id,
    v_session.college_id,
    v_session.schedule_version_id,
    v_session.instructor_id,
    v_session.section_id,
    v_session.course_offering_id,
    v_session.teaching_assignment_id,
    v_session.study_system,
    v_session.expected_students,
    p_target_day_of_week,
    p_target_start_time,
    p_target_end_time,
    p_target_room_id
  );

  v_blocking_len := jsonb_array_length(COALESCE(v_bundle->'blocking_conflicts', '[]'::jsonb));
  v_warning_len := jsonb_array_length(COALESCE(v_bundle->'warnings', '[]'::jsonb));

  IF v_blocking_len > 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'BLOCKED_CONFLICTS',
      'stale', false,
      'message_ar', 'توجد تعارضات مانعة. لم يُحفظ التغيير.',
      'blocking_conflicts', v_bundle->'blocking_conflicts',
      'warnings', v_bundle->'warnings',
      'approved_exceptions', v_bundle->'approved_exceptions'
    );
  END IF;

  IF v_warning_len > 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'BLOCKED_WARNINGS',
      'stale', false,
      'message_ar', 'توجد تحذيرات غير محلولة. الحفظ غير مسموح حاليًا.',
      'blocking_conflicts', v_bundle->'blocking_conflicts',
      'warnings', v_bundle->'warnings',
      'approved_exceptions', v_bundle->'approved_exceptions'
    );
  END IF;

  v_before := jsonb_build_object(
    'day_of_week', v_session.day_of_week,
    'start_time', v_session.start_time,
    'end_time', v_session.end_time,
    'room_id', v_session.room_id,
    'updated_at', v_session.updated_at
  );

  UPDATE public.schedule_sessions
  SET
    day_of_week = p_target_day_of_week,
    start_time = p_target_start_time,
    end_time = p_target_end_time,
    room_id = p_target_room_id
  WHERE id = p_session_id
  RETURNING * INTO v_session;

  v_after := jsonb_build_object(
    'day_of_week', v_session.day_of_week,
    'start_time', v_session.start_time,
    'end_time', v_session.end_time,
    'room_id', v_session.room_id,
    'updated_at', v_session.updated_at
  );

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (
    v_uid,
    'move_or_reschedule',
    'schedule_sessions',
    p_session_id,
    v_session.college_id,
    jsonb_build_object(
      'before', v_before,
      'after', v_after,
      'change_reason', NULLIF(btrim(COALESCE(p_change_reason, '')), ''),
      'approved_exceptions', COALESCE(v_bundle->'approved_exceptions', '[]'::jsonb)
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'code', 'SAVED',
    'stale', false,
    'session', v_after || jsonb_build_object('id', p_session_id),
    'blocking_conflicts', '[]'::jsonb,
    'warnings', '[]'::jsonb,
    'approved_exceptions', COALESCE(v_bundle->'approved_exceptions', '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.move_or_reschedule_schedule_session(uuid, timestamptz, integer, time, time, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.move_or_reschedule_schedule_session(uuid, timestamptz, integer, time, time, uuid, text)
  TO authenticated, service_role;
