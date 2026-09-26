-- Timetable-only exception for a source-named lecturer whose canonical record
-- belongs to another college. No teaching assignment or payroll approval is
-- created. The source row must explicitly reference this real instructor;
-- the ordinary cross-college timing guard still checks the actual identity.
CREATE OR REPLACE FUNCTION public.education_2026f_source_external_session_allowed(
  p_session public.schedule_sessions)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'pg_catalog','public' AS $fn$
  SELECT p_session.teaching_assignment_id IS NULL
    AND p_session.schedule_version_id='7430bad7-2de7-5c90-9368-b214a199d6c3'::uuid
    AND p_session.college_id='1ee291b2-bec9-43d3-b42b-5a4f46946399'::uuid
    AND EXISTS (
      SELECT 1 FROM public.existing_schedule_source_rows src
      JOIN public.schedule_versions v ON v.id=src.schedule_version_id
      JOIN public.academic_terms t ON t.id=src.term_id
      JOIN public.delivery_groups g ON g.id=src.delivery_group_id
      JOIN public.academic_cohorts ac ON ac.id=g.cohort_id
      WHERE src.delivery_group_id=p_session.delivery_group_id
        AND src.cohort_id=p_session.cohort_id
        AND src.component_id=p_session.plan_course_component_id
        AND p_session.instructor_id=ANY(src.instructor_ids)
        AND src.source_id=g.group_code
        AND src.source_file IN ('كيمياء.docx',
          'جدول قسم الدراسات الإسلامية 2026-2026م ,نهائي.docx')
        AND src.college_id=p_session.college_id
        AND src.schedule_version_id=p_session.schedule_version_id
        AND src.term_id='93705393-609d-4605-ae94-9572cd8b2090'::uuid
        AND ac.term_id=src.term_id AND v.status='draft'
        AND t.academic_year='2026-2027' AND t.term_type='first'
        AND public.existing_schedule_intake_enabled(t.college_id,t.id)
    );
$fn$;

-- Preserve the current college guard verbatim except for this narrow extra
-- disjunct; stop migration if another version changed the guarded passage.
DO $patch$
DECLARE v_definition text; v_old text :=
  'AND NOT public.education_canonical_home_assignment(NEW.teaching_assignment_id, NEW.instructor_id, NEW.college_id, NEW.delivery_group_id) AND NOT EXISTS (';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO STRICT v_definition FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='ensure_ss_college'
    AND pg_get_function_identity_arguments(p.oid)='';
  IF position('AND NOT public.education_2026f_source_external_session_allowed(NEW)' IN v_definition)>0
  THEN RETURN; END IF;
  IF position(v_old IN v_definition)=0 THEN
    RAISE EXCEPTION 'EDU26F_COLLEGE_GUARD_DRIFT';
  END IF;
  EXECUTE replace(v_definition,v_old,
    'AND NOT public.education_canonical_home_assignment(NEW.teaching_assignment_id, NEW.instructor_id, NEW.college_id, NEW.delivery_group_id) AND NOT public.education_2026f_source_external_session_allowed(NEW) AND NOT EXISTS (');
END;
$patch$;
