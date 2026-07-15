-- PHASE-6: subgroup-aware conflict peers for schedule session move RPCs
-- Local migration only — DO NOT auto-apply in agent gates.
-- Depends on: 20260715030000_section_subgroups_capacity_model.sql

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
    SELECT id, instructor_id, room_id, section_id, section_subgroup_id, day_of_week, start_time, end_time
    FROM public.schedule_sessions
    WHERE college_id = p_college_id
      AND schedule_version_id = p_version_id
      AND id <> p_session_id
      AND COALESCE(replaced_by_split, false) = false
  LOOP
    IF v_peer.instructor_id = p_instructor_id
       AND v_peer.day_of_week = p_day_of_week
       AND v_peer.start_time < p_end_time
       AND p_start_time < v_peer.end_time
    THEN
      v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
        'code', 'instructor_conflict',
        'severity', 'hard',
        'message_ar', '╪¬╪╣╪º╪▒╪╢ ╪º┘ä┘à╪¡╪º╪╢╪▒: ┘å┘ü╪│ ╪º┘ä┘à╪¡╪º╪╢╪▒ ┘ä╪»┘è┘ç ┘à╪¡╪º╪╢╪▒╪⌐ ╪ú╪«╪▒┘ë ┘ü┘è ┘å┘ü╪│ ╪º┘ä┘ê┘é╪¬.',
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
        'message_ar', '╪¬╪╣╪º╪▒╪╢ ╪º┘ä┘é╪º╪╣╪⌐: ┘å┘ü╪│ ╪º┘ä┘é╪º╪╣╪⌐ ┘à╪¡╪¼┘ê╪▓╪⌐ ┘ü┘è ┘å┘ü╪│ ╪º┘ä┘ê┘é╪¬.',
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
       AND (
         v_peer.section_subgroup_id IS NULL
         OR (
           SELECT ss.section_subgroup_id
           FROM public.schedule_sessions ss
           WHERE ss.id = p_session_id
         ) IS NULL
         OR v_peer.section_subgroup_id = (
           SELECT ss.section_subgroup_id
           FROM public.schedule_sessions ss
           WHERE ss.id = p_session_id
         )
       )
    THEN
      v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
        'code', 'section_conflict',
        'severity', 'hard',
        'message_ar', '╪¬╪╣╪º╪▒╪╢ ╪º┘ä┘à╪¼┘à┘ê╪╣╪⌐: ┘å┘ü╪│ ╪º┘ä┘à╪¼┘à┘ê╪╣╪⌐ ┘ä╪»┘è┘ç╪º ┘à╪¡╪º╪╢╪▒╪⌐ ╪ú╪«╪▒┘ë ┘ü┘è ┘å┘ü╪│ ╪º┘ä┘ê┘é╪¬.',
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
        'message_ar', '╪º┘ä┘é╪º╪╣╪⌐ ╪║┘è╪▒ ╪╡╪º┘ä╪¡╪⌐ ╪ú┘ê ┘ä╪º ╪¬┘å╪¬┘à┘è ╪Ñ┘ä┘ë ╪º┘ä┘â┘ä┘è╪⌐.',
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
      IF v_expected > 0 AND v_room.capacity + 5 < v_expected THEN
        v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
          'code', 'room_capacity',
          'severity', 'hard',
          'message_ar', format('╪│╪╣╪⌐ ╪º┘ä┘é╪º╪╣╪⌐ ╪║┘è╪▒ ┘â╪º┘ü┘è╪⌐: ╪º┘ä╪│╪╣╪⌐ %s ┘ê╪º┘ä╪╣╪»╪» ╪º┘ä┘à╪¬┘ê┘é╪╣ %s.', v_room.capacity, v_expected),
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
            'message_ar', format('┘å┘ê╪╣ ╪º┘ä┘é╪º╪╣╪⌐ ┘ä╪º ┘è╪╖╪º╪¿┘é ╪º┘ä┘à╪╖┘ä┘ê╪¿: ╪º┘ä┘à╪╖┘ä┘ê╪¿ %s ┘ê╪º┘ä┘é╪º╪╣╪⌐ %s.', v_required_type, COALESCE(v_room.room_type, 'unknown')),
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
            'message_ar', '╪º┘ä┘à╪¡╪º╪╢╪▒╪⌐ ╪«╪º╪▒╪¼ ┘å╪╖╪º┘é ╪¬┘ê┘ü┘æ╪▒ ╪º┘ä┘é╪º╪╣╪⌐ ╪º┘ä┘à╪¡╪»╪».',
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
          WHEN COALESCE(v_instr_is_external, false) THEN '╪º┘ä┘à╪¡╪º╪╢╪▒ ╪º┘ä╪«╪º╪▒╪¼┘è ┘è╪¬╪╖┘ä╪¿ ╪¬╪╣╪▒┘è┘ü ╪ú┘ê┘é╪º╪¬ ╪º┘ä╪¬┘ê┘ü╪▒ ┘é╪¿┘ä ╪º┘ä╪¼╪»┘ê┘ä╪⌐.'
          ELSE '╪º┘ä┘à╪¡╪º╪╢╪▒ ┘à┘å ┘â┘ä┘è╪⌐ ╪ú╪«╪▒┘ë ┘è╪¬╪╖┘ä╪¿ ╪¬╪╣╪▒┘è┘ü ╪ú┘ê┘é╪º╪¬ ╪º┘ä╪¬┘ê┘ü╪▒ ┘é╪¿┘ä ╪º┘ä╪¼╪»┘ê┘ä╪⌐.'
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
        'message_ar', '╪º┘ä┘à╪¡╪º╪╢╪▒╪⌐ ╪«╪º╪▒╪¼ ┘å╪╖╪º┘é ╪¬┘ê┘ü┘æ╪▒ ╪º┘ä┘à╪¡╪º╪╢╪▒ ╪º┘ä╪Ñ┘ä╪▓╪º┘à┘è.',
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
        'message_ar', '╪º┘ä┘à╪¡╪º╪╢╪▒╪⌐ ╪«╪º╪▒╪¼ ┘é┘ê╪º┘ä╪¿ ╪ú┘ê┘é╪º╪¬ ╪º┘ä┘à╪¡╪º╪╢╪▒╪º╪¬ ╪º┘ä┘à╪│┘à┘ê╪¡╪⌐ ┘ä┘å╪╕╪º┘à ╪º┘ä╪»╪▒╪º╪│╪⌐.',
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
      'message_ar', '╪º┘ä┘è┘ê┘à ╪º┘ä┘à┘é╪¬╪▒╪¡ ╪«╪º╪▒╪¼ ╪ú┘è╪º┘à ╪º┘ä╪╣┘à┘ä ╪º┘ä┘à╪╣╪¬┘à╪»╪⌐ ┘ä┘ä┘â┘ä┘è╪⌐.',
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
        'message_ar', '╪º┘ä┘ê┘é╪¬ ╪º┘ä┘à┘é╪¬╪▒╪¡ ╪«╪º╪▒╪¼ ╪│╪º╪╣╪º╪¬ ╪º┘ä╪»┘ê╪º┘à ╪º┘ä┘à╪╣╪¬┘à╪»╪⌐.',
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
      'message_ar', format('╪º┘ä╪¬╪╣╪º╪▒╪╢ ┘à╪╣ ╪º╪│╪¬╪▒╪º╪¡╪⌐ ┘è┘ê┘à┘è╪⌐: %s.', v_break.name),
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

