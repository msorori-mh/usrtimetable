/**
 * Drag-drop safety helpers — local pending only; no DB writes.
 * Mission: TIMETABLE-DRAG-DROP-SAFETY-UNDO-01
 * Cohort / room-type / capacity wiring: SCHEDULE-BUILDER-DROP-PREVIEW-COHORT-ROOM-WIRING-01
 */

import {
  normalizeTimeHHMM,
  proposeSlotFromDragDrop,
  type PendingScheduleSessionChange,
  type PendingScheduleSlot,
} from "@/lib/schedule-builder/pending-change";
import { resolveRequiredRoomType } from "@/lib/schedule-builder/room-type-policy";

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

/** Session fields needed to wire drop preview (cohort + room constraints). */
export interface DropPreviewSession {
  id: string;
  instructor_id: string | null;
  room_id: string | null;
  cohort_id?: string | null;
  section_id?: string | null;
  study_system: string | null;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_locked?: boolean;
  session_type?: string | null;
  enrollment_count?: number | null;
  subgroup_expected_students?: number | null;
  /** Optional TA/master required_room_type when already hydrated. */
  required_room_type?: string | null;
}

export interface DropPreviewRoom {
  id: string;
  room_type?: string | null;
  capacity?: number | null;
}

/** Cohort/section identity used for overlap preview (cohort wins; else section). */
export function conflictIdentityForSession(session: {
  cohort_id?: string | null;
  section_id?: string | null;
}): string | null {
  const cohort = session.cohort_id?.trim() || null;
  if (cohort) return cohort;
  const section = session.section_id?.trim() || null;
  return section;
}

export function toOccupancySession(session: DropPreviewSession): OccupancySession {
  return {
    id: session.id,
    instructor_id: session.instructor_id,
    room_id: session.room_id,
    cohort_id: conflictIdentityForSession(session),
    study_system: session.study_system,
    day_of_week: session.day_of_week,
    start_time: session.start_time,
    end_time: session.end_time,
    is_locked: session.is_locked,
  };
}

export function expectedStudentsForDrop(session: DropPreviewSession): number | null {
  if (session.subgroup_expected_students != null && Number.isFinite(Number(session.subgroup_expected_students))) {
    return Number(session.subgroup_expected_students);
  }
  if (session.enrollment_count != null && Number.isFinite(Number(session.enrollment_count))) {
    return Number(session.enrollment_count);
  }
  return null;
}

export function resolveDropRoomConstraints(params: {
  targetRoom: DropPreviewRoom | null | undefined;
  sessionType?: string | null;
  requiredRoomType?: string | null;
  expectedStudents?: number | null;
}): {
  roomId: string | null;
  roomType: string | null;
  roomCapacity: number | null;
  expectedStudents: number | null;
  requiredRoomType: string | null;
  roomTypeOk: boolean;
} {
  const { requiredType } = resolveRequiredRoomType({
    requiredRoomType: params.requiredRoomType,
    sessionType: params.sessionType,
  });
  const roomType = params.targetRoom?.room_type ?? null;
  const roomCapacity =
    params.targetRoom?.capacity != null && Number.isFinite(Number(params.targetRoom.capacity))
      ? Number(params.targetRoom.capacity)
      : null;
  const roomTypeOk =
    !requiredType || roomType == null ? true : roomType === requiredType;
  return {
    roomId: params.targetRoom?.id ?? null,
    roomType,
    roomCapacity,
    expectedStudents: params.expectedStudents ?? null,
    requiredRoomType: requiredType,
    roomTypeOk,
  };
}

export interface EvaluateDropTargetInput {
  sourceSlot: PendingScheduleSlot;
  movingSession: OccupancySession;
  day_of_week: number;
  start_time: string;
  others: OccupancySession[];
  roomCapacity?: number | null;
  expectedStudents?: number | null;
  roomTypeOk?: boolean;
}

const t = (s: string) => normalizeTimeHHMM(s);
const overlap = (aS: string, aE: string, bS: string, bE: string) => t(aS) < t(bE) && t(bS) < t(aE);

export function evaluateDropTarget(input: EvaluateDropTargetInput): DropSafetyResult {
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

/**
 * Build evaluateDropTarget input with real cohort identity + target room type/capacity.
 * Pure — no DB / RPC. Caller must not persist when result.kind === "forbidden".
 */
export function buildEvaluateDropTargetInput(opts: {
  sourceSlot: PendingScheduleSlot;
  movingSession: DropPreviewSession;
  day_of_week: number;
  start_time: string;
  others: DropPreviewSession[];
  rooms: DropPreviewRoom[];
}): EvaluateDropTargetInput {
  const targetRoomId = opts.sourceSlot.room_id;
  const targetRoom =
    targetRoomId != null ? (opts.rooms.find((r) => r.id === targetRoomId) ?? null) : null;
  const expectedStudents = expectedStudentsForDrop(opts.movingSession);
  const room = resolveDropRoomConstraints({
    targetRoom,
    sessionType: opts.movingSession.session_type,
    requiredRoomType: opts.movingSession.required_room_type,
    expectedStudents,
  });
  return {
    sourceSlot: opts.sourceSlot,
    movingSession: toOccupancySession(opts.movingSession),
    day_of_week: opts.day_of_week,
    start_time: opts.start_time,
    others: opts.others.map(toOccupancySession),
    roomCapacity: room.roomCapacity,
    expectedStudents: room.expectedStudents,
    roomTypeOk: room.roomTypeOk,
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
