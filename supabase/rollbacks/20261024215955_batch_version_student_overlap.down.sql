BEGIN;
CREATE OR REPLACE FUNCTION public._sv_version_student_overlaps(p_version_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_groups uuid[];
  v_members jsonb := '[]'::jsonb;
  v_out jsonb;
BEGIN
  SELECT array_agg(DISTINCT s.delivery_group_id) INTO v_groups
  FROM public.schedule_sessions s
  WHERE s.schedule_version_id = p_version_id AND s.delivery_group_id IS NOT NULL
    AND NOT COALESCE(s.replaced_by_split, false);
  IF v_groups IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(m)), '[]'::jsonb) INTO v_members
    FROM public._sv_group_memberships(p_version_id, v_groups) m;
  END IF;

  WITH live AS MATERIALIZED (
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
  WHERE p.a_dg IS NULL OR p.b_dg IS NULL OR p.a_dg = p.b_dg
     OR public._sv_groups_share_students(p.a_dg, p.b_dg, v_members);
  RETURN v_out;
END $fn$;
REVOKE ALL ON FUNCTION public._sv_version_student_overlaps(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._sv_version_student_overlaps(uuid) TO service_role;


COMMIT;
