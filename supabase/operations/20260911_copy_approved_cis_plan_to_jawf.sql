-- User-directed data repair: Jawf follows the same CIS plan.
-- Scope: the existing ITCS Jawf program only. Preserve courses, cohorts and headcounts.
-- Preflight: source 45 plan courses / 75 components; destination has four mapped levels.
-- This operation copies optional slots but does not invent or approve elective choices.
BEGIN;
DO $repair$
DECLARE
  v_college uuid := '7168345f-cf9d-4789-b2ad-547abb687dc8';
  v_source uuid := 'f982800c-1787-4a75-b40c-464e3a8feb4f';
  v_program uuid := 'dd991d15-aef5-4e3e-a59d-724a89ee1f66';
  v_target uuid;
BEGIN
  LOCK TABLE public.study_plans, public.plan_courses, public.plan_course_components,
    public.elective_slots, public.elective_slot_courses IN SHARE ROW EXCLUSIVE MODE;
  IF NOT EXISTS (SELECT 1 FROM public.study_plans WHERE id=v_source AND college_id=v_college
    AND program_id='a1aa48db-c06e-4e49-aef4-8d7acf4cd0b6' AND code='CIS-2026-2027' AND is_active)
    OR NOT EXISTS (SELECT 1 FROM public.academic_programs WHERE id=v_program AND college_id=v_college AND code='cis_jwf') THEN
    RAISE EXCEPTION 'CIS_JAWF_SOURCE_CONTEXT_CHANGED';
  END IF;
  IF (SELECT count(*) FROM public.plan_courses WHERE study_plan_id=v_source)<>45
    OR (SELECT count(*) FROM public.plan_course_components pcc JOIN public.plan_courses pc ON pc.id=pcc.plan_course_id WHERE pc.study_plan_id=v_source)<>75 THEN
    RAISE EXCEPTION 'CIS_JAWF_SOURCE_COUNTS_CHANGED';
  END IF;
  IF EXISTS (SELECT 1 FROM public.study_plans WHERE program_id=v_program) THEN
    RAISE NOTICE 'Jawf already has a plan; no data was changed. Verify the existing plan separately.';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.academic_levels sl
    WHERE sl.id IN (SELECT level_id FROM public.plan_courses WHERE study_plan_id=v_source)
      AND (SELECT count(*) FROM public.academic_levels dl WHERE dl.college_id=v_college
        AND dl.program_id=v_program AND dl.level_number=sl.level_number)<>1) THEN
    RAISE EXCEPTION 'CIS_JAWF_LEVEL_MAPPING_INVALID';
  END IF;
  INSERT INTO public.study_plans(college_id,program_id,code,name,version,effective_year,is_active)
    SELECT v_college,v_program,'CIS-JWF-2026-2027','خطة نظم المعلومات الحاسوبية - الجوف',version,effective_year,true
    FROM public.study_plans WHERE id=v_source RETURNING id INTO v_target;
  CREATE TEMP TABLE jawf_course_map ON COMMIT DROP AS
    SELECT pc.id AS source_id,gen_random_uuid() AS target_id,dl.id AS level_id
    FROM public.plan_courses pc JOIN public.academic_levels sl ON sl.id=pc.level_id
    JOIN public.academic_levels dl ON dl.program_id=v_program AND dl.college_id=v_college AND dl.level_number=sl.level_number
    WHERE pc.study_plan_id=v_source;
  IF (SELECT count(*) FROM jawf_course_map)<>45 THEN RAISE EXCEPTION 'CIS_JAWF_COURSE_MAP_INCOMPLETE'; END IF;
  INSERT INTO public.plan_courses(id,college_id,study_plan_id,course_id,level_id,semester,is_required,
    lecture_session_duration,lab_session_duration,lectures_per_week,labs_per_week,
    required_room_type_for_lecture,required_room_type_for_lab)
  SELECT m.target_id,v_college,v_target,pc.course_id,m.level_id,pc.semester,pc.is_required,
    pc.lecture_session_duration,pc.lab_session_duration,pc.lectures_per_week,pc.labs_per_week,
    pc.required_room_type_for_lecture,pc.required_room_type_for_lab
  FROM public.plan_courses pc JOIN jawf_course_map m ON m.source_id=pc.id;
  INSERT INTO public.plan_course_components(college_id,plan_course_id,component_type,weekly_contact_hours,
    required_room_type_id,is_timetabled,counts_toward_regular_load,counts_toward_overtime,compensation_mode,explicit_group_size)
  SELECT v_college,m.target_id,pcc.component_type,pcc.weekly_contact_hours,pcc.required_room_type_id,
    pcc.is_timetabled,pcc.counts_toward_regular_load,pcc.counts_toward_overtime,pcc.compensation_mode,pcc.explicit_group_size
  FROM public.plan_course_components pcc JOIN jawf_course_map m ON m.source_id=pcc.plan_course_id;
  CREATE TEMP TABLE jawf_slot_map ON COMMIT DROP AS
    SELECT es.id AS source_id,gen_random_uuid() AS target_id,dl.id AS level_id
    FROM public.elective_slots es LEFT JOIN public.academic_levels sl ON sl.id=es.level_id
    LEFT JOIN public.academic_levels dl ON dl.program_id=v_program AND dl.college_id=v_college AND dl.level_number=sl.level_number
    WHERE es.study_plan_id=v_source;
  INSERT INTO public.elective_slots(id,college_id,study_plan_id,level_id,semester,slot_code,label,required_component_type,active)
    SELECT m.target_id,v_college,v_target,m.level_id,es.semester,es.slot_code,es.label,es.required_component_type,es.active
    FROM public.elective_slots es JOIN jawf_slot_map m ON m.source_id=es.id;
  INSERT INTO public.elective_slot_courses(college_id,elective_slot_id,course_id,active)
    SELECT v_college,m.target_id,esc.course_id,esc.active FROM public.elective_slot_courses esc
    JOIN jawf_slot_map m ON m.source_id=esc.elective_slot_id;
END;
$repair$;
COMMIT;
