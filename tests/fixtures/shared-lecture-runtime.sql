-- Production column types; unrelated NOT NULL requirements omitted in this isolated fixture.
CREATE TYPE public.app_role AS ENUM ('super_admin','college_admin','read_only','institutional_viewer');
CREATE TABLE public.academic_buildings (id uuid DEFAULT gen_random_uuid(), college_id uuid, code text, name text, address text, floors_count integer, notes text, is_active boolean DEFAULT true, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now());
ALTER TABLE public.academic_buildings ADD PRIMARY KEY(id);
CREATE TABLE public.academic_calendar (id uuid DEFAULT gen_random_uuid(), college_id uuid, term_id uuid, title text, event_kind text, start_date date, end_date date, start_time time without time zone, end_time time without time zone, all_day boolean DEFAULT true, affects_scheduling boolean DEFAULT true, color text, notes text, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now());
ALTER TABLE public.academic_calendar ADD PRIMARY KEY(id);
CREATE TABLE public.academic_cohorts (id uuid DEFAULT gen_random_uuid(), college_id uuid, program_id uuid, level_id uuid, study_system text, entry_year integer, term_id uuid, expected_students integer DEFAULT 0, count_status text, code text, active boolean DEFAULT true, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now(), study_plan_id uuid);
ALTER TABLE public.academic_cohorts ADD PRIMARY KEY(id);
CREATE TABLE public.academic_levels (id uuid DEFAULT gen_random_uuid(), college_id uuid, program_id uuid, name text, level_number integer, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now());
ALTER TABLE public.academic_levels ADD PRIMARY KEY(id);
CREATE TABLE public.academic_programs (id uuid DEFAULT gen_random_uuid(), college_id uuid, department_id uuid, name text, code text, degree_type text, duration_years integer, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now());
ALTER TABLE public.academic_programs ADD PRIMARY KEY(id);
CREATE TABLE public.academic_terms (id uuid DEFAULT gen_random_uuid(), college_id uuid, name text, code text, start_date date, end_date date, is_active boolean DEFAULT false, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now(), academic_year text, term_type text, teaching_weeks_count integer);
ALTER TABLE public.academic_terms ADD PRIMARY KEY(id);
CREATE TABLE public.audit_logs (id uuid DEFAULT gen_random_uuid(), actor_id uuid, action text, entity text, entity_id uuid, college_id uuid, details jsonb, created_at timestamp with time zone DEFAULT now());
ALTER TABLE public.audit_logs ADD PRIMARY KEY(id);
CREATE TABLE public.auto_schedule_runs (id uuid DEFAULT gen_random_uuid(), college_id uuid, schedule_version_id uuid, algorithm text, status text, total_offerings integer DEFAULT 0, placed_sessions integer DEFAULT 0, unplaced_sessions integer DEFAULT 0, hard_conflicts_after integer DEFAULT 0, soft_violations_after integer DEFAULT 0, quality_score_after integer, duration_ms integer, summary jsonb, unplaced jsonb, run_by uuid, created_at timestamp with time zone DEFAULT now());
ALTER TABLE public.auto_schedule_runs ADD PRIMARY KEY(id);
CREATE TABLE public.cohort_elective_selections (id uuid DEFAULT gen_random_uuid(), college_id uuid, cohort_id uuid, elective_slot_id uuid, selected_course_id uuid, decided_at timestamp with time zone, decided_by uuid, notes text, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now());
ALTER TABLE public.cohort_elective_selections ADD PRIMARY KEY(id);
CREATE TABLE public.cohort_student_partitions (id uuid DEFAULT gen_random_uuid(), college_id uuid, cohort_id uuid, partition_code text, headcount integer, active boolean DEFAULT true, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now());
ALTER TABLE public.cohort_student_partitions ADD PRIMARY KEY(id);
CREATE TABLE public.college_constraint_settings (id uuid DEFAULT gen_random_uuid(), college_id uuid, constraint_type_id uuid, enabled boolean DEFAULT true, weight integer DEFAULT 1, notes text, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now());
ALTER TABLE public.college_constraint_settings ADD PRIMARY KEY(id);
CREATE TABLE public.college_quality_settings (id uuid DEFAULT gen_random_uuid(), college_id uuid, quality_metric_id uuid, enabled boolean DEFAULT true, weight integer, notes text, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now());
ALTER TABLE public.college_quality_settings ADD PRIMARY KEY(id);
CREATE TABLE public.colleges (id uuid DEFAULT gen_random_uuid(), university_id uuid, name text, code text, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now());
ALTER TABLE public.colleges ADD PRIMARY KEY(id);
CREATE TABLE public.conflict_checks (id uuid DEFAULT gen_random_uuid(), college_id uuid, schedule_version_id uuid, check_type text, status text, total_conflicts integer DEFAULT 0, checked_by uuid, created_at timestamp with time zone DEFAULT now(), completed_at timestamp with time zone);
ALTER TABLE public.conflict_checks ADD PRIMARY KEY(id);
CREATE TABLE public.conflict_results (id uuid DEFAULT gen_random_uuid(), college_id uuid, conflict_check_id uuid, schedule_session_id uuid, related_session_id uuid, conflict_type_id uuid, conflict_code text, severity text, message_ar text, message_en text, metadata jsonb, created_at timestamp with time zone DEFAULT now(), score_impact integer DEFAULT 0);
ALTER TABLE public.conflict_results ADD PRIMARY KEY(id);
CREATE TABLE public.constraint_types (id uuid DEFAULT gen_random_uuid(), code text, name_ar text, name_en text, constraint_category text, default_weight integer DEFAULT 1, is_hard boolean DEFAULT false, is_active boolean DEFAULT true, description text, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now());
ALTER TABLE public.constraint_types ADD PRIMARY KEY(id);
CREATE TABLE public.course_departments (id uuid DEFAULT gen_random_uuid(), college_id uuid, course_id uuid, department_id uuid, created_at timestamp with time zone DEFAULT now());
ALTER TABLE public.course_departments ADD PRIMARY KEY(id);
CREATE TABLE public.course_offering_sections (id uuid DEFAULT gen_random_uuid(), college_id uuid, course_offering_id uuid, section_id uuid, expected_students integer DEFAULT 0, section_number text, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now());
ALTER TABLE public.course_offering_sections ADD PRIMARY KEY(id);
CREATE TABLE public.course_offerings (id uuid DEFAULT gen_random_uuid(), college_id uuid, term_id uuid, course_id uuid, program_id uuid, level_id uuid, expected_students integer DEFAULT 0, sections_count integer DEFAULT 1, notes text, is_active boolean DEFAULT true, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now(), study_plan_id uuid, plan_course_id uuid, status text, study_system text, enrollment_count_status text, enrollment_count_updated_at timestamp with time zone);
ALTER TABLE public.course_offerings ADD PRIMARY KEY(id);
CREATE TABLE public.course_programs (id uuid DEFAULT gen_random_uuid(), college_id uuid, course_id uuid, program_id uuid, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now());
ALTER TABLE public.course_programs ADD PRIMARY KEY(id);
CREATE TABLE public.courses (id uuid DEFAULT gen_random_uuid(), college_id uuid, department_id uuid, code text, name text, credit_hours numeric(4,2), theory_hours integer DEFAULT 0, practical_hours integer DEFAULT 0, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now(), course_nature text, is_shared boolean DEFAULT false);
ALTER TABLE public.courses ADD PRIMARY KEY(id);
CREATE TABLE public.daily_breaks (id uuid DEFAULT gen_random_uuid(), college_id uuid, name text, days integer[], start_time time without time zone, end_time time without time zone, affects_scheduling boolean DEFAULT true, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now());
ALTER TABLE public.daily_breaks ADD PRIMARY KEY(id);
CREATE TABLE public.delivery_group_partition_members (id uuid DEFAULT gen_random_uuid(), college_id uuid, cohort_id uuid, delivery_group_id uuid, partition_id uuid, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now());
ALTER TABLE public.delivery_group_partition_members ADD PRIMARY KEY(id);
CREATE TABLE public.delivery_groups (id uuid DEFAULT gen_random_uuid(), college_id uuid, cohort_id uuid, plan_course_id uuid, component_id uuid, group_code text, expected_students integer DEFAULT 0, capacity_limit integer, active boolean DEFAULT true, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now(), group_number integer, excluded_from_standard_workload boolean DEFAULT false, is_obsolete boolean DEFAULT false);
ALTER TABLE public.delivery_groups ADD PRIMARY KEY(id);
CREATE TABLE public.departments (id uuid DEFAULT gen_random_uuid(), college_id uuid, name text, code text, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now(), study_system text);
ALTER TABLE public.departments ADD PRIMARY KEY(id);
CREATE TABLE public.elective_slot_courses (id uuid DEFAULT gen_random_uuid(), college_id uuid, elective_slot_id uuid, course_id uuid, active boolean DEFAULT true, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now());
ALTER TABLE public.elective_slot_courses ADD PRIMARY KEY(id);
CREATE TABLE public.elective_slots (id uuid DEFAULT gen_random_uuid(), college_id uuid, study_plan_id uuid, level_id uuid, semester integer, slot_code text, label text, required_component_type text, active boolean DEFAULT true, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now());
ALTER TABLE public.elective_slots ADD PRIMARY KEY(id);
CREATE TABLE public.faculty_workload_policies (id uuid DEFAULT gen_random_uuid(), college_id uuid, rank_code text, rank_aliases text[], required_load_hours numeric(5,2), active boolean DEFAULT true, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now());
ALTER TABLE public.faculty_workload_policies ADD PRIMARY KEY(id);
CREATE TABLE public.import_errors (id uuid DEFAULT gen_random_uuid(), college_id uuid, job_id uuid, row_number integer, column_name text, error_code text, message text, raw_value text, created_at timestamp with time zone DEFAULT now());
ALTER TABLE public.import_errors ADD PRIMARY KEY(id);
CREATE TABLE public.import_jobs (id uuid DEFAULT gen_random_uuid(), college_id uuid, target_entity text, mode text, status text, file_name text, total_rows integer DEFAULT 0, valid_rows integer DEFAULT 0, invalid_rows integer DEFAULT 0, inserted_rows integer DEFAULT 0, updated_rows integer DEFAULT 0, skipped_rows integer DEFAULT 0, notes text, created_by uuid, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now(), validated_payload jsonb, payload_manifest text, claimed_at timestamp with time zone, finished_at timestamp with time zone, failure_message text);
ALTER TABLE public.import_jobs ADD PRIMARY KEY(id);
CREATE TABLE public.import_template_columns (id uuid DEFAULT gen_random_uuid(), college_id uuid, template_id uuid, column_order integer DEFAULT 0, header_ar text, field_key text, data_type text, is_required boolean DEFAULT false, enum_values jsonb, example text, notes text, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now());
ALTER TABLE public.import_template_columns ADD PRIMARY KEY(id);
CREATE TABLE public.import_templates (id uuid DEFAULT gen_random_uuid(), college_id uuid, template_key text, name_ar text, description text, version integer DEFAULT 1, target_entity text, sheet_name text, sample_file_url text, is_active boolean DEFAULT true, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now());
ALTER TABLE public.import_templates ADD PRIMARY KEY(id);
CREATE TABLE public.instructor_availability (id uuid DEFAULT gen_random_uuid(), college_id uuid, instructor_id uuid, day_of_week smallint, start_time time without time zone, end_time time without time zone, availability_type text, notes text, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now(), is_preference boolean DEFAULT false);
ALTER TABLE public.instructor_availability ADD PRIMARY KEY(id);
CREATE TABLE public.instructor_types (id uuid DEFAULT gen_random_uuid(), college_id uuid, code text, name_ar text, name_en text, is_external boolean DEFAULT false, description text, color text, display_order integer DEFAULT 0, is_active boolean DEFAULT true, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now());
ALTER TABLE public.instructor_types ADD PRIMARY KEY(id);
CREATE TABLE public.instructors (id uuid DEFAULT gen_random_uuid(), college_id uuid, department_id uuid, full_name text, academic_rank text, email text, phone text, employment_type text, max_weekly_hours integer, is_active boolean DEFAULT true, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now(), instructor_type_id uuid, external_source text, academic_degree text, admin_tasks text, max_hours_per_day integer, employee_number text, full_name_ar text, full_name_en text, specialization text, administrative_release_hours integer DEFAULT 0, notes text, affiliation_college_id uuid, affiliation_department_id uuid, administrative_position text, administrative_department_id uuid, administrative_support_department_id uuid);
ALTER TABLE public.instructors ADD PRIMARY KEY(id);
CREATE TABLE public.plan_course_components (id uuid DEFAULT gen_random_uuid(), college_id uuid, plan_course_id uuid, component_type text, weekly_contact_hours numeric(5,2) DEFAULT 0, required_room_type_id uuid, is_timetabled boolean DEFAULT true, counts_toward_regular_load boolean DEFAULT true, counts_toward_overtime boolean DEFAULT true, compensation_mode text, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now(), explicit_group_size integer);
ALTER TABLE public.plan_course_components ADD PRIMARY KEY(id);
CREATE TABLE public.plan_courses (id uuid DEFAULT gen_random_uuid(), college_id uuid, study_plan_id uuid, course_id uuid, level_id uuid, semester integer DEFAULT 1, is_required boolean DEFAULT true, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now(), lecture_session_duration numeric, lab_session_duration numeric, lectures_per_week integer DEFAULT 0, labs_per_week integer DEFAULT 0, required_room_type_for_lecture text, required_room_type_for_lab text);
ALTER TABLE public.plan_courses ADD PRIMARY KEY(id);
CREATE TABLE public.profiles (id uuid, full_name text, email text, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now());
ALTER TABLE public.profiles ADD PRIMARY KEY(id);
CREATE TABLE public.quality_metrics (id uuid DEFAULT gen_random_uuid(), code text, name_ar text, name_en text, description text, default_weight integer, is_active boolean DEFAULT true, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now());
ALTER TABLE public.quality_metrics ADD PRIMARY KEY(id);
CREATE TABLE public.room_availability (id uuid DEFAULT gen_random_uuid(), college_id uuid, room_id uuid, day_of_week smallint, start_time time without time zone, end_time time without time zone, notes text, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now());
ALTER TABLE public.room_availability ADD PRIMARY KEY(id);
CREATE TABLE public.room_types (id uuid DEFAULT gen_random_uuid(), college_id uuid, code text, name_ar text, name_en text, default_capacity integer, features jsonb, color text, display_order integer DEFAULT 0, is_active boolean DEFAULT true, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now(), strict_capacity boolean DEFAULT false);
ALTER TABLE public.room_types ADD PRIMARY KEY(id);
CREATE TABLE public.room_unavailability (id uuid DEFAULT gen_random_uuid(), college_id uuid, room_id uuid, day_of_week smallint, start_time time without time zone, end_time time without time zone, start_date date, end_date date, reason text, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now());
ALTER TABLE public.room_unavailability ADD PRIMARY KEY(id);
CREATE TABLE public.rooms (id uuid DEFAULT gen_random_uuid(), college_id uuid, code text, name text, room_type text, capacity integer, building text, floor text, is_active boolean DEFAULT true, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now(), building_id uuid, room_type_id uuid, available_days smallint[], available_start_time time without time zone, available_end_time time without time zone, notes text);
ALTER TABLE public.rooms ADD PRIMARY KEY(id);
CREATE TABLE public.schedule_compaction_receipts (operation_id uuid, college_id uuid, schedule_version_id uuid, actor_id uuid, request_hash text, result jsonb, created_at timestamp with time zone DEFAULT now());
CREATE TABLE public.schedule_quality_runs (id uuid DEFAULT gen_random_uuid(), college_id uuid, schedule_version_id uuid, total_score integer, hard_conflicts_count integer DEFAULT 0, soft_conflicts_count integer DEFAULT 0, total_deductions integer DEFAULT 0, metrics_breakdown jsonb, run_by uuid, created_at timestamp with time zone DEFAULT now(), eligibility_revision bigint DEFAULT 0);
ALTER TABLE public.schedule_quality_runs ADD PRIMARY KEY(id);
CREATE TABLE public.schedule_sessions (id uuid DEFAULT gen_random_uuid(), college_id uuid, schedule_version_id uuid, course_offering_id uuid, teaching_assignment_id uuid, instructor_id uuid, room_id uuid, section_id uuid, section_group_id uuid, study_system text, day_of_week smallint, start_time time without time zone, end_time time without time zone, session_type text, expected_students integer DEFAULT 0, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now(), is_locked boolean DEFAULT false, lock_reason text, source_type text, auto_schedule_run_id uuid, section_subgroup_id uuid, replaced_by_split boolean DEFAULT false, split_source_session_id uuid, cohort_id uuid, plan_course_component_id uuid, delivery_group_id uuid);
ALTER TABLE public.schedule_sessions ADD PRIMARY KEY(id);
CREATE TABLE public.schedule_version_conflict_exceptions (id uuid DEFAULT gen_random_uuid(), college_id uuid, schedule_version_id uuid, conflict_code text, session_id uuid, related_session_id uuid, approval_type text, reason text, source text, status text, approved_by uuid, approved_at timestamp with time zone, metadata jsonb, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now());
ALTER TABLE public.schedule_version_conflict_exceptions ADD PRIMARY KEY(id);
CREATE TABLE public.schedule_version_events (id uuid DEFAULT gen_random_uuid(), college_id uuid, schedule_version_id uuid, event_type text, from_status text, to_status text, performed_by uuid, notes text, metadata jsonb, created_at timestamp with time zone DEFAULT now());
ALTER TABLE public.schedule_version_events ADD PRIMARY KEY(id);
CREATE TABLE public.schedule_versions (id uuid DEFAULT gen_random_uuid(), college_id uuid, academic_term_id uuid, name text, status text, notes text, created_by uuid, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now(), eligibility_revision bigint DEFAULT 0, disposable_test boolean DEFAULT false);
ALTER TABLE public.schedule_versions ADD PRIMARY KEY(id);
CREATE TABLE public.scheduling_cohort_term_headcounts (id uuid DEFAULT gen_random_uuid(), college_id uuid, cohort_id uuid, term_id uuid, study_system text, registered_student_count integer, eligible_student_count integer, expected_attendance_count integer, reserve_margin integer DEFAULT 0, scheduling_headcount integer, exam_eligible_count integer, approval_status text, source text, notes text, approved_by uuid, approved_at timestamp with time zone, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now());
ALTER TABLE public.scheduling_cohort_term_headcounts ADD PRIMARY KEY(id);
CREATE TABLE public.scheduling_headcount_overrides (id uuid DEFAULT gen_random_uuid(), college_id uuid, headcount_id uuid, course_offering_id uuid, plan_course_component_id uuid, scheduling_headcount integer, exam_eligible_count integer, reserve_margin integer, approval_status text, source text, notes text, approved_by uuid, approved_at timestamp with time zone, active boolean DEFAULT true, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now());
ALTER TABLE public.scheduling_headcount_overrides ADD PRIMARY KEY(id);
CREATE TABLE public.scheduling_headcount_revisions (id uuid DEFAULT gen_random_uuid(), college_id uuid, headcount_id uuid, override_id uuid, revision_kind text, snapshot jsonb, changed_by uuid, changed_at timestamp with time zone DEFAULT now(), notes text);
ALTER TABLE public.scheduling_headcount_revisions ADD PRIMARY KEY(id);
CREATE TABLE public.scheduling_settings (id uuid DEFAULT gen_random_uuid(), college_id uuid, week_start_day smallint, working_days smallint[], day_start_time time without time zone, day_end_time time without time zone, slot_minutes integer, min_session_hours numeric(3,1) DEFAULT 1, max_session_hours numeric(3,1), allow_3h_sessions boolean DEFAULT true, max_daily_hours_per_instructor integer, max_daily_hours_per_section integer, break_between_sessions_min integer DEFAULT 0, allow_back_to_back boolean DEFAULT true, notes text, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now(), allowed_session_durations integer[], enforce_instructor_availability boolean DEFAULT false, extended_day_policy_enabled boolean DEFAULT false, standard_day_end_time time without time zone, max_extended_days_per_partition integer DEFAULT 1);
ALTER TABLE public.scheduling_settings ADD PRIMARY KEY(id);
CREATE TABLE public.section_group_members (id uuid DEFAULT gen_random_uuid(), college_id uuid, section_group_id uuid, section_id uuid, expected_students integer DEFAULT 0, created_at timestamp with time zone DEFAULT now());
ALTER TABLE public.section_group_members ADD PRIMARY KEY(id);
CREATE TABLE public.section_groups (id uuid DEFAULT gen_random_uuid(), college_id uuid, academic_term_id uuid, course_id uuid, group_name text, expected_students_total integer DEFAULT 0, notes text, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now());
ALTER TABLE public.section_groups ADD PRIMARY KEY(id);
CREATE TABLE public.section_subgroups (id uuid DEFAULT gen_random_uuid(), college_id uuid, section_id uuid, course_id uuid, academic_term_id uuid, teaching_assignment_id uuid, subgroup_code text, ordinal smallint, expected_students integer DEFAULT 0, study_system text, is_active boolean DEFAULT true, source_policy text, owner_approval_ref text, notes text, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now());
ALTER TABLE public.section_subgroups ADD PRIMARY KEY(id);
CREATE TABLE public.sections (id uuid DEFAULT gen_random_uuid(), college_id uuid, course_id uuid, term_id uuid, section_number text, capacity integer, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now(), study_system text);
ALTER TABLE public.sections ADD PRIMARY KEY(id);
CREATE TABLE public.session_types (id uuid DEFAULT gen_random_uuid(), college_id uuid, code text, name_ar text, name_en text, default_duration_hours numeric(3,1), color text, requires_lab boolean DEFAULT false, display_order integer DEFAULT 0, is_active boolean DEFAULT true, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now());
ALTER TABLE public.session_types ADD PRIMARY KEY(id);
CREATE TABLE public.study_plans (id uuid DEFAULT gen_random_uuid(), college_id uuid, program_id uuid, name text, code text, version text, effective_year integer, is_active boolean DEFAULT true, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now());
ALTER TABLE public.study_plans ADD PRIMARY KEY(id);
CREATE TABLE public.support_departments (id uuid DEFAULT gen_random_uuid(), college_id uuid, name text, created_at timestamp with time zone DEFAULT now());
ALTER TABLE public.support_departments ADD PRIMARY KEY(id);
CREATE TABLE public.teaching_assignments (id uuid DEFAULT gen_random_uuid(), college_id uuid, course_offering_id uuid, instructor_id uuid, section_number text, session_type text, weekly_hours numeric, required_room_type text, notes text, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now(), expected_students integer DEFAULT 0, section_id uuid, cohort_id uuid, plan_course_component_id uuid, delivery_group_id uuid, assigned_component_hours numeric(5,2), is_active boolean DEFAULT true);
ALTER TABLE public.teaching_assignments ADD PRIMARY KEY(id);
CREATE TABLE public.time_slot_templates (id uuid DEFAULT gen_random_uuid(), college_id uuid, study_system text, day_of_week smallint, start_time time without time zone, end_time time without time zone, slot_duration_minutes integer, is_active boolean DEFAULT true, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now());
ALTER TABLE public.time_slot_templates ADD PRIMARY KEY(id);
CREATE TABLE public.time_slots (id uuid DEFAULT gen_random_uuid(), college_id uuid, day_of_week smallint, start_time time without time zone, end_time time without time zone, slot_order integer DEFAULT 1, is_active boolean DEFAULT true, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now());
ALTER TABLE public.time_slots ADD PRIMARY KEY(id);
CREATE TABLE public.universities (id uuid DEFAULT gen_random_uuid(), name text, code text, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now());
ALTER TABLE public.universities ADD PRIMARY KEY(id);
CREATE TABLE public.user_colleges (id uuid DEFAULT gen_random_uuid(), user_id uuid, college_id uuid, created_at timestamp with time zone DEFAULT now());
ALTER TABLE public.user_colleges ADD PRIMARY KEY(id);
CREATE TABLE public.user_roles (id uuid DEFAULT gen_random_uuid(), user_id uuid, role app_role, created_at timestamp with time zone DEFAULT now());
ALTER TABLE public.user_roles ADD PRIMARY KEY(id);
CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF; END $$;
GRANT USAGE ON SCHEMA auth TO authenticated,anon;
SET check_function_bodies=off;
CREATE OR REPLACE FUNCTION public.generate_cohort_curriculum(p_cohort_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_cohort public.academic_cohorts%ROWTYPE;
  v_term_type text;
  v_semester integer;
  v_plan_id uuid;
  v_plan_count integer;
  v_plan_code text;
  v_inserted integer := 0;
  v_skipped_existing integer := 0;
  v_skipped_summer integer := 0;
  v_skipped_unselected_elective integer := 0;
  v_required_candidates integer := 0;
  v_elective_candidates integer := 0;
  v_null_uuid uuid := '00000000-0000-0000-0000-000000000000';
  v_warnings jsonb := '[]'::jsonb;
  r record;
BEGIN
  IF p_cohort_id IS NULL THEN
    RAISE EXCEPTION 'COHORT_ID_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(9262, 1);
  SELECT * INTO v_cohort FROM public.academic_cohorts
  WHERE id = p_cohort_id AND public.can_manage_college(v_uid, college_id)
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COHORT_NOT_FOUND_OR_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF NOT COALESCE(v_cohort.active, false) THEN
    RAISE EXCEPTION 'COHORT_INACTIVE' USING ERRCODE = '23514';
  END IF;
  -- Keep plan selection and its inputs stable until generation commits.
  LOCK TABLE public.study_plans, public.plan_courses, public.plan_course_components,
    public.courses, public.elective_slots, public.elective_slot_courses,
    public.cohort_elective_selections IN SHARE MODE;

  SELECT t.term_type INTO v_term_type
  FROM public.academic_terms t
  WHERE t.id = v_cohort.term_id
    AND t.college_id = v_cohort.college_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COHORT_TERM_MISSING' USING ERRCODE = 'check_violation';
  END IF;

  IF v_term_type = 'first' THEN
    v_semester := 1;
  ELSIF v_term_type = 'second' THEN
    v_semester := 2;
  ELSE
    RAISE EXCEPTION 'COHORT_TERM_TYPE_UNSUPPORTED' USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.study_plans sp
    WHERE sp.college_id = v_cohort.college_id AND sp.program_id = v_cohort.program_id
      AND COALESCE(sp.is_active, false)) THEN
    RAISE EXCEPTION 'STUDY_PLAN_MISSING_FOR_COHORT_PROGRAM' USING ERRCODE = '23514';
  END IF;

  -- A program can have different active plans for different levels.
  -- Never pick the latest plan arbitrarily or combine overlapping versions.
  SELECT count(*)::integer, (array_agg(sp.id ORDER BY sp.id))[1]
    INTO v_plan_count, v_plan_id
  FROM public.study_plans sp
  WHERE sp.college_id = v_cohort.college_id
    AND sp.program_id = v_cohort.program_id
    AND COALESCE(sp.is_active, false)
    AND (v_cohort.study_plan_id IS NULL OR sp.id = v_cohort.study_plan_id)
    AND (EXISTS (
      SELECT 1 FROM public.plan_courses pc
      WHERE pc.study_plan_id = sp.id AND pc.college_id = v_cohort.college_id
        AND pc.level_id = v_cohort.level_id AND pc.semester = v_semester
    ) OR EXISTS (
      SELECT 1 FROM public.elective_slots es
      WHERE es.study_plan_id = sp.id AND es.college_id = v_cohort.college_id
        AND (es.level_id IS NULL OR es.level_id = v_cohort.level_id)
        AND es.semester = v_semester AND COALESCE(es.active, true)
    ));
  IF v_plan_count = 0 THEN
    RAISE EXCEPTION 'STUDY_PLAN_MISSING_FOR_COHORT_LEVEL_TERM' USING ERRCODE = '23514';
  ELSIF v_plan_count <> 1 THEN
    RAISE EXCEPTION 'STUDY_PLAN_AMBIGUOUS_FOR_COHORT_LEVEL_TERM' USING ERRCODE = '23514';
  END IF;
  SELECT code INTO v_plan_code FROM public.study_plans WHERE id = v_plan_id;

  IF EXISTS (SELECT 1 FROM public.cohort_elective_selections
    WHERE cohort_id = p_cohort_id AND college_id = v_cohort.college_id
      AND (decided_at IS NULL OR decided_by IS NULL)) THEN
    RAISE EXCEPTION 'ELECTIVE_DECISION_NOT_APPROVED' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.course_offerings co
    WHERE co.college_id = v_cohort.college_id AND co.term_id = v_cohort.term_id
      AND co.program_id = v_cohort.program_id AND co.level_id = v_cohort.level_id
      AND co.study_system = v_cohort.study_system AND COALESCE(co.is_active, true)
      AND co.study_plan_id IS DISTINCT FROM v_plan_id) THEN
    RAISE EXCEPTION 'COHORT_EXISTING_PLAN_CONFLICT' USING ERRCODE = '23514';
  END IF;

  FOR r IN
    SELECT
      pc.id AS plan_course_id,
      pc.course_id,
      c.code AS course_code,
      c.name AS course_name,
      EXISTS (
        SELECT 1 FROM public.plan_course_components pcc
        WHERE pcc.plan_course_id = pc.id
          AND pcc.component_type = 'summer_training'
          AND pcc.is_timetabled = false
          AND NOT EXISTS (
            SELECT 1 FROM public.plan_course_components pcc2
            WHERE pcc2.plan_course_id = pc.id
              AND pcc2.component_type <> 'summer_training'
              AND pcc2.is_timetabled = true
          )
      ) AS summer_only
    FROM public.plan_courses pc
    JOIN public.courses c ON c.id = pc.course_id AND c.college_id = pc.college_id
    WHERE pc.college_id = v_cohort.college_id
      AND pc.study_plan_id = v_plan_id
      AND pc.level_id = v_cohort.level_id
      AND pc.semester = v_semester
      AND COALESCE(pc.is_required, true) = true
      AND c.code !~* '\(E\)\s*$'
      AND c.code !~* '^[A-Z]{2,}\dXX\(E\)$'
  LOOP
    v_required_candidates := v_required_candidates + 1;
    IF r.summer_only THEN
      v_skipped_summer := v_skipped_summer + 1;
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.course_offerings co
      WHERE co.college_id = v_cohort.college_id
        AND co.term_id = v_cohort.term_id
        AND co.course_id = r.course_id
        AND COALESCE(co.program_id, v_null_uuid) = COALESCE(v_cohort.program_id, v_null_uuid)
        AND COALESCE(co.level_id, v_null_uuid) = COALESCE(v_cohort.level_id, v_null_uuid)
        AND co.study_system = v_cohort.study_system
    ) THEN
      v_skipped_existing := v_skipped_existing + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.course_offerings (
      college_id, term_id, course_id, program_id, level_id, study_system,
      study_plan_id, plan_course_id, expected_students, sections_count,
      status, is_active, notes, enrollment_count_status
    ) VALUES (
      v_cohort.college_id, v_cohort.term_id, r.course_id, v_cohort.program_id, v_cohort.level_id,
      v_cohort.study_system, v_plan_id, r.plan_course_id, COALESCE(v_cohort.expected_students, 0), 0,
      'draft', true, NULL, 'unverified'
    );
    v_inserted := v_inserted + 1;
  END LOOP;

  FOR r IN
    SELECT es.id AS elective_slot_id, es.slot_code
    FROM public.elective_slots es
    WHERE es.college_id = v_cohort.college_id
      AND es.study_plan_id = v_plan_id
      AND es.semester = v_semester
      AND COALESCE(es.active, true) = true
      AND (es.level_id IS NULL OR es.level_id = v_cohort.level_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.cohort_elective_selections ces
        WHERE ces.cohort_id = p_cohort_id
          AND ces.elective_slot_id = es.id
          AND ces.college_id = v_cohort.college_id
      )
  LOOP
    v_skipped_unselected_elective := v_skipped_unselected_elective + 1;
    v_warnings := v_warnings || jsonb_build_array(
      jsonb_build_object(
        'code', 'ELECTIVE_SLOT_UNSELECTED',
        'elective_slot_id', r.elective_slot_id,
        'slot_code', r.slot_code,
        'message_ar', 'خانة اختيارية بلا اختيار — لم يُنشأ طرح ولا مقرر وهمي.'
      )
    );
  END LOOP;

  FOR r IN
    SELECT
      ces.selected_course_id AS course_id,
      c.code AS course_code,
      c.name AS course_name,
      ces.elective_slot_id,
      es.slot_code,
      es.study_plan_id AS slot_plan_id,
      es.semester AS slot_semester,
      es.level_id AS slot_level_id,
      es.active AS slot_active,
      pc.id AS plan_course_id
    FROM public.cohort_elective_selections ces
    JOIN public.courses c ON c.id = ces.selected_course_id AND c.college_id = ces.college_id
    JOIN public.elective_slots es ON es.id = ces.elective_slot_id AND es.college_id = ces.college_id
    LEFT JOIN public.plan_courses pc
      ON pc.study_plan_id = v_plan_id
     AND pc.course_id = ces.selected_course_id
     AND pc.college_id = v_cohort.college_id
     AND pc.semester = v_semester
     AND pc.level_id = v_cohort.level_id
    WHERE ces.cohort_id = p_cohort_id
      AND ces.college_id = v_cohort.college_id
  LOOP
    IF r.slot_plan_id IS DISTINCT FROM v_plan_id
       OR r.slot_semester IS DISTINCT FROM v_semester
       OR COALESCE(r.slot_active, true) = false
       OR (r.slot_level_id IS NOT NULL AND r.slot_level_id IS DISTINCT FROM v_cohort.level_id) THEN
      RAISE EXCEPTION 'ELECTIVE_SLOT_CONTEXT_MISMATCH'
        USING ERRCODE = 'check_violation',
              DETAIL = format('slot=%s plan/semester/level does not match cohort curriculum context', r.slot_code);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.elective_slot_courses esc
      WHERE esc.elective_slot_id = r.elective_slot_id
        AND esc.course_id = r.course_id
        AND esc.college_id = v_cohort.college_id
        AND COALESCE(esc.active, true) = true
    ) THEN
      RAISE EXCEPTION 'ELECTIVE_COURSE_NOT_IN_SLOT'
        USING ERRCODE = 'check_violation',
              DETAIL = format('course=%s is not allowed for elective_slot=%s', r.course_code, r.slot_code);
    END IF;

    IF r.course_code ~* '\(E\)\s*$' OR r.course_code ~* '^[A-Z]{2,}\dXX\(E\)$' THEN
      RAISE EXCEPTION 'ELECTIVE_PLACEHOLDER_FORBIDDEN'
        USING ERRCODE = 'check_violation',
              DETAIL = format('placeholder course code not allowed: %s', r.course_code);
    END IF;

    IF r.plan_course_id IS NULL THEN
      RAISE EXCEPTION 'ELECTIVE_PLAN_COURSE_MISSING' USING ERRCODE = '23514';
    END IF;
    v_elective_candidates := v_elective_candidates + 1;

    IF EXISTS (
      SELECT 1 FROM public.course_offerings co
      WHERE co.college_id = v_cohort.college_id
        AND co.term_id = v_cohort.term_id
        AND co.course_id = r.course_id
        AND COALESCE(co.program_id, v_null_uuid) = COALESCE(v_cohort.program_id, v_null_uuid)
        AND COALESCE(co.level_id, v_null_uuid) = COALESCE(v_cohort.level_id, v_null_uuid)
        AND co.study_system = v_cohort.study_system
    ) THEN
      v_skipped_existing := v_skipped_existing + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.course_offerings (
      college_id, term_id, course_id, program_id, level_id, study_system,
      study_plan_id, plan_course_id, expected_students, sections_count,
      status, is_active, notes, enrollment_count_status
    ) VALUES (
      v_cohort.college_id, v_cohort.term_id, r.course_id, v_cohort.program_id, v_cohort.level_id,
      v_cohort.study_system, v_plan_id, r.plan_course_id,
      COALESCE(v_cohort.expected_students, 0), 0,
      'draft', true,
      'مقرر اختياري (' || COALESCE(r.course_name, r.course_code) || ')',
      'unverified'
    );
    v_inserted := v_inserted + 1;
  END LOOP;

  IF v_inserted = 0 AND v_skipped_existing = 0 THEN
    RAISE EXCEPTION 'COHORT_CURRICULUM_EMPTY' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, college_id, details)
  VALUES (v_uid, 'generate_cohort_curriculum', 'academic_cohorts', p_cohort_id,
    v_cohort.college_id, jsonb_build_object('study_plan_id', v_plan_id,
      'term_id', v_cohort.term_id, 'inserted_offerings', v_inserted,
      'skipped_existing', v_skipped_existing));
  RETURN jsonb_build_object(
    'operation' , 'generate_cohort_curriculum',
    'cohort_id', p_cohort_id,
    'study_plan_id', v_plan_id,
    'study_plan_code', v_plan_code,
    'semester', v_semester,
    'term_type', v_term_type,
    'inserted_offerings', v_inserted,
    'skipped_existing', v_skipped_existing,
    'skipped_summer_only', v_skipped_summer,
    'skipped_unselected_elective', v_skipped_unselected_elective,
    'required_candidates', v_required_candidates,
    'elective_candidates', v_elective_candidates,
    'warnings', v_warnings,
    'created_sections', 0,
    'created_delivery_groups', 0,
    'created_sessions', 0,
    'result', 'success'
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.can_view_college(_user_id uuid, _college_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT public.is_super_admin(_user_id)
      OR public.user_in_college(_user_id, _college_id)
$function$;
CREATE OR REPLACE FUNCTION public.ensure_ta_college()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  oc uuid;
  ic uuid;
  dg_college uuid;
  dg_cohort uuid;
  dg_component uuid;
  dg_plan_course uuid;
  dg_obsolete boolean;
  dg_active boolean;
  co_plan_course uuid;
  co_term uuid;
  co_program uuid;
  co_level uuid;
  co_study_system text;
  co_college uuid;
  pcc_type text;
  pcc_plan_course uuid;
  pcc_hours numeric;
  pcc_college uuid;
  v_co_count integer;
  v_null_split_count integer;
  v_sum_assigned numeric;
  v_cohort_term uuid;
  v_cohort_program uuid;
  v_cohort_level uuid;
  v_cohort_study text;
  v_cohort_college uuid;
BEGIN
  SELECT college_id, plan_course_id, term_id, program_id, level_id, study_system
    INTO oc, co_plan_course, co_term, co_program, co_level, co_study_system
  FROM public.course_offerings WHERE id = NEW.course_offering_id;
  co_college := oc;

  SELECT college_id INTO ic FROM public.instructors WHERE id = NEW.instructor_id;
  IF oc IS NULL OR ic IS NULL OR oc <> NEW.college_id OR ic <> NEW.college_id THEN
    RAISE EXCEPTION 'offering/instructor/college mismatch' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.is_active IS NULL THEN
    NEW.is_active := TRUE;
  END IF;

  -- Session-linked: do not silently change instructor or delivery_group
  IF TG_OP = 'UPDATE'
     AND (
       OLD.instructor_id IS DISTINCT FROM NEW.instructor_id
       OR OLD.delivery_group_id IS DISTINCT FROM NEW.delivery_group_id
     )
     AND EXISTS (
       SELECT 1 FROM public.schedule_sessions ss
       WHERE ss.teaching_assignment_id = NEW.id
     ) THEN
    RAISE EXCEPTION 'ASSIGNMENT_LINKED_TO_SESSION_MUTATION_FORBIDDEN'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.delivery_group_id IS NOT NULL THEN
    SELECT dg.college_id, dg.cohort_id, dg.component_id, dg.plan_course_id, dg.is_obsolete, dg.active
      INTO dg_college, dg_cohort, dg_component, dg_plan_course, dg_obsolete, dg_active
    FROM public.delivery_groups dg
    WHERE dg.id = NEW.delivery_group_id;

    IF dg_college IS NULL THEN
      RAISE EXCEPTION 'DELIVERY_GROUP_NOT_FOUND' USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF dg_college <> NEW.college_id THEN
      RAISE EXCEPTION 'ASSIGNMENT_CROSS_COLLEGE_FORBIDDEN' USING ERRCODE = 'check_violation';
    END IF;
    -- Obsolete / inactive groups reject active assignments only (deactivate remains allowed)
    IF COALESCE(dg_obsolete, false) AND COALESCE(NEW.is_active, true) THEN
      RAISE EXCEPTION 'OBSOLETE_DELIVERY_GROUP_ASSIGNMENT_FORBIDDEN' USING ERRCODE = 'check_violation';
    END IF;
    IF COALESCE(dg_active, true) = false AND COALESCE(NEW.is_active, true) THEN
      RAISE EXCEPTION 'DELIVERY_GROUP_INACTIVE_ASSIGNMENT_FORBIDDEN' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.cohort_id IS NOT NULL AND NEW.cohort_id IS DISTINCT FROM dg_cohort THEN
      RAISE EXCEPTION 'ASSIGNMENT_COHORT_MISMATCH' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.plan_course_component_id IS NOT NULL
       AND NEW.plan_course_component_id IS DISTINCT FROM dg_component THEN
      RAISE EXCEPTION 'ASSIGNMENT_COMPONENT_MISMATCH' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.cohort_id IS NULL THEN
      NEW.cohort_id := dg_cohort;
    END IF;
    IF NEW.plan_course_component_id IS NULL THEN
      NEW.plan_course_component_id := dg_component;
    END IF;

    IF co_plan_course IS NULL OR co_plan_course IS DISTINCT FROM dg_plan_course THEN
      RAISE EXCEPTION 'OFFERING_PLAN_COURSE_MISMATCH' USING ERRCODE = 'check_violation';
    END IF;

    SELECT ac.college_id, ac.term_id, ac.program_id, ac.level_id, ac.study_system
      INTO v_cohort_college, v_cohort_term, v_cohort_program, v_cohort_level, v_cohort_study
    FROM public.academic_cohorts ac
    WHERE ac.id = dg_cohort;

    IF v_cohort_college IS NULL OR v_cohort_college <> NEW.college_id THEN
      RAISE EXCEPTION 'ASSIGNMENT_COHORT_COLLEGE_MISMATCH' USING ERRCODE = 'check_violation';
    END IF;
    IF co_college <> v_cohort_college
       OR co_term IS DISTINCT FROM v_cohort_term
       OR COALESCE(co_program, v_cohort_program) IS DISTINCT FROM v_cohort_program
       OR COALESCE(co_level, v_cohort_level) IS DISTINCT FROM v_cohort_level
       OR co_study_system IS DISTINCT FROM v_cohort_study THEN
      RAISE EXCEPTION 'OFFERING_COHORT_CONTEXT_MISMATCH' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.plan_course_component_id IS NOT NULL THEN
    SELECT pcc.component_type, pcc.plan_course_id, pcc.weekly_contact_hours, pcc.college_id
      INTO pcc_type, pcc_plan_course, pcc_hours, pcc_college
    FROM public.plan_course_components pcc
    WHERE pcc.id = NEW.plan_course_component_id
      AND pcc.college_id = NEW.college_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ASSIGNMENT_COMPONENT_COLLEGE_MISMATCH' USING ERRCODE = 'check_violation';
    END IF;
    IF pcc_type = 'summer_training' THEN
      RAISE EXCEPTION 'SUMMER_TRAINING_WEEKLY_ASSIGNMENT_FORBIDDEN' USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.delivery_group_id IS NOT NULL AND COALESCE(NEW.is_active, true) THEN
      IF pcc_plan_course IS DISTINCT FROM dg_plan_course THEN
        RAISE EXCEPTION 'COMPONENT_PLAN_COURSE_MISMATCH' USING ERRCODE = 'check_violation';
      END IF;

      IF NEW.assigned_component_hours IS NOT NULL AND NEW.assigned_component_hours <= 0 THEN
        RAISE EXCEPTION 'ASSIGNED_HOURS_MUST_BE_POSITIVE' USING ERRCODE = 'check_violation';
      END IF;

      IF NEW.assigned_component_hours IS NOT NULL
         AND pcc_hours IS NOT NULL
         AND NEW.assigned_component_hours > pcc_hours THEN
        RAISE EXCEPTION 'CO_TEACHING_HOURS_OVER_ALLOCATED' USING ERRCODE = 'check_violation';
      END IF;

      SELECT COUNT(*)::integer,
             COUNT(*) FILTER (WHERE ta.assigned_component_hours IS NULL
                               AND ta.id IS DISTINCT FROM NEW.id)::integer
               + CASE WHEN NEW.assigned_component_hours IS NULL THEN 1 ELSE 0 END,
             COALESCE(SUM(ta.assigned_component_hours) FILTER (WHERE ta.id IS DISTINCT FROM NEW.id), 0)
               + COALESCE(NEW.assigned_component_hours, 0)
        INTO v_co_count, v_null_split_count, v_sum_assigned
      FROM public.teaching_assignments ta
      WHERE ta.delivery_group_id = NEW.delivery_group_id
        AND ta.is_active = TRUE;

      IF TG_OP = 'INSERT' THEN
        v_co_count := v_co_count + 1;
      ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.delivery_group_id IS DISTINCT FROM NEW.delivery_group_id
           OR COALESCE(OLD.is_active, true) IS DISTINCT FROM TRUE THEN
          v_co_count := v_co_count + 1;
        END IF;
      END IF;

      IF v_co_count > 1 AND v_null_split_count > 0 THEN
        RAISE EXCEPTION 'CO_TEACHING_HOURS_SPLIT_REQUIRED' USING ERRCODE = 'check_violation';
      END IF;

      IF pcc_hours IS NOT NULL AND v_sum_assigned > pcc_hours THEN
        RAISE EXCEPTION 'CO_TEACHING_HOURS_OVER_ALLOCATED' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  IF NEW.cohort_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.academic_cohorts ac
      WHERE ac.id = NEW.cohort_id AND ac.college_id = NEW.college_id
    ) THEN
      RAISE EXCEPTION 'ASSIGNMENT_COHORT_COLLEGE_MISMATCH' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.list_teaching_assignment_workspace(p_college_id uuid, p_program_id uuid DEFAULT NULL::uuid, p_level_id uuid DEFAULT NULL::uuid, p_term_id uuid DEFAULT NULL::uuid, p_study_system text DEFAULT NULL::text, p_cohort_id uuid DEFAULT NULL::uuid, p_component_type text DEFAULT NULL::text, p_assignment_status text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_rows jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  IF p_college_id IS NULL THEN
    RAISE EXCEPTION 'COLLEGE_ID_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT public.can_view_college(v_uid, p_college_id) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  -- summer_training excluded (not weekly assignable)
  SELECT COALESCE(jsonb_agg(x.row_obj ORDER BY x.course_code, x.component_type, x.group_number), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT
      c.code AS course_code,
      pcc.component_type,
      dg.group_number,
      jsonb_build_object(
        'delivery_group_id', dg.id,
        'college_id', dg.college_id,
        'cohort_id', dg.cohort_id,
        'cohort_code', ac.code,
        'program_id', ac.program_id,
        'level_id', ac.level_id,
        'term_id', ac.term_id,
        'study_system', ac.study_system,
        'plan_course_id', dg.plan_course_id,
        'plan_course_component_id', dg.component_id,
        'component_type', pcc.component_type,
        'course_id', c.id,
        'course_code', c.code,
        'course_name', c.name,
        'group_number', dg.group_number,
        'group_code', dg.group_code,
        'expected_students', dg.expected_students,
        'capacity_limit', dg.capacity_limit,
        'is_obsolete', COALESCE(dg.is_obsolete, false),
        'active', COALESCE(dg.active, true),
        'excluded_from_standard_workload', COALESCE(dg.excluded_from_standard_workload, false),
        'component_hours', pcc.weekly_contact_hours,
        'assigned_hours_total', alloc.assigned_hours_total,
        'remaining_hours', alloc.remaining_hours,
        'assignment_count', alloc.assignment_count,
        'is_co_taught', alloc.is_co_taught,
        'allocation_status', alloc.allocation_status,
        'instructors', COALESCE(instr.instructors, '[]'::jsonb),
        'conflicts', COALESCE(conf.conflicts, '[]'::jsonb)
      ) AS row_obj
    FROM public.delivery_groups dg
    JOIN public.academic_cohorts ac ON ac.id = dg.cohort_id AND ac.college_id = dg.college_id
    JOIN public.plan_course_components pcc ON pcc.id = dg.component_id
    JOIN public.plan_courses pc ON pc.id = dg.plan_course_id
    JOIN public.courses c ON c.id = pc.course_id
    -- ASSERT: allocation_json is jsonb scalar; never apply ->> to a record alias
    CROSS JOIN LATERAL (
      SELECT public.compute_delivery_group_allocation(dg.id) AS allocation_json
    ) alloc_src
    CROSS JOIN LATERAL (
      SELECT
        COALESCE((alloc_src.allocation_json->>'assigned_hours_total')::numeric, 0) AS assigned_hours_total,
        COALESCE((alloc_src.allocation_json->>'remaining_hours')::numeric, 0) AS remaining_hours,
        COALESCE((alloc_src.allocation_json->>'assignment_count')::integer, 0) AS assignment_count,
        COALESCE((alloc_src.allocation_json->>'is_co_taught')::boolean, false) AS is_co_taught,
        COALESCE(alloc_src.allocation_json->>'allocation_status', 'unassigned') AS allocation_status
    ) alloc
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object(
          'assignment_id', ta.id,
          'instructor_id', ta.instructor_id,
          'instructor_name', i.full_name,
          'employee_number', i.employee_number,
          'assigned_component_hours', ta.assigned_component_hours,
          'is_active', ta.is_active,
          'updated_at', ta.updated_at
        )
        ORDER BY i.full_name
      ) AS instructors
      FROM public.teaching_assignments ta
      JOIN public.instructors i ON i.id = ta.instructor_id
      WHERE ta.delivery_group_id = dg.id
        AND ta.is_active = TRUE
    ) instr ON TRUE
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(c_code) AS conflicts
      FROM (
        SELECT 'OBSOLETE_DELIVERY_GROUP' AS c_code
        WHERE COALESCE(dg.is_obsolete, false)
        UNION ALL
        SELECT 'INACTIVE_DELIVERY_GROUP' AS c_code
        WHERE COALESCE(dg.active, true) = false
        UNION ALL
        SELECT 'UNDER_ALLOCATED'
        WHERE alloc.allocation_status = 'under_allocated' AND alloc.assignment_count > 0
        UNION ALL
        SELECT 'OVER_ALLOCATED'
        WHERE alloc.allocation_status = 'over_allocated'
        UNION ALL
        SELECT 'UNASSIGNED'
        WHERE alloc.allocation_status = 'unassigned'
      ) z
    ) conf ON TRUE
    WHERE dg.college_id = p_college_id
      AND pcc.component_type IS DISTINCT FROM 'summer_training'
      AND (p_cohort_id IS NULL OR dg.cohort_id = p_cohort_id)
      AND (p_program_id IS NULL OR ac.program_id = p_program_id)
      AND (p_level_id IS NULL OR ac.level_id = p_level_id)
      AND (p_term_id IS NULL OR ac.term_id = p_term_id)
      AND (p_study_system IS NULL OR ac.study_system = p_study_system)
      AND (p_component_type IS NULL OR pcc.component_type = p_component_type)
      AND (
        p_assignment_status IS NULL
        OR p_assignment_status = 'all'
        OR (p_assignment_status = 'assigned' AND alloc.assignment_count > 0)
        OR (p_assignment_status = 'unassigned' AND alloc.assignment_count = 0)
        OR (p_assignment_status = 'under_allocated' AND alloc.allocation_status = 'under_allocated')
        OR (p_assignment_status = 'fully_allocated' AND alloc.allocation_status = 'fully_allocated')
        OR (p_assignment_status = 'obsolete' AND COALESCE(dg.is_obsolete, false))
        OR (p_assignment_status = 'inactive' AND COALESCE(dg.active, true) = false)
      )
  ) x;

  RETURN jsonb_build_object(
    'ok', true,
    'college_id', p_college_id,
    'rows', COALESCE(v_rows, '[]'::jsonb),
    'can_manage', public.can_manage_college(v_uid, p_college_id)
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.assert_delivery_group_assignable(p_is_obsolete boolean, p_active boolean)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(p_is_obsolete, false) THEN
    RAISE EXCEPTION 'OBSOLETE_DELIVERY_GROUP_ASSIGNMENT_FORBIDDEN' USING ERRCODE = 'check_violation';
  END IF;
  IF COALESCE(p_active, true) = false THEN
    RAISE EXCEPTION 'DELIVERY_GROUP_INACTIVE_ASSIGNMENT_FORBIDDEN' USING ERRCODE = 'check_violation';
  END IF;
END;
$function$;
CREATE OR REPLACE FUNCTION public.create_teaching_assignment_v2(p_delivery_group_id uuid, p_instructor_id uuid, p_assigned_component_hours numeric DEFAULT NULL::numeric, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_dg public.delivery_groups%ROWTYPE;
  v_pcc public.plan_course_components%ROWTYPE;
  v_instructor public.instructors%ROWTYPE;
  v_offering_id uuid;
  v_session_type text;
  v_effective_hours numeric;
  v_existing public.teaching_assignments%ROWTYPE;
  v_row public.teaching_assignments%ROWTYPE;
  v_action text;
  v_audit_action text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  IF p_delivery_group_id IS NULL OR p_instructor_id IS NULL THEN
    RAISE EXCEPTION 'DELIVERY_GROUP_AND_INSTRUCTOR_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;

  -- Lock order: delivery_group → active assignment rows
  v_dg := public.lock_delivery_group_for_assignment(p_delivery_group_id);

  IF NOT public.can_manage_college(v_uid, v_dg.college_id) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  PERFORM public.assert_delivery_group_assignable(v_dg.is_obsolete, v_dg.active);

  SELECT * INTO v_instructor FROM public.instructors WHERE id = p_instructor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INSTRUCTOR_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_instructor.college_id <> v_dg.college_id THEN
    RAISE EXCEPTION 'ASSIGNMENT_CROSS_COLLEGE_FORBIDDEN' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_pcc FROM public.plan_course_components WHERE id = v_dg.component_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ASSIGNMENT_COMPONENT_MISMATCH' USING ERRCODE = 'check_violation';
  END IF;
  IF v_pcc.component_type = 'summer_training' THEN
    RAISE EXCEPTION 'SUMMER_TRAINING_WEEKLY_ASSIGNMENT_FORBIDDEN' USING ERRCODE = 'check_violation';
  END IF;

  IF p_assigned_component_hours IS NOT NULL AND p_assigned_component_hours <= 0 THEN
    RAISE EXCEPTION 'ASSIGNED_HOURS_MUST_BE_POSITIVE' USING ERRCODE = 'check_violation';
  END IF;

  -- Reactivate inactive natural key if present (target row lock)
  SELECT * INTO v_existing
  FROM public.teaching_assignments ta
  WHERE ta.college_id = v_dg.college_id
    AND ta.delivery_group_id = p_delivery_group_id
    AND ta.instructor_id = p_instructor_id
  ORDER BY ta.is_active DESC, ta.updated_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_existing.id IS NOT NULL AND v_existing.is_active THEN
    RAISE EXCEPTION 'DUPLICATE_ACTIVE_ASSIGNMENT' USING ERRCODE = 'unique_violation';
  END IF;

  v_offering_id := public.resolve_offering_for_delivery_group(p_delivery_group_id);
  IF v_offering_id IS NULL THEN
    RAISE EXCEPTION 'NO_COMPATIBILITY_OFFERING' USING ERRCODE = 'check_violation';
  END IF;

  v_session_type := CASE v_pcc.component_type
    WHEN 'theory' THEN 'lecture'
    WHEN 'practical' THEN 'lab'
    WHEN 'tutorial' THEN 'tutorial'
    WHEN 'project' THEN 'seminar'
    ELSE 'lecture'
  END;

  v_effective_hours := COALESCE(p_assigned_component_hours, v_pcc.weekly_contact_hours, 0);

  PERFORM public.validate_assignment_allocation_locked(
    p_delivery_group_id,
    CASE WHEN v_existing.id IS NOT NULL AND NOT v_existing.is_active THEN v_existing.id ELSE NULL END,
    p_assigned_component_hours,
    v_pcc.weekly_contact_hours,
    true
  );

  IF v_existing.id IS NOT NULL AND NOT v_existing.is_active THEN
    UPDATE public.teaching_assignments SET
      is_active = TRUE,
      assigned_component_hours = p_assigned_component_hours,
      weekly_hours = v_effective_hours,
      notes = COALESCE(p_notes, notes),
      course_offering_id = v_offering_id,
      cohort_id = v_dg.cohort_id,
      plan_course_component_id = v_dg.component_id,
      session_type = v_session_type,
      expected_students = COALESCE(v_dg.expected_students, expected_students)
    WHERE id = v_existing.id
    RETURNING * INTO v_row;
    v_action := 'reactivated';
    v_audit_action := 'teaching_assignment_reactivated';
  ELSE
    INSERT INTO public.teaching_assignments (
      college_id,
      course_offering_id,
      instructor_id,
      section_number,
      session_type,
      weekly_hours,
      notes,
      expected_students,
      cohort_id,
      plan_course_component_id,
      delivery_group_id,
      assigned_component_hours,
      is_active
    ) VALUES (
      v_dg.college_id,
      v_offering_id,
      p_instructor_id,
      COALESCE(v_dg.group_code, v_dg.group_number::text),
      v_session_type,
      v_effective_hours,
      p_notes,
      COALESCE(v_dg.expected_students, 0),
      v_dg.cohort_id,
      v_dg.component_id,
      p_delivery_group_id,
      p_assigned_component_hours,
      TRUE
    )
    RETURNING * INTO v_row;
    v_action := 'created';
    v_audit_action := 'teaching_assignment_created';
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (
    v_uid,
    v_audit_action,
    'teaching_assignments',
    v_row.id,
    v_dg.college_id,
    jsonb_build_object(
      'assignment_id', v_row.id,
      'delivery_group_id', p_delivery_group_id,
      'instructor_id', p_instructor_id,
      'component_type', v_pcc.component_type,
      'old_assigned_hours', NULL,
      'new_assigned_hours', p_assigned_component_hours,
      'lifecycle_action', v_action
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'action', v_action,
    'assignment_id', v_row.id,
    'delivery_group_id', p_delivery_group_id,
    'instructor_id', p_instructor_id,
    'assigned_component_hours', v_row.assigned_component_hours,
    'is_active', v_row.is_active,
    'updated_at', v_row.updated_at,
    'allocation', public.compute_delivery_group_allocation(p_delivery_group_id)
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.compute_delivery_group_allocation(p_delivery_group_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_dg public.delivery_groups%ROWTYPE;
  v_hours numeric;
  v_type text;
  v_sum numeric := 0;
  v_count integer := 0;
  v_remaining numeric;
  v_status text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  IF p_delivery_group_id IS NULL THEN
    RAISE EXCEPTION 'DELIVERY_GROUP_ID_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_dg FROM public.delivery_groups WHERE id = p_delivery_group_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DELIVERY_GROUP_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT public.can_view_college(v_uid, v_dg.college_id) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  SELECT pcc.weekly_contact_hours, pcc.component_type
    INTO v_hours, v_type
  FROM public.plan_course_components pcc
  WHERE pcc.id = v_dg.component_id;

  SELECT COALESCE(SUM(ta.assigned_component_hours), 0), COUNT(*)::integer
    INTO v_sum, v_count
  FROM public.teaching_assignments ta
  WHERE ta.delivery_group_id = p_delivery_group_id
    AND ta.is_active = TRUE;

  -- Sole instructor without explicit hours still "uses" component hours once for display
  IF v_count = 1 THEN
    SELECT COALESCE(ta.assigned_component_hours, v_hours, 0)
      INTO v_sum
    FROM public.teaching_assignments ta
    WHERE ta.delivery_group_id = p_delivery_group_id
      AND ta.is_active = TRUE
    LIMIT 1;
  END IF;

  v_remaining := GREATEST(0, COALESCE(v_hours, 0) - COALESCE(v_sum, 0));
  IF v_count = 0 THEN
    v_status := 'unassigned';
  ELSIF COALESCE(v_sum, 0) > COALESCE(v_hours, 0) THEN
    v_status := 'over_allocated';
  ELSIF COALESCE(v_sum, 0) < COALESCE(v_hours, 0) THEN
    v_status := 'under_allocated';
  ELSE
    v_status := 'fully_allocated';
  END IF;

  RETURN jsonb_build_object(
    'delivery_group_id', p_delivery_group_id,
    'component_type', v_type,
    'component_hours', v_hours,
    'assigned_hours_total', v_sum,
    'remaining_hours', v_remaining,
    'assignment_count', v_count,
    'is_co_taught', v_count > 1,
    'allocation_status', v_status
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.approve_scheduling_cohort_term_headcount(p_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_row public.scheduling_cohort_term_headcounts%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'AUTH_REQUIRED', 'message', 'Authentication required'); END IF;
  SELECT * INTO v_row FROM public.scheduling_cohort_term_headcounts WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'Headcount not found'); END IF;
  IF NOT public.can_manage_college(v_uid, v_row.college_id) THEN RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'College management permission required'); END IF;
  IF v_row.scheduling_headcount > v_row.eligible_student_count OR v_row.expected_attendance_count > v_row.eligible_student_count THEN
    IF NULLIF(btrim(coalesce(p_notes, v_row.notes)), '') IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'OVER_ELIGIBLE_REQUIRES_REASON', 'message', 'Approval requires notes for over-eligible values'); END IF;
  END IF;
  UPDATE public.scheduling_cohort_term_headcounts SET approval_status = 'approved', approved_by = v_uid,
    approved_at = now(), notes = coalesce(p_notes, notes) WHERE id = p_id RETURNING * INTO v_row;
  INSERT INTO public.scheduling_headcount_revisions (college_id, headcount_id, revision_kind, snapshot, changed_by, notes)
    VALUES (v_row.college_id, v_row.id, 'approve', to_jsonb(v_row), v_uid, p_notes);
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
    VALUES (v_uid, 'scheduling_headcount_approve', 'scheduling_cohort_term_headcounts', v_row.id, v_row.college_id, '{}'::jsonb);
  RETURN jsonb_build_object('ok', true, 'headcount', to_jsonb(v_row));
END; $function$;
CREATE OR REPLACE FUNCTION public._collect_schedule_session_move_conflicts(p_session_id uuid, p_college_id uuid, p_version_id uuid, p_instructor_id uuid, p_section_id uuid, p_course_offering_id uuid, p_teaching_assignment_id uuid, p_study_system text, p_expected_students integer, p_day_of_week integer, p_start_time time without time zone, p_end_time time without time zone, p_room_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
SELECT public._ss_pack(
  public._ss_gather(
    p_session_id,p_college_id,p_version_id,p_instructor_id,p_section_id,
    p_course_offering_id,p_teaching_assignment_id,p_study_system,p_expected_students,
    p_day_of_week,p_start_time,p_end_time,p_room_id
  ),
  p_version_id
);
$function$;
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$function$;
CREATE OR REPLACE FUNCTION public.commit_teaching_assignments_v2_import(p_rows jsonb, p_mode text DEFAULT 'upsert'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_mode text := lower(COALESCE(NULLIF(btrim(p_mode), ''), 'upsert'));
  v_batch_id uuid := gen_random_uuid();
  v_errors jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_rows_received integer := 0;
  v_created integer := 0;
  v_updated integer := 0;
  v_reactivated integer := 0;
  v_unchanged integer := 0;
  v_elem jsonb;
  v_row_number integer;
  v_dg_id uuid;
  v_instructor_id uuid;
  v_hours numeric;
  v_notes text;
  v_is_active boolean;
  v_offering_id uuid;
  v_expected_students integer;
  v_required_room_type text;
  v_session_type text;
  v_natural_key text;
  v_dg public.delivery_groups%ROWTYPE;
  v_pcc public.plan_course_components%ROWTYPE;
  v_instructor public.instructors%ROWTYPE;
  v_existing public.teaching_assignments%ROWTYPE;
  v_row public.teaching_assignments%ROWTYPE;
  v_effective numeric;
  v_college_ids uuid[];
  v_dg_ids uuid[];
  v_id uuid;
  v_idx integer;
  v_same_hours boolean;
  v_same_notes boolean;
  v_batch_instructors integer;
  v_null_hours integer;
  v_comp_hours numeric;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'IMPORT_ROWS_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;
  IF v_mode NOT IN ('insert_only', 'update_existing', 'upsert') THEN
    RAISE EXCEPTION 'IMPORT_MODE_INVALID' USING ERRCODE = 'check_violation';
  END IF;

  v_rows_received := jsonb_array_length(p_rows);

  -- -------- Phase 1: pre-validate all rows (no DML) --------
  FOR v_idx IN 0 .. GREATEST(v_rows_received - 1, -1) LOOP
    v_elem := p_rows -> v_idx;
    v_row_number := COALESCE((v_elem->>'row_number')::integer, v_idx + 1);
    BEGIN
      v_dg_id := NULLIF(v_elem->>'delivery_group_id', '')::uuid;
      v_instructor_id := NULLIF(v_elem->>'instructor_id', '')::uuid;
    EXCEPTION WHEN others THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row_number', v_row_number,
        'natural_key', NULL,
        'error_code', 'INVALID_UUID',
        'error_message', 'delivery_group_id/instructor_id invalid uuid',
        'blocking', true
      ));
      CONTINUE;
    END;

    v_natural_key := COALESCE(v_dg_id::text, '') || '|' || COALESCE(v_instructor_id::text, '');
    IF v_dg_id IS NULL OR v_instructor_id IS NULL THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row_number', v_row_number,
        'natural_key', v_natural_key,
        'error_code', 'DELIVERY_GROUP_AND_INSTRUCTOR_REQUIRED',
        'error_message', 'delivery_group_id and instructor_id required',
        'blocking', true
      ));
      CONTINUE;
    END IF;

    SELECT * INTO v_dg FROM public.delivery_groups WHERE id = v_dg_id;
    IF NOT FOUND THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row_number', v_row_number, 'natural_key', v_natural_key,
        'error_code', 'DELIVERY_GROUP_NOT_FOUND',
        'error_message', 'delivery group not found', 'blocking', true
      ));
      CONTINUE;
    END IF;
    IF NOT public.can_manage_college(v_uid, v_dg.college_id) THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row_number', v_row_number, 'natural_key', v_natural_key,
        'error_code', 'insufficient_privilege',
        'error_message', 'cannot manage college for delivery group', 'blocking', true
      ));
      CONTINUE;
    END IF;
    IF COALESCE(v_dg.is_obsolete, false) THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row_number', v_row_number, 'natural_key', v_natural_key,
        'error_code', 'OBSOLETE_DELIVERY_GROUP_ASSIGNMENT_FORBIDDEN',
        'error_message', 'obsolete delivery group', 'blocking', true
      ));
      CONTINUE;
    END IF;
    IF COALESCE(v_dg.active, true) = false THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row_number', v_row_number, 'natural_key', v_natural_key,
        'error_code', 'DELIVERY_GROUP_INACTIVE_ASSIGNMENT_FORBIDDEN',
        'error_message', 'inactive delivery group', 'blocking', true
      ));
      CONTINUE;
    END IF;

    SELECT * INTO v_instructor FROM public.instructors WHERE id = v_instructor_id;
    IF NOT FOUND THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row_number', v_row_number, 'natural_key', v_natural_key,
        'error_code', 'INSTRUCTOR_NOT_FOUND',
        'error_message', 'instructor not found', 'blocking', true
      ));
      CONTINUE;
    END IF;
    IF v_instructor.college_id <> v_dg.college_id THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row_number', v_row_number, 'natural_key', v_natural_key,
        'error_code', 'ASSIGNMENT_CROSS_COLLEGE_FORBIDDEN',
        'error_message', 'cross-college assignment', 'blocking', true
      ));
      CONTINUE;
    END IF;

    SELECT * INTO v_pcc FROM public.plan_course_components WHERE id = v_dg.component_id;
    IF NOT FOUND THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row_number', v_row_number, 'natural_key', v_natural_key,
        'error_code', 'ASSIGNMENT_COMPONENT_MISMATCH',
        'error_message', 'component missing', 'blocking', true
      ));
      CONTINUE;
    END IF;
    IF v_pcc.component_type = 'summer_training' THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row_number', v_row_number, 'natural_key', v_natural_key,
        'error_code', 'SUMMER_TRAINING_WEEKLY_ASSIGNMENT_FORBIDDEN',
        'error_message', 'summer training forbidden', 'blocking', true
      ));
      CONTINUE;
    END IF;

    IF v_elem ? 'assigned_component_hours'
       AND v_elem->>'assigned_component_hours' IS NOT NULL
       AND btrim(v_elem->>'assigned_component_hours') <> '' THEN
      v_hours := (v_elem->>'assigned_component_hours')::numeric;
      IF v_hours <= 0 THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'row_number', v_row_number, 'natural_key', v_natural_key,
          'error_code', 'ASSIGNED_HOURS_MUST_BE_POSITIVE',
          'error_message', 'hours must be positive', 'blocking', true
        ));
        CONTINUE;
      END IF;
    END IF;

    v_offering_id := NULLIF(v_elem->>'course_offering_id', '')::uuid;
    IF v_offering_id IS NULL THEN
      v_offering_id := public.resolve_offering_for_delivery_group(v_dg_id);
    END IF;
    IF v_offering_id IS NULL THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row_number', v_row_number, 'natural_key', v_natural_key,
        'error_code', 'NO_COMPATIBILITY_OFFERING',
        'error_message', 'no compatibility offering', 'blocking', true
      ));
      CONTINUE;
    END IF;
  END LOOP;

  -- Batch co-teaching split check (pre-DML, pre-lock)
  SELECT COALESCE(array_agg(x ORDER BY x), ARRAY[]::uuid[])
    INTO v_dg_ids
  FROM (
    SELECT DISTINCT NULLIF(e->>'delivery_group_id', '')::uuid AS x
    FROM jsonb_array_elements(p_rows) e
    WHERE NULLIF(e->>'delivery_group_id', '') IS NOT NULL
  ) s;

  FOREACH v_id IN ARRAY COALESCE(v_dg_ids, ARRAY[]::uuid[]) LOOP
    SELECT COUNT(DISTINCT NULLIF(e->>'instructor_id', '')::uuid)::integer,
           COUNT(*) FILTER (
             WHERE e->>'assigned_component_hours' IS NULL
                OR btrim(COALESCE(e->>'assigned_component_hours', '')) = ''
           )::integer
      INTO v_batch_instructors, v_null_hours
    FROM jsonb_array_elements(p_rows) e
    WHERE NULLIF(e->>'delivery_group_id', '')::uuid = v_id
      AND COALESCE((e->>'is_active')::boolean, true) = true;

    IF v_batch_instructors > 1 AND v_null_hours > 0 THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row_number', NULL,
        'natural_key', v_id::text,
        'error_code', 'CO_TEACHING_HOURS_SPLIT_REQUIRED',
        'error_message', 'co-teaching rows require explicit assigned_component_hours',
        'blocking', true
      ));
    END IF;
  END LOOP;

  IF jsonb_array_length(v_errors) > 0 THEN
    RETURN jsonb_build_object(
      'status', 'failed',
      'rows_received', v_rows_received,
      'rows_created', 0,
      'rows_updated', 0,
      'rows_reactivated', 0,
      'rows_unchanged', 0,
      'validation_errors', v_errors,
      'warnings', v_warnings,
      'import_batch_id', v_batch_id
    );
  END IF;

  -- -------- Phase 2: lock delivery groups in deterministic ASC order --------
  IF v_dg_ids IS NOT NULL THEN
    FOREACH v_id IN ARRAY v_dg_ids LOOP
      PERFORM public.lock_delivery_group_for_assignment(v_id);
    END LOOP;
  END IF;

  -- -------- Phase 3: apply rows atomically --------
  FOR v_idx IN 0 .. GREATEST(v_rows_received - 1, -1) LOOP
    v_elem := p_rows -> v_idx;
    v_row_number := COALESCE((v_elem->>'row_number')::integer, v_idx + 1);
    v_dg_id := (v_elem->>'delivery_group_id')::uuid;
    v_instructor_id := (v_elem->>'instructor_id')::uuid;
    v_natural_key := v_dg_id::text || '|' || v_instructor_id::text;
    v_notes := v_elem->>'notes';
    v_is_active := COALESCE((v_elem->>'is_active')::boolean, true);
    IF v_elem ? 'assigned_component_hours'
       AND v_elem->>'assigned_component_hours' IS NOT NULL
       AND btrim(v_elem->>'assigned_component_hours') <> '' THEN
      v_hours := (v_elem->>'assigned_component_hours')::numeric;
    ELSE
      v_hours := NULL;
    END IF;
    v_expected_students := COALESCE((v_elem->>'expected_students')::integer, 0);
    v_required_room_type := NULLIF(v_elem->>'required_room_type', '');
    v_offering_id := NULLIF(v_elem->>'course_offering_id', '')::uuid;
    IF v_offering_id IS NULL THEN
      v_offering_id := public.resolve_offering_for_delivery_group(v_dg_id);
    END IF;

    SELECT * INTO v_dg FROM public.delivery_groups WHERE id = v_dg_id;
    PERFORM public.assert_delivery_group_assignable(v_dg.is_obsolete, v_dg.active);
    SELECT * INTO v_pcc FROM public.plan_course_components WHERE id = v_dg.component_id;

    v_session_type := COALESCE(
      NULLIF(v_elem->>'session_type', ''),
      CASE v_pcc.component_type
        WHEN 'theory' THEN 'lecture'
        WHEN 'practical' THEN 'lab'
        WHEN 'tutorial' THEN 'tutorial'
        WHEN 'project' THEN 'seminar'
        ELSE 'lecture'
      END
    );
    v_effective := COALESCE(v_hours, v_pcc.weekly_contact_hours, 0);

    SELECT * INTO v_existing
    FROM public.teaching_assignments ta
    WHERE ta.college_id = v_dg.college_id
      AND ta.delivery_group_id = v_dg_id
      AND ta.instructor_id = v_instructor_id
    ORDER BY ta.is_active DESC, ta.updated_at DESC
    LIMIT 1
    FOR UPDATE;

    IF v_existing.id IS NOT NULL AND v_existing.is_active AND NOT v_is_active THEN
      UPDATE public.teaching_assignments SET is_active = FALSE
      WHERE id = v_existing.id
      RETURNING * INTO v_row;
      INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
      VALUES (
        v_uid, 'teaching_assignment_deactivated', 'teaching_assignments', v_row.id, v_dg.college_id,
        jsonb_build_object(
          'assignment_id', v_row.id,
          'delivery_group_id', v_dg_id,
          'instructor_id', v_instructor_id,
          'import_batch_id', v_batch_id,
          'lifecycle_action', 'deactivated'
        )
      );
      v_updated := v_updated + 1;
      CONTINUE;
    END IF;

    IF NOT v_is_active THEN
      v_unchanged := v_unchanged + 1;
      CONTINUE;
    END IF;

    IF v_existing.id IS NOT NULL AND v_existing.is_active THEN
      IF v_mode = 'insert_only' THEN
        v_unchanged := v_unchanged + 1;
        CONTINUE;
      END IF;
      v_same_hours := v_existing.assigned_component_hours IS NOT DISTINCT FROM v_hours;
      v_same_notes := v_existing.notes IS NOT DISTINCT FROM v_notes;
      IF v_same_hours AND v_same_notes
         AND v_existing.course_offering_id IS NOT DISTINCT FROM v_offering_id THEN
        v_unchanged := v_unchanged + 1;
        CONTINUE;
      END IF;

      PERFORM public.validate_assignment_allocation_locked(
        v_dg_id, v_existing.id, v_hours, v_pcc.weekly_contact_hours, true
      );

      UPDATE public.teaching_assignments SET
        assigned_component_hours = v_hours,
        weekly_hours = v_effective,
        notes = COALESCE(v_notes, notes),
        course_offering_id = v_offering_id,
        expected_students = COALESCE(v_expected_students, expected_students),
        required_room_type = COALESCE(v_required_room_type, required_room_type),
        session_type = v_session_type,
        cohort_id = v_dg.cohort_id,
        plan_course_component_id = v_dg.component_id
      WHERE id = v_existing.id
      RETURNING * INTO v_row;

      INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
      VALUES (
        v_uid, 'teaching_assignment_hours_updated', 'teaching_assignments', v_row.id, v_dg.college_id,
        jsonb_build_object(
          'assignment_id', v_row.id,
          'delivery_group_id', v_dg_id,
          'instructor_id', v_instructor_id,
          'old_assigned_hours', v_existing.assigned_component_hours,
          'new_assigned_hours', v_row.assigned_component_hours,
          'import_batch_id', v_batch_id
        )
      );
      v_updated := v_updated + 1;
      CONTINUE;
    END IF;

    IF v_existing.id IS NOT NULL AND NOT v_existing.is_active THEN
      IF v_mode = 'insert_only' THEN
        v_unchanged := v_unchanged + 1;
        CONTINUE;
      END IF;

      PERFORM public.validate_assignment_allocation_locked(
        v_dg_id, v_existing.id, v_hours, v_pcc.weekly_contact_hours, true
      );

      UPDATE public.teaching_assignments SET
        is_active = TRUE,
        assigned_component_hours = v_hours,
        weekly_hours = v_effective,
        notes = COALESCE(v_notes, notes),
        course_offering_id = v_offering_id,
        cohort_id = v_dg.cohort_id,
        plan_course_component_id = v_dg.component_id,
        session_type = v_session_type,
        expected_students = COALESCE(v_expected_students, v_dg.expected_students, expected_students),
        required_room_type = COALESCE(v_required_room_type, required_room_type)
      WHERE id = v_existing.id
      RETURNING * INTO v_row;

      INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
      VALUES (
        v_uid, 'teaching_assignment_reactivated', 'teaching_assignments', v_row.id, v_dg.college_id,
        jsonb_build_object(
          'assignment_id', v_row.id,
          'delivery_group_id', v_dg_id,
          'instructor_id', v_instructor_id,
          'new_assigned_hours', v_hours,
          'import_batch_id', v_batch_id,
          'lifecycle_action', 'reactivated'
        )
      );
      v_reactivated := v_reactivated + 1;
      CONTINUE;
    END IF;

    -- no existing row
    IF v_mode = 'update_existing' THEN
      v_unchanged := v_unchanged + 1;
      CONTINUE;
    END IF;

    PERFORM public.validate_assignment_allocation_locked(
      v_dg_id, NULL, v_hours, v_pcc.weekly_contact_hours, true
    );

    INSERT INTO public.teaching_assignments (
      college_id, course_offering_id, instructor_id, section_number, session_type,
      weekly_hours, notes, expected_students, required_room_type, cohort_id,
      plan_course_component_id, delivery_group_id, assigned_component_hours, is_active
    ) VALUES (
      v_dg.college_id, v_offering_id, v_instructor_id,
      COALESCE(v_dg.group_code, v_dg.group_number::text), v_session_type,
      v_effective, v_notes, COALESCE(v_expected_students, v_dg.expected_students, 0),
      v_required_room_type, v_dg.cohort_id, v_dg.component_id, v_dg_id, v_hours, TRUE
    )
    RETURNING * INTO v_row;

    INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
    VALUES (
      v_uid, 'teaching_assignment_created', 'teaching_assignments', v_row.id, v_dg.college_id,
      jsonb_build_object(
        'assignment_id', v_row.id,
        'delivery_group_id', v_dg_id,
        'instructor_id', v_instructor_id,
        'new_assigned_hours', v_hours,
        'import_batch_id', v_batch_id,
        'lifecycle_action', 'created'
      )
    );
    v_created := v_created + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'status', 'ok',
    'rows_received', v_rows_received,
    'rows_created', v_created,
    'rows_updated', v_updated,
    'rows_reactivated', v_reactivated,
    'rows_unchanged', v_unchanged,
    'validation_errors', '[]'::jsonb,
    'warnings', v_warnings,
    'import_batch_id', v_batch_id
  );
EXCEPTION WHEN OTHERS THEN
  -- Any mid-apply failure rolls back the whole transaction (atomic)
  RAISE;
END;
$function$;
CREATE OR REPLACE FUNCTION public.list_schedule_builder_v2_work_items(p_schedule_version_id uuid, p_program_id uuid DEFAULT NULL::uuid, p_level_id uuid DEFAULT NULL::uuid, p_cohort_id uuid DEFAULT NULL::uuid, p_study_system text DEFAULT NULL::text, p_component_type text DEFAULT NULL::text, p_instructor_id uuid DEFAULT NULL::uuid, p_scheduling_status text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_version public.schedule_versions%ROWTYPE;
  v_rows jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  IF p_schedule_version_id IS NULL THEN
    RAISE EXCEPTION 'SCHEDULE_VERSION_ID_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_version
  FROM public.schedule_versions
  WHERE id = p_schedule_version_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SCHEDULE_VERSION_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT public.can_view_college(v_uid, v_version.college_id) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(x.row_obj ORDER BY x.course_code, x.component_type, x.group_number, x.instructor_name), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT
      c.code AS course_code,
      pcc.component_type,
      dg.group_number,
      i.full_name AS instructor_name,
      jsonb_build_object(
        'teaching_assignment_id', ta.id,
        'delivery_group_id', dg.id,
        'cohort_id', ac.id,
        'cohort_code', ac.code,
        'program_id', ac.program_id,
        'level_id', ac.level_id,
        'semester_term_id', ac.term_id,
        'study_system', ac.study_system,
        'course_id', c.id,
        'course_code', c.code,
        'course_name', c.name,
        'component_id', pcc.id,
        'component_type', pcc.component_type,
        'group_number', dg.group_number,
        'group_code', dg.group_code,
        'instructor_id', i.id,
        'instructor_name', i.full_name,
        'assigned_component_hours', COALESCE(ta.assigned_component_hours, pcc.weekly_contact_hours, 0),
        'component_hours', pcc.weekly_contact_hours,
        'time_unit', 'component_hours_wallclock_equivalent',
        'currently_scheduled_hours', sched.scheduled_hours,
        'remaining_schedule_hours', GREATEST(
          0,
          COALESCE(ta.assigned_component_hours, pcc.weekly_contact_hours, 0) - sched.scheduled_hours
        ),
        'session_count', sched.session_count,
        'scheduling_status', status.scheduling_status,
        'blocking_reason', status.blocking_reason,
        'can_create_session', status.can_create_session,
        'is_project', (pcc.component_type = 'project' AND COALESCE(pcc.counts_toward_regular_load, true) = false),
        'is_summer_training', (pcc.component_type = 'summer_training'),
        'assignment_active', COALESCE(ta.is_active, true),
        'delivery_group_active', COALESCE(dg.active, true),
        'delivery_group_obsolete', COALESCE(dg.is_obsolete, false),
        'allocation_status', COALESCE(alloc.allocation_json->>'allocation_status', 'unassigned'),
        'course_offering_id', ta.course_offering_id,
        'plan_course_component_id', ta.plan_course_component_id,
        'session_type', ta.session_type,
        'expected_students', COALESCE(ta.expected_students, dg.expected_students, 0),
        'assignment_updated_at', ta.updated_at
      ) AS row_obj
    FROM public.teaching_assignments ta
    JOIN public.delivery_groups dg
      ON dg.id = ta.delivery_group_id
     AND dg.college_id = ta.college_id
    JOIN public.academic_cohorts ac
      ON ac.id = dg.cohort_id
     AND ac.college_id = dg.college_id
    JOIN public.plan_course_components pcc
      ON pcc.id = dg.component_id
     AND pcc.college_id = ta.college_id
    JOIN public.plan_courses pc
      ON pc.id = dg.plan_course_id
     AND pc.college_id = ta.college_id
    JOIN public.courses c
      ON c.id = pc.course_id
     AND c.college_id = ta.college_id
    JOIN public.instructors i
      ON i.id = ta.instructor_id
     AND i.college_id = ta.college_id
    CROSS JOIN LATERAL (
      SELECT public.compute_delivery_group_allocation(dg.id) AS allocation_json
    ) alloc
    CROSS JOIN LATERAL (
      SELECT
        COALESCE(SUM(public._sb_v2_wall_hours(ss.start_time, ss.end_time)), 0) AS scheduled_hours,
        COUNT(*)::integer AS session_count
      FROM public.schedule_sessions ss
      WHERE ss.schedule_version_id = p_schedule_version_id
        AND ss.teaching_assignment_id = ta.id
    ) sched
    CROSS JOIN LATERAL (
      SELECT
        CASE
          WHEN COALESCE(ta.is_active, true) = false THEN 'blocked'
          WHEN COALESCE(dg.active, true) = false THEN 'blocked'
          WHEN COALESCE(dg.is_obsolete, false) THEN 'blocked'
          WHEN pcc.component_type = 'summer_training' THEN 'blocked'
          WHEN pcc.component_type = 'project' AND COALESCE(pcc.counts_toward_regular_load, true) = false THEN 'blocked'
          WHEN sched.scheduled_hours > COALESCE(ta.assigned_component_hours, pcc.weekly_contact_hours, 0) THEN 'over_scheduled'
          WHEN sched.scheduled_hours <= 0 THEN 'unscheduled'
          WHEN sched.scheduled_hours < COALESCE(ta.assigned_component_hours, pcc.weekly_contact_hours, 0) THEN 'partially_scheduled'
          ELSE 'scheduled'
        END AS scheduling_status,
        CASE
          WHEN COALESCE(ta.is_active, true) = false THEN 'INACTIVE_ASSIGNMENT'
          WHEN COALESCE(dg.active, true) = false THEN 'INACTIVE_DELIVERY_GROUP'
          WHEN COALESCE(dg.is_obsolete, false) THEN 'OBSOLETE_DELIVERY_GROUP'
          WHEN pcc.component_type = 'summer_training' THEN 'SUMMER_TRAINING_BLOCKED'
          WHEN pcc.component_type = 'project' AND COALESCE(pcc.counts_toward_regular_load, true) = false THEN 'PROJECT_NON_WEEKLY'
          WHEN sched.scheduled_hours > COALESCE(ta.assigned_component_hours, pcc.weekly_contact_hours, 0) THEN 'OVER_SCHEDULED'
          ELSE NULL
        END AS blocking_reason,
        CASE
          WHEN COALESCE(ta.is_active, true) = false THEN false
          WHEN COALESCE(dg.active, true) = false THEN false
          WHEN COALESCE(dg.is_obsolete, false) THEN false
          WHEN pcc.component_type = 'summer_training' THEN false
          WHEN pcc.component_type = 'project' AND COALESCE(pcc.counts_toward_regular_load, true) = false THEN false
          WHEN sched.scheduled_hours >= COALESCE(ta.assigned_component_hours, pcc.weekly_contact_hours, 0) THEN false
          ELSE true
        END AS can_create_session
    ) status
    WHERE ta.college_id = v_version.college_id
      AND ta.delivery_group_id IS NOT NULL
      AND ac.term_id = v_version.academic_term_id
      AND (p_cohort_id IS NULL OR ac.id = p_cohort_id)
      AND (p_program_id IS NULL OR ac.program_id = p_program_id)
      AND (p_level_id IS NULL OR ac.level_id = p_level_id)
      AND (p_study_system IS NULL OR ac.study_system = p_study_system)
      AND (p_component_type IS NULL OR pcc.component_type = p_component_type)
      AND (p_instructor_id IS NULL OR ta.instructor_id = p_instructor_id)
      AND (
        p_scheduling_status IS NULL
        OR p_scheduling_status = 'all'
        OR status.scheduling_status = p_scheduling_status
      )
  ) x;

  RETURN jsonb_build_object(
    'ok', true,
    'schedule_version_id', p_schedule_version_id,
    'college_id', v_version.college_id,
    'academic_term_id', v_version.academic_term_id,
    'version_status', v_version.status,
    'version_updated_at', v_version.updated_at,
    'time_unit', 'component_hours_wallclock_equivalent',
    'time_unit_note', 'No formal academic-hour→minutes contract; remaining uses assigned_component_hours vs wall-clock session hours.',
    'rows', COALESCE(v_rows, '[]'::jsonb),
    'can_manage', public.can_manage_college(v_uid, v_version.college_id)
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.create_schedule_session_from_assignment_v2(p_schedule_version_id uuid, p_teaching_assignment_id uuid, p_day_of_week integer, p_start_time time without time zone, p_end_time time without time zone, p_room_id uuid, p_expected_version_updated_at timestamp with time zone, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_version public.schedule_versions%ROWTYPE;
  v_ta public.teaching_assignments%ROWTYPE;
  v_dg public.delivery_groups%ROWTYPE;
  v_pcc public.plan_course_components%ROWTYPE;
  v_guard jsonb;
  v_bundle jsonb;
  v_dg_conflicts jsonb;
  v_session public.schedule_sessions%ROWTYPE;
  v_probe_id uuid := gen_random_uuid();
  v_assigned numeric;
  v_scheduled numeric;
  v_proposed numeric;
  v_blocking_len integer;
  v_warning_len integer;
  v_offering_id uuid;
  v_offering_term_id uuid;
  v_cohort_term_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED', 'stale', false,
      'message_ar', 'يجب تسجيل الدخول.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  IF p_schedule_version_id IS NULL OR p_teaching_assignment_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_ARGS', 'stale', false,
      'message_ar', 'معرّف النسخة والتكليف مطلوبان.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  IF p_day_of_week IS NULL OR p_day_of_week < 0 OR p_day_of_week > 6 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_DAY', 'stale', false,
      'message_ar', 'يوم غير صالح.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  IF p_start_time IS NULL OR p_end_time IS NULL OR p_end_time <= p_start_time THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_TIME_RANGE', 'stale', false,
      'message_ar', 'نطاق الوقت غير صالح.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  IF p_room_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ROOM_REQUIRED', 'stale', false,
      'message_ar', 'القاعة مطلوبة.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  SELECT * INTO v_version
  FROM public.schedule_versions
  WHERE id = p_schedule_version_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'stale', false,
      'message_ar', 'نسخة الجدول غير موجودة.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  IF NOT public.can_manage_college(v_uid, v_version.college_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN_COLLEGE', 'stale', false,
      'message_ar', 'لا تملك صلاحية إدارة هذه الكلية.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  IF v_version.status IS DISTINCT FROM 'draft' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', CASE
        WHEN v_version.status = 'published' THEN 'VERSION_PUBLISHED'
        WHEN v_version.status = 'archived' THEN 'VERSION_ARCHIVED'
        ELSE 'VERSION_LOCKED'
      END,
      'stale', false,
      'message_ar', 'الإنشاء اليدوي مسموح لنسخ المسودة فقط.',
      'blocking_conflicts', '[]'::jsonb,
      'warnings', '[]'::jsonb
    );
  END IF;

  IF p_expected_version_updated_at IS NULL
     OR v_version.updated_at IS DISTINCT FROM p_expected_version_updated_at THEN
    RETURN jsonb_build_object('ok', false, 'code', 'STALE_VERSION', 'stale', true,
      'message_ar', 'تغيّرت نسخة الجدول. أعد التحميل ثم حاول مجددًا.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  SELECT * INTO v_ta
  FROM public.teaching_assignments
  WHERE id = p_teaching_assignment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ASSIGNMENT_NOT_FOUND', 'stale', false,
      'message_ar', 'التكليف غير موجود.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  IF v_ta.college_id <> v_version.college_id THEN
    RETURN jsonb_build_object('ok', false, 'code', 'CROSS_COLLEGE_FORBIDDEN', 'stale', false,
      'message_ar', 'التكليف لا ينتمي لنفس كلية النسخة.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  IF v_ta.delivery_group_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_V2_ASSIGNMENT', 'stale', false,
      'message_ar', 'هذا المسار مخصص لتكليفات V2 المرتبطة بمجموعة تدريس.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  v_guard := public._sb_v2_assignment_guard(v_ta.id);
  IF COALESCE((v_guard->>'ok')::boolean, false) = false THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', COALESCE(v_guard->>'code', 'ASSIGNMENT_BLOCKED'),
      'stale', false,
      'message_ar', 'التكليف غير قابل للجدولة حاليًا.',
      'blocking_conflicts', '[]'::jsonb,
      'warnings', '[]'::jsonb,
      'guard', v_guard
    );
  END IF;

  SELECT * INTO v_dg
  FROM public.delivery_groups
  WHERE id = v_ta.delivery_group_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'DELIVERY_GROUP_NOT_FOUND', 'stale', false,
      'message_ar', 'مجموعة التدريس غير موجودة.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  SELECT * INTO v_pcc FROM public.plan_course_components WHERE id = v_dg.component_id;

  v_offering_id := public.resolve_offering_for_delivery_group(v_dg.id);
  IF v_offering_id IS NULL OR v_offering_id IS DISTINCT FROM v_ta.course_offering_id THEN
    RETURN jsonb_build_object('ok', false, 'code', 'OFFERING_COMPATIBILITY', 'stale', false,
      'message_ar', 'عرض المقرر غير متوافق مع مجموعة التدريس.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  SELECT co.term_id INTO v_offering_term_id
  FROM public.course_offerings co
  WHERE co.id = v_offering_id
    AND co.college_id = v_version.college_id;

  SELECT ac.term_id INTO v_cohort_term_id
  FROM public.academic_cohorts ac
  WHERE ac.id = v_dg.cohort_id
    AND ac.college_id = v_version.college_id;

  IF v_offering_term_id IS DISTINCT FROM v_version.academic_term_id
     OR v_cohort_term_id IS DISTINCT FROM v_version.academic_term_id THEN
    RETURN jsonb_build_object('ok', false, 'code', 'CROSS_TERM_FORBIDDEN', 'stale', false,
      'message_ar', 'التكليف لا ينتمي إلى الفصل الأكاديمي لنسخة الجدول.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  IF v_ta.instructor_id IS NULL
     OR v_ta.cohort_id IS DISTINCT FROM v_dg.cohort_id
     OR v_ta.plan_course_component_id IS DISTINCT FROM v_dg.component_id THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ASSIGNMENT_IDENTITY_MISMATCH', 'stale', false,
      'message_ar', 'عدم تطابق بيانات التكليف مع مجموعة التدريس.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  v_assigned := COALESCE(v_ta.assigned_component_hours, v_pcc.weekly_contact_hours, 0);
  v_proposed := public._sb_v2_wall_hours(p_start_time, p_end_time);
  v_scheduled := public._sb_v2_scheduled_hours_for_assignment(
    p_schedule_version_id, v_ta.id, NULL
  );

  IF v_scheduled + v_proposed > v_assigned THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'OVER_SCHEDULED',
      'stale', false,
      'message_ar', 'تجاوز الساعات المكلف بها لهذا المدرس.',
      'blocking_conflicts', jsonb_build_array(jsonb_build_object(
        'code', 'over_scheduled',
        'severity', 'hard',
        'message_ar', 'تجاوز الساعات المكلف بها.',
        'metadata', jsonb_build_object(
          'assigned_component_hours', v_assigned,
          'currently_scheduled_hours', v_scheduled,
          'proposed_hours', v_proposed
        )
      )),
      'warnings', '[]'::jsonb
    );
  END IF;

  v_bundle := public._collect_schedule_session_move_conflicts(
    v_probe_id,
    v_version.college_id,
    p_schedule_version_id,
    v_ta.instructor_id,
    v_ta.section_id,
    v_ta.course_offering_id,
    v_ta.id,
    COALESCE(
      (SELECT ac.study_system FROM public.academic_cohorts ac WHERE ac.id = v_dg.cohort_id),
      'regular'
    ),
    COALESCE(v_ta.expected_students, v_dg.expected_students, 0),
    p_day_of_week,
    p_start_time,
    p_end_time,
    p_room_id
  );

  v_dg_conflicts := public._sb_v2_delivery_group_overlap(
    p_schedule_version_id,
    v_dg.id,
    v_dg.cohort_id,
    p_day_of_week,
    p_start_time,
    p_end_time,
    NULL
  );

  IF jsonb_array_length(v_dg_conflicts) > 0 THEN
    v_bundle := jsonb_set(
      v_bundle,
      '{blocking_conflicts}',
      COALESCE(v_bundle->'blocking_conflicts', '[]'::jsonb) || v_dg_conflicts
    );
  END IF;

  v_blocking_len := jsonb_array_length(COALESCE(v_bundle->'blocking_conflicts', '[]'::jsonb));
  v_warning_len := jsonb_array_length(COALESCE(v_bundle->'warnings', '[]'::jsonb));

  IF v_blocking_len > 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'BLOCKED_CONFLICTS',
      'stale', false,
      'message_ar', 'توجد تعارضات مانعة.',
      'blocking_conflicts', v_bundle->'blocking_conflicts',
      'warnings', v_bundle->'warnings',
      'approved_exceptions', v_bundle->'approved_exceptions'
    );
  END IF;

  IF v_warning_len > 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'BLOCKED_WARNINGS',
      'stale', false,
      'message_ar', 'توجد تحذيرات غير محلولة. الحفظ غير مسموح حاليًا.',
      'blocking_conflicts', v_bundle->'blocking_conflicts',
      'warnings', v_bundle->'warnings',
      'approved_exceptions', v_bundle->'approved_exceptions'
    );
  END IF;

  INSERT INTO public.schedule_sessions (
    college_id,
    schedule_version_id,
    course_offering_id,
    teaching_assignment_id,
    delivery_group_id,
    cohort_id,
    plan_course_component_id,
    instructor_id,
    section_id,
    room_id,
    day_of_week,
    start_time,
    end_time,
    session_type,
    study_system,
    expected_students,
    source_type
  ) VALUES (
    v_version.college_id,
    p_schedule_version_id,
    v_ta.course_offering_id,
    v_ta.id,
    v_dg.id,
    v_dg.cohort_id,
    v_dg.component_id,
    v_ta.instructor_id,
    v_ta.section_id,
    p_room_id,
    p_day_of_week,
    p_start_time,
    p_end_time,
    COALESCE(v_ta.session_type, 'lecture'),
    COALESCE(
      (SELECT ac.study_system FROM public.academic_cohorts ac WHERE ac.id = v_dg.cohort_id),
      'regular'
    ),
    COALESCE(v_ta.expected_students, v_dg.expected_students, 0),
    'manual'
  )
  RETURNING * INTO v_session;

  UPDATE public.schedule_versions
  SET updated_at = now()
  WHERE id = p_schedule_version_id
  RETURNING * INTO v_version;

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (
    v_uid,
    'schedule_session_created_from_assignment',
    'schedule_sessions',
    v_session.id,
    v_version.college_id,
    jsonb_build_object(
      'schedule_session_id', v_session.id,
      'schedule_version_id', p_schedule_version_id,
      'teaching_assignment_id', v_ta.id,
      'delivery_group_id', v_dg.id,
      'instructor_id', v_ta.instructor_id,
      'room_id', p_room_id,
      'day_of_week', p_day_of_week,
      'start_time', p_start_time,
      'end_time', p_end_time,
      'note', NULLIF(btrim(COALESCE(p_note, '')), ''),
      'proposed_hours', v_proposed,
      'assigned_component_hours', v_assigned
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'code', 'CREATED',
    'stale', false,
    'session', jsonb_build_object(
      'id', v_session.id,
      'day_of_week', v_session.day_of_week,
      'start_time', v_session.start_time,
      'end_time', v_session.end_time,
      'room_id', v_session.room_id,
      'teaching_assignment_id', v_session.teaching_assignment_id,
      'delivery_group_id', v_session.delivery_group_id,
      'updated_at', v_session.updated_at
    ),
    'schedule_version_updated_at', v_version.updated_at,
    'scheduling_summary', jsonb_build_object(
      'assigned_component_hours', v_assigned,
      'currently_scheduled_hours', v_scheduled + v_proposed,
      'remaining_schedule_hours', GREATEST(0, v_assigned - (v_scheduled + v_proposed)),
      'session_count', (
        SELECT COUNT(*)::integer FROM public.schedule_sessions ss
        WHERE ss.schedule_version_id = p_schedule_version_id
          AND ss.teaching_assignment_id = v_ta.id
      )
    ),
    'blocking_conflicts', '[]'::jsonb,
    'warnings', '[]'::jsonb
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.delivery_groups_share_students(p_a uuid, p_b uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a_cohort uuid; b_cohort uuid;
  a_expected integer; b_expected integer;
  a_count integer; b_count integer;
  a_cover integer; b_cover integer;
  v_shared integer;
BEGIN
  IF auth.uid() IS NULL THEN RETURN true; END IF;
  IF p_a IS NULL OR p_b IS NULL THEN RETURN true; END IF;
  IF p_a = p_b THEN RETURN true; END IF;

  SELECT cohort_id, expected_students INTO a_cohort, a_expected
  FROM public.delivery_groups WHERE id = p_a AND active AND NOT coalesce(is_obsolete,false) AND public.can_view_college(auth.uid(),college_id);
  SELECT cohort_id, expected_students INTO b_cohort, b_expected
  FROM public.delivery_groups WHERE id = p_b AND active AND NOT coalesce(is_obsolete,false) AND public.can_view_college(auth.uid(),college_id);
  IF a_cohort IS NULL OR b_cohort IS NULL THEN RETURN true; END IF;
  IF a_cohort IS DISTINCT FROM b_cohort THEN RETURN false; END IF;

  SELECT count(*), COALESCE(sum(p.headcount), 0) INTO a_count, a_cover
  FROM public.delivery_group_partition_members m
  JOIN public.cohort_student_partitions p ON p.id = m.partition_id AND p.active
  WHERE m.delivery_group_id = p_a AND m.cohort_id = a_cohort AND p.cohort_id = a_cohort;

  SELECT count(*), COALESCE(sum(p.headcount), 0) INTO b_count, b_cover
  FROM public.delivery_group_partition_members m
  JOIN public.cohort_student_partitions p ON p.id = m.partition_id AND p.active
  WHERE m.delivery_group_id = p_b AND m.cohort_id = b_cohort AND p.cohort_id = b_cohort;

  -- unmapped or incomplete coverage → conservative conflict
  IF a_count = 0 OR b_count = 0 THEN RETURN true; END IF;
  IF coalesce(a_expected,0)<=0 OR coalesce(b_expected,0)<=0 OR a_cover <> a_expected OR b_cover <> b_expected THEN
    RETURN true;
  END IF;

  SELECT count(*) INTO v_shared
  FROM public.delivery_group_partition_members ma
  JOIN public.delivery_group_partition_members mb
    ON mb.partition_id = ma.partition_id
  WHERE ma.delivery_group_id = p_a AND mb.delivery_group_id = p_b;

  RETURN v_shared > 0;
END;
$function$;
CREATE OR REPLACE FUNCTION public._ss_ci(c text, s text, sid uuid, rid uuid, m jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public'
AS $function$
SELECT jsonb_build_object('code',c,'severity',s,'schedule_session_id',sid,'related_session_id',rid,'metadata',COALESCE(m,'{}'::jsonb));
$function$;
CREATE OR REPLACE FUNCTION public._ss_ov(a time without time zone, b time without time zone, c time without time zone, d time without time zone)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public'
AS $function$
SELECT a < d AND c < b;
$function$;
CREATE OR REPLACE FUNCTION public.deactivate_teaching_assignment_v2(p_assignment_id uuid, p_expected_updated_at timestamp with time zone, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.teaching_assignments%ROWTYPE;
  v_pcc_type text;
  v_old_hours numeric;
  v_dg_id uuid;
  v_college_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  IF p_assignment_id IS NULL OR p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'ASSIGNMENT_ID_AND_EXPECTED_UPDATED_AT_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;

  SELECT ta.delivery_group_id, ta.college_id
    INTO v_dg_id, v_college_id
  FROM public.teaching_assignments ta
  WHERE ta.id = p_assignment_id;
  IF v_college_id IS NULL THEN
    RAISE EXCEPTION 'ASSIGNMENT_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT public.can_manage_college(v_uid, v_college_id) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  IF v_dg_id IS NULL THEN
    RAISE EXCEPTION 'LEGACY_ASSIGNMENT_NOT_SUPPORTED_BY_V2_RPC' USING ERRCODE = 'check_violation';
  END IF;

  -- Lock group even for deactivate (consistent order); assignable not required
  PERFORM public.lock_delivery_group_for_assignment(v_dg_id);

  SELECT * INTO v_row
  FROM public.teaching_assignments
  WHERE id = p_assignment_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ASSIGNMENT_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_row.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'STALE_ASSIGNMENT_UPDATE' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT v_row.is_active THEN
    RETURN jsonb_build_object(
      'ok', true,
      'action', 'already_inactive',
      'assignment_id', v_row.id,
      'is_active', false,
      'updated_at', v_row.updated_at
    );
  END IF;

  v_old_hours := v_row.assigned_component_hours;
  SELECT pcc.component_type INTO v_pcc_type
  FROM public.plan_course_components pcc
  WHERE pcc.id = v_row.plan_course_component_id;

  UPDATE public.teaching_assignments SET
    is_active = FALSE,
    notes = CASE
      WHEN p_reason IS NULL OR btrim(p_reason) = '' THEN notes
      WHEN notes IS NULL OR btrim(notes) = '' THEN 'deactivate: ' || btrim(p_reason)
      ELSE notes
    END
  WHERE id = p_assignment_id
  RETURNING * INTO v_row;

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (
    v_uid,
    'teaching_assignment_deactivated',
    'teaching_assignments',
    v_row.id,
    v_row.college_id,
    jsonb_build_object(
      'assignment_id', v_row.id,
      'delivery_group_id', v_row.delivery_group_id,
      'instructor_id', v_row.instructor_id,
      'component_type', v_pcc_type,
      'old_assigned_hours', v_old_hours,
      'new_assigned_hours', v_old_hours,
      'reason', p_reason
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'action', 'deactivated',
    'assignment_id', v_row.id,
    'is_active', false,
    'updated_at', v_row.updated_at,
    'allocation', public.compute_delivery_group_allocation(v_row.delivery_group_id)
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.ensure_csp_cohort_college()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_college uuid;
BEGIN
  SELECT college_id INTO v_college FROM public.academic_cohorts WHERE id = NEW.cohort_id;
  IF v_college IS NULL THEN
    RAISE EXCEPTION 'COHORT_NOT_FOUND: الدفعة غير موجودة.';
  END IF;
  IF NEW.college_id IS DISTINCT FROM v_college THEN
    RAISE EXCEPTION 'CROSS_COLLEGE_FORBIDDEN: الشُعبة لا تنتمي لكلية الدفعة.';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.ensure_dgpm_consistency()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_dg public.delivery_groups%ROWTYPE;
  v_p public.cohort_student_partitions%ROWTYPE;
BEGIN
  SELECT * INTO v_dg FROM public.delivery_groups WHERE id = NEW.delivery_group_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DELIVERY_GROUP_NOT_FOUND: مجموعة التقديم غير موجودة.';
  END IF;
  SELECT * INTO v_p FROM public.cohort_student_partitions WHERE id = NEW.partition_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PARTITION_NOT_FOUND: شُعبة الطلاب غير موجودة.';
  END IF;
  IF v_dg.cohort_id IS DISTINCT FROM v_p.cohort_id
     OR NEW.cohort_id IS DISTINCT FROM v_dg.cohort_id THEN
    RAISE EXCEPTION 'COHORT_MISMATCH: مجموعة التقديم وشُعبة الطلاب من دفعتين مختلفتين.';
  END IF;
  IF v_dg.college_id IS DISTINCT FROM v_p.college_id
     OR NEW.college_id IS DISTINCT FROM v_dg.college_id THEN
    RAISE EXCEPTION 'CROSS_COLLEGE_FORBIDDEN: الربط يتجاوز حدود الكلية.';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public._ss_sg(p_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
SELECT section_subgroup_id FROM public.schedule_sessions WHERE id=p_id;
$function$;
CREATE OR REPLACE FUNCTION public._sb_v2_delivery_group_overlap(p_schedule_version_id uuid, p_delivery_group_id uuid, p_cohort_id uuid, p_day_of_week integer, p_start_time time without time zone, p_end_time time without time zone, p_exclude_session_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_peer record;
  v_conflicts jsonb := '[]'::jsonb;
  v_shared boolean;
BEGIN
  IF p_delivery_group_id IS NULL AND p_cohort_id IS NULL THEN
    RETURN v_conflicts;
  END IF;

  FOR v_peer IN
    SELECT ss.id, ss.delivery_group_id, ss.cohort_id
    FROM public.schedule_sessions ss
    WHERE ss.schedule_version_id = p_schedule_version_id
      AND ss.day_of_week = p_day_of_week
      AND ss.start_time < p_end_time
      AND p_start_time < ss.end_time
      AND (p_exclude_session_id IS NULL OR ss.id <> p_exclude_session_id)
      AND (
        (p_delivery_group_id IS NOT NULL AND ss.delivery_group_id = p_delivery_group_id)
        OR (p_cohort_id IS NOT NULL AND ss.cohort_id = p_cohort_id)
      )
  LOOP
    v_shared := true;
    IF p_delivery_group_id IS NOT NULL
       AND v_peer.delivery_group_id IS NOT NULL
       AND v_peer.delivery_group_id <> p_delivery_group_id THEN
      v_shared := public.delivery_groups_share_students(
        p_delivery_group_id, v_peer.delivery_group_id
      );
    END IF;

    IF v_shared THEN
      v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
        'code', 'delivery_group_conflict',
        'severity', 'hard',
        'message_ar', 'تعارض مجموعة التدريس / الدفعة: توجد جلسة متداخلة لنفس المجموعة أو لطلاب مشتركين.',
        'message_en', 'Delivery group / cohort conflict: overlapping session sharing students.',
        'related_session_id', v_peer.id,
        'metadata', jsonb_build_object(
          'delivery_group_id', v_peer.delivery_group_id,
          'cohort_id', v_peer.cohort_id,
          'shared_students', true
        )
      ));
    END IF;
  END LOOP;

  RETURN v_conflicts;
END;
$function$;
CREATE OR REPLACE FUNCTION public._ss_enroll(p_off uuid, p_exp integer, OUT n integer, OUT st text)
 RETURNS record
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  SELECT COALESCE(expected_students,0), COALESCE(enrollment_count_status,'unverified')
    INTO n,st FROM public.course_offerings WHERE id=p_off;
  IF COALESCE(p_exp,0)>0 THEN n:=p_exp; END IF;
  n:=COALESCE(n,0); st:=COALESCE(st,'unverified');
END;$function$;
CREATE OR REPLACE FUNCTION public._ss_cap(sid uuid, st text, n integer, cap integer)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public'
AS $function$
SELECT CASE
 WHEN n>0 AND cap+5<n AND st='confirmed' THEN
  public._ss_ci('room_capacity','hard',sid,NULL,jsonb_build_object('capacity',cap,'expected_students',n,'enrollment_count_status',st))
 WHEN n>0 AND cap+5<n AND st IN ('estimated','unverified','test') THEN
  public._ss_ci('room_capacity_unverified','soft',sid,NULL,jsonb_build_object('capacity',cap,'expected_students',n,'enrollment_count_status',st,'blocking',false))
 ELSE NULL END;
$function$;
CREATE OR REPLACE FUNCTION public.apply_schedule_compaction(p_college_id uuid, p_version_id uuid, p_operation_id uuid, p_expected_revision bigint, p_expected_version_updated_at timestamp with time zone, p_moves jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_version public.schedule_versions%ROWTYPE;
  v_session public.schedule_sessions%ROWTYPE;
  v_receipt public.schedule_compaction_receipts%ROWTYPE;
  v_move jsonb;
  v_result jsonb;
  v_hash text;
  v_id uuid;
  v_days_before jsonb;
  v_index integer := 0;
  v_count integer;
  v_term record;
  v_closure record;
  v_first_date date;
  v_last_date date;
BEGIN
  IF v_uid IS NULL OR NOT public.can_manage_college(v_uid, p_college_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'applied', 0);
  END IF;
  IF p_operation_id IS NULL OR p_version_id IS NULL OR p_college_id IS NULL
     OR p_expected_revision IS NULL OR p_expected_revision < 0
     OR p_expected_version_updated_at IS NULL
     OR jsonb_typeof(p_moves) IS DISTINCT FROM 'array' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_REQUEST', 'applied', 0);
  END IF;
  v_count := jsonb_array_length(p_moves);
  IF v_count < 1 OR v_count > 512 OR octet_length(p_moves::text) > 1048576 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_BATCH_SIZE', 'applied', 0);
  END IF;
  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'college', p_college_id, 'version', p_version_id, 'revision', p_expected_revision,
    'updated_at', p_expected_version_updated_at, 'moves', p_moves
  )::text, 'UTF8')), 'hex');

  -- Existing writers can acquire a session/assignment before the version lock.
  -- Every potentially inverted lock here is nonblocking: reject instead of deadlocking.
  IF NOT pg_try_advisory_xact_lock(hashtextextended(p_version_id::text, 9174)) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'VERSION_BUSY', 'applied', 0);
  END IF;
  SELECT * INTO v_version FROM public.schedule_versions
  WHERE id = p_version_id AND college_id = p_college_id FOR UPDATE NOWAIT;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'VERSION_NOT_FOUND', 'applied', 0);
  END IF;

  -- Check the receipt before staleness/status: a successful retry must not run twice.
  SELECT * INTO v_receipt FROM public.schedule_compaction_receipts
  WHERE operation_id = p_operation_id;
  IF FOUND THEN
    IF v_receipt.college_id = p_college_id AND v_receipt.schedule_version_id = p_version_id
       AND v_receipt.actor_id = v_uid AND v_receipt.request_hash = v_hash THEN
      RETURN v_receipt.result;
    END IF;
    RETURN jsonb_build_object('ok', false, 'code', 'OPERATION_ID_CONFLICT', 'applied', 0);
  END IF;
  IF v_version.status IS DISTINCT FROM 'draft' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'VERSION_LOCKED', 'applied', 0);
  END IF;
  IF v_version.eligibility_revision IS DISTINCT FROM p_expected_revision
     OR v_version.updated_at IS DISTINCT FROM p_expected_version_updated_at THEN
    RETURN jsonb_build_object('ok', false, 'code', 'STALE_SNAPSHOT', 'applied', 0);
  END IF;
  SELECT start_date,end_date INTO v_term FROM public.academic_terms
  WHERE id = v_version.academic_term_id AND college_id = p_college_id;

  -- Lock all affected sessions and assignments in a stable order before any mutation.
  FOR v_id IN SELECT DISTINCT (m->>'id')::uuid FROM jsonb_array_elements(p_moves) m
    ORDER BY 1 LOOP
    SELECT * INTO v_session FROM public.schedule_sessions
    WHERE id = v_id AND college_id = p_college_id AND schedule_version_id = p_version_id
    FOR UPDATE NOWAIT;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'code', 'SESSION_SCOPE_MISMATCH', 'applied', 0);
    END IF;
    IF COALESCE(v_session.is_locked, false) OR COALESCE(v_session.replaced_by_split, false) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'SESSION_LOCKED', 'applied', 0);
    END IF;
  END LOOP;
  FOR v_id IN SELECT DISTINCT s.teaching_assignment_id FROM public.schedule_sessions s
    WHERE s.id IN (SELECT (m->>'id')::uuid FROM jsonb_array_elements(p_moves) m)
      AND s.teaching_assignment_id IS NOT NULL ORDER BY 1 LOOP
    PERFORM 1 FROM public.teaching_assignments WHERE id = v_id FOR UPDATE NOWAIT;
  END LOOP;

  -- Every occurrence carries the timestamp from the original preview, even repeated moves.
  FOR v_move IN SELECT value FROM jsonb_array_elements(p_moves) LOOP
    SELECT * INTO v_session FROM public.schedule_sessions WHERE id = (v_move->>'id')::uuid;
    IF jsonb_typeof(v_move) IS DISTINCT FROM 'object'
       OR v_move->>'expected_updated_at' IS NULL
       OR v_session.updated_at IS DISTINCT FROM (v_move->>'expected_updated_at')::timestamptz THEN
      RETURN jsonb_build_object('ok', false, 'code', 'STALE_SESSION', 'applied', 0);
    END IF;
    IF v_move->>'start_time' IS NULL OR v_move->>'end_time' IS NULL
       OR v_move->>'room_id' IS NULL OR v_move->>'day_of_week' IS NULL
       OR (v_move->>'end_time')::time - (v_move->>'start_time')::time
          IS DISTINCT FROM v_session.end_time - v_session.start_time THEN
      RETURN jsonb_build_object('ok', false, 'code', 'DURATION_OR_TARGET_INVALID', 'applied', 0);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.rooms r
      WHERE r.id = (v_move->>'room_id')::uuid AND r.college_id = p_college_id AND r.is_active) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'ROOM_SCOPE_MISMATCH', 'applied', 0);
    END IF;
    -- The legacy move collector does not inspect room_unavailability. Validate both
    -- weekly and date-bounded closures here before the ordered transaction starts.
    FOR v_closure IN SELECT * FROM public.room_unavailability ru
      WHERE ru.college_id = p_college_id AND ru.room_id = (v_move->>'room_id')::uuid
        AND (ru.day_of_week IS NULL OR ru.day_of_week = (v_move->>'day_of_week')::integer)
        AND COALESCE(ru.start_time,'00:00'::time) < (v_move->>'end_time')::time
        AND COALESCE(ru.end_time,'24:00'::time) > (v_move->>'start_time')::time
    LOOP
      IF v_closure.start_date IS NULL AND v_closure.end_date IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ROOM_CLOSED', 'applied', 0);
      END IF;
      IF v_term.start_date IS NULL OR v_term.end_date IS NULL OR v_term.end_date < v_term.start_date THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ROOM_CLOSURE_REQUIRES_TERM_DATES', 'applied', 0);
      END IF;
      v_first_date := greatest(v_term.start_date,COALESCE(v_closure.start_date,v_term.start_date));
      v_last_date := least(v_term.end_date,COALESCE(v_closure.end_date,v_term.end_date));
      IF v_first_date + (((v_move->>'day_of_week')::integer - extract(dow FROM v_first_date)::integer + 7) % 7)
         <= v_last_date THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ROOM_CLOSED', 'applied', 0);
      END IF;
    END LOOP;
  END LOOP;

  SELECT COALESCE(jsonb_object_agg(d.level_key, d.days), '{}'::jsonb) INTO v_days_before
  FROM (
    SELECT jsonb_build_array(c.program_id,c.level_id,c.study_system,c.term_id)::text AS level_key,
      count(DISTINCT s.day_of_week) AS days
    FROM public.schedule_sessions s JOIN public.academic_cohorts c ON c.id = s.cohort_id
    WHERE s.schedule_version_id = p_version_id AND s.college_id = p_college_id
      AND NOT COALESCE(s.replaced_by_split, false)
    GROUP BY c.program_id,c.level_id,c.study_system,c.term_id
  ) d;

  FOR v_move IN SELECT value FROM jsonb_array_elements(p_moves) LOOP
    v_index := v_index + 1;
    SELECT * INTO v_session FROM public.schedule_sessions WHERE id = (v_move->>'id')::uuid;
    v_result := public.move_or_reschedule_schedule_session(
      v_session.id, v_session.updated_at, (v_move->>'day_of_week')::integer,
      (v_move->>'start_time')::time, (v_move->>'end_time')::time, (v_move->>'room_id')::uuid,
      'تحسين ذري لتتابع الطلاب والمدرسين'
    );
    IF COALESCE((v_result->>'ok')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'COMPACTION_MOVE_REJECTED' USING ERRCODE = 'P7501';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.schedule_sessions s JOIN public.academic_cohorts c ON c.id = s.cohort_id
      WHERE s.schedule_version_id = p_version_id AND s.college_id = p_college_id
        AND NOT COALESCE(s.replaced_by_split, false)
      GROUP BY c.program_id,c.level_id,c.study_system,c.term_id
      HAVING count(DISTINCT s.day_of_week) > greatest(5, COALESCE((v_days_before->>
        jsonb_build_array(c.program_id,c.level_id,c.study_system,c.term_id)::text)::integer, 0))
    ) THEN
      v_result := jsonb_build_object('code', 'ATTENDANCE_DAY_LIMIT');
      RAISE EXCEPTION 'COMPACTION_MOVE_REJECTED' USING ERRCODE = 'P7501';
    END IF;
  END LOOP;

  v_result := jsonb_build_object('ok', true, 'code', 'SAVED', 'applied', v_count,
    'operation_id', p_operation_id);
  INSERT INTO public.schedule_compaction_receipts
    (operation_id,college_id,schedule_version_id,actor_id,request_hash,result)
  VALUES (p_operation_id,p_college_id,p_version_id,v_uid,v_hash,v_result);
  INSERT INTO public.audit_logs(actor_id,action,entity,entity_id,college_id,details)
  VALUES (v_uid,'atomic_compaction','schedule_versions',p_version_id,p_college_id,
    jsonb_build_object('operation_id',p_operation_id,'moves',v_count,'request_hash',v_hash));
  RETURN v_result;
EXCEPTION
  -- This handler covers the entire write block. PostgreSQL rolls back moves, revision
  -- increments, per-move audits and the receipt before returning applied=0.
  WHEN SQLSTATE 'P7501' THEN
    RETURN jsonb_build_object('ok', false, 'code', COALESCE(v_result->>'code','MOVE_REJECTED'),
      'applied', 0, 'failed_move', v_index);
  WHEN lock_not_available OR deadlock_detected OR serialization_failure THEN
    RETURN jsonb_build_object('ok', false, 'code', 'VERSION_BUSY', 'applied', 0);
  WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_REQUEST', 'applied', 0);
  WHEN OTHERS THEN
    -- Do not expose table names, identifiers from other tenants, or raw SQL errors.
    RETURN jsonb_build_object('ok', false, 'code', 'BATCH_FAILED', 'applied', 0);
END;
$function$;
CREATE OR REPLACE FUNCTION public.move_or_reschedule_schedule_session(p_session_id uuid, p_expected_updated_at timestamp with time zone, p_target_day_of_week integer, p_target_start_time time without time zone, p_target_end_time time without time zone, p_target_room_id uuid, p_change_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_session public.schedule_sessions%ROWTYPE;
  v_version_status text;
  v_bundle jsonb;
  v_guard jsonb;
  v_dg_conflicts jsonb;
  v_before jsonb;
  v_after jsonb;
  v_blocking_len integer;
  v_warning_len integer;
  v_assigned numeric;
  v_scheduled numeric;
  v_proposed numeric;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED', 'stale', false,
      'message_ar', 'يجب تسجيل الدخول.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  IF p_target_day_of_week IS NULL OR p_target_day_of_week < 0 OR p_target_day_of_week > 6 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_DAY', 'stale', false,
      'message_ar', 'يوم غير صالح.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  IF p_target_start_time IS NULL OR p_target_end_time IS NULL OR p_target_end_time <= p_target_start_time THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_TIME_RANGE', 'stale', false,
      'message_ar', 'نطاق الوقت غير صالح.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  SELECT * INTO v_session
  FROM public.schedule_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'stale', false,
      'message_ar', 'الجلسة غير موجودة.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  IF NOT public.can_manage_college(v_uid, v_session.college_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN_COLLEGE', 'stale', false,
      'message_ar', 'لا تملك صلاحية إدارة هذه الكلية.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  SELECT status INTO v_version_status
  FROM public.schedule_versions
  WHERE id = v_session.schedule_version_id
  FOR UPDATE;

  IF v_version_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'stale', false,
      'message_ar', 'نسخة الجدول غير موجودة.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  IF v_version_status IN ('published', 'archived') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'VERSION_LOCKED', 'stale', false,
      'message_ar', 'هذه النسخة غير قابلة للتعديل.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  IF COALESCE(v_session.is_locked, false) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'SESSION_LOCKED', 'stale', false,
      'message_ar', 'هذه الجلسة مقفلة.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  IF p_expected_updated_at IS NULL OR v_session.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('ok', false, 'code', 'STALE_SESSION', 'stale', true,
      'message_ar', 'تغيّرت الجلسة من تحميلها. أعد التحميل ثم حاول مجددًا.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  IF v_session.day_of_week = p_target_day_of_week
     AND v_session.start_time = p_target_start_time
     AND v_session.end_time = p_target_end_time
     AND v_session.room_id IS NOT DISTINCT FROM p_target_room_id
  THEN
    RETURN jsonb_build_object(
      'ok', true,
      'code', 'NOOP',
      'stale', false,
      'session', jsonb_build_object(
        'id', v_session.id,
        'day_of_week', v_session.day_of_week,
        'start_time', v_session.start_time,
        'end_time', v_session.end_time,
        'room_id', v_session.room_id,
        'updated_at', v_session.updated_at
      ),
      'blocking_conflicts', '[]'::jsonb,
      'warnings', '[]'::jsonb
    );
  END IF;

  IF v_session.teaching_assignment_id IS NOT NULL THEN
    PERFORM 1 FROM public.teaching_assignments
      WHERE id = v_session.teaching_assignment_id FOR UPDATE;

    v_guard := public._sb_v2_assignment_guard(v_session.teaching_assignment_id);
    IF COALESCE((v_guard->>'is_v2')::boolean, false)
       AND COALESCE((v_guard->>'ok')::boolean, false) = false THEN
      RETURN jsonb_build_object(
        'ok', false,
        'code', COALESCE(v_guard->>'code', 'ASSIGNMENT_BLOCKED'),
        'stale', false,
        'message_ar', 'تكليف V2 غير نشط أو محظور؛ لا يمكن تحريك الجلسة.',
        'blocking_conflicts', '[]'::jsonb,
        'warnings', '[]'::jsonb
      );
    END IF;

    IF COALESCE((v_guard->>'is_v2')::boolean, false) THEN
      SELECT COALESCE(ta.assigned_component_hours, pcc.weekly_contact_hours, 0)
        INTO v_assigned
      FROM public.teaching_assignments ta
      LEFT JOIN public.plan_course_components pcc ON pcc.id = ta.plan_course_component_id
      WHERE ta.id = v_session.teaching_assignment_id;
      v_proposed := public._sb_v2_wall_hours(p_target_start_time, p_target_end_time);
      v_scheduled := public._sb_v2_scheduled_hours_for_assignment(
        v_session.schedule_version_id, v_session.teaching_assignment_id, v_session.id
      );
      IF v_scheduled + v_proposed > v_assigned THEN
        RETURN jsonb_build_object(
          'ok', false,
          'code', 'OVER_SCHEDULED',
          'stale', false,
          'message_ar', 'تجاوز الساعات المكلف بها.',
          'blocking_conflicts', jsonb_build_array(jsonb_build_object(
            'code', 'over_scheduled', 'severity', 'hard',
            'message_ar', 'تجاوز الساعات المكلف بها.'
          )),
          'warnings', '[]'::jsonb
        );
      END IF;
    END IF;
  END IF;

  v_bundle := public._collect_schedule_session_move_conflicts(
    v_session.id,
    v_session.college_id,
    v_session.schedule_version_id,
    v_session.instructor_id,
    v_session.section_id,
    v_session.course_offering_id,
    v_session.teaching_assignment_id,
    v_session.study_system,
    v_session.expected_students,
    p_target_day_of_week,
    p_target_start_time,
    p_target_end_time,
    p_target_room_id
  );

  IF v_session.delivery_group_id IS NOT NULL THEN
    v_dg_conflicts := public._sb_v2_delivery_group_overlap(
      v_session.schedule_version_id,
      v_session.delivery_group_id,
      v_session.cohort_id,
      p_target_day_of_week,
      p_target_start_time,
      p_target_end_time,
      v_session.id
    );
    IF jsonb_array_length(v_dg_conflicts) > 0 THEN
      v_bundle := jsonb_set(
        v_bundle,
        '{blocking_conflicts}',
        COALESCE(v_bundle->'blocking_conflicts', '[]'::jsonb) || v_dg_conflicts
      );
    END IF;
  END IF;

  v_blocking_len := jsonb_array_length(COALESCE(v_bundle->'blocking_conflicts', '[]'::jsonb));
  v_warning_len := jsonb_array_length(COALESCE(v_bundle->'warnings', '[]'::jsonb));

  IF v_blocking_len > 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'BLOCKED_CONFLICTS',
      'stale', false,
      'message_ar', 'توجد تعارضات مانعة. لم يُحفظ التغيير.',
      'blocking_conflicts', v_bundle->'blocking_conflicts',
      'warnings', v_bundle->'warnings',
      'approved_exceptions', v_bundle->'approved_exceptions'
    );
  END IF;

  IF v_warning_len > 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'BLOCKED_WARNINGS',
      'stale', false,
      'message_ar', 'توجد تحذيرات غير محلولة. الحفظ غير مسموح حاليًا.',
      'blocking_conflicts', v_bundle->'blocking_conflicts',
      'warnings', v_bundle->'warnings',
      'approved_exceptions', v_bundle->'approved_exceptions'
    );
  END IF;

  v_before := jsonb_build_object(
    'day_of_week', v_session.day_of_week,
    'start_time', v_session.start_time,
    'end_time', v_session.end_time,
    'room_id', v_session.room_id,
    'updated_at', v_session.updated_at
  );

  UPDATE public.schedule_sessions
  SET
    day_of_week = p_target_day_of_week,
    start_time = p_target_start_time,
    end_time = p_target_end_time,
    room_id = p_target_room_id
  WHERE id = p_session_id
  RETURNING * INTO v_session;

  v_after := jsonb_build_object(
    'day_of_week', v_session.day_of_week,
    'start_time', v_session.start_time,
    'end_time', v_session.end_time,
    'room_id', v_session.room_id,
    'updated_at', v_session.updated_at
  );

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (
    v_uid,
    'move_or_reschedule',
    'schedule_sessions',
    p_session_id,
    v_session.college_id,
    jsonb_build_object(
      'before', v_before,
      'after', v_after,
      'change_reason', NULLIF(btrim(COALESCE(p_change_reason, '')), ''),
      'approved_exceptions', COALESCE(v_bundle->'approved_exceptions', '[]'::jsonb)
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'code', 'SAVED',
    'stale', false,
    'session', v_after || jsonb_build_object('id', p_session_id),
    'blocking_conflicts', '[]'::jsonb,
    'warnings', '[]'::jsonb,
    'approved_exceptions', COALESCE(v_bundle->'approved_exceptions', '[]'::jsonb)
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public._ss_peer_i(p_sid uuid, p_cid uuid, p_vid uuid, p_iid uuid, p_dow integer, p_st time without time zone, p_et time without time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb:='[]'::jsonb; r record;
BEGIN
  FOR r IN
    SELECT id,instructor_id,day_of_week,start_time,end_time FROM public.schedule_sessions
    WHERE college_id=p_cid AND schedule_version_id=p_vid AND id<>p_sid
      AND COALESCE(replaced_by_split,false)=false
      AND instructor_id=p_iid AND day_of_week=p_dow
  LOOP
    IF public._ss_ov(r.start_time,r.end_time,p_st,p_et) THEN
      v:=v||jsonb_build_array(public._ss_ci('instructor_conflict','hard',p_sid,r.id,
        jsonb_build_object('instructor_id',p_iid,'day_of_week',p_dow)));
    END IF;
  END LOOP;
  RETURN v;
END;$function$;
CREATE OR REPLACE FUNCTION public._ss_room_type(p_sid uuid, p_cid uuid, p_ta uuid, p_rid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v jsonb := '[]'::jsonb;
  req text;
  rtype text;
  ctype text;
  compatible boolean;
begin
  if p_rid is null or p_ta is null then return v; end if;

  select ta.required_room_type, pcc.component_type
    into req, ctype
  from public.teaching_assignments ta
  left join public.plan_course_components pcc on pcc.id = ta.plan_course_component_id
  where ta.id = p_ta and ta.college_id = p_cid;

  select room_type into rtype from public.rooms where id = p_rid and college_id = p_cid;

  compatible := public.is_assignment_room_compatible(p_cid, p_ta, p_rid);

  if coalesce(compatible, false) = false then
    v := v || jsonb_build_array(public._ss_ci(
      'room_type_mismatch','hard',p_sid,null,
      jsonb_build_object(
        'required_room_type',req,
        'room_type',rtype,
        'component_type',ctype,
        'room_id',p_rid,
        'teaching_assignment_id',p_ta,
        'practical_lecture_hall_fallback_allowed', true
      )
    ));
  end if;
  return v;
end;
$function$;
CREATE OR REPLACE FUNCTION public.import_scheduling_headcounts(p_college_id uuid, p_rows jsonb, p_action text DEFAULT 'save'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET lock_timeout TO '3s'
AS $function$
DECLARE
  v_input jsonb; v_result jsonb; v_out jsonb := '[]'::jsonb; v_field text;
  v_cohort public.academic_cohorts%ROWTYPE;
  v_head public.scheduling_cohort_term_headcounts%ROWTYPE;
  v_existing boolean; v_same boolean; v_changed integer := 0;
  v_fields text[] := ARRAY['registered_student_count','eligible_student_count','expected_attendance_count',
    'reserve_margin','scheduling_headcount','exam_eligible_count'];
BEGIN
  IF auth.uid() IS NULL OR public.can_manage_college(auth.uid(), p_college_id) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ليس لديك صلاحية إدارة الكلية' USING ERRCODE = '42501';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('save','approve') OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'طلب غير صالح؛ يلزم من 1 إلى 500 صف' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_rows) r GROUP BY r->>'cohort_id', r->>'term_id' HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'تكرار الدفعة والفصل في الملف' USING ERRCODE = '22023';
  END IF;
  -- Same lock order for all batches. Existing single-row writes wait briefly;
  -- readers continue normally. No lock remains after the RPC transaction ends.
  LOCK TABLE public.academic_cohorts, public.academic_terms IN SHARE MODE;
  LOCK TABLE public.scheduling_cohort_term_headcounts IN SHARE ROW EXCLUSIVE MODE;
  FOR v_input IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    IF jsonb_typeof(v_input) IS DISTINCT FROM 'object' OR NOT v_input ?&
      (v_fields || ARRAY['cohort_id','term_id','cohort_version','expected_version','source','notes','allow_over_eligible']) THEN
      RAISE EXCEPTION 'صف ناقص؛ أعد فحص الملف' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_cohort FROM public.academic_cohorts
      WHERE id = (v_input->>'cohort_id')::uuid AND college_id = p_college_id AND active;
    IF NOT FOUND OR v_cohort.term_id IS DISTINCT FROM (v_input->>'term_id')::uuid
      OR md5(to_jsonb(v_cohort)::text) IS DISTINCT FROM v_input->>'cohort_version'
      OR NOT EXISTS (SELECT 1 FROM public.academic_terms WHERE id = v_cohort.term_id AND college_id = p_college_id AND is_active) THEN
      RAISE EXCEPTION 'الدفعة أو الفصل غير مطابقين أو تغيرا بعد المعاينة؛ أعد فحص الملف' USING ERRCODE = '22023';
    END IF;
    FOREACH v_field IN ARRAY v_fields LOOP
      IF jsonb_typeof(v_input->v_field) IS DISTINCT FROM 'number' OR (v_input->>v_field) !~ '^[0-9]+$'
        OR (v_input->>v_field)::numeric > 2147483647 THEN
        RAISE EXCEPTION 'عدد غير صالح في %', v_field USING ERRCODE = '22023';
      END IF;
    END LOOP;
    IF (v_input->>'scheduling_headcount')::integer = 0
      OR jsonb_typeof(v_input->'source') IS DISTINCT FROM 'string'
      OR coalesce(length(btrim(v_input->>'source')),0) NOT BETWEEN 1 AND 500
      OR jsonb_typeof(v_input->'notes') NOT IN ('string','null')
      OR coalesce(length(v_input->>'notes'),0) > 2000
      OR jsonb_typeof(v_input->'allow_over_eligible') IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'يلزم عدد جدولة موجب ومصدر وملاحظات صالحة' USING ERRCODE = '22023';
    END IF;
    IF ((v_input->>'scheduling_headcount')::integer > (v_input->>'eligible_student_count')::integer
      OR (v_input->>'expected_attendance_count')::integer > (v_input->>'eligible_student_count')::integer)
      AND (NOT (v_input->>'allow_over_eligible')::boolean OR nullif(btrim(v_input->>'notes'),'') IS NULL) THEN
      RAISE EXCEPTION 'تجاوز المؤهلين يتطلب استثناءً صريحًا وسببًا' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_head FROM public.scheduling_cohort_term_headcounts
      WHERE cohort_id = v_cohort.id AND term_id = v_cohort.term_id;
    v_existing := FOUND;
    IF (CASE WHEN v_existing THEN md5(to_jsonb(v_head)::text) ELSE NULL END)
      IS DISTINCT FROM v_input->>'expected_version' THEN
      RAISE EXCEPTION 'تغيرت أعداد الدفعة % بعد المعاينة؛ أعد فحص الملف', v_cohort.code USING ERRCODE = '40001';
    END IF;
    v_same := v_existing AND v_head.source = v_input->>'source'
      AND v_head.notes IS NOT DISTINCT FROM v_input->>'notes' AND v_head.study_system = v_cohort.study_system;
    FOREACH v_field IN ARRAY v_fields LOOP
      v_same := v_same AND (to_jsonb(v_head)->v_field) = (v_input->v_field);
    END LOOP;
    IF p_action = 'save' THEN
      IF NOT coalesce(v_same,false) OR v_head.approval_status = 'archived' THEN
        v_result := public.upsert_scheduling_cohort_term_headcount(
          v_cohort.id, v_cohort.term_id, (v_input->>'registered_student_count')::integer,
          (v_input->>'eligible_student_count')::integer, (v_input->>'expected_attendance_count')::integer,
          (v_input->>'reserve_margin')::integer, (v_input->>'scheduling_headcount')::integer,
          (v_input->>'exam_eligible_count')::integer, v_input->>'source', v_input->>'notes',
          (v_input->>'allow_over_eligible')::boolean);
        IF v_result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION '%', v_result->>'message'; END IF;
        v_changed := v_changed + 1;
      END IF;
    ELSE
      IF NOT coalesce(v_same,false) OR v_head.approval_status NOT IN ('draft','approved') THEN
        RAISE EXCEPTION 'احفظ الأعداد كمسودة وراجعها قبل الاعتماد' USING ERRCODE = '22023';
      END IF;
      IF v_head.approval_status = 'draft' THEN
        v_result := public.approve_scheduling_cohort_term_headcount(v_head.id, v_head.notes);
        IF v_result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION '%', v_result->>'message'; END IF;
        v_changed := v_changed + 1;
      END IF;
    END IF;
    SELECT * INTO v_head FROM public.scheduling_cohort_term_headcounts WHERE cohort_id = v_cohort.id AND term_id = v_cohort.term_id;
    v_out := v_out || jsonb_build_array(jsonb_build_object('cohort_id', v_cohort.id,
      'term_id', v_cohort.term_id, 'expected_version', md5(to_jsonb(v_head)::text), 'approval_status', v_head.approval_status));
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'rows', v_out, 'changed', v_changed);
END;
$function$;
CREATE OR REPLACE FUNCTION public.get_scheduling_headcount_import_context(p_college_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL OR public.can_manage_college(auth.uid(), p_college_id) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ليس لديك صلاحية إدارة الكلية' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'code', c.code, 'term_id', c.term_id, 'term_code', t.code,
    'term_name', t.name, 'program_code', p.code, 'program_name', p.name,
    'level_number', l.level_number, 'study_system', c.study_system, 'entry_year', c.entry_year,
    'expected_students', c.expected_students, 'cohort_version', md5(to_jsonb(c)::text),
    'expected_version', CASE WHEN h.id IS NULL THEN NULL ELSE md5(to_jsonb(h)::text) END,
    'headcount', CASE WHEN h.id IS NULL THEN NULL ELSE to_jsonb(h) END
  ) ORDER BY p.code, l.level_number, c.study_system, c.code), '[]'::jsonb) INTO v_rows
  FROM public.academic_cohorts c
  JOIN public.academic_terms t ON t.id = c.term_id AND t.college_id = c.college_id AND t.is_active
  JOIN public.academic_programs p ON p.id = c.program_id AND p.college_id = c.college_id
  JOIN public.academic_levels l ON l.id = c.level_id AND l.program_id = c.program_id
  LEFT JOIN public.scheduling_cohort_term_headcounts h ON h.cohort_id = c.id AND h.term_id = c.term_id
  WHERE c.college_id = p_college_id AND c.active;
  RETURN jsonb_build_object('ok', true, 'cohorts', v_rows);
END;
$function$;
CREATE OR REPLACE FUNCTION public._ss_sec_hit(p_sec uuid, p_peer_sec uuid, p_sg uuid, p_peer_sg uuid)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public'
AS $function$
SELECT p_sec IS NOT NULL AND p_peer_sec IS NOT NULL AND p_sec=p_peer_sec
  AND (p_peer_sg IS NULL OR p_sg IS NULL OR p_peer_sg=p_sg);
$function$;
CREATE OR REPLACE FUNCTION public.ensure_ss_college()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  vc uuid;
  oc uuid;
  ic uuid;
  rc uuid;
  sc uuid;
  gc uuid;
  tac uuid;
  ta_active boolean;
  ta_dg uuid;
  ta_instructor uuid;
  ta_offering uuid;
  ta_component uuid;
  ta_cohort uuid;
  dg_college uuid;
  dg_obsolete boolean;
  dg_active boolean;
  dg_cohort uuid;
  dg_component uuid;
  pcc_type text;
  pcc_regular boolean;
  v_ta_link_changing boolean;
  v_dg_link_changing boolean;
BEGIN
  SELECT college_id INTO vc FROM public.schedule_versions WHERE id = NEW.schedule_version_id;
  IF vc IS NULL OR vc <> NEW.college_id THEN RAISE EXCEPTION 'version/college mismatch'; END IF;

  SELECT college_id INTO oc FROM public.course_offerings WHERE id = NEW.course_offering_id;
  IF oc IS NULL OR oc <> NEW.college_id THEN RAISE EXCEPTION 'offering/college mismatch'; END IF;

  SELECT college_id INTO ic FROM public.instructors WHERE id = NEW.instructor_id;
  IF ic IS NULL OR ic <> NEW.college_id THEN RAISE EXCEPTION 'instructor/college mismatch'; END IF;

  IF NEW.room_id IS NOT NULL THEN
    SELECT college_id INTO rc FROM public.rooms WHERE id = NEW.room_id;
    IF rc IS NULL OR rc <> NEW.college_id THEN RAISE EXCEPTION 'room/college mismatch'; END IF;
  END IF;

  IF NEW.section_id IS NOT NULL THEN
    SELECT college_id INTO sc FROM public.sections WHERE id = NEW.section_id;
    IF sc IS NULL OR sc <> NEW.college_id THEN RAISE EXCEPTION 'section/college mismatch'; END IF;
  END IF;

  IF NEW.section_group_id IS NOT NULL THEN
    SELECT college_id INTO gc FROM public.section_groups WHERE id = NEW.section_group_id;
    IF gc IS NULL OR gc <> NEW.college_id THEN RAISE EXCEPTION 'section_group/college mismatch'; END IF;
  END IF;

  v_ta_link_changing := (
    TG_OP = 'INSERT'
    OR OLD.teaching_assignment_id IS DISTINCT FROM NEW.teaching_assignment_id
  );
  v_dg_link_changing := (
    TG_OP = 'INSERT'
    OR OLD.delivery_group_id IS DISTINCT FROM NEW.delivery_group_id
  );

  IF NEW.teaching_assignment_id IS NOT NULL THEN
    SELECT ta.college_id, ta.is_active, ta.delivery_group_id,
           ta.instructor_id, ta.course_offering_id, ta.plan_course_component_id, ta.cohort_id
      INTO tac, ta_active, ta_dg, ta_instructor, ta_offering, ta_component, ta_cohort
    FROM public.teaching_assignments ta
    WHERE ta.id = NEW.teaching_assignment_id;
    IF tac IS NULL OR tac <> NEW.college_id THEN
      RAISE EXCEPTION 'teaching_assignment/college mismatch';
    END IF;
    IF v_ta_link_changing AND COALESCE(ta_active, true) = false THEN
      RAISE EXCEPTION 'INACTIVE_ASSIGNMENT_SESSION_FORBIDDEN' USING ERRCODE = 'check_violation';
    END IF;
    IF v_ta_link_changing AND ta_instructor IS DISTINCT FROM NEW.instructor_id THEN
      RAISE EXCEPTION 'ASSIGNMENT_INSTRUCTOR_MISMATCH' USING ERRCODE = 'check_violation';
    END IF;
    IF v_ta_link_changing AND ta_offering IS DISTINCT FROM NEW.course_offering_id THEN
      RAISE EXCEPTION 'ASSIGNMENT_OFFERING_MISMATCH' USING ERRCODE = 'check_violation';
    END IF;
    IF v_ta_link_changing AND ta_dg IS NOT NULL THEN
      SELECT dg.college_id, dg.is_obsolete, dg.active, dg.cohort_id, dg.component_id
        INTO dg_college, dg_obsolete, dg_active, dg_cohort, dg_component
      FROM public.delivery_groups dg
      WHERE dg.id = ta_dg;
      IF dg_college IS NULL THEN
        RAISE EXCEPTION 'DELIVERY_GROUP_NOT_FOUND' USING ERRCODE = 'foreign_key_violation';
      END IF;
      IF dg_college <> NEW.college_id THEN
        RAISE EXCEPTION 'SESSION_DELIVERY_GROUP_CROSS_COLLEGE_FORBIDDEN' USING ERRCODE = 'check_violation';
      END IF;
      IF COALESCE(dg_obsolete, false) THEN
        RAISE EXCEPTION 'OBSOLETE_DELIVERY_GROUP_SESSION_FORBIDDEN' USING ERRCODE = 'check_violation';
      END IF;
      IF COALESCE(dg_active, true) = false THEN
        RAISE EXCEPTION 'DELIVERY_GROUP_INACTIVE_SESSION_FORBIDDEN' USING ERRCODE = 'check_violation';
      END IF;
      SELECT pcc.component_type, COALESCE(pcc.counts_toward_regular_load, true)
        INTO pcc_type, pcc_regular
      FROM public.plan_course_components pcc WHERE pcc.id = dg_component;
      IF pcc_type = 'summer_training' THEN
        RAISE EXCEPTION 'SUMMER_TRAINING_SESSION_FORBIDDEN' USING ERRCODE = 'check_violation';
      END IF;
      IF pcc_type = 'project' AND COALESCE(pcc_regular, true) = false THEN
        RAISE EXCEPTION 'PROJECT_STANDARD_WEEKLY_SESSION_FORBIDDEN' USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.delivery_group_id IS NOT NULL AND NEW.delivery_group_id IS DISTINCT FROM ta_dg THEN
        RAISE EXCEPTION 'SESSION_DELIVERY_GROUP_ASSIGNMENT_MISMATCH' USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.cohort_id IS NOT NULL AND NEW.cohort_id IS DISTINCT FROM dg_cohort THEN
        RAISE EXCEPTION 'SESSION_COHORT_MISMATCH' USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.plan_course_component_id IS NOT NULL
         AND NEW.plan_course_component_id IS DISTINCT FROM dg_component THEN
        RAISE EXCEPTION 'SESSION_COMPONENT_MISMATCH' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  IF NEW.delivery_group_id IS NOT NULL THEN
    SELECT dg.college_id, dg.is_obsolete, dg.active, dg.cohort_id, dg.component_id
      INTO dg_college, dg_obsolete, dg_active, dg_cohort, dg_component
    FROM public.delivery_groups dg
    WHERE dg.id = NEW.delivery_group_id;
    IF dg_college IS NULL THEN
      RAISE EXCEPTION 'DELIVERY_GROUP_NOT_FOUND' USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF dg_college <> NEW.college_id THEN
      RAISE EXCEPTION 'SESSION_DELIVERY_GROUP_CROSS_COLLEGE_FORBIDDEN' USING ERRCODE = 'check_violation';
    END IF;
    IF v_dg_link_changing AND COALESCE(dg_obsolete, false) THEN
      RAISE EXCEPTION 'OBSOLETE_DELIVERY_GROUP_SESSION_FORBIDDEN' USING ERRCODE = 'check_violation';
    END IF;
    IF v_dg_link_changing AND COALESCE(dg_active, true) = false THEN
      RAISE EXCEPTION 'DELIVERY_GROUP_INACTIVE_SESSION_FORBIDDEN' USING ERRCODE = 'check_violation';
    END IF;
    IF v_dg_link_changing THEN
      SELECT pcc.component_type, COALESCE(pcc.counts_toward_regular_load, true)
        INTO pcc_type, pcc_regular
      FROM public.plan_course_components pcc WHERE pcc.id = dg_component;
      IF pcc_type = 'summer_training' THEN
        RAISE EXCEPTION 'SUMMER_TRAINING_SESSION_FORBIDDEN' USING ERRCODE = 'check_violation';
      END IF;
      IF pcc_type = 'project' AND COALESCE(pcc_regular, true) = false THEN
        RAISE EXCEPTION 'PROJECT_STANDARD_WEEKLY_SESSION_FORBIDDEN' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.generate_cohort_delivery_groups(p_cohort_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_cohort public.academic_cohorts%ROWTYPE;
  v_components_processed integer := 0;
  v_groups_created integer := 0;
  v_groups_updated integer := 0;
  v_groups_unchanged integer := 0;
  v_groups_obsolete integer := 0;
  v_warnings jsonb := '[]'::jsonb;
  v_validation_errors jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  r record;
  v_student_count integer;
  v_capacity integer;
  v_required integer;
  v_group_num integer;
  v_has_links boolean;
  v_expected_for_group integer;
  v_group_code text;
  v_excluded boolean;
  v_row public.delivery_groups%ROWTYPE;
  v_changed boolean;
  v_base integer;
  v_rem integer;
  v_status text;
  v_curriculum jsonb;
  v_headcount jsonb;
  v_partitions jsonb;
BEGIN
  IF p_cohort_id IS NULL THEN
    RAISE EXCEPTION 'COHORT_ID_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(9262, 1);
  SELECT * INTO v_cohort FROM public.academic_cohorts
  WHERE id = p_cohort_id AND public.can_manage_college(v_uid, college_id)
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COHORT_NOT_FOUND_OR_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF NOT COALESCE(v_cohort.active, false) THEN
    RAISE EXCEPTION 'COHORT_INACTIVE' USING ERRCODE = '23514';
  END IF;
  LOCK TABLE public.scheduling_cohort_term_headcounts,
    public.scheduling_headcount_overrides IN SHARE MODE;
  v_headcount := public.resolve_scheduling_headcount(v_cohort.college_id, p_cohort_id, v_cohort.term_id);
  IF COALESCE((v_headcount->>'ok')::boolean, false) = false THEN
    RAISE EXCEPTION 'SCHEDULING_HEADCOUNT_MISSING' USING ERRCODE = '23514';
  END IF;
  v_student_count := (v_headcount->>'scheduling_headcount')::integer;
  IF v_student_count IS NULL OR v_student_count <= 0 THEN
    RAISE EXCEPTION 'INVALID_STUDENT_COUNT' USING ERRCODE = '23514';
  END IF;
  -- One explicit click prepares curriculum and groups in the same transaction.
  v_curriculum := public.generate_cohort_curriculum(p_cohort_id);

  DROP TABLE IF EXISTS pg_temp._dg_gen_components;
  CREATE TEMP TABLE _dg_gen_components (
    component_id uuid PRIMARY KEY,
    plan_course_id uuid NOT NULL,
    component_type text NOT NULL,
    weekly_contact_hours numeric,
    room_is_active boolean,
    required_room_type_id uuid,
    explicit_group_size integer,
    is_timetabled boolean,
    counts_toward_regular_load boolean,
    room_default_capacity integer,
    strict_capacity boolean,
    course_offering_id uuid,
    offering_count integer NOT NULL DEFAULT 1
  ) ON COMMIT DROP;

  TRUNCATE pg_temp._dg_gen_components;

  INSERT INTO pg_temp._dg_gen_components (
    component_id, plan_course_id, component_type, weekly_contact_hours, room_is_active,
    required_room_type_id, explicit_group_size, is_timetabled, counts_toward_regular_load,
    room_default_capacity, strict_capacity, course_offering_id, offering_count
  )
  SELECT
    x.component_id,
    x.plan_course_id,
    x.component_type,
    x.weekly_contact_hours,
    x.room_is_active,
    x.required_room_type_id,
    x.explicit_group_size,
    x.is_timetabled,
    x.counts_toward_regular_load,
    x.room_default_capacity,
    x.strict_capacity,
    x.course_offering_id,
    x.offering_count
  FROM (
    SELECT DISTINCT ON (pcc.id)
      pcc.id AS component_id,
      pcc.plan_course_id,
      pcc.component_type,
      pcc.weekly_contact_hours,
      rt.is_active AS room_is_active,
      pcc.required_room_type_id,
      pcc.explicit_group_size,
      pcc.is_timetabled,
      pcc.counts_toward_regular_load,
      -- Effective capacity: uniform active-room capacity when available,
      -- otherwise the room type default capacity (no guessing).
      COALESCE(
        public.effective_room_type_capacity(pcc.college_id, pcc.required_room_type_id),
        rt.default_capacity
      ) AS room_default_capacity,
      COALESCE(rt.strict_capacity, false) AS strict_capacity,
      co.id AS course_offering_id,
      COUNT(*) OVER (PARTITION BY pcc.id) AS offering_count
    FROM public.course_offerings co
    JOIN public.plan_course_components pcc
      ON pcc.plan_course_id = co.plan_course_id
     AND pcc.college_id = co.college_id
    LEFT JOIN public.room_types rt
      ON rt.id = pcc.required_room_type_id
     AND rt.college_id = pcc.college_id
    WHERE co.college_id = v_cohort.college_id
      AND co.term_id = v_cohort.term_id
      AND co.program_id = v_cohort.program_id
      AND co.level_id = v_cohort.level_id
      AND co.study_system = v_cohort.study_system
      AND co.study_plan_id = (v_curriculum->>'study_plan_id')::uuid
      AND co.plan_course_id IS NOT NULL
      AND COALESCE(pcc.is_timetabled, true)
      AND COALESCE(pcc.weekly_contact_hours, 0) > 0
      AND COALESCE(co.is_active, true) = true
    ORDER BY pcc.id, co.created_at DESC NULLS LAST, co.id ASC
  ) x;

  IF NOT EXISTS (SELECT 1 FROM pg_temp._dg_gen_components) THEN
    RAISE EXCEPTION 'COHORT_TIMETABLED_COMPONENTS_EMPTY' USING ERRCODE = '23514';
  END IF;

  FOR r IN
    SELECT * FROM pg_temp._dg_gen_components
    ORDER BY plan_course_id, component_type, component_id
  LOOP
    v_components_processed := v_components_processed + 1;

    IF r.component_type = 'summer_training' THEN
      CONTINUE;
    END IF;

    IF r.component_type = 'project'
       AND COALESCE(r.counts_toward_regular_load, false) = false THEN
      IF COALESCE(r.weekly_contact_hours, 0) <= 0 THEN
        CONTINUE;
      END IF;
      IF r.explicit_group_size IS NULL OR r.explicit_group_size <= 0 THEN
        v_validation_errors := v_validation_errors || jsonb_build_array(
          jsonb_build_object(
            'code', 'MISSING_PROJECT_GROUP_SIZE',
            'component_id', r.component_id,
            'component_type', r.component_type,
            'message', 'project requires explicit_group_size; capacity must not be guessed'
          )
        );
      END IF;
      CONTINUE;
    END IF;

    IF r.component_type = 'tutorial' AND r.explicit_group_size IS NOT NULL AND r.explicit_group_size > 0 THEN
      CONTINUE;
    END IF;

    IF r.room_is_active IS DISTINCT FROM true
       OR r.required_room_type_id IS NULL
       OR r.room_default_capacity IS NULL
       OR r.room_default_capacity <= 0 THEN
      v_validation_errors := v_validation_errors || jsonb_build_array(
        jsonb_build_object(
          'code', 'MISSING_CAPACITY',
          'component_id', r.component_id,
          'component_type', r.component_type,
          'message', 'missing room type capacity reference; refuse to guess'
        )
      );
    END IF;
  END LOOP;

  IF jsonb_array_length(v_validation_errors) > 0 THEN
    RAISE EXCEPTION 'DELIVERY_GROUP_CAPACITY_INVALID'
      USING ERRCODE = '23514', DETAIL = v_validation_errors::text;
  END IF;

  v_components_processed := 0;

  FOR r IN
    SELECT * FROM pg_temp._dg_gen_components
    ORDER BY plan_course_id, component_type, component_id
  LOOP
    v_components_processed := v_components_processed + 1;

    IF r.offering_count > 1 THEN
      v_warnings := v_warnings || jsonb_build_array(
        jsonb_build_object(
          'code', 'COMPATIBILITY_OFFERING_RESOLVED_DETERMINISTICALLY',
          'component_id', r.component_id,
          'plan_course_id', r.plan_course_id,
          'offering_count', r.offering_count,
          'chosen_course_offering_id', r.course_offering_id,
          'message', 'multiple compatibility offerings; chose newest created_at then id; one component pass only'
        )
      );
    END IF;

    IF r.component_type = 'summer_training' THEN
      v_skipped := v_skipped || jsonb_build_array(
        jsonb_build_object(
          'code', 'skipped_non_weekly_component',
          'component_id', r.component_id,
          'component_type', r.component_type,
          'course_offering_id', r.course_offering_id
        )
      );
      CONTINUE;
    END IF;

    v_headcount := public.resolve_scheduling_headcount(v_cohort.college_id, p_cohort_id,
      v_cohort.term_id, r.course_offering_id, r.component_id);
    v_student_count := (v_headcount->>'scheduling_headcount')::integer;
    IF COALESCE((v_headcount->>'ok')::boolean, false) = false
       OR v_student_count IS NULL OR v_student_count <= 0 THEN
      RAISE EXCEPTION 'SCHEDULING_HEADCOUNT_MISSING' USING ERRCODE = '23514';
    END IF;

    v_excluded := (COALESCE(r.counts_toward_regular_load, true) = false);
    v_capacity := NULL;
    v_required := NULL;

    IF r.component_type = 'project' AND COALESCE(r.counts_toward_regular_load, false) = false THEN
      IF COALESCE(r.weekly_contact_hours, 0) <= 0 THEN
        v_skipped := v_skipped || jsonb_build_array(
          jsonb_build_object(
            'code', 'project_zero_hours',
            'component_id', r.component_id,
            'component_type', r.component_type
          )
        );
        CONTINUE;
      END IF;
      v_capacity := r.explicit_group_size;
      IF v_student_count = 0 THEN
        v_required := 1;
      ELSE
        v_required := CEIL(v_student_count::numeric / v_capacity::numeric)::integer;
      END IF;
    ELSIF r.component_type = 'tutorial' AND r.explicit_group_size IS NOT NULL AND r.explicit_group_size > 0 THEN
      v_capacity := r.explicit_group_size;
      IF v_student_count = 0 THEN
        v_required := 1;
      ELSE
        v_required := CEIL(v_student_count::numeric / v_capacity::numeric)::integer;
      END IF;
    ELSE
      v_capacity := r.room_default_capacity;
      IF r.component_type = 'theory' THEN
        IF v_student_count <= v_capacity THEN
          v_required := 1;
        ELSE
          v_required := CEIL(v_student_count::numeric / v_capacity::numeric)::integer;
        END IF;
      ELSE
        IF v_student_count = 0 THEN
          v_required := 1;
        ELSE
          v_required := CEIL(v_student_count::numeric / v_capacity::numeric)::integer;
        END IF;
      END IF;
    END IF;

    v_base := CASE WHEN v_required > 0 THEN v_student_count / v_required ELSE 0 END;
    v_rem := CASE WHEN v_required > 0 THEN v_student_count % v_required ELSE 0 END;

    FOR v_group_num IN 1..v_required LOOP
      v_expected_for_group := v_base + CASE WHEN v_group_num <= v_rem THEN 1 ELSE 0 END;
      v_group_code := 'G' || v_group_num::text;

      SELECT * INTO v_row
      FROM public.delivery_groups dg
      WHERE dg.cohort_id = p_cohort_id
        AND dg.component_id = r.component_id
        AND dg.group_number = v_group_num;

      IF NOT FOUND THEN
        INSERT INTO public.delivery_groups (
          college_id, cohort_id, plan_course_id, component_id,
          group_code, group_number, expected_students, capacity_limit,
          active, excluded_from_standard_workload, is_obsolete
        ) VALUES (
          v_cohort.college_id, p_cohort_id, r.plan_course_id, r.component_id,
          v_group_code, v_group_num, v_expected_for_group, v_capacity,
          true, v_excluded, false
        );
        v_groups_created := v_groups_created + 1;
      ELSE
        v_changed := (
          v_row.expected_students IS DISTINCT FROM v_expected_for_group
          OR v_row.capacity_limit IS DISTINCT FROM v_capacity
          OR v_row.excluded_from_standard_workload IS DISTINCT FROM v_excluded
          OR v_row.active IS DISTINCT FROM true
          OR COALESCE(v_row.is_obsolete, false) IS DISTINCT FROM false
        );
        IF v_changed THEN
          UPDATE public.delivery_groups
          SET expected_students = v_expected_for_group,
              capacity_limit = v_capacity,
              excluded_from_standard_workload = v_excluded,
              active = true,
              is_obsolete = false,
              group_code = COALESCE(NULLIF(v_row.group_code, ''), v_group_code)
          WHERE id = v_row.id;
          v_groups_updated := v_groups_updated + 1;
        ELSE
          v_groups_unchanged := v_groups_unchanged + 1;
        END IF;
      END IF;
    END LOOP;

    FOR v_row IN
      SELECT *
      FROM public.delivery_groups dg
      WHERE dg.cohort_id = p_cohort_id
        AND dg.component_id = r.component_id
        AND dg.group_number IS NOT NULL
        AND dg.group_number > v_required
    LOOP
      IF COALESCE(v_row.is_obsolete, false) THEN
        CONTINUE;
      END IF;

      v_groups_obsolete := v_groups_obsolete + 1;

      UPDATE public.delivery_groups
      SET is_obsolete = true
      WHERE id = v_row.id;

      SELECT EXISTS (
        SELECT 1 FROM public.teaching_assignments ta WHERE ta.delivery_group_id = v_row.id
      ) OR EXISTS (
        SELECT 1 FROM public.schedule_sessions ss WHERE ss.delivery_group_id = v_row.id
      ) INTO v_has_links;

      IF v_has_links THEN
        v_warnings := v_warnings || jsonb_build_array(
          jsonb_build_object(
            'code', 'OBSOLETE_GROUP_LINKED',
            'delivery_group_id', v_row.id,
            'group_number', v_row.group_number,
            'component_id', r.component_id,
            'message', 'obsolete group has operational links; marked obsolete, not deleted'
          )
        );
      ELSE
        v_warnings := v_warnings || jsonb_build_array(
          jsonb_build_object(
            'code', 'OBSOLETE_GROUP_UNUSED',
            'delivery_group_id', v_row.id,
            'group_number', v_row.group_number,
            'component_id', r.component_id,
            'message', 'obsolete unused group marked obsolete and retained (non-destructive)'
          )
        );
      END IF;
    END LOOP;
  END LOOP;

  -- Anonymous student partitions are part of the same transaction: they always
  -- reflect the delivery-group boundaries produced above (fail-closed).
  v_partitions := public.rebuild_cohort_student_partitions(p_cohort_id);

  IF v_groups_created = 0 AND v_groups_updated = 0 AND v_groups_obsolete = 0 THEN
    v_status := 'NO_CHANGES';
  ELSE
    v_status := 'SUCCESS';
  END IF;

  RETURN jsonb_build_object(
    'curriculum', v_curriculum,
    'status', v_status,
    'cohorts_processed', 1,
    'cohort_id', p_cohort_id,
    'college_id', v_cohort.college_id,
    'student_count', (public.resolve_scheduling_headcount(v_cohort.college_id, p_cohort_id, v_cohort.term_id)->>'scheduling_headcount')::integer,
    'components_processed', v_components_processed,
    'groups_created', v_groups_created,
    'groups_updated', v_groups_updated,
    'groups_unchanged', v_groups_unchanged,
    'groups_obsolete', v_groups_obsolete,
    'student_partitions', v_partitions,
    'skipped_components', v_skipped,
    'warnings', v_warnings || COALESCE(v_curriculum->'warnings', '[]'::jsonb),
    'validation_errors', v_validation_errors
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public._sb_v2_assignment_guard(p_teaching_assignment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ta public.teaching_assignments%ROWTYPE;
  v_dg public.delivery_groups%ROWTYPE;
  v_pcc public.plan_course_components%ROWTYPE;
BEGIN
  IF p_teaching_assignment_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'is_v2', false);
  END IF;

  SELECT * INTO v_ta
  FROM public.teaching_assignments
  WHERE id = p_teaching_assignment_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ASSIGNMENT_NOT_FOUND');
  END IF;

  IF v_ta.delivery_group_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'is_v2', false, 'teaching_assignment_id', v_ta.id);
  END IF;

  IF COALESCE(v_ta.is_active, true) = false THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INACTIVE_ASSIGNMENT', 'is_v2', true);
  END IF;

  SELECT * INTO v_dg FROM public.delivery_groups WHERE id = v_ta.delivery_group_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'DELIVERY_GROUP_NOT_FOUND', 'is_v2', true);
  END IF;
  IF COALESCE(v_dg.is_obsolete, false) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'OBSOLETE_DELIVERY_GROUP', 'is_v2', true);
  END IF;
  IF COALESCE(v_dg.active, true) = false THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INACTIVE_DELIVERY_GROUP', 'is_v2', true);
  END IF;

  SELECT * INTO v_pcc FROM public.plan_course_components WHERE id = v_dg.component_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'COMPONENT_NOT_FOUND', 'is_v2', true);
  END IF;
  IF v_pcc.component_type = 'summer_training' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'SUMMER_TRAINING_BLOCKED', 'is_v2', true);
  END IF;
  -- Only supervision projects are non-weekly; regular weekly project hours schedule normally.
  IF v_pcc.component_type = 'project'
     AND COALESCE(v_pcc.counts_toward_regular_load, true) = false THEN
    RETURN jsonb_build_object('ok', false, 'code', 'PROJECT_NON_WEEKLY', 'is_v2', true);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'is_v2', true,
    'teaching_assignment_id', v_ta.id,
    'delivery_group_id', v_dg.id,
    'component_type', v_pcc.component_type
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.preview_instructor_workload_after_assignment(p_instructor_id uuid, p_delivery_group_id uuid, p_assigned_component_hours numeric DEFAULT NULL::numeric, p_assignment_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_instructor public.instructors%ROWTYPE;
  v_dg public.delivery_groups%ROWTYPE;
  v_pcc public.plan_course_components%ROWTYPE;
  v_term_id uuid;
  v_current jsonb;
  v_proposed_hours numeric;
  v_projected_standard numeric;
  v_projected_project numeric;
  v_required numeric;
  v_warnings jsonb := '[]'::jsonb;
  v_conflicts jsonb := '[]'::jsonb;
  v_co_count integer;
  v_is_project boolean;
  v_status_before text;
  v_status_after text;
  v_deficit_before numeric;
  v_deficit_after numeric;
  v_overload_before numeric;
  v_overload_after numeric;
  v_old_std numeric := 0;
  v_old_proj numeric := 0;
  v_peer_hours numeric := 0;
  v_baseline_standard numeric;
  v_baseline_project numeric;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  IF p_instructor_id IS NULL OR p_delivery_group_id IS NULL THEN
    RAISE EXCEPTION 'INSTRUCTOR_AND_DELIVERY_GROUP_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_instructor FROM public.instructors WHERE id = p_instructor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INSTRUCTOR_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO v_dg FROM public.delivery_groups WHERE id = p_delivery_group_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DELIVERY_GROUP_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT public.can_view_college(v_uid, v_instructor.college_id)
     OR NOT public.can_view_college(v_uid, v_dg.college_id) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  IF v_instructor.college_id <> v_dg.college_id THEN
    v_conflicts := v_conflicts || jsonb_build_array('ASSIGNMENT_CROSS_COLLEGE_FORBIDDEN');
  END IF;
  IF COALESCE(v_dg.is_obsolete, false) THEN
    v_conflicts := v_conflicts || jsonb_build_array('OBSOLETE_DELIVERY_GROUP_ASSIGNMENT_FORBIDDEN');
  END IF;
  IF COALESCE(v_dg.active, true) = false THEN
    v_conflicts := v_conflicts || jsonb_build_array('DELIVERY_GROUP_INACTIVE_ASSIGNMENT_FORBIDDEN');
  END IF;

  SELECT * INTO v_pcc FROM public.plan_course_components WHERE id = v_dg.component_id;
  IF v_pcc.component_type = 'summer_training' THEN
    v_conflicts := v_conflicts || jsonb_build_array('SUMMER_TRAINING_WEEKLY_ASSIGNMENT_FORBIDDEN');
  END IF;

  SELECT ac.term_id INTO v_term_id FROM public.academic_cohorts ac WHERE ac.id = v_dg.cohort_id;

  v_current := public.compute_instructor_standard_workload(p_instructor_id, v_term_id);
  v_baseline_standard := COALESCE((v_current->>'standard_assigned_hours')::numeric, 0);
  v_baseline_project := COALESCE((v_current->>'project_supervision_hours')::numeric, 0);
  v_required := (v_current->>'required_load_hours')::numeric;
  v_status_before := v_current->>'status';
  v_deficit_before := COALESCE((v_current->>'deficit_hours')::numeric, 0);
  v_overload_before := COALESCE((v_current->>'overload_hours')::numeric, 0);

  SELECT COUNT(*)::integer INTO v_co_count
  FROM public.teaching_assignments ta
  WHERE ta.delivery_group_id = p_delivery_group_id
    AND ta.is_active = TRUE
    AND (p_assignment_id IS NULL OR ta.id IS DISTINCT FROM p_assignment_id);

  IF NOT EXISTS (
    SELECT 1 FROM public.teaching_assignments ta
    WHERE ta.delivery_group_id = p_delivery_group_id
      AND ta.instructor_id = p_instructor_id
      AND ta.is_active = TRUE
      AND (p_assignment_id IS NULL OR ta.id = p_assignment_id)
  ) THEN
    v_co_count := v_co_count + 1;
  ELSE
    v_co_count := GREATEST(v_co_count, 1);
  END IF;

  IF v_co_count > 1 AND p_assigned_component_hours IS NULL THEN
    v_conflicts := v_conflicts || jsonb_build_array('CO_TEACHING_HOURS_SPLIT_REQUIRED');
    v_proposed_hours := 0;
  ELSIF p_assigned_component_hours IS NOT NULL THEN
    IF p_assigned_component_hours <= 0 THEN
      v_conflicts := v_conflicts || jsonb_build_array('ASSIGNED_HOURS_MUST_BE_POSITIVE');
    END IF;
    v_proposed_hours := p_assigned_component_hours;
  ELSE
    v_proposed_hours := COALESCE(v_pcc.weekly_contact_hours, 0);
  END IF;

  SELECT COALESCE(SUM(
    CASE
      WHEN ta.assigned_component_hours IS NOT NULL THEN ta.assigned_component_hours
      WHEN v_co_count <= 1 THEN COALESCE(v_pcc.weekly_contact_hours, 0)
      ELSE 0
    END
  ), 0)
  INTO v_peer_hours
  FROM public.teaching_assignments ta
  WHERE ta.delivery_group_id = p_delivery_group_id
    AND ta.is_active = TRUE
    AND (p_assignment_id IS NULL OR ta.id IS DISTINCT FROM p_assignment_id);

  IF COALESCE(v_peer_hours, 0) + COALESCE(v_proposed_hours, 0) > COALESCE(v_pcc.weekly_contact_hours, 0) THEN
    v_conflicts := v_conflicts || jsonb_build_array('CO_TEACHING_HOURS_OVER_ALLOCATED');
  END IF;

  v_is_project := COALESCE(v_dg.excluded_from_standard_workload, false)
    OR COALESCE(v_pcc.counts_toward_regular_load, true) = false;

  IF p_assignment_id IS NOT NULL THEN
    SELECT
      CASE
        WHEN pcc.component_type = 'summer_training' THEN 0
        WHEN COALESCE(dg.excluded_from_standard_workload, false)
          OR COALESCE(pcc.counts_toward_regular_load, true) = false THEN 0
        WHEN (
          SELECT COUNT(*) FROM public.teaching_assignments ta2
          WHERE ta2.delivery_group_id = ta.delivery_group_id AND ta2.is_active = TRUE
        ) > 1 THEN COALESCE(ta.assigned_component_hours, 0)
        ELSE COALESCE(ta.assigned_component_hours, pcc.weekly_contact_hours, 0)
      END,
      CASE
        WHEN pcc.component_type = 'project' AND COALESCE(pcc.counts_toward_regular_load, true) = false THEN
          CASE WHEN (
            SELECT COUNT(*) FROM public.teaching_assignments ta2
            WHERE ta2.delivery_group_id = ta.delivery_group_id AND ta2.is_active = TRUE
          ) > 1 THEN COALESCE(ta.assigned_component_hours, 0)
          ELSE COALESCE(ta.assigned_component_hours, pcc.weekly_contact_hours, 0) END
        ELSE 0
      END
    INTO v_old_std, v_old_proj
    FROM public.teaching_assignments ta
    JOIN public.delivery_groups dg ON dg.id = ta.delivery_group_id
    JOIN public.plan_course_components pcc ON pcc.id = COALESCE(ta.plan_course_component_id, dg.component_id)
    WHERE ta.id = p_assignment_id;

    v_baseline_standard := GREATEST(0, v_baseline_standard - COALESCE(v_old_std, 0));
    v_baseline_project := GREATEST(0, v_baseline_project - COALESCE(v_old_proj, 0));
  END IF;

  IF v_is_project THEN
    v_projected_standard := v_baseline_standard;
    v_projected_project := v_baseline_project + COALESCE(v_proposed_hours, 0);
  ELSE
    v_projected_standard := v_baseline_standard + COALESCE(v_proposed_hours, 0);
    v_projected_project := v_baseline_project;
  END IF;

  IF v_required IS NULL THEN
    v_status_after := 'policy_missing';
    v_warnings := v_warnings || jsonb_build_array('policy_missing');
    v_deficit_after := 0;
    v_overload_after := 0;
  ELSIF v_projected_standard = 0 THEN
    v_status_after := 'unassigned';
    v_deficit_after := v_required;
    v_overload_after := 0;
  ELSIF v_projected_standard > v_required THEN
    v_status_after := 'overload';
    v_overload_after := v_projected_standard - v_required;
    v_deficit_after := 0;
    v_warnings := v_warnings || jsonb_build_array('workload_overload');
  ELSIF v_projected_standard < v_required THEN
    v_status_after := 'deficit';
    v_deficit_after := v_required - v_projected_standard;
    v_overload_after := 0;
  ELSE
    v_status_after := 'ok';
    v_deficit_after := 0;
    v_overload_after := 0;
  END IF;

  IF v_status_before = 'policy_missing' AND v_required IS NOT NULL THEN
    v_warnings := v_warnings || jsonb_build_array('policy_missing');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'instructor_id', p_instructor_id,
    'delivery_group_id', p_delivery_group_id,
    'term_id', v_term_id,
    'required_load_hours', v_required,
    'current_standard_assigned_hours', (v_current->>'standard_assigned_hours')::numeric,
    'proposed_assignment_hours', v_proposed_hours,
    'projected_standard_assigned_hours', v_projected_standard,
    'current_project_hours', (v_current->>'project_supervision_hours')::numeric,
    'projected_project_hours', v_projected_project,
    'deficit_before', v_deficit_before,
    'deficit_after', v_deficit_after,
    'overload_before', v_overload_before,
    'overload_after', v_overload_after,
    'status_before', v_status_before,
    'status_after', v_status_after,
    'policy_missing', v_required IS NULL,
    'warnings', v_warnings,
    'assignment_conflicts', v_conflicts,
    'component_type', v_pcc.component_type,
    'is_project', v_is_project
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public._ss_set(p_sid uuid, p_cid uuid, p_dow integer, p_st time without time zone, p_et time without time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb:='[]'::jsonb; s record;
BEGIN
  SELECT working_days,day_start_time,day_end_time INTO s
  FROM public.scheduling_settings WHERE college_id=p_cid LIMIT 1;
  IF s.working_days IS NOT NULL AND cardinality(s.working_days)>0 AND NOT (p_dow=ANY(s.working_days)) THEN
    v:=v||jsonb_build_array(public._ss_ci('outside_working_days','hard',p_sid,NULL,
      jsonb_build_object('day_of_week',p_dow)));
  END IF;
  IF s.day_start_time IS NOT NULL AND s.day_end_time IS NOT NULL
     AND (p_st<s.day_start_time OR p_et>s.day_end_time) THEN
    v:=v||jsonb_build_array(public._ss_ci('outside_working_hours','hard',p_sid,NULL,
      jsonb_build_object('day_start_time',s.day_start_time,'day_end_time',s.day_end_time)));
  END IF;
  RETURN v;
END;$function$;
CREATE OR REPLACE FUNCTION public._ss_brk(p_sid uuid, p_cid uuid, p_dow integer, p_st time without time zone, p_et time without time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb:='[]'::jsonb; b record;
BEGIN
  FOR b IN
    SELECT id,name FROM public.daily_breaks
    WHERE college_id=p_cid AND affects_scheduling
      AND p_dow=ANY(days) AND start_time<p_et AND p_st<end_time
  LOOP
    v:=v||jsonb_build_array(public._ss_ci('daily_break','hard',p_sid,NULL,
      jsonb_build_object('daily_break_id',b.id,'name',b.name)));
  END LOOP;
  RETURN v;
END;$function$;
CREATE OR REPLACE FUNCTION public._import_mode_action(p_mode text, p_exists boolean)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN p_exists AND p_mode = 'insert_only' THEN 'skip'
    WHEN p_exists THEN 'update'
    WHEN (NOT p_exists) AND p_mode = 'update_existing' THEN 'skip'
    ELSE 'insert'
  END;
$function$;
CREATE OR REPLACE FUNCTION public.user_in_college(_user_id uuid, _college_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.user_colleges WHERE user_id = _user_id AND college_id = _college_id);
$function$;
CREATE OR REPLACE FUNCTION public._ss_tmpl(p_sid uuid, p_cid uuid, p_sys text, p_dow integer, p_st time without time zone, p_et time without time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb:='[]'::jsonb; cnt int; fits boolean;
BEGIN
  SELECT COUNT(*) INTO cnt FROM public.time_slot_templates tt
  WHERE tt.college_id=p_cid AND tt.is_active AND tt.day_of_week=p_dow
    AND (tt.study_system=p_sys OR tt.study_system='both' OR p_sys='both');
  IF cnt=0 THEN RETURN v; END IF;
  SELECT EXISTS(
    SELECT 1 FROM public.time_slot_templates tt
    WHERE tt.college_id=p_cid AND tt.is_active AND tt.day_of_week=p_dow
      AND (tt.study_system=p_sys OR tt.study_system='both' OR p_sys='both')
      AND p_st>=tt.start_time AND p_et<=tt.end_time
  ) INTO fits;
  IF NOT fits THEN
    v:=v||jsonb_build_array(public._ss_ci('study_system_time_template','hard',p_sid,NULL,
      jsonb_build_object('study_system',p_sys,'day_of_week',p_dow)));
  END IF;
  RETURN v;
END;$function$;
CREATE OR REPLACE FUNCTION public._import_row_values(elem jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN elem IS NULL THEN '{}'::jsonb
    WHEN jsonb_typeof(elem) = 'object' AND elem ? 'values'
      THEN COALESCE(elem->'values', '{}'::jsonb)
    ELSE COALESCE(elem, '{}'::jsonb)
  END;
$function$;
CREATE OR REPLACE FUNCTION public.can_manage_college(_user_id uuid, _college_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.is_super_admin(_user_id)
      OR (public.has_role(_user_id, 'college_admin') AND public.user_in_college(_user_id, _college_id));
$function$;
CREATE OR REPLACE FUNCTION public.effective_room_type_capacity(p_college_id uuid, p_room_type_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
  SELECT MIN(r.capacity)::integer
  FROM public.rooms r
  WHERE r.college_id = p_college_id
    AND r.room_type_id = p_room_type_id
    AND COALESCE(r.is_active, false) = true
    AND r.capacity IS NOT NULL
    AND r.capacity > 0
  HAVING COUNT(DISTINCT r.capacity) = 1
$function$;
CREATE OR REPLACE FUNCTION public.validate_schedule_session_move(p_session_id uuid, p_expected_updated_at timestamp with time zone, p_target_day_of_week integer, p_target_start_time time without time zone, p_target_end_time time without time zone, p_target_room_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_session public.schedule_sessions%ROWTYPE;
  v_version_status text;
  v_bundle jsonb;
  v_guard jsonb;
  v_dg_conflicts jsonb;
  v_assigned numeric;
  v_scheduled numeric;
  v_proposed numeric;
  v_blocking_len integer;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'code', 'UNAUTHORIZED', 'stale', false,
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb, 'approved_exceptions', '[]'::jsonb,
      'normalized_proposal', NULL);
  END IF;

  SELECT * INTO v_session FROM public.schedule_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'code', 'NOT_FOUND', 'stale', false,
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb, 'approved_exceptions', '[]'::jsonb,
      'normalized_proposal', NULL);
  END IF;

  IF NOT public.can_manage_college(v_uid, v_session.college_id) THEN
    RETURN jsonb_build_object('valid', false, 'code', 'FORBIDDEN_COLLEGE', 'stale', false,
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb, 'approved_exceptions', '[]'::jsonb,
      'normalized_proposal', NULL);
  END IF;

  SELECT status INTO v_version_status
  FROM public.schedule_versions WHERE id = v_session.schedule_version_id;
  IF v_version_status IN ('published', 'archived') THEN
    RETURN jsonb_build_object('valid', false, 'code', 'VERSION_LOCKED', 'stale', false,
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb, 'approved_exceptions', '[]'::jsonb,
      'normalized_proposal', NULL);
  END IF;

  IF p_expected_updated_at IS NULL OR v_session.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('valid', false, 'code', 'STALE_SESSION', 'stale', true,
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb, 'approved_exceptions', '[]'::jsonb,
      'normalized_proposal', NULL);
  END IF;

  IF v_session.teaching_assignment_id IS NOT NULL THEN
    v_guard := public._sb_v2_assignment_guard(v_session.teaching_assignment_id);
    IF COALESCE((v_guard->>'is_v2')::boolean, false)
       AND COALESCE((v_guard->>'ok')::boolean, false) = false THEN
      RETURN jsonb_build_object(
        'valid', false,
        'code', COALESCE(v_guard->>'code', 'ASSIGNMENT_BLOCKED'),
        'stale', false,
        'message_ar', 'تكليف V2 غير نشط أو محظور؛ لا يمكن تحريك الجلسة.',
        'blocking_conflicts', '[]'::jsonb,
        'warnings', '[]'::jsonb,
        'approved_exceptions', '[]'::jsonb,
        'normalized_proposal', NULL
      );
    END IF;

    IF COALESCE((v_guard->>'is_v2')::boolean, false) THEN
      SELECT COALESCE(ta.assigned_component_hours, pcc.weekly_contact_hours, 0)
        INTO v_assigned
      FROM public.teaching_assignments ta
      LEFT JOIN public.plan_course_components pcc ON pcc.id = ta.plan_course_component_id
      WHERE ta.id = v_session.teaching_assignment_id;
      v_proposed := public._sb_v2_wall_hours(p_target_start_time, p_target_end_time);
      v_scheduled := public._sb_v2_scheduled_hours_for_assignment(
        v_session.schedule_version_id, v_session.teaching_assignment_id, v_session.id
      );
      IF v_scheduled + v_proposed > v_assigned THEN
        RETURN jsonb_build_object(
          'valid', false,
          'code', 'OVER_SCHEDULED',
          'stale', false,
          'message_ar', 'تجاوز الساعات المكلف بها.',
          'blocking_conflicts', jsonb_build_array(jsonb_build_object(
            'code', 'over_scheduled', 'severity', 'hard',
            'message_ar', 'تجاوز الساعات المكلف بها.'
          )),
          'warnings', '[]'::jsonb,
          'approved_exceptions', '[]'::jsonb,
          'normalized_proposal', NULL
        );
      END IF;
    END IF;
  END IF;

  v_bundle := public._collect_schedule_session_move_conflicts(
    v_session.id,
    v_session.college_id,
    v_session.schedule_version_id,
    v_session.instructor_id,
    v_session.section_id,
    v_session.course_offering_id,
    v_session.teaching_assignment_id,
    v_session.study_system,
    v_session.expected_students,
    p_target_day_of_week,
    p_target_start_time,
    p_target_end_time,
    p_target_room_id
  );

  IF v_session.delivery_group_id IS NOT NULL THEN
    v_dg_conflicts := public._sb_v2_delivery_group_overlap(
      v_session.schedule_version_id,
      v_session.delivery_group_id,
      v_session.cohort_id,
      p_target_day_of_week,
      p_target_start_time,
      p_target_end_time,
      v_session.id
    );
    IF jsonb_array_length(v_dg_conflicts) > 0 THEN
      v_bundle := jsonb_set(
        v_bundle,
        '{blocking_conflicts}',
        COALESCE(v_bundle->'blocking_conflicts', '[]'::jsonb) || v_dg_conflicts
      );
    END IF;
  END IF;

  v_blocking_len := jsonb_array_length(COALESCE(v_bundle->'blocking_conflicts', '[]'::jsonb));

  RETURN jsonb_build_object(
    'valid', v_blocking_len = 0 AND jsonb_array_length(COALESCE(v_bundle->'warnings', '[]'::jsonb)) = 0,
    'code', CASE WHEN v_blocking_len > 0 THEN 'BLOCKED_CONFLICTS' ELSE NULL END,
    'stale', false,
    'blocking_conflicts', COALESCE(v_bundle->'blocking_conflicts', '[]'::jsonb),
    'warnings', COALESCE(v_bundle->'warnings', '[]'::jsonb),
    'approved_exceptions', COALESCE(v_bundle->'approved_exceptions', '[]'::jsonb),
    'normalized_proposal', jsonb_build_object(
      'day_of_week', p_target_day_of_week,
      'start_time', p_target_start_time,
      'end_time', p_target_end_time,
      'room_id', p_target_room_id
    )
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public._ss_gather(a uuid, b uuid, c uuid, d uuid, e uuid, f uuid, g uuid, h text, i integer, j integer, k time without time zone, l time without time zone, m uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
SELECT COALESCE(public._ss_peer_i(a,b,c,d,j,k,l),'[]'::jsonb)
 ||COALESCE(public._ss_peer_r(a,b,c,m,j,k,l),'[]'::jsonb)
 ||COALESCE(public._ss_peer_s(a,b,c,e,j,k,l),'[]'::jsonb)
 ||COALESCE(public._ss_room_cap(a,b,f,i,m),'[]'::jsonb)
 ||COALESCE(public._ss_room_type(a,b,g,m),'[]'::jsonb)
 ||COALESCE(public._ss_room_av(a,b,m,j,k,l),'[]'::jsonb)
 ||COALESCE(public._ss_iavail_req(a,b,d,j),'[]'::jsonb)
 ||COALESCE(public._ss_iavail_win(a,b,d,j,k,l),'[]'::jsonb)
 ||COALESCE(public._ss_tmpl(a,b,h,j,k,l),'[]'::jsonb)
 ||COALESCE(public._ss_set(a,b,j,k,l),'[]'::jsonb)
 ||COALESCE(public._ss_brk(a,b,j,k,l),'[]'::jsonb);
$function$;
CREATE OR REPLACE FUNCTION public._ss_room_av(p_sid uuid, p_cid uuid, p_rid uuid, p_dow integer, p_st time without time zone, p_et time without time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb:='[]'::jsonb; cnt int; fits boolean;
BEGIN
  IF p_rid IS NULL THEN RETURN v; END IF;
  SELECT COUNT(*) INTO cnt FROM public.room_availability
  WHERE room_id=p_rid AND day_of_week=p_dow AND college_id=p_cid;
  IF cnt=0 THEN RETURN v; END IF;
  SELECT EXISTS(
    SELECT 1 FROM public.room_availability ra
    WHERE ra.room_id=p_rid AND ra.day_of_week=p_dow AND ra.college_id=p_cid
      AND p_st>=ra.start_time AND p_et<=ra.end_time
  ) INTO fits;
  IF NOT fits THEN
    v:=v||jsonb_build_array(public._ss_ci('room_availability','hard',p_sid,NULL,
      jsonb_build_object('room_id',p_rid,'day_of_week',p_dow)));
  END IF;
  RETURN v;
END;$function$;
CREATE OR REPLACE FUNCTION public._import_apply_teaching_assignments_v2(p_college uuid, p_mode text, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_len int := COALESCE(jsonb_array_length(p_rows), 0);
  v_idx int; v jsonb; v_rn int; v_payload jsonb; v_res jsonb;
BEGIN
  FOR v_idx IN 0 .. v_len - 1 LOOP
    v := public._import_row_values(p_rows -> v_idx);
    v_rn := public._import_row_number(p_rows -> v_idx, v_idx + 1);
    IF NULLIF(v->>'_delivery_group_id', '') IS NULL OR NULLIF(v->>'_instructor_id', '') IS NULL THEN
      RAISE EXCEPTION 'teaching_assignments_v2 row % missing delivery_group/instructor', v_rn USING ERRCODE = '22023';
    END IF;
    IF v->>'component_type' = 'summer_training' THEN
      RAISE EXCEPTION 'teaching_assignments_v2 row %: summer training cannot be assigned as weekly teaching', v_rn USING ERRCODE = '22023';
    END IF;
  END LOOP;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'row_number', public._import_row_number(p_rows -> ord, ord + 1),
      'delivery_group_id', vv->>'_delivery_group_id',
      'instructor_id', vv->>'_instructor_id',
      'assigned_component_hours',
        CASE
          WHEN NULLIF(vv->>'_assigned_component_hours', '') IS NOT NULL
            THEN (vv->>'_assigned_component_hours')::numeric
          WHEN NULLIF(vv->>'assigned_component_hours', '') IS NOT NULL
            THEN (vv->>'assigned_component_hours')::numeric
          ELSE NULL
        END,
      'notes', NULLIF(vv->>'notes', ''),
      'is_active', COALESCE(NULLIF(vv->>'_is_active', '')::boolean, true),
      'course_offering_id', NULLIF(vv->>'_offering_id', ''),
      'expected_students', COALESCE(NULLIF(vv->>'expected_students', '')::int, 0),
      'required_room_type', NULLIF(vv->>'required_room_type', ''),
      'session_type', CASE vv->>'component_type'
        WHEN 'theory' THEN 'lecture'
        WHEN 'practical' THEN 'lab'
        WHEN 'tutorial' THEN 'tutorial'
        WHEN 'project' THEN 'seminar'
        WHEN 'summer_training' THEN 'seminar'
        ELSE 'lecture'
      END
    ) ORDER BY ord
  ), '[]'::jsonb)
  INTO v_payload
  FROM generate_series(0, GREATEST(v_len - 1, -1)) AS ord
  CROSS JOIN LATERAL (SELECT public._import_row_values(p_rows -> ord) AS vv) AS lat;

  IF jsonb_array_length(v_payload) = 0 THEN
    RETURN public._import_counters_new();
  END IF;

  v_res := public.commit_teaching_assignments_v2_import(v_payload, p_mode);
  IF COALESCE(v_res->>'status', '') <> 'ok' THEN
    RAISE EXCEPTION 'teaching_assignments_v2 import failed: %',
      COALESCE(v_res->'validation_errors', '[]'::jsonb)::text
      USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object(
    'inserted', COALESCE((v_res->>'rows_created')::int, 0) + COALESCE((v_res->>'rows_reactivated')::int, 0),
    'updated',  COALESCE((v_res->>'rows_updated')::int, 0),
    'skipped',  COALESCE((v_res->>'rows_unchanged')::int, 0)
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public._import_counters_new()
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object('inserted', 0, 'updated', 0, 'skipped', 0);
$function$;
CREATE OR REPLACE FUNCTION public._import_row_number(elem jsonb, idx integer)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(NULLIF(elem->>'rowNumber', '')::int, NULLIF(elem->>'row_number', '')::int, idx);
$function$;
CREATE OR REPLACE FUNCTION public.instructor_availability_enforced(p_college_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT ss.enforce_instructor_availability
       FROM public.scheduling_settings ss
      WHERE ss.college_id = p_college_id
      LIMIT 1),
    false);
$function$;
CREATE OR REPLACE FUNCTION public.lock_delivery_group_for_assignment(p_delivery_group_id uuid)
 RETURNS delivery_groups
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_dg public.delivery_groups%ROWTYPE;
BEGIN
  IF p_delivery_group_id IS NULL THEN
    RAISE EXCEPTION 'DELIVERY_GROUP_ID_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_dg
  FROM public.delivery_groups dg
  WHERE dg.id = p_delivery_group_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DELIVERY_GROUP_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;

  -- Deterministic lock of active assignment rows for this group
  PERFORM 1
  FROM public.teaching_assignments ta
  WHERE ta.delivery_group_id = p_delivery_group_id
    AND ta.is_active = TRUE
  ORDER BY ta.id
  FOR UPDATE;

  RETURN v_dg;
END;
$function$;
CREATE OR REPLACE FUNCTION public._ss_peer_s(p_sid uuid, p_cid uuid, p_vid uuid, p_sec uuid, p_dow integer, p_st time without time zone, p_et time without time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb:='[]'::jsonb; r record; sg uuid;
BEGIN
  IF p_sec IS NULL THEN RETURN v; END IF;
  sg:=public._ss_sg(p_sid);
  FOR r IN
    SELECT id,section_id,section_subgroup_id,day_of_week,start_time,end_time
    FROM public.schedule_sessions
    WHERE college_id=p_cid AND schedule_version_id=p_vid AND id<>p_sid
      AND COALESCE(replaced_by_split,false)=false
      AND section_id=p_sec AND day_of_week=p_dow
  LOOP
    IF public._ss_ov(r.start_time,r.end_time,p_st,p_et)
       AND public._ss_sec_hit(p_sec,r.section_id,sg,r.section_subgroup_id) THEN
      v:=v||jsonb_build_array(public._ss_ci('section_conflict','hard',p_sid,r.id,
        jsonb_build_object('section_id',p_sec,'day_of_week',p_dow)));
    END IF;
  END LOOP;
  RETURN v;
END;$function$;
CREATE OR REPLACE FUNCTION public._import_apply_cohort_elective_selections(p_college uuid, p_mode text, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_len int := COALESCE(jsonb_array_length(p_rows), 0);
  v_idx int; v jsonb; v_rn int; v_id uuid; v_exists boolean; v_action text;
  v_ins int := 0; v_upd int := 0; v_skp int := 0;
BEGIN
  FOR v_idx IN 0 .. v_len - 1 LOOP
    v := public._import_row_values(p_rows -> v_idx);
    v_rn := public._import_row_number(p_rows -> v_idx, v_idx + 1);
    IF NULLIF(v->>'_cohort_id', '') IS NULL OR NULLIF(v->>'_elective_slot_id', '') IS NULL
       OR NULLIF(v->>'_course_id', '') IS NULL THEN
      RAISE EXCEPTION 'cohort_elective_selections row % missing cohort/slot/course', v_rn USING ERRCODE = '22023';
    END IF;
  END LOOP;
  FOR v_idx IN 0 .. v_len - 1 LOOP
    v := public._import_row_values(p_rows -> v_idx);
    v_id := NULL;
    SELECT id INTO v_id FROM public.cohort_elective_selections
      WHERE college_id = p_college AND cohort_id = (v->>'_cohort_id')::uuid
        AND elective_slot_id = (v->>'_elective_slot_id')::uuid
      ORDER BY id ASC LIMIT 1 FOR UPDATE;
    v_exists := v_id IS NOT NULL;
    v_action := public._import_mode_action(p_mode, v_exists);
    IF v_action = 'skip' THEN v_skp := v_skp + 1;
    ELSIF v_action = 'insert' THEN
      INSERT INTO public.cohort_elective_selections (
        college_id, cohort_id, elective_slot_id, selected_course_id
      ) VALUES (
        p_college, (v->>'_cohort_id')::uuid, (v->>'_elective_slot_id')::uuid, (v->>'_course_id')::uuid
      );
      v_ins := v_ins + 1;
    ELSE
      UPDATE public.cohort_elective_selections SET
        selected_course_id = (v->>'_course_id')::uuid
      WHERE id = v_id;
      v_upd := v_upd + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'skipped', v_skp);
END;
$function$;
CREATE OR REPLACE FUNCTION public._ss_iavail_win(p_sid uuid, p_cid uuid, p_iid uuid, p_dow integer, p_st time without time zone, p_et time without time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb:='[]'::jsonb; cnt int; fits boolean; blocked boolean;
BEGIN
  IF NOT public.instructor_availability_enforced(p_cid) THEN RETURN v; END IF;
  SELECT COUNT(*) INTO cnt FROM public.instructor_availability ia
  WHERE ia.instructor_id=p_iid AND ia.day_of_week=p_dow AND ia.is_preference=false AND ia.college_id=p_cid;
  IF cnt=0 THEN RETURN v; END IF;
  SELECT EXISTS(
    SELECT 1 FROM public.instructor_availability ia
    WHERE ia.instructor_id=p_iid AND ia.day_of_week=p_dow AND ia.is_preference=false
      AND ia.college_id=p_cid AND ia.availability_type IS DISTINCT FROM 'unavailable'
      AND p_st>=ia.start_time AND p_et<=ia.end_time
  ) INTO fits;
  SELECT EXISTS(
    SELECT 1 FROM public.instructor_availability ia
    WHERE ia.instructor_id=p_iid AND ia.day_of_week=p_dow AND ia.is_preference=false
      AND ia.college_id=p_cid AND ia.availability_type='unavailable'
      AND ia.start_time<p_et AND p_st<ia.end_time
  ) INTO blocked;
  IF (NOT fits) OR blocked THEN
    v:=v||jsonb_build_array(public._ss_ci('instructor_availability','hard',p_sid,NULL,
      jsonb_build_object('instructor_id',p_iid,'day_of_week',p_dow)));
  END IF;
  RETURN v;
END;$function$;
CREATE OR REPLACE FUNCTION public._ss_peer_r(p_sid uuid, p_cid uuid, p_vid uuid, p_rid uuid, p_dow integer, p_st time without time zone, p_et time without time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb:='[]'::jsonb; r record;
BEGIN
  IF p_rid IS NULL THEN RETURN v; END IF;
  FOR r IN
    SELECT id,room_id,day_of_week,start_time,end_time FROM public.schedule_sessions
    WHERE college_id=p_cid AND schedule_version_id=p_vid AND id<>p_sid
      AND COALESCE(replaced_by_split,false)=false
      AND room_id=p_rid AND day_of_week=p_dow
  LOOP
    IF public._ss_ov(r.start_time,r.end_time,p_st,p_et) THEN
      v:=v||jsonb_build_array(public._ss_ci('room_conflict','hard',p_sid,r.id,
        jsonb_build_object('room_id',p_rid,'day_of_week',p_dow)));
    END IF;
  END LOOP;
  RETURN v;
END;$function$;
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'super_admin');
$function$;
CREATE OR REPLACE FUNCTION public._ss_room_cap(p_sid uuid, p_cid uuid, p_off uuid, p_exp integer, p_rid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb:='[]'::jsonb; rm record; n int; st text; item jsonb;
BEGIN
  IF p_rid IS NULL THEN RETURN v; END IF;
  SELECT id,capacity,college_id,is_active INTO rm FROM public.rooms WHERE id=p_rid;
  IF rm.id IS NULL OR rm.college_id<>p_cid OR COALESCE(rm.is_active,true)=false THEN
    RETURN v||jsonb_build_array(public._ss_ci('room_college_mismatch','hard',p_sid,NULL,
      jsonb_build_object('room_id',p_rid)));
  END IF;
  SELECT * INTO n,st FROM public._ss_enroll(p_off,p_exp);
  item:=public._ss_cap(p_sid,st,n,rm.capacity);
  IF item IS NOT NULL THEN v:=v||jsonb_build_array(item); END IF;
  RETURN v;
END;$function$;
CREATE OR REPLACE FUNCTION public.get_delivery_group_assignment_candidates(p_delivery_group_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_dg public.delivery_groups%ROWTYPE;
  v_pcc public.plan_course_components%ROWTYPE;
  v_candidates jsonb := '[]'::jsonb;
  v_alloc jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  IF p_delivery_group_id IS NULL THEN
    RAISE EXCEPTION 'DELIVERY_GROUP_ID_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_dg FROM public.delivery_groups WHERE id = p_delivery_group_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DELIVERY_GROUP_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT public.can_view_college(v_uid, v_dg.college_id) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_pcc FROM public.plan_course_components WHERE id = v_dg.component_id;
  v_alloc := public.compute_delivery_group_allocation(p_delivery_group_id);

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'instructor_id', i.id,
      'full_name', i.full_name,
      'employee_number', i.employee_number,
      'academic_rank', i.academic_rank,
      'already_assigned', EXISTS (
        SELECT 1 FROM public.teaching_assignments ta
        WHERE ta.delivery_group_id = p_delivery_group_id
          AND ta.instructor_id = i.id
          AND ta.is_active = TRUE
      )
    ) ORDER BY i.full_name
  ), '[]'::jsonb)
  INTO v_candidates
  FROM public.instructors i
  WHERE i.college_id = v_dg.college_id
    AND i.is_active = TRUE;

  RETURN jsonb_build_object(
    'ok', true,
    'delivery_group_id', p_delivery_group_id,
    'college_id', v_dg.college_id,
    'is_obsolete', COALESCE(v_dg.is_obsolete, false),
    'active', COALESCE(v_dg.active, true),
    'component_type', v_pcc.component_type,
    'component_hours', v_pcc.weekly_contact_hours,
    'allocation', v_alloc,
    'candidates', v_candidates,
    'assignable', NOT COALESCE(v_dg.is_obsolete, false)
      AND COALESCE(v_dg.active, true)
      AND COALESCE(v_pcc.component_type, '') IS DISTINCT FROM 'summer_training'
      AND public.can_manage_college(v_uid, v_dg.college_id)
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.upsert_scheduling_cohort_term_headcount(p_cohort_id uuid, p_term_id uuid, p_registered_student_count integer, p_eligible_student_count integer, p_expected_attendance_count integer, p_reserve_margin integer DEFAULT 0, p_scheduling_headcount integer DEFAULT 0, p_exam_eligible_count integer DEFAULT 0, p_source text DEFAULT ''::text, p_notes text DEFAULT NULL::text, p_allow_over_eligible boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_cohort public.academic_cohorts%ROWTYPE;
  v_row public.scheduling_cohort_term_headcounts%ROWTYPE; v_kind text;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'AUTH_REQUIRED', 'message', 'Authentication required'); END IF;
  SELECT * INTO v_cohort FROM public.academic_cohorts WHERE id = p_cohort_id;
  IF NOT FOUND OR v_cohort.term_id <> p_term_id THEN RETURN jsonb_build_object('ok', false, 'code', 'COHORT_TERM_NOT_FOUND', 'message', 'Cohort and term must match'); END IF;
  IF NOT public.can_manage_college(v_uid, v_cohort.college_id) THEN RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'College management permission required'); END IF;
  IF NULLIF(btrim(p_source), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'SOURCE_REQUIRED', 'message', 'Headcount source is required');
  END IF;
  IF p_registered_student_count < 0 OR p_eligible_student_count < 0 OR p_expected_attendance_count < 0
    OR p_reserve_margin < 0 OR p_scheduling_headcount < 0 OR p_exam_eligible_count < 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NEGATIVE_COUNT', 'message', 'Counts cannot be negative');
  END IF;
  IF (p_scheduling_headcount > p_eligible_student_count OR p_expected_attendance_count > p_eligible_student_count)
    AND (NOT p_allow_over_eligible OR NULLIF(btrim(p_notes), '') IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'OVER_ELIGIBLE_REQUIRES_REASON', 'message', 'Over-eligible values require manager override and notes');
  END IF;
  SELECT * INTO v_row FROM public.scheduling_cohort_term_headcounts WHERE cohort_id = p_cohort_id AND term_id = p_term_id FOR UPDATE;
  v_kind := CASE WHEN FOUND THEN 'update' ELSE 'create' END;
  INSERT INTO public.scheduling_cohort_term_headcounts (
    college_id, cohort_id, term_id, study_system, registered_student_count, eligible_student_count,
    expected_attendance_count, reserve_margin, scheduling_headcount, exam_eligible_count, source, notes
  ) VALUES (
    v_cohort.college_id, p_cohort_id, p_term_id, v_cohort.study_system, p_registered_student_count,
    p_eligible_student_count, p_expected_attendance_count, p_reserve_margin, p_scheduling_headcount,
    p_exam_eligible_count, p_source, p_notes
  ) ON CONFLICT (cohort_id, term_id) DO UPDATE SET
    registered_student_count = EXCLUDED.registered_student_count, eligible_student_count = EXCLUDED.eligible_student_count,
    expected_attendance_count = EXCLUDED.expected_attendance_count, reserve_margin = EXCLUDED.reserve_margin,
    scheduling_headcount = EXCLUDED.scheduling_headcount, exam_eligible_count = EXCLUDED.exam_eligible_count,
    source = EXCLUDED.source, notes = EXCLUDED.notes, study_system = EXCLUDED.study_system,
    approval_status = 'draft', approved_by = NULL, approved_at = NULL
  RETURNING * INTO v_row;
  INSERT INTO public.scheduling_headcount_revisions (college_id, headcount_id, revision_kind, snapshot, changed_by, notes)
    VALUES (v_row.college_id, v_row.id, v_kind, to_jsonb(v_row), v_uid, p_notes);
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
    VALUES (v_uid, 'scheduling_headcount_upsert', 'scheduling_cohort_term_headcounts', v_row.id, v_row.college_id, jsonb_build_object('revision_kind', v_kind));
  RETURN jsonb_build_object('ok', true, 'headcount', to_jsonb(v_row));
END; $function$;
CREATE OR REPLACE FUNCTION public.compute_instructor_standard_workload(p_instructor_id uuid, p_term_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_instructor public.instructors%ROWTYPE;
  v_required numeric;
  v_rank_code text;
  v_standard numeric := 0;
  v_project numeric := 0;
  v_status text;
  v_deficit numeric := 0;
  v_overload numeric := 0;
BEGIN
  IF p_instructor_id IS NULL THEN
    RAISE EXCEPTION 'INSTRUCTOR_ID_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_instructor FROM public.instructors WHERE id = p_instructor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INSTRUCTOR_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    public.can_view_college(v_uid, v_instructor.college_id)
    OR public.can_manage_college(v_uid, v_instructor.college_id)
  ) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  SELECT fwp.required_load_hours, fwp.rank_code
    INTO v_required, v_rank_code
  FROM public.faculty_workload_policies fwp
  WHERE fwp.college_id = v_instructor.college_id
    AND fwp.active = true
    AND (
      lower(fwp.rank_code) = lower(COALESCE(v_instructor.academic_rank, ''))
      OR EXISTS (
        SELECT 1
        FROM unnest(fwp.rank_aliases) alias
        WHERE lower(alias) = lower(COALESCE(v_instructor.academic_rank, ''))
      )
    )
  ORDER BY fwp.rank_code
  LIMIT 1;

  SELECT
    COALESCE(SUM(w.standard_assigned_hours), 0),
    COALESCE(SUM(w.project_supervision_hours), 0)
  INTO v_standard, v_project
  FROM public.v_instructor_delivery_workload w
  WHERE w.instructor_id = p_instructor_id
    AND w.college_id = v_instructor.college_id
    AND (p_term_id IS NULL OR w.term_id = p_term_id);

  IF v_required IS NULL THEN
    v_status := 'policy_missing';
  ELSIF v_standard = 0 THEN
    v_status := 'unassigned';
  ELSIF v_standard > v_required THEN
    v_status := 'overload';
    v_overload := v_standard - v_required;
  ELSIF v_standard < v_required THEN
    v_status := 'deficit';
    v_deficit := v_required - v_standard;
  ELSE
    v_status := 'ok';
  END IF;

  RETURN jsonb_build_object(
    'instructor_id', p_instructor_id,
    'college_id', v_instructor.college_id,
    'term_id', p_term_id,
    'rank_code', v_rank_code,
    'academic_rank', v_instructor.academic_rank,
    'required_load_hours', v_required,
    'standard_assigned_hours', v_standard,
    'project_supervision_hours', v_project,
    'deficit_hours', v_deficit,
    'overload_hours', v_overload,
    'status', v_status
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.rebuild_cohort_student_partitions(p_cohort_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_college uuid;
  v_parts integer;
  v_maps integer;
  v_bad integer;
BEGIN
  IF p_cohort_id IS NULL THEN
    RAISE EXCEPTION 'COHORT_ID_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  SELECT ac.college_id INTO v_college
  FROM public.academic_cohorts ac
  WHERE ac.id = p_cohort_id
    AND COALESCE(ac.active, false) = true
    AND public.can_manage_college(v_uid, ac.college_id);
  IF v_college IS NULL THEN
    RAISE EXCEPTION 'COHORT_NOT_FOUND_OR_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.delivery_group_partition_members WHERE cohort_id = p_cohort_id;
  DELETE FROM public.cohort_student_partitions WHERE cohort_id = p_cohort_id;

  WITH grp AS (
    SELECT dg.component_id, dg.group_number, dg.expected_students,
           SUM(dg.expected_students) OVER (
             PARTITION BY dg.component_id ORDER BY dg.group_number
             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS end_idx
    FROM public.delivery_groups dg
    WHERE dg.cohort_id = p_cohort_id
      AND dg.college_id = v_college
      AND dg.active = true
      AND COALESCE(dg.is_obsolete, false) = false
      AND COALESCE(dg.expected_students, 0) > 0
  ), bounds AS (
    SELECT 0::bigint AS b UNION SELECT DISTINCT end_idx FROM grp
  ), ord AS (
    SELECT b, lag(b) OVER (ORDER BY b) AS prev_b, row_number() OVER (ORDER BY b) AS rn FROM bounds
  )
  INSERT INTO public.cohort_student_partitions (college_id, cohort_id, partition_code, headcount, active)
  SELECT v_college, p_cohort_id, 'A' || lpad((rn - 1)::text, 3, '0'), (b - prev_b)::int, true
  FROM ord
  WHERE prev_b IS NOT NULL AND b > prev_b;

  WITH grp AS (
    SELECT dg.id AS delivery_group_id, dg.component_id, dg.group_number, dg.expected_students,
           (SUM(dg.expected_students) OVER (
             PARTITION BY dg.component_id ORDER BY dg.group_number
             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) - dg.expected_students + 1)::int AS start_idx,
           (SUM(dg.expected_students) OVER (
             PARTITION BY dg.component_id ORDER BY dg.group_number
             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW))::int AS end_idx
    FROM public.delivery_groups dg
    WHERE dg.cohort_id = p_cohort_id
      AND dg.college_id = v_college
      AND dg.active = true
      AND COALESCE(dg.is_obsolete, false) = false
      AND COALESCE(dg.expected_students, 0) > 0
  ), parts AS (
    SELECT id, headcount,
           (SUM(headcount) OVER (ORDER BY partition_code) - headcount + 1)::int AS start_idx,
           (SUM(headcount) OVER (ORDER BY partition_code))::int AS end_idx
    FROM public.cohort_student_partitions
    WHERE cohort_id = p_cohort_id AND active = true
  )
  INSERT INTO public.delivery_group_partition_members (college_id, cohort_id, delivery_group_id, partition_id)
  SELECT v_college, p_cohort_id, g.delivery_group_id, p.id
  FROM grp g
  JOIN parts p ON p.start_idx >= g.start_idx AND p.end_idx <= g.end_idx;

  SELECT count(*) INTO v_bad
  FROM public.delivery_groups dg
  WHERE dg.cohort_id = p_cohort_id
    AND dg.college_id = v_college
    AND dg.active = true
    AND COALESCE(dg.is_obsolete, false) = false
    AND COALESCE(dg.expected_students, 0) > 0
    AND COALESCE((
      SELECT SUM(p.headcount)
      FROM public.delivery_group_partition_members m
      JOIN public.cohort_student_partitions p ON p.id = m.partition_id AND p.active
      WHERE m.delivery_group_id = dg.id
    ), 0) <> dg.expected_students;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'PARTITION_COVERAGE_MISMATCH %', v_bad USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO v_parts FROM public.cohort_student_partitions
    WHERE cohort_id = p_cohort_id AND active = true;
  SELECT count(*) INTO v_maps FROM public.delivery_group_partition_members
    WHERE cohort_id = p_cohort_id;

  RETURN jsonb_build_object('cohort_id', p_cohort_id, 'college_id', v_college,
    'partitions', v_parts, 'mappings', v_maps, 'bad', v_bad);
END;
$function$;
CREATE OR REPLACE FUNCTION public.update_teaching_assignment_v2(p_assignment_id uuid, p_expected_updated_at timestamp with time zone, p_assigned_component_hours numeric DEFAULT NULL::numeric, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.teaching_assignments%ROWTYPE;
  v_dg public.delivery_groups%ROWTYPE;
  v_old_hours numeric;
  v_pcc_type text;
  v_pcc_hours numeric;
  v_effective numeric;
  v_dg_id uuid;
  v_college_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  IF p_assignment_id IS NULL OR p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'ASSIGNMENT_ID_AND_EXPECTED_UPDATED_AT_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;

  -- Resolve context without locking assignment first (stable lock order)
  SELECT ta.delivery_group_id, ta.college_id
    INTO v_dg_id, v_college_id
  FROM public.teaching_assignments ta
  WHERE ta.id = p_assignment_id;
  IF v_college_id IS NULL THEN
    RAISE EXCEPTION 'ASSIGNMENT_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT public.can_manage_college(v_uid, v_college_id) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  IF v_dg_id IS NULL THEN
    RAISE EXCEPTION 'LEGACY_ASSIGNMENT_NOT_SUPPORTED_BY_V2_RPC' USING ERRCODE = 'check_violation';
  END IF;

  v_dg := public.lock_delivery_group_for_assignment(v_dg_id);
  PERFORM public.assert_delivery_group_assignable(v_dg.is_obsolete, v_dg.active);

  SELECT * INTO v_row
  FROM public.teaching_assignments
  WHERE id = p_assignment_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ASSIGNMENT_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_row.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'STALE_ASSIGNMENT_UPDATE' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT v_row.is_active THEN
    RAISE EXCEPTION 'INACTIVE_ASSIGNMENT_UPDATE_FORBIDDEN' USING ERRCODE = 'check_violation';
  END IF;

  IF p_assigned_component_hours IS NOT NULL AND p_assigned_component_hours <= 0 THEN
    RAISE EXCEPTION 'ASSIGNED_HOURS_MUST_BE_POSITIVE' USING ERRCODE = 'check_violation';
  END IF;

  v_old_hours := v_row.assigned_component_hours;
  SELECT pcc.component_type,
         pcc.weekly_contact_hours,
         COALESCE(p_assigned_component_hours, v_row.assigned_component_hours, pcc.weekly_contact_hours, 0)
    INTO v_pcc_type, v_pcc_hours, v_effective
  FROM public.plan_course_components pcc
  WHERE pcc.id = v_row.plan_course_component_id;

  PERFORM public.validate_assignment_allocation_locked(
    v_dg_id,
    p_assignment_id,
    COALESCE(p_assigned_component_hours, v_row.assigned_component_hours),
    v_pcc_hours,
    true
  );

  UPDATE public.teaching_assignments SET
    assigned_component_hours = COALESCE(p_assigned_component_hours, assigned_component_hours),
    weekly_hours = v_effective,
    notes = COALESCE(p_notes, notes)
  WHERE id = p_assignment_id
  RETURNING * INTO v_row;

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (
    v_uid,
    'teaching_assignment_hours_updated',
    'teaching_assignments',
    v_row.id,
    v_row.college_id,
    jsonb_build_object(
      'assignment_id', v_row.id,
      'delivery_group_id', v_row.delivery_group_id,
      'instructor_id', v_row.instructor_id,
      'component_type', v_pcc_type,
      'old_assigned_hours', v_old_hours,
      'new_assigned_hours', v_row.assigned_component_hours
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'action', 'updated',
    'assignment_id', v_row.id,
    'assigned_component_hours', v_row.assigned_component_hours,
    'updated_at', v_row.updated_at,
    'allocation', public.compute_delivery_group_allocation(v_row.delivery_group_id)
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public._ss_iavail_req(p_sid uuid, p_cid uuid, p_iid uuid, p_dow integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb:='[]'::jsonb; code text; ext boolean; req boolean; cnt int;
BEGIN
  IF NOT public.instructor_availability_enforced(p_cid) THEN RETURN v; END IF;
  SELECT it.code,it.is_external INTO code,ext
  FROM public.instructors i LEFT JOIN public.instructor_types it ON it.id=i.instructor_type_id
  WHERE i.id=p_iid;
  req:=(lower(COALESCE(code,''))='from_other_college' OR COALESCE(ext,false));
  SELECT COUNT(*) INTO cnt FROM public.instructor_availability ia
  WHERE ia.instructor_id=p_iid AND ia.day_of_week=p_dow AND ia.is_preference=false AND ia.college_id=p_cid;
  IF cnt=0 AND req THEN
    v:=v||jsonb_build_array(public._ss_ci('instructor_availability_required','hard',p_sid,NULL,
      jsonb_build_object('instructor_id',p_iid,'day_of_week',p_dow)));
  END IF;
  RETURN v;
END;$function$;
CREATE OR REPLACE FUNCTION public._ss_ex_match(p_vid uuid, p_code text, p_sid uuid, p_rid uuid, OUT ok boolean, OUT eid uuid, OUT ereas text)
 RETURNS record
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  ok:=false; eid:=NULL; ereas:=NULL;
  IF p_sid IS NULL THEN RETURN; END IF;
  IF p_rid IS NULL THEN
    SELECT id,reason INTO eid,ereas FROM public.schedule_version_conflict_exceptions
    WHERE schedule_version_id=p_vid AND conflict_code=p_code AND status='approved'
      AND session_id=p_sid AND related_session_id IS NULL LIMIT 1;
  ELSE
    SELECT id,reason INTO eid,ereas FROM public.schedule_version_conflict_exceptions
    WHERE schedule_version_id=p_vid AND conflict_code=p_code AND status='approved'
      AND related_session_id IS NOT NULL
      AND LEAST(session_id,related_session_id)=LEAST(p_sid,p_rid)
      AND GREATEST(session_id,related_session_id)=GREATEST(p_sid,p_rid) LIMIT 1;
  END IF;
  IF FOUND THEN ok:=true; ELSE eid:=NULL; ereas:=NULL; END IF;
END;$function$;
CREATE OR REPLACE FUNCTION public.schedule_version_delivery_coverage(p_college_id uuid, p_schedule_version_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_term_id uuid;
  v_result jsonb;
BEGIN
  SELECT academic_term_id INTO v_term_id
  FROM public.schedule_versions
  WHERE id = p_schedule_version_id AND college_id = p_college_id;

  IF v_term_id IS NULL THEN
    RAISE EXCEPTION 'SCHEDULE_VERSION_NOT_FOUND' USING ERRCODE='P0002';
  END IF;

  WITH expected AS (
    SELECT dg.id AS delivery_group_id,
           pcc.weekly_contact_hours::numeric AS required_hours
    FROM public.delivery_groups dg
    JOIN public.academic_cohorts ac ON ac.id = dg.cohort_id
    JOIN public.plan_course_components pcc ON pcc.id = dg.component_id
    WHERE dg.college_id = p_college_id
      AND ac.term_id = v_term_id
      AND ac.active = true
      AND dg.active = true
      AND COALESCE(dg.is_obsolete,false) = false
      AND COALESCE(pcc.is_timetabled,true) = true
  ), assignments AS (
    SELECT ta.delivery_group_id,
           count(*) FILTER (WHERE ta.is_active=true)::integer AS active_assignments
    FROM public.teaching_assignments ta
    WHERE ta.college_id = p_college_id
    GROUP BY ta.delivery_group_id
  ), sessions AS (
    SELECT ss.delivery_group_id,
           count(*)::integer AS session_count,
           sum(extract(epoch FROM (ss.end_time-ss.start_time))/3600.0)::numeric AS scheduled_hours
    FROM public.schedule_sessions ss
    WHERE ss.college_id = p_college_id
      AND ss.schedule_version_id = p_schedule_version_id
      AND COALESCE(ss.replaced_by_split,false)=false
      AND ss.delivery_group_id IS NOT NULL
    GROUP BY ss.delivery_group_id
  ), a AS (
    SELECT e.delivery_group_id,
           e.required_hours,
           COALESCE(x.active_assignments,0) AS active_assignments,
           COALESCE(s.session_count,0) AS session_count,
           COALESCE(s.scheduled_hours,0)::numeric AS scheduled_hours
    FROM expected e
    LEFT JOIN assignments x ON x.delivery_group_id=e.delivery_group_id
    LEFT JOIN sessions s ON s.delivery_group_id=e.delivery_group_id
  ), totals AS (
    SELECT count(*)::integer AS total_groups,
           count(*) FILTER (WHERE active_assignments=1)::integer AS assigned_exactly_once,
           count(*) FILTER (WHERE active_assignments=0)::integer AS unassigned_groups,
           count(*) FILTER (WHERE active_assignments>1)::integer AS multi_assigned_groups,
           count(*) FILTER (WHERE session_count>0)::integer AS groups_with_sessions,
           count(*) FILTER (WHERE session_count=0)::integer AS groups_without_sessions,
           count(*) FILTER (WHERE abs(scheduled_hours-required_hours)<0.001)::integer AS exact_hours_groups,
           count(*) FILTER (WHERE scheduled_hours<required_hours)::integer AS short_hours_groups,
           count(*) FILTER (WHERE scheduled_hours>required_hours)::integer AS over_hours_groups,
           COALESCE(sum(required_hours),0)::numeric AS required_hours,
           COALESCE(sum(scheduled_hours),0)::numeric AS scheduled_hours,
           COALESCE(sum(greatest(required_hours-scheduled_hours,0)),0)::numeric AS missing_hours,
           COALESCE(sum(greatest(scheduled_hours-required_hours,0)),0)::numeric AS extra_hours
    FROM a
  )
  SELECT jsonb_build_object(
    'total_groups', total_groups,
    'assigned_exactly_once', assigned_exactly_once,
    'unassigned_groups', unassigned_groups,
    'multi_assigned_groups', multi_assigned_groups,
    'groups_with_sessions', groups_with_sessions,
    'groups_without_sessions', groups_without_sessions,
    'exact_hours_groups', exact_hours_groups,
    'short_hours_groups', short_hours_groups,
    'over_hours_groups', over_hours_groups,
    'required_hours', required_hours,
    'scheduled_hours', scheduled_hours,
    'missing_hours', missing_hours,
    'extra_hours', extra_hours,
    'complete', (total_groups > 0
                 AND unassigned_groups=0
                 AND multi_assigned_groups=0
                 AND short_hours_groups=0
                 AND over_hours_groups=0)
  ) INTO v_result
  FROM totals;

  RETURN v_result;
END;
$function$;
CREATE OR REPLACE FUNCTION public.resolve_offering_for_delivery_group(p_delivery_group_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_dg public.delivery_groups%ROWTYPE;
  v_cohort public.academic_cohorts%ROWTYPE;
  v_offering_id uuid;
BEGIN
  SELECT * INTO v_dg FROM public.delivery_groups WHERE id = p_delivery_group_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_cohort FROM public.academic_cohorts WHERE id = v_dg.cohort_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT co.id INTO v_offering_id
  FROM public.course_offerings co
  WHERE co.college_id = v_dg.college_id
    AND co.plan_course_id = v_dg.plan_course_id
    AND co.term_id = v_cohort.term_id
    AND COALESCE(co.program_id, v_cohort.program_id) = v_cohort.program_id
    AND COALESCE(co.level_id, v_cohort.level_id) = v_cohort.level_id
    AND co.study_system = v_cohort.study_system
    AND COALESCE(co.is_active, true) = true
  ORDER BY co.created_at DESC NULLS LAST, co.id ASC
  LIMIT 1;

  RETURN v_offering_id;
END;
$function$;
CREATE OR REPLACE FUNCTION public.list_schedule_version_delivery_gaps(p_college_id uuid, p_schedule_version_id uuid)
 RETURNS TABLE(delivery_group_id uuid, cohort_id uuid, cohort_code text, program_id uuid, program_name text, program_code text, study_system text, level_id uuid, level_number integer, level_name text, course_code text, course_name text, component_type text, group_code text, group_number integer, expected_students integer, active_assignment_count integer, instructor_names text, required_hours numeric, scheduled_hours numeric, missing_hours numeric, scheduling_state text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
WITH version_ctx AS (
  SELECT academic_term_id AS term_id
  FROM public.schedule_versions
  WHERE id=p_schedule_version_id AND college_id=p_college_id
), expected AS (
  SELECT dg.id delivery_group_id, ac.id cohort_id, ac.code cohort_code,
         ap.id program_id, ap.name program_name, ap.code program_code,
         ac.study_system, al.id level_id, al.level_number, al.name level_name,
         c.code course_code, c.name course_name,
         pcc.component_type, dg.group_code, dg.group_number, dg.expected_students,
         pcc.weekly_contact_hours::numeric required_hours
  FROM public.delivery_groups dg
  JOIN public.academic_cohorts ac ON ac.id=dg.cohort_id
  JOIN public.academic_programs ap ON ap.id=ac.program_id
  JOIN public.academic_levels al ON al.id=ac.level_id
  JOIN public.plan_courses pc ON pc.id=dg.plan_course_id
  JOIN public.courses c ON c.id=pc.course_id
  JOIN public.plan_course_components pcc ON pcc.id=dg.component_id
  CROSS JOIN version_ctx v
  WHERE dg.college_id=p_college_id
    AND ac.term_id=v.term_id
    AND ac.active=true
    AND dg.active=true
    AND COALESCE(dg.is_obsolete,false)=false
    AND COALESCE(pcc.is_timetabled,true)=true
), ta AS (
  SELECT x.delivery_group_id,
         count(*) FILTER(WHERE x.is_active=true)::integer active_assignment_count,
         string_agg(DISTINCT i.full_name,'، ' ORDER BY i.full_name) FILTER(WHERE x.is_active=true) instructor_names
  FROM public.teaching_assignments x
  LEFT JOIN public.instructors i ON i.id=x.instructor_id
  WHERE x.college_id=p_college_id
  GROUP BY x.delivery_group_id
), ss AS (
  SELECT x.delivery_group_id,
         sum(extract(epoch FROM (x.end_time-x.start_time))/3600.0)::numeric scheduled_hours
  FROM public.schedule_sessions x
  WHERE x.college_id=p_college_id
    AND x.schedule_version_id=p_schedule_version_id
    AND COALESCE(x.replaced_by_split,false)=false
    AND x.delivery_group_id IS NOT NULL
  GROUP BY x.delivery_group_id
)
SELECT e.delivery_group_id,e.cohort_id,e.cohort_code,e.program_id,e.program_name,e.program_code,
       e.study_system,e.level_id,e.level_number,e.level_name,e.course_code,e.course_name,
       e.component_type,e.group_code,e.group_number,e.expected_students,
       COALESCE(ta.active_assignment_count,0),ta.instructor_names,e.required_hours,
       COALESCE(ss.scheduled_hours,0)::numeric,
       greatest(e.required_hours-COALESCE(ss.scheduled_hours,0),0)::numeric,
       CASE
         WHEN COALESCE(ta.active_assignment_count,0)=0 THEN 'unassigned'
         WHEN COALESCE(ta.active_assignment_count,0)>1 THEN 'multi_assigned'
         WHEN COALESCE(ss.scheduled_hours,0)=0 THEN 'unscheduled'
         WHEN COALESCE(ss.scheduled_hours,0)<e.required_hours THEN 'short_hours'
         WHEN COALESCE(ss.scheduled_hours,0)>e.required_hours THEN 'over_hours'
         ELSE 'complete'
       END scheduling_state
FROM expected e
LEFT JOIN ta ON ta.delivery_group_id=e.delivery_group_id
LEFT JOIN ss ON ss.delivery_group_id=e.delivery_group_id
WHERE COALESCE(ta.active_assignment_count,0)<>1
   OR abs(COALESCE(ss.scheduled_hours,0)-e.required_hours)>=0.001
ORDER BY e.program_name,e.study_system,e.level_number,e.course_code,e.component_type,e.group_number;
$function$;
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
CREATE OR REPLACE FUNCTION public.resolve_scheduling_headcount(p_college_id uuid, p_cohort_id uuid, p_term_id uuid, p_course_offering_id uuid DEFAULT NULL::uuid, p_plan_course_component_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_base public.scheduling_cohort_term_headcounts%ROWTYPE;
  v_override public.scheduling_headcount_overrides%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR NOT public.can_view_college(v_uid, p_college_id) THEN RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'College view permission required'); END IF;
  SELECT * INTO v_base FROM public.scheduling_cohort_term_headcounts
    WHERE college_id = p_college_id AND cohort_id = p_cohort_id AND term_id = p_term_id AND approval_status = 'approved';
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'SCHEDULING_HEADCOUNT_MISSING', 'blocker', true, 'message', 'Approved scheduling headcount is required before generation'); END IF;
  SELECT * INTO v_override FROM public.scheduling_headcount_overrides
    WHERE headcount_id = v_base.id AND active AND approval_status = 'approved'
      AND (course_offering_id IS NULL OR course_offering_id = p_course_offering_id)
      AND (plan_course_component_id IS NULL OR plan_course_component_id = p_plan_course_component_id)
    ORDER BY (course_offering_id IS NOT NULL)::int + (plan_course_component_id IS NOT NULL)::int DESC
    LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('ok', true, 'source', 'override', 'headcount_id', v_base.id, 'override_id', v_override.id, 'scheduling_headcount', v_override.scheduling_headcount, 'exam_eligible_count', coalesce(v_override.exam_eligible_count, v_base.exam_eligible_count), 'reserve_margin', coalesce(v_override.reserve_margin, v_base.reserve_margin)); END IF;
  RETURN jsonb_build_object('ok', true, 'source', 'base', 'headcount_id', v_base.id, 'scheduling_headcount', v_base.scheduling_headcount, 'exam_eligible_count', v_base.exam_eligible_count, 'reserve_margin', v_base.reserve_margin);
END; $function$;
CREATE OR REPLACE FUNCTION public.schedule_version_room_type_capacity(p_college_id uuid, p_schedule_version_id uuid)
 RETURNS TABLE(room_type_id uuid, room_type_code text, room_type_name text, active_rooms integer, working_days integer, daily_window_hours numeric, theoretical_available_hours numeric, required_group_hours numeric, balance_hours numeric, feasible boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
with v as (
  select academic_term_id term_id
  from public.schedule_versions
  where id=p_schedule_version_id and college_id=p_college_id
), settings as (
  select working_days, day_start_time, day_end_time,
         cardinality(working_days)::integer working_days_count
  from public.scheduling_settings
  where college_id=p_college_id
  limit 1
), room_day_supply as (
  select r.id room_id, rt.id room_type_id, rt.code, rt.name_ar,
         d.day_of_week,
         coalesce(
           (
             select sum(extract(epoch from (ra.end_time-ra.start_time))/3600.0)
             from public.room_availability ra
             where ra.college_id=p_college_id
               and ra.room_id=r.id
               and ra.day_of_week=d.day_of_week
           ),
           extract(epoch from (s.day_end_time-s.day_start_time))/3600.0
         )::numeric as hours
  from public.rooms r
  join public.room_types rt on rt.id=r.room_type_id
  cross join settings s
  cross join lateral (
    select unnest(s.working_days)::smallint as day_of_week
  ) d
  where r.college_id=p_college_id
    and r.is_active=true
), supply as (
  select room_type_id, code, name_ar,
         count(distinct room_id)::integer active_rooms,
         max((select working_days_count from settings))::integer working_days,
         case when count(distinct room_id)>0 and max((select working_days_count from settings))>0
              then sum(hours)/(count(distinct room_id)*max((select working_days_count from settings)))
              else 0 end::numeric as daily_window_hours,
         sum(hours)::numeric as theoretical_available_hours
  from room_day_supply
  group by room_type_id, code, name_ar
), demand as (
  select pcc.required_room_type_id room_type_id,
         sum(pcc.weekly_contact_hours)::numeric required_group_hours
  from public.delivery_groups dg
  join public.academic_cohorts ac on ac.id=dg.cohort_id
  join public.plan_course_components pcc on pcc.id=dg.component_id
  cross join v
  where dg.college_id=p_college_id
    and ac.term_id=v.term_id
    and ac.active=true
    and dg.active=true
    and coalesce(dg.is_obsolete,false)=false
    and coalesce(pcc.is_timetabled,true)=true
  group by pcc.required_room_type_id
)
select sp.room_type_id, sp.code, sp.name_ar, sp.active_rooms, sp.working_days,
       sp.daily_window_hours,
       sp.theoretical_available_hours,
       coalesce(d.required_group_hours,0)::numeric required_group_hours,
       (sp.theoretical_available_hours-coalesce(d.required_group_hours,0))::numeric balance_hours,
       (sp.theoretical_available_hours >= coalesce(d.required_group_hours,0)) feasible
from supply sp
left join demand d on d.room_type_id=sp.room_type_id
order by sp.code;
$function$;
CREATE OR REPLACE FUNCTION public.is_assignment_room_compatible(p_college_id uuid, p_teaching_assignment_id uuid, p_room_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case
    when p_teaching_assignment_id is null or p_room_id is null then true
    when ta.required_room_type is null then true
    when r.room_type = ta.required_room_type then true
    when pcc.component_type = 'practical'
         and lower(btrim(ta.required_room_type)) = 'computer_lab'
         and lower(btrim(r.room_type)) = 'lecture_hall' then true
    else false
  end
  from public.teaching_assignments ta
  join public.rooms r
    on r.id = p_room_id
   and r.college_id = p_college_id
  left join public.plan_course_components pcc
    on pcc.id = ta.plan_course_component_id
  where ta.id = p_teaching_assignment_id
    and ta.college_id = p_college_id;
$function$;
CREATE OR REPLACE FUNCTION public.enforce_delivery_group_explicit_size()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_limit integer;
BEGIN
  IF COALESCE(NEW.active,true) AND NOT COALESCE(NEW.is_obsolete,false) THEN
    SELECT explicit_group_size INTO v_limit FROM public.plan_course_components WHERE id=NEW.component_id AND college_id=NEW.college_id;
    IF v_limit IS NOT NULL AND v_limit>0 AND COALESCE(NEW.expected_students,0)>v_limit THEN
      RAISE EXCEPTION 'DELIVERY_GROUP_EXPLICIT_SIZE_EXCEEDED: % > %',NEW.expected_students,v_limit USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END; $function$;
CREATE OR REPLACE FUNCTION public.schedule_extended_day_counts(p_college uuid, p_version uuid, p_omit uuid DEFAULT NULL::uuid, p_extra jsonb DEFAULT NULL::jsonb)
 RETURNS TABLE(student_key text, days bigint)
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  WITH source AS (
    SELECT s.id,s.cohort_id,s.delivery_group_id,s.day_of_week,s.end_time
    FROM public.schedule_sessions s
    WHERE s.college_id=p_college AND s.schedule_version_id=p_version
      AND NOT coalesce(s.replaced_by_split,false) AND s.id IS DISTINCT FROM p_omit
    UNION ALL
    SELECT e.id,e.cohort_id,e.delivery_group_id,e.day_of_week,e.end_time
    FROM jsonb_to_record(p_extra) e(id uuid,cohort_id uuid,delivery_group_id uuid,day_of_week integer,end_time time)
    WHERE p_extra IS NOT NULL
  ), coverage AS (
    SELECT g.id,g.cohort_id,g.active,g.is_obsolete,
      g.expected_students > 0 AND count(p.id)>0 AND sum(p.headcount)=g.expected_students AS complete,
      array_agg(DISTINCT p.id::text) FILTER(WHERE p.id IS NOT NULL) AS keys
    FROM public.delivery_groups g
    LEFT JOIN public.delivery_group_partition_members m ON m.delivery_group_id=g.id AND m.college_id=p_college AND m.cohort_id=g.cohort_id
    LEFT JOIN public.cohort_student_partitions p ON p.id=m.partition_id AND p.college_id=p_college AND p.cohort_id=g.cohort_id AND p.active
    WHERE g.college_id=p_college GROUP BY g.id,g.cohort_id,g.active,g.is_obsolete,g.expected_students
  ), fallback AS (
    SELECT c.cohort_id FROM coverage c WHERE c.active IS DISTINCT FROM false AND NOT coalesce(c.is_obsolete,false) AND c.complete IS DISTINCT FROM true
    UNION
    SELECT s.cohort_id FROM source s LEFT JOIN coverage c ON c.id=s.delivery_group_id AND c.cohort_id=s.cohort_id WHERE c.complete IS DISTINCT FROM true
  ), expanded AS (
    SELECT s.day_of_week,unnest(CASE WHEN f.cohort_id IS NOT NULL OR c.complete IS DISTINCT FROM true
      THEN ARRAY['cohort:'||coalesce(s.cohort_id::text,'unknown')] ELSE c.keys END) AS key
    FROM source s
    LEFT JOIN coverage c ON c.id=s.delivery_group_id AND c.cohort_id=s.cohort_id
    LEFT JOIN fallback f ON f.cohort_id=s.cohort_id
    JOIN public.scheduling_settings settings ON settings.college_id=p_college
    WHERE s.end_time>settings.standard_day_end_time
  ) SELECT key,count(DISTINCT day_of_week) FROM expanded GROUP BY key;
$function$;
CREATE OR REPLACE FUNCTION public.enforce_partition_extended_day()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE settings public.scheduling_settings%ROWTYPE;
BEGIN
  SELECT * INTO settings FROM public.scheduling_settings WHERE college_id=NEW.college_id;
  IF NOT coalesce(settings.extended_day_policy_enabled,false) THEN RETURN NEW; END IF;
  -- Same version lock as the existing lifecycle writer; never disable existing guards.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.schedule_version_id::text,9174));
  IF NEW.end_time>settings.standard_day_end_time AND NEW.cohort_id IS NULL THEN
    RAISE EXCEPTION 'EXTENDED_DAY_STUDENT_MAPPING_REQUIRED' USING ERRCODE='23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.schedule_extended_day_counts(NEW.college_id,NEW.schedule_version_id,
      NEW.id,CASE WHEN coalesce(NEW.replaced_by_split,false) THEN NULL ELSE to_jsonb(NEW) END) after_counts
    LEFT JOIN public.schedule_extended_day_counts(NEW.college_id,NEW.schedule_version_id) before_counts USING(student_key)
    WHERE after_counts.days>greatest(settings.max_extended_days_per_partition,coalesce(before_counts.days,0))
  ) THEN
    RAISE EXCEPTION 'PARTITION_EXTENDED_DAY_LIMIT' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.enforce_partition_extended_statement()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE v_scope record; v_settings public.scheduling_settings%ROWTYPE;
 v_before jsonb; v_after jsonb; v_old jsonb := '[]'::jsonb;
BEGIN
 IF TG_OP='UPDATE' THEN SELECT coalesce(jsonb_agg(to_jsonb(o)),'[]'::jsonb) INTO v_old FROM old_sessions o; END IF;
 FOR v_scope IN SELECT DISTINCT college_id,schedule_version_id FROM new_sessions ORDER BY schedule_version_id LOOP
  SELECT * INTO v_settings FROM public.scheduling_settings WHERE college_id=v_scope.college_id;
  IF NOT coalesce(v_settings.extended_day_policy_enabled,false) THEN CONTINUE; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_scope.schedule_version_id::text,9174));
  IF EXISTS(SELECT 1 FROM new_sessions n WHERE n.college_id=v_scope.college_id AND n.schedule_version_id=v_scope.schedule_version_id
   AND NOT coalesce(n.replaced_by_split,false) AND n.end_time>v_settings.standard_day_end_time AND n.cohort_id IS NULL) THEN
   RAISE EXCEPTION 'EXTENDED_DAY_STUDENT_MAPPING_REQUIRED' USING ERRCODE='23514';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) INTO v_after FROM public.schedule_sessions s
   WHERE s.college_id=v_scope.college_id AND s.schedule_version_id=v_scope.schedule_version_id;
  SELECT coalesce(jsonb_agg(e),'[]'::jsonb) INTO v_before FROM (
   SELECT e FROM jsonb_array_elements(v_after) e WHERE NOT EXISTS(SELECT 1 FROM new_sessions n WHERE n.id=(e->>'id')::uuid)
   UNION ALL
   SELECT e FROM jsonb_array_elements(v_old) e WHERE (e->>'college_id')::uuid=v_scope.college_id AND (e->>'schedule_version_id')::uuid=v_scope.schedule_version_id
  ) reconstructed;
  IF EXISTS(SELECT 1 FROM public.schedule_extended_counts_for_rows(v_scope.college_id,v_after) a
   LEFT JOIN public.schedule_extended_counts_for_rows(v_scope.college_id,v_before) b USING(student_key)
   WHERE a.days>greatest(v_settings.max_extended_days_per_partition,coalesce(b.days,0))) THEN
   RAISE EXCEPTION 'PARTITION_EXTENDED_DAY_LIMIT' USING ERRCODE='23514';
  END IF;
 END LOOP;
 RETURN NULL;
END;
$function$;
CREATE OR REPLACE FUNCTION public.purge_all_academic_operational_data()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tables text[] := ARRAY[
    'schedule_version_conflict_exceptions',
    'conflict_results',
    'conflict_checks',
    'schedule_quality_runs',
    'schedule_sessions',
    'auto_schedule_runs',
    'schedule_version_events',
    'schedule_versions',
    'section_subgroups',
    'section_group_members',
    'course_offering_sections',
    'scheduling_headcount_revisions',
    'scheduling_headcount_overrides',
    'scheduling_cohort_term_headcounts',
    'teaching_assignments',
    'delivery_groups',
    'cohort_elective_selections',
    'elective_slot_courses',
    'elective_slots',
    'section_groups',
    'sections',
    'course_offerings',
    'plan_course_components',
    'plan_courses',
    'course_departments',
    'course_programs',
    'instructor_availability',
    'instructors',
    'academic_cohorts',
    'courses',
    'study_plans'
  ];
  v_table text;
  v_deleted bigint;
  v_remaining bigint;
  v_counts jsonb := '{}'::jsonb;
  v_total bigint := 0;
BEGIN
  IF current_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'PURGE_MAINTENANCE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;

  -- Single fixed advisory lock for the whole transaction (serializes concurrent runs).
  PERFORM pg_advisory_xact_lock(918273645);

  -- Transaction-local maintenance flag consumed by the three lock triggers.
  PERFORM set_config('gomufadhala.operational_cleanup', 'on', true);

  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE format('DELETE FROM public.%I', v_table);
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object(v_table, v_deleted);
    v_total := v_total + v_deleted;
  END LOOP;

  -- Fail closed: every target table must be empty, else roll back the whole RPC.
  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', v_table) INTO v_remaining;
    IF v_remaining <> 0 THEN
      RAISE EXCEPTION 'PURGE_TABLE_NOT_EMPTY:%:%', v_table, v_remaining
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (
    NULL,
    'operational_data_purge',
    'platform',
    NULL,
    NULL,
    jsonb_build_object('total_deleted', v_total, 'counts', v_counts)
  );

  RETURN jsonb_build_object(
    'purged', true,
    'total_deleted', v_total,
    'tables', cardinality(v_tables),
    'counts', v_counts
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.schedule_extended_counts_for_rows(p_college uuid, p_rows jsonb)
 RETURNS TABLE(student_key text, days bigint)
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 WITH source AS (
 SELECT e.id,e.cohort_id,e.delivery_group_id,e.day_of_week,e.end_time
 FROM jsonb_to_recordset(p_rows) e(id uuid,cohort_id uuid,delivery_group_id uuid,day_of_week integer,end_time time,replaced_by_split boolean)
 WHERE NOT coalesce(e.replaced_by_split,false)
  ), coverage AS (
    SELECT g.id,g.cohort_id,g.active,g.is_obsolete,
      g.expected_students > 0 AND count(p.id)>0 AND sum(p.headcount)=g.expected_students AS complete,
      array_agg(DISTINCT p.id::text) FILTER(WHERE p.id IS NOT NULL) AS keys
    FROM public.delivery_groups g
    LEFT JOIN public.delivery_group_partition_members m ON m.delivery_group_id=g.id AND m.college_id=p_college AND m.cohort_id=g.cohort_id
    LEFT JOIN public.cohort_student_partitions p ON p.id=m.partition_id AND p.college_id=p_college AND p.cohort_id=g.cohort_id AND p.active
    WHERE g.college_id=p_college GROUP BY g.id,g.cohort_id,g.active,g.is_obsolete,g.expected_students
  ), fallback AS (
    SELECT c.cohort_id FROM coverage c WHERE c.active IS DISTINCT FROM false AND NOT coalesce(c.is_obsolete,false) AND c.complete IS DISTINCT FROM true
    UNION
    SELECT s.cohort_id FROM source s LEFT JOIN coverage c ON c.id=s.delivery_group_id AND c.cohort_id=s.cohort_id WHERE c.complete IS DISTINCT FROM true
  ), expanded AS (
    SELECT s.day_of_week,unnest(CASE WHEN f.cohort_id IS NOT NULL OR c.complete IS DISTINCT FROM true
      THEN ARRAY['cohort:'||coalesce(s.cohort_id::text,'unknown')] ELSE c.keys END) AS key
    FROM source s
    LEFT JOIN coverage c ON c.id=s.delivery_group_id AND c.cohort_id=s.cohort_id
    LEFT JOIN fallback f ON f.cohort_id=s.cohort_id
    JOIN public.scheduling_settings settings ON settings.college_id=p_college
    WHERE s.end_time>settings.standard_day_end_time
  ) SELECT key,count(DISTINCT day_of_week) FROM expanded GROUP BY key;
$function$;
CREATE OR REPLACE FUNCTION public.apply_schedule_relayout(p_college_id uuid, p_version_id uuid, p_operation_id uuid, p_expected_revision bigint, p_expected_version_updated_at timestamp with time zone, p_moves jsonb, p_day_cap integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_version public.schedule_versions%ROWTYPE;
  v_session public.schedule_sessions%ROWTYPE;
  v_receipt public.schedule_compaction_receipts%ROWTYPE;
  v_move jsonb;
  v_result jsonb;
  v_hash text;
  v_id uuid;
  v_before_rows jsonb;
  v_guard jsonb;
  v_assigned numeric;
  v_bundle jsonb;
  v_index integer := 0;
  v_count integer;
  v_term record;
  v_closure record;
  v_first_date date;
  v_last_date date;
BEGIN
  IF v_uid IS NULL OR NOT public.can_manage_college(v_uid, p_college_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'applied', 0);
  END IF;
  IF p_operation_id IS NULL OR p_version_id IS NULL OR p_college_id IS NULL
     OR p_expected_revision IS NULL OR p_expected_revision < 0
     OR p_expected_version_updated_at IS NULL
     OR p_day_cap IS NULL OR p_day_cap NOT BETWEEN 3 AND 5
     OR jsonb_typeof(p_moves) IS DISTINCT FROM 'array' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_REQUEST', 'applied', 0);
  END IF;
  v_count := jsonb_array_length(p_moves);
  IF v_count < 1 OR v_count > 512 OR octet_length(p_moves::text) > 1048576 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_BATCH_SIZE', 'applied', 0);
  END IF;
  IF (SELECT count(DISTINCT m->>'id') FROM jsonb_array_elements(p_moves) m) <> v_count THEN
    RETURN jsonb_build_object('ok',false,'code','DUPLICATE_SESSION','applied',0);
  END IF;
  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'mode','simultaneous','day_cap',p_day_cap,'college', p_college_id, 'version', p_version_id, 'revision', p_expected_revision,
    'updated_at', p_expected_version_updated_at, 'moves', p_moves
  )::text, 'UTF8')), 'hex');

  -- Existing writers can acquire a session/assignment before the version lock.
  -- Every potentially inverted lock here is nonblocking: reject instead of deadlocking.
  IF NOT pg_try_advisory_xact_lock(hashtextextended(p_version_id::text, 9174)) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'VERSION_BUSY', 'applied', 0);
  END IF;
  SELECT * INTO v_version FROM public.schedule_versions
  WHERE id = p_version_id AND college_id = p_college_id FOR UPDATE NOWAIT;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'VERSION_NOT_FOUND', 'applied', 0);
  END IF;

  -- Check the receipt before staleness/status: a successful retry must not run twice.
  SELECT * INTO v_receipt FROM public.schedule_compaction_receipts
  WHERE operation_id = p_operation_id;
  IF FOUND THEN
    IF v_receipt.college_id = p_college_id AND v_receipt.schedule_version_id = p_version_id
       AND v_receipt.actor_id = v_uid AND v_receipt.request_hash = v_hash THEN
      RETURN v_receipt.result;
    END IF;
    RETURN jsonb_build_object('ok', false, 'code', 'OPERATION_ID_CONFLICT', 'applied', 0);
  END IF;
  IF v_version.status IS DISTINCT FROM 'draft' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'VERSION_LOCKED', 'applied', 0);
  END IF;
  IF v_version.eligibility_revision IS DISTINCT FROM p_expected_revision
     OR v_version.updated_at IS DISTINCT FROM p_expected_version_updated_at THEN
    RETURN jsonb_build_object('ok', false, 'code', 'STALE_SNAPSHOT', 'applied', 0);
  END IF;
  SELECT start_date,end_date INTO v_term FROM public.academic_terms
  WHERE id = v_version.academic_term_id AND college_id = p_college_id;

  -- Lock all affected sessions and assignments in a stable order before any mutation.
  FOR v_id IN SELECT DISTINCT (m->>'id')::uuid FROM jsonb_array_elements(p_moves) m
    ORDER BY 1 LOOP
    SELECT * INTO v_session FROM public.schedule_sessions
    WHERE id = v_id AND college_id = p_college_id AND schedule_version_id = p_version_id
    FOR UPDATE NOWAIT;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'code', 'SESSION_SCOPE_MISMATCH', 'applied', 0);
    END IF;
    IF COALESCE(v_session.is_locked, false) OR COALESCE(v_session.replaced_by_split, false) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'SESSION_LOCKED', 'applied', 0);
    END IF;
  END LOOP;
  FOR v_id IN SELECT DISTINCT s.teaching_assignment_id FROM public.schedule_sessions s
    WHERE s.id IN (SELECT (m->>'id')::uuid FROM jsonb_array_elements(p_moves) m)
      AND s.teaching_assignment_id IS NOT NULL ORDER BY 1 LOOP
    PERFORM 1 FROM public.teaching_assignments WHERE id = v_id FOR UPDATE NOWAIT;
  END LOOP;

  -- Every occurrence carries the timestamp from the original preview, even repeated moves.
  FOR v_move IN SELECT value FROM jsonb_array_elements(p_moves) LOOP
    SELECT * INTO v_session FROM public.schedule_sessions WHERE id = (v_move->>'id')::uuid;
    IF jsonb_typeof(v_move) IS DISTINCT FROM 'object'
       OR v_move->>'expected_updated_at' IS NULL
       OR v_session.updated_at IS DISTINCT FROM (v_move->>'expected_updated_at')::timestamptz THEN
      RETURN jsonb_build_object('ok', false, 'code', 'STALE_SESSION', 'applied', 0);
    END IF;
    IF (v_move->>'day_of_week')::integer NOT BETWEEN 0 AND 6
       OR (v_move->>'end_time')::time <= (v_move->>'start_time')::time
       OR v_move->>'start_time' IS NULL OR v_move->>'end_time' IS NULL
       OR v_move->>'room_id' IS NULL OR v_move->>'day_of_week' IS NULL
       OR (v_move->>'end_time')::time - (v_move->>'start_time')::time
          IS DISTINCT FROM v_session.end_time - v_session.start_time THEN
      RETURN jsonb_build_object('ok', false, 'code', 'DURATION_OR_TARGET_INVALID', 'applied', 0);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.rooms r
      WHERE r.id = (v_move->>'room_id')::uuid AND r.college_id = p_college_id AND r.is_active) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'ROOM_SCOPE_MISMATCH', 'applied', 0);
    END IF;
    -- The legacy move collector does not inspect room_unavailability. Validate both
    -- weekly and date-bounded closures here before the ordered transaction starts.
    FOR v_closure IN SELECT * FROM public.room_unavailability ru
      WHERE ru.college_id = p_college_id AND ru.room_id = (v_move->>'room_id')::uuid
        AND (ru.day_of_week IS NULL OR ru.day_of_week = (v_move->>'day_of_week')::integer)
        AND COALESCE(ru.start_time,'00:00'::time) < (v_move->>'end_time')::time
        AND COALESCE(ru.end_time,'24:00'::time) > (v_move->>'start_time')::time
    LOOP
      IF v_closure.start_date IS NULL AND v_closure.end_date IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ROOM_CLOSED', 'applied', 0);
      END IF;
      IF v_term.start_date IS NULL OR v_term.end_date IS NULL OR v_term.end_date < v_term.start_date THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ROOM_CLOSURE_REQUIRES_TERM_DATES', 'applied', 0);
      END IF;
      v_first_date := greatest(v_term.start_date,COALESCE(v_closure.start_date,v_term.start_date));
      v_last_date := least(v_term.end_date,COALESCE(v_closure.end_date,v_term.end_date));
      IF v_first_date + (((v_move->>'day_of_week')::integer - extract(dow FROM v_first_date)::integer + 7) % 7)
         <= v_last_date THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ROOM_CLOSED', 'applied', 0);
      END IF;
    END LOOP;
  END LOOP;

  SELECT jsonb_agg(to_jsonb(s)) INTO v_before_rows FROM public.schedule_sessions s
   WHERE s.id IN (SELECT (m->>'id')::uuid FROM jsonb_array_elements(p_moves) m);

  -- One UPDATE, retaining all lifecycle, scope and lock triggers. The extended-day
  -- statement guard sees the final state; every final placement is then revalidated.
  UPDATE public.schedule_sessions s SET day_of_week=m.day_of_week,start_time=m.start_time,end_time=m.end_time,room_id=m.room_id
  FROM jsonb_to_recordset(p_moves) m(id uuid,day_of_week integer,start_time time,end_time time,room_id uuid)
  WHERE s.id=m.id AND s.college_id=p_college_id AND s.schedule_version_id=p_version_id;
  GET DIAGNOSTICS v_index = ROW_COUNT;
  IF v_index <> v_count THEN RAISE EXCEPTION 'INCOMPLETE_BATCH' USING ERRCODE='P7501'; END IF;

  FOR v_session IN SELECT * FROM public.schedule_sessions WHERE college_id=p_college_id
    AND schedule_version_id=p_version_id AND NOT coalesce(replaced_by_split,false) LOOP
    IF v_session.teaching_assignment_id IS NOT NULL THEN
      v_guard := public._sb_v2_assignment_guard(v_session.teaching_assignment_id);
      IF coalesce((v_guard->>'is_v2')::boolean,false) THEN
        IF NOT coalesce((v_guard->>'ok')::boolean,false) THEN
          v_result:=jsonb_build_object('code','ASSIGNMENT_BLOCKED'); RAISE EXCEPTION 'RELAYOUT_REJECTED' USING ERRCODE='P7501';
        END IF;
        SELECT coalesce(a.assigned_component_hours,c.weekly_contact_hours,0) INTO v_assigned
         FROM public.teaching_assignments a LEFT JOIN public.plan_course_components c ON c.id=a.plan_course_component_id WHERE a.id=v_session.teaching_assignment_id;
        IF public._sb_v2_scheduled_hours_for_assignment(p_version_id,v_session.teaching_assignment_id,NULL)>v_assigned THEN
          v_result:=jsonb_build_object('code','OVER_SCHEDULED'); RAISE EXCEPTION 'RELAYOUT_REJECTED' USING ERRCODE='P7501';
        END IF;
      END IF;
    END IF;
    v_bundle:=public._collect_schedule_session_move_conflicts(v_session.id,p_college_id,p_version_id,v_session.instructor_id,
     v_session.section_id,v_session.course_offering_id,v_session.teaching_assignment_id,v_session.study_system,v_session.expected_students,
     v_session.day_of_week,v_session.start_time,v_session.end_time,v_session.room_id);
    IF coalesce(jsonb_array_length(v_bundle->'blocking_conflicts'),0)>0 OR coalesce(jsonb_array_length(v_bundle->'warnings'),0)>0
      OR jsonb_array_length(public._sb_v2_delivery_group_overlap(p_version_id,v_session.delivery_group_id,v_session.cohort_id,
       v_session.day_of_week,v_session.start_time,v_session.end_time,v_session.id))>0 THEN
      v_result:=jsonb_build_object('code','FINAL_STATE_CONFLICT'); RAISE EXCEPTION 'RELAYOUT_REJECTED' USING ERRCODE='P7501';
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM public.schedule_sessions s JOIN public.academic_cohorts c ON c.id=s.cohort_id
    WHERE s.college_id=p_college_id AND s.schedule_version_id=p_version_id AND NOT coalesce(s.replaced_by_split,false)
    GROUP BY c.program_id,c.level_id,c.study_system,c.term_id HAVING count(DISTINCT s.day_of_week)>p_day_cap) THEN
    v_result:=jsonb_build_object('code','ATTENDANCE_DAY_LIMIT'); RAISE EXCEPTION 'RELAYOUT_REJECTED' USING ERRCODE='P7501';
  END IF;
  IF EXISTS(SELECT 1 FROM public.schedule_extended_day_counts(p_college_id,p_version_id) e
    JOIN public.scheduling_settings cfg ON cfg.college_id=p_college_id
    WHERE cfg.extended_day_policy_enabled AND e.days>cfg.max_extended_days_per_partition) THEN
    v_result:=jsonb_build_object('code','PARTITION_EXTENDED_DAY_LIMIT'); RAISE EXCEPTION 'RELAYOUT_REJECTED' USING ERRCODE='P7501';
  END IF;
  INSERT INTO public.audit_logs(actor_id,action,entity,entity_id,college_id,details)
   SELECT v_uid,'simultaneous_reschedule','schedule_sessions',s.id,p_college_id,
    jsonb_build_object('operation_id',p_operation_id,'before',b,'after',to_jsonb(s))
   FROM jsonb_array_elements(v_before_rows) b JOIN public.schedule_sessions s ON s.id=(b->>'id')::uuid;

  v_result := jsonb_build_object('ok', true, 'code', 'SAVED', 'applied', v_count,
    'operation_id', p_operation_id);
  INSERT INTO public.schedule_compaction_receipts
    (operation_id,college_id,schedule_version_id,actor_id,request_hash,result)
  VALUES (p_operation_id,p_college_id,p_version_id,v_uid,v_hash,v_result);
  INSERT INTO public.audit_logs(actor_id,action,entity,entity_id,college_id,details)
  VALUES (v_uid,'simultaneous_relayout','schedule_versions',p_version_id,p_college_id,
    jsonb_build_object('operation_id',p_operation_id,'moves',v_count,'request_hash',v_hash));
  RETURN v_result;
EXCEPTION
  -- This handler covers the entire write block. PostgreSQL rolls back moves, revision
  -- increments, per-move audits and the receipt before returning applied=0.
  WHEN SQLSTATE 'P7501' THEN
    RETURN jsonb_build_object('ok', false, 'code', COALESCE(v_result->>'code','MOVE_REJECTED'),
      'applied', 0, 'failed_move', v_index);
  WHEN lock_not_available OR deadlock_detected OR serialization_failure THEN
    RETURN jsonb_build_object('ok', false, 'code', 'VERSION_BUSY', 'applied', 0);
  WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_REQUEST', 'applied', 0);
  WHEN OTHERS THEN
    -- Do not expose table names, identifiers from other tenants, or raw SQL errors.
    RETURN jsonb_build_object('ok', false, 'code', 'BATCH_FAILED', 'applied', 0);
END;
$function$;
CREATE OR REPLACE FUNCTION public._ss_pack(p_conflicts jsonb, p_vid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c jsonb; item jsonb; enr jsonb:='[]'::jsonb; blk jsonb:='[]'::jsonb;
  appr jsonb:='[]'::jsonb; warn jsonb:='[]'::jsonb; ok boolean; eid uuid; ereas text;
  prim uuid; sec uuid;
BEGIN
  FOR c IN SELECT elem FROM jsonb_array_elements(COALESCE(p_conflicts,'[]'::jsonb)) t(elem)
  LOOP
    prim:=NULLIF(c->>'schedule_session_id','')::uuid;
    sec:=CASE WHEN c->>'related_session_id' IS NULL OR c->>'related_session_id'='null' THEN NULL
      ELSE (c->>'related_session_id')::uuid END;
    SELECT * INTO ok,eid,ereas FROM public._ss_ex_match(p_vid,c->>'code',prim,sec);
    item:=c||jsonb_build_object('approved_exception',ok,'exception_id',eid,'exception_reason',ereas);
    enr:=enr||jsonb_build_array(item);
    IF COALESCE(c->>'severity','hard')='soft' THEN warn:=warn||jsonb_build_array(item);
    ELSIF ok THEN appr:=appr||jsonb_build_array(item);
    ELSE blk:=blk||jsonb_build_array(item); END IF;
  END LOOP;
  RETURN jsonb_build_object('all_conflicts',enr,'blocking_conflicts',blk,
    'approved_exceptions',appr,'warnings',warn);
END;$function$;
SET check_function_bodies=on;
CREATE OR REPLACE FUNCTION public.can_manage_college(_user_id uuid,_college_id uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT $1=md5('manager')::uuid AND $2=md5('college')::uuid $$;
CREATE OR REPLACE FUNCTION public.can_view_college(_user_id uuid,_college_id uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT $1 IN(md5('manager')::uuid,md5('viewer')::uuid) AND $2=md5('college')::uuid $$;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;

SET check_function_bodies=off;
CREATE OR REPLACE FUNCTION public._sb_v2_wall_hours(p_start time without time zone, p_end time without time zone)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_start IS NULL OR p_end IS NULL OR p_end <= p_start THEN 0::numeric
    ELSE ROUND((EXTRACT(EPOCH FROM (p_end - p_start)) / 3600.0)::numeric, 4)
  END;
$function$;
CREATE OR REPLACE FUNCTION public._sb_v2_scheduled_hours_for_assignment(p_schedule_version_id uuid, p_teaching_assignment_id uuid, p_exclude_session_id uuid DEFAULT NULL::uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(SUM(public._sb_v2_wall_hours(ss.start_time, ss.end_time)), 0)
  FROM public.schedule_sessions ss
  WHERE ss.schedule_version_id = p_schedule_version_id
    AND ss.teaching_assignment_id = p_teaching_assignment_id
    AND (p_exclude_session_id IS NULL OR ss.id <> p_exclude_session_id);
$function$;
SET check_function_bodies=on;
