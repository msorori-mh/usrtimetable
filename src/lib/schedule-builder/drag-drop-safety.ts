/**
 * Drag-drop safety helpers — local pending only; no DB writes.
 * Mission: TIMETABLE-DRAG-DROP-SAFETY-UNDO-01
 */

import {
  normalizeTimeHHMM,
  proposeSlotFromDragDrop,
  type PendingScheduleSessionChange,
  type PendingScheduleSlot,
} from "@/lib/schedule-builder/pending-change";

export type DropSafetyKind = "valid" | "forbidden";

export interface DropSafetyResult {
  kind: DropSafetyKind;
  /** CSS hint: green / red */
  tone: "green" | "red";
  reason_ar: string | null;
  proposed: PendingScheduleSlot | null;
}

export interface OccupancySession {
  id: string;
  instructor_id: string | null;
  room_id: string | null;
  cohort_id?: string | null;
  study_system: string | null;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_locked?: boolean;
}

const t = (s: string) => normalizeTimeHHMM(s);
const overlap = (aS: string, aE: string, bS: string, bE: string) => t(aS) < t(bE) && t(bS) < t(aE);

export function evaluateDropTarget(input: {
  sourceSlot: PendingScheduleSlot;
  movingSession: OccupancySession;
  day_of_week: number;
  start_time: string;
  others: OccupancySession[];
  roomCapacity?: number | null;
  expectedStudents?: number | null;
  roomTypeOk?: boolean;
}): DropSafetyResult {
  if (input.movingSession.is_locked) {
    return {
      kind: "forbidden",
      tone: "red",
      reason_ar: "الجلسة مقفلة — لا يمكن الإفلات.",
      proposed: null,
    };
  }

  const proposal = proposeSlotFromDragDrop({
    sourceSlot: input.sourceSlot,
    day_of_week: input.day_of_week,
    start_time: input.start_time,
  });
  if (!proposal.ok) {
    return {
      kind: "forbidden",
      tone: "red",
      reason_ar: proposal.message,
      proposed: null,
    };
  }

  const proposed = proposal.proposed;
  const sys = input.movingSession.study_system;

  for (const o of input.others) {
    if (o.id === input.movingSession.id) continue;
    if ((o.study_system ?? "") !== (sys ?? "")) continue;
    if (o.day_of_week !== proposed.day_of_week) continue;
    if (!overlap(proposed.start_time, proposed.end_time, o.start_time, o.end_time)) continue;

    if (o.instructor_id && o.instructor_id === input.movingSession.instructor_id) {
      return {
        kind: "forbidden",
        tone: "red",
        reason_ar: "معاينة: تعارض مدرس في هذا الوقت.",
        proposed: null,
      };
    }
    if (o.room_id && proposed.room_id && o.room_id === proposed.room_id) {
      return {
        kind: "forbidden",
        tone: "red",
        reason_ar: "معاينة: تعارض قاعة في هذا الوقت.",
        proposed: null,
      };
    }
    if (
      o.cohort_id &&
      input.movingSession.cohort_id &&
      o.cohort_id === input.movingSession.cohort_id
    ) {
      return {
        kind: "forbidden",
        tone: "red",
        reason_ar: "معاينة: تعارض دفعة في هذا الوقت.",
        proposed: null,
      };
    }
  }

  if (input.roomTypeOk === false) {
    return {
      kind: "forbidden",
      tone: "red",
      reason_ar: "معاينة: نوع القاعة غير مناسب.",
      proposed: null,
    };
  }

  if (
    input.roomCapacity != null &&
    input.expectedStudents != null &&
    input.expectedStudents > input.roomCapacity
  ) {
    return {
      kind: "forbidden",
      tone: "red",
      reason_ar: "معاينة: سعة القاعة غير كافية.",
      proposed: null,
    };
  }

  return {
    kind: "valid",
    tone: "green",
    reason_ar: null,
    proposed,
  };
}

export function publishedVersionConfirmMessage(status: string | null | undefined): string | null {
  if (status === "published") {
    return "هذه نسخة منشورة. تأكيد قبل حفظ أي تغيير محلي (لن يُطبق على نسخة العرض المحمية في الاختبارات الليلية).";
  }
  return null;
}

/** Local undo stack for pending changes within a session (before save). */
export function pushUndo(
  stack: PendingScheduleSessionChange[],
  item: PendingScheduleSessionChange,
  max = 20,
): PendingScheduleSessionChange[] {
  return [...stack, item].slice(-max);
}

export function popUndo(stack: PendingScheduleSessionChange[]): {
  stack: PendingScheduleSessionChange[];
  item: PendingScheduleSessionChange | null;
} {
  if (stack.length === 0) return { stack, item: null };
  const item = stack[stack.length - 1];
  return { stack: stack.slice(0, -1), item };
}

export const PROTECTED_DEMO_VERSION_ID = "835e50fe-3ad2-4232-8c15-0f403c668a7f";

export function isProtectedDemoVersion(versionId: string | null | undefined): boolean {
  return versionId === PROTECTED_DEMO_VERSION_ID;
}
