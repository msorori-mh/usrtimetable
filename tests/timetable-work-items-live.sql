-- Read-only acceptance checks for the 15 October 2026 ITCS repair.
-- Does not create fixtures, alter rows, or publish a schedule.
BEGIN TRANSACTION READ ONLY;
DO $test$
DECLARE
  version_id uuid;
  payload jsonb;
  pending integer;
  published_digest text;
BEGIN
  -- The RPC must continue rejecting unauthenticated callers.
  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    PERFORM public.list_schedule_builder_v2_work_items('0f11c15c-f7ce-4dd3-8974-e856f039d3e7');
    RAISE EXCEPTION 'UNAUTHENTICATED_WORK_ITEMS_ALLOWED';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- The authorized account is already the sole Super Admin in this project.
  IF NOT EXISTS (SELECT 1 FROM public.profiles p JOIN public.user_roles r ON r.user_id=p.id
    WHERE p.id='716f0f62-26ad-4db5-b2cf-7a2e6c4daefa'
      AND p.full_name='Super Admin' AND r.role='super_admin') THEN
    RAISE EXCEPTION 'ACCEPTANCE_ACCOUNT_CHANGED';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', '716f0f62-26ad-4db5-b2cf-7a2e6c4daefa', true);
  FOREACH version_id IN ARRAY ARRAY[
    '0f11c15c-f7ce-4dd3-8974-e856f039d3e7'::uuid,
    'af6b6b8e-7860-4da0-916b-3b891e0655f6'::uuid
  ] LOOP
    payload := public.list_schedule_builder_v2_work_items(version_id);
    SELECT count(*) INTO pending FROM jsonb_array_elements(payload->'rows') row_item
    WHERE coalesce((row_item->>'assignment_active')::boolean,true)
      AND row_item->>'scheduling_status' NOT IN ('scheduled','over_scheduled')
      AND ((row_item->>'remaining_schedule_hours')::numeric > 0.01
        OR row_item->>'scheduling_status' IN ('unscheduled','partially_scheduled'));
    IF pending <> 0 THEN RAISE EXCEPTION 'FALSE_PENDING_WORK_ITEMS: % / %', version_id,pending; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(payload->'rows') row_item
      WHERE NOT EXISTS (SELECT 1 FROM public.version_effective_assignments(version_id) effective
        WHERE effective.assignment_id=(row_item->>'teaching_assignment_id')::uuid)) THEN
      RAISE EXCEPTION 'HISTORICAL_REPLACEMENT_LEAKED';
    END IF;
    IF (SELECT count(*) FROM public.schedule_sessions WHERE schedule_version_id=version_id) <> 274
      OR (SELECT sum(extract(epoch FROM(end_time-start_time))/3600)
        FROM public.schedule_sessions WHERE schedule_version_id=version_id) <> 626 THEN
      RAISE EXCEPTION 'PHYSICAL_SESSIONS_OR_HOURS_CHANGED';
    END IF;
  END LOOP;
  -- An independently incomplete draft must still expose real pending work.
  payload := public.list_schedule_builder_v2_work_items('e8a5f0ff-afe8-45b9-a15c-dab7ef3068c0');
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(payload->'rows') row_item
    WHERE coalesce((row_item->>'assignment_active')::boolean,true)
      AND (row_item->>'remaining_schedule_hours')::numeric > 0.01
      AND row_item->>'scheduling_status' NOT IN ('scheduled','over_scheduled')) THEN
    RAISE EXCEPTION 'REAL_PENDING_WORK_HIDDEN';
  END IF;
  SELECT md5(string_agg(to_jsonb(s)::text,'|' ORDER BY s.id)) INTO published_digest
  FROM public.schedule_sessions s WHERE schedule_version_id='af6b6b8e-7860-4da0-916b-3b891e0655f6';
  IF published_digest <> '27fa16904e52bc5c65b77b5a73f6951d' THEN
    RAISE EXCEPTION 'PUBLISHED_HISTORY_CHANGED';
  END IF;
END $test$;
ROLLBACK;
