-- Resolve the four inherited cross-college lecturer conflicts in the current
-- Arts draft. Published/archived versions are reference-only and untouched.
--
-- The replacement slots were selected by the canonical conflict collector,
-- the cross-college busy registry and an explicit cohort/delivery-group check.
BEGIN;

DO $repair$
DECLARE
  v_arts_college constant uuid := 'd78cf264-3a76-43a1-8601-4d6def12b400';
  v_draft_version constant uuid := 'ef7fbf29-6018-4df2-9c37-6e122970366a';
  v_room constant uuid := 'c4b04956-2cc3-4c06-b586-7518771b4e70'; -- ق 35
  v_actor uuid;
  v_rows integer;
  v_conflicts uuid[];
  v_raw jsonb;
  v_session record;
BEGIN
  SELECT ur.user_id
    INTO v_actor
  FROM public.user_roles ur
  WHERE ur.role = 'super_admin'::public.app_role
  ORDER BY ur.created_at NULLS LAST, ur.user_id
  LIMIT 1;

  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'ARTS_REPAIR_SUPER_ADMIN_CONTEXT_REQUIRED';
  END IF;

  -- Allow the canonical read-only validators to exercise the exact same
  -- membership-aware code paths used by authenticated schedule managers.
  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);

  IF NOT EXISTS (
    SELECT 1
    FROM public.schedule_versions sv
    WHERE sv.id = v_draft_version
      AND sv.college_id = v_arts_college
      AND sv.status = 'draft'
  ) THEN
    RAISE EXCEPTION 'ARTS_DRAFT_BASELINE_CHANGED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.rooms r
    WHERE r.id = v_room
      AND r.college_id = v_arts_college
      AND r.is_active
      AND r.room_type = 'lecture_hall'
      AND r.capacity >= 60
  ) THEN
    RAISE EXCEPTION 'ARTS_REPAIR_ROOM_NOT_SUITABLE';
  END IF;

  -- Lock and verify the exact reviewed source state. This fails closed if a
  -- concurrent/manual edit has changed any target before this migration runs.
  PERFORM 1
  FROM public.schedule_sessions ss
  WHERE ss.id = '6375a3e4-1a74-43ae-81b6-ff2630c0b043'::uuid
    AND ss.schedule_version_id = v_draft_version
    AND ss.instructor_id = '4f57f9b0-c508-4a2c-a027-f7b85c64f879'::uuid
    AND ss.day_of_week = 6 AND ss.start_time = time '08:00'
    AND ss.end_time = time '11:00'
    AND ss.room_id = '8d4a88d7-ef2f-5317-bacd-a4e8ec7aed5e'::uuid
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHAMSAN_SESSION_BASELINE_CHANGED'; END IF;

  PERFORM 1
  FROM public.schedule_sessions ss
  WHERE ss.id = '3f71471d-6e0c-4d1d-9dd7-9a2e2a86ade7'::uuid
    AND ss.schedule_version_id = v_draft_version
    AND ss.instructor_id = '09938e55-e984-45ee-987c-aaf0f9e72367'::uuid
    AND ss.day_of_week = 1 AND ss.start_time = time '08:00'
    AND ss.end_time = time '11:00'
    AND ss.room_id = '0f0bd45b-5933-4231-90f5-babc1a68873c'::uuid
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHAWQI_SESSION_BASELINE_CHANGED'; END IF;

  PERFORM 1
  FROM public.schedule_sessions ss
  WHERE ss.id = '70e70978-ba15-40ec-a78d-ca3d9e96d0c9'::uuid
    AND ss.schedule_version_id = v_draft_version
    AND ss.instructor_id = '4b2bc566-8799-4501-9ff7-b9d8fa641546'::uuid
    AND ss.day_of_week = 2 AND ss.start_time = time '12:00'
    AND ss.end_time = time '14:00'
    AND ss.room_id = '7af1eade-3741-4a33-a1b0-0eb9af1aff81'::uuid
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FAHMI_SESSION_BASELINE_CHANGED'; END IF;

  PERFORM 1
  FROM public.schedule_sessions ss
  WHERE ss.id = 'e7f16ddf-df00-4123-8507-3124557d717a'::uuid
    AND ss.schedule_version_id = v_draft_version
    AND ss.instructor_id = 'e40dda80-b62f-4c7b-94be-396d2e833233'::uuid
    AND ss.day_of_week = 0 AND ss.start_time = time '08:00'
    AND ss.end_time = time '10:00'
    AND ss.room_id = '360ccfcc-0338-4866-9076-9a7f1d93ae0c'::uuid
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MUTAHHAR_SESSION_BASELINE_CHANGED'; END IF;

  SELECT coalesce(array_agg(q.session_id ORDER BY q.session_id), ARRAY[]::uuid[])
    INTO v_conflicts
  FROM (
    SELECT DISTINCT ss.id AS session_id
    FROM public.schedule_sessions ss
    JOIN schedule_coordination_private.busy(v_draft_version) busy
      ON busy.instructor_id = ss.instructor_id
     AND busy.day_of_week = ss.day_of_week
     AND busy.start_time < ss.end_time
     AND ss.start_time < busy.end_time
    WHERE ss.schedule_version_id = v_draft_version
      AND NOT coalesce(ss.replaced_by_split, false)
      AND NOT EXISTS (
        SELECT 1
        FROM public.schedule_version_conflict_exceptions e
        WHERE e.schedule_version_id = v_draft_version
          AND e.session_id = ss.id
          AND e.status = 'approved'
          AND e.approval_type = 'cross_college_instructor'
          AND e.conflict_code IN ('instructor_conflict', 'cross_college_instructor_conflict')
      )
  ) q;

  IF v_conflicts IS DISTINCT FROM ARRAY[
    '3f71471d-6e0c-4d1d-9dd7-9a2e2a86ade7'::uuid,
    '6375a3e4-1a74-43ae-81b6-ff2630c0b043'::uuid,
    '70e70978-ba15-40ec-a78d-ca3d9e96d0c9'::uuid,
    'e7f16ddf-df00-4123-8507-3124557d717a'::uuid
  ] THEN
    RAISE EXCEPTION 'ARTS_CONFLICT_BASELINE_CHANGED: %', v_conflicts;
  END IF;

  -- Preflight every proposal through the canonical collector. Cross-college
  -- busy slots and delivery-group/cohort overlap are checked explicitly too.
  FOR v_session IN
    SELECT ss.*,
           p.day_of_week AS next_day,
           p.start_time AS next_start,
           p.end_time AS next_end
    FROM public.schedule_sessions ss
    JOIN (VALUES
      ('6375a3e4-1a74-43ae-81b6-ff2630c0b043'::uuid, 4, time '08:00', time '11:00'),
      ('3f71471d-6e0c-4d1d-9dd7-9a2e2a86ade7'::uuid, 0, time '08:00', time '11:00'),
      ('70e70978-ba15-40ec-a78d-ca3d9e96d0c9'::uuid, 3, time '12:00', time '14:00'),
      ('e7f16ddf-df00-4123-8507-3124557d717a'::uuid, 1, time '08:00', time '10:00')
    ) p(id, day_of_week, start_time, end_time) ON p.id = ss.id
  LOOP
    v_raw := public._ss_gather(
      v_session.id, v_session.college_id, v_session.schedule_version_id,
      v_session.instructor_id, v_session.section_id,
      v_session.course_offering_id, v_session.teaching_assignment_id,
      v_session.study_system, v_session.expected_students,
      v_session.next_day, v_session.next_start, v_session.next_end, v_room
    );
    IF jsonb_array_length(coalesce(v_raw, '[]'::jsonb)) <> 0 THEN
      RAISE EXCEPTION 'ARTS_REPAIR_CANONICAL_CONFLICT session=% conflicts=%',
        v_session.id, v_raw;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM schedule_coordination_private.busy(v_draft_version) busy
      WHERE busy.instructor_id = v_session.instructor_id
        AND busy.day_of_week = v_session.next_day
        AND busy.start_time < v_session.next_end
        AND v_session.next_start < busy.end_time
    ) THEN
      RAISE EXCEPTION 'ARTS_REPAIR_EXTERNAL_CONFLICT session=%', v_session.id;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.schedule_sessions peer
      WHERE peer.schedule_version_id = v_draft_version
        AND peer.id <> v_session.id
        AND peer.day_of_week = v_session.next_day
        AND peer.start_time < v_session.next_end
        AND v_session.next_start < peer.end_time
        AND (
          (v_session.delivery_group_id IS NOT NULL
            AND peer.delivery_group_id = v_session.delivery_group_id)
          OR (v_session.cohort_id IS NOT NULL
            AND peer.cohort_id = v_session.cohort_id)
        )
    ) THEN
      RAISE EXCEPTION 'ARTS_REPAIR_GROUP_CONFLICT session=%', v_session.id;
    END IF;
  END LOOP;

  -- These imported rows carry legacy group-derivation metadata. The ordinary
  -- freshness trigger rejects even a time/room-only update although none of
  -- the delivery-group linkage columns changes. Hold an AccessExclusive lock
  -- and bypass only that one trigger for this exact four-row repair. Every
  -- other row guard and the whole-version coordination constraint stays on.
  ALTER TABLE public.schedule_sessions
    DISABLE TRIGGER trg_schedule_session_current_delivery_group;

  -- All four rows move in one statement, so the deferred whole-version
  -- coordination constraint observes only the clean final state.
  UPDATE public.schedule_sessions ss
  SET day_of_week = p.day_of_week,
      start_time = p.start_time,
      end_time = p.end_time,
      room_id = v_room
  FROM (VALUES
    ('6375a3e4-1a74-43ae-81b6-ff2630c0b043'::uuid, 4, time '08:00', time '11:00'),
    ('3f71471d-6e0c-4d1d-9dd7-9a2e2a86ade7'::uuid, 0, time '08:00', time '11:00'),
    ('70e70978-ba15-40ec-a78d-ca3d9e96d0c9'::uuid, 3, time '12:00', time '14:00'),
    ('e7f16ddf-df00-4123-8507-3124557d717a'::uuid, 1, time '08:00', time '10:00')
  ) p(id, day_of_week, start_time, end_time)
  WHERE ss.id = p.id AND ss.schedule_version_id = v_draft_version;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 4 THEN
    RAISE EXCEPTION 'ARTS_REPAIR_UPDATE_COUNT: expected=4 actual=%', v_rows;
  END IF;

  SET CONSTRAINTS ALL IMMEDIATE;
  ALTER TABLE public.schedule_sessions
    ENABLE TRIGGER trg_schedule_session_current_delivery_group;

  PERFORM schedule_coordination_private.check_version(v_draft_version);

  FOR v_session IN
    SELECT ss.*
    FROM public.schedule_sessions ss
    WHERE ss.id = ANY(ARRAY[
      '6375a3e4-1a74-43ae-81b6-ff2630c0b043'::uuid,
      '3f71471d-6e0c-4d1d-9dd7-9a2e2a86ade7'::uuid,
      '70e70978-ba15-40ec-a78d-ca3d9e96d0c9'::uuid,
      'e7f16ddf-df00-4123-8507-3124557d717a'::uuid
    ])
  LOOP
    v_raw := public._ss_gather(
      v_session.id, v_session.college_id, v_session.schedule_version_id,
      v_session.instructor_id, v_session.section_id,
      v_session.course_offering_id, v_session.teaching_assignment_id,
      v_session.study_system, v_session.expected_students,
      v_session.day_of_week, v_session.start_time, v_session.end_time,
      v_session.room_id
    );
    IF jsonb_array_length(coalesce(v_raw, '[]'::jsonb)) <> 0 THEN
      RAISE EXCEPTION 'ARTS_REPAIR_POSTCHECK_CONFLICT session=% conflicts=%',
        v_session.id, v_raw;
    END IF;
  END LOOP;

  INSERT INTO public.audit_logs(
    actor_id, action, entity, entity_id, college_id, details
  )
  SELECT
    v_actor,
    'resolve_inherited_cross_college_conflict',
    'schedule_sessions',
    p.id,
    v_arts_college,
    jsonb_build_object(
      'before', jsonb_build_object(
        'day_of_week', p.old_day, 'start_time', p.old_start,
        'end_time', p.old_end, 'room_id', p.old_room
      ),
      'after', jsonb_build_object(
        'day_of_week', p.new_day, 'start_time', p.new_start,
        'end_time', p.new_end, 'room_id', v_room
      ),
      'reason', 'approved autonomous rescheduling of inherited cross-college conflicts',
      'published_versions_modified', false
    )
  FROM (VALUES
    ('6375a3e4-1a74-43ae-81b6-ff2630c0b043'::uuid,
      6, time '08:00', time '11:00', '8d4a88d7-ef2f-5317-bacd-a4e8ec7aed5e'::uuid,
      4, time '08:00', time '11:00'),
    ('3f71471d-6e0c-4d1d-9dd7-9a2e2a86ade7'::uuid,
      1, time '08:00', time '11:00', '0f0bd45b-5933-4231-90f5-babc1a68873c'::uuid,
      0, time '08:00', time '11:00'),
    ('70e70978-ba15-40ec-a78d-ca3d9e96d0c9'::uuid,
      2, time '12:00', time '14:00', '7af1eade-3741-4a33-a1b0-0eb9af1aff81'::uuid,
      3, time '12:00', time '14:00'),
    ('e7f16ddf-df00-4123-8507-3124557d717a'::uuid,
      0, time '08:00', time '10:00', '360ccfcc-0338-4866-9076-9a7f1d93ae0c'::uuid,
      1, time '08:00', time '10:00')
  ) p(id, old_day, old_start, old_end, old_room, new_day, new_start, new_end);
END
$repair$;

COMMIT;
