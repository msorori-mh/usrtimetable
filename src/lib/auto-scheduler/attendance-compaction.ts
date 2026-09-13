import { searchAttendance, type AttendanceSearchOptions } from "./attendance-search.ts";
import {
  compactSlots,
  feasible,
  fingerprint,
  inputFingerprint,
  measure,
  better,
  type Snapshot,
  type Session,
  type Move,
  type Proposal,
} from "./compact.ts";

const same = (a: Session, b: Session) =>
  a.day_of_week === b.day_of_week &&
  a.start_time === b.start_time &&
  a.end_time === b.end_time &&
  a.room_id === b.room_id;
/** Convert a simultaneous solution to legal ordered RPC moves. A cycle is not UNSAT. */
export function orderAttendanceMoves(snapshot: Snapshot, target: Session[]): Move[] | null {
  let current = [...snapshot.sessions];
  const pending = target.filter((s) => current.some((old) => old.id === s.id && !same(old, s)));
  const moves: Move[] = [];
  let bufferEvaluations = 0;
  while (pending.length) {
    if (moves.length >= 512) return null;
    const index = pending.findIndex((candidate) => {
      const old = current.find((s) => s.id === candidate.id)!;
      return feasible(snapshot, current, candidate, old);
    });
    if (index < 0) {
      // Break a swap using a genuinely free temporary placement. Every intermediate
      // move still passes the existing validator and the same atomic transaction.
      let buffer: Session | null = null;
      bufferSearch: for (const target of pending) {
        const old = current.find((s) => s.id === target.id)!;
        for (const slot of compactSlots({ ...snapshot, sessions: current }, old)) {
          for (const room of snapshot.rooms) {
            if (++bufferEvaluations > 10000) return null;
            const candidate = {
              ...old,
              day_of_week: slot.day,
              start_time: slot.start,
              end_time: slot.end,
              room_id: room.id,
            };
            if (same(candidate, old) || !feasible(snapshot, current, candidate, old)) continue;
            const trial = current.map((s) => (s.id === old.id ? candidate : s));
            if (
              pending.some(
                (next) =>
                  next.id !== old.id &&
                  feasible(snapshot, trial, next, current.find((s) => s.id === next.id)!),
              )
            ) {
              buffer = candidate;
              break bufferSearch;
            }
          }
        }
      }
      if (!buffer) return null;
      moves.push({
        id: buffer.id,
        day_of_week: buffer.day_of_week,
        start_time: buffer.start_time,
        end_time: buffer.end_time,
        room_id: buffer.room_id,
      });
      current = current.map((s) => (s.id === buffer!.id ? buffer! : s));
      continue;
    }
    const [candidate] = pending.splice(index, 1);
    moves.push({
      id: candidate.id,
      day_of_week: candidate.day_of_week,
      start_time: candidate.start_time,
      end_time: candidate.end_time,
      room_id: candidate.room_id,
    });
    current = current.map((s) => (s.id === candidate.id ? candidate : s));
  }
  return moves;
}

export async function compactAttendance(
  snapshot: Snapshot,
  options: AttendanceSearchOptions = {},
): Promise<Proposal> {
  const before = measure(snapshot);
  const search = await searchAttendance(snapshot, options);
  const proposal: Proposal = {
    before,
    after: before,
    moves: [],
    fingerprint: fingerprint(snapshot.sessions),
    inputFingerprint: inputFingerprint(snapshot),
    stopped: !!options.signal?.aborted,
    attendanceSearch: search,
  };
  if (search.status !== "feasible") return proposal;
  const after = measure(snapshot, search.sessions);
  const moves = orderAttendanceMoves(snapshot, search.sessions);
  if (!moves)
    return {
      ...proposal,
      executionBlocked:
        "وُجد توزيع يحقق هدف الأيام، لكن تنفيذه يحتاج تبديلات متزامنة لا يدعمها مسار الحفظ الحالي. لم يُسمح بزيادة الأيام.",
    };
  if (!better(after, before) && moves.length)
    return {
      ...proposal,
      executionBlocked:
        "وُجد حل لعدد الأيام؛ لم يُطبّق لأنه لا يحسّن الجدول الحالي وفق مؤشرات الجودة.",
    };
  return { ...proposal, after, moves };
}
