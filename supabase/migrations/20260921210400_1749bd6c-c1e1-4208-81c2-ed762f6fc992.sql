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
  v_cohort uuid;
  v_partition_bad integer;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(9262, 3);

  SELECT academic_term_id INTO STRICT v_term
  FROM public.schedule_versions
  WHERE id=v_published AND college_id=v_college AND status='published';

  IF NOT EXISTS (
    SELECT 1 FROM public.schedule_versions
    WHERE id=v_draft AND college_id=v_college AND academic_term_id=v_term AND status='draft'
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
  WHERE college_id=v_college AND code='LECTURE' AND is_active;

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

  -- Preserve the imported delivery-group partitions. A room may hold 60 students,
  -- while each delivery group can deliberately be 30 (two groups) or 15 (four groups).
  IF EXISTS (
    WITH derived_sizes AS (
      SELECT g.component_id,
        ceil(h.scheduling_headcount::numeric /
          count(*) OVER (PARTITION BY g.cohort_id,g.component_id))::integer AS group_size
      FROM public.delivery_groups g
      JOIN public.academic_cohorts c ON c.id=g.cohort_id
      JOIN public.scheduling_cohort_term_headcounts h
        ON h.cohort_id=c.id AND h.term_id=c.term_id
       AND h.approval_status='approved'
      WHERE g.college_id=v_college AND c.term_id=v_term
        AND c.study_system='regular' AND c.existing_schedule
        AND g.active AND NOT g.is_obsolete
    )
    SELECT 1 FROM derived_sizes
    GROUP BY component_id
    HAVING count(DISTINCT group_size)<>1 OR min(group_size)<=0
  ) THEN
    RAISE EXCEPTION 'SHARIA_COMPONENT_GROUP_SIZE_CONFLICT';
  END IF;

  WITH derived_sizes AS (
    SELECT DISTINCT g.component_id,
      ceil(h.scheduling_headcount::numeric /
        count(*) OVER (PARTITION BY g.cohort_id,g.component_id))::integer AS group_size
    FROM public.delivery_groups g
    JOIN public.academic_cohorts c ON c.id=g.cohort_id
    JOIN public.scheduling_cohort_term_headcounts h
      ON h.cohort_id=c.id AND h.term_id=c.term_id
     AND h.approval_status='approved'
    WHERE g.college_id=v_college AND c.term_id=v_term
      AND c.study_system='regular' AND c.existing_schedule
      AND g.active AND NOT g.is_obsolete
  )
  UPDATE public.plan_course_components pcc
     SET explicit_group_size=d.group_size
    FROM derived_sizes d
   WHERE pcc.id=d.component_id AND pcc.college_id=v_college
     AND pcc.explicit_group_size IS DISTINCT FROM d.group_size;

  WITH estimates AS (
    SELECT g.id,h.scheduling_headcount n,
      count(*) OVER(PARTITION BY g.cohort_id,g.component_id)::integer k,
      ceil(h.scheduling_headcount::numeric /
        count(*) OVER(PARTITION BY g.cohort_id,g.component_id))::integer cap,
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
         capacity_limit=e.cap,
         group_number=e.rn
    FROM estimates e
   WHERE g.id=e.id
     AND (g.expected_students IS DISTINCT FROM
            (e.n/e.k+CASE WHEN e.rn<=e.n%e.k THEN 1 ELSE 0 END)
       OR g.capacity_limit IS DISTINCT FROM e.cap
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

  -- Apply the same student-partition completion used for Arts. Preserve any
  -- already-complete mapping and stop on partial historical data.
  FOR v_cohort IN
    SELECT id FROM public.academic_cohorts
    WHERE college_id=v_college AND term_id=v_term
      AND study_system='regular' AND existing_schedule AND active
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.cohort_student_partitions WHERE cohort_id=v_cohort
      UNION ALL
      SELECT 1 FROM public.delivery_group_partition_members WHERE cohort_id=v_cohort
    ) THEN
      SELECT count(*) INTO v_partition_bad
      FROM public.delivery_groups d
      WHERE d.cohort_id=v_cohort AND d.active AND NOT coalesce(d.is_obsolete,false)
        AND d.expected_students IS DISTINCT FROM (
          SELECT sum(p.headcount)
          FROM public.delivery_group_partition_members m
          JOIN public.cohort_student_partitions p
            ON p.id=m.partition_id AND p.active
          WHERE m.delivery_group_id=d.id
            AND m.cohort_id=v_cohort AND p.cohort_id=v_cohort
        );
      IF v_partition_bad>0 THEN
        RAISE EXCEPTION 'SHARIA_EXISTING_PARTITION_REVIEW_REQUIRED cohort=% bad=%',
          v_cohort,v_partition_bad;
      END IF;
      CONTINUE;
    END IF;

    WITH grp AS (
      SELECT component_id,group_number,expected_students,
        sum(expected_students) OVER(
          PARTITION BY component_id ORDER BY group_number
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) end_idx
      FROM public.delivery_groups
      WHERE cohort_id=v_cohort AND active
        AND NOT coalesce(is_obsolete,false) AND expected_students>0
    ), bounds AS (
      SELECT 0::bigint b UNION SELECT DISTINCT end_idx FROM grp
    ), ord AS (
      SELECT b,lag(b) OVER(ORDER BY b) prev_b,
        row_number() OVER(ORDER BY b) rn FROM bounds
    )
    INSERT INTO public.cohort_student_partitions(
      college_id,cohort_id,partition_code,headcount,active
    )
    SELECT v_college,v_cohort,'S'||lpad((rn-1)::text,3,'0'),
      (b-prev_b)::int,true
    FROM ord WHERE prev_b IS NOT NULL AND b>prev_b;

    WITH grp AS (
      SELECT id delivery_group_id,
        sum(expected_students) OVER(
          PARTITION BY component_id ORDER BY group_number
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        )-expected_students+1 start_idx,
        sum(expected_students) OVER(
          PARTITION BY component_id ORDER BY group_number
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) end_idx
      FROM public.delivery_groups
      WHERE cohort_id=v_cohort AND active
        AND NOT coalesce(is_obsolete,false) AND expected_students>0
    ), parts AS (
      SELECT id,
        sum(headcount) OVER(ORDER BY partition_code)-headcount+1 start_idx,
        sum(headcount) OVER(ORDER BY partition_code) end_idx
      FROM public.cohort_student_partitions
      WHERE cohort_id=v_cohort AND active
    )
    INSERT INTO public.delivery_group_partition_members(
      college_id,cohort_id,delivery_group_id,partition_id
    )
    SELECT v_college,v_cohort,g.delivery_group_id,p.id
    FROM grp g
    JOIN parts p ON p.start_idx>=g.start_idx AND p.end_idx<=g.end_idx;
  END LOOP;

  SELECT count(*) INTO v_partition_bad
  FROM public.delivery_groups d
  JOIN public.academic_cohorts c ON c.id=d.cohort_id
  WHERE c.college_id=v_college AND c.term_id=v_term
    AND c.study_system='regular' AND c.existing_schedule
    AND d.active AND NOT coalesce(d.is_obsolete,false)
    AND d.expected_students IS DISTINCT FROM (
      SELECT sum(p.headcount)
      FROM public.delivery_group_partition_members m
      JOIN public.cohort_student_partitions p
        ON p.id=m.partition_id AND p.active
      WHERE m.delivery_group_id=d.id
        AND m.cohort_id=d.cohort_id AND p.cohort_id=d.cohort_id
    );
  IF v_partition_bad>0 THEN
    RAISE EXCEPTION 'SHARIA_PARTITION_COVERAGE_MISMATCH %',v_partition_bad;
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