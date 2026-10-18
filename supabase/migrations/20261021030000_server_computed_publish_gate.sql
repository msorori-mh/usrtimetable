-- Q-2 + M-9 (track C): the publish gate no longer trusts browser-computed counts, and
-- there is at most one published version per college and term.
--
-- * public.compute_version_hard_conflicts(version)  (internal) evaluates every live session
--   through the authoritative collector public._ss_gather (instructor/room/section peers,
--   capacity, room type, availability, templates, working hours, breaks, instructor and
--   student daily hours, extended days, ITCS 14:00 rule, cohort component single instructor)
--   plus the membership-aware student overlap, then removes duplicates, merged-delivery
--   duplicates, approved non-revoked exceptions and super-admin policy waivers
--   (public.scheduling_policy_exceptions).
-- * public.validate_schedule_version(version) is the read-only client entry point.
-- * public.persist_schedule_quality_run stores the SERVER hard count; the client number is
--   kept only in metrics_breakdown.client_reported_hard_conflicts_count for comparison.
-- * public.transition_schedule_version recomputes at draft->review, review->approved and
--   approved->published and raises PUBLISH_BLOCKER:UNAPPROVED_HARD_CONFLICTS.
-- * Publishing archives any other published version of the same college and term in the same
--   transaction (with an 'archived' event) and stamps published_at.
-- * public.current_published_version(college, term) is the single reader of "the" published
--   version; delivery_group_shared_in_published uses it (AGENTS.md: shared lecture counts once).
--
-- Limitation (documented): the collector's daily-hours / attendance-day rules grandfather the
-- load already present on a day (greatest(limit, prior)); evaluated on stored rows they never
-- fire, exactly as they never block an unchanged placement in the move/create RPCs.
BEGIN;

CREATE OR REPLACE FUNCTION public._sv_policy_waiver(p_version_id uuid, p_rule_code text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT e.id
  FROM public.scheduling_policy_exceptions e
  JOIN public.schedule_versions v ON v.id = p_version_id AND v.college_id = e.college_id
  WHERE e.rule_code = p_rule_code
    AND p_rule_code NOT IN ('itcs_theory_after_14', 'cohort_component_single_instructor')
    AND (e.schedule_version_id IS NULL OR e.schedule_version_id = v.id)
    AND (e.expires_at IS NULL OR e.expires_at > now())
    AND (e.metadata->>'term_id' IS NULL OR e.metadata->>'term_id' = v.academic_term_id::text)
  ORDER BY e.schedule_version_id NULLS LAST, e.approved_at DESC
  LIMIT 1
$fn$;
REVOKE ALL ON FUNCTION public._sv_policy_waiver(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._sv_policy_waiver(uuid, text) TO service_role;

-- Pairwise student overlap for a whole version, one membership snapshot.
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

-- Enrich, de-duplicate and classify a raw conflict list of one version.
CREATE OR REPLACE FUNCTION public._sv_classify_conflicts(p_version_id uuid, p_raw jsonb)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
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
$fn$;
REVOKE ALL ON FUNCTION public._sv_classify_conflicts(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._sv_classify_conflicts(uuid, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.compute_version_hard_conflicts(p_version_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v public.schedule_versions%ROWTYPE;
  v_raw jsonb;
  v_sessions integer;
  v_result jsonb;
BEGIN
  SELECT * INTO v FROM public.schedule_versions WHERE id = p_version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'SCHEDULE_VERSION_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;

  SELECT COALESCE(jsonb_agg(e) FILTER (WHERE e IS NOT NULL), '[]'::jsonb)
    INTO v_raw
  FROM public.schedule_sessions s
  LEFT JOIN LATERAL jsonb_array_elements(public._ss_gather(
      s.id, s.college_id, v.id, s.instructor_id, s.section_id, s.course_offering_id,
      s.teaching_assignment_id, s.study_system, s.expected_students, s.day_of_week,
      s.start_time, s.end_time, s.room_id)) e ON true
  WHERE s.schedule_version_id = v.id AND s.college_id = v.college_id
    AND NOT COALESCE(s.replaced_by_split, false);

  SELECT count(*)::integer INTO v_sessions FROM public.schedule_sessions s
  WHERE s.schedule_version_id = v.id AND s.college_id = v.college_id
    AND NOT COALESCE(s.replaced_by_split, false);

  v_raw := v_raw || public._sv_version_student_overlaps(v.id);
  v_result := public._sv_classify_conflicts(v.id, v_raw);
  RETURN v_result || jsonb_build_object('college_id', v.college_id, 'session_count', v_sessions,
    'eligibility_revision', v.eligibility_revision, 'computed_at', now());
END $fn$;
REVOKE ALL ON FUNCTION public.compute_version_hard_conflicts(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_version_hard_conflicts(uuid) TO service_role;

-- Read-only client entry point (contract with the other tracks).
CREATE OR REPLACE FUNCTION public.validate_schedule_version(p_version_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_college uuid;
  r jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING ERRCODE = '42501'; END IF;
  SELECT college_id INTO v_college FROM public.schedule_versions WHERE id = p_version_id;
  IF v_college IS NULL THEN RAISE EXCEPTION 'SCHEDULE_VERSION_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.can_view_college(auth.uid(), v_college) THEN
    RAISE EXCEPTION 'SCHEDULE_VERSION_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  r := public.compute_version_hard_conflicts(p_version_id);
  RETURN r || jsonb_build_object(
    'hard_conflicts', COALESCE((SELECT jsonb_agg(c) FROM jsonb_array_elements(r->'conflicts') c
      WHERE c->>'severity' = 'hard' AND NOT (c->>'approved_exception')::boolean), '[]'::jsonb),
    'approved_exceptions', COALESCE((SELECT jsonb_agg(c) FROM jsonb_array_elements(r->'conflicts') c
      WHERE c->>'severity' = 'hard' AND (c->>'approved_exception')::boolean), '[]'::jsonb),
    'warnings', COALESCE((SELECT jsonb_agg(c) FROM jsonb_array_elements(r->'conflicts') c
      WHERE c->>'severity' = 'soft'), '[]'::jsonb));
END $fn$;
REVOKE ALL ON FUNCTION public.validate_schedule_version(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_schedule_version(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.persist_schedule_quality_run(
  p_college_id uuid, p_schedule_version_id uuid, p_expected_eligibility_revision bigint,
  p_total_score integer, p_hard_conflicts_count integer, p_soft_conflicts_count integer,
  p_total_deductions integer, p_metrics_breakdown jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_actor uuid := auth.uid();
  v_revision bigint;
  v_run_id uuid;
  v_server jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_manage_college(v_actor, p_college_id) THEN
    RAISE EXCEPTION 'SCHEDULE_QUALITY_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_schedule_version_id::text, 9174));
  SELECT eligibility_revision INTO v_revision
  FROM public.schedule_versions
  WHERE id = p_schedule_version_id AND college_id = p_college_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SCHEDULE_VERSION_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_revision IS DISTINCT FROM p_expected_eligibility_revision THEN
    RAISE EXCEPTION 'STALE_QUALITY_SNAPSHOT' USING ERRCODE = '40001';
  END IF;

  -- Q-2: the hard-conflict count is the server's, never the caller's.
  v_server := public.compute_version_hard_conflicts(p_schedule_version_id);

  INSERT INTO public.schedule_quality_runs (
    college_id, schedule_version_id, eligibility_revision, total_score,
    hard_conflicts_count, soft_conflicts_count, total_deductions,
    metrics_breakdown, run_by
  ) VALUES (
    p_college_id, p_schedule_version_id, v_revision, p_total_score,
    (v_server->>'hard_count')::integer, p_soft_conflicts_count, p_total_deductions,
    COALESCE(p_metrics_breakdown, '{}'::jsonb) || jsonb_build_object(
      'server_validation', jsonb_build_object(
        'hard_count', (v_server->>'hard_count')::integer,
        'approved_count', (v_server->>'approved_count')::integer,
        'waived_count', (v_server->>'waived_count')::integer,
        'total_hard_count', (v_server->>'total_hard_count')::integer,
        'session_count', (v_server->>'session_count')::integer),
      'client_reported_hard_conflicts_count', p_hard_conflicts_count),
    v_actor
  ) RETURNING id INTO v_run_id;
  RETURN v_run_id;
END $fn$;
REVOKE ALL ON FUNCTION public.persist_schedule_quality_run(uuid, uuid, bigint, integer, integer, integer, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.persist_schedule_quality_run(uuid, uuid, bigint, integer, integer, integer, integer, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.transition_schedule_version(
  p_college_id uuid, p_schedule_version_id uuid, p_expected_status text,
  p_target_status text, p_notes text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_actor uuid := auth.uid();
  v_version public.schedule_versions%ROWTYPE;
  v_event_type text;
  v_session_count integer;
  v_quality_score numeric;
  v_hard_conflicts integer;
  v_quality_revision bigint;
  v_server jsonb;
  v_keep uuid[] := '{}'::uuid[];
  v_other record;
  v_archived uuid[] := '{}'::uuid[];
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_schedule_version_id::text, 9174));
  SELECT * INTO v_version FROM public.schedule_versions
  WHERE id = p_schedule_version_id AND college_id = p_college_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SCHEDULE_VERSION_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.can_manage_college(v_actor, p_college_id) THEN
    RAISE EXCEPTION 'SCHEDULE_VERSION_TRANSITION_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF v_version.status <> p_expected_status THEN
    RAISE EXCEPTION 'STALE_VERSION_STATUS' USING ERRCODE = '40001';
  END IF;
  IF NOT ((p_expected_status, p_target_status) IN (
    ('draft', 'review'), ('review', 'approved'), ('approved', 'published'),
    ('published', 'archived'), ('review', 'draft'), ('approved', 'review')
  )) THEN
    RAISE EXCEPTION 'INVALID_SCHEDULE_VERSION_TRANSITION' USING ERRCODE = '23514';
  END IF;

  IF p_target_status IN ('review', 'approved', 'published') THEN
    IF (p_expected_status, p_target_status) IN (
      ('draft', 'review'), ('review', 'approved'), ('approved', 'published')
    ) THEN
      PERFORM public._assert_schedule_version_assignment_integrity(p_college_id, p_schedule_version_id);
    END IF;
    SELECT count(*)::integer INTO v_session_count FROM public.schedule_sessions
    WHERE schedule_version_id = p_schedule_version_id AND college_id = p_college_id;
    IF p_target_status = 'review' AND v_session_count = 0 THEN
      RAISE EXCEPTION 'PUBLISH_BLOCKER:NO_SESSIONS' USING ERRCODE = '23514';
    END IF;

    SELECT total_score, eligibility_revision
    INTO v_quality_score, v_quality_revision
    FROM public.schedule_quality_runs
    WHERE schedule_version_id = p_schedule_version_id AND college_id = p_college_id
    ORDER BY created_at DESC, id DESC LIMIT 1;
    IF v_quality_revision IS NULL THEN
      RAISE EXCEPTION 'PUBLISH_BLOCKER:QUALITY_RUN_REQUIRED' USING ERRCODE = '23514';
    END IF;
    IF v_quality_revision IS DISTINCT FROM v_version.eligibility_revision THEN
      RAISE EXCEPTION 'PUBLISH_BLOCKER:QUALITY_RUN_STALE' USING ERRCODE = '23514';
    END IF;

    -- Q-2: recompute on the server at every forward gate; stored or client counts are not trusted.
    IF (p_expected_status, p_target_status) IN (
      ('draft', 'review'), ('review', 'approved'), ('approved', 'published')
    ) THEN
      v_server := public.compute_version_hard_conflicts(p_schedule_version_id);
      v_hard_conflicts := (v_server->>'hard_count')::integer;
      IF v_hard_conflicts > 0 THEN
        RAISE EXCEPTION 'PUBLISH_BLOCKER:UNAPPROVED_HARD_CONFLICTS'
          USING ERRCODE = '23514',
                DETAIL = jsonb_build_object('hard_count', v_hard_conflicts,
                  'codes', (SELECT jsonb_agg(DISTINCT c->>'code') FROM jsonb_array_elements(v_server->'conflicts') c
                            WHERE c->>'severity' = 'hard' AND NOT (c->>'approved_exception')::boolean))::text;
      END IF;
    END IF;
  END IF;

  -- M-9: one published version per college and term. A sealed education source revision
  -- archives its own source inside the status trigger, so that source is left to it.
  IF p_target_status = 'published' THEN
    IF to_regclass('education_source_revision_private.revisions') IS NOT NULL THEN
      EXECUTE 'SELECT COALESCE(array_agg(source_version_id), ''{}''::uuid[])
               FROM education_source_revision_private.revisions WHERE version_id = $1'
        INTO v_keep USING p_schedule_version_id;
    END IF;
    FOR v_other IN
      SELECT id FROM public.schedule_versions
      WHERE college_id = p_college_id AND academic_term_id = v_version.academic_term_id
        AND status = 'published' AND id <> p_schedule_version_id AND NOT (id = ANY (v_keep))
      ORDER BY id FOR UPDATE
    LOOP
      UPDATE public.schedule_versions SET status = 'archived'
      WHERE id = v_other.id AND status = 'published';
      INSERT INTO public.schedule_version_events (
        college_id, schedule_version_id, event_type, from_status, to_status,
        performed_by, notes, metadata
      ) VALUES (
        p_college_id, v_other.id, 'archived', 'published', 'archived', v_actor,
        'أُرشفت تلقائيًا عند نشر نسخة أحدث لنفس الفصل.',
        jsonb_build_object('atomic', true, 'superseded_by', p_schedule_version_id)
      );
      v_archived := v_archived || v_other.id;
    END LOOP;
  END IF;

  v_event_type := CASE p_expected_status || '->' || p_target_status
    WHEN 'draft->review' THEN 'submitted_for_review'
    WHEN 'review->approved' THEN 'approved'
    WHEN 'approved->published' THEN 'published'
    WHEN 'published->archived' THEN 'archived'
    WHEN 'review->draft' THEN 'rolled_back_to_draft'
    WHEN 'approved->review' THEN 'rolled_back_to_review'
  END;
  UPDATE public.schedule_versions
  SET status = p_target_status,
      published_at = CASE WHEN p_target_status = 'published' THEN now() ELSE published_at END
  WHERE id = p_schedule_version_id AND college_id = p_college_id AND status = p_expected_status;
  IF NOT FOUND THEN RAISE EXCEPTION 'STALE_VERSION_STATUS' USING ERRCODE = '40001'; END IF;

  INSERT INTO public.schedule_version_events (
    college_id, schedule_version_id, event_type, from_status, to_status,
    performed_by, notes, metadata
  ) VALUES (
    p_college_id, p_schedule_version_id, v_event_type, p_expected_status,
    p_target_status, v_actor, p_notes,
    jsonb_build_object('atomic', true, 'quality_score', v_quality_score,
      'eligibility_revision', v_version.eligibility_revision,
      'unapproved_hard_conflicts', COALESCE(v_hard_conflicts, 0),
      'server_validated', v_server IS NOT NULL,
      'approved_hard_conflicts', COALESCE((v_server->>'approved_count')::integer, 0),
      'waived_conflicts', COALESCE((v_server->>'waived_count')::integer, 0),
      'archived_superseded', to_jsonb(v_archived))
  );
  RETURN jsonb_build_object('id', p_schedule_version_id, 'status', p_target_status,
    'archived_superseded', to_jsonb(v_archived));
END $fn$;
REVOKE ALL ON FUNCTION public.transition_schedule_version(uuid, uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_schedule_version(uuid, uuid, text, text, text) TO authenticated, service_role;

-- M-9: the single "current published version" reader. SECURITY INVOKER: a client sees only
-- versions its RLS allows; definer callers (workload readers) see all.
CREATE OR REPLACE FUNCTION public.current_published_version(p_college_id uuid, p_term_id uuid)
RETURNS uuid LANGUAGE sql STABLE SET search_path = public, pg_temp AS $fn$
  SELECT v.id FROM public.schedule_versions v
  WHERE v.college_id = p_college_id AND v.academic_term_id = p_term_id AND v.status = 'published'
  ORDER BY public.schedule_version_published_at(v.id) DESC NULLS LAST, v.created_at DESC, v.id DESC
  LIMIT 1
$fn$;
REVOKE ALL ON FUNCTION public.current_published_version(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_published_version(uuid, uuid) TO authenticated, service_role;

-- AGENTS.md: a delivery group merged as a member in THE published timetable of its college and
-- term, with no session of its own there, carries no standard load. "The" published timetable is
-- now public.current_published_version (was: newest created_at). plpgsql so that databases
-- without the version-scoped delivery facts still replay; there it reports false.
CREATE OR REPLACE FUNCTION public.delivery_group_shared_in_published(p_group uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_result boolean := false;
BEGIN
  IF to_regclass('schedule_version_delivery_private.shared_link_facts') IS NULL THEN
    RETURN false;
  END IF;
  EXECUTE $q$
    SELECT EXISTS (
      SELECT 1
      FROM schedule_version_delivery_private.shared_link_facts l
      JOIN public.schedule_versions v ON v.id = l.version_id
      WHERE l.member_group_id = $1
        AND v.status = 'published'
        AND v.id = public.current_published_version(v.college_id, v.academic_term_id)
        AND NOT EXISTS (
          SELECT 1 FROM public.schedule_sessions s
          WHERE s.schedule_version_id = v.id AND s.delivery_group_id = $1))
  $q$ INTO v_result USING p_group;
  RETURN COALESCE(v_result, false);
END $fn$;
REVOKE ALL ON FUNCTION public.delivery_group_shared_in_published(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delivery_group_shared_in_published(uuid) TO authenticated, service_role;

-- M-9: enforce uniqueness when the live data allows it; otherwise report the duplicates
-- for a human decision (never auto-archive history in a migration).
-- Query to list duplicates:
--   SELECT college_id, academic_term_id, array_agg(id ORDER BY created_at) AS versions
--   FROM public.schedule_versions WHERE status = 'published'
--   GROUP BY 1, 2 HAVING count(*) > 1;
DO $uniq$
DECLARE d record; n integer := 0;
BEGIN
  IF to_regclass('public.uq_schedule_versions_one_published') IS NOT NULL THEN RETURN; END IF;
  FOR d IN
    SELECT college_id, academic_term_id, array_agg(id ORDER BY created_at) AS versions
    FROM public.schedule_versions WHERE status = 'published'
    GROUP BY 1, 2 HAVING count(*) > 1
  LOOP
    n := n + 1;
    RAISE NOTICE 'DUPLICATE_PUBLISHED_VERSIONS college=% term=% versions=%',
      d.college_id, d.academic_term_id, d.versions;
  END LOOP;
  IF n = 0 THEN
    CREATE UNIQUE INDEX uq_schedule_versions_one_published
      ON public.schedule_versions (college_id, academic_term_id) WHERE status = 'published';
  ELSE
    RAISE NOTICE 'uq_schedule_versions_one_published NOT created: % college/term pairs have several published versions; archive the superseded ones via transition_schedule_version, then re-run this block.', n;
  END IF;
END $uniq$;

COMMIT;
