/**
 * A2.3: Shared lecture groups — display rules (pure, no DB).
 *
 * Maps the A2.1/A2.2 fail-closed RPC codes to clear Arabic messages, and the
 * status lifecycle labels/edges to UI labels. No numbers are computed here —
 * capacity stays RPC-resolved (fail-closed, never guessed).
 */
import type { SharedGroupRevisionKind, SharedGroupStatus } from "./types";

export const SHARED_GROUP_STATUS_LABELS: Record<SharedGroupStatus, string> = {
  draft: "مسودة",
  active: "نشطة",
  locked: "مقفلة",
  archived: "مؤرشفة",
};

/** Allowed lifecycle edges per A2.2 (no rollback; archive allowed from any). */
export const SHARED_GROUP_ALLOWED_TRANSITIONS: Record<SharedGroupStatus, SharedGroupStatus[]> = {
  draft: ["active", "archived"],
  active: ["locked", "archived"],
  locked: ["archived"],
  archived: [],
};

export const SHARED_GROUP_TRANSITION_ACTION_LABELS: Record<SharedGroupStatus, string> = {
  draft: "إعادة إلى مسودة",
  active: "تفعيل",
  locked: "قفل",
  archived: "أرشفة",
};

export const SHARED_GROUP_REVISION_KIND_LABELS: Record<SharedGroupRevisionKind, string> = {
  create: "إنشاء المجموعة",
  add_component: "إضافة مكوّن",
  remove_component: "إزالة مكوّن",
  add_cohort: "إضافة دفعة",
  remove_cohort: "إزالة دفعة",
  status_transition: "انتقال الحالة",
  add_cross_college_cohort: "إضافة دفعة عبر الكليات",
  remove_cross_college_cohort: "إزالة دفعة عبر الكليات",
};

/**
 * Arabic messages for every fail-closed code returned by the A2.1/A2.2 RPCs.
 * Unknown codes fall back to the server message (see sharedGroupErrorMessage).
 */
export const SHARED_GROUP_ERROR_MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: "يلزم تسجيل الدخول.",
  FORBIDDEN: "لا تملك صلاحية إدارة/عرض كلية هذه المجموعة.",
  NOT_FOUND: "المجموعة المشتركة غير موجودة.",
  TERM_NOT_FOUND: "الفصل الدراسي يجب أن يتبع الكلية.",
  NAME_REQUIRED: "اسم المجموعة مطلوب.",
  GROUP_LOCKED: "المجموعة مقفلة — لا يمكن تعديل المكوّنات أو الدفعات المشاركة.",
  GROUP_ARCHIVED: "المجموعة مؤرشفة — لا يمكن تعديلها.",
  INVALID_STATUS: "الحالة الهدف غير صالحة.",
  INVALID_STATUS_TRANSITION: "هذا الانتقال غير مسموح في دورة الحالة (مسودة ← نشطة ← مقفلة ← مؤرشفة).",
  SHARED_GROUP_NO_COMPONENTS: "التفعيل مرفوض — لا توجد مكوّنات مرتبطة بالمجموعة.",
  SHARED_GROUP_NO_COHORTS: "التفعيل مرفوض — لا توجد دفعات دراسية مشاركة في المجموعة.",
  SHARED_GROUP_HEADCOUNT_MISSING:
    "يلزم وجود عدد معتمد ضمن أعداد الدفعات المعتمدة للجدولة لكل دفعة مشاركة قبل المتابعة.",
  COMPONENT_NOT_FOUND: "مكوّن المقرر غير موجود.",
  COMPONENT_ALREADY_LINKED: "هذا المكوّن مرتبط بالفعل بهذه المجموعة.",
  COMPONENT_LINK_NOT_FOUND: "هذا المكوّن غير مرتبط بهذه المجموعة.",
  COLLEGE_MISMATCH: "المكوّن يجب أن يتبع كلية المجموعة نفسها.",
  SHARED_GROUP_COMPONENT_IN_USE:
    "توجد جلسات مجدولة تشير إلى هذا المكوّن في الكلية — إزالة الربط مرفوضة (فشل مغلق).",
  SHARED_GROUP_COMPONENT_UNLINK_BLOCKED:
    "لا يمكن إزالة المكوّنات بعد خروج المجموعة من المسودة — أرشف المجموعة بدلًا من ذلك.",
  COHORT_NOT_FOUND: "الدفعة الدراسية غير موجودة.",
  COHORT_ALREADY_LINKED: "هذه الدفعة مشاركة بالفعل في المجموعة.",
  COHORT_TERM_MISMATCH: "الدفعة يجب أن تتبع فصل المجموعة الدراسي نفسه.",
  MEMBERSHIP_NOT_FOUND: "هذه الدفعة غير مشاركة في المجموعة.",
  STUDY_SYSTEM_MIX_REJECTED:
    "لا تُدمج الدفعات الدراسية ذات الأنظمة الدراسية المختلفة (منتظم/موازي) في مجموعة مشتركة واحدة افتراضيًا.",
  CROSS_COLLEGE_REQUIRES_SUPER_ADMIN: "المجموعات المشتركة عبر الكليات تتطلب صلاحية مدير المؤسسة.",
  CROSS_COLLEGE_USE_SUPER_ADMIN_PATH:
    "استخدم مسار مدير المؤسسة المخصص لإضافة دفعة من كلية أخرى.",
  USE_SAME_COLLEGE_PATH: "الدفعة تتبع كلية المجموعة — استخدم مسار الإضافة العادي.",
};

export function sharedGroupErrorMessage(result: {
  code?: string;
  message?: string;
}): string {
  const code = result.code ?? "";
  const mapped = SHARED_GROUP_ERROR_MESSAGES[code];
  if (mapped) return code ? `${mapped} (${code})` : mapped;
  return result.message ?? "حدث خطأ غير معروف.";
}
