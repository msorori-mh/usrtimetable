/**
 * Client-side guards for course offering delete (UI).
 * DB FK ON DELETE RESTRICT on TA / COS / sessions remains authoritative.
 */

export const OFFERING_IN_USE_DELETE_MESSAGE =
  "لا يمكن حذف عرض المقرر لأنه مرتبط بتكليفات تدريس أو شعب أو جلسات دراسية.";

export const OFFERING_IN_USE_HINT =
  "احذف التكليفات وروابط الشعب والجلسات المرتبطة أولًا، أو عطّل العرض بدل حذفه.";

export type OfferingDependencyUsage = {
  offeringId: string;
  teachingAssignmentCount: number;
  courseOfferingSectionCount: number;
  scheduleSessionCount: number;
};

export function offeringDependencyTotal(u: OfferingDependencyUsage): number {
  return u.teachingAssignmentCount + u.courseOfferingSectionCount + u.scheduleSessionCount;
}

export function isOfferingInUse(u: OfferingDependencyUsage): boolean {
  return offeringDependencyTotal(u) > 0;
}

export function isOfferingInUseDeleteError(message: string): boolean {
  const msg = message ?? "";
  return (
    msg.includes("OFFERING_IN_USE") ||
    msg.includes("teaching_assignments_course_offering_id_fkey") ||
    msg.includes("course_offering_sections_course_offering_id_fkey") ||
    msg.includes("schedule_sessions_course_offering_id_fkey") ||
    msg.includes("violates foreign key constraint") ||
    msg.includes("foreign key")
  );
}

export type BulkOfferingDeletePlan = {
  allowedIds: string[];
  blocked: OfferingDependencyUsage[];
};

/** Never silently delete used offerings — callers must surface blocked counts. */
export function planBulkOfferingDelete(usages: OfferingDependencyUsage[]): BulkOfferingDeletePlan {
  const allowedIds: string[] = [];
  const blocked: OfferingDependencyUsage[] = [];
  for (const u of usages) {
    if (isOfferingInUse(u)) blocked.push(u);
    else allowedIds.push(u.offeringId);
  }
  return { allowedIds, blocked };
}

export function formatBulkOfferingDeleteBlockedMessage(blocked: OfferingDependencyUsage[]): string {
  if (blocked.length === 0) return "";
  const deps = blocked.reduce((n, b) => n + offeringDependencyTotal(b), 0);
  return `${OFFERING_IN_USE_DELETE_MESSAGE} عدد العروض الممنوعة: ${blocked.length} (إجمالي الروابط: ${deps}). ${OFFERING_IN_USE_HINT}`;
}

export function offeringDeleteBlockedToastMessage(usage?: OfferingDependencyUsage): string {
  if (!usage) return `${OFFERING_IN_USE_DELETE_MESSAGE} ${OFFERING_IN_USE_HINT}`;
  return `${OFFERING_IN_USE_DELETE_MESSAGE} (تكليفات: ${usage.teachingAssignmentCount}، روابط شعب: ${usage.courseOfferingSectionCount}، جلسات: ${usage.scheduleSessionCount}). ${OFFERING_IN_USE_HINT}`;
}
