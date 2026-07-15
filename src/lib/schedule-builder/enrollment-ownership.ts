/**
 * Enrollment ownership: validate + narrow update of course_offerings trust fields.
 * Numeric store: expected_students. Trust: enrollment_count_status (+ updated_at).
 * Writes only those three columns — never a broad offering patch.
 */
import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/lib/audit";
import {
  ENROLLMENT_COUNT_STATUSES,
  normalizeEnrollmentCountStatus,
  type EnrollmentCountStatus,
} from "@/lib/schedule-builder/enrollment-trust";

/** UI gate: read_only must not see edit actions (RLS still enforces writes). */
export function canEditEnrollmentOwnership(canManageCollege: boolean): boolean {
  return canManageCollege === true;
}

export type EnrollmentOwnershipDraft = {
  enrollmentCount: number | null;
  enrollmentCountStatus: EnrollmentCountStatus;
};

export type EnrollmentOwnershipValidation =
  | { ok: true; count: number; status: EnrollmentCountStatus }
  | { ok: false; reasonAr: string };

export function validateEnrollmentOwnershipDraft(
  draft: EnrollmentOwnershipDraft,
): EnrollmentOwnershipValidation {
  const status = normalizeEnrollmentCountStatus(draft.enrollmentCountStatus);
  if (!ENROLLMENT_COUNT_STATUSES.includes(status)) {
    return { ok: false, reasonAr: "حالة الموثوقية غير صالحة." };
  }

  if (status === "confirmed") {
    if (draft.enrollmentCount == null || !Number.isInteger(draft.enrollmentCount)) {
      return { ok: false, reasonAr: "العدد المؤكد يجب أن يكون عددًا صحيحًا." };
    }
    if (draft.enrollmentCount < 0) {
      return { ok: false, reasonAr: "لا يُسمح بعدد طلاب سالب." };
    }
    return { ok: true, count: draft.enrollmentCount, status };
  }

  // estimated / unverified / test — count optional for unverified; if present must be valid
  if (draft.enrollmentCount == null) {
    if (status === "estimated") {
      return { ok: false, reasonAr: "العدد التقديري مطلوب." };
    }
    return { ok: true, count: 0, status };
  }
  if (!Number.isInteger(draft.enrollmentCount) || draft.enrollmentCount < 0) {
    return { ok: false, reasonAr: "عدد الطلاب يجب أن يكون عددًا صحيحًا غير سالب." };
  }
  return { ok: true, count: draft.enrollmentCount, status };
}

export type SaveEnrollmentOwnershipResult =
  | { ok: true; updatedAt: string }
  | { ok: false; reasonAr: string };

/**
 * Narrow update: expected_students + enrollment_count_status + enrollment_count_updated_at.
 * Relies on co_update RLS (can_manage_college). Does not touch other offering columns.
 */
export async function saveEnrollmentOwnership(params: {
  collegeId: string;
  courseOfferingId: string;
  draft: EnrollmentOwnershipDraft;
}): Promise<SaveEnrollmentOwnershipResult> {
  const validated = validateEnrollmentOwnershipDraft(params.draft);
  if (!validated.ok) return { ok: false, reasonAr: validated.reasonAr };

  const updatedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("course_offerings")
    .update({
      expected_students: validated.count,
      enrollment_count_status: validated.status,
      enrollment_count_updated_at: updatedAt,
    })
    .eq("id", params.courseOfferingId)
    .eq("college_id", params.collegeId)
    .select("id")
    .maybeSingle();

  if (error) {
    return { ok: false, reasonAr: error.message || "تعذّر حفظ عدد الطلاب." };
  }
  if (!data?.id) {
    return {
      ok: false,
      reasonAr: "تعذّر الحفظ: العرض غير موجود أو خارج صلاحية الكلية.",
    };
  }

  await logAudit({
    action: "enrollment_ownership_update",
    entity: "course_offerings",
    entityId: params.courseOfferingId,
    collegeId: params.collegeId,
    details: {
      expected_students: validated.count,
      enrollment_count_status: validated.status,
      enrollment_count_updated_at: updatedAt,
    },
  });

  return { ok: true, updatedAt };
}
