-- Imported timetable groups do not have approved headcounts or generator
-- group numbers. Allow their sessions only in this one draft and only when
-- the exact source row supplies the group, cohort, component and offering.
-- All unrelated delivery groups retain the ordinary freshness guard.
CREATE OR REPLACE FUNCTION public.guard_schedule_session_current_delivery_group()
RETURNS trigger LANGUAGE plpgsql
SET search_path TO 'pg_catalog','public' AS $guard$
DECLARE
  g public.delivery_groups%ROWTYPE;
  fresh jsonb;
BEGIN
  IF NEW.delivery_group_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO g FROM public.delivery_groups WHERE id=NEW.delivery_group_id;
  IF g.id IS NULL OR NOT coalesce(g.active,true) OR coalesce(g.is_obsolete,false) THEN
    RAISE EXCEPTION 'OBSOLETE_DELIVERY_GROUP_SESSION_FORBIDDEN' USING ERRCODE='23514';
  END IF;
  IF NEW.schedule_version_id='7430bad7-2de7-5c90-9368-b214a199d6c3'::uuid
    AND NEW.college_id='1ee291b2-bec9-43d3-b42b-5a4f46946399'::uuid
    AND g.group_code LIKE 'EDU-2026F-%'
    AND NEW.cohort_id=g.cohort_id AND NEW.plan_course_component_id=g.component_id
    AND EXISTS (
      SELECT 1 FROM public.existing_schedule_source_rows src
      JOIN public.academic_cohorts ac ON ac.id=src.cohort_id
      JOIN public.plan_courses pc ON pc.id=src.plan_course_id
      JOIN public.course_offerings co ON co.plan_course_id=pc.id
      JOIN public.schedule_versions v ON v.id=src.schedule_version_id
      JOIN public.academic_terms t ON t.id=src.term_id
      WHERE src.source_id=g.group_code AND src.delivery_group_id=g.id
        AND src.cohort_id=g.cohort_id AND src.component_id=g.component_id
        AND src.plan_course_id=g.plan_course_id
        AND src.college_id=NEW.college_id AND src.term_id=t.id
        AND src.schedule_version_id=NEW.schedule_version_id
        AND src.source_file IN ('كيمياء.docx',
          'جدول قسم الدراسات الإسلامية 2026-2026م ,نهائي.docx')
        AND ac.term_id=t.id AND ac.study_plan_id=pc.study_plan_id
        AND co.id=NEW.course_offering_id AND co.term_id=t.id
        AND co.program_id=ac.program_id AND co.level_id=ac.level_id
        AND v.status='draft' AND t.academic_year='2026-2027'
        AND t.term_type='first' AND public.existing_schedule_intake_enabled(t.college_id,t.id)
    )
  THEN RETURN NEW; END IF;
  fresh:=public.delivery_group_derivation_status(NEW.delivery_group_id,NEW.schedule_version_id);
  IF NOT coalesce((fresh->>'ok')::boolean,false) THEN
    RAISE EXCEPTION 'STALE_DELIVERY_GROUPS_REGENERATE' USING ERRCODE='23514',DETAIL=fresh::text;
  END IF;
  RETURN NEW;
END;
$guard$;
