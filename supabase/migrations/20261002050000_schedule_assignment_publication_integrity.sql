BEGIN;
-- Coverage counts lecturers and scheduled hours by delivery group independently.
-- It cannot prove that each live session still references the effective assignment
-- and its lecturer. Re-check those links inside the authorised lifecycle RPC,
-- including when an earlier zero-conflict quality run otherwise permits release.
-- Existing published/archived sessions and verified unassigned source sessions
-- are not rewritten or reinterpreted by this migration.
CREATE FUNCTION public._assert_schedule_version_assignment_integrity(
  p_college_id uuid, p_schedule_version_id uuid
) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_invalid jsonb;
BEGIN
  WITH effective AS MATERIALIZED (
    SELECT e.assignment_id
    FROM public.version_effective_assignments(p_schedule_version_id) e
  ), invalid AS (
    SELECT ss.id AS session_id, ss.teaching_assignment_id, ss.instructor_id,
           ta.instructor_id AS assigned_instructor_id,
           CASE
             WHEN ta.id IS NULL THEN 'missing_assignment'
             WHEN ta.is_active IS DISTINCT FROM true THEN 'inactive_assignment'
             WHEN ta.instructor_id IS DISTINCT FROM ss.instructor_id THEN 'assignment_instructor_mismatch'
             WHEN e.assignment_id IS NULL THEN 'assignment_not_effective_in_version'
           END AS reason
    FROM public.schedule_sessions ss
    LEFT JOIN public.teaching_assignments ta ON ta.id = ss.teaching_assignment_id
    LEFT JOIN effective e ON e.assignment_id = ss.teaching_assignment_id
    WHERE ss.schedule_version_id = p_schedule_version_id
      AND COALESCE(ss.replaced_by_split, false) = false
      AND ss.teaching_assignment_id IS NOT NULL
  )
  SELECT jsonb_agg(to_jsonb(i) ORDER BY i.session_id)
    INTO v_invalid
  FROM invalid i WHERE i.reason IS NOT NULL;

  IF v_invalid IS NOT NULL THEN
    RAISE EXCEPTION 'PUBLISH_BLOCKER:SCHEDULE_SESSION_ASSIGNMENT_INTEGRITY'
      USING ERRCODE = '23514',
            DETAIL = jsonb_build_object(
              'schedule_version_id', p_schedule_version_id,
              'invalid_sessions', v_invalid
            )::text,
            HINT = 'أعد النسخة إلى مسودة، ثم صحح روابط الإسناد والمحاضرين للجلسات المذكورة وأعد فحص الجودة قبل الاعتماد أو النشر.';
  END IF;
END;
$function$;

-- This helper is not an API. Only the existing SECURITY DEFINER lifecycle
-- function may reach it, after its authentication, college permission and CAS.
REVOKE ALL ON FUNCTION public._assert_schedule_version_assignment_integrity(uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;

DO $patch$
DECLARE
  v_definition text := pg_get_functiondef(
    'public.transition_schedule_version(uuid,uuid,text,text,text)'::regprocedure
  );
  v_marker text := E'  IF p_target_status IN (''review'', ''approved'', ''published'') THEN\n';
  v_insert text := E'    IF (p_expected_status, p_target_status) IN (\n'
    || E'      (''draft'', ''review''), (''review'', ''approved''), (''approved'', ''published'')\n'
    || E'    ) THEN\n'
    || E'      PERFORM public._assert_schedule_version_assignment_integrity(p_college_id, p_schedule_version_id);\n'
    || E'    END IF;\n';
BEGIN
  IF (length(v_definition) - length(replace(v_definition, v_marker, ''))) / length(v_marker) <> 1
     OR position('_assert_schedule_version_assignment_integrity' IN v_definition) > 0 THEN
    RAISE EXCEPTION 'SCHEDULE_ASSIGNMENT_INTEGRITY_LIFECYCLE_DRIFT';
  END IF;
  -- Keep the function's complete live body and privileges. Rollback through
  -- review to draft and archival remain available for repairing/preserving history.
  EXECUTE replace(v_definition, v_marker, v_marker || v_insert);
END;
$patch$;
COMMIT;
