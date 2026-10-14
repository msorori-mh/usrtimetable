import type { RoleFlags } from "@/lib/viewer-roles";

export const DRAFT_PRINT_ADMIN_ONLY_AR = "طباعة الجداول غير المنشورة متاحة للأدمن العام فقط.";
export const DRAFT_PRINT_NOTICE_AR = "مسودة غير منشورة — نسخة للمراجعة وليست جدولًا معتمدًا.";

export function canPrintUnpublishedTimetable(me: RoleFlags | null | undefined): boolean {
  return me?.isSuperAdmin === true;
}

export function canPrintTimetableVersion(
  status: string | null | undefined,
  me: RoleFlags | null | undefined,
): boolean {
  if (!me || !status) return false;
  return status === "published" || canPrintUnpublishedTimetable(me);
}

/** Draft labels must survive individual and mixed-college print layouts. */
export function timetablePrintNotice(statuses: readonly string[]): string | undefined {
  return statuses.some((status) => status !== "published") ? DRAFT_PRINT_NOTICE_AR : undefined;
}
