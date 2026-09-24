/**
 * Deterministic offline helper for capacity-subgroup slot simulation.
 * Does not write to the database.
 * Does not auto-create subgroups/sessions/rooms or extend operating hours.
 * Production path: proposeCapacitySplit (proposal only) + explicit user confirm.
 */

import {
  CAPACITY_EXCEPTION_LIMIT,
  planSubgroups,
  type SubgroupPlanRow,
} from "@/lib/schedule-builder/section-subgroups";

export interface SimRoom {
  id: string;
  code: string;
  room_type: string;
  capacity: number;
}

export interface SimOccupancy {
  id: string;
  instructor_id: string;
  room_id: string | null;
  section_id: string | null;
  section_subgroup_id: string | null;
  study_system: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  expected_students: number;
  required_room_type: string;
  replaced_by_split?: boolean;
}

export interface DailyBreak {
  day_of_week: number;
  start_time: string;
  end_time: string;
}

export interface AvailabilityWindow {
  day_of_week: number;
  start_time: string;
  end_time: string;
}

export interface SchedulerConfig {
  workingDays: number[]; // e.g. [0,1,2,3,4,6] Sat–Thu style used in draft data
  dayStart: string; // "08:00:00"
  dayEnd: string; // "14:00:00"
  slotStarts: string[]; // candidate starts within window
  dailyBreaks: DailyBreak[];
  instructorAvailability: Map<string, AvailabilityWindow[]>; // empty => unrestricted
  roomAvailability: Map<string, AvailabilityWindow[]>;
}

export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  workingDays: [0, 1, 2, 3, 4, 6],
  dayStart: "08:00:00",
  dayEnd: "14:00:00",
  slotStarts: ["08:00:00", "10:00:00", "12:00:00"],
  dailyBreaks: [],
  instructorAvailability: new Map(),
  roomAvailability: new Map(),
};

function norm(t: string): string {
  return t.length === 5 ? `${t}:00` : t;
}

export function timeToMinutes(t: string): number {
  const [h, m] = norm(t).split(":").map(Number);
  return h * 60 + m;
}

export function overlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return timeToMinutes(aStart) < timeToMinutes(bEnd) && timeToMinutes(bStart) < timeToMinutes(aEnd);
}

function addMinutes(t: string, mins: number): string {
  const total = timeToMinutes(t) + mins;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
}

function inBreak(day: number, start: string, end: string, breaks: DailyBreak[]): boolean {
  return breaks.some(
    (b) => b.day_of_week === day && overlap(start, end, norm(b.start_time), norm(b.end_time)),
  );
}

function fitsAvailability(
  day: number,
  start: string,
  end: string,
  windows: AvailabilityWindow[] | undefined,
): boolean {
  if (!windows || windows.length === 0) return true;
  const dayWins = windows.filter((w) => w.day_of_week === day);
  if (dayWins.length === 0) return false;
  return dayWins.some(
    (w) =>
      timeToMinutes(start) >= timeToMinutes(w.start_time) &&
      timeToMinutes(end) <= timeToMinutes(w.end_time),
  );
}

function activePeers(occ: SimOccupancy[]): SimOccupancy[] {
  return occ.filter((o) => !o.replaced_by_split);
}

function hasInstructorConflict(cand: SimOccupancy, peers: SimOccupancy[]): boolean {
  return peers.some(
    (p) =>
      p.id !== cand.id &&
      p.instructor_id === cand.instructor_id &&
      p.day_of_week === cand.day_of_week &&
      overlap(cand.start_time, cand.end_time, p.start_time, p.end_time),
  );
}

function hasRoomConflict(cand: SimOccupancy, peers: SimOccupancy[]): boolean {
  if (!cand.room_id) return false;
  return peers.some(
    (p) =>
      p.id !== cand.id &&
      p.room_id === cand.room_id &&
      p.day_of_week === cand.day_of_week &&
      overlap(cand.start_time, cand.end_time, p.start_time, p.end_time),
  );
}

/** Subgroup conflict: same section_subgroup_id overlapping; also whole-section vs any. */
function hasSubgroupConflict(cand: SimOccupancy, peers: SimOccupancy[]): boolean {
  if (!cand.section_id) return false;
  return peers.some((p) => {
    if (p.id === cand.id || p.section_id !== cand.section_id) return false;
    if (p.day_of_week !== cand.day_of_week) return false;
    if (!overlap(cand.start_time, cand.end_time, p.start_time, p.end_time)) return false;
    const a = cand.section_subgroup_id ?? null;
    const b = p.section_subgroup_id ?? null;
    if (a === null || b === null) return true;
    return a === b;
  });
}

function studySystemIsolated(a: string, b: string): boolean {
  // regular/parallel isolation: never treat as cross-system section conflict;
  // rooms/instructors still conflict globally.
  return a !== b && a !== "both" && b !== "both";
}

function hasSectionConflictIgnoringCrossSystem(cand: SimOccupancy, peers: SimOccupancy[]): boolean {
  if (!cand.section_id) return false;
  return peers.some((p) => {
    if (p.id === cand.id || p.section_id !== cand.section_id) return false;
    if (studySystemIsolated(cand.study_system, p.study_system)) return false;
    if (p.day_of_week !== cand.day_of_week) return false;
    if (!overlap(cand.start_time, cand.end_time, p.start_time, p.end_time)) return false;
    const a = cand.section_subgroup_id ?? null;
    const b = p.section_subgroup_id ?? null;
    if (a === null || b === null) return true;
    return a === b;
  });
}

export function candidateSlots(
  originalDay: number,
  originalStart: string,
  durationMinutes: number,
  cfg: SchedulerConfig,
): Array<{ day_of_week: number; start_time: string; end_time: string; rank: number }> {
  const out: Array<{ day_of_week: number; start_time: string; end_time: string; rank: number }> =
    [];
  let rank = 0;
  const origStartM = timeToMinutes(originalStart);

  const pushDay = (day: number, preferAfter: boolean) => {
    const starts = [...cfg.slotStarts].sort((a, b) => {
      const am = timeToMinutes(a);
      const bm = timeToMinutes(b);
      if (preferAfter) {
        const aOk = am >= origStartM ? 0 : 1;
        const bOk = bm >= origStartM ? 0 : 1;
        if (aOk !== bOk) return aOk - bOk;
        return Math.abs(am - origStartM) - Math.abs(bm - origStartM);
      }
      return Math.abs(am - origStartM) - Math.abs(bm - origStartM);
    });
    for (const start of starts) {
      const end = addMinutes(start, durationMinutes);
      if (timeToMinutes(start) < timeToMinutes(cfg.dayStart)) continue;
      if (timeToMinutes(end) > timeToMinutes(cfg.dayEnd)) continue;
      if (inBreak(day, start, end, cfg.dailyBreaks)) continue;
      out.push({ day_of_week: day, start_time: start, end_time: end, rank: rank++ });
    }
  };

  // 1–2: same day (after/before via preferAfter sort), then nearest on same day already covered
  if (cfg.workingDays.includes(originalDay)) {
    pushDay(originalDay, true);
  }
  // 3: other working days by circular distance from original
  const others = cfg.workingDays
    .filter((d) => d !== originalDay)
    .sort((a, b) => {
      const da = Math.min(Math.abs(a - originalDay), 7 - Math.abs(a - originalDay));
      const db = Math.min(Math.abs(b - originalDay), 7 - Math.abs(b - originalDay));
      return da - db || a - b;
    });
  for (const day of others) pushDay(day, false);

  // Deduplicate by day+start keeping first (best) rank
  const seen = new Set<string>();
  return out.filter((s) => {
    const k = `${s.day_of_week}|${s.start_time}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function pickRoom(
  rooms: SimRoom[],
  requiredType: string,
  students: number,
  cand: Omit<SimOccupancy, "room_id"> & { room_id?: string | null },
  peers: SimOccupancy[],
  cfg: SchedulerConfig,
): SimRoom | null {
  const eligible = rooms
    .filter((r) => r.room_type === requiredType)
    .filter((r) => students <= r.capacity + CAPACITY_EXCEPTION_LIMIT)
    .sort(
      (a, b) => a.capacity - b.capacity || a.code.localeCompare(b.code) || a.id.localeCompare(b.id),
    );

  for (const room of eligible) {
    if (
      !fitsAvailability(
        cand.day_of_week,
        cand.start_time,
        cand.end_time,
        cfg.roomAvailability.get(room.id),
      )
    ) {
      continue;
    }
    const trial: SimOccupancy = { ...cand, room_id: room.id };
    if (hasRoomConflict(trial, peers)) continue;
    return room;
  }
  return null;
}

export interface ScheduleChildInput {
  childId: string;
  instructor_id: string;
  section_id: string | null;
  section_subgroup_id: string;
  study_system: string;
  expected_students: number;
  required_room_type: string;
  duration_minutes: number;
  original_day: number;
  original_start: string;
}

export interface ScheduleChildResult {
  ok: boolean;
  childId: string;
  day_of_week?: number;
  start_time?: string;
  end_time?: string;
  room_id?: string;
  room_code?: string;
  reason?: string;
}

export function scheduleChildSession(
  input: ScheduleChildInput,
  rooms: SimRoom[],
  occupancy: SimOccupancy[],
  cfg: SchedulerConfig = DEFAULT_SCHEDULER_CONFIG,
): ScheduleChildResult {
  const peers = activePeers(occupancy);
  const slots = candidateSlots(
    input.original_day,
    input.original_start,
    input.duration_minutes,
    cfg,
  );

  for (const slot of slots) {
    if (
      !fitsAvailability(
        slot.day_of_week,
        slot.start_time,
        slot.end_time,
        cfg.instructorAvailability.get(input.instructor_id),
      )
    ) {
      continue;
    }
    const base: SimOccupancy = {
      id: input.childId,
      instructor_id: input.instructor_id,
      room_id: null,
      section_id: input.section_id,
      section_subgroup_id: input.section_subgroup_id,
      study_system: input.study_system,
      day_of_week: slot.day_of_week,
      start_time: slot.start_time,
      end_time: slot.end_time,
      expected_students: input.expected_students,
      required_room_type: input.required_room_type,
    };
    if (hasInstructorConflict(base, peers)) continue;
    if (hasSubgroupConflict(base, peers)) continue;
    if (hasSectionConflictIgnoringCrossSystem(base, peers)) continue;

    const room = pickRoom(
      rooms,
      input.required_room_type,
      input.expected_students,
      base,
      peers,
      cfg,
    );
    if (!room) continue;

    // Commit into occupancy for subsequent deterministic placement
    occupancy.push({ ...base, room_id: room.id });
    return {
      ok: true,
      childId: input.childId,
      day_of_week: slot.day_of_week,
      start_time: slot.start_time,
      end_time: slot.end_time,
      room_id: room.id,
      room_code: room.code,
    };
  }

  return { ok: false, childId: input.childId, reason: "NO_VALID_SLOT" };
}

export function buildSubgroupPlansForSplit(
  expectedCapacity: number,
  groupsCount: number,
): SubgroupPlanRow[] {
  return planSubgroups(expectedCapacity, groupsCount);
}

/** Detect hard conflicts among active occupancy (for simulation report). */
export function scanConflicts(occupancy: SimOccupancy[]): Array<{
  code: string;
  session_id: string;
  related_session_id: string;
}> {
  const peers = activePeers(occupancy);
  const out: Array<{ code: string; session_id: string; related_session_id: string }> = [];
  for (let i = 0; i < peers.length; i++) {
    const a = peers[i]!;
    for (let j = i + 1; j < peers.length; j++) {
      const b = peers[j]!;
      if (a.day_of_week !== b.day_of_week) continue;
      if (!overlap(a.start_time, a.end_time, b.start_time, b.end_time)) continue;
      if (a.instructor_id === b.instructor_id) {
        out.push({ code: "instructor_conflict", session_id: a.id, related_session_id: b.id });
      }
      if (a.room_id && a.room_id === b.room_id) {
        out.push({ code: "room_conflict", session_id: a.id, related_session_id: b.id });
      }
      if (
        a.section_id &&
        a.section_id === b.section_id &&
        !studySystemIsolated(a.study_system, b.study_system)
      ) {
        const asg = a.section_subgroup_id ?? null;
        const bsg = b.section_subgroup_id ?? null;
        if (asg === null || bsg === null || asg === bsg) {
          out.push({ code: "subgroup_conflict", session_id: a.id, related_session_id: b.id });
        }
      }
    }
  }
  return out;
}
