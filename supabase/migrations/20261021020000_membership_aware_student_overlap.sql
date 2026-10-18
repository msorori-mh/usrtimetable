-- M-8 (track C): server student-overlap rule uses version-scoped student memberships.
--
-- The previous public._sb_v2_delivery_group_overlap compared only delivery_group_id or
-- cohort_id. A merged (shared) lecture is stored once, on the anchor group of another
-- cohort, so a clash between that lecture and a member cohort's own session was missed;
-- and two disjoint student partitions of one cohort (lab groups) could be blocked.
--
-- The verdict now mirrors the browser's groupsShareStudents
-- (src/lib/auto-scheduler/student-partitions.ts):
--   same group -> share; disjoint cohort sets -> no share; a side without partitions ->
--   share (conservative); incomplete coverage -> share; else partition intersection.
-- Memberships come from public.schedule_version_student_memberships (version-scoped facts,
-- anchor cohort included) when it is installed and the caller is an authenticated user who
-- may view the college; otherwise from the global partition tables plus shared_lecture_links.
BEGIN;

CREATE OR REPLACE FUNCTION public._sv_group_memberships(p_version uuid, p_groups uuid[])
RETURNS TABLE (delivery_group_id uuid, cohort_id uuid, partition_id uuid,
               partition_headcount integer, expected_students integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_college uuid;
  v_ids uuid[];
  i integer;
BEGIN
  SELECT array_agg(DISTINCT g) INTO v_ids FROM unnest(p_groups) g WHERE g IS NOT NULL;
  IF v_ids IS NULL THEN RETURN; END IF;
  SELECT v.college_id INTO v_college FROM public.schedule_versions v WHERE v.id = p_version;

  IF to_regprocedure('public.schedule_version_student_memberships(uuid,uuid[])') IS NOT NULL
     AND auth.uid() IS NOT NULL AND v_college IS NOT NULL
     AND public.can_view_college(auth.uid(), v_college) THEN
    FOR i IN 0 .. (cardinality(v_ids) - 1) / 100 LOOP
      RETURN QUERY EXECUTE
        'SELECT m.delivery_group_id, m.cohort_id, m.partition_id, m.partition_headcount, m.expected_students
           FROM public.schedule_version_student_memberships($1, $2) m'
        USING p_version, v_ids[i * 100 + 1 : i * 100 + 100];
    END LOOP;
    RETURN;
  END IF;

  -- Global fallback (no version-scoped facts reachable in this context).
  RETURN QUERY
  WITH requested AS (
    SELECT g.id, g.cohort_id AS own_cohort, g.expected_students
    FROM public.delivery_groups g WHERE g.id = ANY (v_ids)
  ), direct AS (
    SELECT m.delivery_group_id AS group_id, p.cohort_id, p.id AS partition_id, p.headcount
    FROM public.delivery_group_partition_members m
    JOIN public.cohort_student_partitions p ON p.id = m.partition_id AND p.active
  )
  SELECT r.id, d.cohort_id, d.partition_id, d.headcount, r.expected_students
  FROM requested r JOIN direct d ON d.group_id = r.id
  UNION ALL
  SELECT r.id, r.own_cohort, NULL::uuid, NULL::integer, r.expected_students
  FROM requested r WHERE NOT EXISTS (SELECT 1 FROM direct d WHERE d.group_id = r.id);

  IF to_regclass('public.shared_lecture_links') IS NOT NULL THEN
    RETURN QUERY EXECUTE $q$
      WITH requested AS (
        SELECT g.id, g.expected_students FROM public.delivery_groups g WHERE g.id = ANY ($1)
      )
      SELECT r.id, mg.cohort_id, p.id, p.headcount, r.expected_students
      FROM requested r
      JOIN public.shared_lecture_links l ON l.anchor_group_id = r.id
      JOIN public.delivery_groups mg ON mg.id = l.member_group_id
      LEFT JOIN public.delivery_group_partition_members m ON m.delivery_group_id = mg.id
      LEFT JOIN public.cohort_student_partitions p ON p.id = m.partition_id AND p.active
    $q$ USING v_ids;
  END IF;
END $fn$;
REVOKE ALL ON FUNCTION public._sv_group_memberships(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._sv_group_memberships(uuid, uuid[]) TO service_role;

-- Pure verdict over a membership snapshot (jsonb rows of _sv_group_memberships).
CREATE OR REPLACE FUNCTION public._sv_groups_share_students(p_a uuid, p_b uuid, p_members jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $fn$
  WITH m AS (
    SELECT * FROM jsonb_to_recordset(COALESCE(p_members, '[]'::jsonb)) x(
      delivery_group_id uuid, cohort_id uuid, partition_id uuid,
      partition_headcount integer, expected_students integer)
  ), side AS (
    SELECT g.gid,
      array_remove(array_agg(DISTINCT m.cohort_id), NULL) AS cohorts,
      array_remove(array_agg(DISTINCT m.partition_id), NULL) AS parts,
      COALESCE((SELECT sum(h) FROM (SELECT DISTINCT m2.partition_id, m2.partition_headcount h
         FROM m m2 WHERE m2.delivery_group_id = g.gid AND m2.partition_id IS NOT NULL) s), 0) AS mapped,
      COALESCE(max(m.expected_students), 0) AS expected,
      count(m.delivery_group_id) AS rows_found
    FROM (VALUES (p_a), (p_b)) g(gid) LEFT JOIN m ON m.delivery_group_id = g.gid
    GROUP BY g.gid
  )
  SELECT CASE
    WHEN p_a IS NULL OR p_b IS NULL OR p_a = p_b THEN true
    WHEN EXISTS (SELECT 1 FROM side WHERE rows_found = 0 OR cardinality(cohorts) = 0) THEN true
    WHEN NOT EXISTS (SELECT 1 FROM side a, side b WHERE a.gid = p_a AND b.gid = p_b
                     AND a.cohorts && b.cohorts) THEN false
    WHEN EXISTS (SELECT 1 FROM side WHERE cardinality(parts) = 0) THEN true
    WHEN EXISTS (SELECT 1 FROM side WHERE NOT (CASE WHEN expected > 0 AND mapped > 0
                   THEN mapped >= expected ELSE mapped > 0 OR expected <= 0 END)) THEN true
    ELSE EXISTS (SELECT 1 FROM side a, side b WHERE a.gid = p_a AND b.gid = p_b AND a.parts && b.parts)
  END
$fn$;
REVOKE ALL ON FUNCTION public._sv_groups_share_students(uuid, uuid, jsonb) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public._sb_v2_delivery_group_overlap(
  p_schedule_version_id uuid, p_delivery_group_id uuid, p_cohort_id uuid,
  p_day_of_week integer, p_start_time time without time zone, p_end_time time without time zone,
  p_exclude_session_id uuid DEFAULT NULL::uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_peers jsonb;
  v_groups uuid[];
  v_members jsonb := '[]'::jsonb;
  v_out jsonb := '[]'::jsonb;
  r record;
BEGIN
  IF p_delivery_group_id IS NULL AND p_cohort_id IS NULL THEN RETURN v_out; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', s.id, 'delivery_group_id', s.delivery_group_id,
           'cohort_id', s.cohort_id)), '[]'::jsonb),
         array_agg(DISTINCT s.delivery_group_id) FILTER (WHERE s.delivery_group_id IS NOT NULL)
    INTO v_peers, v_groups
  FROM public.schedule_sessions s
  WHERE s.schedule_version_id = p_schedule_version_id
    AND s.day_of_week = p_day_of_week
    AND s.start_time < p_end_time AND p_start_time < s.end_time
    AND NOT COALESCE(s.replaced_by_split, false)
    AND (p_exclude_session_id IS NULL OR s.id <> p_exclude_session_id)
    AND ((p_delivery_group_id IS NOT NULL AND s.delivery_group_id IS NOT NULL)
         OR (p_cohort_id IS NOT NULL AND s.cohort_id = p_cohort_id));
  IF jsonb_array_length(v_peers) = 0 THEN RETURN v_out; END IF;

  IF p_delivery_group_id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(m)), '[]'::jsonb) INTO v_members
    FROM public._sv_group_memberships(p_schedule_version_id,
      array_append(COALESCE(v_groups, '{}'::uuid[]), p_delivery_group_id)) m;
  END IF;

  FOR r IN SELECT * FROM jsonb_to_recordset(v_peers) x(id uuid, delivery_group_id uuid, cohort_id uuid) LOOP
    IF p_delivery_group_id IS NULL OR r.delivery_group_id IS NULL
       OR public._sv_groups_share_students(p_delivery_group_id, r.delivery_group_id, v_members) THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'code', 'delivery_group_conflict', 'severity', 'hard',
        'message_ar', 'تعارض مجموعة التدريس / الدفعة: توجد جلسة متداخلة لنفس المجموعة أو لطلاب مشتركين.',
        'message_en', 'Delivery group / cohort conflict: overlapping session sharing students.',
        'schedule_session_id', p_exclude_session_id,
        'related_session_id', r.id,
        'metadata', jsonb_build_object('delivery_group_id', r.delivery_group_id,
          'cohort_id', r.cohort_id, 'shared_students', true)));
    END IF;
  END LOOP;
  RETURN v_out;
END $fn$;
REVOKE ALL ON FUNCTION public._sb_v2_delivery_group_overlap(uuid, uuid, uuid, integer, time, time, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._sb_v2_delivery_group_overlap(uuid, uuid, uuid, integer, time, time, uuid)
  TO service_role;

COMMIT;
