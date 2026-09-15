INSERT INTO colleges(id,name,code) VALUES(md5('college')::uuid,'TEST_ONLY','TEST_ONLY');
INSERT INTO academic_terms(id,college_id,term_type) VALUES(md5('term')::uuid,md5('college')::uuid,'first');
INSERT INTO academic_programs(id,college_id,name,code) VALUES(md5('program')::uuid,md5('college')::uuid,'TEST_ONLY','TEST_ONLY');
INSERT INTO academic_levels(id,college_id,program_id,level_number,name) VALUES(md5('level')::uuid,md5('college')::uuid,md5('program')::uuid,2,'TEST_ONLY');
INSERT INTO academic_cohorts(id,college_id,program_id,level_id,term_id,study_system,expected_students,active,code)
 VALUES(md5('regular')::uuid,md5('college')::uuid,md5('program')::uuid,md5('level')::uuid,md5('term')::uuid,'regular',50,true,'TEST_ONLY_REGULAR'),
 (md5('parallel')::uuid,md5('college')::uuid,md5('program')::uuid,md5('level')::uuid,md5('term')::uuid,'parallel',25,true,'TEST_ONLY_PARALLEL');
INSERT INTO study_plans(id,college_id,program_id,code,is_active) VALUES(md5('plan')::uuid,md5('college')::uuid,md5('program')::uuid,'TEST_ONLY',true);
INSERT INTO courses(id,college_id,name,code) VALUES(md5('course')::uuid,md5('college')::uuid,'TEST_ONLY','TEST_ONLY');
INSERT INTO plan_courses(id,college_id,study_plan_id,level_id,semester,course_id,is_required)
 VALUES(md5('pc')::uuid,md5('college')::uuid,md5('plan')::uuid,md5('level')::uuid,1,md5('course')::uuid,true);
INSERT INTO room_types(id,college_id,code,default_capacity,strict_capacity,is_active)
 VALUES(md5('lecture')::uuid,md5('college')::uuid,'lecture',75,false,true),
 (md5('lab')::uuid,md5('college')::uuid,'lab',39,true,true);
INSERT INTO rooms(id,college_id,room_type_id,room_type,capacity,is_active,code)
 VALUES(md5('room')::uuid,md5('college')::uuid,md5('lecture')::uuid,'lecture',75,true,'TEST_ONLY'),
 (md5('labroom')::uuid,md5('college')::uuid,md5('lab')::uuid,'computer_lab',39,true,'TEST_ONLY_LAB');
INSERT INTO plan_course_components(id,college_id,plan_course_id,component_type,weekly_contact_hours,required_room_type_id,is_timetabled,counts_toward_regular_load)
 VALUES(md5('theory')::uuid,md5('college')::uuid,md5('pc')::uuid,'theory',2,md5('lecture')::uuid,true,true),
 (md5('practical')::uuid,md5('college')::uuid,md5('pc')::uuid,'practical',2,md5('lab')::uuid,true,true);
INSERT INTO scheduling_cohort_term_headcounts(id,college_id,cohort_id,term_id,approval_status,scheduling_headcount)
 SELECT id,college_id,id,term_id,'approved',expected_students FROM academic_cohorts;
SELECT set_config('request.jwt.claim.sub',md5('manager'),false);
SELECT public.generate_cohort_delivery_groups(md5('regular')::uuid);
SELECT public.generate_cohort_delivery_groups(md5('parallel')::uuid);
INSERT INTO instructors(id,college_id,full_name,is_active) VALUES(md5('teacher')::uuid,md5('college')::uuid,'TEST_ONLY',true),
 (md5('labteacher')::uuid,md5('college')::uuid,'TEST_ONLY_LAB',true);
INSERT INTO schedule_versions(id,college_id,academic_term_id,status,name,updated_at,eligibility_revision)
 VALUES(md5('version')::uuid,md5('college')::uuid,md5('term')::uuid,'draft','TEST_ONLY',now(),0);
INSERT INTO scheduling_settings(college_id,working_days,day_start_time,day_end_time,standard_day_end_time)
 VALUES(md5('college')::uuid,ARRAY[0,1,2,3,4,6],'08:00','16:00','14:00');
INSERT INTO time_slot_templates(id,college_id,study_system,day_of_week,start_time,end_time,is_active)
 VALUES(md5('slot')::uuid,md5('college')::uuid,'regular',0,'08:00','10:00',true),
 (md5('slotp')::uuid,md5('college')::uuid,'parallel',0,'08:00','10:00',true);
CREATE TRIGGER ensure_ta_college BEFORE INSERT OR UPDATE ON public.teaching_assignments FOR EACH ROW EXECUTE FUNCTION public.ensure_ta_college();
CREATE TRIGGER ensure_ss_college BEFORE INSERT OR UPDATE ON public.schedule_sessions FOR EACH ROW EXECUTE FUNCTION public.ensure_ss_college();
