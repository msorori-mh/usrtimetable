-- PROPOSED — NOT APPLIED. Reviewable migration for version-scoped teaching
-- assignments (ITCS draft d68d8d22 vs published 30f8a76d).
--
-- Contract:
--  * The old assignment stays active and bound to every other version
--    (published history is never rewritten).
--  * A replacement assignment is scoped to exactly one DRAFT version and is
--    counted only by the version-scoped allocation validator.
--  * Cross-college lecturers need an approved faculty_teaching_request decided
--    by a user who can manage the home college (auth.uid path, no SQL approval).
--  * No trigger is disabled; every existing guard on teaching_assignments and
--    schedule_sessions still fires on the writes below.
--  * Every step fails closed.

CREATE SCHEMA IF NOT EXISTS assignment_version_private;
REVOKE ALL ON SCHEMA assignment_version_private FROM PUBLIC;

CREATE TABLE assignment_version_private.scope (
  assignment_id uuid PRIMARY KEY
    REFERENCES public.teaching_assignments(id) DEFERRABLE INITIALLY DEFERRED,
  version_id uuid NOT NULL REFERENCES public.schedule_versions(id),
  replaces_assignment_id uuid NOT NULL REFERENCES public.teaching_assignments(id),
  request_id uuid,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version_id, replaces_assignment_id)
);
CREATE TABLE assignment_version_private.publish_expectation (
  version_id uuid PRIMARY KEY REFERENCES public.schedule_versions(id),
  expected_sessions integer NOT NULL CHECK (expected_sessions > 0),
  expected_snapshot text NOT NULL,
  set_by uuid NOT NULL,
  set_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON ALL TABLES IN SCHEMA assignment_version_private FROM PUBLIC;
GRANT USAGE ON SCHEMA assignment_version_private TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA assignment_version_private TO service_role;

-- 1) Global validator: identical to the live definition except that
--    version-scoped rows are excluded (they are validated per version below).
CREATE OR REPLACE FUNCTION public.validate_assignment_allocation_locked(
  p_delivery_group_id uuid, p_exclude_assignment_id uuid, p_new_hours numeric,
  p_component_hours numeric, p_include_new_row boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $function$
DECLARE
  v_co_count integer; v_null_split_count integer; v_sum_assigned numeric;
BEGIN
  SELECT COUNT(*)::integer,
         COUNT(*) FILTER (WHERE ta.assigned_component_hours IS NULL
           AND (p_exclude_assignment_id IS NULL OR ta.id IS DISTINCT FROM p_exclude_assignment_id))::integer
           + CASE WHEN p_include_new_row AND p_new_hours IS NULL THEN 1 ELSE 0 END,
         COALESCE(SUM(ta.assigned_component_hours) FILTER (
           WHERE p_exclude_assignment_id IS NULL OR ta.id IS DISTINCT FROM p_exclude_assignment_id), 0)
           + CASE WHEN p_include_new_row THEN COALESCE(p_new_hours, 0) ELSE 0 END
    INTO v_co_count, v_null_split_count, v_sum_assigned
  FROM public.teaching_assignments ta
  WHERE ta.delivery_group_id = p_delivery_group_id
    AND ta.is_active = TRUE
    AND NOT EXISTS (SELECT 1 FROM assignment_version_private.scope s
                    WHERE s.assignment_id = ta.id);

  IF p_include_new_row AND (p_exclude_assignment_id IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.teaching_assignments ta2
       WHERE ta2.id = p_exclude_assignment_id
         AND ta2.delivery_group_id = p_delivery_group_id AND ta2.is_active = TRUE)) THEN
    v_co_count := v_co_count + 1;
  END IF;
  IF v_co_count > 1 AND v_null_split_count > 0 THEN
    RAISE EXCEPTION 'CO_TEACHING_HOURS_SPLIT_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;
  IF p_component_hours IS NOT NULL AND v_sum_assigned > p_component_hours THEN
    RAISE EXCEPTION 'CO_TEACHING_HOURS_OVER_ALLOCATED' USING ERRCODE = 'check_violation';
  END IF;
END;
$function$;

-- 2) Assignments effective inside one version.
CREATE OR REPLACE FUNCTION public.version_effective_assignments(p_version uuid)
RETURNS TABLE (assignment_id uuid, delivery_group_id uuid, assigned_component_hours numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT ta.id, ta.delivery_group_id, ta.assigned_component_hours
  FROM public.teaching_assignments ta
  WHERE ta.is_active
    AND (
      EXISTS (SELECT 1 FROM assignment_version_private.scope s
              WHERE s.assignment_id = ta.id AND s.version_id = p_version)
      OR (NOT EXISTS (SELECT 1 FROM assignment_version_private.scope s
                      WHERE s.assignment_id = ta.id)
          AND NOT EXISTS (SELECT 1 FROM assignment_version_private.scope s
                          WHERE s.replaces_assignment_id = ta.id AND s.version_id = p_version)))
$$;

CREATE OR REPLACE FUNCTION public.validate_version_assignment_allocation(
  p_version uuid, p_delivery_group_id uuid, p_component_hours numeric)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_count integer; v_nulls integer; v_sum numeric;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE e.assigned_component_hours IS NULL),
         coalesce(sum(e.assigned_component_hours), 0)
    INTO v_count, v_nulls, v_sum
  FROM public.version_effective_assignments(p_version) e
  WHERE e.delivery_group_id = p_delivery_group_id;
  IF v_count > 1 AND v_nulls > 0 THEN
    RAISE EXCEPTION 'VERSION_CO_TEACHING_HOURS_SPLIT_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;
  IF p_component_hours IS NOT NULL AND v_sum > p_component_hours THEN
    RAISE EXCEPTION 'VERSION_CO_TEACHING_HOURS_OVER_ALLOCATED' USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

-- 3) Deterministic snapshot of one version's sessions.
CREATE OR REPLACE FUNCTION public.schedule_version_session_snapshot(p_version uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT md5(coalesce(string_agg(concat_ws('|', s.id, s.teaching_assignment_id, s.instructor_id,
           s.day_of_week, s.start_time, s.end_time, s.room_id, s.delivery_group_id,
           s.cohort_id, s.schedule_version_id), E'\n' ORDER BY s.id), ''))
  FROM public.schedule_sessions s WHERE s.schedule_version_id = p_version
$$;

-- 4) Replace one assignment inside one draft version.
CREATE OR REPLACE FUNCTION public.create_version_scoped_replacement_assignment(
  p_version uuid, p_replaces uuid, p_instructor uuid, p_hours numeric,
  p_request_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ver public.schedule_versions%ROWTYPE;
  v_old public.teaching_assignments%ROWTYPE;
  v_ins record; v_req record;
  v_new uuid := gen_random_uuid();
  v_before int; v_after int;
  v_other_before text; v_other_after text;
  v_fixed_before text; v_fixed_after text;
  v_component numeric;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_ver FROM public.schedule_versions WHERE id = p_version FOR UPDATE;
  IF NOT FOUND OR v_ver.status <> 'draft' THEN
    RAISE EXCEPTION 'VERSION_NOT_DRAFT' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT public.can_manage_college(v_uid, v_ver.college_id) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_old FROM public.teaching_assignments WHERE id = p_replaces FOR UPDATE;
  IF NOT FOUND OR NOT v_old.is_active OR v_old.college_id <> v_ver.college_id THEN
    RAISE EXCEPTION 'REPLACED_ASSIGNMENT_INVALID' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM assignment_version_private.scope WHERE assignment_id = p_replaces) THEN
    RAISE EXCEPTION 'REPLACED_ASSIGNMENT_IS_VERSION_SCOPED' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM assignment_version_private.scope
             WHERE version_id = p_version AND replaces_assignment_id = p_replaces) THEN
    RAISE EXCEPTION 'ASSIGNMENT_ALREADY_REPLACED_IN_VERSION' USING ERRCODE = 'unique_violation';
  END IF;

  SELECT i.id, i.college_id, i.is_active, i.availability_status INTO v_ins
  FROM public.instructors i WHERE i.id = p_instructor;
  IF NOT FOUND OR NOT v_ins.is_active OR v_ins.availability_status <> 'available' THEN
    RAISE EXCEPTION 'INSTRUCTOR_NOT_AVAILABLE' USING ERRCODE = 'check_violation';
  END IF;
  IF v_ins.college_id <> v_ver.college_id THEN
    SELECT * INTO v_req FROM public.faculty_teaching_requests r
    WHERE r.id = p_request_id FOR UPDATE;
    IF NOT FOUND OR v_req.status <> 'approved' OR v_req.decided_by IS NULL
       OR v_req.instructor_id <> p_instructor
       OR v_req.delivery_group_id <> v_old.delivery_group_id
       OR v_req.college_id <> v_ver.college_id
       OR v_req.home_college_id <> v_ins.college_id
       OR v_req.assignment_id IS NOT NULL
       OR v_req.assigned_hours <> p_hours
       OR NOT public.can_manage_college(v_req.decided_by, v_req.home_college_id) THEN
      RAISE EXCEPTION 'HOME_COLLEGE_APPROVAL_REQUIRED' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  SELECT count(*) INTO v_before FROM public.schedule_sessions
  WHERE schedule_version_id = p_version AND teaching_assignment_id = p_replaces;
  IF v_before = 0 THEN
    RAISE EXCEPTION 'REPLACED_ASSIGNMENT_NOT_IN_VERSION' USING ERRCODE = 'check_violation';
  END IF;
  SELECT md5(coalesce(string_agg(concat_ws('|', s.id, s.schedule_version_id, s.teaching_assignment_id,
           s.instructor_id, s.day_of_week, s.start_time, s.end_time, s.room_id, s.delivery_group_id),
           E'\n' ORDER BY s.id), ''))
    INTO v_other_before FROM public.schedule_sessions s
  WHERE s.teaching_assignment_id = p_replaces AND s.schedule_version_id <> p_version;
  SELECT md5(coalesce(string_agg(concat_ws('|', s.id, s.day_of_week, s.start_time, s.end_time,
           s.room_id, s.delivery_group_id, s.cohort_id), E'\n' ORDER BY s.id), ''))
    INTO v_fixed_before FROM public.schedule_sessions s
  WHERE s.schedule_version_id = p_version AND s.teaching_assignment_id = p_replaces;

  -- Scope first (deferred FK) so the global guard never double counts.
  INSERT INTO assignment_version_private.scope
    (assignment_id, version_id, replaces_assignment_id, request_id, created_by)
  VALUES (v_new, p_version, p_replaces, p_request_id, v_uid);
  INSERT INTO public.teaching_assignments
    (id, college_id, course_offering_id, instructor_id, section_number, session_type,
     weekly_hours, required_room_type, notes, expected_students, section_id, cohort_id,
     plan_course_component_id, delivery_group_id, assigned_component_hours, is_active)
  VALUES (v_new, v_old.college_id, v_old.course_offering_id, p_instructor, v_old.section_number,
     v_old.session_type, v_old.weekly_hours, v_old.required_room_type,
     concat_ws(' ', v_old.notes, '[version-scoped ' || p_version || ']'),
     v_old.expected_students, v_old.section_id, v_old.cohort_id, v_old.plan_course_component_id,
     v_old.delivery_group_id, p_hours, true);

  SELECT c.weekly_hours INTO v_component FROM public.plan_course_components c
  WHERE c.id = v_old.plan_course_component_id;
  PERFORM public.validate_version_assignment_allocation(p_version, v_old.delivery_group_id, v_component);

  IF p_request_id IS NOT NULL THEN
    UPDATE public.faculty_teaching_requests SET assignment_id = v_new WHERE id = p_request_id;
  END IF;

  UPDATE public.schedule_sessions SET teaching_assignment_id = v_new, instructor_id = p_instructor
  WHERE schedule_version_id = p_version AND teaching_assignment_id = p_replaces;
  GET DIAGNOSTICS v_after = ROW_COUNT;

  SELECT md5(coalesce(string_agg(concat_ws('|', s.id, s.schedule_version_id, s.teaching_assignment_id,
           s.instructor_id, s.day_of_week, s.start_time, s.end_time, s.room_id, s.delivery_group_id),
           E'\n' ORDER BY s.id), ''))
    INTO v_other_after FROM public.schedule_sessions s
  WHERE s.teaching_assignment_id = p_replaces AND s.schedule_version_id <> p_version;
  SELECT md5(coalesce(string_agg(concat_ws('|', s.id, s.day_of_week, s.start_time, s.end_time,
           s.room_id, s.delivery_group_id, s.cohort_id), E'\n' ORDER BY s.id), ''))
    INTO v_fixed_after FROM public.schedule_sessions s
  WHERE s.schedule_version_id = p_version AND s.teaching_assignment_id = v_new;
  IF v_after <> v_before OR v_other_after IS DISTINCT FROM v_other_before
     OR v_fixed_after IS DISTINCT FROM v_fixed_before
     OR NOT EXISTS (SELECT 1 FROM public.teaching_assignments WHERE id = p_replaces AND is_active) THEN
    RAISE EXCEPTION 'VERSION_SCOPED_REPLACEMENT_INVARIANT_VIOLATION' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (v_uid, 'version_scoped_assignment_replacement', 'teaching_assignments', v_new,
    v_ver.college_id, jsonb_build_object('version_id', p_version, 'old_assignment_id', p_replaces,
      'new_assignment_id', v_new, 'request_id', p_request_id,
      'draft_sessions_relinked', v_after, 'historical_hash', v_other_before));
  RETURN jsonb_build_object('ok', true, 'new_assignment_id', v_new,
    'old_assignment_id', p_replaces, 'draft_sessions_relinked', v_after);
END;
$$;

-- 5) Batch: all replacements + expected snapshot in one transaction.
--    p_items: [{"replaces":uuid,"instructor":uuid,"hours":n,"request_id":uuid|null}]
CREATE OR REPLACE FUNCTION public.apply_version_scoped_replacements(
  p_version uuid, p_items jsonb, p_expected_total integer, p_expected_unchanged integer,
  p_expected_unchanged_snapshot text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid(); it jsonb; v_total int; v_unchanged int; v_snap text;
  v_replaced uuid[]; v_results jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501'; END IF;
  SELECT array_agg((x->>'replaces')::uuid) INTO v_replaced FROM jsonb_array_elements(p_items) x;
  IF v_replaced IS NULL OR cardinality(v_replaced) <> (SELECT count(DISTINCT u) FROM unnest(v_replaced) u) THEN
    RAISE EXCEPTION 'BATCH_ITEMS_INVALID' USING ERRCODE = 'check_violation';
  END IF;
  SELECT count(*),
         md5(coalesce(string_agg(concat_ws('|', s.id, s.teaching_assignment_id, s.instructor_id,
           s.day_of_week, s.start_time, s.end_time, s.room_id, s.delivery_group_id),
           E'\n' ORDER BY s.id), ''))
    INTO v_unchanged, v_snap FROM public.schedule_sessions s
  WHERE s.schedule_version_id = p_version AND NOT (s.teaching_assignment_id = ANY (v_replaced));
  IF v_unchanged <> p_expected_unchanged OR v_snap <> p_expected_unchanged_snapshot THEN
    RAISE EXCEPTION 'BATCH_SNAPSHOT_MISMATCH' USING ERRCODE = 'check_violation';
  END IF;
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_results := v_results || public.create_version_scoped_replacement_assignment(
      p_version, (it->>'replaces')::uuid, (it->>'instructor')::uuid,
      (it->>'hours')::numeric, nullif(it->>'request_id', '')::uuid);
  END LOOP;
  SELECT count(*) INTO v_total FROM public.schedule_sessions WHERE schedule_version_id = p_version;
  IF v_total <> p_expected_total THEN
    RAISE EXCEPTION 'BATCH_TOTAL_MISMATCH' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO assignment_version_private.publish_expectation
    (version_id, expected_sessions, expected_snapshot, set_by)
  VALUES (p_version, v_total, public.schedule_version_session_snapshot(p_version), v_uid)
  ON CONFLICT (version_id) DO UPDATE SET expected_sessions = EXCLUDED.expected_sessions,
    expected_snapshot = EXCLUDED.expected_snapshot, set_by = EXCLUDED.set_by, set_at = now();
  RETURN jsonb_build_object('ok', true, 'sessions', v_total, 'unchanged', v_unchanged,
    'replacements', v_results);
END;
$$;

-- 6) Publish readiness for versions that use scoped assignments.
CREATE OR REPLACE FUNCTION public.version_scoped_publish_readiness(p_version uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_exp record; r jsonb; v_over int := 0; g record;
BEGIN
  SELECT * INTO v_exp FROM assignment_version_private.publish_expectation WHERE version_id = p_version;
  FOR g IN SELECT DISTINCT e.delivery_group_id, c.weekly_hours
           FROM public.version_effective_assignments(p_version) e
           JOIN public.teaching_assignments ta ON ta.id = e.assignment_id
           LEFT JOIN public.plan_course_components c ON c.id = ta.plan_course_component_id LOOP
    BEGIN
      PERFORM public.validate_version_assignment_allocation(p_version, g.delivery_group_id, g.weekly_hours);
    EXCEPTION WHEN check_violation THEN v_over := v_over + 1;
    END;
  END LOOP;
  WITH s AS (SELECT * FROM public.schedule_sessions WHERE schedule_version_id = p_version),
  clash AS (
    SELECT count(*) n FROM s a JOIN s b ON a.id < b.id AND a.day_of_week = b.day_of_week
      AND a.start_time < b.end_time AND b.start_time < a.end_time
    WHERE a.instructor_id = b.instructor_id OR a.room_id = b.room_id
       OR a.delivery_group_id = b.delivery_group_id),
  idays AS (SELECT count(*) n FROM (SELECT instructor_id FROM s GROUP BY 1
            HAVING count(DISTINCT day_of_week) > 4) x),
  lone AS (SELECT count(*) n FROM (SELECT cohort_id, day_of_week FROM s
           WHERE cohort_id IS NOT NULL GROUP BY 1, 2 HAVING count(*) = 1) x)
  SELECT jsonb_build_object(
    'sessions', (SELECT count(*) FROM s),
    'expected_sessions', v_exp.expected_sessions,
    'snapshot_matches', v_exp.expected_snapshot = public.schedule_version_session_snapshot(p_version),
    'missing_instructor_or_room', (SELECT count(*) FROM s WHERE instructor_id IS NULL OR room_id IS NULL),
    'hard_conflicts', (SELECT n FROM clash),
    'instructors_over_4_days', (SELECT n FROM idays),
    'single_session_student_days', (SELECT n FROM lone),
    'over_allocated_groups', v_over) INTO r;
  RETURN r || jsonb_build_object('ok',
    v_exp.version_id IS NOT NULL
    AND (r->>'sessions')::int = v_exp.expected_sessions
    AND (r->>'snapshot_matches')::boolean
    AND (r->>'missing_instructor_or_room')::int = 0
    AND (r->>'hard_conflicts')::int = 0
    AND (r->>'instructors_over_4_days')::int = 0
    AND (r->>'single_session_student_days')::int = 0
    AND v_over = 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_version_scoped_publish()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r jsonb;
BEGIN
  IF NEW.status = 'published' AND OLD.status IS DISTINCT FROM 'published'
     AND EXISTS (SELECT 1 FROM assignment_version_private.scope WHERE version_id = NEW.id) THEN
    r := public.version_scoped_publish_readiness(NEW.id);
    IF NOT coalesce((r->>'ok')::boolean, false) THEN
      RAISE EXCEPTION 'VERSION_SCOPED_PUBLISH_BLOCKED: %', r USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  -- Scoped assignments may not leak into a non-draft edit of another version.
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_guard_version_scoped_publish
BEFORE UPDATE OF status ON public.schedule_versions
FOR EACH ROW EXECUTE FUNCTION public.guard_version_scoped_publish();

-- Sessions of other versions can never point at a scoped assignment.
CREATE OR REPLACE FUNCTION public.guard_session_version_scoped_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.teaching_assignment_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM assignment_version_private.scope s
       WHERE s.assignment_id = NEW.teaching_assignment_id
         AND s.version_id <> NEW.schedule_version_id) THEN
    RAISE EXCEPTION 'VERSION_SCOPED_ASSIGNMENT_OTHER_VERSION' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_guard_session_version_scoped_assignment
BEFORE INSERT OR UPDATE OF teaching_assignment_id, schedule_version_id ON public.schedule_sessions
FOR EACH ROW EXECUTE FUNCTION public.guard_session_version_scoped_assignment();

REVOKE ALL ON FUNCTION public.create_version_scoped_replacement_assignment(uuid,uuid,uuid,numeric,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.apply_version_scoped_replacements(uuid,jsonb,integer,integer,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.version_effective_assignments(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.validate_version_assignment_allocation(uuid,uuid,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_version_scoped_replacement_assignment(uuid,uuid,uuid,numeric,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_version_scoped_replacements(uuid,jsonb,integer,integer,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.version_scoped_publish_readiness(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_version_session_snapshot(uuid) TO authenticated;
