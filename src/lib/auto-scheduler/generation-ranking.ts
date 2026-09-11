import { compareAttendance } from "./attendance-objective.ts";
import { feasible, measure, type Session, type Snapshot, type Metrics } from "./compact.ts";

export interface RankedCandidate {
  session: Session;
  metrics: Metrics;
}

export function generationDomainSize(input: {
  snapshot: Snapshot;
  sessions: Session[];
  session: Session;
  slots: { day: number; start: string; end: string }[];
  roomIds: string[];
}): number {
  let count = 0;
  for (const slot of input.slots)
    for (const roomId of input.roomIds) {
      const candidate = {
        ...input.session,
        day_of_week: slot.day,
        start_time: slot.start,
        end_time: slot.end,
        room_id: roomId,
      };
      if (feasible(input.snapshot, input.sessions, candidate, input.session)) count++;
    }
  return count;
}

/** The same constraints and objective used by compaction rank every valid generation slot. */
export function rankGenerationCandidates(input: {
  snapshot: Snapshot;
  sessions: Session[];
  session: Session;
  slots: { day: number; start: string; end: string }[];
  roomIds: string[];
  usedDays?: number[];
}): RankedCandidate[] {
  const { snapshot, sessions, session } = input;
  const candidates: RankedCandidate[] = [];
  for (const slot of input.slots) {
    let metrics: Metrics | null = null;
    for (const roomId of input.roomIds) {
      const candidate = {
        ...session,
        day_of_week: slot.day,
        start_time: slot.start,
        end_time: slot.end,
        room_id: roomId,
      };
      if (!feasible(snapshot, sessions, candidate, session)) continue;
      metrics ??= measure(snapshot, [...sessions, candidate]);
      candidates.push({ session: candidate, metrics });
    }
  }
  const used = new Set(input.usedDays ?? []);
  return candidates.sort(
    (a, b) =>
      compareAttendance(a.metrics, b.metrics) ||
      Number(used.has(a.session.day_of_week)) - Number(used.has(b.session.day_of_week)) ||
      a.session.day_of_week - b.session.day_of_week ||
      a.session.start_time.localeCompare(b.session.start_time) ||
      input.roomIds.indexOf(a.session.room_id) - input.roomIds.indexOf(b.session.room_id),
  );
}

/** Scarce compatible rooms/windows and longer sessions are handled before flexible work. */
export function compareDifficulty(
  a: { candidateCount: number; durationMinutes: number; expectedStudents: number; id: string },
  b: { candidateCount: number; durationMinutes: number; expectedStudents: number; id: string },
): number {
  return (
    a.candidateCount - b.candidateCount ||
    b.durationMinutes - a.durationMinutes ||
    b.expectedStudents - a.expectedStudents ||
    a.id.localeCompare(b.id)
  );
}
