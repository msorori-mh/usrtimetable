export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      academic_buildings: {
        Row: {
          address: string | null
          code: string
          college_id: string
          created_at: string
          floors_count: number | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          code: string
          college_id: string
          created_at?: string
          floors_count?: number | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          code?: string
          college_id?: string
          created_at?: string
          floors_count?: number | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      academic_calendar: {
        Row: {
          affects_scheduling: boolean
          all_day: boolean
          college_id: string
          color: string | null
          created_at: string
          end_date: string | null
          end_time: string | null
          event_kind: string
          id: string
          notes: string | null
          start_date: string
          start_time: string | null
          term_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          affects_scheduling?: boolean
          all_day?: boolean
          college_id: string
          color?: string | null
          created_at?: string
          end_date?: string | null
          end_time?: string | null
          event_kind?: string
          id?: string
          notes?: string | null
          start_date: string
          start_time?: string | null
          term_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          affects_scheduling?: boolean
          all_day?: boolean
          college_id?: string
          color?: string | null
          created_at?: string
          end_date?: string | null
          end_time?: string | null
          event_kind?: string
          id?: string
          notes?: string | null
          start_date?: string
          start_time?: string | null
          term_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      academic_cohorts: {
        Row: {
          active: boolean
          code: string | null
          college_id: string
          count_status: string
          created_at: string
          entry_year: number | null
          existing_schedule: boolean
          expected_students: number | null
          id: string
          level_id: string
          program_id: string
          study_plan_id: string | null
          study_system: string
          term_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          code?: string | null
          college_id: string
          count_status?: string
          created_at?: string
          entry_year?: number | null
          existing_schedule?: boolean
          expected_students?: number | null
          id?: string
          level_id: string
          program_id: string
          study_plan_id?: string | null
          study_system: string
          term_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string | null
          college_id?: string
          count_status?: string
          created_at?: string
          entry_year?: number | null
          existing_schedule?: boolean
          expected_students?: number | null
          id?: string
          level_id?: string
          program_id?: string
          study_plan_id?: string | null
          study_system?: string
          term_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ac_level_college_fkey"
            columns: ["level_id", "college_id"]
            isOneToOne: false
            referencedRelation: "academic_levels"
            referencedColumns: ["id", "college_id"]
          },
          {
            foreignKeyName: "ac_program_college_fkey"
            columns: ["program_id", "college_id"]
            isOneToOne: false
            referencedRelation: "academic_programs"
            referencedColumns: ["id", "college_id"]
          },
          {
            foreignKeyName: "ac_study_plan_scope_fkey"
            columns: ["study_plan_id", "college_id", "program_id"]
            isOneToOne: false
            referencedRelation: "study_plans"
            referencedColumns: ["id", "college_id", "program_id"]
          },
          {
            foreignKeyName: "ac_term_college_fkey"
            columns: ["term_id", "college_id"]
            isOneToOne: false
            referencedRelation: "academic_terms"
            referencedColumns: ["id", "college_id"]
          },
          {
            foreignKeyName: "academic_cohorts_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academic_cohorts_level_id_fkey"
            columns: ["level_id"]
            isOneToOne: false
            referencedRelation: "academic_levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academic_cohorts_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "academic_programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academic_cohorts_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "academic_terms"
            referencedColumns: ["id"]
          },
        ]
      }
      academic_levels: {
        Row: {
          college_id: string
          created_at: string
          id: string
          level_number: number
          name: string
          program_id: string
          updated_at: string
        }
        Insert: {
          college_id: string
          created_at?: string
          id?: string
          level_number: number
          name: string
          program_id: string
          updated_at?: string
        }
        Update: {
          college_id?: string
          created_at?: string
          id?: string
          level_number?: number
          name?: string
          program_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "academic_levels_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academic_levels_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "academic_programs"
            referencedColumns: ["id"]
          },
        ]
      }
      academic_programs: {
        Row: {
          archive_reason: string | null
          archived_at: string | null
          canonical_program_id: string | null
          code: string
          college_id: string
          created_at: string
          degree_type: string
          department_id: string
          duration_years: number
          id: string
          is_archived: boolean
          name: string
          updated_at: string
        }
        Insert: {
          archive_reason?: string | null
          archived_at?: string | null
          canonical_program_id?: string | null
          code: string
          college_id: string
          created_at?: string
          degree_type?: string
          department_id: string
          duration_years?: number
          id?: string
          is_archived?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          archive_reason?: string | null
          archived_at?: string | null
          canonical_program_id?: string | null
          code?: string
          college_id?: string
          created_at?: string
          degree_type?: string
          department_id?: string
          duration_years?: number
          id?: string
          is_archived?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "academic_programs_canonical_program_fkey"
            columns: ["canonical_program_id"]
            isOneToOne: false
            referencedRelation: "academic_programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academic_programs_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academic_programs_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      academic_terms: {
        Row: {
          academic_year: string | null
          code: string
          college_id: string
          created_at: string
          end_date: string | null
          id: string
          is_active: boolean
          name: string
          start_date: string | null
          teaching_weeks_count: number | null
          term_type: string | null
          updated_at: string
        }
        Insert: {
          academic_year?: string | null
          code: string
          college_id: string
          created_at?: string
          end_date?: string | null
          id?: string
          is_active?: boolean
          name: string
          start_date?: string | null
          teaching_weeks_count?: number | null
          term_type?: string | null
          updated_at?: string
        }
        Update: {
          academic_year?: string | null
          code?: string
          college_id?: string
          created_at?: string
          end_date?: string | null
          id?: string
          is_active?: boolean
          name?: string
          start_date?: string | null
          teaching_weeks_count?: number | null
          term_type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "academic_terms_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          college_id: string | null
          created_at: string
          details: Json | null
          entity: string
          entity_id: string | null
          id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          college_id?: string | null
          created_at?: string
          details?: Json | null
          entity: string
          entity_id?: string | null
          id?: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          college_id?: string | null
          created_at?: string
          details?: Json | null
          entity?: string
          entity_id?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
        ]
      }
      auto_schedule_runs: {
        Row: {
          algorithm: string
          college_id: string
          created_at: string
          duration_ms: number | null
          hard_conflicts_after: number
          id: string
          placed_sessions: number
          quality_score_after: number | null
          run_by: string | null
          schedule_version_id: string
          soft_violations_after: number
          status: string
          summary: Json | null
          total_offerings: number
          unplaced: Json | null
          unplaced_sessions: number
        }
        Insert: {
          algorithm?: string
          college_id: string
          created_at?: string
          duration_ms?: number | null
          hard_conflicts_after?: number
          id?: string
          placed_sessions?: number
          quality_score_after?: number | null
          run_by?: string | null
          schedule_version_id: string
          soft_violations_after?: number
          status?: string
          summary?: Json | null
          total_offerings?: number
          unplaced?: Json | null
          unplaced_sessions?: number
        }
        Update: {
          algorithm?: string
          college_id?: string
          created_at?: string
          duration_ms?: number | null
          hard_conflicts_after?: number
          id?: string
          placed_sessions?: number
          quality_score_after?: number | null
          run_by?: string | null
          schedule_version_id?: string
          soft_violations_after?: number
          status?: string
          summary?: Json | null
          total_offerings?: number
          unplaced?: Json | null
          unplaced_sessions?: number
        }
        Relationships: [
          {
            foreignKeyName: "auto_schedule_runs_schedule_version_id_fkey"
            columns: ["schedule_version_id"]
            isOneToOne: false
            referencedRelation: "schedule_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      cohort_elective_selections: {
        Row: {
          cohort_id: string
          college_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          elective_slot_id: string
          id: string
          notes: string | null
          selected_course_id: string
          updated_at: string
        }
        Insert: {
          cohort_id: string
          college_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          elective_slot_id: string
          id?: string
          notes?: string | null
          selected_course_id: string
          updated_at?: string
        }
        Update: {
          cohort_id?: string
          college_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          elective_slot_id?: string
          id?: string
          notes?: string | null
          selected_course_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ces_cohort_college_fkey"
            columns: ["cohort_id", "college_id"]
            isOneToOne: false
            referencedRelation: "academic_cohorts"
            referencedColumns: ["id", "college_id"]
          },
          {
            foreignKeyName: "ces_course_college_fkey"
            columns: ["selected_course_id", "college_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id", "college_id"]
          },
          {
            foreignKeyName: "ces_slot_college_fkey"
            columns: ["elective_slot_id", "college_id"]
            isOneToOne: false
            referencedRelation: "elective_slots"
            referencedColumns: ["id", "college_id"]
          },
          {
            foreignKeyName: "cohort_elective_selections_cohort_id_fkey"
            columns: ["cohort_id"]
            isOneToOne: false
            referencedRelation: "academic_cohorts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cohort_elective_selections_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cohort_elective_selections_elective_slot_id_fkey"
            columns: ["elective_slot_id"]
            isOneToOne: false
            referencedRelation: "elective_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cohort_elective_selections_selected_course_id_fkey"
            columns: ["selected_course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      cohort_student_partitions: {
        Row: {
          active: boolean
          cohort_id: string
          college_id: string
          created_at: string
          headcount: number
          id: string
          partition_code: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          cohort_id: string
          college_id: string
          created_at?: string
          headcount: number
          id?: string
          partition_code: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          cohort_id?: string
          college_id?: string
          created_at?: string
          headcount?: number
          id?: string
          partition_code?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cohort_student_partitions_cohort_id_fkey"
            columns: ["cohort_id"]
            isOneToOne: false
            referencedRelation: "academic_cohorts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cohort_student_partitions_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
        ]
      }
      college_constraint_settings: {
        Row: {
          college_id: string
          constraint_type_id: string
          created_at: string
          enabled: boolean
          id: string
          notes: string | null
          updated_at: string
          weight: number
        }
        Insert: {
          college_id: string
          constraint_type_id: string
          created_at?: string
          enabled?: boolean
          id?: string
          notes?: string | null
          updated_at?: string
          weight?: number
        }
        Update: {
          college_id?: string
          constraint_type_id?: string
          created_at?: string
          enabled?: boolean
          id?: string
          notes?: string | null
          updated_at?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "college_constraint_settings_constraint_type_id_fkey"
            columns: ["constraint_type_id"]
            isOneToOne: false
            referencedRelation: "constraint_types"
            referencedColumns: ["id"]
          },
        ]
      }
      college_quality_settings: {
        Row: {
          college_id: string
          created_at: string
          enabled: boolean
          id: string
          notes: string | null
          quality_metric_id: string
          updated_at: string
          weight: number
        }
        Insert: {
          college_id: string
          created_at?: string
          enabled?: boolean
          id?: string
          notes?: string | null
          quality_metric_id: string
          updated_at?: string
          weight?: number
        }
        Update: {
          college_id?: string
          created_at?: string
          enabled?: boolean
          id?: string
          notes?: string | null
          quality_metric_id?: string
          updated_at?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "college_quality_settings_quality_metric_id_fkey"
            columns: ["quality_metric_id"]
            isOneToOne: false
            referencedRelation: "quality_metrics"
            referencedColumns: ["id"]
          },
        ]
      }
      colleges: {
        Row: {
          code: string | null
          created_at: string
          id: string
          name: string
          university_id: string
          updated_at: string
        }
        Insert: {
          code?: string | null
          created_at?: string
          id?: string
          name: string
          university_id: string
          updated_at?: string
        }
        Update: {
          code?: string | null
          created_at?: string
          id?: string
          name?: string
          university_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "colleges_university_id_fkey"
            columns: ["university_id"]
            isOneToOne: false
            referencedRelation: "universities"
            referencedColumns: ["id"]
          },
        ]
      }
      conflict_checks: {
        Row: {
          check_type: string
          checked_by: string | null
          college_id: string
          completed_at: string | null
          created_at: string
          id: string
          schedule_version_id: string
          status: string
          total_conflicts: number
        }
        Insert: {
          check_type?: string
          checked_by?: string | null
          college_id: string
          completed_at?: string | null
          created_at?: string
          id?: string
          schedule_version_id: string
          status?: string
          total_conflicts?: number
        }
        Update: {
          check_type?: string
          checked_by?: string | null
          college_id?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          schedule_version_id?: string
          status?: string
          total_conflicts?: number
        }
        Relationships: [
          {
            foreignKeyName: "conflict_checks_schedule_version_id_fkey"
            columns: ["schedule_version_id"]
            isOneToOne: false
            referencedRelation: "schedule_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      conflict_results: {
        Row: {
          college_id: string
          conflict_check_id: string
          conflict_code: string
          conflict_type_id: string | null
          created_at: string
          id: string
          message_ar: string
          message_en: string
          metadata: Json | null
          related_session_id: string | null
          schedule_session_id: string | null
          score_impact: number
          severity: string
        }
        Insert: {
          college_id: string
          conflict_check_id: string
          conflict_code: string
          conflict_type_id?: string | null
          created_at?: string
          id?: string
          message_ar: string
          message_en: string
          metadata?: Json | null
          related_session_id?: string | null
          schedule_session_id?: string | null
          score_impact?: number
          severity?: string
        }
        Update: {
          college_id?: string
          conflict_check_id?: string
          conflict_code?: string
          conflict_type_id?: string | null
          created_at?: string
          id?: string
          message_ar?: string
          message_en?: string
          metadata?: Json | null
          related_session_id?: string | null
          schedule_session_id?: string | null
          score_impact?: number
          severity?: string
        }
        Relationships: [
          {
            foreignKeyName: "conflict_results_conflict_check_id_fkey"
            columns: ["conflict_check_id"]
            isOneToOne: false
            referencedRelation: "conflict_checks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conflict_results_conflict_type_id_fkey"
            columns: ["conflict_type_id"]
            isOneToOne: false
            referencedRelation: "constraint_types"
            referencedColumns: ["id"]
          },
        ]
      }
      constraint_types: {
        Row: {
          code: string
          constraint_category: string
          created_at: string
          default_weight: number
          description: string | null
          id: string
          is_active: boolean
          is_hard: boolean
          name_ar: string
          name_en: string | null
          updated_at: string
        }
        Insert: {
          code: string
          constraint_category: string
          created_at?: string
          default_weight?: number
          description?: string | null
          id?: string
          is_active?: boolean
          is_hard?: boolean
          name_ar: string
          name_en?: string | null
          updated_at?: string
        }
        Update: {
          code?: string
          constraint_category?: string
          created_at?: string
          default_weight?: number
          description?: string | null
          id?: string
          is_active?: boolean
          is_hard?: boolean
          name_ar?: string
          name_en?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      course_departments: {
        Row: {
          college_id: string
          course_id: string
          created_at: string
          department_id: string
          id: string
        }
        Insert: {
          college_id: string
          course_id: string
          created_at?: string
          department_id: string
          id?: string
        }
        Update: {
          college_id?: string
          course_id?: string
          created_at?: string
          department_id?: string
          id?: string
        }
        Relationships: []
      }
      course_offering_sections: {
        Row: {
          college_id: string
          course_offering_id: string
          created_at: string
          expected_students: number
          id: string
          section_id: string
          section_number: string | null
          updated_at: string
        }
        Insert: {
          college_id: string
          course_offering_id: string
          created_at?: string
          expected_students?: number
          id?: string
          section_id: string
          section_number?: string | null
          updated_at?: string
        }
        Update: {
          college_id?: string
          course_offering_id?: string
          created_at?: string
          expected_students?: number
          id?: string
          section_id?: string
          section_number?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_offering_sections_course_offering_id_fkey"
            columns: ["course_offering_id"]
            isOneToOne: false
            referencedRelation: "course_offerings"
            referencedColumns: ["id"]
          },
        ]
      }
      course_offerings: {
        Row: {
          college_id: string
          course_id: string
          created_at: string
          enrollment_count_status: string
          enrollment_count_updated_at: string | null
          existing_schedule: boolean
          expected_students: number | null
          id: string
          is_active: boolean
          level_id: string | null
          notes: string | null
          plan_course_id: string | null
          program_id: string | null
          sections_count: number
          status: string
          study_plan_id: string | null
          study_system: string
          term_id: string
          updated_at: string
        }
        Insert: {
          college_id: string
          course_id: string
          created_at?: string
          enrollment_count_status?: string
          enrollment_count_updated_at?: string | null
          existing_schedule?: boolean
          expected_students?: number | null
          id?: string
          is_active?: boolean
          level_id?: string | null
          notes?: string | null
          plan_course_id?: string | null
          program_id?: string | null
          sections_count?: number
          status?: string
          study_plan_id?: string | null
          study_system?: string
          term_id: string
          updated_at?: string
        }
        Update: {
          college_id?: string
          course_id?: string
          created_at?: string
          enrollment_count_status?: string
          enrollment_count_updated_at?: string | null
          existing_schedule?: boolean
          expected_students?: number | null
          id?: string
          is_active?: boolean
          level_id?: string | null
          notes?: string | null
          plan_course_id?: string | null
          program_id?: string | null
          sections_count?: number
          status?: string
          study_plan_id?: string | null
          study_system?: string
          term_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_offerings_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "academic_terms"
            referencedColumns: ["id"]
          },
        ]
      }
      course_programs: {
        Row: {
          college_id: string
          course_id: string
          created_at: string
          id: string
          program_id: string
          updated_at: string
        }
        Insert: {
          college_id: string
          course_id: string
          created_at?: string
          id?: string
          program_id: string
          updated_at?: string
        }
        Update: {
          college_id?: string
          course_id?: string
          created_at?: string
          id?: string
          program_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      courses: {
        Row: {
          code: string
          college_id: string
          course_nature: string
          created_at: string
          credit_hours: number | null
          department_id: string
          id: string
          is_shared: boolean
          name: string
          practical_hours: number
          theory_hours: number
          updated_at: string
        }
        Insert: {
          code: string
          college_id: string
          course_nature?: string
          created_at?: string
          credit_hours?: number | null
          department_id: string
          id?: string
          is_shared?: boolean
          name: string
          practical_hours?: number
          theory_hours?: number
          updated_at?: string
        }
        Update: {
          code?: string
          college_id?: string
          course_nature?: string
          created_at?: string
          credit_hours?: number | null
          department_id?: string
          id?: string
          is_shared?: boolean
          name?: string
          practical_hours?: number
          theory_hours?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "courses_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courses_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_breaks: {
        Row: {
          affects_scheduling: boolean
          college_id: string
          created_at: string
          days: number[]
          end_time: string
          id: string
          name: string
          start_time: string
          updated_at: string
        }
        Insert: {
          affects_scheduling?: boolean
          college_id: string
          created_at?: string
          days?: number[]
          end_time: string
          id?: string
          name: string
          start_time: string
          updated_at?: string
        }
        Update: {
          affects_scheduling?: boolean
          college_id?: string
          created_at?: string
          days?: number[]
          end_time?: string
          id?: string
          name?: string
          start_time?: string
          updated_at?: string
        }
        Relationships: []
      }
      delivery_group_partition_members: {
        Row: {
          cohort_id: string
          college_id: string
          created_at: string
          delivery_group_id: string
          id: string
          partition_id: string
          updated_at: string
        }
        Insert: {
          cohort_id: string
          college_id: string
          created_at?: string
          delivery_group_id: string
          id?: string
          partition_id: string
          updated_at?: string
        }
        Update: {
          cohort_id?: string
          college_id?: string
          created_at?: string
          delivery_group_id?: string
          id?: string
          partition_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_group_partition_members_cohort_id_fkey"
            columns: ["cohort_id"]
            isOneToOne: false
            referencedRelation: "academic_cohorts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_group_partition_members_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_group_partition_members_delivery_group_id_fkey"
            columns: ["delivery_group_id"]
            isOneToOne: false
            referencedRelation: "delivery_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_group_partition_members_delivery_group_id_fkey"
            columns: ["delivery_group_id"]
            isOneToOne: false
            referencedRelation: "operational_delivery_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_group_partition_members_partition_id_fkey"
            columns: ["partition_id"]
            isOneToOne: false
            referencedRelation: "cohort_student_partitions"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_groups: {
        Row: {
          active: boolean
          capacity_limit: number | null
          cohort_id: string
          college_id: string
          component_id: string
          created_at: string
          excluded_from_standard_workload: boolean
          expected_students: number | null
          group_code: string
          group_number: number | null
          id: string
          is_obsolete: boolean
          plan_course_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          capacity_limit?: number | null
          cohort_id: string
          college_id: string
          component_id: string
          created_at?: string
          excluded_from_standard_workload?: boolean
          expected_students?: number | null
          group_code: string
          group_number?: number | null
          id?: string
          is_obsolete?: boolean
          plan_course_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          capacity_limit?: number | null
          cohort_id?: string
          college_id?: string
          component_id?: string
          created_at?: string
          excluded_from_standard_workload?: boolean
          expected_students?: number | null
          group_code?: string
          group_number?: number | null
          id?: string
          is_obsolete?: boolean
          plan_course_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_groups_cohort_id_fkey"
            columns: ["cohort_id"]
            isOneToOne: false
            referencedRelation: "academic_cohorts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_groups_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_groups_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "plan_course_components"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_groups_plan_course_id_fkey"
            columns: ["plan_course_id"]
            isOneToOne: false
            referencedRelation: "plan_courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dg_cohort_college_fkey"
            columns: ["cohort_id", "college_id"]
            isOneToOne: false
            referencedRelation: "academic_cohorts"
            referencedColumns: ["id", "college_id"]
          },
          {
            foreignKeyName: "dg_component_college_fkey"
            columns: ["component_id", "college_id"]
            isOneToOne: false
            referencedRelation: "plan_course_components"
            referencedColumns: ["id", "college_id"]
          },
          {
            foreignKeyName: "dg_plan_course_college_fkey"
            columns: ["plan_course_id", "college_id"]
            isOneToOne: false
            referencedRelation: "plan_courses"
            referencedColumns: ["id", "college_id"]
          },
        ]
      }
      departments: {
        Row: {
          archive_reason: string | null
          archived_at: string | null
          canonical_department_id: string | null
          code: string
          college_id: string
          created_at: string
          id: string
          is_archived: boolean
          name: string
          study_system: string
          updated_at: string
        }
        Insert: {
          archive_reason?: string | null
          archived_at?: string | null
          canonical_department_id?: string | null
          code: string
          college_id: string
          created_at?: string
          id?: string
          is_archived?: boolean
          name: string
          study_system?: string
          updated_at?: string
        }
        Update: {
          archive_reason?: string | null
          archived_at?: string | null
          canonical_department_id?: string | null
          code?: string
          college_id?: string
          created_at?: string
          id?: string
          is_archived?: boolean
          name?: string
          study_system?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "departments_canonical_department_fkey"
            columns: ["canonical_department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "departments_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
        ]
      }
      elective_slot_courses: {
        Row: {
          active: boolean
          college_id: string
          course_id: string
          created_at: string
          elective_slot_id: string
          id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          college_id: string
          course_id: string
          created_at?: string
          elective_slot_id: string
          id?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          college_id?: string
          course_id?: string
          created_at?: string
          elective_slot_id?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "elective_slot_courses_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "elective_slot_courses_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "elective_slot_courses_elective_slot_id_fkey"
            columns: ["elective_slot_id"]
            isOneToOne: false
            referencedRelation: "elective_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esc_course_college_fkey"
            columns: ["course_id", "college_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id", "college_id"]
          },
          {
            foreignKeyName: "esc_slot_college_fkey"
            columns: ["elective_slot_id", "college_id"]
            isOneToOne: false
            referencedRelation: "elective_slots"
            referencedColumns: ["id", "college_id"]
          },
        ]
      }
      elective_slots: {
        Row: {
          active: boolean
          college_id: string
          created_at: string
          id: string
          label: string | null
          level_id: string | null
          required_component_type: string
          semester: number
          slot_code: string
          study_plan_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          college_id: string
          created_at?: string
          id?: string
          label?: string | null
          level_id?: string | null
          required_component_type?: string
          semester: number
          slot_code: string
          study_plan_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          college_id?: string
          created_at?: string
          id?: string
          label?: string | null
          level_id?: string | null
          required_component_type?: string
          semester?: number
          slot_code?: string
          study_plan_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "elective_slots_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "elective_slots_level_id_fkey"
            columns: ["level_id"]
            isOneToOne: false
            referencedRelation: "academic_levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "elective_slots_study_plan_id_fkey"
            columns: ["study_plan_id"]
            isOneToOne: false
            referencedRelation: "study_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "es_level_college_fkey"
            columns: ["level_id", "college_id"]
            isOneToOne: false
            referencedRelation: "academic_levels"
            referencedColumns: ["id", "college_id"]
          },
          {
            foreignKeyName: "es_study_plan_college_fkey"
            columns: ["study_plan_id", "college_id"]
            isOneToOne: false
            referencedRelation: "study_plans"
            referencedColumns: ["id", "college_id"]
          },
        ]
      }
      existing_schedule_intake: {
        Row: {
          college_id: string
          created_at: string
          created_by: string | null
          enabled: boolean
          id: string
          notes: string | null
          term_id: string
          updated_at: string
        }
        Insert: {
          college_id: string
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          notes?: string | null
          term_id: string
          updated_at?: string
        }
        Update: {
          college_id?: string
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          notes?: string | null
          term_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "existing_schedule_intake_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "existing_schedule_intake_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "academic_terms"
            referencedColumns: ["id"]
          },
        ]
      }
      existing_schedule_source_rows: {
        Row: {
          cohort_id: string | null
          college_id: string
          component_id: string | null
          created_at: string
          day_of_week: number | null
          delivery_group_id: string | null
          end_time: string | null
          id: string
          instructor_ids: string[]
          level_number: number | null
          notes: string | null
          pending_reasons: string[]
          plan_course_id: string | null
          raw_course: string | null
          raw_day: string | null
          raw_room: string | null
          raw_teacher: string | null
          raw_time: string | null
          room_id: string | null
          schedule_session_id: string | null
          schedule_version_id: string | null
          shared_key: string | null
          shared_member: boolean
          source_cell: string
          source_file: string
          source_id: string
          start_time: string | null
          status: string
          study_plan_id: string | null
          teaching_assignment_id: string | null
          term_id: string
          updated_at: string
        }
        Insert: {
          cohort_id?: string | null
          college_id: string
          component_id?: string | null
          created_at?: string
          day_of_week?: number | null
          delivery_group_id?: string | null
          end_time?: string | null
          id?: string
          instructor_ids?: string[]
          level_number?: number | null
          notes?: string | null
          pending_reasons?: string[]
          plan_course_id?: string | null
          raw_course?: string | null
          raw_day?: string | null
          raw_room?: string | null
          raw_teacher?: string | null
          raw_time?: string | null
          room_id?: string | null
          schedule_session_id?: string | null
          schedule_version_id?: string | null
          shared_key?: string | null
          shared_member?: boolean
          source_cell: string
          source_file: string
          source_id: string
          start_time?: string | null
          status?: string
          study_plan_id?: string | null
          teaching_assignment_id?: string | null
          term_id: string
          updated_at?: string
        }
        Update: {
          cohort_id?: string | null
          college_id?: string
          component_id?: string | null
          created_at?: string
          day_of_week?: number | null
          delivery_group_id?: string | null
          end_time?: string | null
          id?: string
          instructor_ids?: string[]
          level_number?: number | null
          notes?: string | null
          pending_reasons?: string[]
          plan_course_id?: string | null
          raw_course?: string | null
          raw_day?: string | null
          raw_room?: string | null
          raw_teacher?: string | null
          raw_time?: string | null
          room_id?: string | null
          schedule_session_id?: string | null
          schedule_version_id?: string | null
          shared_key?: string | null
          shared_member?: boolean
          source_cell?: string
          source_file?: string
          source_id?: string
          start_time?: string | null
          status?: string
          study_plan_id?: string | null
          teaching_assignment_id?: string | null
          term_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "existing_schedule_source_rows_cohort_id_fkey"
            columns: ["cohort_id"]
            isOneToOne: false
            referencedRelation: "academic_cohorts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "existing_schedule_source_rows_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "existing_schedule_source_rows_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "plan_course_components"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "existing_schedule_source_rows_delivery_group_id_fkey"
            columns: ["delivery_group_id"]
            isOneToOne: false
            referencedRelation: "delivery_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "existing_schedule_source_rows_delivery_group_id_fkey"
            columns: ["delivery_group_id"]
            isOneToOne: false
            referencedRelation: "operational_delivery_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "existing_schedule_source_rows_plan_course_id_fkey"
            columns: ["plan_course_id"]
            isOneToOne: false
            referencedRelation: "plan_courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "existing_schedule_source_rows_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "existing_schedule_source_rows_schedule_session_id_fkey"
            columns: ["schedule_session_id"]
            isOneToOne: false
            referencedRelation: "schedule_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "existing_schedule_source_rows_schedule_version_id_fkey"
            columns: ["schedule_version_id"]
            isOneToOne: false
            referencedRelation: "schedule_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "existing_schedule_source_rows_study_plan_id_fkey"
            columns: ["study_plan_id"]
            isOneToOne: false
            referencedRelation: "study_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "existing_schedule_source_rows_teaching_assignment_id_fkey"
            columns: ["teaching_assignment_id"]
            isOneToOne: false
            referencedRelation: "teaching_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "existing_schedule_source_rows_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "academic_terms"
            referencedColumns: ["id"]
          },
        ]
      }
      faculty_home_decisions: {
        Row: {
          decided_by: string
          evidence: string
          home_college_id: string | null
          identity_id: string
          quota_confirmed: boolean
          source_instructor_id: string
          updated_at: string
        }
        Insert: {
          decided_by: string
          evidence: string
          home_college_id?: string | null
          identity_id: string
          quota_confirmed?: boolean
          source_instructor_id: string
          updated_at?: string
        }
        Update: {
          decided_by?: string
          evidence?: string
          home_college_id?: string | null
          identity_id?: string
          quota_confirmed?: boolean
          source_instructor_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "faculty_home_decisions_home_college_id_fkey"
            columns: ["home_college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "faculty_home_decisions_identity_id_fkey"
            columns: ["identity_id"]
            isOneToOne: true
            referencedRelation: "faculty_identities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "faculty_home_decisions_source_instructor_id_fkey"
            columns: ["source_instructor_id"]
            isOneToOne: false
            referencedRelation: "instructors"
            referencedColumns: ["id"]
          },
        ]
      }
      faculty_identities: {
        Row: {
          created_at: string
          id: string
          issuing_college_id: string
          serial: number
          university_id: string
          university_number: string
        }
        Insert: {
          created_at?: string
          id?: string
          issuing_college_id: string
          serial?: number
          university_id: string
          university_number: string
        }
        Update: {
          created_at?: string
          id?: string
          issuing_college_id?: string
          serial?: number
          university_id?: string
          university_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "faculty_identities_issuing_college_id_fkey"
            columns: ["issuing_college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "faculty_identities_university_id_fkey"
            columns: ["university_id"]
            isOneToOne: false
            referencedRelation: "universities"
            referencedColumns: ["id"]
          },
        ]
      }
      faculty_identity_aliases: {
        Row: {
          identity_id: string
          linked_at: string
          linked_by: string
          old_identity_id: string
        }
        Insert: {
          identity_id: string
          linked_at?: string
          linked_by: string
          old_identity_id: string
        }
        Update: {
          identity_id?: string
          linked_at?: string
          linked_by?: string
          old_identity_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "faculty_identity_aliases_identity_id_fkey"
            columns: ["identity_id"]
            isOneToOne: false
            referencedRelation: "faculty_identities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "faculty_identity_aliases_old_identity_id_fkey"
            columns: ["old_identity_id"]
            isOneToOne: true
            referencedRelation: "faculty_identities"
            referencedColumns: ["id"]
          },
        ]
      }
      faculty_identity_links: {
        Row: {
          identity_id: string
          instructor_id: string
          linked_at: string
        }
        Insert: {
          identity_id: string
          instructor_id: string
          linked_at?: string
        }
        Update: {
          identity_id?: string
          instructor_id?: string
          linked_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "faculty_identity_links_identity_id_fkey"
            columns: ["identity_id"]
            isOneToOne: false
            referencedRelation: "faculty_identities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "faculty_identity_links_instructor_id_fkey"
            columns: ["instructor_id"]
            isOneToOne: true
            referencedRelation: "instructors"
            referencedColumns: ["id"]
          },
        ]
      }
      faculty_number_history: {
        Row: {
          identity_id: string
          replaced_at: string
          replaced_by: string | null
          university_number: string
        }
        Insert: {
          identity_id: string
          replaced_at?: string
          replaced_by?: string | null
          university_number: string
        }
        Update: {
          identity_id?: string
          replaced_at?: string
          replaced_by?: string | null
          university_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "faculty_number_history_identity_id_fkey"
            columns: ["identity_id"]
            isOneToOne: false
            referencedRelation: "faculty_identities"
            referencedColumns: ["id"]
          },
        ]
      }
      faculty_teaching_requests: {
        Row: {
          assigned_hours: number
          assignment_id: string | null
          college_id: string
          component_hours: number
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          delivery_group_id: string
          expected_assignment_updated_at: string | null
          home_college_id: string
          id: string
          identity_id: string
          instructor_id: string
          notes: string | null
          requested_by: string
          status: string
          term_id: string
        }
        Insert: {
          assigned_hours: number
          assignment_id?: string | null
          college_id: string
          component_hours: number
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          delivery_group_id: string
          expected_assignment_updated_at?: string | null
          home_college_id: string
          id?: string
          identity_id: string
          instructor_id: string
          notes?: string | null
          requested_by: string
          status?: string
          term_id: string
        }
        Update: {
          assigned_hours?: number
          assignment_id?: string | null
          college_id?: string
          component_hours?: number
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          delivery_group_id?: string
          expected_assignment_updated_at?: string | null
          home_college_id?: string
          id?: string
          identity_id?: string
          instructor_id?: string
          notes?: string | null
          requested_by?: string
          status?: string
          term_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "faculty_teaching_requests_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "teaching_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "faculty_teaching_requests_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "faculty_teaching_requests_delivery_group_id_fkey"
            columns: ["delivery_group_id"]
            isOneToOne: false
            referencedRelation: "delivery_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "faculty_teaching_requests_delivery_group_id_fkey"
            columns: ["delivery_group_id"]
            isOneToOne: false
            referencedRelation: "operational_delivery_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "faculty_teaching_requests_home_college_id_fkey"
            columns: ["home_college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "faculty_teaching_requests_identity_id_fkey"
            columns: ["identity_id"]
            isOneToOne: false
            referencedRelation: "faculty_identities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "faculty_teaching_requests_instructor_id_fkey"
            columns: ["instructor_id"]
            isOneToOne: false
            referencedRelation: "instructors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "faculty_teaching_requests_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "academic_terms"
            referencedColumns: ["id"]
          },
        ]
      }
      faculty_workload_policies: {
        Row: {
          active: boolean
          college_id: string
          created_at: string
          id: string
          rank_aliases: string[]
          rank_code: string
          required_load_hours: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          college_id: string
          created_at?: string
          id?: string
          rank_aliases?: string[]
          rank_code: string
          required_load_hours: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          college_id?: string
          created_at?: string
          id?: string
          rank_aliases?: string[]
          rank_code?: string
          required_load_hours?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "faculty_workload_policies_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
        ]
      }
      import_errors: {
        Row: {
          college_id: string
          column_name: string | null
          created_at: string
          error_code: string
          id: string
          job_id: string
          message: string
          raw_value: string | null
          row_number: number
        }
        Insert: {
          college_id: string
          column_name?: string | null
          created_at?: string
          error_code: string
          id?: string
          job_id: string
          message: string
          raw_value?: string | null
          row_number: number
        }
        Update: {
          college_id?: string
          column_name?: string | null
          created_at?: string
          error_code?: string
          id?: string
          job_id?: string
          message?: string
          raw_value?: string | null
          row_number?: number
        }
        Relationships: []
      }
      import_jobs: {
        Row: {
          claimed_at: string | null
          college_id: string
          created_at: string
          created_by: string | null
          failure_message: string | null
          file_name: string | null
          finished_at: string | null
          id: string
          inserted_rows: number
          invalid_rows: number
          mode: string
          notes: string | null
          payload_manifest: string | null
          skipped_rows: number
          status: string
          target_entity: string
          total_rows: number
          updated_at: string
          updated_rows: number
          valid_rows: number
          validated_payload: Json | null
        }
        Insert: {
          claimed_at?: string | null
          college_id: string
          created_at?: string
          created_by?: string | null
          failure_message?: string | null
          file_name?: string | null
          finished_at?: string | null
          id?: string
          inserted_rows?: number
          invalid_rows?: number
          mode?: string
          notes?: string | null
          payload_manifest?: string | null
          skipped_rows?: number
          status?: string
          target_entity: string
          total_rows?: number
          updated_at?: string
          updated_rows?: number
          valid_rows?: number
          validated_payload?: Json | null
        }
        Update: {
          claimed_at?: string | null
          college_id?: string
          created_at?: string
          created_by?: string | null
          failure_message?: string | null
          file_name?: string | null
          finished_at?: string | null
          id?: string
          inserted_rows?: number
          invalid_rows?: number
          mode?: string
          notes?: string | null
          payload_manifest?: string | null
          skipped_rows?: number
          status?: string
          target_entity?: string
          total_rows?: number
          updated_at?: string
          updated_rows?: number
          valid_rows?: number
          validated_payload?: Json | null
        }
        Relationships: []
      }
      import_template_columns: {
        Row: {
          college_id: string
          column_order: number
          created_at: string
          data_type: string
          enum_values: Json | null
          example: string | null
          field_key: string
          header_ar: string
          id: string
          is_required: boolean
          notes: string | null
          template_id: string
          updated_at: string
        }
        Insert: {
          college_id: string
          column_order?: number
          created_at?: string
          data_type?: string
          enum_values?: Json | null
          example?: string | null
          field_key: string
          header_ar: string
          id?: string
          is_required?: boolean
          notes?: string | null
          template_id: string
          updated_at?: string
        }
        Update: {
          college_id?: string
          column_order?: number
          created_at?: string
          data_type?: string
          enum_values?: Json | null
          example?: string | null
          field_key?: string
          header_ar?: string
          id?: string
          is_required?: boolean
          notes?: string | null
          template_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      import_templates: {
        Row: {
          college_id: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name_ar: string
          sample_file_url: string | null
          sheet_name: string | null
          target_entity: string
          template_key: string
          updated_at: string
          version: number
        }
        Insert: {
          college_id: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name_ar: string
          sample_file_url?: string | null
          sheet_name?: string | null
          target_entity: string
          template_key: string
          updated_at?: string
          version?: number
        }
        Update: {
          college_id?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name_ar?: string
          sample_file_url?: string | null
          sheet_name?: string | null
          target_entity?: string
          template_key?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      instructor_availability: {
        Row: {
          availability_type: string
          college_id: string
          created_at: string
          day_of_week: number
          end_time: string
          id: string
          instructor_id: string
          is_preference: boolean
          notes: string | null
          start_time: string
          updated_at: string
        }
        Insert: {
          availability_type?: string
          college_id: string
          created_at?: string
          day_of_week: number
          end_time: string
          id?: string
          instructor_id: string
          is_preference?: boolean
          notes?: string | null
          start_time: string
          updated_at?: string
        }
        Update: {
          availability_type?: string
          college_id?: string
          created_at?: string
          day_of_week?: number
          end_time?: string
          id?: string
          instructor_id?: string
          is_preference?: boolean
          notes?: string | null
          start_time?: string
          updated_at?: string
        }
        Relationships: []
      }
      instructor_types: {
        Row: {
          code: string
          college_id: string
          color: string | null
          created_at: string
          description: string | null
          display_order: number
          id: string
          is_active: boolean
          is_external: boolean
          name_ar: string
          name_en: string | null
          updated_at: string
        }
        Insert: {
          code: string
          college_id: string
          color?: string | null
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          is_external?: boolean
          name_ar: string
          name_en?: string | null
          updated_at?: string
        }
        Update: {
          code?: string
          college_id?: string
          color?: string | null
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          is_external?: boolean
          name_ar?: string
          name_en?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      instructors: {
        Row: {
          academic_degree: string | null
          academic_rank: string | null
          admin_tasks: string | null
          administrative_department_id: string | null
          administrative_position: string | null
          administrative_release_hours: number
          administrative_support_department_id: string | null
          affiliation_college_id: string | null
          affiliation_department_id: string | null
          college_id: string
          created_at: string
          department_id: string | null
          email: string | null
          employee_number: string | null
          employment_type: string
          external_source: string | null
          full_name: string
          full_name_ar: string | null
          full_name_en: string | null
          id: string
          instructor_type_id: string | null
          is_active: boolean
          max_attendance_days_per_week: number | null
          max_hours_per_day: number | null
          max_weekly_hours: number | null
          notes: string | null
          phone: string | null
          specialization: string | null
          target_attendance_days_per_week: number | null
          updated_at: string
        }
        Insert: {
          academic_degree?: string | null
          academic_rank?: string | null
          admin_tasks?: string | null
          administrative_department_id?: string | null
          administrative_position?: string | null
          administrative_release_hours?: number
          administrative_support_department_id?: string | null
          affiliation_college_id?: string | null
          affiliation_department_id?: string | null
          college_id: string
          created_at?: string
          department_id?: string | null
          email?: string | null
          employee_number?: string | null
          employment_type?: string
          external_source?: string | null
          full_name: string
          full_name_ar?: string | null
          full_name_en?: string | null
          id?: string
          instructor_type_id?: string | null
          is_active?: boolean
          max_attendance_days_per_week?: number | null
          max_hours_per_day?: number | null
          max_weekly_hours?: number | null
          notes?: string | null
          phone?: string | null
          specialization?: string | null
          target_attendance_days_per_week?: number | null
          updated_at?: string
        }
        Update: {
          academic_degree?: string | null
          academic_rank?: string | null
          admin_tasks?: string | null
          administrative_department_id?: string | null
          administrative_position?: string | null
          administrative_release_hours?: number
          administrative_support_department_id?: string | null
          affiliation_college_id?: string | null
          affiliation_department_id?: string | null
          college_id?: string
          created_at?: string
          department_id?: string | null
          email?: string | null
          employee_number?: string | null
          employment_type?: string
          external_source?: string | null
          full_name?: string
          full_name_ar?: string | null
          full_name_en?: string | null
          id?: string
          instructor_type_id?: string | null
          is_active?: boolean
          max_attendance_days_per_week?: number | null
          max_hours_per_day?: number | null
          max_weekly_hours?: number | null
          notes?: string | null
          phone?: string | null
          specialization?: string | null
          target_attendance_days_per_week?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "instructors_administrative_department_fkey"
            columns: ["administrative_department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instructors_administrative_support_department_id_fkey"
            columns: ["administrative_support_department_id"]
            isOneToOne: false
            referencedRelation: "support_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instructors_affiliation_college_fkey"
            columns: ["affiliation_college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instructors_affiliation_department_fkey"
            columns: ["affiliation_department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_course_components: {
        Row: {
          college_id: string
          compensation_mode: string
          component_type: string
          counts_toward_overtime: boolean
          counts_toward_regular_load: boolean
          created_at: string
          explicit_group_size: number | null
          id: string
          is_timetabled: boolean
          plan_course_id: string
          required_room_type_id: string | null
          updated_at: string
          weekly_contact_hours: number
        }
        Insert: {
          college_id: string
          compensation_mode?: string
          component_type: string
          counts_toward_overtime?: boolean
          counts_toward_regular_load?: boolean
          created_at?: string
          explicit_group_size?: number | null
          id?: string
          is_timetabled?: boolean
          plan_course_id: string
          required_room_type_id?: string | null
          updated_at?: string
          weekly_contact_hours?: number
        }
        Update: {
          college_id?: string
          compensation_mode?: string
          component_type?: string
          counts_toward_overtime?: boolean
          counts_toward_regular_load?: boolean
          created_at?: string
          explicit_group_size?: number | null
          id?: string
          is_timetabled?: boolean
          plan_course_id?: string
          required_room_type_id?: string | null
          updated_at?: string
          weekly_contact_hours?: number
        }
        Relationships: [
          {
            foreignKeyName: "pcc_plan_course_college_fkey"
            columns: ["plan_course_id", "college_id"]
            isOneToOne: false
            referencedRelation: "plan_courses"
            referencedColumns: ["id", "college_id"]
          },
          {
            foreignKeyName: "pcc_room_type_college_fkey"
            columns: ["required_room_type_id", "college_id"]
            isOneToOne: false
            referencedRelation: "room_types"
            referencedColumns: ["id", "college_id"]
          },
          {
            foreignKeyName: "plan_course_components_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_course_components_plan_course_id_fkey"
            columns: ["plan_course_id"]
            isOneToOne: false
            referencedRelation: "plan_courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_course_components_required_room_type_id_fkey"
            columns: ["required_room_type_id"]
            isOneToOne: false
            referencedRelation: "room_types"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_courses: {
        Row: {
          college_id: string
          course_id: string
          created_at: string
          id: string
          is_required: boolean
          lab_session_duration: number
          labs_per_week: number
          lecture_session_duration: number
          lectures_per_week: number
          level_id: string | null
          required_room_type_for_lab: string | null
          required_room_type_for_lecture: string | null
          semester: number
          study_plan_id: string
          updated_at: string
        }
        Insert: {
          college_id: string
          course_id: string
          created_at?: string
          id?: string
          is_required?: boolean
          lab_session_duration?: number
          labs_per_week?: number
          lecture_session_duration?: number
          lectures_per_week?: number
          level_id?: string | null
          required_room_type_for_lab?: string | null
          required_room_type_for_lecture?: string | null
          semester?: number
          study_plan_id: string
          updated_at?: string
        }
        Update: {
          college_id?: string
          course_id?: string
          created_at?: string
          id?: string
          is_required?: boolean
          lab_session_duration?: number
          labs_per_week?: number
          lecture_session_duration?: number
          lectures_per_week?: number
          level_id?: string | null
          required_room_type_for_lab?: string | null
          required_room_type_for_lecture?: string | null
          semester?: number
          study_plan_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_courses_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_courses_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_courses_level_id_fkey"
            columns: ["level_id"]
            isOneToOne: false
            referencedRelation: "academic_levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_courses_study_plan_id_fkey"
            columns: ["study_plan_id"]
            isOneToOne: false
            referencedRelation: "study_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      quality_metrics: {
        Row: {
          code: string
          created_at: string
          default_weight: number
          description: string | null
          id: string
          is_active: boolean
          name_ar: string
          name_en: string | null
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          default_weight?: number
          description?: string | null
          id?: string
          is_active?: boolean
          name_ar: string
          name_en?: string | null
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          default_weight?: number
          description?: string | null
          id?: string
          is_active?: boolean
          name_ar?: string
          name_en?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      report_verification_receipts: {
        Row: {
          id: string
          issued_at: string
          report_kind: string
          source_revision: number
          source_updated_at: string
          version_id: string
        }
        Insert: {
          id?: string
          issued_at?: string
          report_kind: string
          source_revision: number
          source_updated_at: string
          version_id: string
        }
        Update: {
          id?: string
          issued_at?: string
          report_kind?: string
          source_revision?: number
          source_updated_at?: string
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_verification_receipts_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "schedule_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      room_availability: {
        Row: {
          college_id: string
          created_at: string
          day_of_week: number
          end_time: string
          id: string
          notes: string | null
          room_id: string
          start_time: string
          updated_at: string
        }
        Insert: {
          college_id: string
          created_at?: string
          day_of_week: number
          end_time: string
          id?: string
          notes?: string | null
          room_id: string
          start_time: string
          updated_at?: string
        }
        Update: {
          college_id?: string
          created_at?: string
          day_of_week?: number
          end_time?: string
          id?: string
          notes?: string | null
          room_id?: string
          start_time?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_availability_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      room_types: {
        Row: {
          code: string
          college_id: string
          color: string | null
          created_at: string
          default_capacity: number
          display_order: number
          features: Json
          id: string
          is_active: boolean
          name_ar: string
          name_en: string | null
          strict_capacity: boolean
          updated_at: string
        }
        Insert: {
          code: string
          college_id: string
          color?: string | null
          created_at?: string
          default_capacity?: number
          display_order?: number
          features?: Json
          id?: string
          is_active?: boolean
          name_ar: string
          name_en?: string | null
          strict_capacity?: boolean
          updated_at?: string
        }
        Update: {
          code?: string
          college_id?: string
          color?: string | null
          created_at?: string
          default_capacity?: number
          display_order?: number
          features?: Json
          id?: string
          is_active?: boolean
          name_ar?: string
          name_en?: string | null
          strict_capacity?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      room_unavailability: {
        Row: {
          college_id: string
          created_at: string
          day_of_week: number | null
          end_date: string | null
          end_time: string | null
          id: string
          reason: string | null
          room_id: string
          start_date: string | null
          start_time: string | null
          updated_at: string
        }
        Insert: {
          college_id: string
          created_at?: string
          day_of_week?: number | null
          end_date?: string | null
          end_time?: string | null
          id?: string
          reason?: string | null
          room_id: string
          start_date?: string | null
          start_time?: string | null
          updated_at?: string
        }
        Update: {
          college_id?: string
          created_at?: string
          day_of_week?: number | null
          end_date?: string | null
          end_time?: string | null
          id?: string
          reason?: string | null
          room_id?: string
          start_date?: string | null
          start_time?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_unavailability_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      rooms: {
        Row: {
          available_days: number[] | null
          available_end_time: string | null
          available_start_time: string | null
          building: string | null
          building_id: string | null
          capacity: number
          code: string
          college_id: string
          created_at: string
          floor: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          room_type: string
          room_type_id: string | null
          updated_at: string
        }
        Insert: {
          available_days?: number[] | null
          available_end_time?: string | null
          available_start_time?: string | null
          building?: string | null
          building_id?: string | null
          capacity?: number
          code: string
          college_id: string
          created_at?: string
          floor?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          room_type?: string
          room_type_id?: string | null
          updated_at?: string
        }
        Update: {
          available_days?: number[] | null
          available_end_time?: string | null
          available_start_time?: string | null
          building?: string | null
          building_id?: string | null
          capacity?: number
          code?: string
          college_id?: string
          created_at?: string
          floor?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          room_type?: string
          room_type_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      schedule_compaction_receipts: {
        Row: {
          actor_id: string
          college_id: string
          created_at: string
          operation_id: string
          request_hash: string
          result: Json
          schedule_version_id: string
        }
        Insert: {
          actor_id: string
          college_id: string
          created_at?: string
          operation_id: string
          request_hash: string
          result: Json
          schedule_version_id: string
        }
        Update: {
          actor_id?: string
          college_id?: string
          created_at?: string
          operation_id?: string
          request_hash?: string
          result?: Json
          schedule_version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_compaction_receipts_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_compaction_receipts_schedule_version_id_fkey"
            columns: ["schedule_version_id"]
            isOneToOne: false
            referencedRelation: "schedule_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_quality_runs: {
        Row: {
          college_id: string
          created_at: string
          eligibility_revision: number
          hard_conflicts_count: number
          id: string
          metrics_breakdown: Json | null
          run_by: string | null
          schedule_version_id: string
          soft_conflicts_count: number
          total_deductions: number
          total_score: number
        }
        Insert: {
          college_id: string
          created_at?: string
          eligibility_revision?: number
          hard_conflicts_count?: number
          id?: string
          metrics_breakdown?: Json | null
          run_by?: string | null
          schedule_version_id: string
          soft_conflicts_count?: number
          total_deductions?: number
          total_score?: number
        }
        Update: {
          college_id?: string
          created_at?: string
          eligibility_revision?: number
          hard_conflicts_count?: number
          id?: string
          metrics_breakdown?: Json | null
          run_by?: string | null
          schedule_version_id?: string
          soft_conflicts_count?: number
          total_deductions?: number
          total_score?: number
        }
        Relationships: []
      }
      schedule_sessions: {
        Row: {
          auto_schedule_run_id: string | null
          cohort_id: string | null
          college_id: string
          course_offering_id: string
          created_at: string
          day_of_week: number
          delivery_group_id: string | null
          end_time: string
          expected_students: number | null
          id: string
          instructor_id: string
          is_locked: boolean
          lock_reason: string | null
          plan_course_component_id: string | null
          replaced_by_split: boolean
          room_id: string | null
          schedule_version_id: string
          section_group_id: string | null
          section_id: string | null
          section_subgroup_id: string | null
          session_type: string
          source_type: string
          split_source_session_id: string | null
          start_time: string
          study_system: string
          teaching_assignment_id: string | null
          updated_at: string
        }
        Insert: {
          auto_schedule_run_id?: string | null
          cohort_id?: string | null
          college_id: string
          course_offering_id: string
          created_at?: string
          day_of_week: number
          delivery_group_id?: string | null
          end_time: string
          expected_students?: number | null
          id?: string
          instructor_id: string
          is_locked?: boolean
          lock_reason?: string | null
          plan_course_component_id?: string | null
          replaced_by_split?: boolean
          room_id?: string | null
          schedule_version_id: string
          section_group_id?: string | null
          section_id?: string | null
          section_subgroup_id?: string | null
          session_type?: string
          source_type?: string
          split_source_session_id?: string | null
          start_time: string
          study_system?: string
          teaching_assignment_id?: string | null
          updated_at?: string
        }
        Update: {
          auto_schedule_run_id?: string | null
          cohort_id?: string | null
          college_id?: string
          course_offering_id?: string
          created_at?: string
          day_of_week?: number
          delivery_group_id?: string | null
          end_time?: string
          expected_students?: number | null
          id?: string
          instructor_id?: string
          is_locked?: boolean
          lock_reason?: string | null
          plan_course_component_id?: string | null
          replaced_by_split?: boolean
          room_id?: string | null
          schedule_version_id?: string
          section_group_id?: string | null
          section_id?: string | null
          section_subgroup_id?: string | null
          session_type?: string
          source_type?: string
          split_source_session_id?: string | null
          start_time?: string
          study_system?: string
          teaching_assignment_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_sessions_cohort_id_fkey"
            columns: ["cohort_id"]
            isOneToOne: false
            referencedRelation: "academic_cohorts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_sessions_course_offering_id_fkey"
            columns: ["course_offering_id"]
            isOneToOne: false
            referencedRelation: "course_offerings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_sessions_delivery_group_id_fkey"
            columns: ["delivery_group_id"]
            isOneToOne: false
            referencedRelation: "delivery_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_sessions_delivery_group_id_fkey"
            columns: ["delivery_group_id"]
            isOneToOne: false
            referencedRelation: "operational_delivery_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_sessions_plan_course_component_id_fkey"
            columns: ["plan_course_component_id"]
            isOneToOne: false
            referencedRelation: "plan_course_components"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_sessions_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_sessions_schedule_version_id_fkey"
            columns: ["schedule_version_id"]
            isOneToOne: false
            referencedRelation: "schedule_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ss_cohort_college_fkey"
            columns: ["cohort_id", "college_id"]
            isOneToOne: false
            referencedRelation: "academic_cohorts"
            referencedColumns: ["id", "college_id"]
          },
          {
            foreignKeyName: "ss_component_college_fkey"
            columns: ["plan_course_component_id", "college_id"]
            isOneToOne: false
            referencedRelation: "plan_course_components"
            referencedColumns: ["id", "college_id"]
          },
          {
            foreignKeyName: "ss_delivery_group_college_fkey"
            columns: ["delivery_group_id", "college_id"]
            isOneToOne: false
            referencedRelation: "delivery_groups"
            referencedColumns: ["id", "college_id"]
          },
          {
            foreignKeyName: "ss_delivery_group_college_fkey"
            columns: ["delivery_group_id", "college_id"]
            isOneToOne: false
            referencedRelation: "operational_delivery_groups"
            referencedColumns: ["id", "college_id"]
          },
        ]
      }
      schedule_version_conflict_exceptions: {
        Row: {
          approval_type: string
          approved_at: string | null
          approved_by: string | null
          college_id: string
          conflict_code: string
          created_at: string
          id: string
          metadata: Json | null
          reason: string
          related_session_id: string | null
          schedule_version_id: string
          session_id: string
          source: string | null
          status: string
          updated_at: string
        }
        Insert: {
          approval_type: string
          approved_at?: string | null
          approved_by?: string | null
          college_id: string
          conflict_code: string
          created_at?: string
          id?: string
          metadata?: Json | null
          reason: string
          related_session_id?: string | null
          schedule_version_id: string
          session_id: string
          source?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          approval_type?: string
          approved_at?: string | null
          approved_by?: string | null
          college_id?: string
          conflict_code?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          reason?: string
          related_session_id?: string | null
          schedule_version_id?: string
          session_id?: string
          source?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_version_conflict_exceptions_related_session_id_fkey"
            columns: ["related_session_id"]
            isOneToOne: false
            referencedRelation: "schedule_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_version_conflict_exceptions_schedule_version_id_fkey"
            columns: ["schedule_version_id"]
            isOneToOne: false
            referencedRelation: "schedule_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_version_conflict_exceptions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "schedule_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_version_events: {
        Row: {
          college_id: string
          created_at: string
          event_type: string
          from_status: string | null
          id: string
          metadata: Json | null
          notes: string | null
          performed_by: string | null
          schedule_version_id: string
          to_status: string | null
        }
        Insert: {
          college_id: string
          created_at?: string
          event_type: string
          from_status?: string | null
          id?: string
          metadata?: Json | null
          notes?: string | null
          performed_by?: string | null
          schedule_version_id: string
          to_status?: string | null
        }
        Update: {
          college_id?: string
          created_at?: string
          event_type?: string
          from_status?: string | null
          id?: string
          metadata?: Json | null
          notes?: string | null
          performed_by?: string | null
          schedule_version_id?: string
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "schedule_version_events_schedule_version_id_fkey"
            columns: ["schedule_version_id"]
            isOneToOne: false
            referencedRelation: "schedule_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_versions: {
        Row: {
          academic_term_id: string
          college_id: string
          created_at: string
          created_by: string | null
          disposable_test: boolean
          eligibility_revision: number
          id: string
          instructor_attendance_overrides: Json
          is_coordination: boolean
          name: string
          notes: string | null
          status: string
          updated_at: string
        }
        Insert: {
          academic_term_id: string
          college_id: string
          created_at?: string
          created_by?: string | null
          disposable_test?: boolean
          eligibility_revision?: number
          id?: string
          instructor_attendance_overrides?: Json
          is_coordination?: boolean
          name: string
          notes?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          academic_term_id?: string
          college_id?: string
          created_at?: string
          created_by?: string | null
          disposable_test?: boolean
          eligibility_revision?: number
          id?: string
          instructor_attendance_overrides?: Json
          is_coordination?: boolean
          name?: string
          notes?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      scheduling_cohort_term_headcounts: {
        Row: {
          approval_status: string
          approved_at: string | null
          approved_by: string | null
          cohort_id: string
          college_id: string
          created_at: string
          eligible_student_count: number
          exam_eligible_count: number
          expected_attendance_count: number
          id: string
          notes: string | null
          registered_student_count: number
          reserve_margin: number
          scheduling_headcount: number
          source: string
          study_system: string
          term_id: string
          updated_at: string
        }
        Insert: {
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          cohort_id: string
          college_id: string
          created_at?: string
          eligible_student_count: number
          exam_eligible_count: number
          expected_attendance_count: number
          id?: string
          notes?: string | null
          registered_student_count: number
          reserve_margin?: number
          scheduling_headcount: number
          source: string
          study_system: string
          term_id: string
          updated_at?: string
        }
        Update: {
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          cohort_id?: string
          college_id?: string
          created_at?: string
          eligible_student_count?: number
          exam_eligible_count?: number
          expected_attendance_count?: number
          id?: string
          notes?: string | null
          registered_student_count?: number
          reserve_margin?: number
          scheduling_headcount?: number
          source?: string
          study_system?: string
          term_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduling_cohort_term_headcounts_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduling_headcount_cohort_college_fkey"
            columns: ["cohort_id", "college_id"]
            isOneToOne: false
            referencedRelation: "academic_cohorts"
            referencedColumns: ["id", "college_id"]
          },
          {
            foreignKeyName: "scheduling_headcount_term_college_fkey"
            columns: ["term_id", "college_id"]
            isOneToOne: false
            referencedRelation: "academic_terms"
            referencedColumns: ["id", "college_id"]
          },
        ]
      }
      scheduling_headcount_overrides: {
        Row: {
          active: boolean
          approval_status: string
          approved_at: string | null
          approved_by: string | null
          college_id: string
          course_offering_id: string | null
          created_at: string
          exam_eligible_count: number | null
          headcount_id: string
          id: string
          notes: string | null
          plan_course_component_id: string | null
          reserve_margin: number | null
          scheduling_headcount: number
          source: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          college_id: string
          course_offering_id?: string | null
          created_at?: string
          exam_eligible_count?: number | null
          headcount_id: string
          id?: string
          notes?: string | null
          plan_course_component_id?: string | null
          reserve_margin?: number | null
          scheduling_headcount: number
          source: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          college_id?: string
          course_offering_id?: string | null
          created_at?: string
          exam_eligible_count?: number | null
          headcount_id?: string
          id?: string
          notes?: string | null
          plan_course_component_id?: string | null
          reserve_margin?: number | null
          scheduling_headcount?: number
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduling_headcount_overrides_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduling_headcount_overrides_course_offering_id_fkey"
            columns: ["course_offering_id"]
            isOneToOne: false
            referencedRelation: "course_offerings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduling_headcount_overrides_headcount_id_fkey"
            columns: ["headcount_id"]
            isOneToOne: false
            referencedRelation: "scheduling_cohort_term_headcounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduling_headcount_overrides_plan_course_component_id_fkey"
            columns: ["plan_course_component_id"]
            isOneToOne: false
            referencedRelation: "plan_course_components"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduling_headcount_revisions: {
        Row: {
          changed_at: string
          changed_by: string | null
          college_id: string
          headcount_id: string
          id: string
          notes: string | null
          override_id: string | null
          revision_kind: string
          snapshot: Json
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          college_id: string
          headcount_id: string
          id?: string
          notes?: string | null
          override_id?: string | null
          revision_kind: string
          snapshot: Json
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          college_id?: string
          headcount_id?: string
          id?: string
          notes?: string | null
          override_id?: string | null
          revision_kind?: string
          snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "scheduling_headcount_revisions_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduling_headcount_revisions_headcount_id_fkey"
            columns: ["headcount_id"]
            isOneToOne: false
            referencedRelation: "scheduling_cohort_term_headcounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduling_headcount_revisions_override_id_fkey"
            columns: ["override_id"]
            isOneToOne: false
            referencedRelation: "scheduling_headcount_overrides"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduling_settings: {
        Row: {
          allow_3h_sessions: boolean
          allow_back_to_back: boolean
          allowed_session_durations: number[]
          break_between_sessions_min: number
          college_id: string
          created_at: string
          day_end_time: string
          day_start_time: string
          enforce_instructor_availability: boolean
          extended_day_policy_enabled: boolean
          id: string
          max_daily_hours_per_instructor: number
          max_daily_hours_per_section: number
          max_daily_practical_hours_per_section: number
          max_daily_theory_hours_per_section: number
          max_extended_days_per_partition: number
          max_session_hours: number
          min_session_hours: number
          notes: string | null
          slot_minutes: number
          standard_day_end_time: string
          updated_at: string
          week_start_day: number
          working_days: number[]
        }
        Insert: {
          allow_3h_sessions?: boolean
          allow_back_to_back?: boolean
          allowed_session_durations?: number[]
          break_between_sessions_min?: number
          college_id: string
          created_at?: string
          day_end_time?: string
          day_start_time?: string
          enforce_instructor_availability?: boolean
          extended_day_policy_enabled?: boolean
          id?: string
          max_daily_hours_per_instructor?: number
          max_daily_hours_per_section?: number
          max_daily_practical_hours_per_section?: number
          max_daily_theory_hours_per_section?: number
          max_extended_days_per_partition?: number
          max_session_hours?: number
          min_session_hours?: number
          notes?: string | null
          slot_minutes?: number
          standard_day_end_time?: string
          updated_at?: string
          week_start_day?: number
          working_days?: number[]
        }
        Update: {
          allow_3h_sessions?: boolean
          allow_back_to_back?: boolean
          allowed_session_durations?: number[]
          break_between_sessions_min?: number
          college_id?: string
          created_at?: string
          day_end_time?: string
          day_start_time?: string
          enforce_instructor_availability?: boolean
          extended_day_policy_enabled?: boolean
          id?: string
          max_daily_hours_per_instructor?: number
          max_daily_hours_per_section?: number
          max_daily_practical_hours_per_section?: number
          max_daily_theory_hours_per_section?: number
          max_extended_days_per_partition?: number
          max_session_hours?: number
          min_session_hours?: number
          notes?: string | null
          slot_minutes?: number
          standard_day_end_time?: string
          updated_at?: string
          week_start_day?: number
          working_days?: number[]
        }
        Relationships: []
      }
      section_group_members: {
        Row: {
          college_id: string
          created_at: string
          expected_students: number
          id: string
          section_group_id: string
          section_id: string
        }
        Insert: {
          college_id: string
          created_at?: string
          expected_students?: number
          id?: string
          section_group_id: string
          section_id: string
        }
        Update: {
          college_id?: string
          created_at?: string
          expected_students?: number
          id?: string
          section_group_id?: string
          section_id?: string
        }
        Relationships: []
      }
      section_groups: {
        Row: {
          academic_term_id: string
          college_id: string
          course_id: string
          created_at: string
          expected_students_total: number
          group_name: string
          id: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          academic_term_id: string
          college_id: string
          course_id: string
          created_at?: string
          expected_students_total?: number
          group_name: string
          id?: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          academic_term_id?: string
          college_id?: string
          course_id?: string
          created_at?: string
          expected_students_total?: number
          group_name?: string
          id?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      section_subgroups: {
        Row: {
          academic_term_id: string
          college_id: string
          course_id: string
          created_at: string
          expected_students: number
          id: string
          is_active: boolean
          notes: string | null
          ordinal: number
          owner_approval_ref: string | null
          section_id: string
          source_policy: string
          study_system: string
          subgroup_code: string
          teaching_assignment_id: string | null
          updated_at: string
        }
        Insert: {
          academic_term_id: string
          college_id: string
          course_id: string
          created_at?: string
          expected_students?: number
          id?: string
          is_active?: boolean
          notes?: string | null
          ordinal: number
          owner_approval_ref?: string | null
          section_id: string
          source_policy: string
          study_system?: string
          subgroup_code: string
          teaching_assignment_id?: string | null
          updated_at?: string
        }
        Update: {
          academic_term_id?: string
          college_id?: string
          course_id?: string
          created_at?: string
          expected_students?: number
          id?: string
          is_active?: boolean
          notes?: string | null
          ordinal?: number
          owner_approval_ref?: string | null
          section_id?: string
          source_policy?: string
          study_system?: string
          subgroup_code?: string
          teaching_assignment_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      sections: {
        Row: {
          capacity: number
          college_id: string
          course_id: string
          created_at: string
          id: string
          section_number: string
          study_system: string
          term_id: string
          updated_at: string
        }
        Insert: {
          capacity?: number
          college_id: string
          course_id: string
          created_at?: string
          id?: string
          section_number: string
          study_system?: string
          term_id: string
          updated_at?: string
        }
        Update: {
          capacity?: number
          college_id?: string
          course_id?: string
          created_at?: string
          id?: string
          section_number?: string
          study_system?: string
          term_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sections_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sections_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sections_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "academic_terms"
            referencedColumns: ["id"]
          },
        ]
      }
      security_events: {
        Row: {
          actor_id: string | null
          created_at: string
          details: Json
          event: string
          id: number
          severity: string
          target_id: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          details?: Json
          event: string
          id?: never
          severity: string
          target_id?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          details?: Json
          event?: string
          id?: never
          severity?: string
          target_id?: string | null
        }
        Relationships: []
      }
      security_rate_buckets: {
        Row: {
          action: string
          actor_id: string
          attempts: number
          window_start: string
        }
        Insert: {
          action: string
          actor_id: string
          attempts: number
          window_start: string
        }
        Update: {
          action?: string
          actor_id?: string
          attempts?: number
          window_start?: string
        }
        Relationships: []
      }
      security_settings: {
        Row: {
          id: boolean
          require_admin_mfa: boolean
        }
        Insert: {
          id?: boolean
          require_admin_mfa?: boolean
        }
        Update: {
          id?: boolean
          require_admin_mfa?: boolean
        }
        Relationships: []
      }
      session_types: {
        Row: {
          code: string
          college_id: string
          color: string | null
          created_at: string
          default_duration_hours: number
          display_order: number
          id: string
          is_active: boolean
          name_ar: string
          name_en: string | null
          requires_lab: boolean
          updated_at: string
        }
        Insert: {
          code: string
          college_id: string
          color?: string | null
          created_at?: string
          default_duration_hours?: number
          display_order?: number
          id?: string
          is_active?: boolean
          name_ar: string
          name_en?: string | null
          requires_lab?: boolean
          updated_at?: string
        }
        Update: {
          code?: string
          college_id?: string
          color?: string | null
          created_at?: string
          default_duration_hours?: number
          display_order?: number
          id?: string
          is_active?: boolean
          name_ar?: string
          name_en?: string | null
          requires_lab?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      shared_lecture_links: {
        Row: {
          anchor_group_id: string
          college_id: string
          created_at: string
          member_group_id: string
        }
        Insert: {
          anchor_group_id: string
          college_id: string
          created_at?: string
          member_group_id: string
        }
        Update: {
          anchor_group_id?: string
          college_id?: string
          created_at?: string
          member_group_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shared_lecture_links_anchor_group_id_fkey"
            columns: ["anchor_group_id"]
            isOneToOne: false
            referencedRelation: "delivery_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_lecture_links_anchor_group_id_fkey"
            columns: ["anchor_group_id"]
            isOneToOne: false
            referencedRelation: "operational_delivery_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_lecture_links_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_lecture_links_member_group_id_fkey"
            columns: ["member_group_id"]
            isOneToOne: true
            referencedRelation: "delivery_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_lecture_links_member_group_id_fkey"
            columns: ["member_group_id"]
            isOneToOne: true
            referencedRelation: "operational_delivery_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      study_plans: {
        Row: {
          code: string
          college_id: string
          created_at: string
          effective_year: number | null
          id: string
          is_active: boolean
          name: string
          program_id: string
          updated_at: string
          version: string
        }
        Insert: {
          code: string
          college_id: string
          created_at?: string
          effective_year?: number | null
          id?: string
          is_active?: boolean
          name: string
          program_id: string
          updated_at?: string
          version?: string
        }
        Update: {
          code?: string
          college_id?: string
          created_at?: string
          effective_year?: number | null
          id?: string
          is_active?: boolean
          name?: string
          program_id?: string
          updated_at?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "study_plans_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "study_plans_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "academic_programs"
            referencedColumns: ["id"]
          },
        ]
      }
      support_departments: {
        Row: {
          college_id: string
          created_at: string
          id: string
          name: string
        }
        Insert: {
          college_id: string
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          college_id?: string
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_departments_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
        ]
      }
      teaching_assignments: {
        Row: {
          assigned_component_hours: number | null
          cohort_id: string | null
          college_id: string
          course_offering_id: string
          created_at: string
          delivery_group_id: string | null
          expected_students: number | null
          id: string
          instructor_id: string
          is_active: boolean
          notes: string | null
          plan_course_component_id: string | null
          required_room_type: string | null
          section_id: string | null
          section_number: string | null
          session_type: string
          updated_at: string
          weekly_hours: number
        }
        Insert: {
          assigned_component_hours?: number | null
          cohort_id?: string | null
          college_id: string
          course_offering_id: string
          created_at?: string
          delivery_group_id?: string | null
          expected_students?: number | null
          id?: string
          instructor_id: string
          is_active?: boolean
          notes?: string | null
          plan_course_component_id?: string | null
          required_room_type?: string | null
          section_id?: string | null
          section_number?: string | null
          session_type?: string
          updated_at?: string
          weekly_hours?: number
        }
        Update: {
          assigned_component_hours?: number | null
          cohort_id?: string | null
          college_id?: string
          course_offering_id?: string
          created_at?: string
          delivery_group_id?: string | null
          expected_students?: number | null
          id?: string
          instructor_id?: string
          is_active?: boolean
          notes?: string | null
          plan_course_component_id?: string | null
          required_room_type?: string | null
          section_id?: string | null
          section_number?: string | null
          session_type?: string
          updated_at?: string
          weekly_hours?: number
        }
        Relationships: [
          {
            foreignKeyName: "ta_cohort_college_fkey"
            columns: ["cohort_id", "college_id"]
            isOneToOne: false
            referencedRelation: "academic_cohorts"
            referencedColumns: ["id", "college_id"]
          },
          {
            foreignKeyName: "ta_component_college_fkey"
            columns: ["plan_course_component_id", "college_id"]
            isOneToOne: false
            referencedRelation: "plan_course_components"
            referencedColumns: ["id", "college_id"]
          },
          {
            foreignKeyName: "ta_delivery_group_college_fkey"
            columns: ["delivery_group_id", "college_id"]
            isOneToOne: false
            referencedRelation: "delivery_groups"
            referencedColumns: ["id", "college_id"]
          },
          {
            foreignKeyName: "ta_delivery_group_college_fkey"
            columns: ["delivery_group_id", "college_id"]
            isOneToOne: false
            referencedRelation: "operational_delivery_groups"
            referencedColumns: ["id", "college_id"]
          },
          {
            foreignKeyName: "teaching_assignments_cohort_id_fkey"
            columns: ["cohort_id"]
            isOneToOne: false
            referencedRelation: "academic_cohorts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teaching_assignments_course_offering_id_fkey"
            columns: ["course_offering_id"]
            isOneToOne: false
            referencedRelation: "course_offerings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teaching_assignments_delivery_group_id_fkey"
            columns: ["delivery_group_id"]
            isOneToOne: false
            referencedRelation: "delivery_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teaching_assignments_delivery_group_id_fkey"
            columns: ["delivery_group_id"]
            isOneToOne: false
            referencedRelation: "operational_delivery_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teaching_assignments_plan_course_component_id_fkey"
            columns: ["plan_course_component_id"]
            isOneToOne: false
            referencedRelation: "plan_course_components"
            referencedColumns: ["id"]
          },
        ]
      }
      time_slot_templates: {
        Row: {
          college_id: string
          created_at: string
          day_of_week: number
          end_time: string
          id: string
          is_active: boolean
          slot_duration_minutes: number
          start_time: string
          study_system: string
          updated_at: string
        }
        Insert: {
          college_id: string
          created_at?: string
          day_of_week: number
          end_time: string
          id?: string
          is_active?: boolean
          slot_duration_minutes?: number
          start_time: string
          study_system?: string
          updated_at?: string
        }
        Update: {
          college_id?: string
          created_at?: string
          day_of_week?: number
          end_time?: string
          id?: string
          is_active?: boolean
          slot_duration_minutes?: number
          start_time?: string
          study_system?: string
          updated_at?: string
        }
        Relationships: []
      }
      time_slots: {
        Row: {
          college_id: string
          created_at: string
          day_of_week: number
          end_time: string
          id: string
          is_active: boolean
          slot_order: number
          start_time: string
          updated_at: string
        }
        Insert: {
          college_id: string
          created_at?: string
          day_of_week: number
          end_time: string
          id?: string
          is_active?: boolean
          slot_order?: number
          start_time: string
          updated_at?: string
        }
        Update: {
          college_id?: string
          created_at?: string
          day_of_week?: number
          end_time?: string
          id?: string
          is_active?: boolean
          slot_order?: number
          start_time?: string
          updated_at?: string
        }
        Relationships: []
      }
      universities: {
        Row: {
          code: string | null
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          code?: string | null
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          code?: string | null
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_colleges: {
        Row: {
          college_id: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          college_id: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          college_id?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_colleges_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      operational_delivery_groups: {
        Row: {
          active: boolean | null
          capacity_limit: number | null
          cohort_id: string | null
          college_id: string | null
          component_id: string | null
          created_at: string | null
          excluded_from_standard_workload: boolean | null
          expected_students: number | null
          group_code: string | null
          group_number: number | null
          id: string | null
          is_obsolete: boolean | null
          plan_course_id: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_groups_cohort_id_fkey"
            columns: ["cohort_id"]
            isOneToOne: false
            referencedRelation: "academic_cohorts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_groups_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_groups_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "plan_course_components"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_groups_plan_course_id_fkey"
            columns: ["plan_course_id"]
            isOneToOne: false
            referencedRelation: "plan_courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dg_cohort_college_fkey"
            columns: ["cohort_id", "college_id"]
            isOneToOne: false
            referencedRelation: "academic_cohorts"
            referencedColumns: ["id", "college_id"]
          },
          {
            foreignKeyName: "dg_component_college_fkey"
            columns: ["component_id", "college_id"]
            isOneToOne: false
            referencedRelation: "plan_course_components"
            referencedColumns: ["id", "college_id"]
          },
          {
            foreignKeyName: "dg_plan_course_college_fkey"
            columns: ["plan_course_id", "college_id"]
            isOneToOne: false
            referencedRelation: "plan_courses"
            referencedColumns: ["id", "college_id"]
          },
        ]
      }
      operational_group_members: {
        Row: {
          cohort_id: string | null
          college_id: string | null
          delivery_group_id: string | null
          id: string | null
          partition_active: boolean | null
          partition_headcount: number | null
          partition_id: string | null
          shared_lecture: boolean | null
        }
        Relationships: []
      }
      v_instructor_delivery_workload: {
        Row: {
          academic_rank: string | null
          cohort_id: string | null
          college_id: string | null
          instructor_id: string | null
          project_supervision_hours: number | null
          standard_assigned_hours: number | null
          term_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "academic_cohorts_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "academic_terms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ta_cohort_college_fkey"
            columns: ["cohort_id", "college_id"]
            isOneToOne: false
            referencedRelation: "academic_cohorts"
            referencedColumns: ["id", "college_id"]
          },
          {
            foreignKeyName: "teaching_assignments_cohort_id_fkey"
            columns: ["cohort_id"]
            isOneToOne: false
            referencedRelation: "academic_cohorts"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _avail_date_span: {
        Args: { p_end_date: string; p_start_date: string }
        Returns: unknown
      }
      _avail_day_span: { Args: { p_day_of_week: number }; Returns: unknown }
      _avail_time_span: {
        Args: { p_end: string; p_start: string }
        Returns: unknown
      }
      _availability_active_working_days: {
        Args: { p_college_id: string }
        Returns: number[]
      }
      _collect_schedule_session_move_conflicts: {
        Args: {
          p_college_id: string
          p_course_offering_id: string
          p_day_of_week: number
          p_end_time: string
          p_expected_students: number
          p_instructor_id: string
          p_room_id: string
          p_section_id: string
          p_session_id: string
          p_start_time: string
          p_study_system: string
          p_teaching_assignment_id: string
          p_version_id: string
        }
        Returns: Json
      }
      _generate_cohort_delivery_groups_core_20260918: {
        Args: { p_cohort_id: string }
        Returns: Json
      }
      _import_apply_academic_cohorts: {
        Args: { p_college: string; p_mode: string; p_rows: Json }
        Returns: Json
      }
      _import_apply_academic_structure: {
        Args: {
          p_college: string
          p_entity: string
          p_mode: string
          p_rows: Json
        }
        Returns: Json
      }
      _import_apply_cohort_elective_selections: {
        Args: { p_college: string; p_mode: string; p_rows: Json }
        Returns: Json
      }
      _import_apply_course_offerings: {
        Args: { p_college: string; p_mode: string; p_rows: Json }
        Returns: Json
      }
      _import_apply_course_programs: {
        Args: { p_college: string; p_mode: string; p_rows: Json }
        Returns: Json
      }
      _import_apply_elective_slot_courses: {
        Args: { p_college: string; p_mode: string; p_rows: Json }
        Returns: Json
      }
      _import_apply_section_groups: {
        Args: { p_college: string; p_mode: string; p_rows: Json }
        Returns: Json
      }
      _import_apply_sections: {
        Args: { p_college: string; p_mode: string; p_rows: Json }
        Returns: Json
      }
      _import_apply_study_plan: {
        Args: { p_college: string; p_mode: string; p_rows: Json }
        Returns: Json
      }
      _import_apply_table_entity: {
        Args: {
          p_college: string
          p_entity: string
          p_mode: string
          p_rows: Json
        }
        Returns: Json
      }
      _import_apply_teaching_assignments: {
        Args: { p_college: string; p_mode: string; p_rows: Json }
        Returns: Json
      }
      _import_apply_teaching_assignments_v2: {
        Args: { p_college: string; p_mode: string; p_rows: Json }
        Returns: Json
      }
      _import_counters_add: { Args: { a: Json; b: Json }; Returns: Json }
      _import_counters_new: { Args: never; Returns: Json }
      _import_dispatch: {
        Args: {
          p_college: string
          p_entity: string
          p_mode: string
          p_rows: Json
        }
        Returns: Json
      }
      _import_find_or_create_course: {
        Args: { p_college: string; v: Json }
        Returns: string
      }
      _import_find_or_create_level: {
        Args: { p_college: string; p_level: number; p_program: string }
        Returns: string
      }
      _import_find_or_create_study_plan: {
        Args: { p_college: string; v: Json }
        Returns: string
      }
      _import_is_elective_placeholder: {
        Args: { code: string }
        Returns: boolean
      }
      _import_mode_action: {
        Args: { p_exists: boolean; p_mode: string }
        Returns: string
      }
      _import_row_number: { Args: { elem: Json; idx: number }; Returns: number }
      _import_row_values: { Args: { elem: Json }; Returns: Json }
      _import_sync_plan_course_components: {
        Args: { p_college: string; p_plan_course: string; v: Json }
        Returns: undefined
      }
      _sb_v2_assignment_guard: {
        Args: { p_teaching_assignment_id: string }
        Returns: Json
      }
      _sb_v2_delivery_group_overlap: {
        Args: {
          p_cohort_id: string
          p_day_of_week: number
          p_delivery_group_id: string
          p_end_time: string
          p_exclude_session_id?: string
          p_schedule_version_id: string
          p_start_time: string
        }
        Returns: Json
      }
      _sb_v2_scheduled_hours_for_assignment: {
        Args: {
          p_exclude_session_id?: string
          p_schedule_version_id: string
          p_teaching_assignment_id: string
        }
        Returns: number
      }
      _sb_v2_wall_hours: {
        Args: { p_end: string; p_start: string }
        Returns: number
      }
      _ss_brk: {
        Args: {
          p_cid: string
          p_dow: number
          p_et: string
          p_sid: string
          p_st: string
        }
        Returns: Json
      }
      _ss_cap: {
        Args: { cap: number; n: number; sid: string; st: string }
        Returns: Json
      }
      _ss_ci: {
        Args: { c: string; m?: Json; rid: string; s: string; sid: string }
        Returns: Json
      }
      _ss_enroll: {
        Args: { p_exp: number; p_off: string }
        Returns: Record<string, unknown>
      }
      _ss_ex_match: {
        Args: { p_code: string; p_rid: string; p_sid: string; p_vid: string }
        Returns: Record<string, unknown>
      }
      _ss_gather: {
        Args: {
          a: string
          b: string
          c: string
          d: string
          e: string
          f: string
          g: string
          h: string
          i: number
          j: number
          k: string
          l: string
          m: string
        }
        Returns: Json
      }
      _ss_iavail_req: {
        Args: { p_cid: string; p_dow: number; p_iid: string; p_sid: string }
        Returns: Json
      }
      _ss_iavail_win: {
        Args: {
          p_cid: string
          p_dow: number
          p_et: string
          p_iid: string
          p_sid: string
          p_st: string
        }
        Returns: Json
      }
      _ss_ov: {
        Args: { a: string; b: string; c: string; d: string }
        Returns: boolean
      }
      _ss_pack: { Args: { p_conflicts: Json; p_vid: string }; Returns: Json }
      _ss_peer_i: {
        Args: {
          p_cid: string
          p_dow: number
          p_et: string
          p_iid: string
          p_sid: string
          p_st: string
          p_vid: string
        }
        Returns: Json
      }
      _ss_peer_r: {
        Args: {
          p_cid: string
          p_dow: number
          p_et: string
          p_rid: string
          p_sid: string
          p_st: string
          p_vid: string
        }
        Returns: Json
      }
      _ss_peer_s: {
        Args: {
          p_cid: string
          p_dow: number
          p_et: string
          p_sec: string
          p_sid: string
          p_st: string
          p_vid: string
        }
        Returns: Json
      }
      _ss_room_av: {
        Args: {
          p_cid: string
          p_dow: number
          p_et: string
          p_rid: string
          p_sid: string
          p_st: string
        }
        Returns: Json
      }
      _ss_room_cap: {
        Args: {
          p_cid: string
          p_exp: number
          p_off: string
          p_rid: string
          p_sid: string
        }
        Returns: Json
      }
      _ss_room_type: {
        Args: { p_cid: string; p_rid: string; p_sid: string; p_ta: string }
        Returns: Json
      }
      _ss_sec_hit: {
        Args: {
          p_peer_sec: string
          p_peer_sg: string
          p_sec: string
          p_sg: string
        }
        Returns: boolean
      }
      _ss_set: {
        Args: {
          p_cid: string
          p_dow: number
          p_et: string
          p_sid: string
          p_st: string
        }
        Returns: Json
      }
      _ss_sg: { Args: { p_id: string }; Returns: string }
      _ss_tmpl: {
        Args: {
          p_cid: string
          p_dow: number
          p_et: string
          p_sid: string
          p_st: string
          p_sys: string
        }
        Returns: Json
      }
      academic_affairs_update_instructor: {
        Args: {
          p_academic_rank: string
          p_administrative_department_id: string
          p_administrative_position: string
          p_administrative_release_hours: number
          p_administrative_support_department_id: string
          p_affiliation_college_id: string
          p_affiliation_department_id: string
          p_email: string
          p_employee_number: string
          p_employment_type: string
          p_full_name: string
          p_full_name_ar: string
          p_instructor_id: string
          p_instructor_type_id: string
          p_is_active: boolean
          p_max_weekly_hours: number
          p_phone: string
          p_specialization: string
        }
        Returns: {
          academic_degree: string | null
          academic_rank: string | null
          admin_tasks: string | null
          administrative_department_id: string | null
          administrative_position: string | null
          administrative_release_hours: number
          administrative_support_department_id: string | null
          affiliation_college_id: string | null
          affiliation_department_id: string | null
          college_id: string
          created_at: string
          department_id: string | null
          email: string | null
          employee_number: string | null
          employment_type: string
          external_source: string | null
          full_name: string
          full_name_ar: string | null
          full_name_en: string | null
          id: string
          instructor_type_id: string | null
          is_active: boolean
          max_attendance_days_per_week: number | null
          max_hours_per_day: number | null
          max_weekly_hours: number | null
          notes: string | null
          phone: string | null
          specialization: string | null
          target_attendance_days_per_week: number | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "instructors"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      apply_schedule_compaction: {
        Args: {
          p_college_id: string
          p_expected_revision: number
          p_expected_version_updated_at: string
          p_moves: Json
          p_operation_id: string
          p_version_id: string
        }
        Returns: Json
      }
      apply_schedule_generation: {
        Args: {
          p_additions: Json
          p_college_id: string
          p_day_cap: number
          p_expected_revision: number
          p_expected_version_updated_at: string
          p_moves: Json
          p_note?: string
          p_operation_id: string
          p_version_id: string
        }
        Returns: Json
      }
      apply_schedule_relayout: {
        Args: {
          p_college_id: string
          p_day_cap: number
          p_expected_revision: number
          p_expected_version_updated_at: string
          p_moves: Json
          p_operation_id: string
          p_version_id: string
        }
        Returns: Json
      }
      approve_capacity_split_proposal: {
        Args: {
          p_college_id: string
          p_course_offering_id: string
          p_expected_enrollment_count_updated_at: string
          p_expected_students: number
          p_groups: Json
          p_room_capacity: number
          p_room_id: string
          p_section_id: string
          p_source_session_id: string
        }
        Returns: Json
      }
      approve_scheduling_cohort_term_headcount: {
        Args: { p_id: string; p_notes?: string }
        Returns: Json
      }
      archive_scheduling_headcount_override: {
        Args: { p_id: string; p_notes?: string }
        Returns: Json
      }
      assert_delivery_group_assignable: {
        Args: { p_active: boolean; p_is_obsolete: boolean }
        Returns: undefined
      }
      begin_schedule_quality_snapshot: {
        Args: { p_college_id: string; p_schedule_version_id: string }
        Returns: Json
      }
      can_manage_college: {
        Args: { _college_id: string; _user_id: string }
        Returns: boolean
      }
      can_view_college: {
        Args: { _college_id: string; _user_id: string }
        Returns: boolean
      }
      claim_import_job_manifest: {
        Args: {
          p_college_id: string
          p_job_id: string
          p_mode: string
          p_target_entity: string
          p_validated_payload: Json
        }
        Returns: Json
      }
      clone_schedule_version_current: {
        Args: {
          p_college_id: string
          p_disposable_test?: boolean
          p_name: string
          p_notes?: string
          p_require_complete?: boolean
          p_source_version_id: string
          p_target_term_id: string
        }
        Returns: Json
      }
      commit_import_job_atomic: {
        Args: { p_expected_updated_at?: string; p_job_id: string }
        Returns: Json
      }
      commit_teaching_assignments_v2_import: {
        Args: { p_mode?: string; p_rows: Json }
        Returns: Json
      }
      complete_existing_intake_row: {
        Args: {
          p_allocations?: Json
          p_day: number
          p_end: string
          p_instructor?: string
          p_room: string
          p_source: string
          p_start: string
        }
        Returns: Json
      }
      complete_existing_schedule_source: {
        Args: {
          p_allocations?: Json
          p_day: number
          p_end: string
          p_room: string
          p_source: string
          p_start: string
        }
        Returns: Json
      }
      compute_delivery_group_allocation: {
        Args: { p_delivery_group_id: string }
        Returns: Json
      }
      compute_instructor_standard_workload: {
        Args: { p_instructor_id: string; p_term_id?: string }
        Returns: Json
      }
      consume_security_limit: {
        Args: { p_action: string; p_actor: string }
        Returns: boolean
      }
      create_import_preview_manifest: {
        Args: {
          p_college_id: string
          p_errors?: Json
          p_file_name: string
          p_mode: string
          p_target_entity: string
          p_total_rows: number
          p_validated_payload: Json
        }
        Returns: string
      }
      create_schedule_session_from_assignment_v2: {
        Args: {
          p_day_of_week: number
          p_end_time: string
          p_expected_version_updated_at: string
          p_note?: string
          p_room_id: string
          p_schedule_version_id: string
          p_start_time: string
          p_teaching_assignment_id: string
        }
        Returns: Json
      }
      create_teaching_assignment_v2: {
        Args: {
          p_assigned_component_hours?: number
          p_delivery_group_id: string
          p_instructor_id: string
          p_notes?: string
        }
        Returns: Json
      }
      deactivate_teaching_assignment_v2: {
        Args: {
          p_assignment_id: string
          p_expected_updated_at: string
          p_reason?: string
        }
        Returns: Json
      }
      decide_faculty_teaching_request: {
        Args: { p_decision: string; p_note?: string; p_request_id: string }
        Returns: Json
      }
      delivery_group_derivation_status: {
        Args: { p_group: string }
        Returns: Json
      }
      delivery_group_is_current: { Args: { p_group: string }; Returns: boolean }
      delivery_groups_share_students: {
        Args: { p_a: string; p_b: string }
        Returns: boolean
      }
      effective_instructor_weekly_quota: {
        Args: { p_admin_quota: number; p_base: number }
        Returns: number
      }
      effective_room_type_capacity: {
        Args: { p_college_id: string; p_room_type_id: string }
        Returns: number
      }
      enforce_initial_password_change: { Args: never; Returns: undefined }
      existing_schedule_intake_enabled: {
        Args: { p_college: string; p_term: string }
        Returns: boolean
      }
      existing_schedule_intake_version: {
        Args: { p_version: string }
        Returns: boolean
      }
      fail_import_job: {
        Args: { p_college_id: string; p_job_id: string; p_message: string }
        Returns: undefined
      }
      finalize_import_job: {
        Args: {
          p_college_id: string
          p_errors?: Json
          p_failed_rows: number
          p_inserted_rows: number
          p_job_id: string
          p_skipped_rows: number
          p_updated_rows: number
        }
        Returns: undefined
      }
      find_faculty_for_registration: {
        Args: {
          p_college_id: string
          p_employee_number?: string
          p_name: string
        }
        Returns: Json
      }
      generate_cohort_curriculum: {
        Args: { p_cohort_id: string }
        Returns: Json
      }
      generate_cohort_delivery_groups: {
        Args: { p_cohort_id: string }
        Returns: Json
      }
      get_college_faculty_roster: {
        Args: { p_college_id: string; p_scope?: string }
        Returns: Json
      }
      get_college_instructor_schedule_directory: {
        Args: { p_college_id: string }
        Returns: Json
      }
      get_delivery_group_assignment_candidates: {
        Args: { p_delivery_group_id: string }
        Returns: Json
      }
      get_faculty_home_profiles: {
        Args: { p_college_id?: string }
        Returns: Json
      }
      get_faculty_university_report: {
        Args: {
          p_instructor_id: string
          p_term_id: string
          p_version_ids?: string[]
        }
        Returns: Json
      }
      get_instructor_number_aliases: {
        Args: { p_instructor_ids: string[] }
        Returns: {
          instructor_id: string
          university_number: string
        }[]
      }
      get_instructor_university_numbers: {
        Args: { p_instructor_ids: string[] }
        Returns: {
          identity_id: string
          instructor_id: string
          university_number: string
        }[]
      }
      get_schedule_compaction_result: {
        Args: {
          p_college_id: string
          p_operation_id: string
          p_version_id: string
        }
        Returns: Json
      }
      get_schedule_external_busy: {
        Args: { p_college_id: string; p_version_id: string }
        Returns: {
          day_of_week: number
          end_time: string
          instructor_id: string
          start_time: string
        }[]
      }
      get_scheduling_headcount_import_context: {
        Args: { p_college_id: string }
        Returns: Json
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      import_existing_schedule_intake: {
        Args: { p_base_year?: number; p_version: string }
        Returns: Json
      }
      import_manager_actor: { Args: { p_college_id: string }; Returns: string }
      import_scheduling_headcounts: {
        Args: { p_action?: string; p_college_id: string; p_rows: Json }
        Returns: Json
      }
      instructor_availability_enforced: {
        Args: { p_college_id: string }
        Returns: boolean
      }
      is_academic_affairs_only: { Args: { _user_id: string }; Returns: boolean }
      is_assignment_room_compatible: {
        Args: {
          p_college_id: string
          p_room_id: string
          p_teaching_assignment_id: string
        }
        Returns: boolean
      }
      is_college_dean: { Args: { _user_id: string }; Returns: boolean }
      is_institutional_read_only_actor: {
        Args: { _user_id: string }
        Returns: boolean
      }
      is_institutional_viewer: { Args: { _user_id: string }; Returns: boolean }
      is_reports_only_viewer: { Args: { _user_id: string }; Returns: boolean }
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
      is_viewer_only: { Args: { _user_id: string }; Returns: boolean }
      issue_account_provisioning_grant: {
        Args: { p_created_by: string; p_email: string; p_role: string }
        Returns: {
          expires_at: string
          grant_id: string
          nonce: string
        }[]
      }
      issue_report_verification: {
        Args: { p_report_kind: string; p_version_id: string }
        Returns: string
      }
      leadership_metric_details: {
        Args: {
          p_academic_year?: string
          p_college_id?: string
          p_metric: string
          p_term_type?: string
        }
        Returns: Json
      }
      leadership_overview: {
        Args: { p_academic_year?: string; p_term_type?: string }
        Returns: Json
      }
      link_faculty_identity_with_evidence: {
        Args: {
          p_evidence: string
          p_instructor_id: string
          p_university_number: string
        }
        Returns: undefined
      }
      link_intake_shared_group: {
        Args: { p_anchor: string; p_college: string; p_member: string }
        Returns: boolean
      }
      link_verified_faculty_identity: {
        Args: { p_instructor_id: string; p_university_number: string }
        Returns: undefined
      }
      list_faculty_teaching_requests: {
        Args: { p_college_id: string }
        Returns: Json
      }
      list_schedule_builder_v2_work_items: {
        Args: {
          p_cohort_id?: string
          p_component_type?: string
          p_instructor_id?: string
          p_level_id?: string
          p_program_id?: string
          p_schedule_version_id: string
          p_scheduling_status?: string
          p_study_system?: string
        }
        Returns: Json
      }
      list_schedule_version_delivery_gaps: {
        Args: { p_college_id: string; p_schedule_version_id: string }
        Returns: {
          active_assignment_count: number
          cohort_code: string
          cohort_id: string
          component_type: string
          course_code: string
          course_name: string
          delivery_group_id: string
          expected_students: number
          group_code: string
          group_number: number
          instructor_names: string
          level_id: string
          level_name: string
          level_number: number
          missing_hours: number
          program_code: string
          program_id: string
          program_name: string
          required_hours: number
          scheduled_hours: number
          scheduling_state: string
          study_system: string
        }[]
      }
      list_scheduling_headcount_revisions: {
        Args: { p_headcount_id: string }
        Returns: Json
      }
      list_teaching_assignment_workspace: {
        Args: {
          p_assignment_status?: string
          p_cohort_id?: string
          p_college_id: string
          p_component_type?: string
          p_level_id?: string
          p_program_id?: string
          p_study_system?: string
          p_term_id?: string
        }
        Returns: Json
      }
      lock_delivery_group_for_assignment: {
        Args: { p_delivery_group_id: string }
        Returns: {
          active: boolean
          capacity_limit: number | null
          cohort_id: string
          college_id: string
          component_id: string
          created_at: string
          excluded_from_standard_workload: boolean
          expected_students: number | null
          group_code: string
          group_number: number | null
          id: string
          is_obsolete: boolean
          plan_course_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "delivery_groups"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      merge_shared_lecture: {
        Args: { p_anchor: string; p_member: string }
        Returns: Json
      }
      move_or_reschedule_schedule_session: {
        Args: {
          p_change_reason?: string
          p_expected_updated_at: string
          p_session_id: string
          p_target_day_of_week: number
          p_target_end_time: string
          p_target_room_id: string
          p_target_start_time: string
        }
        Returns: Json
      }
      operational_delivery_group: {
        Args: { p_group: string }
        Returns: {
          active: boolean
          capacity_limit: number | null
          cohort_id: string
          college_id: string
          component_id: string
          created_at: string
          excluded_from_standard_workload: boolean
          expected_students: number | null
          group_code: string
          group_number: number | null
          id: string
          is_obsolete: boolean
          plan_course_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "delivery_groups"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      password_change_required: { Args: never; Returns: boolean }
      persist_schedule_quality_run: {
        Args: {
          p_college_id: string
          p_expected_eligibility_revision: number
          p_hard_conflicts_count: number
          p_metrics_breakdown: Json
          p_schedule_version_id: string
          p_soft_conflicts_count: number
          p_total_deductions: number
          p_total_score: number
        }
        Returns: string
      }
      preview_instructor_workload_after_assignment: {
        Args: {
          p_assigned_component_hours?: number
          p_assignment_id?: string
          p_delivery_group_id: string
          p_instructor_id: string
        }
        Returns: Json
      }
      purge_all_academic_operational_data: { Args: never; Returns: Json }
      purge_disposable_draft_schedule_version: {
        Args: { p_version_id: string }
        Returns: Json
      }
      rebuild_cohort_student_partitions: {
        Args: { p_cohort_id: string }
        Returns: Json
      }
      reconcile_faculty_home: {
        Args: {
          p_evidence: string
          p_expected_decision_at?: string
          p_home_college_id: string
          p_identity_id: string
          p_quota_confirmed: boolean
          p_source_instructor_id: string
        }
        Returns: undefined
      }
      reconcile_obsolete_duplicate_assignments: {
        Args: { p_cohort_id: string }
        Returns: Json
      }
      record_audit_log: {
        Args: {
          p_action: string
          p_college_id?: string
          p_details?: Json
          p_entity: string
          p_entity_id?: string
        }
        Returns: string
      }
      register_instructor_faculty_identity: {
        Args: { p_instructor_id: string }
        Returns: undefined
      }
      resolve_compatibility_offering_set: {
        Args: { p_offerings: Json }
        Returns: Json
      }
      resolve_offering_for_delivery_group: {
        Args: { p_delivery_group_id: string }
        Returns: string
      }
      resolve_report_verification: {
        Args: { p_receipt_id: string }
        Returns: Json
      }
      resolve_scheduling_headcount: {
        Args: {
          p_cohort_id: string
          p_college_id: string
          p_course_offering_id?: string
          p_plan_course_component_id?: string
          p_term_id: string
        }
        Returns: Json
      }
      revoke_account_provisioning_grant: {
        Args: { p_grant_id: string }
        Returns: boolean
      }
      same_system_lecture_pair: {
        Args: { p_anchor: string; p_member: string }
        Returns: boolean
      }
      save_course_programs: {
        Args: {
          p_college_id: string
          p_course_id: string
          p_expected_updated_at: string
          p_is_shared: boolean
          p_nature: string
          p_program_ids: string[]
        }
        Returns: undefined
      }
      schedule_extended_counts_for_rows: {
        Args: { p_college: string; p_rows: Json }
        Returns: {
          days: number
          student_key: string
        }[]
      }
      schedule_extended_day_counts: {
        Args: {
          p_college: string
          p_extra?: Json
          p_omit?: string
          p_version: string
        }
        Returns: {
          days: number
          student_key: string
        }[]
      }
      schedule_version_delivery_coverage: {
        Args: { p_college_id: string; p_schedule_version_id: string }
        Returns: Json
      }
      schedule_version_is_published: {
        Args: { _version_id: string }
        Returns: boolean
      }
      schedule_version_room_type_capacity: {
        Args: { p_college_id: string; p_schedule_version_id: string }
        Returns: {
          active_rooms: number
          balance_hours: number
          daily_window_hours: number
          feasible: boolean
          required_group_hours: number
          room_type_code: string
          room_type_id: string
          room_type_name: string
          theoretical_available_hours: number
          working_days: number
        }[]
      }
      search_faculty_identity_candidates: {
        Args: { p_instructor_id: string; p_search: string }
        Returns: Json
      }
      security_access_status: { Args: never; Returns: Json }
      security_dashboard: { Args: never; Returns: Json }
      security_mfa_required: { Args: never; Returns: boolean }
      security_session_valid: { Args: never; Returns: boolean }
      seed_college_instructor_types: {
        Args: { p_college_id: string }
        Returns: number
      }
      set_schedule_coordination_version: {
        Args: { p_college_id: string; p_version_id: string }
        Returns: undefined
      }
      shared_lecture_candidates: { Args: { p_college: string }; Returns: Json }
      shared_lecture_catalog: { Args: { p_college: string }; Returns: Json }
      shared_lecture_group_ids: {
        Args: { p_group: string }
        Returns: {
          group_id: string
        }[]
      }
      shared_lecture_matches: {
        Args: { p_cohort?: string; p_group: string; p_system?: string }
        Returns: boolean
      }
      shared_lecture_time_allowed: {
        Args: {
          p_college: string
          p_day: number
          p_end: string
          p_start: string
        }
        Returns: boolean
      }
      sync_component_room_type_from_assignments: {
        Args: { p_component_id: string }
        Returns: Json
      }
      transition_schedule_version: {
        Args: {
          p_college_id: string
          p_expected_status: string
          p_notes?: string
          p_schedule_version_id: string
          p_target_status: string
        }
        Returns: Json
      }
      tutorial_required_room_type_id: {
        Args: { p_college: string }
        Returns: string
      }
      unmerge_shared_lecture: { Args: { p_member: string }; Returns: Json }
      update_home_college_instructor: {
        Args: {
          p_academic_rank: string
          p_administrative_department_id: string
          p_administrative_position: string
          p_administrative_release_hours: number
          p_administrative_support_department_id: string
          p_affiliation_college_id: string
          p_affiliation_department_id: string
          p_college_id: string
          p_email: string
          p_employee_number: string
          p_employment_type: string
          p_expected_updated_at: string
          p_full_name: string
          p_full_name_ar: string
          p_instructor_id: string
          p_instructor_type_id: string
          p_is_active: boolean
          p_max_weekly_hours: number
          p_phone: string
          p_specialization: string
        }
        Returns: {
          academic_degree: string | null
          academic_rank: string | null
          admin_tasks: string | null
          administrative_department_id: string | null
          administrative_position: string | null
          administrative_release_hours: number
          administrative_support_department_id: string | null
          affiliation_college_id: string | null
          affiliation_department_id: string | null
          college_id: string
          created_at: string
          department_id: string | null
          email: string | null
          employee_number: string | null
          employment_type: string
          external_source: string | null
          full_name: string
          full_name_ar: string | null
          full_name_en: string | null
          id: string
          instructor_type_id: string | null
          is_active: boolean
          max_attendance_days_per_week: number | null
          max_hours_per_day: number | null
          max_weekly_hours: number | null
          notes: string | null
          phone: string | null
          specialization: string | null
          target_attendance_days_per_week: number | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "instructors"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_teaching_assignment_v2: {
        Args: {
          p_assigned_component_hours?: number
          p_assignment_id: string
          p_expected_updated_at: string
          p_notes?: string
        }
        Returns: Json
      }
      upsert_instructor_unavailability_for_active_days: {
        Args: {
          p_day_of_week?: number
          p_end_time: string
          p_instructor_id: string
          p_notes?: string
          p_start_time: string
        }
        Returns: Json
      }
      upsert_room_unavailability_for_active_days: {
        Args: {
          p_day_of_week?: number
          p_end_date?: string
          p_end_time: string
          p_reason?: string
          p_room_id: string
          p_start_date?: string
          p_start_time: string
        }
        Returns: Json
      }
      upsert_scheduling_cohort_term_headcount: {
        Args: {
          p_allow_over_eligible?: boolean
          p_cohort_id: string
          p_eligible_student_count: number
          p_exam_eligible_count?: number
          p_expected_attendance_count: number
          p_notes?: string
          p_registered_student_count: number
          p_reserve_margin?: number
          p_scheduling_headcount?: number
          p_source?: string
          p_term_id: string
        }
        Returns: Json
      }
      upsert_scheduling_headcount_override: {
        Args: {
          p_allow_over_eligible?: boolean
          p_course_offering_id?: string
          p_exam_eligible_count?: number
          p_headcount_id: string
          p_notes?: string
          p_plan_course_component_id?: string
          p_reserve_margin?: number
          p_scheduling_headcount?: number
          p_source?: string
        }
        Returns: Json
      }
      user_in_college: {
        Args: { _college_id: string; _user_id: string }
        Returns: boolean
      }
      valid_schedule_instructor_limits: {
        Args: { p_limits: Json }
        Returns: boolean
      }
      validate_assignment_allocation_locked: {
        Args: {
          p_component_hours: number
          p_delivery_group_id: string
          p_exclude_assignment_id: string
          p_include_new_row?: boolean
          p_new_hours: number
        }
        Returns: undefined
      }
      validate_schedule_session_move: {
        Args: {
          p_expected_updated_at: string
          p_session_id: string
          p_target_day_of_week: number
          p_target_end_time: string
          p_target_room_id: string
          p_target_start_time: string
        }
        Returns: Json
      }
    }
    Enums: {
      app_role:
        | "super_admin"
        | "college_admin"
        | "read_only"
        | "institutional_viewer"
        | "university_leadership"
        | "college_dean"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "super_admin",
        "college_admin",
        "read_only",
        "institutional_viewer",
        "university_leadership",
        "college_dean",
      ],
    },
  },
} as const
