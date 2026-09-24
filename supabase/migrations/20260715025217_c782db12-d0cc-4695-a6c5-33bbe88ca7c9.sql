CREATE OR REPLACE FUNCTION public._collect_schedule_session_move_conflicts(
  p_session_id uuid,p_college_id uuid,p_version_id uuid,p_instructor_id uuid,
  p_section_id uuid,p_course_offering_id uuid,p_teaching_assignment_id uuid,
  p_study_system text,p_expected_students integer,p_day_of_week integer,
  p_start_time time,p_end_time time,p_room_id uuid
) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
SELECT public._ss_pack(
  public._ss_gather(
    p_session_id,p_college_id,p_version_id,p_instructor_id,p_section_id,
    p_course_offering_id,p_teaching_assignment_id,p_study_system,p_expected_students,
    p_day_of_week,p_start_time,p_end_time,p_room_id
  ),
  p_version_id
);
$$;
REVOKE ALL ON FUNCTION public._collect_schedule_session_move_conflicts(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,integer,integer,time,time,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._collect_schedule_session_move_conflicts(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,integer,integer,time,time,uuid) TO service_role;