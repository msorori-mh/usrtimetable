BEGIN;
-- Read-only "assignments as seen by one schedule version" for the manual
-- teaching-assignment workspace.
--
-- The operational workspace (list_teaching_assignment_workspace) deliberately
-- shows the counted, operational assignments: draft-scoped replacements are
-- separate alternatives until their version is promoted. A coordinator who is
-- reviewing a draft therefore saw lecturers on the assignment page that differ
-- from the lecturers on that draft's timetable, and scoped groups looked
-- unassigned.
--
-- This adds a sibling read model that resolves each delivery group through
-- public.version_effective_assignments(version), the same definition the
-- publish gate and validate_version_assignment_allocation already use. It is
-- derived from the live operational function so filters, cohort labels and
-- allocation maths cannot drift apart. No assignment, session, scope row,
-- permission or existing function is changed.
DO $patch$
DECLARE
  src constant regprocedure :=
    'public.list_teaching_assignment_workspace(uuid,uuid,uuid,uuid,text,uuid,text,text)'::regprocedure;
  d text;
  p record;
  occurrences integer;
BEGIN
  d := pg_get_functiondef(src);
  FOR p IN SELECT * FROM (VALUES
    -- 1. New name and leading version argument.
    ($b1$FUNCTION public.list_teaching_assignment_workspace(p_college_id uuid,$b1$,
     $a1$FUNCTION public.list_teaching_assignment_workspace_for_version(p_schedule_version_id uuid, p_college_id uuid,$a1$),
    -- 2. The version must belong to the requested college.
    ($b2$  WITH base AS MATERIALIZED ($b2$,
     $a2$  IF p_schedule_version_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.schedule_versions sv
    WHERE sv.id = p_schedule_version_id AND sv.college_id = p_college_id
  ) THEN
    RAISE EXCEPTION 'SCHEDULE_VERSION_NOT_IN_COLLEGE' USING ERRCODE = 'check_violation';
  END IF;

  WITH base AS MATERIALIZED ($a2$),
    -- 3. Effective assignments of that version instead of the operational set.
    ($b3$WHERE ta.is_active = true AND assignment_version_private.is_counted(ta.id)$b3$,
     $a3$WHERE ta.id IN (
      SELECT e.assignment_id
      FROM public.version_effective_assignments(p_schedule_version_id) e
      WHERE e.college_id = p_college_id
    )$a3$),
    -- 4. Tell the client which lecturers come from a draft-scoped replacement.
    ($b4$'is_active', ta.is_active,$b4$,
     $a4$'is_active', ta.is_active,
          'version_scoped', ta.scope_version_id IS NOT NULL,$a4$),
    -- 5. Echo the version, and never offer write actions in this read model.
    ($b5$'can_manage', public.can_manage_college(v_uid, p_college_id)$b5$,
     $a5$'schedule_version_id', p_schedule_version_id,
    'can_manage', false$a5$)
  ) AS patches(before_text, after_text) LOOP
    occurrences := (length(d) - length(replace(d, p.before_text, ''))) / length(p.before_text);
    IF occurrences <> 1 THEN
      RAISE EXCEPTION 'ASSIGNMENT_WORKSPACE_VERSION_VIEW_DRIFT: expected 1 occurrence of %, found %',
        p.before_text, occurrences;
    END IF;
    d := replace(d, p.before_text, p.after_text);
  END LOOP;
  EXECUTE d;
END $patch$;

REVOKE ALL ON FUNCTION public.list_teaching_assignment_workspace_for_version(
  uuid,uuid,uuid,uuid,uuid,text,uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_teaching_assignment_workspace_for_version(
  uuid,uuid,uuid,uuid,uuid,text,uuid,text,text) TO authenticated;

COMMIT;
