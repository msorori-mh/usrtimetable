-- Only this term's source rows can use a provisional lecturer label. Such
-- records represent names printed on a timetable, not verified HR people.
CREATE OR REPLACE FUNCTION public.education_2026f_provisional_name_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'pg_catalog','public' AS $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.instructors i WHERE i.id=NEW.instructor_id
      AND i.external_source LIKE 'EDU26F-NAME:%') THEN
    IF TG_TABLE_NAME='teaching_assignments' THEN
      RAISE EXCEPTION 'EDU26F_PROVISIONAL_NAME_NOT_HR_ASSIGNMENT';
    END IF;
    IF NEW.schedule_version_id<>'7430bad7-2de7-5c90-9368-b214a199d6c3'::uuid
      OR NEW.college_id<>'1ee291b2-bec9-43d3-b42b-5a4f46946399'::uuid
      OR NEW.teaching_assignment_id IS NOT NULL OR NOT EXISTS (
        SELECT 1 FROM public.existing_schedule_source_rows src
        JOIN public.schedule_versions v ON v.id=src.schedule_version_id
        WHERE src.delivery_group_id=NEW.delivery_group_id
          AND src.cohort_id=NEW.cohort_id
          AND src.component_id=NEW.plan_course_component_id
          AND src.source_file IN ('كيمياء.docx',
            'جدول قسم الدراسات الإسلامية 2026-2026م ,نهائي.docx')
          AND src.college_id=NEW.college_id AND src.term_id='93705393-609d-4605-ae94-9572cd8b2090'::uuid
          AND src.schedule_version_id=NEW.schedule_version_id AND v.status='draft'
          AND NEW.instructor_id=ANY(src.instructor_ids))
    THEN RAISE EXCEPTION 'EDU26F_PROVISIONAL_NAME_OUTSIDE_TERM'; END IF;
  END IF;
  RETURN NEW;
END;
$guard$;

DROP TRIGGER IF EXISTS education_2026f_provisional_session ON public.schedule_sessions;
CREATE TRIGGER education_2026f_provisional_session BEFORE INSERT OR UPDATE OF instructor_id,
  schedule_version_id,delivery_group_id,cohort_id,plan_course_component_id,teaching_assignment_id
  ON public.schedule_sessions FOR EACH ROW EXECUTE FUNCTION public.education_2026f_provisional_name_guard();
DROP TRIGGER IF EXISTS education_2026f_provisional_assignment ON public.teaching_assignments;
CREATE TRIGGER education_2026f_provisional_assignment BEFORE INSERT OR UPDATE OF instructor_id
  ON public.teaching_assignments FOR EACH ROW EXECUTE FUNCTION public.education_2026f_provisional_name_guard();
