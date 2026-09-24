import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export interface FacultyRosterRecord {
  id: string;
  college_id: string;
  department_id: string | null;
  full_name: string;
  academic_rank: string | null;
  email: string | null;
  phone: string | null;
  employment_type: string;
  max_weekly_hours: number;
  is_active: boolean;
  availability_status: string;
  employee_number: string | null;
  university_number: string;
  full_name_ar: string | null;
  full_name_en: string | null;
  specialization: string | null;
  administrative_release_hours: number;
  notes: string | null;
  admin_tasks: string | null;
  instructor_type_id: string | null;
  affiliation_college_id: string | null;
  affiliation_department_id: string | null;
  administrative_position: string | null;
  administrative_department_id: string | null;
  administrative_support_department_id: string | null;
  identity_id: string;
  home_college_id: string | null;
  home_college_name: string | null;
  home_department: string | null;
  instructor_type_code: string | null;
  type_name: string | null;
  authoritative_quota: number | null;
  updated_at: string;
  can_edit: boolean;
  can_delete: boolean;
}

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
  recorded_quota: number | null;
  recorded_release: number | null;
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
      search_faculty_identity_candidates: {
        Args: { p_instructor_id: string; p_search: string };
        Returns: {
          id: string;
          full_name: string;
          university_number: string;
          home_college: string | null;
          specialization: string | null;
          employee_number: string | null;
        }[];
      };
      get_college_faculty_roster: {
        Args: { p_college_id: string; p_scope: "home" | "visiting" | "pending" };
        Returns: FacultyRosterRecord[];
      };
      update_home_college_instructor: {
        Args: {
          p_college_id: string;
          p_expected_updated_at: string;
          p_instructor_id: string;
          p_full_name: string;
          p_full_name_ar: string | null;
          p_employee_number: string | null;
          p_specialization: string | null;
          p_academic_rank: string | null;
          p_email: string | null;
          p_phone: string | null;
          p_employment_type: string;
          p_max_weekly_hours: number;
          p_administrative_release_hours: number;
          p_is_active: boolean;
          p_instructor_type_id: string | null;
          p_affiliation_college_id: string;
          p_affiliation_department_id: string;
          p_administrative_position: string | null;
          p_administrative_department_id: string | null;
          p_administrative_support_department_id: string | null;
          p_availability_status: string;
        };
        Returns: unknown;
      };

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

/** Server rule (reconcile_faculty_home): btrim(evidence) must be ≥ 10 characters. */
export const RECONCILE_EVIDENCE_MIN = 10;

/** Arabic reason the reconcile button is disabled, or null when submission is allowed. */
export function reconcileBlockReason(input: {
  canReconcile: boolean;
  busy: boolean;
  home: string;
  source: string;
  sourceIds: readonly string[];
  evidence: string;
}): string | null {
  if (!input.canReconcile) return "لا توجد صلاحية لتسوية التبعية (مدير النظام فقط).";
  if (input.busy) return "جارٍ حفظ التسوية…";
  if (!input.home.trim()) return "اختر الكلية الأصلية.";
  if (!input.source.trim() || !input.sourceIds.includes(input.source))
    return "اختر مصدر بيانات المحاضر والنصاب.";
  const len = input.evidence.trim().length;
  if (len < RECONCILE_EVIDENCE_MIN)
    return `أدخل مرجع تحقق واضحًا لا يقل عن ${RECONCILE_EVIDENCE_MIN} أحرف (الحالي ${len}).`;
  return null;
}

const RECONCILE_ERRORS: Record<string, string> = {
  insufficient_privilege: "لا توجد صلاحية لتسوية التبعية.",
  FACULTY_IDENTITY_NOT_FOUND: "هوية المحاضر غير موجودة.",
  STALE_FACULTY_DECISION: "تغيّرت بيانات التسوية منذ فتح النافذة؛ أعد تحميل الصفحة ثم حاول مجددًا.",
  FACULTY_EVIDENCE_REQUIRED: `مرجع التحقق مطلوب ولا يقل عن ${RECONCILE_EVIDENCE_MIN} أحرف.`,
  FACULTY_HOME_OR_SOURCE_INVALID: "الكلية الأصلية أو سجل المصدر لا يتبع هذه الهوية.",
  FACULTY_HOME_REQUIRED_FOR_QUOTA: "اعتماد النصاب يتطلب تحديد الكلية الأصلية.",
  FACULTY_QUOTA_REQUIRED: "لا يمكن تأكيد النصاب لأن سجل المصدر بلا نصاب مسجّل.",
};

export function reconcileErrorMessage(message: string | null | undefined): string {
  const m = message ?? "";
  const key = Object.keys(RECONCILE_ERRORS).find((k) => m.includes(k));
  return key ? RECONCILE_ERRORS[key] : `تعذّر حفظ التسوية: ${m || "خطأ غير معروف"}`;
}
