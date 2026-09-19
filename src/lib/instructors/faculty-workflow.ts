import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type CollegeScheduleInstructor = {
  id: string;
  identity_id: string;
  record_ids: string[];
  university_number: string;
  full_name: string;
  college_id: string;
  home_college_id: string | null;
  home_college_name: string | null;
  instructor_type_code: string | null;
  employment_type: string;
  authoritative_quota: number | null;
};

export type FacultyHome = {
  identity_id: string;
  university_number: string;
  name: string;
  home_college_id: string | null;
  home_college: string | null;
  source_instructor_id: string | null;
  status: "pending" | "declared" | "verified";
  quota: number | null;
  decision_at: string | null;
  academic_rank: string | null;
  is_active: boolean;
  specialization: string | null;
  employment_type: string;
  home_department: string | null;
  category: string | null;
  members: {
    id: string;
    name: string;
    college_id: string;
    college: string;
    recorded_quota: number | null;
    recorded_release: number | null;
  }[];
};
export type FacultyRequest = {
  id: string;
  name: string;
  university_number: string;
  home_college: string;
  college: string;
  home_college_id: string;
  college_id: string;
  group: string;
  hours: number;
  term: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  notes: string | null;
  created_at: string;
  decision_note: string | null;
  is_update: boolean;
  can_decide: boolean;
  can_cancel: boolean;
};
type Api = {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
    Functions: {
      get_college_instructor_schedule_directory: {
        Args: { p_college_id: string };
        Returns: CollegeScheduleInstructor[];
      };
      find_faculty_for_registration: {
        Args: { p_college_id: string; p_name: string; p_employee_number: string | null };
        Returns: { university_number: string; name: string; home_college: string | null }[];
      };
      get_faculty_home_profiles: {
        Args: { p_college_id: string | null };
        Returns: FacultyHome[];
      };
      reconcile_faculty_home: {
        Args: {
          p_identity_id: string;
          p_home_college_id: string;
          p_source_instructor_id: string;
          p_quota_confirmed: boolean;
          p_evidence: string;
          p_expected_decision_at: string | null;
        };
        Returns: undefined;
      };
      list_faculty_teaching_requests: {
        Args: { p_college_id: string };
        Returns: FacultyRequest[];
      };
      decide_faculty_teaching_request: {
        Args: { p_request_id: string; p_decision: string; p_note: string };
        Returns: unknown;
      };
    };
  };
};
export const facultyWorkflow = supabase as unknown as SupabaseClient<Api>;
export const facultyStatusLabel = {
  pending: "تبعية تحتاج مراجعة",
  declared: "التبعية المسجلة",
  verified: "تمت تسوية التبعية",
};
export const requestStatusLabel = {
  pending: "بانتظار اعتماد الكلية الأصلية",
  approved: "معتمد",
  rejected: "مرفوض",
  cancelled: "ملغى",
};
