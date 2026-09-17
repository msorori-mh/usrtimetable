/**
 * JAWF-AUTH-FALLBACK-01 — bounded, server-authoritative fallback enumeration for
 * ONE missing session in V2 `fill_missing`.
 *
 * Architectural rule encoded here: the local prefilters (`feasible`,
 * `isLocallyBlocked`) are *advisory*. They can reject a legal candidate whenever
 * their snapshot is less precise than the database (e.g. an incomplete
 * delivery-group → student-partition mapping degrades to a cohort-wide conflict
 * rule, so two groups of the same cohort with disjoint partitions can never run
 * in parallel locally, although the guarded RPC allows it).
 *
 * This module therefore enumerates candidates using ONLY the unambiguous hard
 * constraints, and leaves every room / instructor / student conflict decision to
 * `create_schedule_session_from_assignment_v2`, which stays the sole authority
 * and the sole writer. Nothing here relaxes a constraint and nothing here moves
 * an existing session.
 *
 * Pure module: no Supabase client calls, no I/O.
 */

import { isInstructorAvailabilityEnforced } from "@/lib/scheduling/instructor-availability-policy";
import {
  isRoomSlotAvailable,
  type RoomAvailabilityWindow,
} from "@/lib/auto-scheduler/session-plan";

export type FallbackSlot = { day: number; start: string; end: string };

export type FallbackRoom = {
  id: string;
  available_days?: number[] | null;
  available_start_time?: string | null;
  available_end_time?: string | null;
};

export type FallbackAvailabilityWindow = {
  instructor_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  availability_type?: string | null;
  is_preference?: boolean | null;
};

export type FallbackCandidate = {
  day: number;
  start: string;
  end: string;
  roomId: string;
  /** 0 = required room type, 1+ = policy-allowed fallback pool (practical hall). */
  poolIndex: number;
  dayPriority: number;
};

/** Maximum authoritative attempts per missing session (bounded search). */
export const AUTHORITATIVE_FALLBACK_MAX_CANDIDATES = 60;

export const AUTHORITATIVE_FALLBACK_WARNING_PREFIX_AR =
  "تعذر الموضع المخطط والبديل المحلي؛ أثبت الخادم موضعًا قانونيًا بديلًا لهذه الجلسة فقط";

function toMinutes(value: string): number {
  const [h = "0", m = "0"] = String(value).split(":");
  return Number(h) * 60 + Number(m);
}

/** Stable identity of one placement attempt, shared by the local and authoritative phases. */
export function candidateAttemptKey(input: {
  day: number;
  start: string;
  end: string;
  roomId: string;
}): string {
  return `${Number(input.day)}|${input.start}|${input.end}|${input.roomId}`;
}

/**
 * Local mirror of the instructor-availability hard rule (same semantics as
 * `feasible`): enforcement flag off → never blocks; external / other-college
 * instructors require an explicit window; declared windows must cover the slot
 * and no `unavailable` window may overlap it.
 */
export function isInstructorSlotAvailable(input: {
  enforce: boolean | null | undefined;
  slot: FallbackSlot;
  windows: readonly FallbackAvailabilityWindow[];
  instructorId: string;
  requiresExplicitWindow?: boolean;
}): boolean {
  if (!isInstructorAvailabilityEnforced(input.enforce)) return true;
  const start = toMinutes(input.slot.start);
  const end = toMinutes(input.slot.end);
  const windows = input.windows.filter(
    (w) =>
      w.instructor_id === input.instructorId &&
      Number(w.day_of_week) === Number(input.slot.day) &&
      !w.is_preference,
  );
  if (!windows.length) return !input.requiresExplicitWindow;
  const positive = windows.filter((w) => w.availability_type !== "unavailable");
  if (!positive.some((w) => start >= toMinutes(w.start_time) && end <= toMinutes(w.end_time)))
    return false;
  return !windows.some(
    (w) =>
      w.availability_type === "unavailable" &&
      start < toMinutes(w.end_time) &&
      end > toMinutes(w.start_time),
  );
}

/**
 * Ordered candidate list for the missing session.
 *
 * Applied here (unambiguous hard constraints only):
 * - working day / template window (callers pass template-derived slots),
 * - room capacity and room-type policy (callers pass ranked room pools),
 * - room availability windows,
 * - instructor availability,
 * - proven student attendance-day envelope,
 * - instructor effective day cap,
 * - instructor and student-partition daily-hour caps.
 *
 * NOT applied here (RPC authority): room / instructor / student overlaps,
 * cross-term rules, version state, over-scheduling.
 */
export function enumerateAuthoritativeCandidates(input: {
  slots: readonly FallbackSlot[];
  /** Ranked pools: index 0 = required room type, later = allowed fallback. */
  roomPools: readonly (readonly FallbackRoom[])[];
  roomAvailability?: readonly RoomAvailabilityWindow[];
  instructorId: string;
  instructorAvailability?: readonly FallbackAvailabilityWindow[];
  enforceInstructorAvailability?: boolean | null;
  instructorRequiresExplicitWindow?: boolean;
  levelDays: ReadonlySet<number>;
  maxLevelDays: number;
  instructorDays: ReadonlySet<number>;
  instructorDayCap: number;
  plannedDay: number;
  durationMinutes: number;
  instructorDayMinutes: (day: number) => number;
  maxInstructorDailyMinutes: number;
  studentDayMinutes: (day: number) => number;
  maxStudentDailyMinutes: number;
  attempted?: ReadonlySet<string>;
  maxCandidates?: number;
}): FallbackCandidate[] {
  const attempted = input.attempted ?? new Set<string>();
  const out: FallbackCandidate[] = [];

  const dayAllowed = new Map<number, boolean>();
  const isDayAllowed = (day: number): boolean => {
    const cached = dayAllowed.get(day);
    if (cached !== undefined) return cached;
    let allowed = true;
    if (!input.levelDays.has(day) && input.levelDays.size >= input.maxLevelDays) allowed = false;
    if (
      allowed &&
      !input.instructorDays.has(day) &&
      input.instructorDays.size >= input.instructorDayCap
    )
      allowed = false;
    if (
      allowed &&
      input.instructorDayMinutes(day) + input.durationMinutes > input.maxInstructorDailyMinutes
    )
      allowed = false;
    if (
      allowed &&
      input.studentDayMinutes(day) + input.durationMinutes > input.maxStudentDailyMinutes
    )
      allowed = false;
    dayAllowed.set(day, allowed);
    return allowed;
  };

  const dayPriority = (day: number): number => {
    if (input.levelDays.has(day) && input.instructorDays.has(day)) return 0;
    if (day === input.plannedDay) return 1;
    if (input.levelDays.has(day)) return 2;
    if (input.instructorDays.has(day)) return 3;
    return 4;
  };

  input.roomPools.forEach((pool, poolIndex) => {
    for (const slot of input.slots) {
      if (!isDayAllowed(slot.day)) continue;
      if (
        !isInstructorSlotAvailable({
          enforce: input.enforceInstructorAvailability,
          slot,
          windows: input.instructorAvailability ?? [],
          instructorId: input.instructorId,
          requiresExplicitWindow: input.instructorRequiresExplicitWindow,
        })
      )
        continue;
      for (const room of pool) {
        if (!isRoomSlotAvailable(room, slot, input.roomAvailability ?? [])) continue;
        const key = candidateAttemptKey({
          day: slot.day,
          start: slot.start,
          end: slot.end,
          roomId: room.id,
        });
        if (attempted.has(key)) continue;
        out.push({
          day: slot.day,
          start: slot.start,
          end: slot.end,
          roomId: room.id,
          poolIndex,
          dayPriority: dayPriority(slot.day),
        });
      }
    }
  });

  out.sort(
    (a, b) =>
      a.poolIndex - b.poolIndex ||
      a.dayPriority - b.dayPriority ||
      a.day - b.day ||
      a.start.localeCompare(b.start) ||
      a.roomId.localeCompare(b.roomId),
  );
  const limit = Math.max(
    1,
    Math.min(input.maxCandidates ?? AUTHORITATIVE_FALLBACK_MAX_CANDIDATES, 500),
  );
  // Dedupe identical day/start/end/room across pools before bounding.
  const seen = new Set<string>();
  const bounded: FallbackCandidate[] = [];
  for (const candidate of out) {
    const key = candidateAttemptKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    bounded.push(candidate);
    if (bounded.length >= limit) break;
  }
  return bounded;
}
