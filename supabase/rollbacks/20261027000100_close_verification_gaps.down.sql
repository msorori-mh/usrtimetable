-- Rollback of 20261027000100_close_verification_gaps.sql
DROP TRIGGER IF EXISTS zz_dean_single_college ON public.user_roles;
DROP TRIGGER IF EXISTS zz_dean_single_college ON public.user_colleges;
DROP FUNCTION IF EXISTS public.enforce_dean_single_college();
DROP POLICY IF EXISTS initial_password_ready ON public.scheduling_policy_exceptions;
-- link_intake_shared_group stays revoked from API roles (it was never meant to be callable).
CREATE OR REPLACE FUNCTION public._sv_classify_conflicts(p_version_id uuid, p_raw jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH raw AS (
    SELECT e AS item,
      e->>'code' AS code,
      COALESCE(e->>'severity', 'hard') AS severity,
      NULLIF(e->>'schedule_session_id', '')::uuid AS sid,
      CASE WHEN e->>'related_session_id' IS NULL OR e->>'related_session_id' IN ('', 'null')
        THEN NULL ELSE (e->>'related_session_id')::uuid END AS rid
    FROM jsonb_array_elements(COALESCE(p_raw, '[]'::jsonb)) e
  ), keyed AS (
    SELECT r.*,
      CASE
        WHEN r.rid IS NOT NULL THEN r.code || '|' || least(r.sid, r.rid) || '|' || greatest(r.sid, r.rid)
        WHEN r.code = 'cohort_component_single_instructor' THEN r.code || '|' ||
          COALESCE(r.item->'metadata'->>'cohort_id', '') || '|' ||
          COALESCE(r.item->'metadata'->>'plan_course_id', '') || '|' ||
          COALESCE(r.item->'metadata'->>'component_type', '')
        ELSE r.code || '|' || COALESCE(r.sid::text, '') || '|' ||
          COALESCE(r.item->'metadata'->>'partition_id', '') || '|' ||
          COALESCE(r.item->'metadata'->>'daily_break_id', '') || '|' ||
          COALESCE(r.item->'metadata'->>'scope', '')
      END AS k
    FROM raw r
  ), dedup AS (
    SELECT DISTINCT ON (k) * FROM keyed ORDER BY k
  ), kept AS (
    -- One physical lecture recorded on several rows (merged delivery: same time, instructor,
    -- room and offering) is not a clash with itself (mirrors isSameDeliveryEntry).
    SELECT d.* FROM dedup d
    WHERE NOT (d.rid IS NOT NULL
      AND d.code IN ('room_conflict', 'instructor_conflict', 'section_conflict', 'delivery_group_conflict')
      AND EXISTS (SELECT 1 FROM public.schedule_sessions a JOIN public.schedule_sessions b ON b.id = d.rid
        WHERE a.id = d.sid AND a.day_of_week = b.day_of_week AND a.start_time = b.start_time
          AND a.end_time = b.end_time AND a.instructor_id = b.instructor_id
          AND a.room_id IS NOT NULL AND a.room_id = b.room_id
          AND a.course_offering_id = b.course_offering_id))
  ), enriched AS (
    SELECT k.*, ex.ok AS approved, ex.eid, ex.ereas,
      CASE WHEN k.severity = 'hard' AND NOT COALESCE(ex.ok, false)
        THEN public._sv_policy_waiver(p_version_id, k.code) END AS waiver_id
    FROM kept k
    CROSS JOIN LATERAL public._ss_ex_match(p_version_id, k.code, k.sid, k.rid) ex
  ), final AS (
    SELECT e.*, (e.item
      || jsonb_build_object('approved_exception', COALESCE(e.approved, false),
           'exception_id', e.eid, 'exception_reason', e.ereas,
           'waived', e.waiver_id IS NOT NULL, 'policy_exception_id', e.waiver_id)
      || CASE WHEN e.waiver_id IS NOT NULL
           THEN jsonb_build_object('severity', 'soft', 'original_severity', 'hard') ELSE '{}'::jsonb END
      ) AS out
    FROM enriched e
  )
  SELECT jsonb_build_object(
    'version_id', p_version_id,
    'conflicts', COALESCE(jsonb_agg(out ORDER BY k), '[]'::jsonb),
    'hard_count', count(*) FILTER (WHERE severity = 'hard' AND NOT COALESCE(approved, false) AND waiver_id IS NULL),
    'approved_count', count(*) FILTER (WHERE severity = 'hard' AND COALESCE(approved, false)),
    'waived_count', count(*) FILTER (WHERE waiver_id IS NOT NULL),
    'total_hard_count', count(*) FILTER (WHERE severity = 'hard' AND waiver_id IS NULL),
    'soft_count', count(*) FILTER (WHERE severity = 'soft' OR waiver_id IS NOT NULL))
  FROM final
$function$;
DROP FUNCTION IF EXISTS public._ss_ex_match_scoped(uuid, text, uuid, uuid, boolean);
