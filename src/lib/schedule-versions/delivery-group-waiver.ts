/**
 * Temporary, tightly scoped publish waiver for `delivery_group_conflict`.
 *
 * Context: one college has legacy group-membership data that is not linked in
 * the editor, so student-membership overlap is reported on its current intake
 * draft even though the real timetable is unchanged. For THAT college, THAT
 * term and THAT schedule version only, those results are treated as waived
 * warnings at the review/approve/publish gate.
 *
 * Fail-closed: any other college, term or version keeps the hard blocker.
 * No other conflict code is ever waived (instructor / room / time stay hard).
 *
 * Pure module: no DB access, no writes.
 */

export const DELIVERY_GROUP_WAIVER_COLLEGE_ID = "f30ff526-3918-4395-b8a0-dff1873534bf";
export const DELIVERY_GROUP_WAIVER_TERM_ID = "019af13c-fd67-4fea-81c8-d81ef95e9a5c";
export const DELIVERY_GROUP_WAIVER_TERM_NAME = "الفصل الأول 2026-2027";
export const DELIVERY_GROUP_WAIVER_VERSION_ID = "c49a3694-3ade-5b2e-bbb2-6b5cafbbff50";

export const WAIVED_CONFLICT_CODE = "delivery_group_conflict";

export const DELIVERY_GROUP_WAIVER_NOTICE_AR =
  "استثناء مؤقت للفصل الحالي فقط: تعارضات عضوية المجموعات الطلابية في هذه النسخة تُعرض كتحذيرات ولا تمنع الاعتماد، لأنها ناتجة عن بيانات مجموعات قديمة غير مربوطة. تعارضات المحاضر والقاعة والوقت ما زالت مانعة.";

export interface DeliveryGroupWaiverScope {
  collegeId?: string | null;
  scheduleVersionId?: string | null;
  termId?: string | null;
  termName?: string | null;
}

const normalizeTermName = (value: string) =>
  value
    .replace(/[\u0640\u064B-\u065F\u0670]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[–—]/g, "-")
    .trim();

/** True only when all three scope conditions match exactly. */
export function isDeliveryGroupWaiverScope(scope: DeliveryGroupWaiverScope): boolean {
  if (!scope.collegeId || !scope.scheduleVersionId) return false;
  if (!scope.termId || !scope.termName) return false;
  if (scope.collegeId !== DELIVERY_GROUP_WAIVER_COLLEGE_ID) return false;
  if (scope.scheduleVersionId !== DELIVERY_GROUP_WAIVER_VERSION_ID) return false;
  if (scope.termId !== DELIVERY_GROUP_WAIVER_TERM_ID) return false;
  if (normalizeTermName(scope.termName) !== normalizeTermName(DELIVERY_GROUP_WAIVER_TERM_NAME))
    return false;
  return true;
}

interface WaivableConflict {
  code: string;
  severity: "hard" | "soft";
  metadata?: Record<string, unknown>;
}

export interface DeliveryGroupWaiverOutcome<T extends WaivableConflict> {
  conflicts: T[];
  waivedCount: number;
  active: boolean;
}

/**
 * Downgrade current `delivery_group_conflict` results to waived warnings when
 * (and only when) the scope matches. Every other code is returned untouched.
 */
export function applyDeliveryGroupWaiver<T extends WaivableConflict>(
  conflicts: T[],
  scope: DeliveryGroupWaiverScope,
): DeliveryGroupWaiverOutcome<T> {
  const active = isDeliveryGroupWaiverScope(scope);
  if (!active) return { conflicts, waivedCount: 0, active: false };
  let waivedCount = 0;
  const next = conflicts.map((c) => {
    if (c.code !== WAIVED_CONFLICT_CODE || c.severity !== "hard") return c;
    waivedCount += 1;
    return {
      ...c,
      severity: "soft" as const,
      metadata: {
        ...(c.metadata ?? {}),
        waived: true,
        waiver_scope: "current_term_only",
        waiver_reason_ar: DELIVERY_GROUP_WAIVER_NOTICE_AR,
      },
    };
  });
  return { conflicts: next, waivedCount, active: true };
}
