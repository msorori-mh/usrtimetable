-- Disposable TEST_ONLY schema snapshot, observed 2026-09-11 in timetable.
-- No production data. Auth identity is supplied by the test session; real RBAC and move functions follow.
\set ON_ERROR_STOP on
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
GRANT USAGE ON SCHEMA auth TO authenticated;
SET check_function_bodies = off;
CREATE TYPE public.app_role AS ENUM ('super_admin','college_admin','read_only','institutional_viewer');
CREATE TABLE public.academic_buildings (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  address text,
  floors_count integer,
  notes text,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.academic_calendar (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  term_id uuid,
  title text NOT NULL,
  event_kind text DEFAULT 'holiday'::text NOT NULL,
  start_date date NOT NULL,
  end_date date,
  start_time time without time zone,
  end_time time without time zone,
  all_day boolean DEFAULT true NOT NULL,
  affects_scheduling boolean DEFAULT true NOT NULL,
  color text,
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.academic_cohorts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  program_id uuid NOT NULL,
  level_id uuid NOT NULL,
  study_system text NOT NULL,
  entry_year integer NOT NULL,
  term_id uuid NOT NULL,
  expected_students integer DEFAULT 0 NOT NULL,
  count_status text DEFAULT 'estimated'::text NOT NULL,
  code text,
  active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.academic_levels (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  program_id uuid NOT NULL,
  name text NOT NULL,
  level_number integer NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.academic_programs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  department_id uuid NOT NULL,
  name text NOT NULL,
  code text NOT NULL,
  degree_type text DEFAULT 'bachelor'::text NOT NULL,
  duration_years integer DEFAULT 4 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.academic_terms (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  name text NOT NULL,
  code text NOT NULL,
  start_date date,
  end_date date,
  is_active boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  academic_year text,
  term_type text,
  teaching_weeks_count integer
);
CREATE TABLE public.audit_logs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  actor_id uuid,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id uuid,
  college_id uuid,
  details jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.auto_schedule_runs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  schedule_version_id uuid NOT NULL,
  algorithm text DEFAULT 'greedy'::text NOT NULL,
  status text DEFAULT 'completed'::text NOT NULL,
  total_offerings integer DEFAULT 0 NOT NULL,
  placed_sessions integer DEFAULT 0 NOT NULL,
  unplaced_sessions integer DEFAULT 0 NOT NULL,
  hard_conflicts_after integer DEFAULT 0 NOT NULL,
  soft_violations_after integer DEFAULT 0 NOT NULL,
  quality_score_after integer,
  duration_ms integer,
  summary jsonb,
  unplaced jsonb,
  run_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.cohort_elective_selections (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  cohort_id uuid NOT NULL,
  elective_slot_id uuid NOT NULL,
  selected_course_id uuid NOT NULL,
  decided_at timestamp with time zone,
  decided_by uuid,
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.cohort_student_partitions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  cohort_id uuid NOT NULL,
  partition_code text NOT NULL,
  headcount integer NOT NULL,
  active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.college_constraint_settings (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  constraint_type_id uuid NOT NULL,
  enabled boolean DEFAULT true NOT NULL,
  weight integer DEFAULT 1 NOT NULL,
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.college_quality_settings (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  quality_metric_id uuid NOT NULL,
  enabled boolean DEFAULT true NOT NULL,
  weight integer DEFAULT 5 NOT NULL,
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.colleges (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  university_id uuid NOT NULL,
  name text NOT NULL,
  code text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.conflict_checks (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  schedule_version_id uuid NOT NULL,
  check_type text DEFAULT 'hard'::text NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  total_conflicts integer DEFAULT 0 NOT NULL,
  checked_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  completed_at timestamp with time zone
);
CREATE TABLE public.conflict_results (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  conflict_check_id uuid NOT NULL,
  schedule_session_id uuid,
  related_session_id uuid,
  conflict_type_id uuid,
  conflict_code text NOT NULL,
  severity text DEFAULT 'hard'::text NOT NULL,
  message_ar text NOT NULL,
  message_en text NOT NULL,
  metadata jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  score_impact integer DEFAULT 0 NOT NULL
);
CREATE TABLE public.constraint_types (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  code text NOT NULL,
  name_ar text NOT NULL,
  name_en text,
  constraint_category text NOT NULL,
  default_weight integer DEFAULT 1 NOT NULL,
  is_hard boolean DEFAULT false NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  description text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.course_departments (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  course_id uuid NOT NULL,
  department_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.course_offering_sections (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  course_offering_id uuid NOT NULL,
  section_id uuid NOT NULL,
  expected_students integer DEFAULT 0 NOT NULL,
  section_number text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.course_offerings (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  term_id uuid NOT NULL,
  course_id uuid NOT NULL,
  program_id uuid,
  level_id uuid,
  expected_students integer DEFAULT 0 NOT NULL,
  sections_count integer DEFAULT 1 NOT NULL,
  notes text,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  study_plan_id uuid,
  plan_course_id uuid,
  status text DEFAULT 'draft'::text NOT NULL,
  study_system text DEFAULT 'regular'::text NOT NULL,
  enrollment_count_status text DEFAULT 'unverified'::text NOT NULL,
  enrollment_count_updated_at timestamp with time zone
);
CREATE TABLE public.course_programs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  course_id uuid NOT NULL,
  program_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.courses (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  department_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  credit_hours numeric(4,2) DEFAULT 3 NOT NULL,
  theory_hours integer DEFAULT 0 NOT NULL,
  practical_hours integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  course_nature text DEFAULT 'department'::text NOT NULL,
  is_shared boolean DEFAULT false NOT NULL
);
CREATE TABLE public.daily_breaks (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  name text NOT NULL,
  days integer[] DEFAULT ARRAY[]::integer[] NOT NULL,
  start_time time without time zone NOT NULL,
  end_time time without time zone NOT NULL,
  affects_scheduling boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.delivery_group_partition_members (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  cohort_id uuid NOT NULL,
  delivery_group_id uuid NOT NULL,
  partition_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.delivery_groups (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  cohort_id uuid NOT NULL,
  plan_course_id uuid NOT NULL,
  component_id uuid NOT NULL,
  group_code text NOT NULL,
  expected_students integer DEFAULT 0 NOT NULL,
  capacity_limit integer,
  active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  group_number integer,
  excluded_from_standard_workload boolean DEFAULT false NOT NULL,
  is_obsolete boolean DEFAULT false NOT NULL
);
CREATE TABLE public.departments (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  name text NOT NULL,
  code text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  study_system text DEFAULT 'regular'::text NOT NULL
);
CREATE TABLE public.elective_slot_courses (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  elective_slot_id uuid NOT NULL,
  course_id uuid NOT NULL,
  active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.elective_slots (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  study_plan_id uuid NOT NULL,
  level_id uuid,
  semester integer NOT NULL,
  slot_code text NOT NULL,
  label text,
  required_component_type text DEFAULT 'theory'::text NOT NULL,
  active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.faculty_workload_policies (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  rank_code text NOT NULL,
  rank_aliases text[] DEFAULT '{}'::text[] NOT NULL,
  required_load_hours numeric(5,2) NOT NULL,
  active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.import_errors (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  job_id uuid NOT NULL,
  row_number integer NOT NULL,
  column_name text,
  error_code text NOT NULL,
  message text NOT NULL,
  raw_value text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.import_jobs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  target_entity text NOT NULL,
  mode text DEFAULT 'insert_only'::text NOT NULL,
  status text DEFAULT 'preview'::text NOT NULL,
  file_name text,
  total_rows integer DEFAULT 0 NOT NULL,
  valid_rows integer DEFAULT 0 NOT NULL,
  invalid_rows integer DEFAULT 0 NOT NULL,
  inserted_rows integer DEFAULT 0 NOT NULL,
  updated_rows integer DEFAULT 0 NOT NULL,
  skipped_rows integer DEFAULT 0 NOT NULL,
  notes text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  validated_payload jsonb,
  payload_manifest text,
  claimed_at timestamp with time zone,
  finished_at timestamp with time zone,
  failure_message text
);
CREATE TABLE public.import_template_columns (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  template_id uuid NOT NULL,
  column_order integer DEFAULT 0 NOT NULL,
  header_ar text NOT NULL,
  field_key text NOT NULL,
  data_type text DEFAULT 'text'::text NOT NULL,
  is_required boolean DEFAULT false NOT NULL,
  enum_values jsonb,
  example text,
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.import_templates (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  template_key text NOT NULL,
  name_ar text NOT NULL,
  description text,
  version integer DEFAULT 1 NOT NULL,
  target_entity text NOT NULL,
  sheet_name text,
  sample_file_url text,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.instructor_availability (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  instructor_id uuid NOT NULL,
  day_of_week smallint NOT NULL,
  start_time time without time zone NOT NULL,
  end_time time without time zone NOT NULL,
  availability_type text DEFAULT 'available'::text NOT NULL,
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  is_preference boolean DEFAULT false NOT NULL
);
CREATE TABLE public.instructor_types (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  code text NOT NULL,
  name_ar text NOT NULL,
  name_en text,
  is_external boolean DEFAULT false NOT NULL,
  description text,
  color text,
  display_order integer DEFAULT 0 NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.instructors (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  department_id uuid,
  full_name text NOT NULL,
  academic_rank text,
  email text,
  phone text,
  employment_type text DEFAULT 'full_time'::text NOT NULL,
  max_weekly_hours integer DEFAULT 18 NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  instructor_type_id uuid,
  external_source text,
  academic_degree text,
  admin_tasks text,
  max_hours_per_day integer,
  employee_number text,
  full_name_ar text,
  full_name_en text,
  specialization text,
  administrative_release_hours integer DEFAULT 0 NOT NULL,
  notes text
);
CREATE TABLE public.plan_course_components (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  plan_course_id uuid NOT NULL,
  component_type text NOT NULL,
  weekly_contact_hours numeric(5,2) DEFAULT 0 NOT NULL,
  required_room_type_id uuid,
  is_timetabled boolean DEFAULT true NOT NULL,
  counts_toward_regular_load boolean DEFAULT true NOT NULL,
  counts_toward_overtime boolean DEFAULT true NOT NULL,
  compensation_mode text DEFAULT 'per_hour'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  explicit_group_size integer
);
CREATE TABLE public.plan_courses (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  study_plan_id uuid NOT NULL,
  course_id uuid NOT NULL,
  level_id uuid,
  semester integer DEFAULT 1 NOT NULL,
  is_required boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  lecture_session_duration numeric DEFAULT 2 NOT NULL,
  lab_session_duration numeric DEFAULT 2 NOT NULL,
  lectures_per_week integer DEFAULT 0 NOT NULL,
  labs_per_week integer DEFAULT 0 NOT NULL,
  required_room_type_for_lecture text,
  required_room_type_for_lab text
);
CREATE TABLE public.profiles (
  id uuid NOT NULL,
  full_name text,
  email text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.quality_metrics (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  code text NOT NULL,
  name_ar text NOT NULL,
  name_en text,
  description text,
  default_weight integer DEFAULT 5 NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.room_availability (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  room_id uuid NOT NULL,
  day_of_week smallint NOT NULL,
  start_time time without time zone NOT NULL,
  end_time time without time zone NOT NULL,
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.room_types (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  code text NOT NULL,
  name_ar text NOT NULL,
  name_en text,
  default_capacity integer DEFAULT 30 NOT NULL,
  features jsonb DEFAULT '[]'::jsonb NOT NULL,
  color text,
  display_order integer DEFAULT 0 NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  strict_capacity boolean DEFAULT false NOT NULL
);
CREATE TABLE public.room_unavailability (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  room_id uuid NOT NULL,
  day_of_week smallint,
  start_time time without time zone,
  end_time time without time zone,
  start_date date,
  end_date date,
  reason text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.rooms (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  room_type text DEFAULT 'lecture_room'::text NOT NULL,
  capacity integer DEFAULT 30 NOT NULL,
  building text,
  floor text,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  building_id uuid,
  room_type_id uuid,
  available_days smallint[],
  available_start_time time without time zone,
  available_end_time time without time zone,
  notes text
);
CREATE TABLE public.schedule_quality_runs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  schedule_version_id uuid NOT NULL,
  total_score integer DEFAULT 100 NOT NULL,
  hard_conflicts_count integer DEFAULT 0 NOT NULL,
  soft_conflicts_count integer DEFAULT 0 NOT NULL,
  total_deductions integer DEFAULT 0 NOT NULL,
  metrics_breakdown jsonb,
  run_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  eligibility_revision bigint DEFAULT 0 NOT NULL
);
CREATE TABLE public.schedule_sessions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  schedule_version_id uuid NOT NULL,
  course_offering_id uuid NOT NULL,
  teaching_assignment_id uuid,
  instructor_id uuid NOT NULL,
  room_id uuid,
  section_id uuid,
  section_group_id uuid,
  study_system text DEFAULT 'regular'::text NOT NULL,
  day_of_week smallint NOT NULL,
  start_time time without time zone NOT NULL,
  end_time time without time zone NOT NULL,
  session_type text DEFAULT 'lecture'::text NOT NULL,
  expected_students integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  is_locked boolean DEFAULT false NOT NULL,
  lock_reason text,
  source_type text DEFAULT 'manual'::text NOT NULL,
  auto_schedule_run_id uuid,
  section_subgroup_id uuid,
  replaced_by_split boolean DEFAULT false NOT NULL,
  split_source_session_id uuid,
  cohort_id uuid,
  plan_course_component_id uuid,
  delivery_group_id uuid
);
CREATE TABLE public.schedule_version_conflict_exceptions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  schedule_version_id uuid NOT NULL,
  conflict_code text NOT NULL,
  session_id uuid NOT NULL,
  related_session_id uuid,
  approval_type text NOT NULL,
  reason text NOT NULL,
  source text,
  status text DEFAULT 'approved'::text NOT NULL,
  approved_by uuid,
  approved_at timestamp with time zone,
  metadata jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.schedule_version_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  schedule_version_id uuid NOT NULL,
  event_type text NOT NULL,
  from_status text,
  to_status text,
  performed_by uuid,
  notes text,
  metadata jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.schedule_versions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  academic_term_id uuid NOT NULL,
  name text NOT NULL,
  status text DEFAULT 'draft'::text NOT NULL,
  notes text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  eligibility_revision bigint DEFAULT 0 NOT NULL,
  disposable_test boolean DEFAULT false NOT NULL
);
CREATE TABLE public.scheduling_cohort_term_headcounts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  cohort_id uuid NOT NULL,
  term_id uuid NOT NULL,
  study_system text NOT NULL,
  registered_student_count integer NOT NULL,
  eligible_student_count integer NOT NULL,
  expected_attendance_count integer NOT NULL,
  reserve_margin integer DEFAULT 0 NOT NULL,
  scheduling_headcount integer NOT NULL,
  exam_eligible_count integer NOT NULL,
  approval_status text DEFAULT 'draft'::text NOT NULL,
  source text NOT NULL,
  notes text,
  approved_by uuid,
  approved_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.scheduling_headcount_overrides (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  headcount_id uuid NOT NULL,
  course_offering_id uuid,
  plan_course_component_id uuid,
  scheduling_headcount integer NOT NULL,
  exam_eligible_count integer,
  reserve_margin integer,
  approval_status text DEFAULT 'draft'::text NOT NULL,
  source text NOT NULL,
  notes text,
  approved_by uuid,
  approved_at timestamp with time zone,
  active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.scheduling_headcount_revisions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  headcount_id uuid NOT NULL,
  override_id uuid,
  revision_kind text NOT NULL,
  snapshot jsonb NOT NULL,
  changed_by uuid NOT NULL,
  changed_at timestamp with time zone DEFAULT now() NOT NULL,
  notes text
);
CREATE TABLE public.scheduling_settings (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  week_start_day smallint DEFAULT 6 NOT NULL,
  working_days smallint[] DEFAULT ARRAY[(6)::smallint, (0)::smallint, (1)::smallint, (2)::smallint, (3)::smallint, (4)::smallint] NOT NULL,
  day_start_time time without time zone DEFAULT '08:00:00'::time without time zone NOT NULL,
  day_end_time time without time zone DEFAULT '14:00:00'::time without time zone NOT NULL,
  slot_minutes integer DEFAULT 60 NOT NULL,
  min_session_hours numeric(3,1) DEFAULT 1 NOT NULL,
  max_session_hours numeric(3,1) DEFAULT 3 NOT NULL,
  allow_3h_sessions boolean DEFAULT true NOT NULL,
  max_daily_hours_per_instructor integer DEFAULT 6 NOT NULL,
  max_daily_hours_per_section integer DEFAULT 6 NOT NULL,
  break_between_sessions_min integer DEFAULT 0 NOT NULL,
  allow_back_to_back boolean DEFAULT true NOT NULL,
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  allowed_session_durations integer[] DEFAULT ARRAY[1, 2, 3] NOT NULL
);
CREATE TABLE public.section_group_members (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  section_group_id uuid NOT NULL,
  section_id uuid NOT NULL,
  expected_students integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.section_groups (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  academic_term_id uuid NOT NULL,
  course_id uuid NOT NULL,
  group_name text NOT NULL,
  expected_students_total integer DEFAULT 0 NOT NULL,
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.section_subgroups (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  section_id uuid NOT NULL,
  course_id uuid NOT NULL,
  academic_term_id uuid NOT NULL,
  teaching_assignment_id uuid,
  subgroup_code text NOT NULL,
  ordinal smallint NOT NULL,
  expected_students integer DEFAULT 0 NOT NULL,
  study_system text DEFAULT 'regular'::text NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  source_policy text NOT NULL,
  owner_approval_ref text,
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.sections (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  course_id uuid NOT NULL,
  term_id uuid NOT NULL,
  section_number text NOT NULL,
  capacity integer DEFAULT 30 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  study_system text DEFAULT 'regular'::text NOT NULL
);
CREATE TABLE public.session_types (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  code text NOT NULL,
  name_ar text NOT NULL,
  name_en text,
  default_duration_hours numeric(3,1) DEFAULT 2 NOT NULL,
  color text,
  requires_lab boolean DEFAULT false NOT NULL,
  display_order integer DEFAULT 0 NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.study_plans (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  program_id uuid NOT NULL,
  name text NOT NULL,
  code text NOT NULL,
  version text DEFAULT '1'::text NOT NULL,
  effective_year integer,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.teaching_assignments (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  course_offering_id uuid NOT NULL,
  instructor_id uuid NOT NULL,
  section_number text,
  session_type text DEFAULT 'lecture'::text NOT NULL,
  weekly_hours numeric DEFAULT 3 NOT NULL,
  required_room_type text,
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  expected_students integer DEFAULT 0 NOT NULL,
  section_id uuid,
  cohort_id uuid,
  plan_course_component_id uuid,
  delivery_group_id uuid,
  assigned_component_hours numeric(5,2),
  is_active boolean DEFAULT true NOT NULL
);
CREATE TABLE public.time_slot_templates (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  study_system text DEFAULT 'regular'::text NOT NULL,
  day_of_week smallint NOT NULL,
  start_time time without time zone NOT NULL,
  end_time time without time zone NOT NULL,
  slot_duration_minutes integer DEFAULT 60 NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.time_slots (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  college_id uuid NOT NULL,
  day_of_week smallint NOT NULL,
  start_time time without time zone NOT NULL,
  end_time time without time zone NOT NULL,
  slot_order integer DEFAULT 1 NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.universities (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  code text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.user_colleges (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  college_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.user_roles (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  role app_role NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.instructor_availability ADD CONSTRAINT instructor_availability_no_overlap EXCLUDE USING gist (instructor_id WITH =, college_id WITH =, day_of_week WITH =, _avail_time_span(start_time, end_time) WITH &&) WHERE (((availability_type = 'unavailable'::text) AND (is_preference = false)));
ALTER TABLE public.room_unavailability ADD CONSTRAINT room_unavailability_no_overlap EXCLUDE USING gist (room_id WITH =, college_id WITH =, _avail_day_span(day_of_week) WITH &&, _avail_date_span(start_date, end_date) WITH &&, _avail_time_span(start_time, end_time) WITH &&);
ALTER TABLE public.universities ADD CONSTRAINT universities_pkey PRIMARY KEY (id);
ALTER TABLE public.universities ADD CONSTRAINT universities_code_key UNIQUE (code);
ALTER TABLE public.colleges ADD CONSTRAINT colleges_pkey PRIMARY KEY (id);
ALTER TABLE public.colleges ADD CONSTRAINT colleges_university_id_code_key UNIQUE (university_id, code);
ALTER TABLE public.profiles ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);
ALTER TABLE public.user_colleges ADD CONSTRAINT user_colleges_pkey PRIMARY KEY (id);
ALTER TABLE public.user_colleges ADD CONSTRAINT user_colleges_user_id_college_id_key UNIQUE (user_id, college_id);
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);
ALTER TABLE public.departments ADD CONSTRAINT departments_pkey PRIMARY KEY (id);
ALTER TABLE public.departments ADD CONSTRAINT departments_college_id_code_key UNIQUE (college_id, code);
ALTER TABLE public.departments ADD CONSTRAINT departments_college_id_name_key UNIQUE (college_id, name);
ALTER TABLE public.academic_programs ADD CONSTRAINT academic_programs_pkey PRIMARY KEY (id);
ALTER TABLE public.academic_programs ADD CONSTRAINT academic_programs_college_id_code_key UNIQUE (college_id, code);
ALTER TABLE public.academic_programs ADD CONSTRAINT academic_programs_college_id_name_key UNIQUE (college_id, name);
ALTER TABLE public.study_plans ADD CONSTRAINT study_plans_pkey PRIMARY KEY (id);
ALTER TABLE public.study_plans ADD CONSTRAINT study_plans_program_id_code_version_key UNIQUE (program_id, code, version);
ALTER TABLE public.academic_levels ADD CONSTRAINT academic_levels_pkey PRIMARY KEY (id);
ALTER TABLE public.academic_levels ADD CONSTRAINT academic_levels_program_id_level_number_key UNIQUE (program_id, level_number);
ALTER TABLE public.courses ADD CONSTRAINT courses_pkey PRIMARY KEY (id);
ALTER TABLE public.courses ADD CONSTRAINT courses_college_id_code_key UNIQUE (college_id, code);
ALTER TABLE public.plan_courses ADD CONSTRAINT plan_courses_pkey PRIMARY KEY (id);
ALTER TABLE public.plan_courses ADD CONSTRAINT plan_courses_study_plan_id_course_id_key UNIQUE (study_plan_id, course_id);
ALTER TABLE public.academic_terms ADD CONSTRAINT academic_terms_pkey PRIMARY KEY (id);
ALTER TABLE public.academic_terms ADD CONSTRAINT academic_terms_college_id_code_key UNIQUE (college_id, code);
ALTER TABLE public.academic_terms ADD CONSTRAINT academic_terms_college_id_name_key UNIQUE (college_id, name);
ALTER TABLE public.sections ADD CONSTRAINT sections_pkey PRIMARY KEY (id);
ALTER TABLE public.instructors ADD CONSTRAINT instructors_pkey PRIMARY KEY (id);
ALTER TABLE public.instructor_availability ADD CONSTRAINT instructor_availability_day_of_week_check CHECK (((day_of_week >= 0) AND (day_of_week <= 6)));
ALTER TABLE public.instructor_availability ADD CONSTRAINT instructor_availability_check CHECK ((end_time > start_time));
ALTER TABLE public.instructor_availability ADD CONSTRAINT instructor_availability_pkey PRIMARY KEY (id);
ALTER TABLE public.rooms ADD CONSTRAINT rooms_pkey PRIMARY KEY (id);
ALTER TABLE public.room_unavailability ADD CONSTRAINT room_unavailability_day_of_week_check CHECK (((day_of_week >= 0) AND (day_of_week <= 6)));
ALTER TABLE public.room_unavailability ADD CONSTRAINT room_unavailability_pkey PRIMARY KEY (id);
ALTER TABLE public.time_slots ADD CONSTRAINT time_slots_day_of_week_check CHECK (((day_of_week >= 0) AND (day_of_week <= 6)));
ALTER TABLE public.time_slots ADD CONSTRAINT time_slots_check CHECK ((end_time > start_time));
ALTER TABLE public.time_slots ADD CONSTRAINT time_slots_pkey PRIMARY KEY (id);
ALTER TABLE public.course_offerings ADD CONSTRAINT course_offerings_pkey PRIMARY KEY (id);
ALTER TABLE public.teaching_assignments ADD CONSTRAINT teaching_assignments_pkey PRIMARY KEY (id);
ALTER TABLE public.instructor_types ADD CONSTRAINT instructor_types_pkey PRIMARY KEY (id);
ALTER TABLE public.room_types ADD CONSTRAINT room_types_pkey PRIMARY KEY (id);
ALTER TABLE public.academic_buildings ADD CONSTRAINT academic_buildings_pkey PRIMARY KEY (id);
ALTER TABLE public.session_types ADD CONSTRAINT session_types_pkey PRIMARY KEY (id);
ALTER TABLE public.scheduling_settings ADD CONSTRAINT scheduling_settings_pkey PRIMARY KEY (id);
ALTER TABLE public.scheduling_settings ADD CONSTRAINT scheduling_settings_college_id_key UNIQUE (college_id);
ALTER TABLE public.academic_calendar ADD CONSTRAINT academic_calendar_pkey PRIMARY KEY (id);
ALTER TABLE public.course_departments ADD CONSTRAINT course_departments_pkey PRIMARY KEY (id);
ALTER TABLE public.course_departments ADD CONSTRAINT course_departments_course_id_department_id_key UNIQUE (course_id, department_id);
ALTER TABLE public.import_templates ADD CONSTRAINT import_templates_pkey PRIMARY KEY (id);
ALTER TABLE public.import_template_columns ADD CONSTRAINT import_template_columns_pkey PRIMARY KEY (id);
ALTER TABLE public.room_availability ADD CONSTRAINT room_availability_day_of_week_check CHECK (((day_of_week >= 0) AND (day_of_week <= 6)));
ALTER TABLE public.room_availability ADD CONSTRAINT room_availability_check CHECK ((end_time > start_time));
ALTER TABLE public.room_availability ADD CONSTRAINT room_availability_pkey PRIMARY KEY (id);
ALTER TABLE public.course_programs ADD CONSTRAINT course_programs_pkey PRIMARY KEY (id);
ALTER TABLE public.course_programs ADD CONSTRAINT course_programs_college_id_course_id_program_id_key UNIQUE (college_id, course_id, program_id);
ALTER TABLE public.section_groups ADD CONSTRAINT section_groups_pkey PRIMARY KEY (id);
ALTER TABLE public.section_groups ADD CONSTRAINT section_groups_college_id_academic_term_id_course_id_group__key UNIQUE (college_id, academic_term_id, course_id, group_name);
ALTER TABLE public.section_group_members ADD CONSTRAINT section_group_members_pkey PRIMARY KEY (id);
ALTER TABLE public.section_group_members ADD CONSTRAINT section_group_members_section_group_id_section_id_key UNIQUE (section_group_id, section_id);
ALTER TABLE public.course_offering_sections ADD CONSTRAINT course_offering_sections_pkey PRIMARY KEY (id);
ALTER TABLE public.course_offering_sections ADD CONSTRAINT course_offering_sections_course_offering_id_section_id_key UNIQUE (course_offering_id, section_id);
ALTER TABLE public.course_offerings ADD CONSTRAINT co_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'approved'::text, 'scheduled'::text, 'cancelled'::text])));
ALTER TABLE public.daily_breaks ADD CONSTRAINT daily_breaks_pkey PRIMARY KEY (id);
ALTER TABLE public.courses ADD CONSTRAINT courses_course_nature_check CHECK ((course_nature = ANY (ARRAY['department'::text, 'college'::text, 'university'::text])));
ALTER TABLE public.import_jobs ADD CONSTRAINT ij_mode_check CHECK ((mode = ANY (ARRAY['insert_only'::text, 'update_existing'::text, 'upsert'::text])));
ALTER TABLE public.cohort_student_partitions ADD CONSTRAINT cohort_student_partitions_headcount_check CHECK ((headcount > 0));
ALTER TABLE public.import_jobs ADD CONSTRAINT import_jobs_pkey PRIMARY KEY (id);
ALTER TABLE public.import_errors ADD CONSTRAINT import_errors_pkey PRIMARY KEY (id);
ALTER TABLE public.departments ADD CONSTRAINT departments_study_system_check CHECK ((study_system = ANY (ARRAY['regular'::text, 'parallel'::text, 'both'::text])));
ALTER TABLE public.time_slot_templates ADD CONSTRAINT tst_study_system_check CHECK ((study_system = ANY (ARRAY['regular'::text, 'parallel'::text, 'both'::text])));
ALTER TABLE public.time_slot_templates ADD CONSTRAINT tst_day_check CHECK (((day_of_week >= 0) AND (day_of_week <= 6)));
ALTER TABLE public.time_slot_templates ADD CONSTRAINT tst_time_check CHECK ((end_time > start_time));
ALTER TABLE public.time_slot_templates ADD CONSTRAINT tst_duration_check CHECK (((slot_duration_minutes >= 15) AND (slot_duration_minutes <= 480)));
ALTER TABLE public.time_slot_templates ADD CONSTRAINT time_slot_templates_pkey PRIMARY KEY (id);
ALTER TABLE public.constraint_types ADD CONSTRAINT constraint_types_constraint_category_check CHECK ((constraint_category = ANY (ARRAY['hard'::text, 'soft'::text])));
ALTER TABLE public.constraint_types ADD CONSTRAINT constraint_types_pkey PRIMARY KEY (id);
ALTER TABLE public.constraint_types ADD CONSTRAINT constraint_types_code_key UNIQUE (code);
ALTER TABLE public.college_constraint_settings ADD CONSTRAINT college_constraint_settings_pkey PRIMARY KEY (id);
ALTER TABLE public.college_constraint_settings ADD CONSTRAINT college_constraint_settings_college_id_constraint_type_id_key UNIQUE (college_id, constraint_type_id);
ALTER TABLE public.cohort_student_partitions ADD CONSTRAINT cohort_student_partitions_pkey PRIMARY KEY (id);
ALTER TABLE public.cohort_student_partitions ADD CONSTRAINT cohort_student_partitions_code_uniq UNIQUE (cohort_id, partition_code);
ALTER TABLE public.schedule_versions ADD CONSTRAINT schedule_versions_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'review'::text, 'approved'::text, 'published'::text, 'archived'::text])));
ALTER TABLE public.schedule_versions ADD CONSTRAINT schedule_versions_pkey PRIMARY KEY (id);
ALTER TABLE public.schedule_sessions ADD CONSTRAINT schedule_sessions_study_system_check CHECK ((study_system = ANY (ARRAY['regular'::text, 'parallel'::text, 'both'::text])));
ALTER TABLE public.schedule_sessions ADD CONSTRAINT schedule_sessions_day_of_week_check CHECK (((day_of_week >= 0) AND (day_of_week <= 6)));
ALTER TABLE public.schedule_sessions ADD CONSTRAINT schedule_sessions_check CHECK ((end_time > start_time));
ALTER TABLE public.schedule_sessions ADD CONSTRAINT schedule_sessions_pkey PRIMARY KEY (id);
ALTER TABLE public.delivery_group_partition_members ADD CONSTRAINT delivery_group_partition_members_pkey PRIMARY KEY (id);
ALTER TABLE public.conflict_checks ADD CONSTRAINT conflict_checks_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'completed'::text, 'failed'::text])));
ALTER TABLE public.conflict_checks ADD CONSTRAINT conflict_checks_pkey PRIMARY KEY (id);
ALTER TABLE public.delivery_group_partition_members ADD CONSTRAINT dgpm_uniq UNIQUE (delivery_group_id, partition_id);
ALTER TABLE public.conflict_results ADD CONSTRAINT conflict_results_pkey PRIMARY KEY (id);
ALTER TABLE public.conflict_results ADD CONSTRAINT conflict_results_severity_check CHECK ((severity = ANY (ARRAY['hard'::text, 'soft'::text])));
ALTER TABLE public.conflict_checks ADD CONSTRAINT conflict_checks_check_type_check CHECK ((check_type = ANY (ARRAY['hard'::text, 'soft'::text, 'full'::text])));
ALTER TABLE public.schedule_quality_runs ADD CONSTRAINT schedule_quality_runs_pkey PRIMARY KEY (id);
ALTER TABLE public.quality_metrics ADD CONSTRAINT quality_metrics_pkey PRIMARY KEY (id);
ALTER TABLE public.quality_metrics ADD CONSTRAINT quality_metrics_code_key UNIQUE (code);
ALTER TABLE public.college_quality_settings ADD CONSTRAINT college_quality_settings_pkey PRIMARY KEY (id);
ALTER TABLE public.college_quality_settings ADD CONSTRAINT college_quality_settings_college_id_quality_metric_id_key UNIQUE (college_id, quality_metric_id);
ALTER TABLE public.auto_schedule_runs ADD CONSTRAINT auto_sr_status_check CHECK ((status = ANY (ARRAY['running'::text, 'completed'::text, 'failed'::text, 'partial'::text])));
ALTER TABLE public.auto_schedule_runs ADD CONSTRAINT auto_schedule_runs_pkey PRIMARY KEY (id);
ALTER TABLE public.schedule_version_events ADD CONSTRAINT schedule_version_events_event_type_check CHECK ((event_type = ANY (ARRAY['submitted_for_review'::text, 'approved'::text, 'published'::text, 'archived'::text, 'cloned'::text, 'rolled_back_to_draft'::text, 'rolled_back_to_review'::text, 'reverted'::text])));
ALTER TABLE public.schedule_version_events ADD CONSTRAINT schedule_version_events_pkey PRIMARY KEY (id);
ALTER TABLE public.course_offerings ADD CONSTRAINT course_offerings_study_system_check CHECK ((study_system = ANY (ARRAY['regular'::text, 'parallel'::text, 'both'::text])));
ALTER TABLE public.sections ADD CONSTRAINT sections_study_system_check CHECK ((study_system = ANY (ARRAY['regular'::text, 'parallel'::text, 'both'::text])));
ALTER TABLE public.academic_terms ADD CONSTRAINT at_term_type_check CHECK (((term_type IS NULL) OR (term_type = ANY (ARRAY['first'::text, 'second'::text]))));
ALTER TABLE public.sections ADD CONSTRAINT sections_course_term_section_system_key UNIQUE (course_id, term_id, section_number, study_system);
ALTER TABLE public.rooms ADD CONSTRAINT rooms_room_type_check CHECK ((room_type = ANY (ARRAY['lecture_hall'::text, 'computer_lab'::text, 'network_lab'::text, 'cybersecurity_lab'::text, 'electronics_lab'::text, 'workshop'::text, 'seminar_room'::text])));
ALTER TABLE public.teaching_assignments ADD CONSTRAINT teaching_assignments_required_room_type_check CHECK (((required_room_type IS NULL) OR (required_room_type = ANY (ARRAY['lecture_hall'::text, 'computer_lab'::text, 'network_lab'::text, 'cybersecurity_lab'::text, 'electronics_lab'::text, 'workshop'::text, 'seminar_room'::text]))));
ALTER TABLE public.teaching_assignments ADD CONSTRAINT teaching_assignments_session_type_check CHECK ((session_type = ANY (ARRAY['lecture'::text, 'lab'::text, 'tutorial'::text, 'seminar'::text, 'workshop'::text])));
ALTER TABLE public.schedule_version_conflict_exceptions ADD CONSTRAINT schedule_version_conflict_exceptions_status_check CHECK ((status = ANY (ARRAY['approved'::text, 'revoked'::text])));
ALTER TABLE public.schedule_version_conflict_exceptions ADD CONSTRAINT svce_session_pair_distinct CHECK (((related_session_id IS NULL) OR (session_id <> related_session_id)));
ALTER TABLE public.schedule_version_conflict_exceptions ADD CONSTRAINT svce_approved_at_when_approved CHECK (((status <> 'approved'::text) OR (approved_at IS NOT NULL)));
ALTER TABLE public.schedule_version_conflict_exceptions ADD CONSTRAINT schedule_version_conflict_exceptions_pkey PRIMARY KEY (id);
ALTER TABLE public.section_subgroups ADD CONSTRAINT section_subgroups_ordinal_check CHECK (((ordinal >= 1) AND (ordinal <= 4)));
ALTER TABLE public.section_subgroups ADD CONSTRAINT section_subgroups_expected_students_check CHECK ((expected_students >= 0));
ALTER TABLE public.section_subgroups ADD CONSTRAINT section_subgroups_pkey PRIMARY KEY (id);
ALTER TABLE public.section_subgroups ADD CONSTRAINT section_subgroups_section_id_subgroup_code_key UNIQUE (section_id, subgroup_code);
ALTER TABLE public.section_subgroups ADD CONSTRAINT section_subgroups_section_id_ordinal_key UNIQUE (section_id, ordinal);
ALTER TABLE public.schedule_sessions ADD CONSTRAINT schedule_sessions_source_type_chk CHECK ((source_type = ANY (ARRAY['manual'::text, 'auto_generated'::text, 'cloned'::text, 'capacity_subgroup_child'::text])));
ALTER TABLE public.course_offerings ADD CONSTRAINT course_offerings_enrollment_count_status_chk CHECK ((enrollment_count_status = ANY (ARRAY['confirmed'::text, 'estimated'::text, 'unverified'::text, 'test'::text])));
ALTER TABLE public.delivery_groups ADD CONSTRAINT dg_group_number_positive_chk CHECK (((group_number IS NULL) OR (group_number >= 1)));
ALTER TABLE public.plan_course_components ADD CONSTRAINT pcc_explicit_group_size_chk CHECK (((explicit_group_size IS NULL) OR (explicit_group_size > 0)));
ALTER TABLE public.academic_cohorts ADD CONSTRAINT ac_study_system_chk CHECK ((study_system = ANY (ARRAY['regular'::text, 'parallel'::text, 'evening'::text, 'distance'::text, 'other'::text])));
ALTER TABLE public.academic_cohorts ADD CONSTRAINT ac_count_status_chk CHECK ((count_status = ANY (ARRAY['estimated'::text, 'confirmed'::text, 'locked'::text])));
ALTER TABLE public.academic_cohorts ADD CONSTRAINT academic_cohorts_pkey PRIMARY KEY (id);
ALTER TABLE public.academic_cohorts ADD CONSTRAINT ac_unique UNIQUE (program_id, level_id, study_system, entry_year, term_id);
ALTER TABLE public.plan_course_components ADD CONSTRAINT pcc_component_type_chk CHECK ((component_type = ANY (ARRAY['theory'::text, 'practical'::text, 'tutorial'::text, 'project'::text, 'summer_training'::text])));
ALTER TABLE public.plan_course_components ADD CONSTRAINT pcc_compensation_mode_chk CHECK ((compensation_mode = ANY (ARRAY['per_hour'::text, 'per_group_flat'::text, 'none'::text])));
ALTER TABLE public.plan_course_components ADD CONSTRAINT plan_course_components_pkey PRIMARY KEY (id);
ALTER TABLE public.plan_course_components ADD CONSTRAINT pcc_unique UNIQUE (plan_course_id, component_type);
ALTER TABLE public.elective_slots ADD CONSTRAINT es_required_component_chk CHECK ((required_component_type = ANY (ARRAY['theory'::text, 'practical'::text, 'tutorial'::text, 'project'::text, 'summer_training'::text])));
ALTER TABLE public.elective_slots ADD CONSTRAINT elective_slots_pkey PRIMARY KEY (id);
ALTER TABLE public.elective_slots ADD CONSTRAINT es_unique UNIQUE (study_plan_id, semester, slot_code);
ALTER TABLE public.elective_slot_courses ADD CONSTRAINT elective_slot_courses_pkey PRIMARY KEY (id);
ALTER TABLE public.elective_slot_courses ADD CONSTRAINT esc_unique UNIQUE (elective_slot_id, course_id);
ALTER TABLE public.cohort_elective_selections ADD CONSTRAINT cohort_elective_selections_pkey PRIMARY KEY (id);
ALTER TABLE public.cohort_elective_selections ADD CONSTRAINT ces_unique UNIQUE (cohort_id, elective_slot_id);
ALTER TABLE public.delivery_groups ADD CONSTRAINT delivery_groups_pkey PRIMARY KEY (id);
ALTER TABLE public.delivery_groups ADD CONSTRAINT dg_unique UNIQUE (component_id, cohort_id, group_code);
ALTER TABLE public.teaching_assignments ADD CONSTRAINT ta_assigned_component_hours_chk CHECK (((assigned_component_hours IS NULL) OR (assigned_component_hours >= (0)::numeric)));
ALTER TABLE public.faculty_workload_policies ADD CONSTRAINT fwp_rank_code_chk CHECK ((rank_code ~ '^[a-z][a-z0-9_]*$'::text));
ALTER TABLE public.faculty_workload_policies ADD CONSTRAINT fwp_required_load_chk CHECK ((required_load_hours > (0)::numeric));
ALTER TABLE public.faculty_workload_policies ADD CONSTRAINT faculty_workload_policies_pkey PRIMARY KEY (id);
ALTER TABLE public.faculty_workload_policies ADD CONSTRAINT fwp_unique UNIQUE (college_id, rank_code);
ALTER TABLE public.import_jobs ADD CONSTRAINT import_jobs_status_check CHECK ((status = ANY (ARRAY['preview'::text, 'committing'::text, 'committed'::text, 'failed'::text, 'cancelled'::text])));
ALTER TABLE public.academic_programs ADD CONSTRAINT academic_programs_id_college_key UNIQUE (id, college_id);
ALTER TABLE public.academic_levels ADD CONSTRAINT academic_levels_id_college_key UNIQUE (id, college_id);
ALTER TABLE public.academic_terms ADD CONSTRAINT academic_terms_id_college_key UNIQUE (id, college_id);
ALTER TABLE public.plan_courses ADD CONSTRAINT plan_courses_id_college_key UNIQUE (id, college_id);
ALTER TABLE public.room_types ADD CONSTRAINT room_types_id_college_key UNIQUE (id, college_id);
ALTER TABLE public.study_plans ADD CONSTRAINT study_plans_id_college_key UNIQUE (id, college_id);
ALTER TABLE public.elective_slots ADD CONSTRAINT elective_slots_id_college_key UNIQUE (id, college_id);
ALTER TABLE public.courses ADD CONSTRAINT courses_id_college_key UNIQUE (id, college_id);
ALTER TABLE public.academic_cohorts ADD CONSTRAINT academic_cohorts_id_college_key UNIQUE (id, college_id);
ALTER TABLE public.plan_course_components ADD CONSTRAINT pcc_id_college_key UNIQUE (id, college_id);
ALTER TABLE public.delivery_groups ADD CONSTRAINT delivery_groups_id_college_key UNIQUE (id, college_id);
ALTER TABLE public.scheduling_cohort_term_headcounts ADD CONSTRAINT scheduling_cohort_term_headcounts_study_system_check CHECK ((study_system = ANY (ARRAY['regular'::text, 'parallel'::text, 'evening'::text, 'distance'::text, 'other'::text])));
ALTER TABLE public.scheduling_cohort_term_headcounts ADD CONSTRAINT scheduling_cohort_term_headcount_registered_student_count_check CHECK ((registered_student_count >= 0));
ALTER TABLE public.scheduling_cohort_term_headcounts ADD CONSTRAINT scheduling_cohort_term_headcounts_eligible_student_count_check CHECK ((eligible_student_count >= 0));
ALTER TABLE public.scheduling_cohort_term_headcounts ADD CONSTRAINT scheduling_cohort_term_headcoun_expected_attendance_count_check CHECK ((expected_attendance_count >= 0));
ALTER TABLE public.scheduling_cohort_term_headcounts ADD CONSTRAINT scheduling_cohort_term_headcounts_reserve_margin_check CHECK ((reserve_margin >= 0));
ALTER TABLE public.scheduling_cohort_term_headcounts ADD CONSTRAINT scheduling_cohort_term_headcounts_scheduling_headcount_check CHECK ((scheduling_headcount >= 0));
ALTER TABLE public.scheduling_cohort_term_headcounts ADD CONSTRAINT scheduling_cohort_term_headcounts_exam_eligible_count_check CHECK ((exam_eligible_count >= 0));
ALTER TABLE public.scheduling_cohort_term_headcounts ADD CONSTRAINT scheduling_cohort_term_headcounts_approval_status_check CHECK ((approval_status = ANY (ARRAY['draft'::text, 'approved'::text, 'archived'::text])));
ALTER TABLE public.scheduling_cohort_term_headcounts ADD CONSTRAINT scheduling_cohort_term_headcounts_pkey PRIMARY KEY (id);
ALTER TABLE public.scheduling_cohort_term_headcounts ADD CONSTRAINT scheduling_cohort_term_headcounts_cohort_term_key UNIQUE (cohort_id, term_id);
ALTER TABLE public.scheduling_headcount_overrides ADD CONSTRAINT scheduling_headcount_overrides_scheduling_headcount_check CHECK ((scheduling_headcount >= 0));
ALTER TABLE public.scheduling_headcount_overrides ADD CONSTRAINT scheduling_headcount_overrides_exam_eligible_count_check CHECK ((exam_eligible_count >= 0));
ALTER TABLE public.scheduling_headcount_overrides ADD CONSTRAINT scheduling_headcount_overrides_reserve_margin_check CHECK ((reserve_margin >= 0));
ALTER TABLE public.scheduling_headcount_overrides ADD CONSTRAINT scheduling_headcount_overrides_approval_status_check CHECK ((approval_status = ANY (ARRAY['draft'::text, 'approved'::text, 'archived'::text])));
ALTER TABLE public.scheduling_headcount_overrides ADD CONSTRAINT scheduling_headcount_override_target_required CHECK (((course_offering_id IS NOT NULL) OR (plan_course_component_id IS NOT NULL)));
ALTER TABLE public.scheduling_headcount_overrides ADD CONSTRAINT scheduling_headcount_overrides_pkey PRIMARY KEY (id);
ALTER TABLE public.scheduling_headcount_revisions ADD CONSTRAINT scheduling_headcount_revisions_revision_kind_check CHECK ((revision_kind = ANY (ARRAY['create'::text, 'update'::text, 'approve'::text, 'override_upsert'::text, 'override_archive'::text])));
ALTER TABLE public.scheduling_headcount_revisions ADD CONSTRAINT scheduling_headcount_revisions_pkey PRIMARY KEY (id);
CREATE UNIQUE INDEX import_template_columns_tpl_field_key ON public.import_template_columns USING btree (template_id, lower(field_key));
CREATE UNIQUE INDEX scheduling_headcount_override_active_grain_key ON public.scheduling_headcount_overrides USING btree (headcount_id, COALESCE(course_offering_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(plan_course_component_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE active;
CREATE UNIQUE INDEX instructors_college_email_uniq ON public.instructors USING btree (college_id, lower(email)) WHERE (email IS NOT NULL);
CREATE UNIQUE INDEX instructors_college_emp_no_uq ON public.instructors USING btree (college_id, employee_number) WHERE (employee_number IS NOT NULL);
CREATE UNIQUE INDEX session_types_college_code_key ON public.session_types USING btree (college_id, lower(code));
CREATE UNIQUE INDEX ts_college_day_start_uniq ON public.time_slots USING btree (college_id, day_of_week, start_time);
CREATE UNIQUE INDEX ts_college_day_order_uniq ON public.time_slots USING btree (college_id, day_of_week, slot_order);
CREATE UNIQUE INDEX import_templates_key_ver_key ON public.import_templates USING btree (college_id, lower(template_key), version);
CREATE UNIQUE INDEX room_types_college_code_key ON public.room_types USING btree (college_id, lower(code));
CREATE UNIQUE INDEX room_types_college_code_uq ON public.room_types USING btree (college_id, code);
CREATE UNIQUE INDEX ta_unique ON public.teaching_assignments USING btree (college_id, course_offering_id, instructor_id, session_type, COALESCE(section_number, ''::text));
CREATE UNIQUE INDEX ta_v2_delivery_group_instructor_uniq ON public.teaching_assignments USING btree (college_id, delivery_group_id, instructor_id) WHERE ((delivery_group_id IS NOT NULL) AND (is_active = true));
CREATE UNIQUE INDEX rooms_college_code_uniq ON public.rooms USING btree (college_id, lower(code));
CREATE UNIQUE INDEX uq_svce_active_pair ON public.schedule_version_conflict_exceptions USING btree (schedule_version_id, conflict_code, LEAST(session_id, COALESCE(related_session_id, session_id)), GREATEST(session_id, COALESCE(related_session_id, session_id))) WHERE (status = 'approved'::text);
CREATE UNIQUE INDEX instructor_types_college_code_key ON public.instructor_types USING btree (college_id, lower(code));
CREATE UNIQUE INDEX instructor_types_college_code_uq ON public.instructor_types USING btree (college_id, code);
CREATE UNIQUE INDEX co_unique ON public.course_offerings USING btree (college_id, term_id, course_id, COALESCE(program_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(level_id, '00000000-0000-0000-0000-000000000000'::uuid), study_system);
CREATE UNIQUE INDEX dg_cohort_component_group_number_uniq ON public.delivery_groups USING btree (cohort_id, component_id, group_number) WHERE (group_number IS NOT NULL);
CREATE UNIQUE INDEX academic_buildings_college_code_key ON public.academic_buildings USING btree (college_id, lower(code));
ALTER TABLE public.colleges ADD CONSTRAINT colleges_university_id_fkey FOREIGN KEY (university_id) REFERENCES universities(id) ON DELETE CASCADE;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.user_colleges ADD CONSTRAINT user_colleges_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.user_colleges ADD CONSTRAINT user_colleges_college_id_fkey FOREIGN KEY (college_id) REFERENCES colleges(id) ON DELETE CASCADE;
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_college_id_fkey FOREIGN KEY (college_id) REFERENCES colleges(id) ON DELETE SET NULL;
ALTER TABLE public.departments ADD CONSTRAINT departments_college_id_fkey FOREIGN KEY (college_id) REFERENCES colleges(id) ON DELETE CASCADE;
ALTER TABLE public.academic_programs ADD CONSTRAINT academic_programs_college_id_fkey FOREIGN KEY (college_id) REFERENCES colleges(id) ON DELETE CASCADE;
ALTER TABLE public.academic_programs ADD CONSTRAINT academic_programs_department_id_fkey FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE;
ALTER TABLE public.study_plans ADD CONSTRAINT study_plans_college_id_fkey FOREIGN KEY (college_id) REFERENCES colleges(id) ON DELETE CASCADE;
ALTER TABLE public.study_plans ADD CONSTRAINT study_plans_program_id_fkey FOREIGN KEY (program_id) REFERENCES academic_programs(id) ON DELETE CASCADE;
ALTER TABLE public.academic_levels ADD CONSTRAINT academic_levels_college_id_fkey FOREIGN KEY (college_id) REFERENCES colleges(id) ON DELETE CASCADE;
ALTER TABLE public.academic_levels ADD CONSTRAINT academic_levels_program_id_fkey FOREIGN KEY (program_id) REFERENCES academic_programs(id) ON DELETE CASCADE;
ALTER TABLE public.courses ADD CONSTRAINT courses_college_id_fkey FOREIGN KEY (college_id) REFERENCES colleges(id) ON DELETE CASCADE;
ALTER TABLE public.courses ADD CONSTRAINT courses_department_id_fkey FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE;
ALTER TABLE public.plan_courses ADD CONSTRAINT plan_courses_college_id_fkey FOREIGN KEY (college_id) REFERENCES colleges(id) ON DELETE CASCADE;
ALTER TABLE public.plan_courses ADD CONSTRAINT plan_courses_study_plan_id_fkey FOREIGN KEY (study_plan_id) REFERENCES study_plans(id) ON DELETE CASCADE;
ALTER TABLE public.plan_courses ADD CONSTRAINT plan_courses_course_id_fkey FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE;
ALTER TABLE public.plan_courses ADD CONSTRAINT plan_courses_level_id_fkey FOREIGN KEY (level_id) REFERENCES academic_levels(id) ON DELETE SET NULL;
ALTER TABLE public.academic_terms ADD CONSTRAINT academic_terms_college_id_fkey FOREIGN KEY (college_id) REFERENCES colleges(id) ON DELETE CASCADE;
ALTER TABLE public.sections ADD CONSTRAINT sections_college_id_fkey FOREIGN KEY (college_id) REFERENCES colleges(id) ON DELETE CASCADE;
ALTER TABLE public.sections ADD CONSTRAINT sections_course_id_fkey FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE;
ALTER TABLE public.sections ADD CONSTRAINT sections_term_id_fkey FOREIGN KEY (term_id) REFERENCES academic_terms(id) ON DELETE CASCADE;
ALTER TABLE public.college_constraint_settings ADD CONSTRAINT college_constraint_settings_constraint_type_id_fkey FOREIGN KEY (constraint_type_id) REFERENCES constraint_types(id) ON DELETE CASCADE;
ALTER TABLE public.plan_course_components ADD CONSTRAINT pcc_room_type_college_fkey FOREIGN KEY (required_room_type_id, college_id) REFERENCES room_types(id, college_id) ON DELETE RESTRICT;
ALTER TABLE public.elective_slots ADD CONSTRAINT es_study_plan_college_fkey FOREIGN KEY (study_plan_id, college_id) REFERENCES study_plans(id, college_id) ON DELETE RESTRICT;
ALTER TABLE public.elective_slots ADD CONSTRAINT es_level_college_fkey FOREIGN KEY (level_id, college_id) REFERENCES academic_levels(id, college_id) ON DELETE RESTRICT;
ALTER TABLE public.elective_slot_courses ADD CONSTRAINT esc_slot_college_fkey FOREIGN KEY (elective_slot_id, college_id) REFERENCES elective_slots(id, college_id) ON DELETE RESTRICT;
ALTER TABLE public.cohort_student_partitions ADD CONSTRAINT cohort_student_partitions_college_id_fkey FOREIGN KEY (college_id) REFERENCES colleges(id) ON DELETE CASCADE;
ALTER TABLE public.cohort_student_partitions ADD CONSTRAINT cohort_student_partitions_cohort_id_fkey FOREIGN KEY (cohort_id) REFERENCES academic_cohorts(id) ON DELETE CASCADE;
ALTER TABLE public.schedule_sessions ADD CONSTRAINT schedule_sessions_schedule_version_id_fkey FOREIGN KEY (schedule_version_id) REFERENCES schedule_versions(id) ON DELETE CASCADE;
ALTER TABLE public.conflict_checks ADD CONSTRAINT conflict_checks_schedule_version_id_fkey FOREIGN KEY (schedule_version_id) REFERENCES schedule_versions(id) ON DELETE CASCADE;
ALTER TABLE public.elective_slot_courses ADD CONSTRAINT esc_course_college_fkey FOREIGN KEY (course_id, college_id) REFERENCES courses(id, college_id) ON DELETE RESTRICT;
ALTER TABLE public.cohort_elective_selections ADD CONSTRAINT ces_cohort_college_fkey FOREIGN KEY (cohort_id, college_id) REFERENCES academic_cohorts(id, college_id) ON DELETE RESTRICT;
ALTER TABLE public.cohort_elective_selections ADD CONSTRAINT ces_slot_college_fkey FOREIGN KEY (elective_slot_id, college_id) REFERENCES elective_slots(id, college_id) ON DELETE RESTRICT;
ALTER TABLE public.delivery_group_partition_members ADD CONSTRAINT delivery_group_partition_members_college_id_fkey FOREIGN KEY (college_id) REFERENCES colleges(id) ON DELETE CASCADE;
ALTER TABLE public.delivery_group_partition_members ADD CONSTRAINT delivery_group_partition_members_cohort_id_fkey FOREIGN KEY (cohort_id) REFERENCES academic_cohorts(id) ON DELETE CASCADE;
ALTER TABLE public.delivery_group_partition_members ADD CONSTRAINT delivery_group_partition_members_delivery_group_id_fkey FOREIGN KEY (delivery_group_id) REFERENCES delivery_groups(id) ON DELETE CASCADE;
ALTER TABLE public.conflict_results ADD CONSTRAINT conflict_results_conflict_check_id_fkey FOREIGN KEY (conflict_check_id) REFERENCES conflict_checks(id) ON DELETE CASCADE;
ALTER TABLE public.conflict_results ADD CONSTRAINT conflict_results_conflict_type_id_fkey FOREIGN KEY (conflict_type_id) REFERENCES constraint_types(id) ON DELETE SET NULL;
ALTER TABLE public.college_quality_settings ADD CONSTRAINT college_quality_settings_quality_metric_id_fkey FOREIGN KEY (quality_metric_id) REFERENCES quality_metrics(id) ON DELETE CASCADE;
ALTER TABLE public.auto_schedule_runs ADD CONSTRAINT auto_schedule_runs_schedule_version_id_fkey FOREIGN KEY (schedule_version_id) REFERENCES schedule_versions(id) ON DELETE CASCADE;
ALTER TABLE public.schedule_version_events ADD CONSTRAINT schedule_version_events_schedule_version_id_fkey FOREIGN KEY (schedule_version_id) REFERENCES schedule_versions(id) ON DELETE CASCADE;
ALTER TABLE public.delivery_group_partition_members ADD CONSTRAINT delivery_group_partition_members_partition_id_fkey FOREIGN KEY (partition_id) REFERENCES cohort_student_partitions(id) ON DELETE CASCADE;
ALTER TABLE public.cohort_elective_selections ADD CONSTRAINT ces_course_college_fkey FOREIGN KEY (selected_course_id, college_id) REFERENCES courses(id, college_id) ON DELETE RESTRICT;
ALTER TABLE public.delivery_groups ADD CONSTRAINT dg_cohort_college_fkey FOREIGN KEY (cohort_id, college_id) REFERENCES academic_cohorts(id, college_id) ON DELETE RESTRICT;
ALTER TABLE public.delivery_groups ADD CONSTRAINT dg_plan_course_college_fkey FOREIGN KEY (plan_course_id, college_id) REFERENCES plan_courses(id, college_id) ON DELETE RESTRICT;
ALTER TABLE public.delivery_groups ADD CONSTRAINT dg_component_college_fkey FOREIGN KEY (component_id, college_id) REFERENCES plan_course_components(id, college_id) ON DELETE RESTRICT;
ALTER TABLE public.schedule_version_conflict_exceptions ADD CONSTRAINT schedule_version_conflict_exceptions_schedule_version_id_fkey FOREIGN KEY (schedule_version_id) REFERENCES schedule_versions(id) ON DELETE CASCADE;
ALTER TABLE public.schedule_version_conflict_exceptions ADD CONSTRAINT schedule_version_conflict_exceptions_session_id_fkey FOREIGN KEY (session_id) REFERENCES schedule_sessions(id) ON DELETE CASCADE;
ALTER TABLE public.schedule_version_conflict_exceptions ADD CONSTRAINT schedule_version_conflict_exceptions_related_session_id_fkey FOREIGN KEY (related_session_id) REFERENCES schedule_sessions(id) ON DELETE CASCADE;
ALTER TABLE public.teaching_assignments ADD CONSTRAINT ta_cohort_college_fkey FOREIGN KEY (cohort_id, college_id) REFERENCES academic_cohorts(id, college_id) ON DELETE RESTRICT;
ALTER TABLE public.schedule_sessions ADD CONSTRAINT schedule_sessions_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE RESTRICT;
ALTER TABLE public.room_availability ADD CONSTRAINT room_availability_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE RESTRICT;
ALTER TABLE public.room_unavailability ADD CONSTRAINT room_unavailability_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE RESTRICT;
ALTER TABLE public.course_offerings ADD CONSTRAINT course_offerings_term_id_fkey FOREIGN KEY (term_id) REFERENCES academic_terms(id) ON DELETE RESTRICT;
ALTER TABLE public.teaching_assignments ADD CONSTRAINT teaching_assignments_course_offering_id_fkey FOREIGN KEY (course_offering_id) REFERENCES course_offerings(id) ON DELETE RESTRICT;
ALTER TABLE public.course_offering_sections ADD CONSTRAINT course_offering_sections_course_offering_id_fkey FOREIGN KEY (course_offering_id) REFERENCES course_offerings(id) ON DELETE RESTRICT;
ALTER TABLE public.schedule_sessions ADD CONSTRAINT schedule_sessions_course_offering_id_fkey FOREIGN KEY (course_offering_id) REFERENCES course_offerings(id) ON DELETE RESTRICT;
ALTER TABLE public.academic_cohorts ADD CONSTRAINT academic_cohorts_college_id_fkey FOREIGN KEY (college_id) REFERENCES colleges(id) ON DELETE RESTRICT;
ALTER TABLE public.academic_cohorts ADD CONSTRAINT academic_cohorts_program_id_fkey FOREIGN KEY (program_id) REFERENCES academic_programs(id) ON DELETE RESTRICT;
ALTER TABLE public.academic_cohorts ADD CONSTRAINT academic_cohorts_level_id_fkey FOREIGN KEY (level_id) REFERENCES academic_levels(id) ON DELETE RESTRICT;
ALTER TABLE public.academic_cohorts ADD CONSTRAINT academic_cohorts_term_id_fkey FOREIGN KEY (term_id) REFERENCES academic_terms(id) ON DELETE RESTRICT;
ALTER TABLE public.plan_course_components ADD CONSTRAINT plan_course_components_college_id_fkey FOREIGN KEY (college_id) REFERENCES colleges(id) ON DELETE RESTRICT;
ALTER TABLE public.plan_course_components ADD CONSTRAINT plan_course_components_plan_course_id_fkey FOREIGN KEY (plan_course_id) REFERENCES plan_courses(id) ON DELETE RESTRICT;
ALTER TABLE public.plan_course_components ADD CONSTRAINT plan_course_components_required_room_type_id_fkey FOREIGN KEY (required_room_type_id) REFERENCES room_types(id) ON DELETE RESTRICT;
ALTER TABLE public.plan_course_components ADD CONSTRAINT pcc_plan_course_college_fkey FOREIGN KEY (plan_course_id, college_id) REFERENCES plan_courses(id, college_id) ON DELETE RESTRICT;
ALTER TABLE public.elective_slots ADD CONSTRAINT elective_slots_college_id_fkey FOREIGN KEY (college_id) REFERENCES colleges(id) ON DELETE RESTRICT;
ALTER TABLE public.elective_slots ADD CONSTRAINT elective_slots_study_plan_id_fkey FOREIGN KEY (study_plan_id) REFERENCES study_plans(id) ON DELETE RESTRICT;
ALTER TABLE public.elective_slots ADD CONSTRAINT elective_slots_level_id_fkey FOREIGN KEY (level_id) REFERENCES academic_levels(id) ON DELETE RESTRICT;
ALTER TABLE public.elective_slot_courses ADD CONSTRAINT elective_slot_courses_college_id_fkey FOREIGN KEY (college_id) REFERENCES colleges(id) ON DELETE RESTRICT;
ALTER TABLE public.elective_slot_courses ADD CONSTRAINT elective_slot_courses_elective_slot_id_fkey FOREIGN KEY (elective_slot_id) REFERENCES elective_slots(id) ON DELETE RESTRICT;
ALTER TABLE public.elective_slot_courses ADD CONSTRAINT elective_slot_courses_course_id_fkey FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE RESTRICT;
ALTER TABLE public.cohort_elective_selections ADD CONSTRAINT cohort_elective_selections_college_id_fkey FOREIGN KEY (college_id) REFERENCES colleges(id) ON DELETE RESTRICT;
ALTER TABLE public.cohort_elective_selections ADD CONSTRAINT cohort_elective_selections_cohort_id_fkey FOREIGN KEY (cohort_id) REFERENCES academic_cohorts(id) ON DELETE RESTRICT;
ALTER TABLE public.cohort_elective_selections ADD CONSTRAINT cohort_elective_selections_elective_slot_id_fkey FOREIGN KEY (elective_slot_id) REFERENCES elective_slots(id) ON DELETE RESTRICT;
ALTER TABLE public.cohort_elective_selections ADD CONSTRAINT cohort_elective_selections_selected_course_id_fkey FOREIGN KEY (selected_course_id) REFERENCES courses(id) ON DELETE RESTRICT;
ALTER TABLE public.delivery_groups ADD CONSTRAINT delivery_groups_college_id_fkey FOREIGN KEY (college_id) REFERENCES colleges(id) ON DELETE RESTRICT;
ALTER TABLE public.delivery_groups ADD CONSTRAINT delivery_groups_cohort_id_fkey FOREIGN KEY (cohort_id) REFERENCES academic_cohorts(id) ON DELETE RESTRICT;
ALTER TABLE public.delivery_groups ADD CONSTRAINT delivery_groups_plan_course_id_fkey FOREIGN KEY (plan_course_id) REFERENCES plan_courses(id) ON DELETE RESTRICT;
ALTER TABLE public.delivery_groups ADD CONSTRAINT delivery_groups_component_id_fkey FOREIGN KEY (component_id) REFERENCES plan_course_components(id) ON DELETE RESTRICT;
ALTER TABLE public.teaching_assignments ADD CONSTRAINT teaching_assignments_cohort_id_fkey FOREIGN KEY (cohort_id) REFERENCES academic_cohorts(id) ON DELETE RESTRICT;
ALTER TABLE public.teaching_assignments ADD CONSTRAINT teaching_assignments_plan_course_component_id_fkey FOREIGN KEY (plan_course_component_id) REFERENCES plan_course_components(id) ON DELETE RESTRICT;
ALTER TABLE public.teaching_assignments ADD CONSTRAINT teaching_assignments_delivery_group_id_fkey FOREIGN KEY (delivery_group_id) REFERENCES delivery_groups(id) ON DELETE RESTRICT;
ALTER TABLE public.schedule_sessions ADD CONSTRAINT schedule_sessions_cohort_id_fkey FOREIGN KEY (cohort_id) REFERENCES academic_cohorts(id) ON DELETE RESTRICT;
ALTER TABLE public.schedule_sessions ADD CONSTRAINT schedule_sessions_plan_course_component_id_fkey FOREIGN KEY (plan_course_component_id) REFERENCES plan_course_components(id) ON DELETE RESTRICT;
ALTER TABLE public.schedule_sessions ADD CONSTRAINT schedule_sessions_delivery_group_id_fkey FOREIGN KEY (delivery_group_id) REFERENCES delivery_groups(id) ON DELETE RESTRICT;
ALTER TABLE public.faculty_workload_policies ADD CONSTRAINT faculty_workload_policies_college_id_fkey FOREIGN KEY (college_id) REFERENCES colleges(id) ON DELETE RESTRICT;
ALTER TABLE public.academic_cohorts ADD CONSTRAINT ac_program_college_fkey FOREIGN KEY (program_id, college_id) REFERENCES academic_programs(id, college_id) ON DELETE RESTRICT;
ALTER TABLE public.academic_cohorts ADD CONSTRAINT ac_level_college_fkey FOREIGN KEY (level_id, college_id) REFERENCES academic_levels(id, college_id) ON DELETE RESTRICT;
ALTER TABLE public.academic_cohorts ADD CONSTRAINT ac_term_college_fkey FOREIGN KEY (term_id, college_id) REFERENCES academic_terms(id, college_id) ON DELETE RESTRICT;
ALTER TABLE public.teaching_assignments ADD CONSTRAINT ta_component_college_fkey FOREIGN KEY (plan_course_component_id, college_id) REFERENCES plan_course_components(id, college_id) ON DELETE RESTRICT;
ALTER TABLE public.teaching_assignments ADD CONSTRAINT ta_delivery_group_college_fkey FOREIGN KEY (delivery_group_id, college_id) REFERENCES delivery_groups(id, college_id) ON DELETE RESTRICT;
ALTER TABLE public.schedule_sessions ADD CONSTRAINT ss_cohort_college_fkey FOREIGN KEY (cohort_id, college_id) REFERENCES academic_cohorts(id, college_id) ON DELETE RESTRICT;
ALTER TABLE public.schedule_sessions ADD CONSTRAINT ss_component_college_fkey FOREIGN KEY (plan_course_component_id, college_id) REFERENCES plan_course_components(id, college_id) ON DELETE RESTRICT;
ALTER TABLE public.schedule_sessions ADD CONSTRAINT ss_delivery_group_college_fkey FOREIGN KEY (delivery_group_id, college_id) REFERENCES delivery_groups(id, college_id) ON DELETE RESTRICT;
ALTER TABLE public.scheduling_cohort_term_headcounts ADD CONSTRAINT scheduling_cohort_term_headcounts_college_id_fkey FOREIGN KEY (college_id) REFERENCES colleges(id) ON DELETE RESTRICT;
ALTER TABLE public.scheduling_cohort_term_headcounts ADD CONSTRAINT scheduling_cohort_term_headcounts_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.scheduling_cohort_term_headcounts ADD CONSTRAINT scheduling_headcount_cohort_college_fkey FOREIGN KEY (cohort_id, college_id) REFERENCES academic_cohorts(id, college_id) ON DELETE RESTRICT;
ALTER TABLE public.scheduling_cohort_term_headcounts ADD CONSTRAINT scheduling_headcount_term_college_fkey FOREIGN KEY (term_id, college_id) REFERENCES academic_terms(id, college_id) ON DELETE RESTRICT;
ALTER TABLE public.scheduling_headcount_overrides ADD CONSTRAINT scheduling_headcount_overrides_college_id_fkey FOREIGN KEY (college_id) REFERENCES colleges(id) ON DELETE RESTRICT;
ALTER TABLE public.scheduling_headcount_overrides ADD CONSTRAINT scheduling_headcount_overrides_headcount_id_fkey FOREIGN KEY (headcount_id) REFERENCES scheduling_cohort_term_headcounts(id) ON DELETE RESTRICT;
ALTER TABLE public.scheduling_headcount_overrides ADD CONSTRAINT scheduling_headcount_overrides_course_offering_id_fkey FOREIGN KEY (course_offering_id) REFERENCES course_offerings(id) ON DELETE RESTRICT;
ALTER TABLE public.scheduling_headcount_overrides ADD CONSTRAINT scheduling_headcount_overrides_plan_course_component_id_fkey FOREIGN KEY (plan_course_component_id) REFERENCES plan_course_components(id) ON DELETE RESTRICT;
ALTER TABLE public.scheduling_headcount_overrides ADD CONSTRAINT scheduling_headcount_overrides_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.scheduling_headcount_revisions ADD CONSTRAINT scheduling_headcount_revisions_college_id_fkey FOREIGN KEY (college_id) REFERENCES colleges(id) ON DELETE RESTRICT;
ALTER TABLE public.scheduling_headcount_revisions ADD CONSTRAINT scheduling_headcount_revisions_headcount_id_fkey FOREIGN KEY (headcount_id) REFERENCES scheduling_cohort_term_headcounts(id) ON DELETE RESTRICT;
ALTER TABLE public.scheduling_headcount_revisions ADD CONSTRAINT scheduling_headcount_revisions_override_id_fkey FOREIGN KEY (override_id) REFERENCES scheduling_headcount_overrides(id) ON DELETE RESTRICT;
ALTER TABLE public.scheduling_headcount_revisions ADD CONSTRAINT scheduling_headcount_revisions_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES auth.users(id) ON DELETE RESTRICT;
CREATE OR REPLACE FUNCTION public.ensure_co_college()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE tc uuid; cc uuid; pc uuid; lc uuid;
BEGIN
  SELECT college_id INTO tc FROM public.academic_terms WHERE id = NEW.term_id;
  SELECT college_id INTO cc FROM public.courses WHERE id = NEW.course_id;
  IF tc IS NULL OR cc IS NULL OR tc <> NEW.college_id OR cc <> NEW.college_id THEN
    RAISE EXCEPTION 'term/course/college mismatch';
  END IF;
  IF NEW.program_id IS NOT NULL THEN
    SELECT college_id INTO pc FROM public.academic_programs WHERE id = NEW.program_id;
    IF pc IS NULL OR pc <> NEW.college_id THEN RAISE EXCEPTION 'program/college mismatch'; END IF;
  END IF;
  IF NEW.level_id IS NOT NULL THEN
    SELECT college_id INTO lc FROM public.academic_levels WHERE id = NEW.level_id;
    IF lc IS NULL OR lc <> NEW.college_id THEN RAISE EXCEPTION 'level/college mismatch'; END IF;
  END IF;
  RETURN NEW;
END $function$;
CREATE OR REPLACE FUNCTION public.invalidate_college_schedule_eligibility()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_old_college uuid := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') AND TG_TABLE_NAME <> 'quality_metrics' THEN OLD.college_id END;
  v_new_college uuid := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') AND TG_TABLE_NAME <> 'quality_metrics' THEN NEW.college_id END;
  v_version_id uuid;
BEGIN
  IF TG_TABLE_NAME <> 'quality_metrics'
     AND ((TG_OP IN ('UPDATE', 'DELETE') AND v_old_college IS NULL)
       OR (TG_OP IN ('INSERT', 'UPDATE') AND v_new_college IS NULL)) THEN
    RAISE EXCEPTION 'LIFECYCLE_INPUT_TENANT_REQUIRED' USING ERRCODE = '23514';
  END IF;

  FOR v_version_id IN
    SELECT sv.id
    FROM public.schedule_versions sv
    WHERE TG_TABLE_NAME = 'quality_metrics'
       OR sv.college_id IN (v_old_college, v_new_college)
    ORDER BY sv.id::text
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(v_version_id::text, 9174));
  END LOOP;

  UPDATE public.schedule_versions sv
  SET eligibility_revision = eligibility_revision + 1
  WHERE TG_TABLE_NAME = 'quality_metrics'
     OR sv.college_id IN (v_old_college, v_new_college);
  RETURN COALESCE(NEW, OLD);
END;
$function$;
CREATE OR REPLACE FUNCTION public.invalidate_schedule_version_eligibility()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_old_id uuid := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD.schedule_version_id END;
  v_new_id uuid := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN NEW.schedule_version_id END;
  v_id uuid;
  v_row_college uuid;
  v_version_college uuid;
BEGIN
  -- Lock in lexical UUID order so opposite reassignments cannot deadlock.
  FOR v_id IN
    SELECT ids.x
    FROM (SELECT DISTINCT x FROM unnest(ARRAY[v_old_id, v_new_id]) x WHERE x IS NOT NULL) ids
    ORDER BY ids.x::text
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(v_id::text, 9174));
  END LOOP;

  IF v_old_id IS NOT NULL THEN
    v_row_college := OLD.college_id;
    SELECT college_id INTO v_version_college FROM public.schedule_versions WHERE id = v_old_id;
    IF NOT FOUND OR v_version_college IS DISTINCT FROM v_row_college THEN
      RAISE EXCEPTION 'LIFECYCLE_DEPENDENCY_TENANT_MISMATCH' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF v_new_id IS NOT NULL THEN
    v_row_college := NEW.college_id;
    SELECT college_id INTO v_version_college FROM public.schedule_versions WHERE id = v_new_id;
    IF NOT FOUND OR v_version_college IS DISTINCT FROM v_row_college THEN
      RAISE EXCEPTION 'LIFECYCLE_DEPENDENCY_TENANT_MISMATCH' USING ERRCODE = '23514';
    END IF;
  END IF;

  UPDATE public.schedule_versions
  SET eligibility_revision = eligibility_revision + 1
  WHERE id IN (v_old_id, v_new_id);
  RETURN COALESCE(NEW, OLD);
END;
$function$;
CREATE OR REPLACE FUNCTION public.can_view_college(_user_id uuid, _college_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.is_super_admin(_user_id)
      OR public.user_in_college(_user_id, _college_id)
      OR public.is_institutional_viewer(_user_id);
$function$;
CREATE OR REPLACE FUNCTION public.ensure_co_plan_links()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE spc uuid; pcc uuid; pcsp uuid;
BEGIN
  IF NEW.study_plan_id IS NOT NULL THEN
    SELECT college_id INTO spc FROM public.study_plans WHERE id = NEW.study_plan_id;
    IF spc IS NULL OR spc <> NEW.college_id THEN
      RAISE EXCEPTION 'study_plan/college mismatch';
    END IF;
  END IF;
  IF NEW.plan_course_id IS NOT NULL THEN
    SELECT college_id, study_plan_id INTO pcc, pcsp FROM public.plan_courses WHERE id = NEW.plan_course_id;
    IF pcc IS NULL OR pcc <> NEW.college_id THEN
      RAISE EXCEPTION 'plan_course/college mismatch';
    END IF;
    IF NEW.study_plan_id IS NOT NULL AND pcsp <> NEW.study_plan_id THEN
      RAISE EXCEPTION 'plan_course does not belong to provided study_plan';
    END IF;
  END IF;
  RETURN NEW;
END $function$;
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
CREATE OR REPLACE FUNCTION public.prevent_ta_hard_delete_when_linked()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.schedule_sessions ss
    WHERE ss.teaching_assignment_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'ASSIGNMENT_HARD_DELETE_FORBIDDEN_LINKED_SESSION'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$function$;
CREATE OR REPLACE FUNCTION public.ensure_svce_session_version_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  vc uuid;
  sc_college uuid;
  sv_session uuid;
  rc_college uuid;
  sv_related uuid;
BEGIN
  SELECT college_id INTO vc FROM public.schedule_versions WHERE id = NEW.schedule_version_id;
  IF vc IS NULL THEN
    RAISE EXCEPTION 'schedule_version not found: %', NEW.schedule_version_id;
  END IF;
  IF vc <> NEW.college_id THEN
    RAISE EXCEPTION 'version/college mismatch';
  END IF;

  SELECT college_id, schedule_version_id INTO sc_college, sv_session
  FROM public.schedule_sessions WHERE id = NEW.session_id;
  IF sv_session IS NULL THEN
    RAISE EXCEPTION 'session not found: %', NEW.session_id;
  END IF;
  IF sc_college <> NEW.college_id THEN
    RAISE EXCEPTION 'session/college mismatch';
  END IF;
  IF sv_session <> NEW.schedule_version_id THEN
    RAISE EXCEPTION 'session/schedule_version mismatch: session % belongs to version %, expected %',
      NEW.session_id, sv_session, NEW.schedule_version_id;
  END IF;

  IF NEW.related_session_id IS NOT NULL THEN
    IF NEW.related_session_id = NEW.session_id THEN
      RAISE EXCEPTION 'related_session_id must differ from session_id for pair exceptions';
    END IF;

    SELECT college_id, schedule_version_id INTO rc_college, sv_related
    FROM public.schedule_sessions WHERE id = NEW.related_session_id;
    IF sv_related IS NULL THEN
      RAISE EXCEPTION 'related_session not found: %', NEW.related_session_id;
    END IF;
    IF rc_college <> NEW.college_id THEN
      RAISE EXCEPTION 'related_session/college mismatch';
    END IF;
    IF sv_related <> NEW.schedule_version_id THEN
      RAISE EXCEPTION 'related_session/schedule_version mismatch: session % belongs to version %, expected %',
        NEW.related_session_id, sv_related, NEW.schedule_version_id;
    END IF;
  END IF;

  RETURN NEW;
END $function$;
CREATE OR REPLACE FUNCTION public.prevent_locked_schedule_version_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF coalesce(current_setting('gomufadhala.operational_cleanup', true), '') = 'on'
     AND current_user IN ('postgres', 'service_role') THEN
    RETURN OLD;
  END IF;

  IF OLD.status IN ('published', 'archived') THEN
    RAISE EXCEPTION 'IMMUTABLE_SCHEDULE_VERSION:%', OLD.status USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$function$;
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
CREATE OR REPLACE FUNCTION public.enforce_schedule_version_immutability()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.status IN ('published', 'archived') AND
     (NEW.id, NEW.college_id, NEW.academic_term_id, NEW.name, NEW.notes,
      NEW.created_by, NEW.created_at) IS DISTINCT FROM
     (OLD.id, OLD.college_id, OLD.academic_term_id, OLD.name, OLD.notes,
      OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'IMMUTABLE_SCHEDULE_VERSION:%', OLD.status USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.ensure_instructor_links_college()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE tc uuid;
BEGIN
  IF NEW.instructor_type_id IS NOT NULL THEN
    SELECT college_id INTO tc FROM public.instructor_types WHERE id = NEW.instructor_type_id;
    IF tc IS NULL OR tc <> NEW.college_id THEN RAISE EXCEPTION 'instructor_type/college mismatch'; END IF;
  END IF;
  RETURN NEW;
END $function$;
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
CREATE OR REPLACE FUNCTION public.ensure_instructor_college()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE dc uuid;
BEGIN
  IF NEW.department_id IS NOT NULL THEN
    SELECT college_id INTO dc FROM public.departments WHERE id = NEW.department_id;
    IF dc IS NULL OR dc <> NEW.college_id THEN RAISE EXCEPTION 'department/college mismatch'; END IF;
  END IF;
  RETURN NEW;
END $function$;
CREATE OR REPLACE FUNCTION public.ensure_ia_college()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE ic uuid;
BEGIN
  SELECT college_id INTO ic FROM public.instructors WHERE id = NEW.instructor_id;
  IF ic IS NULL OR ic <> NEW.college_id THEN RAISE EXCEPTION 'instructor/college mismatch'; END IF;
  RETURN NEW;
END $function$;
CREATE OR REPLACE FUNCTION public.enforce_disposable_test_super_admin_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.disposable_test IS TRUE AND NOT public.is_super_admin(auth.uid()) THEN
      RAISE EXCEPTION 'DISPOSABLE_TEST_SUPER_ADMIN_REQUIRED' USING ERRCODE = '42501';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.disposable_test IS DISTINCT FROM OLD.disposable_test
       AND NOT public.is_super_admin(auth.uid()) THEN
      RAISE EXCEPTION 'DISPOSABLE_TEST_SUPER_ADMIN_REQUIRED' USING ERRCODE = '42501';
    END IF;
  END IF;
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
DECLARE v jsonb:='[]'::jsonb; req text; rtype text;
BEGIN
  IF p_rid IS NULL OR p_ta IS NULL THEN RETURN v; END IF;
  SELECT required_room_type INTO req FROM public.teaching_assignments
  WHERE id=p_ta AND college_id=p_cid;
  SELECT room_type INTO rtype FROM public.rooms WHERE id=p_rid;
  IF req IS NOT NULL AND rtype IS DISTINCT FROM req THEN
    v:=v||jsonb_build_array(public._ss_ci('room_type_mismatch','hard',p_sid,NULL,
      jsonb_build_object('required_room_type',req,'room_type',rtype,'room_id',p_rid,'teaching_assignment_id',p_ta)));
  END IF;
  RETURN v;
END;$function$;
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
      SELECT pcc.component_type INTO pcc_type
      FROM public.plan_course_components pcc WHERE pcc.id = dg_component;
      IF pcc_type = 'summer_training' THEN
        RAISE EXCEPTION 'SUMMER_TRAINING_SESSION_FORBIDDEN' USING ERRCODE = 'check_violation';
      END IF;
      IF pcc_type = 'project' THEN
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
      SELECT pcc.component_type INTO pcc_type
      FROM public.plan_course_components pcc WHERE pcc.id = dg_component;
      IF pcc_type = 'summer_training' THEN
        RAISE EXCEPTION 'SUMMER_TRAINING_SESSION_FORBIDDEN' USING ERRCODE = 'check_violation';
      END IF;
      IF pcc_type = 'project' THEN
        RAISE EXCEPTION 'PROJECT_STANDARD_WEEKLY_SESSION_FORBIDDEN' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
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
CREATE OR REPLACE FUNCTION public.enforce_schedule_session_lock_row()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF coalesce(current_setting('gomufadhala.operational_cleanup', true), '') = 'on'
       AND current_user IN ('postgres', 'service_role') THEN
      RETURN OLD;
    END IF;
    IF OLD.is_locked THEN
      RAISE EXCEPTION 'session % is locked and cannot be deleted', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.is_locked = true AND NEW.is_locked = true THEN
    -- Only allow editing lock_reason or unlocking; block schedule-affecting changes
    IF (NEW.day_of_week IS DISTINCT FROM OLD.day_of_week
        OR NEW.start_time IS DISTINCT FROM OLD.start_time
        OR NEW.end_time IS DISTINCT FROM OLD.end_time
        OR NEW.room_id IS DISTINCT FROM OLD.room_id
        OR NEW.instructor_id IS DISTINCT FROM OLD.instructor_id) THEN
      RAISE EXCEPTION 'session % is locked; unlock before changing time/room/instructor', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $function$;
CREATE OR REPLACE FUNCTION public.user_in_college(_user_id uuid, _college_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.user_colleges WHERE user_id = _user_id AND college_id = _college_id);
$function$;
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
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
CREATE OR REPLACE FUNCTION public.can_manage_college(_user_id uuid, _college_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.is_super_admin(_user_id)
      OR (public.has_role(_user_id, 'college_admin') AND public.user_in_college(_user_id, _college_id));
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
CREATE OR REPLACE FUNCTION public.ensure_ra_college()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE rc uuid;
BEGIN
  SELECT college_id INTO rc FROM public.rooms WHERE id = NEW.room_id;
  IF rc IS NULL OR rc <> NEW.college_id THEN
    RAISE EXCEPTION 'room/college mismatch';
  END IF;
  RETURN NEW;
END $function$;
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
CREATE OR REPLACE FUNCTION public._ss_iavail_win(p_sid uuid, p_cid uuid, p_iid uuid, p_dow integer, p_st time without time zone, p_et time without time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb:='[]'::jsonb; cnt int; fits boolean; blocked boolean;
BEGIN
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
CREATE OR REPLACE FUNCTION public.ensure_sv_college()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE tc uuid;
BEGIN
  SELECT college_id INTO tc FROM public.academic_terms WHERE id = NEW.academic_term_id;
  IF tc IS NULL OR tc <> NEW.college_id THEN RAISE EXCEPTION 'term/college mismatch'; END IF;
  RETURN NEW;
END $function$;
CREATE OR REPLACE FUNCTION public.enforce_schedule_session_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE st text; vid uuid;
BEGIN
  IF TG_OP = 'DELETE'
     AND coalesce(current_setting('gomufadhala.operational_cleanup', true), '') = 'on'
     AND current_user IN ('postgres', 'service_role') THEN
    RETURN OLD;
  END IF;

  vid := COALESCE(NEW.schedule_version_id, OLD.schedule_version_id);
  SELECT status INTO st FROM public.schedule_versions WHERE id = vid;
  IF st IN ('published','archived') THEN
    RAISE EXCEPTION 'schedule_sessions are locked: version status is %', st
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $function$;
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
CREATE OR REPLACE FUNCTION public.enforce_sv_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    -- Allowed transitions
    IF NOT (
      (OLD.status = 'draft'     AND NEW.status = 'review')   OR
      (OLD.status = 'review'    AND NEW.status = 'approved') OR
      (OLD.status = 'approved'  AND NEW.status = 'published')OR
      (OLD.status = 'published' AND NEW.status = 'archived') OR
      -- optional rollbacks
      (OLD.status = 'review'    AND NEW.status = 'draft')    OR
      (OLD.status = 'approved'  AND NEW.status = 'review')
    ) THEN
      RAISE EXCEPTION 'invalid status transition: % -> %', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $function$;
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
  IF v_pcc.component_type = 'project' THEN
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
CREATE OR REPLACE FUNCTION public.enforce_room_delete_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_session_refs integer;
  v_deleted_at timestamptz := now();
  v_deleted_by uuid := auth.uid();
BEGIN
  SELECT COUNT(*)::integer INTO v_session_refs
  FROM public.schedule_sessions
  WHERE room_id = OLD.id;

  IF v_session_refs > 0 THEN
    RAISE EXCEPTION
      'ROOM_IN_USE: لا يمكن حذف القاعة لأنها مستخدمة في جلسات دراسية.'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  DELETE FROM public.room_availability WHERE room_id = OLD.id;
  DELETE FROM public.room_unavailability WHERE room_id = OLD.id;

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (
    v_deleted_by,
    'room_delete_snapshot',
    'rooms',
    OLD.id,
    OLD.college_id,
    jsonb_build_object(
      'id', OLD.id,
      'college_id', OLD.college_id,
      'code', OLD.code,
      'name', OLD.name,
      'room_type', OLD.room_type,
      'capacity', OLD.capacity,
      'is_active', OLD.is_active,
      'deleted_by', v_deleted_by,
      'deleted_at', v_deleted_at,
      'snapshot', to_jsonb(OLD),
      'session_refs', 0,
      'note', 'Unused room deleted; required snapshot fields retained in audit_logs.details (never NULL)'
    )
  );

  RETURN OLD;
END;
$function$;
CREATE OR REPLACE FUNCTION public.ensure_room_links_college()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE bc uuid; rtc uuid;
BEGIN
  IF NEW.building_id IS NOT NULL THEN
    SELECT college_id INTO bc FROM public.academic_buildings WHERE id = NEW.building_id;
    IF bc IS NULL OR bc <> NEW.college_id THEN RAISE EXCEPTION 'building/college mismatch'; END IF;
  END IF;
  IF NEW.room_type_id IS NOT NULL THEN
    SELECT college_id INTO rtc FROM public.room_types WHERE id = NEW.room_type_id;
    IF rtc IS NULL OR rtc <> NEW.college_id THEN RAISE EXCEPTION 'room_type/college mismatch'; END IF;
  END IF;
  RETURN NEW;
END $function$;
CREATE OR REPLACE FUNCTION public._ss_iavail_req(p_sid uuid, p_cid uuid, p_iid uuid, p_dow integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb:='[]'::jsonb; code text; ext boolean; req boolean; cnt int;
BEGIN
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
CREATE OR REPLACE FUNCTION public.is_institutional_viewer(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = 'institutional_viewer'::public.app_role
  );
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
SET check_function_bodies = on;
