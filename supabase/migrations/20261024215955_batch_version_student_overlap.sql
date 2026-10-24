-- Whole-version validation used to decode and aggregate the same membership JSON
-- for every overlapping session pair. Aggregate each group's coverage once instead.
-- Keep the conservative verdict of _sv_groups_share_students, including missing
-- mappings, incomplete coverage, shared lectures and disjoint lab partitions.
BEGIN;

CREATE OR REPLACE FUNCTION public._sv_version_student_overlaps(p_version_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $fn$
DECLARE
  v_groups uuid[];
  v_out jsonb;
BEGIN
  SELECT array_agg(DISTINCT s.delivery_group_id) INTO v_groups
  FROM public.schedule_sessions s
  WHERE s.schedule_version_id = p_version_id AND s.delivery_group_id IS NOT NULL
    AND NOT COALESCE(s.replaced_by_split, false);

  WITH members AS MATERIALIZED (
    SELECT * FROM public._sv_group_memberships(p_version_id, v_groups)
  ), mapped AS (
    SELECT delivery_group_id, sum(partition_headcount) AS headcount
    FROM (SELECT DISTINCT delivery_group_id, partition_id, partition_headcount
          FROM members WHERE partition_id IS NOT NULL) m
    GROUP BY delivery_group_id
  ), sides AS MATERIALIZED (
    SELECT m.delivery_group_id,
      array_remove(array_agg(DISTINCT m.cohort_id), NULL) AS cohorts,
      array_remove(array_agg(DISTINCT m.partition_id), NULL) AS parts,
      COALESCE(max(d.headcount), 0) AS mapped,
      COALESCE(max(m.expected_students), 0) AS expected
    FROM members m LEFT JOIN mapped d USING (delivery_group_id)
    GROUP BY m.delivery_group_id
  ), live AS MATERIALIZED (
    SELECT s.id, s.delivery_group_id, s.cohort_id, s.day_of_week, s.start_time, s.end_time
    FROM public.schedule_sessions s
    WHERE s.schedule_version_id = p_version_id AND NOT COALESCE(s.replaced_by_split, false)
      AND (s.delivery_group_id IS NOT NULL OR s.cohort_id IS NOT NULL)
  ), pairs AS (
    SELECT a.id AS a_id, b.id AS b_id, a.delivery_group_id AS a_dg, b.delivery_group_id AS b_dg,
           b.cohort_id AS b_cohort, a.day_of_week
    FROM live a JOIN live b
      ON b.id > a.id AND b.day_of_week = a.day_of_week
     AND a.start_time < b.end_time AND b.start_time < a.end_time
    WHERE (a.delivery_group_id IS NOT NULL AND b.delivery_group_id IS NOT NULL)
       OR (a.cohort_id IS NOT NULL AND a.cohort_id = b.cohort_id)
  )
  SELECT COALESCE(jsonb_agg(public._ss_ci('delivery_group_conflict', 'hard', p.a_id, p.b_id,
           jsonb_build_object('delivery_group_id', p.b_dg, 'cohort_id', p.b_cohort,
             'day_of_week', p.day_of_week, 'shared_students', true))), '[]'::jsonb)
    INTO v_out
  FROM pairs p
  LEFT JOIN sides a ON a.delivery_group_id = p.a_dg
  LEFT JOIN sides b ON b.delivery_group_id = p.b_dg
  WHERE CASE
    WHEN p.a_dg IS NULL OR p.b_dg IS NULL OR p.a_dg = p.b_dg THEN true
    WHEN a.delivery_group_id IS NULL OR b.delivery_group_id IS NULL
      OR cardinality(a.cohorts) = 0 OR cardinality(b.cohorts) = 0 THEN true
    WHEN NOT (a.cohorts && b.cohorts) THEN false
    WHEN cardinality(a.parts) = 0 OR cardinality(b.parts) = 0 THEN true
    WHEN NOT (CASE WHEN a.expected > 0 AND a.mapped > 0 THEN a.mapped >= a.expected
                   ELSE a.mapped > 0 OR a.expected <= 0 END)
      OR NOT (CASE WHEN b.expected > 0 AND b.mapped > 0 THEN b.mapped >= b.expected
                   ELSE b.mapped > 0 OR b.expected <= 0 END) THEN true
    ELSE a.parts && b.parts
  END;
  RETURN v_out;
END $fn$;

REVOKE ALL ON FUNCTION public._sv_version_student_overlaps(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._sv_version_student_overlaps(uuid) TO service_role;

COMMIT;
