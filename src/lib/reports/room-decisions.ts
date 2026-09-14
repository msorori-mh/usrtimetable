import type { PrintSessionLike } from "@/lib/print-center/types";
import type {
  RoomsReportAvailability,
  RoomsReportRoom,
  RoomsReportSettings,
} from "@/lib/print-center/rooms-report";

export type DecisionSession = PrintSessionLike & {
  is_locked?: boolean | null;
  replaced_by_split?: boolean | null;
  teaching_assignment_id?: string | null;
};
export type DecisionRoom = RoomsReportRoom & { room_type?: string | null };
export type RoomClosure = {
  room_id: string;
  day_of_week?: number | null;
  start_time?: string | null;
  end_time?: string | null;
  start_date?: string | null;
  end_date?: string | null;
};
const time = (s: string) => s.slice(0, 5);
export const overlaps = (
  a: { start_time: string; end_time: string },
  b: { start_time: string; end_time: string },
) => time(a.start_time) < time(b.end_time) && time(b.start_time) < time(a.end_time);

export function roomOpen(
  roomId: string,
  day: number,
  start: string,
  end: string,
  availability: RoomsReportAvailability[],
  settings?: RoomsReportSettings | null,
): boolean {
  const own = availability.filter((a) => a.room_id === roomId);
  const windows = own.length
    ? own.filter((a) => a.day_of_week === day)
    : settings?.working_days?.includes(day)
      ? [{ start_time: settings.day_start_time, end_time: settings.day_end_time }]
      : [];
  return windows.some(
    (w) =>
      w.start_time &&
      w.end_time &&
      time(w.start_time) <= time(start) &&
      time(w.end_time) >= time(end),
  );
}

/** Conservative: dated closures also block the recurring weekday. No false assurance when term dates are unknown. */
export function roomClosed(
  roomId: string,
  day: number,
  start: string,
  end: string,
  closures: RoomClosure[],
): boolean {
  return closures.some(
    (c) =>
      c.room_id === roomId &&
      (c.day_of_week == null || c.day_of_week === day) &&
      (!c.start_time ||
        !c.end_time ||
        overlaps(
          { start_time: start, end_time: end },
          { start_time: c.start_time, end_time: c.end_time },
        )),
  );
}

export function capacityPoints(rooms: RoomsReportRoom[], sessions: PrintSessionLike[]) {
  return rooms
    .filter((r) => r.is_active !== false && typeof r.capacity === "number" && r.capacity > 0)
    .flatMap((r) => {
      const known = sessions.filter(
        (s) =>
          s.room_id === r.id &&
          typeof s.expected_students === "number" &&
          Number.isFinite(s.expected_students) &&
          s.expected_students >= 0,
      );
      if (!known.length) return [];
      return [
        {
          id: r.id,
          name: r.name || r.code || r.id,
          capacity: r.capacity as number,
          students:
            Math.round((known.reduce((n, s) => n + s.expected_students!, 0) / known.length) * 10) /
            10,
          known: known.length,
        },
      ];
    });
}

export interface RoomMove {
  session: DecisionSession;
  from: DecisionRoom;
  to: DecisionRoom;
  savedSeats: number;
}
/** Each recommendation is independent. Preserve time/teacher/groups; inspect BOTH systems. */
export function suggestRoomMoves(p: {
  rooms: DecisionRoom[];
  sessions: DecisionSession[];
  visibleIds: Set<string>;
  requiredTypes: Map<string, string | null>;
  availability: RoomsReportAvailability[];
  closures: RoomClosure[];
  settings?: RoomsReportSettings | null;
}): RoomMove[] {
  const active = p.sessions.filter((s) => !s.replaced_by_split);
  const result: RoomMove[] = [];
  for (const s of active) {
    if (
      !p.visibleIds.has(s.id) ||
      s.is_locked ||
      !s.teaching_assignment_id ||
      !(typeof s.expected_students === "number" && s.expected_students > 0)
    )
      continue;
    const required = p.requiredTypes.get(s.teaching_assignment_id);
    if (!required) continue;
    const from = p.rooms.find((r) => r.id === s.room_id);
    if (!from || typeof from.capacity !== "number") continue;
    const candidates = p.rooms.filter(
      (r) =>
        r.id !== from.id &&
        r.is_active === true &&
        r.room_type === required &&
        typeof r.capacity === "number" &&
        r.capacity >= s.expected_students! &&
        r.capacity < from.capacity! &&
        roomOpen(r.id, s.day_of_week, s.start_time, s.end_time, p.availability, p.settings) &&
        !roomClosed(r.id, s.day_of_week, s.start_time, s.end_time, p.closures) &&
        !active.some(
          (peer) =>
            peer.id !== s.id &&
            peer.room_id === r.id &&
            peer.day_of_week === s.day_of_week &&
            overlaps(s, peer),
        ),
    );
    candidates.sort((a, b) => a.capacity! - b.capacity! || a.id.localeCompare(b.id));
    if (candidates[0])
      result.push({
        session: s,
        from,
        to: candidates[0],
        savedSeats: from.capacity - candidates[0].capacity!,
      });
  }
  return result
    .sort((a, b) => b.savedSeats - a.savedSeats || a.session.id.localeCompare(b.session.id))
    .slice(0, 10);
}
