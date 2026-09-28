import { supabase } from "@/integrations/supabase/client";

export type InstructorWindowKind =
  | "hard_available"
  | "hard_unavailable"
  | "preferred_available"
  | "preferred_unavailable";

export type InstructorSchedulingRequestKind =
  | InstructorWindowKind
  | "daily_limit"
  | "attendance_days";

export type InstructorSchedulingRequestStatus = "submitted" | "approved" | "rejected" | "cancelled";

export interface InstructorAvailabilityReadiness {
  college_id: string;
  enabled: boolean;
  active_instructors: number;
  required_instructors: number;
  missing_required_instructors: number;
  hard_windows: number;
  preference_windows: number;
  pending_requests: number;
  can_activate: boolean;
}

export interface InstructorSchedulingRequest {
  id: string;
  instructor_id: string;
  instructor_name: string;
  request_kind: InstructorSchedulingRequestKind;
  day_of_week: number | null;
  start_time: string | null;
  end_time: string | null;
  max_hours_per_day: number | null;
  target_attendance_days: number | null;
  max_attendance_days: number | null;
  reason: string;
  status: InstructorSchedulingRequestStatus;
  review_note: string | null;
  created_at: string;
  reviewed_at: string | null;
}

type RpcResult = { data: unknown; error: { message: string; details?: string | null } | null };
type PolicyRpcClient = {
  rpc: (name: string, args?: Record<string, unknown>) => Promise<RpcResult>;
};

const client = supabase as unknown as PolicyRpcClient;

function policyError(error: RpcResult["error"]): Error {
  const message = [error?.message, error?.details].filter(Boolean).join(" · ");
  if (message.includes("AVAILABILITY_NOT_READY")) {
    return new Error("لا يمكن تفعيل القيد قبل تحديد نوافذ التوفر الصريحة للمحاضرين الخارجيين.");
  }
  if (message.includes("REQUEST_REASON_REQUIRED")) {
    return new Error("اكتب سبب الطلب بوضوح (ثلاثة أحرف على الأقل).");
  }
  if (message.includes("REQUEST_REVIEW_NOTE_REQUIRED")) {
    return new Error("ملاحظة الاعتماد أو الرفض مطلوبة.");
  }
  if (message.includes("duplicate") || message.includes("unique")) {
    return new Error("يوجد طلب مطابق قيد المراجعة بالفعل.");
  }
  return new Error(message || "تعذر تنفيذ عملية سياسة الجدولة.");
}

export async function fetchInstructorAvailabilityReadiness(
  collegeId: string,
): Promise<InstructorAvailabilityReadiness> {
  const { data, error } = await client.rpc("get_instructor_availability_readiness", {
    p_college_id: collegeId,
  });
  if (error) throw policyError(error);
  return data as InstructorAvailabilityReadiness;
}

export async function setInstructorAvailabilityEnforcement(
  collegeId: string,
  enabled: boolean,
): Promise<void> {
  const { error } = await client.rpc("set_instructor_availability_enforcement", {
    p_college_id: collegeId,
    p_enabled: enabled,
  });
  if (error) throw policyError(error);
}

export async function upsertInstructorAvailabilityWindows(input: {
  collegeId: string;
  instructorId: string;
  windowKind: InstructorWindowKind;
  dayOfWeek: number | null;
  startTime: string;
  endTime: string;
  notes?: string | null;
}): Promise<{ days_targeted: number; days_created: number; days_unchanged: number }> {
  const { data, error } = await client.rpc("upsert_instructor_availability_windows", {
    p_college_id: input.collegeId,
    p_instructor_id: input.instructorId,
    p_window_kind: input.windowKind,
    p_day_of_week: input.dayOfWeek,
    p_start_time: input.startTime,
    p_end_time: input.endTime,
    p_notes: input.notes ?? null,
  });
  if (error) throw policyError(error);
  return data as { days_targeted: number; days_created: number; days_unchanged: number };
}

export async function listInstructorSchedulingRequests(
  collegeId: string,
): Promise<InstructorSchedulingRequest[]> {
  const { data, error } = await client.rpc("list_instructor_scheduling_requests", {
    p_college_id: collegeId,
  });
  if (error) throw policyError(error);
  return Array.isArray(data) ? (data as InstructorSchedulingRequest[]) : [];
}

export async function createInstructorSchedulingRequest(input: {
  collegeId: string;
  instructorId: string;
  requestKind: InstructorSchedulingRequestKind;
  dayOfWeek?: number | null;
  startTime?: string | null;
  endTime?: string | null;
  maxHoursPerDay?: number | null;
  targetAttendanceDays?: number | null;
  maxAttendanceDays?: number | null;
  reason: string;
}): Promise<void> {
  const { error } = await client.rpc("create_instructor_scheduling_request", {
    p_college_id: input.collegeId,
    p_instructor_id: input.instructorId,
    p_request_kind: input.requestKind,
    p_day_of_week: input.dayOfWeek ?? null,
    p_start_time: input.startTime ?? null,
    p_end_time: input.endTime ?? null,
    p_max_hours_per_day: input.maxHoursPerDay ?? null,
    p_target_attendance_days: input.targetAttendanceDays ?? null,
    p_max_attendance_days: input.maxAttendanceDays ?? null,
    p_reason: input.reason,
  });
  if (error) throw policyError(error);
}

export async function reviewInstructorSchedulingRequest(input: {
  requestId: string;
  decision: "approved" | "rejected" | "cancelled";
  reviewNote: string;
}): Promise<void> {
  const { error } = await client.rpc("review_instructor_scheduling_request", {
    p_request_id: input.requestId,
    p_decision: input.decision,
    p_review_note: input.reviewNote,
  });
  if (error) throw policyError(error);
}

export const INSTRUCTOR_WINDOW_KIND_LABEL_AR: Record<InstructorWindowKind, string> = {
  hard_available: "متاح — إلزامي",
  hard_unavailable: "غير متاح — إلزامي",
  preferred_available: "وقت مفضل",
  preferred_unavailable: "وقت غير مفضل",
};

export const INSTRUCTOR_REQUEST_KIND_LABEL_AR: Record<InstructorSchedulingRequestKind, string> = {
  ...INSTRUCTOR_WINDOW_KIND_LABEL_AR,
  daily_limit: "سقف الساعات اليومية",
  attendance_days: "أيام الحضور الأسبوعية",
};

export const INSTRUCTOR_REQUEST_STATUS_LABEL_AR: Record<InstructorSchedulingRequestStatus, string> =
  {
    submitted: "قيد المراجعة",
    approved: "معتمد",
    rejected: "مرفوض",
    cancelled: "ملغى",
  };
