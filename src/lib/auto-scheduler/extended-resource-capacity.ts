import { context, minutes, type Snapshot } from "./compact.ts";
import { isRoomTypeCompatible } from "../scheduling/room-type-policy.ts";
import { extendedDayLimit } from "../scheduling/student-daily-policy.ts";

export interface ExtendedResourceConflict {
  totalTeachingMinutes: number;
  normalRoomMinutes: number;
  hallOnlyTeachingMinutes: number;
  normalHallMinutes: number;
  extensionMinutes: number;
  requiredHallLateSessions: number;
  requiredTotalLateSessions: number;
  maximumTotalLateSessions: number;
  capacityGapMinutes: number;
}
/** A necessary resource bound, independent of the candidate grid, teacher order or day cap.
 * When every session lasts at least the extension window, a student can attend
 * at most one late session per extended day. Enumerate disjoint student sets
 * within each cohort, then combine the exact (hall count, total count) frontiers.
 * Ignoring locks, overlaps and room windows only increases this upper bound.
 */
export function extendedResourceConflict(s: Snapshot): ExtendedResourceConflict | null {
  const cfg = s.settings;
  // Works for any integer extended-day limit >= 0: a student can attend at most
  // one late session per extended day, so `limit` late sessions in total.
  const limit = extendedDayLimit(cfg);
  if (
    !cfg.extended_day_policy_enabled ||
    !Number.isInteger(limit) ||
    limit < 0 ||
    !s.sessions.length
  )
    return null;
  const extension = minutes(cfg.day_end_time) - minutes(cfg.standard_day_end_time ?? "14:00:00");
  const normal = minutes(cfg.standard_day_end_time ?? "14:00:00") - minutes(cfg.day_start_time);
  if (extension <= 0 || normal < 0 || !Number.isFinite(extension + normal)) return null;
  if (
    s.sessions.some(
      (x) =>
        ![x.start_time, x.end_time].every((t) => /^\d{2}:\d{2}(:00)?$/.test(t)) ||
        minutes(x.end_time) - minutes(x.start_time) < extension,
    )
  )
    return null;
  const rooms = s.rooms.filter((r) => r.is_active),
    hallRooms = rooms.filter((r) => r.room_type === "lecture_hall");
  const days = new Set(cfg.working_days).size;
  if (!rooms.length || !hallRooms.length || !days) return null;
  const ctx = context(s),
    cohorts = new Map<string, Array<{ students: string[]; hall: number }>>();
  let total = 0,
    hallTotal = 0;
  for (const x of s.sessions) {
    const students = ctx.students(x);
    if (!students.length || students.some((p) => p.startsWith("cohort:"))) return null;
    const assignment = s.assignments.find((a) => a.id === x.teaching_assignment_id);
    if (!assignment) return null;
    const component = (s.components ?? []).find(
      (c) => c.id === assignment.plan_course_component_id,
    )?.component_type;
    const compatible = rooms.filter(
      (r) =>
        r.capacity >= x.expected_students &&
        isRoomTypeCompatible({
          componentType: component,
          requiredRoomType: assignment.required_room_type,
          roomType: r.room_type,
        }),
    );
    if (!compatible.length) return null;
    const hall = Number(compatible.every((r) => r.room_type === "lecture_hall"));
    const duration = minutes(x.end_time) - minutes(x.start_time);
    total += duration;
    hallTotal += hall * duration;
    const xs = cohorts.get(x.cohort_id) ?? [];
    xs.push({ students, hall });
    cohorts.set(x.cohort_id, xs);
  }
  const normalRoomMinutes = rooms.length * days * normal,
    normalHallMinutes = hallRooms.length * days * normal;
  const requiredHallLateSessions = Math.max(
    0,
    Math.ceil((hallTotal - normalHallMinutes) / extension),
  );
  const requiredTotalLateSessions = Math.max(0, Math.ceil((total - normalRoomMinutes) / extension));
  if (!requiredTotalLateSessions) return null;
  let combined = new Map<number, number>([[0, 0]]);
  for (const xs of cohorts.values()) {
    const students = [...new Set(xs.flatMap((x) => x.students))];
    // No truncated enumeration can become a proof.
    if (students.length > 12) return null;
    const choices = [
      ...new Map(
        xs.map((x) => {
          const mask = x.students.reduce((m, p) => m | (1 << students.indexOf(p)), 0);
          return [`${mask}:${x.hall}`, { mask, hall: x.hall }];
        }),
      ).values(),
    ];
    const dp = new Map<number, Map<number, number>>([[0, new Map([[0, 0]])]]),
      frontier = new Map<number, number>();
    for (let mask = 0; mask < 1 << students.length; mask++) {
      const states = dp.get(mask);
      if (!states) continue;
      for (const [h, n] of states) {
        frontier.set(h, Math.max(frontier.get(h) ?? -1, n));
        for (const c of choices)
          if (!(mask & c.mask)) {
            const next = mask | c.mask,
              ns = dp.get(next) ?? new Map<number, number>();
            ns.set(h + c.hall, Math.max(ns.get(h + c.hall) ?? -1, n + 1));
            dp.set(next, ns);
          }
      }
    }
    const next = new Map<number, number>();
    for (const [h, n] of combined)
      for (const [hh, nn] of frontier) next.set(h + hh, Math.max(next.get(h + hh) ?? -1, n + nn));
    combined = next;
  }
  const eligible = [...combined]
    .filter(([h]) => h * limit >= requiredHallLateSessions)
    .map(([, n]) => n * limit);
  if (!eligible.length) return null;
  const maximumTotalLateSessions = Math.max(...eligible);
  if (maximumTotalLateSessions >= requiredTotalLateSessions) return null;
  return {
    totalTeachingMinutes: total,
    normalRoomMinutes,
    hallOnlyTeachingMinutes: hallTotal,
    normalHallMinutes,
    extensionMinutes: extension,
    requiredHallLateSessions,
    requiredTotalLateSessions,
    maximumTotalLateSessions,
    capacityGapMinutes: total - normalRoomMinutes - maximumTotalLateSessions * extension,
  };
}
