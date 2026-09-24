CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
GRANT USAGE ON SCHEMA auth TO authenticated,anon;
CREATE TYPE app_role AS ENUM('super_admin','college_admin','university_leadership','institutional_viewer','read_only');
CREATE TABLE academic_cohorts("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),"college_id" uuid,"program_id" uuid,"level_id" uuid,"study_system" text,"entry_year" integer,"term_id" uuid,"expected_students" integer,"count_status" text,"code" text,"active" boolean DEFAULT true,"created_at" timestamp with time zone DEFAULT now(),"updated_at" timestamp with time zone DEFAULT now(),"study_plan_id" uuid,"existing_schedule" boolean);
CREATE TABLE academic_programs("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),"college_id" uuid,"department_id" uuid,"name" text,"code" text,"degree_type" text,"duration_years" integer,"created_at" timestamp with time zone DEFAULT now(),"updated_at" timestamp with time zone DEFAULT now(),"is_archived" boolean,"canonical_program_id" uuid,"archive_reason" text,"archived_at" timestamp with time zone);
CREATE TABLE academic_terms("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),"college_id" uuid,"name" text,"code" text,"start_date" date,"end_date" date,"is_active" boolean DEFAULT true,"created_at" timestamp with time zone DEFAULT now(),"updated_at" timestamp with time zone DEFAULT now(),"academic_year" text,"term_type" text,"teaching_weeks_count" integer);
CREATE TABLE audit_logs("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),"actor_id" uuid,"action" text,"entity" text,"entity_id" uuid,"college_id" uuid,"details" jsonb,"created_at" timestamp with time zone DEFAULT now());
CREATE TABLE colleges("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),"university_id" uuid,"name" text,"code" text,"created_at" timestamp with time zone DEFAULT now(),"updated_at" timestamp with time zone DEFAULT now());
CREATE TABLE course_offerings("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),"college_id" uuid,"term_id" uuid,"course_id" uuid,"program_id" uuid,"level_id" uuid,"expected_students" integer,"sections_count" integer,"notes" text,"is_active" boolean DEFAULT true,"created_at" timestamp with time zone DEFAULT now(),"updated_at" timestamp with time zone DEFAULT now(),"study_plan_id" uuid,"plan_course_id" uuid,"status" text,"study_system" text,"enrollment_count_status" text,"enrollment_count_updated_at" timestamp with time zone,"existing_schedule" boolean);
CREATE TABLE courses("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),"college_id" uuid,"department_id" uuid,"code" text,"name" text,"credit_hours" numeric(4,2),"theory_hours" integer,"practical_hours" integer,"created_at" timestamp with time zone DEFAULT now(),"updated_at" timestamp with time zone DEFAULT now(),"course_nature" text,"is_shared" boolean);
CREATE TABLE delivery_groups("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),"college_id" uuid,"cohort_id" uuid,"plan_course_id" uuid,"component_id" uuid,"group_code" text,"expected_students" integer,"capacity_limit" integer,"active" boolean DEFAULT true,"created_at" timestamp with time zone DEFAULT now(),"updated_at" timestamp with time zone DEFAULT now(),"group_number" integer,"excluded_from_standard_workload" boolean DEFAULT false,"is_obsolete" boolean DEFAULT false);
CREATE TABLE departments("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),"college_id" uuid,"name" text,"code" text,"created_at" timestamp with time zone DEFAULT now(),"updated_at" timestamp with time zone DEFAULT now(),"study_system" text,"is_archived" boolean,"canonical_department_id" uuid,"archive_reason" text,"archived_at" timestamp with time zone);
CREATE TABLE existing_schedule_source_rows("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),"college_id" uuid,"term_id" uuid,"schedule_version_id" uuid,"source_id" text,"source_file" text,"source_cell" text,"study_plan_id" uuid,"level_number" integer,"raw_course" text,"raw_teacher" text,"raw_day" text,"raw_time" text,"raw_room" text,"day_of_week" smallint,"start_time" time without time zone,"end_time" time without time zone,"plan_course_id" uuid,"component_id" uuid,"instructor_ids" uuid[],"room_id" uuid,"shared_key" text,"cohort_id" uuid,"delivery_group_id" uuid,"teaching_assignment_id" uuid,"schedule_session_id" uuid,"shared_member" boolean,"status" text,"pending_reasons" text[],"notes" text,"created_at" timestamp with time zone DEFAULT now(),"updated_at" timestamp with time zone DEFAULT now());
CREATE TABLE faculty_identities("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),"university_id" uuid,"issuing_college_id" uuid,"university_number" text,"serial" bigint,"created_at" timestamp with time zone DEFAULT now());
CREATE TABLE faculty_identity_links("instructor_id" uuid,"identity_id" uuid,"linked_at" timestamp with time zone);
CREATE TABLE faculty_workload_policies("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),"college_id" uuid,"rank_code" text,"rank_aliases" text[],"required_load_hours" numeric(5,2),"active" boolean DEFAULT true,"created_at" timestamp with time zone DEFAULT now(),"updated_at" timestamp with time zone DEFAULT now());
CREATE TABLE instructor_types("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),"college_id" uuid,"code" text,"name_ar" text,"name_en" text,"is_external" boolean,"description" text,"color" text,"display_order" integer,"is_active" boolean DEFAULT true,"created_at" timestamp with time zone DEFAULT now(),"updated_at" timestamp with time zone DEFAULT now());
CREATE TABLE instructors("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),"college_id" uuid,"department_id" uuid,"full_name" text,"academic_rank" text,"email" text,"phone" text,"employment_type" text,"max_weekly_hours" integer,"is_active" boolean DEFAULT true,"created_at" timestamp with time zone DEFAULT now(),"updated_at" timestamp with time zone DEFAULT now(),"instructor_type_id" uuid,"external_source" text,"academic_degree" text,"admin_tasks" text,"max_hours_per_day" integer,"employee_number" text,"full_name_ar" text,"full_name_en" text,"specialization" text,"administrative_release_hours" integer,"notes" text,"affiliation_college_id" uuid,"affiliation_department_id" uuid,"administrative_position" text,"administrative_department_id" uuid,"administrative_support_department_id" uuid,"target_attendance_days_per_week" smallint,"max_attendance_days_per_week" smallint);
CREATE TABLE plan_course_components("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),"college_id" uuid,"plan_course_id" uuid,"component_type" text,"weekly_contact_hours" numeric(5,2),"required_room_type_id" uuid,"is_timetabled" boolean,"counts_toward_regular_load" boolean DEFAULT true,"counts_toward_overtime" boolean,"compensation_mode" text,"created_at" timestamp with time zone DEFAULT now(),"updated_at" timestamp with time zone DEFAULT now(),"explicit_group_size" integer);
CREATE TABLE room_types("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),"college_id" uuid,"code" text,"name_ar" text,"name_en" text,"default_capacity" integer,"features" jsonb,"color" text,"display_order" integer,"is_active" boolean DEFAULT true,"created_at" timestamp with time zone DEFAULT now(),"updated_at" timestamp with time zone DEFAULT now(),"strict_capacity" boolean);
CREATE TABLE rooms("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),"college_id" uuid,"code" text,"name" text,"room_type" text,"capacity" integer,"building" text,"floor" text,"is_active" boolean DEFAULT true,"created_at" timestamp with time zone DEFAULT now(),"updated_at" timestamp with time zone DEFAULT now(),"building_id" uuid,"room_type_id" uuid,"available_days" smallint[],"available_start_time" time without time zone,"available_end_time" time without time zone,"notes" text);
CREATE TABLE schedule_sessions("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),"college_id" uuid,"schedule_version_id" uuid,"course_offering_id" uuid,"teaching_assignment_id" uuid,"instructor_id" uuid,"room_id" uuid,"section_id" uuid,"section_group_id" uuid,"study_system" text,"day_of_week" smallint,"start_time" time without time zone,"end_time" time without time zone,"session_type" text,"expected_students" integer,"created_at" timestamp with time zone DEFAULT now(),"updated_at" timestamp with time zone DEFAULT now(),"is_locked" boolean,"lock_reason" text,"source_type" text,"auto_schedule_run_id" uuid,"section_subgroup_id" uuid,"replaced_by_split" boolean DEFAULT false,"split_source_session_id" uuid,"cohort_id" uuid,"plan_course_component_id" uuid,"delivery_group_id" uuid);
CREATE TABLE schedule_versions("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),"college_id" uuid,"academic_term_id" uuid,"name" text,"status" text,"notes" text,"created_by" uuid,"created_at" timestamp with time zone DEFAULT now(),"updated_at" timestamp with time zone DEFAULT now(),"eligibility_revision" bigint,"disposable_test" boolean DEFAULT false,"is_coordination" boolean DEFAULT false);
CREATE TABLE teaching_assignments("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),"college_id" uuid,"course_offering_id" uuid,"instructor_id" uuid,"section_number" text,"session_type" text,"weekly_hours" numeric,"required_room_type" text,"notes" text,"created_at" timestamp with time zone DEFAULT now(),"updated_at" timestamp with time zone DEFAULT now(),"expected_students" integer,"section_id" uuid,"cohort_id" uuid,"plan_course_component_id" uuid,"delivery_group_id" uuid,"assigned_component_hours" numeric(5,2),"is_active" boolean DEFAULT true);
CREATE TABLE universities("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),"name" text,"code" text,"created_at" timestamp with time zone DEFAULT now(),"updated_at" timestamp with time zone DEFAULT now());

CREATE TABLE user_roles(user_id uuid,role app_role);
CREATE TABLE user_colleges(user_id uuid,college_id uuid);
CREATE FUNCTION has_role(u uuid,r app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$SELECT EXISTS(SELECT 1 FROM user_roles WHERE user_id=u AND role=r)$$;
CREATE FUNCTION is_super_admin(u uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$SELECT has_role(u,'super_admin')$$;
CREATE FUNCTION can_manage_college(u uuid,c uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$SELECT is_super_admin(u) OR (has_role(u,'college_admin') AND EXISTS(SELECT 1 FROM user_colleges WHERE user_id=u AND college_id=c))$$;
CREATE FUNCTION can_view_college(u uuid,c uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$SELECT is_super_admin(u) OR has_role(u,'university_leadership') OR EXISTS(SELECT 1 FROM user_colleges WHERE user_id=u AND college_id=c)$$;
CREATE VIEW operational_delivery_groups AS SELECT * FROM delivery_groups;
CREATE FUNCTION lock_delivery_group_for_assignment(p uuid) RETURNS delivery_groups LANGUAGE plpgsql AS $$DECLARE g delivery_groups%ROWTYPE;BEGIN SELECT * INTO STRICT g FROM delivery_groups WHERE id=p FOR UPDATE;RETURN g;END$$;
CREATE FUNCTION assert_delivery_group_assignable(o boolean,a boolean) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF o OR NOT a THEN RAISE EXCEPTION 'GROUP_INACTIVE';END IF;END$$;
CREATE FUNCTION resolve_offering_for_delivery_group(p uuid) RETURNS uuid LANGUAGE sql AS $$SELECT o.id FROM delivery_groups g JOIN academic_cohorts c ON c.id=g.cohort_id JOIN course_offerings o ON o.term_id=c.term_id AND o.college_id=g.college_id WHERE g.id=p LIMIT 1$$;
CREATE FUNCTION compute_delivery_group_allocation(p uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;
CREATE VIEW v_instructor_delivery_workload AS SELECT a.instructor_id,o.term_id,a.college_id,
 sum(CASE WHEN g.excluded_from_standard_workload OR NOT p.counts_toward_regular_load THEN 0 ELSE coalesce(a.assigned_component_hours,p.weekly_contact_hours) END) AS standard_assigned_hours,
 sum(CASE WHEN p.component_type='project' AND NOT p.counts_toward_regular_load THEN a.assigned_component_hours ELSE 0 END) AS project_supervision_hours
 FROM teaching_assignments a JOIN course_offerings o ON o.id=a.course_offering_id JOIN delivery_groups g ON g.id=a.delivery_group_id JOIN plan_course_components p ON p.id=g.component_id
 WHERE a.is_active AND g.active AND NOT g.is_obsolete GROUP BY a.instructor_id,o.term_id,a.college_id;
CREATE FUNCTION list_teaching_assignment_workspace(p_college_id uuid,p_term_id uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('ok',true,'rows',coalesce(jsonb_agg(x),'[]')) FROM (
 SELECT g.id AS delivery_group_id,g.college_id,p.component_type,p.weekly_contact_hours AS component_hours,
 coalesce((SELECT sum(a.assigned_component_hours) FROM teaching_assignments a WHERE a.delivery_group_id=g.id AND a.is_active),0) AS assigned_hours_total,
 greatest(0,p.weekly_contact_hours-coalesce((SELECT sum(a.assigned_component_hours) FROM teaching_assignments a WHERE a.delivery_group_id=g.id AND a.is_active),0)) AS remaining_hours,
 g.active,g.is_obsolete,g.excluded_from_standard_workload,g.component_id AS plan_course_component_id,
 coalesce((SELECT jsonb_agg(jsonb_build_object('instructor_id',a.instructor_id,'is_active',a.is_active,'assigned_component_hours',a.assigned_component_hours)) FROM teaching_assignments a WHERE a.delivery_group_id=g.id AND a.is_active),'[]') AS instructors
 FROM delivery_groups g JOIN academic_cohorts c ON c.id=g.cohort_id JOIN plan_course_components p ON p.id=g.component_id WHERE g.college_id=p_college_id AND c.term_id=p_term_id) x
$$;
CREATE SCHEMA schedule_coordination_private;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO authenticated;

CREATE OR REPLACE FUNCTION public.validate_assignment_allocation_locked(p_delivery_group_id uuid, p_exclude_assignment_id uuid, p_new_hours numeric, p_component_hours numeric, p_include_new_row boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_co_count integer;
  v_null_split_count integer;
  v_sum_assigned numeric;
BEGIN
  SELECT COUNT(*)::integer,
         COUNT(*) FILTER (
           WHERE ta.assigned_component_hours IS NULL
             AND (p_exclude_assignment_id IS NULL OR ta.id IS DISTINCT FROM p_exclude_assignment_id)
         )::integer
           + CASE WHEN p_include_new_row AND p_new_hours IS NULL THEN 1 ELSE 0 END,
         COALESCE(
           SUM(ta.assigned_component_hours) FILTER (
             WHERE p_exclude_assignment_id IS NULL OR ta.id IS DISTINCT FROM p_exclude_assignment_id
           ),
           0
         )
           + CASE WHEN p_include_new_row THEN COALESCE(p_new_hours, 0) ELSE 0 END
    INTO v_co_count, v_null_split_count, v_sum_assigned
  FROM public.teaching_assignments ta
  WHERE ta.delivery_group_id = p_delivery_group_id
    AND ta.is_active = TRUE;

  IF p_include_new_row
     AND (
       p_exclude_assignment_id IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM public.teaching_assignments ta2
         WHERE ta2.id = p_exclude_assignment_id
           AND ta2.delivery_group_id = p_delivery_group_id
           AND ta2.is_active = TRUE
       )
     ) THEN
    v_co_count := v_co_count + 1;
  END IF;

  IF v_co_count > 1 AND v_null_split_count > 0 THEN
    RAISE EXCEPTION 'CO_TEACHING_HOURS_SPLIT_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;
  IF p_component_hours IS NOT NULL AND v_sum_assigned > p_component_hours THEN
    RAISE EXCEPTION 'CO_TEACHING_HOURS_OVER_ALLOCATED' USING ERRCODE = 'check_violation';
  END IF;
END;
$function$;
CREATE FUNCTION existing_schedule_intake_enabled(c uuid,t uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;

CREATE TABLE shared_lecture_links(anchor_group_id uuid,member_group_id uuid,college_id uuid);
CREATE SEQUENCE faculty_number_seq START 999;
CREATE TABLE faculty_number_history(university_number text PRIMARY KEY,identity_id uuid,replaced_by uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON shared_lecture_links,faculty_number_history TO authenticated;
