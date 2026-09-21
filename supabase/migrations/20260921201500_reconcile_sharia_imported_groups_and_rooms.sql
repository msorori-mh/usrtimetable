-- Reconcile imported Sharia groups and lecture rooms using the same fail-closed
-- mechanism used for Arts. Preserve both published and room-optimization sessions.
DO $sharia_reconcile$
DECLARE
  v_college constant uuid := '8e4bcbb4-4a4c-40c7-a3aa-a53f68bae0bb';
  v_published constant uuid := '7a1c9b2e-5d34-4f18-9a6b-3c2f8e5d0001';
  v_draft constant uuid := '7d2ffbc4-fee3-4ffc-a2c8-4819e5429fe6';
  v_term uuid;
  v_room_type uuid;
  v_published_hash text;
  v_draft_hash text;
  v_published_count integer;
  v_draft_count integer;
  v_published_minutes integer;
  v_draft_minutes integer;
  v_rooms integer;
  v_headcounts integer;
  v_groups integer;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(9262, 3);

  SELECT term_id INTO STRICT v_term
  FROM public.schedule_versions
  WHERE id=v_published AND college_id=v_college AND status='published';

  IF NOT EXISTS (
    SELECT 1 FROM public.schedule_versions
    WHERE id=v_draft AND college_id=v_college AND term_id=v_term AND status='draft'
  ) THEN
    RAISE EXCEPTION 'SHARIA_ROOM_OPTIMIZATION_DRAFT_REQUIRED';
  END IF;

  SELECT count(*),
         coalesce(sum(extract(epoch FROM (end_time-start_time))/60),0)::integer,
         md5(coalesce(string_agg(to_jsonb(s)::text,'' ORDER BY id),''))
    INTO v_published_count,v_published_minutes,v_published_hash
  FROM public.schedule_sessions s WHERE schedule_version_id=v_published;

  SELECT count(*),
         coalesce(sum(extract(epoch FROM (end_time-start_time))/60),0)::integer,
         md5(coalesce(string_agg(to_jsonb(s)::text,'' ORDER BY id),''))
    INTO v_draft_count,v_draft_minutes,v_draft_hash
  FROM public.schedule_sessions s WHERE schedule_version_id=v_draft;

  IF v_published_count<>61 OR v_draft_count<>61
     OR v_published_minutes<>8040 OR v_draft_minutes<>8040 THEN
    RAISE EXCEPTION 'SHARIA_SESSION_BASELINE_DRIFT published=%/% draft=%/%',
      v_published_count,v_published_minutes,v_draft_count,v_draft_minutes;
  END IF;

  SELECT count(*) INTO v_headcounts
  FROM public.scheduling_cohort_term_headcounts h
  JOIN public.academic_cohorts c ON c.id=h.cohort_id
  WHERE h.college_id=v_college AND h.term_id=v_term
    AND c.college_id=v_college AND c.term_id=v_term
    AND c.study_system='regular' AND c.existing_schedule
    AND h.approval_status='approved' AND h.scheduling_headcount=60;
  IF v_headcounts<>4 THEN
    RAISE EXCEPTION 'SHARIA_APPROVED_HEADCOUNTS_REQUIRED expected=4 actual=%',v_headcounts;
  END IF;

  SELECT id INTO STRICT v_room_type
  FROM public.room_types
  WHERE college_id=v_college AND code='lecture_hall' AND is_active;

  UPDATE public.room_types
     SET default_capacity=60
   WHERE id=v_room_type AND default_capacity IS DISTINCT FROM 60;

  SELECT count(*) INTO v_rooms
  FROM public.rooms
  WHERE college_id=v_college AND is_active
    AND (code IN ('30','31','32','33','34')
      OR name IN ('قاعة 30','قاعة 31','قاعة 32','قاعة 33','قاعة 34'));
  IF v_rooms<>5 THEN
    RAISE EXCEPTION 'SHARIA_ROOMS_30_34_REQUIRED expected=5 actual=%',v_rooms;
  END IF;

  UPDATE public.rooms
     SET capacity=60, room_type='lecture_hall', room_type_id=v_room_type
   WHERE college_id=v_college AND is_active
     AND (code IN ('30','31','32','33','34')
       OR name IN ('قاعة 30','قاعة 31','قاعة 32','قاعة 33','قاعة 34'));

  IF EXISTS (
    SELECT 1
    FROM public.delivery_groups g
    JOIN public.academic_cohorts c ON c.id=g.cohort_id
    JOIN public.plan_course_components pcc ON pcc.id=g.component_id
    WHERE g.college_id=v_college AND c.term_id=v_term
      AND g.active AND NOT g.is_obsolete
      AND pcc.component_type<>'theory'
  ) THEN
    RAISE EXCEPTION 'SHARIA_NON_THEORY_COMPONENT_REVIEW_REQUIRED';
  END IF;

  UPDATE public.plan_course_components pcc
     SET required_room_type_id=v_room_type
   WHERE pcc.college_id=v_college
     AND pcc.id IN (
       SELECT g.component_id
       FROM public.delivery_groups g
       JOIN public.academic_cohorts c ON c.id=g.cohort_id
       WHERE g.college_id=v_college AND c.term_id=v_term
         AND g.active AND NOT g.is_obsolete
     )
     AND pcc.required_room_type_id IS DISTINCT FROM v_room_type;

  WITH estimates AS (
    SELECT g.id,h.scheduling_headcount n,
      count(*) OVER(PARTITION BY g.cohort_id,g.component_id)::integer k,
      row_number() OVER(
        PARTITION BY g.cohort_id,g.component_id
        ORDER BY g.group_number,g.id
      )::integer rn
    FROM public.delivery_groups g
    JOIN public.academic_cohorts c ON c.id=g.cohort_id
    JOIN public.scheduling_cohort_term_headcounts h
      ON h.cohort_id=c.id AND h.term_id=c.term_id
     AND h.approval_status='approved'
    WHERE g.college_id=v_college AND c.term_id=v_term
      AND c.study_system='regular' AND c.existing_schedule
      AND g.active AND NOT g.is_obsolete
  )
  UPDATE public.delivery_groups g
     SET expected_students=e.n/e.k+CASE WHEN e.rn<=e.n%e.k THEN 1 ELSE 0 END,
         capacity_limit=60,
         group_number=e.rn
    FROM estimates e
   WHERE g.id=e.id
     AND (g.expected_students IS DISTINCT FROM
            (e.n/e.k+CASE WHEN e.rn<=e.n%e.k THEN 1 ELSE 0 END)
       OR g.capacity_limit IS DISTINCT FROM 60
       OR g.group_number IS DISTINCT FROM e.rn);

  SELECT count(*) INTO v_groups
  FROM public.delivery_groups g
  JOIN public.academic_cohorts c ON c.id=g.cohort_id
  WHERE g.college_id=v_college AND c.term_id=v_term
    AND g.active AND NOT g.is_obsolete;

  IF v_groups<>53 THEN
    RAISE EXCEPTION 'SHARIA_ACTIVE_GROUP_COUNT_DRIFT expected=53 actual=%',v_groups;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.delivery_groups g
    JOIN public.academic_cohorts c ON c.id=g.cohort_id
    WHERE g.college_id=v_college AND c.term_id=v_term
      AND g.active AND NOT g.is_obsolete
      AND (g.expected_students IS NULL OR g.expected_students<=0
        OR g.capacity_limit IS NULL OR g.capacity_limit<g.expected_students
        OR NOT public.delivery_group_is_current(g.id))
  ) THEN
    RAISE EXCEPTION 'SHARIA_GROUP_RECONCILIATION_FAILED';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.rooms r
    WHERE r.college_id=v_college AND r.is_active
      AND (r.code IN ('30','31','32','33','34')
        OR r.name IN ('قاعة 30','قاعة 31','قاعة 32','قاعة 33','قاعة 34'))
      AND (r.capacity<>60 OR r.room_type_id IS DISTINCT FROM v_room_type
        OR r.room_type<>'lecture_hall')
  ) THEN
    RAISE EXCEPTION 'SHARIA_ROOM_RECONCILIATION_FAILED';
  END IF;

  IF (SELECT md5(coalesce(string_agg(to_jsonb(s)::text,'' ORDER BY id),''))
      FROM public.schedule_sessions s WHERE schedule_version_id=v_published)
      IS DISTINCT FROM v_published_hash
     OR
     (SELECT md5(coalesce(string_agg(to_jsonb(s)::text,'' ORDER BY id),''))
      FROM public.schedule_sessions s WHERE schedule_version_id=v_draft)
      IS DISTINCT FROM v_draft_hash THEN
    RAISE EXCEPTION 'SHARIA_SESSION_BASELINE_CHANGED';
  END IF;
END
$sharia_reconcile$;
