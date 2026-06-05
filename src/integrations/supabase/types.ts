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
          code: string
          college_id: string
          created_at: string
          degree_type: string
          department_id: string
          duration_years: number
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          code: string
          college_id: string
          created_at?: string
          degree_type?: string
          department_id: string
          duration_years?: number
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          code?: string
          college_id?: string
          created_at?: string
          degree_type?: string
          department_id?: string
          duration_years?: number
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
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
        Relationships: []
      }
      course_offerings: {
        Row: {
          college_id: string
          course_id: string
          created_at: string
          expected_students: number
          id: string
          is_active: boolean
          level_id: string | null
          notes: string | null
          plan_course_id: string | null
          program_id: string | null
          sections_count: number
          status: string
          study_plan_id: string | null
          term_id: string
          updated_at: string
        }
        Insert: {
          college_id: string
          course_id: string
          created_at?: string
          expected_students?: number
          id?: string
          is_active?: boolean
          level_id?: string | null
          notes?: string | null
          plan_course_id?: string | null
          program_id?: string | null
          sections_count?: number
          status?: string
          study_plan_id?: string | null
          term_id: string
          updated_at?: string
        }
        Update: {
          college_id?: string
          course_id?: string
          created_at?: string
          expected_students?: number
          id?: string
          is_active?: boolean
          level_id?: string | null
          notes?: string | null
          plan_course_id?: string | null
          program_id?: string | null
          sections_count?: number
          status?: string
          study_plan_id?: string | null
          term_id?: string
          updated_at?: string
        }
        Relationships: []
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
          credit_hours: number
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
          credit_hours?: number
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
          credit_hours?: number
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
      departments: {
        Row: {
          code: string
          college_id: string
          created_at: string
          id: string
          name: string
          study_system: string
          updated_at: string
        }
        Insert: {
          code: string
          college_id: string
          created_at?: string
          id?: string
          name: string
          study_system?: string
          updated_at?: string
        }
        Update: {
          code?: string
          college_id?: string
          created_at?: string
          id?: string
          name?: string
          study_system?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "departments_college_id_fkey"
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
          college_id: string
          created_at: string
          created_by: string | null
          file_name: string | null
          id: string
          inserted_rows: number
          invalid_rows: number
          mode: string
          notes: string | null
          skipped_rows: number
          status: string
          target_entity: string
          total_rows: number
          updated_at: string
          updated_rows: number
          valid_rows: number
        }
        Insert: {
          college_id: string
          created_at?: string
          created_by?: string | null
          file_name?: string | null
          id?: string
          inserted_rows?: number
          invalid_rows?: number
          mode?: string
          notes?: string | null
          skipped_rows?: number
          status?: string
          target_entity: string
          total_rows?: number
          updated_at?: string
          updated_rows?: number
          valid_rows?: number
        }
        Update: {
          college_id?: string
          created_at?: string
          created_by?: string | null
          file_name?: string | null
          id?: string
          inserted_rows?: number
          invalid_rows?: number
          mode?: string
          notes?: string | null
          skipped_rows?: number
          status?: string
          target_entity?: string
          total_rows?: number
          updated_at?: string
          updated_rows?: number
          valid_rows?: number
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
          administrative_release_hours: number
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
          max_hours_per_day: number | null
          max_weekly_hours: number
          notes: string | null
          phone: string | null
          specialization: string | null
          updated_at: string
        }
        Insert: {
          academic_degree?: string | null
          academic_rank?: string | null
          admin_tasks?: string | null
          administrative_release_hours?: number
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
          max_hours_per_day?: number | null
          max_weekly_hours?: number
          notes?: string | null
          phone?: string | null
          specialization?: string | null
          updated_at?: string
        }
        Update: {
          academic_degree?: string | null
          academic_rank?: string | null
          admin_tasks?: string | null
          administrative_release_hours?: number
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
          max_hours_per_day?: number | null
          max_weekly_hours?: number
          notes?: string | null
          phone?: string | null
          specialization?: string | null
          updated_at?: string
        }
        Relationships: []
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
        Relationships: []
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
        Relationships: []
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
          id: string
          max_daily_hours_per_instructor: number
          max_daily_hours_per_section: number
          max_session_hours: number
          min_session_hours: number
          notes: string | null
          slot_minutes: number
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
          id?: string
          max_daily_hours_per_instructor?: number
          max_daily_hours_per_section?: number
          max_session_hours?: number
          min_session_hours?: number
          notes?: string | null
          slot_minutes?: number
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
          id?: string
          max_daily_hours_per_instructor?: number
          max_daily_hours_per_section?: number
          max_session_hours?: number
          min_session_hours?: number
          notes?: string | null
          slot_minutes?: number
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
      sections: {
        Row: {
          capacity: number
          college_id: string
          course_id: string
          created_at: string
          id: string
          section_number: string
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
      teaching_assignments: {
        Row: {
          college_id: string
          course_offering_id: string
          created_at: string
          expected_students: number
          id: string
          instructor_id: string
          notes: string | null
          required_room_type: string | null
          section_id: string | null
          section_number: string | null
          session_type: string
          updated_at: string
          weekly_hours: number
        }
        Insert: {
          college_id: string
          course_offering_id: string
          created_at?: string
          expected_students?: number
          id?: string
          instructor_id: string
          notes?: string | null
          required_room_type?: string | null
          section_id?: string | null
          section_number?: string | null
          session_type?: string
          updated_at?: string
          weekly_hours?: number
        }
        Update: {
          college_id?: string
          course_offering_id?: string
          created_at?: string
          expected_students?: number
          id?: string
          instructor_id?: string
          notes?: string | null
          required_room_type?: string | null
          section_id?: string | null
          section_number?: string | null
          session_type?: string
          updated_at?: string
          weekly_hours?: number
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
      [_ in never]: never
    }
    Functions: {
      can_manage_college: {
        Args: { _college_id: string; _user_id: string }
        Returns: boolean
      }
      can_view_college: {
        Args: { _college_id: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
      user_in_college: {
        Args: { _college_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "super_admin" | "college_admin" | "read_only"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      app_role: ["super_admin", "college_admin", "read_only"],
    },
  },
} as const
