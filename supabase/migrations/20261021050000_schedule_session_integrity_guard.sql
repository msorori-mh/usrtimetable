-- H-6 (track C): the database enforces the hard scheduling rules on every session write that
-- does not come through a server function, and clients lose direct DML on schedule_sessions.
--
-- Deferred constraint triggers re-run the authoritative collector (public._ss_gather through
-- _collect_schedule_session_move_conflicts) and the membership-aware student overlap for each
-- inserted row, and for each updated row whose placement or identity changed, at commit time.
-- They raise SCHEDULE_HARD_CONFLICTS for hard conflicts not covered by an approved exception
-- or a super-admin policy waiver. Carve-outs: replaced_by_split rows, versions that are not
-- draft/review (approved/published/archived are locked separately), and a merged lecture
-- recorded on several rows (same time, instructor, room and offering) is not a clash.
--
-- Scope: the WHEN clause (evaluated at write time, not at commit) skips writes performed by
-- the function owner, i.e. inside SECURITY DEFINER server functions
-- (create_schedule_session_from_assignment_v2, move_or_reschedule_schedule_session,
-- save_manual_schedule_session, apply_schedule_generation, clone, cutover, relayout, imports),
-- which run the same collector themselves or replay reviewed manifests; re-checking them
-- would reject copies of historical published timetables (clone) and reviewed cutovers.
-- Every other writer (service_role scripts, any future grant) is checked.
BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_schedule_session_hard_rules()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  s public.schedule_sessions%ROWTYPE;
  v_status text;
  v_bundle jsonb;
  v_dg jsonb := '[]'::jsonb;
  v_class jsonb;
  v_blocking jsonb;
BEGIN
  SELECT * INTO s FROM public.schedule_sessions WHERE id = NEW.id;
  IF NOT FOUND OR COALESCE(s.replaced_by_split, false) THEN RETURN NULL; END IF;
  SELECT status INTO v_status FROM public.schedule_versions WHERE id = s.schedule_version_id;
  IF v_status IS DISTINCT FROM 'draft' AND v_status IS DISTINCT FROM 'review' THEN RETURN NULL; END IF;

  v_bundle := public._collect_schedule_session_move_conflicts(
    s.id, s.college_id, s.schedule_version_id, s.instructor_id, s.section_id,
    s.course_offering_id, s.teaching_assignment_id, s.study_system, s.expected_students,
    s.day_of_week, s.start_time, s.end_time, s.room_id);
  IF s.delivery_group_id IS NOT NULL OR s.cohort_id IS NOT NULL THEN
    v_dg := public._sb_v2_delivery_group_overlap(s.schedule_version_id, s.delivery_group_id,
      s.cohort_id, s.day_of_week, s.start_time, s.end_time, s.id);
  END IF;
  v_class := public._sv_classify_conflicts(s.schedule_version_id,
    COALESCE(v_bundle->'all_conflicts', '[]'::jsonb) || v_dg);
  IF (v_class->>'hard_count')::integer > 0 THEN
    SELECT jsonb_agg(c) INTO v_blocking FROM jsonb_array_elements(v_class->'conflicts') c
    WHERE c->>'severity' = 'hard' AND NOT (c->>'approved_exception')::boolean;
    RAISE EXCEPTION 'SCHEDULE_HARD_CONFLICTS'
      USING ERRCODE = '23514', DETAIL = v_blocking::text,
            HINT = 'تعارضات إلزامية تمنع حفظ المحاضرة ' || s.id::text;
  END IF;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.enforce_schedule_session_hard_rules() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS schedule_sessions_hard_rules_insert ON public.schedule_sessions;
CREATE CONSTRAINT TRIGGER schedule_sessions_hard_rules_insert
  AFTER INSERT ON public.schedule_sessions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (CURRENT_USER NOT IN ('postgres', 'supabase_admin') AND NOT NEW.replaced_by_split)
  EXECUTE FUNCTION public.enforce_schedule_session_hard_rules();

DROP TRIGGER IF EXISTS schedule_sessions_hard_rules_update ON public.schedule_sessions;
CREATE CONSTRAINT TRIGGER schedule_sessions_hard_rules_update
  AFTER UPDATE ON public.schedule_sessions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (CURRENT_USER NOT IN ('postgres', 'supabase_admin') AND NOT NEW.replaced_by_split AND (
    OLD.day_of_week, OLD.start_time, OLD.end_time, OLD.room_id, OLD.instructor_id, OLD.section_id,
    OLD.section_subgroup_id, OLD.course_offering_id, OLD.teaching_assignment_id, OLD.delivery_group_id,
    OLD.cohort_id, OLD.study_system, OLD.expected_students, OLD.schedule_version_id, OLD.replaced_by_split)
    IS DISTINCT FROM (
    NEW.day_of_week, NEW.start_time, NEW.end_time, NEW.room_id, NEW.instructor_id, NEW.section_id,
    NEW.section_subgroup_id, NEW.course_offering_id, NEW.teaching_assignment_id, NEW.delivery_group_id,
    NEW.cohort_id, NEW.study_system, NEW.expected_students, NEW.schedule_version_id, NEW.replaced_by_split))
  EXECUTE FUNCTION public.enforce_schedule_session_hard_rules();

-- Clients write sessions only through the RPCs (move_or_reschedule_schedule_session,
-- create_schedule_session_from_assignment_v2, save_manual_schedule_session,
-- delete_schedule_session, apply_schedule_generation, ...). SELECT stays.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.schedule_sessions FROM authenticated, anon;

COMMIT;
