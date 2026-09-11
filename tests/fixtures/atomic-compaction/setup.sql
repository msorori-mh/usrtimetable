\set ON_ERROR_STOP on
\ir baseline.sql
CREATE SCHEMA test_support;
CREATE FUNCTION test_support.id(label text) RETURNS uuid LANGUAGE sql IMMUTABLE
AS $$ SELECT md5('TEST_ONLY_ATOMIC_COMPACTION:' || label)::uuid $$;
CREATE FUNCTION test_support.assert(condition boolean, message text) RETURNS void LANGUAGE plpgsql
AS $$ BEGIN IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION '%', message; END IF; END $$;

INSERT INTO auth.users(id) SELECT test_support.id(x) FROM unnest(ARRAY['manager','reader','foreign-manager']) x;
INSERT INTO user_roles(user_id,role) VALUES
  (test_support.id('manager'),'college_admin'),(test_support.id('reader'),'read_only'),
  (test_support.id('foreign-manager'),'college_admin');
INSERT INTO universities(id,name) VALUES(test_support.id('university'),'TEST_ONLY');
DO $seed$
DECLARE p text;
BEGIN
  FOREACH p IN ARRAY ARRAY['one','two'] LOOP
    INSERT INTO colleges(id,university_id,name) VALUES(test_support.id(p),test_support.id('university'),'TEST_ONLY_'||p);
    INSERT INTO departments(id,college_id,name,code) VALUES(test_support.id(p||'-dept'),test_support.id(p),'TEST_ONLY','TEST_ONLY');
    INSERT INTO academic_programs(id,college_id,department_id,name,code)
      VALUES(test_support.id(p||'-program'),test_support.id(p),test_support.id(p||'-dept'),'TEST_ONLY','TEST_ONLY');
    INSERT INTO academic_levels(id,college_id,program_id,name,level_number)
      VALUES(test_support.id(p||'-level'),test_support.id(p),test_support.id(p||'-program'),'TEST_ONLY',1);
    INSERT INTO academic_terms(id,college_id,name,code)
      VALUES(test_support.id(p||'-term'),test_support.id(p),'TEST_ONLY','TEST_ONLY');
    INSERT INTO academic_cohorts(id,college_id,program_id,level_id,study_system,entry_year,term_id,expected_students)
      VALUES(test_support.id(p||'-cohort'),test_support.id(p),test_support.id(p||'-program'),test_support.id(p||'-level'),
        'regular',2026,test_support.id(p||'-term'),30);
    INSERT INTO courses(id,college_id,department_id,code,name)
      VALUES(test_support.id(p||'-course'),test_support.id(p),test_support.id(p||'-dept'),'TEST_ONLY','TEST_ONLY');
    INSERT INTO study_plans(id,college_id,program_id,name,code)
      VALUES(test_support.id(p||'-plan'),test_support.id(p),test_support.id(p||'-program'),'TEST_ONLY','TEST_ONLY');
    INSERT INTO plan_courses(id,college_id,study_plan_id,course_id,level_id)
      VALUES(test_support.id(p||'-pc'),test_support.id(p),test_support.id(p||'-plan'),test_support.id(p||'-course'),test_support.id(p||'-level'));
    INSERT INTO plan_course_components(id,college_id,plan_course_id,component_type,weekly_contact_hours)
      VALUES(test_support.id(p||'-component'),test_support.id(p),test_support.id(p||'-pc'),'theory',4);
    INSERT INTO delivery_groups(id,college_id,cohort_id,plan_course_id,component_id,group_code,expected_students)
      VALUES(test_support.id(p||'-group'),test_support.id(p),test_support.id(p||'-cohort'),test_support.id(p||'-pc'),test_support.id(p||'-component'),'TEST_ONLY',30);
    INSERT INTO instructors(id,college_id,full_name)
      VALUES(test_support.id(p||'-teacher'),test_support.id(p),'TEST_ONLY');
    INSERT INTO rooms(id,college_id,code,name,capacity,room_type)
      VALUES(test_support.id(p||'-room'),test_support.id(p),'TEST_ONLY','TEST_ONLY',60,'lecture_hall');
    INSERT INTO course_offerings(id,college_id,term_id,course_id,program_id,level_id,plan_course_id,expected_students)
      VALUES(test_support.id(p||'-offering'),test_support.id(p),test_support.id(p||'-term'),test_support.id(p||'-course'),
        test_support.id(p||'-program'),test_support.id(p||'-level'),test_support.id(p||'-pc'),30);
    INSERT INTO teaching_assignments(id,college_id,course_offering_id,instructor_id,cohort_id,plan_course_component_id,
      delivery_group_id,assigned_component_hours,required_room_type,weekly_hours,expected_students)
      VALUES(test_support.id(p||'-assignment'),test_support.id(p),test_support.id(p||'-offering'),test_support.id(p||'-teacher'),
        test_support.id(p||'-cohort'),test_support.id(p||'-component'),test_support.id(p||'-group'),4,'lecture_hall',4,30);
    INSERT INTO schedule_versions(id,college_id,academic_term_id,name)
      VALUES(test_support.id(p||'-version'),test_support.id(p),test_support.id(p||'-term'),'TEST_ONLY');
    INSERT INTO schedule_sessions(id,college_id,schedule_version_id,course_offering_id,instructor_id,room_id,
      teaching_assignment_id,cohort_id,plan_course_component_id,delivery_group_id,day_of_week,start_time,end_time,expected_students)
      SELECT test_support.id(p||'-'||n),test_support.id(p),test_support.id(p||'-version'),test_support.id(p||'-offering'),
        test_support.id(p||'-teacher'),test_support.id(p||'-room'),test_support.id(p||'-assignment'),test_support.id(p||'-cohort'),
        test_support.id(p||'-component'),test_support.id(p||'-group'),0,st,st+interval '2 hours',30
      FROM (VALUES('a','08:00'::time),('b','12:00'::time)) x(n,st);
    INSERT INTO scheduling_settings(college_id,working_days,day_start_time,day_end_time,break_between_sessions_min)
      VALUES(test_support.id(p),ARRAY[0,1,2,3,4,6]::smallint[],'08:00','18:00',0);
    INSERT INTO time_slot_templates(college_id,day_of_week,start_time,end_time,study_system)
      SELECT test_support.id(p),d,'08:00','18:00','regular' FROM unnest(ARRAY[0,1,2,3,4,6]) d;
  END LOOP;
END;
$seed$;
INSERT INTO user_colleges(user_id,college_id) VALUES
  (test_support.id('manager'),test_support.id('one')),(test_support.id('reader'),test_support.id('one')),
  (test_support.id('foreign-manager'),test_support.id('two'));

-- Install the observed production triggers before testing any mutation.
\ir baseline-triggers.sql
\ir ../../../supabase/migrations/20260911130524_atomic_schedule_compaction.sql

CREATE FUNCTION test_support.move(label text, target_start time, target_day integer DEFAULT 0)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('id',id,'expected_updated_at',updated_at,'day_of_week',target_day,
    'start_time',target_start,'end_time',target_start+interval '2 hours','room_id',room_id)
  FROM public.schedule_sessions WHERE id=test_support.id(label)
$$;
CREATE FUNCTION test_support.apply(moves jsonb, operation text DEFAULT 'op', college text DEFAULT 'one', version text DEFAULT 'one-version')
RETURNS jsonb LANGUAGE sql VOLATILE AS $$
  SELECT public.apply_schedule_compaction(test_support.id(college),test_support.id(version),test_support.id(operation),
    eligibility_revision,updated_at,moves) FROM public.schedule_versions WHERE id=test_support.id(version)
$$;
CREATE FUNCTION test_support.state() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'sessions',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.schedule_sessions s),
    'versions',(SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM public.schedule_versions v),
    'audits',(SELECT count(*) FROM public.audit_logs),
    'receipts',(SELECT count(*) FROM public.schedule_compaction_receipts))
$$;
GRANT USAGE ON SCHEMA test_support TO authenticated,anon;
GRANT SELECT ON public.schedule_sessions,public.schedule_versions TO authenticated;
SELECT 'TEST_ONLY atomic compaction database ready';
