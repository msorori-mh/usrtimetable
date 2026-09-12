/**
 * JAWF-SESSION-DURATION-01 — pure weekly-cadence planning for the V2 auto-scheduler.
 *
 * The V2 auto-scheduler previously placed each component's whole remaining
 * hour budget as ONE session (clamped to 4h), which violates the approved plan
 * cadence (e.g. theory 4h must be 2 weekly sessions of 2h). This module derives
 * the required per-week session durations from the validated `plan_courses`
 * cadence columns, reconciles them against sessions that already exist, and
 * provides local (non-authoritative) candidate pre-filters.
 *
 * No DB access, no writes: the guarded V2 RPC stays the only authority for
 * conflicts, capacity, room type, availability, hours and permissions.
 */

/** theory + tutorial consume the lecture cadence; practical consumes the lab cadence. */
export const LECTURE_LIKE_COMPONENTS = ["theory", "tutorial", "lecture"] as const;
export const LAB_LIKE_COMPONENTS = ["practical", "lab"] as const;

export const MIN_SESSION_HOURS = 1;
export const MAX_SESSION_HOURS = 4;
const EPS = 0.01;

export type CadenceFamily = "lecture" | "lab";

export type PlanCourseCadence = {
  lectures_per_week: number | null;
  lecture_session_duration: number | null;
  labs_per_week: number | null;
  lab_session_duration: number | null;
  required_room_type_for_lecture?: string | null;
  required_room_type_for_lab?: string | null;
};

export function cadenceFamilyForComponent(componentType: string | null | undefined): CadenceFamily {
  const t = String(componentType ?? "").toLowerCase();
  if ((LAB_LIKE_COMPONENTS as readonly string[]).includes(t)) return "lab";
  return "lecture";
}

const near = (a: number, b: number) => Math.abs(a - b) <= EPS;

/**
 * Split an hour budget into weekly session blocks when the plan cadence is
 * missing or inconsistent. Prefers equal blocks of 2h, then 3h, then 1h;
 * falls back to greedy 2h blocks plus a remainder.
 */
export function splitHoursIntoSessions(totalHours: number): number[] {
  const hours = Math.round((Number(totalHours) || 0) * 100) / 100;
  if (hours <= 0) return [];
  if (hours <= MAX_SESSION_HOURS && hours <= 3 && Number.isInteger(hours)) {
    // 1h → 1x1, 2h → 1x2, 3h → 1x3 (a 3h theory course stays one 3h session).
    return [hours];
  }
  for (const d of [2, 3, 1]) {
    const n = hours / d;
    if (Number.isInteger(Math.round(n * 100) / 100) && near(n, Math.round(n)) && n >= 1) {
      return Array.from({ length: Math.round(n) }, () => d);
    }
  }
  const out: number[] = [];
  let left = hours;
  while (left > MAX_SESSION_HOURS + EPS) {
    out.push(2);
    left = Math.round((left - 2) * 100) / 100;
  }
  if (left > EPS) out.push(left);
  return out;
}

export type RequiredCadence = {
  /** One entry per weekly session, in hours. Empty when the plan cadence is unusable. */
  durations: number[];
  source: "plan" | "blocked";
  /** Arabic note explaining why the plan cadence could not be used. */
  noteAr: string | null;
};

/**
 * Required weekly sessions for one component, from the validated plan cadence.
 *
 * JAWF-STUDENT-PARTITIONS-02: the cadence is never invented. When the plan
 * pattern is missing, invalid, or does not match the component's assigned
 * hours, the component is reported and blocked instead of being split by
 * a guessed rule.
 */
export function requiredCadenceForComponent(input: {
  componentType: string | null | undefined;
  assignedHours: number;
  planCourse: PlanCourseCadence | null | undefined;
}): RequiredCadence {
  const assigned = Math.round((Number(input.assignedHours) || 0) * 100) / 100;
  if (assigned <= 0) {
    return {
      durations: [],
      source: "blocked",
      noteAr: "ساعات المكوّن غير مُعرَّفة أو صفرية — لا يمكن تحديد نمط الجلسات.",
    };
  }

  const family = cadenceFamilyForComponent(input.componentType);
  const pc = input.planCourse;
  const count = Number((family === "lab" ? pc?.labs_per_week : pc?.lectures_per_week) ?? 0);
  const duration = Number(
    (family === "lab" ? pc?.lab_session_duration : pc?.lecture_session_duration) ?? 0,
  );

  if (!pc) {
    return {
      durations: [],
      source: "blocked",
      noteAr:
        "لا توجد بيانات نمط أسبوعي في الخطة الدراسية لهذا المقرر — صحّح الخطة قبل التوليد الآلي.",
    };
  }
  // JAWF cadence fix: for components of up to 3 weekly hours the component's own
  // assigned hours are the source of truth — one contiguous weekly session
  // (theory 3h → 1×3h, tutorial 2h → 1×2h, theory 2h + project 2h → 1×2h each).
  // Legacy lectures_per_week/lecture_session_duration must never split these
  // into 1h slices. Components above 3h keep the validated plan pattern (4h → 2×2h).
  if (assigned <= 3 + EPS) {
    return { durations: [assigned], source: "plan", noteAr: null };
  }
  if (
    count > 0 &&
    duration > 0 &&
    duration <= MAX_SESSION_HOURS &&
    near(count * duration, assigned)
  ) {
    return {
      durations: Array.from({ length: Math.round(count) }, () => duration),
      source: "plan",
      noteAr: null,
    };
  }
  // Several lecture-like components (e.g. theory 2h + weekly project 2h) share one
  // plan lecture pattern. The component then consumes part of that pattern: keep the
  // plan session duration and only take the sessions this component needs.
  if (count > 0 && duration > 0 && duration <= MAX_SESSION_HOURS && assigned < count * duration) {
    const sessions = assigned / duration;
    if (near(sessions, Math.round(sessions)) && Math.round(sessions) >= 1) {
      return {
        durations: Array.from({ length: Math.round(sessions) }, () => duration),
        source: "plan",
        noteAr: null,
      };
    }
  }
  return {
    durations: [],
    source: "blocked",
    noteAr:
      count > 0 || duration > 0
        ? `نمط الخطة (${count}×${duration}) لا يطابق ساعات المكوّن (${assigned}) — صحّح الخطة قبل التوليد الآلي.`
        : "نمط الخطة الأسبوعي غير مُعرَّف لهذا المكوّن — صحّح الخطة قبل التوليد الآلي.",
  };
}

export type ExistingSessionLite = {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  room_id?: string | null;
};

/** Wall-clock hours between HH:MM[:SS] values; 0 when invalid or non-positive. */
export function sessionHours(start: string, end: string): number {
  const toMin = (s: string) => {
    const [h, m] = String(s).slice(0, 5).split(":").map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
    return h * 60 + m;
  };
  const a = toMin(start);
  const b = toMin(end);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  return Math.round(((b - a) / 60) * 100) / 100;
}

export type CadencePlan = {
  /** Durations still to be created, in hours. */
  remaining: number[];
  /** Existing sessions matching a required duration (kept untouched). */
  conforming: ExistingSessionLite[];
  /** Existing sessions whose duration does not match any required session. */
  nonconforming: ExistingSessionLite[];
  requiredHours: number;
  scheduledHours: number;
  /** Days already used by existing sessions of the same group. */
  usedDays: number[];
  /** True when existing hours already meet or exceed the component budget. */
  budgetExhausted: boolean;
};

/**
 * Reconcile required cadence with sessions that already exist for the same
 * teaching assignment + delivery group. Existing rows are never modified:
 * they are either counted as conforming or reported as nonconforming.
 */
export function planRemainingSessions(input: {
  requiredDurations: number[];
  existing: ExistingSessionLite[];
}): CadencePlan {
  const required = [...input.requiredDurations];
  const requiredHours = Math.round(required.reduce((a, b) => a + b, 0) * 100) / 100;
  const conforming: ExistingSessionLite[] = [];
  const nonconforming: ExistingSessionLite[] = [];
  const pool = [...required];
  let scheduledHours = 0;

  for (const s of input.existing) {
    const h = sessionHours(s.start_time, s.end_time);
    scheduledHours = Math.round((scheduledHours + h) * 100) / 100;
    const idx = pool.findIndex((d) => near(d, h));
    if (idx >= 0) {
      pool.splice(idx, 1);
      conforming.push(s);
    } else {
      nonconforming.push(s);
    }
  }

  // Never exceed the component budget: drop planned sessions that would not fit.
  let budget = Math.round((requiredHours - scheduledHours) * 100) / 100;
  const remaining: number[] = [];
  for (const d of pool) {
    if (d <= budget + EPS) {
      remaining.push(d);
      budget = Math.round((budget - d) * 100) / 100;
    }
  }

  const usedDays = Array.from(
    new Set(input.existing.map((s) => Number(s.day_of_week)).filter(Number.isFinite)),
  );

  return {
    remaining,
    conforming,
    nonconforming,
    requiredHours,
    scheduledHours,
    usedDays,
    budgetExhausted: scheduledHours >= requiredHours - EPS,
  };
}

export type CandidateSlot = { day: number; start: string; end: string };

/**
 * Prefer slots on days the group is not already using, so repeated weekly
 * sessions of the same group spread across distinct days.
 */
export function orderSlotsByDistinctDay(
  slots: CandidateSlot[],
  usedDays: readonly number[],
): CandidateSlot[] {
  const used = new Set(usedDays.map(Number));
  return slots
    .map((slot, index) => ({ slot, index, penalty: used.has(slot.day) ? 1 : 0 }))
    .sort((a, b) => a.penalty - b.penalty || a.index - b.index)
    .map((entry) => entry.slot);
}

export type RoomLite = {
  id: string;
  capacity: number;
  room_type?: string | null;
  room_type_id?: string | null;
};

export type RoomRequirement = {
  roomTypeId?: string | null;
  roomTypeName?: string | null;
  expectedStudents?: number | null;
};

/** Local room pre-filter (capacity + room type). Server validation still decides. */
export function roomMatchesRequirement(room: RoomLite, req: RoomRequirement): boolean {
  const need = Number(req.expectedStudents ?? 0);
  if (need > 0 && Number(room.capacity ?? 0) < need) return false;
  if (req.roomTypeId) return room.room_type_id === req.roomTypeId;
  if (req.roomTypeName) {
    return String(room.room_type ?? "").toLowerCase() === String(req.roomTypeName).toLowerCase();
  }
  return true;
}

export function filterCandidateRooms(rooms: RoomLite[], req: RoomRequirement): RoomLite[] {
  return rooms.filter((room) => roomMatchesRequirement(room, req));
}

export type OccupiedInterval = {
  day: number;
  start: string;
  end: string;
  roomId?: string | null;
  instructorId?: string | null;
  cohortId?: string | null;
  deliveryGroupId?: string | null;
};

export type SlotContext = {
  roomId: string;
  instructorId?: string | null;
  cohortId?: string | null;
  deliveryGroupId?: string | null;
};

const toMinutes = (value: string) => {
  const [h, m] = String(value).slice(0, 5).split(":").map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
};

function overlaps(a: { start: string; end: string }, b: { start: string; end: string }): boolean {
  return toMinutes(a.start) < toMinutes(b.end) && toMinutes(b.start) < toMinutes(a.end);
}

/** Returns true when the two delivery groups may contain the same students. */
export type SharedStudentsPredicate = (
  aGroupId: string | null | undefined,
  bGroupId: string | null | undefined,
) => boolean;

/**
 * Cheap local rejection of candidates that are certainly occupied by sessions
 * we already know about. This only avoids doomed RPC round-trips; it never
 * approves a placement — the guarded RPC re-validates everything.
 *
 * JAWF-STUDENT-PARTITIONS-02: when both sides carry a delivery group, the
 * student-body question is answered by `sharedStudents`, so disjoint partitions
 * of the same cohort are no longer blocked locally. Without a predicate (or
 * when either side has no group) the conservative cohort-wide rule applies.
 */
export function isLocallyBlocked(
  slot: CandidateSlot,
  ctx: SlotContext,
  occupied: readonly OccupiedInterval[],
  sharedStudents?: SharedStudentsPredicate,
): boolean {
  return occupied.some((o) => {
    if (Number(o.day) !== Number(slot.day)) return false;
    if (!overlaps(slot, o)) return false;
    if (o.roomId && o.roomId === ctx.roomId) return true;
    if (o.instructorId && ctx.instructorId && o.instructorId === ctx.instructorId) return true;
    if (o.deliveryGroupId && ctx.deliveryGroupId) {
      if (o.deliveryGroupId === ctx.deliveryGroupId) return true;
      if (!sharedStudents) {
        return !!(o.cohortId && ctx.cohortId && o.cohortId === ctx.cohortId);
      }
      if (o.cohortId && ctx.cohortId && o.cohortId !== ctx.cohortId) return false;
      return sharedStudents(ctx.deliveryGroupId, o.deliveryGroupId);
    }
    if (o.cohortId && ctx.cohortId && o.cohortId === ctx.cohortId) return true;
    return false;
  });
}

/** Arabic warning for existing sessions that do not match the plan cadence. */
export function nonconformingWarningAr(input: {
  courseCode: string;
  componentType: string;
  groupCode?: string | null;
  sessions: ExistingSessionLite[];
  requiredDurations: number[];
}): string {
  const durations = input.sessions.map((s) => sessionHours(s.start_time, s.end_time)).join("، ");
  const expected = input.requiredDurations.length
    ? `${input.requiredDurations.length}×${input.requiredDurations[0]}`
    : "غير مُعرَّف";
  const group = input.groupCode ? ` / ${input.groupCode}` : "";
  return `جلسات قائمة لا تطابق نمط الخطة: ${input.courseCode}${group} (${input.componentType}) — المدد الحالية: ${durations} ساعة، المتوقع: ${expected}. لم تُعدَّل ولم تُحسب كمكتملة.`;
}

/** Fail-closed stop when the schedule version changed under the run. */
export const STALE_VERSION_ERROR = "V2_AUTO_STALE_VERSION: تغيّرت نسخة الجدول أثناء التشغيل.";

export function assertVersionNotStale(result: { stale?: boolean } | null | undefined): void {
  if (result?.stale) throw new Error(STALE_VERSION_ERROR);
}
