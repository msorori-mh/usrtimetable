-- Close gaps found by the independent verification (2026-10-18).
--  H-7: an ordinary (college-level) exception could waive a cross-college instructor clash,
--       because the exception matcher ignored approval_type. External clashes now need a
--       cross_college_instructor exception (super admin only, enforced by the approve RPC and
--       the exception trigger).
--  H-1: link_intake_shared_group is SECURITY DEFINER with no authorization check; its only
--       caller is another definer function, so API roles must not execute it.
--  M-21/policy parity: scheduling_policy_exceptions gets the restrictive initial-password policy
--       that every other public table has.
--  L-3: a college dean may hold at most one college, enforced in the database for every path
--       (the "at least one" rule stays in the server function, which creates the membership).

-- H-7 ------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._ss_ex_match_scoped(
  p_vid uuid, p_code text, p_sid uuid, p_rid uuid, p_external boolean,
  OUT ok boolean, OUT eid uuid, OUT ereas text)
RETURNS record
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  ok := false; eid := NULL; ereas := NULL;
  IF p_sid IS NULL THEN RETURN; END IF;
  IF p_rid IS NULL THEN
    SELECT e.id, e.reason INTO eid, ereas FROM public.schedule_version_conflict_exceptions e
     WHERE e.schedule_version_id = p_vid AND e.conflict_code = p_code AND e.status = 'approved'
       AND e.session_id = p_sid AND e.related_session_id IS NULL
       AND (NOT p_external OR e.approval_type = 'cross_college_instructor')
     LIMIT 1;
  ELSE
    SELECT e.id, e.reason INTO eid, ereas FROM public.schedule_version_conflict_exceptions e
     WHERE e.schedule_version_id = p_vid AND e.conflict_code = p_code AND e.status = 'approved'
       AND e.related_session_id IS NOT NULL
       AND LEAST(e.session_id, e.related_session_id) = LEAST(p_sid, p_rid)
       AND GREATEST(e.session_id, e.related_session_id) = GREATEST(p_sid, p_rid)
       AND (NOT p_external OR e.approval_type = 'cross_college_instructor')
     LIMIT 1;
  END IF;
  IF FOUND THEN ok := true; ELSE eid := NULL; ereas := NULL; END IF;
END $fn$;
REVOKE ALL ON FUNCTION public._ss_ex_match_scoped(uuid, text, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ss_ex_match_scoped(uuid, text, uuid, uuid, boolean) TO service_role;

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
    -- H-7: a clash with another college's timetable (scope 'external') can only be waived by a
    -- cross_college_instructor exception, which only a super admin can approve.
    CROSS JOIN LATERAL public._ss_ex_match_scoped(p_version_id, k.code, k.sid, k.rid,
      COALESCE(k.item->'metadata'->>'scope', '') = 'external') ex
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

-- H-1 ------------------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.link_intake_shared_group(uuid,uuid,uuid)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.link_intake_shared_group(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.link_intake_shared_group(uuid, uuid, uuid) TO service_role;
  END IF;
END $$;

-- Policy parity --------------------------------------------------------------------------
DROP POLICY IF EXISTS initial_password_ready ON public.scheduling_policy_exceptions;
CREATE POLICY initial_password_ready ON public.scheduling_policy_exceptions
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT NOT public.password_change_required()))
  WITH CHECK ((SELECT NOT public.password_change_required()));

-- L-3 ------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_dean_single_college()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_user uuid := NEW.user_id;
BEGIN
  IF EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = v_user AND r.role = 'college_dean')
     AND (SELECT count(*) FROM public.user_colleges c WHERE c.user_id = v_user) > 1 THEN
    RAISE EXCEPTION 'DEAN_SINGLE_COLLEGE' USING ERRCODE = 'P0001',
      DETAIL = 'A college dean is assigned to exactly one college.';
  END IF;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.enforce_dean_single_college() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zz_dean_single_college ON public.user_colleges;
CREATE TRIGGER zz_dean_single_college
  AFTER INSERT OR UPDATE OF user_id, college_id ON public.user_colleges
  FOR EACH ROW EXECUTE FUNCTION public.enforce_dean_single_college();
DROP TRIGGER IF EXISTS zz_dean_single_college ON public.user_roles;
CREATE TRIGGER zz_dean_single_college
  AFTER INSERT OR UPDATE OF user_id, role ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_dean_single_college();
