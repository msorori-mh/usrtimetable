import type { ModelData } from "highs";
import {
  compactSlots,
  context,
  feasible,
  minutes,
  sessionStudentLoadKind,
  type Session,
  type Snapshot,
} from "./compact.ts";
import { extendedDayLimit, studentDailyPolicy } from "../scheduling/student-daily-policy.ts";
import { roomTypeRank } from "../scheduling/room-type-policy.ts";
import {
  instructorAttendanceDayCap,
  instructorAttendanceTarget,
  instructorsOverAttendanceDayCap,
} from "./attendance-objective.ts";

type Candidate = { session: Session; pool: number };
type Term = [number, number];
const INF = 1e30;
const duration = (s: Session) => minutes(s.end_time) - minutes(s.start_time);
const sameTime = (a: Session, b: Session) =>
  a.day_of_week === b.day_of_week && a.start_time === b.start_time && a.end_time === b.end_time;

/** Equivalent rooms are interchangeable interval resources; locked rooms remain separate. */
function roomPools(snapshot: Snapshot) {
  const locked = new Set(snapshot.sessions.filter((s) => s.is_locked).map((s) => s.room_id));
  if (snapshot.generationScope) {
    const existing = new Set(snapshot.generationScope.existingIds);
    for (const s of snapshot.sessions) if (existing.has(s.id)) locked.add(s.room_id);
  }
  const groups = new Map<string, Snapshot["rooms"]>();
  for (const r of snapshot.rooms.filter((r) => r.is_active)) {
    const windows = (snapshot.roomAvailability ?? [])
      .filter((x) => x.room_id === r.id)
      .map((x) => JSON.stringify([x.day_of_week, x.start_time, x.end_time]))
      .sort();
    const closures = (snapshot.roomUnavailability ?? [])
      .filter((x) => x.room_id === r.id)
      .map((x) =>
        JSON.stringify([x.day_of_week, x.start_time, x.end_time, x.start_date, x.end_date]),
      )
      .sort();
    const key = JSON.stringify([
      r.room_type,
      r.capacity,
      r.available_days,
      r.available_start_time,
      r.available_end_time,
      windows,
      closures,
      locked.has(r.id) ? r.id : null,
    ]);
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.values()];
}

/** Build a complete simultaneous placement model on the approved candidate grid.
 * Grid infeasibility is NOT a proof that another attendance day is necessary. */
export function buildJointModel(snapshot: Snapshot, dayCap: 3 | 4 | 5, repair = false) {
  const ctx = context(snapshot);
  if (
    !snapshot.sessions.length ||
    snapshot.sessions.length > 4096 ||
    new Set(snapshot.sessions.map((s) => s.id)).size !== snapshot.sessions.length
  )
    throw new Error("INVALID_JOINT_SCOPE");
  if (snapshot.sessions.some((s) => ctx.students(s).some((p) => p.startsWith("cohort:"))))
    throw new Error("INCOMPLETE_STUDENT_PARTITIONS");
  const pools = roomPools(snapshot);
  const candidates: Candidate[] = [];
  const generationWeights = new Map<number, number>();
  const cost: number[] = [],
    lower: number[] = [],
    upper: number[] = [],
    integer: number[] = [];
  const rowLower: number[] = [],
    rowUpper: number[] = [],
    starts = [0],
    indices: number[] = [],
    values: number[] = [];
  const variable = (weight = 0, max = 1, integral = 1) => {
    const i = cost.length;
    cost.push(weight);
    lower.push(0);
    upper.push(max);
    integer.push(integral);
    return i;
  };
  const row = (terms: Term[], lo = -INF, hi = INF) => {
    const merged = new Map<number, number>();
    for (const [i, v] of terms) merged.set(i, (merged.get(i) ?? 0) + v);
    for (const [i, v] of merged)
      if (v) {
        indices.push(i);
        values.push(v);
      }
    rowLower.push(lo);
    rowUpper.push(hi);
    starts.push(indices.length);
  };
  for (const original of snapshot.sessions) {
    const slots = original.is_locked
      ? [
          {
            day: original.day_of_week,
            start: original.start_time,
            end: original.end_time,
          },
        ]
      : compactSlots(snapshot, original);
    const entries: Term[] = [];
    for (const slot of slots)
      for (let pool = 0; pool < pools.length; pool++) {
        if (original.is_locked && !pools[pool].some((r) => r.id === original.room_id)) continue;
        const candidate = {
          ...original,
          is_locked: false,
          room_id: pools[pool][0].id,
          day_of_week: slot.day,
          start_time: slot.start,
          end_time: slot.end,
        };
        if (!feasible(snapshot, [], candidate, { ...original, is_locked: false })) continue;
        const i = variable(sameTime(original, candidate) ? 0 : 1);
        const required = snapshot.assignments.find((a) => a.id === original.teaching_assignment_id);
        const fallback =
          roomTypeRank({
            componentType: sessionStudentLoadKind(snapshot, original),
            requiredRoomType: required?.required_room_type,
            roomType: pools[pool][0].room_type,
          }) ?? 0;
        cost[i] += fallback * 10000;
        generationWeights.set(
          i,
          fallback * 100 +
            (sameTime(original, candidate) && pools[pool].some((r) => r.id === original.room_id)
              ? 0
              : 1),
        );
        candidates.push({
          session: { ...candidate, is_locked: original.is_locked },
          pool,
        });
        entries.push([i, 1]);
        if (candidates.length > 200000) throw new Error("JOINT_MODEL_SIZE_LIMIT");
      }
    if (!entries.length) throw new Error("JOINT_GRID_HAS_NO_PLACEMENT");
    row(entries, 1, 1);
  }
  const gap = Math.max(0, snapshot.settings.break_between_sessions_min || 0);
  const boundaries = new Map<number, number[]>();
  for (const { session: x } of candidates) {
    const xs = boundaries.get(x.day_of_week) ?? [];
    xs.push(minutes(x.start_time), minutes(x.end_time), minutes(x.end_time) + gap);
    boundaries.set(x.day_of_week, xs);
  }
  for (const [day, xs] of boundaries)
    boundaries.set(
      day,
      [...new Set(xs)].sort((a, b) => a - b),
    );
  const cells = new Map<string, { terms: Term[]; capacity: number }>();
  const daily = new Map<
    string,
    { terms: Term[]; kind: "student" | "teacher"; person: string; day: number }
  >();
  const levels = new Map<string, Map<number, Term[]>>();
  const add = (
    key: string,
    person: string,
    kind: "student" | "teacher",
    day: number,
    i: number,
  ) => {
    const d = daily.get(key) ?? { terms: [], kind, person, day };
    d.terms.push([i, 1]);
    daily.set(key, d);
  };
  for (let i = 0; i < candidates.length; i++) {
    const { session: x, pool } = candidates[i];
    const a = minutes(x.start_time),
      b = minutes(x.end_time),
      day = x.day_of_week;
    const persons = ctx.students(x);
    const resources = [
      { key: `room:${pool}`, capacity: pools[pool].length, end: b },
      { key: `teacher:${x.instructor_id}`, capacity: 1, end: b + gap },
      ...persons.map((p) => ({
        key: `student:${p}`,
        capacity: 1,
        end: b + gap,
      })),
    ];
    for (const r of resources)
      for (const t of boundaries.get(day)!) {
        if (t < a || t >= r.end) continue;
        const key = `${r.key}|${day}|${t}`;
        const cell = cells.get(key) ?? { terms: [], capacity: r.capacity };
        cell.terms.push([i, 1]);
        cells.set(key, cell);
      }
    for (const p of persons) add(`student:${p}|${day}`, p, "student", day, i);
    add(`teacher:${x.instructor_id}|${day}`, x.instructor_id, "teacher", day, i);
    for (const level of ctx.levels(x)) {
      const days = levels.get(level) ?? new Map<number, Term[]>();
      days.set(day, [...(days.get(day) ?? []), [i, 1]]);
      levels.set(level, days);
    }
  }
  for (const cell of cells.values()) row(cell.terms, -INF, cell.capacity);
  if (snapshot.generationScope) {
    const existing = new Set(snapshot.generationScope.existingIds);
    // A changed time is a relocation; equivalent-room allocation is checked again on decode.
    const changed: Term[] = [];
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      const old = snapshot.sessions.find((s) => s.id === candidate.session.id)!;
      if (
        existing.has(old.id) &&
        (!sameTime(old, candidate.session) ||
          !pools[candidate.pool].some((r) => r.id === old.room_id))
      )
        changed.push([i, 1]);
    }
    row(changed, -INF, snapshot.generationScope.maxRelocations);
  }
  for (const days of levels.values()) {
    const enabled: Term[] = [];
    for (const terms of days.values()) {
      const y = variable();
      enabled.push([y, 1]);
      const max = new Set(terms.map(([i]) => candidates[i].session.id)).size;
      row([...terms, [y, -max]], -INF, 0);
    }
    row(repair ? [...enabled, [variable(100000000, 6), -1]] : enabled, -INF, dayCap);
  }
  const extended = new Map<string, Term[]>();
  const instructorDays = new Map<string, Term[]>();
  // Generation omits costly span optimization but retains attendance preferences.
  for (const { terms, kind, person, day } of daily.values()) {
    const student = kind === "student";
    const policy = studentDailyPolicy(snapshot.settings);
    const capMinutes = student
      ? policy.totalMinutes
      : (snapshot.instructors.find((t) => t.id === person)?.max_hours_per_day ||
          snapshot.settings.max_daily_hours_per_instructor ||
          6) * 60;
    row(
      terms.map(([i]) => [i, duration(candidates[i].session)]),
      -INF,
      capMinutes,
    );
    if (student) {
      // Theory-like / practical subset caps from the shared student daily policy.
      const subsets: Array<
        [import("../scheduling/student-daily-policy.ts").StudentLoadKind, number]
      > = [
        ["theory", policy.theoryMinutes],
        ["practical", policy.practicalMinutes],
      ];
      for (const [subsetKind, subsetCap] of subsets) {
        if (subsetCap >= capMinutes) continue;
        const subset = terms.filter(
          ([i]) => sessionStudentLoadKind(snapshot, candidates[i].session) === subsetKind,
        );
        if (!subset.length) continue;
        row(
          subset.map(([i]): Term => [i, duration(candidates[i].session)]),
          -INF,
          subsetCap,
        );
      }
    }
    const maxDaily = Math.min(
      new Set(terms.map(([i]) => candidates[i].session.id)).size,
      Math.floor(capMinutes / Math.min(...terms.map(([i]) => duration(candidates[i].session)))),
    );
    const y = variable(student ? 300 : 30);
    if (!student) {
      instructorDays.set(person, [...(instructorDays.get(person) ?? []), [y, 1]]);
      generationWeights.set(y, 30);
    }
    row([...terms, [y, -maxDaily]], -INF, 0);
    row([...terms, [y, -1]], 0, INF);
    const singleLecture = variable(student ? 2000 : 3000);
    row([...terms, [y, -2], [singleLecture, 1]], 0, INF);
    if (!student) generationWeights.set(singleLecture, 3000);
    if (student) {
      if (snapshot.settings.extended_day_policy_enabled) {
        const late = terms.filter(
          ([i]) =>
            minutes(candidates[i].session.end_time) >
            minutes(snapshot.settings.standard_day_end_time ?? "14:00:00"),
        );
        if (late.length) {
          const z = variable();
          const minLateDuration = Math.min(...late.map(([i]) => duration(candidates[i].session)));
          const maxLate = Math.min(
            maxDaily,
            Math.ceil(
              (minutes(snapshot.settings.day_end_time) -
                minutes(snapshot.settings.standard_day_end_time ?? "14:00:00")) /
                minLateDuration,
            ),
          );
          row([...late, [z, -maxLate]], -INF, 0);
          extended.set(person, [...(extended.get(person) ?? []), [z, 1]]);
        }
      }
    }
    // With total teaching time fixed, minimizing daily spans minimizes idle time.
    const weight = student ? 1 : 0.5,
      start = variable(-weight, 1440, 0),
      end = variable(weight, 1440, 0);
    row(
      [
        [start, 1],
        [y, -1440],
      ],
      -INF,
      0,
    );
    row(
      [
        [end, 1],
        [y, -1440],
      ],
      -INF,
      0,
    );
    row(
      [[end, 1], [start, -1], ...terms.map(([i]): Term => [i, -duration(candidates[i].session)])],
      0,
      INF,
    );
    const points = boundaries.get(day)!;
    for (let k = 0; k < points.length - 1; k++) {
      const occupied = terms.filter(
        ([i]) =>
          minutes(candidates[i].session.start_time) <= points[k] &&
          minutes(candidates[i].session.end_time) > points[k],
      );
      if (!occupied.length) continue;
      row([[end, 1], ...occupied.map(([i]): Term => [i, -points[k + 1]])], 0, INF);
      row([[start, 1], ...occupied.map(([i]): Term => [i, 1440])], -INF, points[k] + 1440);
    }
  }
  for (const [id, enabled] of instructorDays) {
    const instructor = snapshot.instructors.find((t) => t.id === id)!;
    const cap = instructorAttendanceDayCap(
      instructor.target_attendance_days_per_week,
      undefined,
      instructor.max_attendance_days_per_week,
    );
    row(enabled, -INF, cap); // Hard even in repair mode.
    const hours = snapshot.sessions
      .filter((s) => s.instructor_id === id)
      .reduce((sum, s) => sum + duration(s) / 60, 0);
    const target = instructorAttendanceTarget(hours, instructor.target_attendance_days_per_week);
    const excess = variable(3000, 6);
    generationWeights.set(excess, 3000);
    row([...enabled, [excess, -1]], -INF, target);
    if (instructor.target_attendance_days_per_week != null) {
      const shortfall = variable(3000, 6);
      generationWeights.set(shortfall, 3000);
      row([...enabled, [shortfall, 1]], target, INF);
    }
  }
  for (const xs of extended.values())
    row(
      repair ? [...xs, [variable(100000000, 6), -1]] : xs,
      -INF,
      extendedDayLimit(snapshot.settings),
    );
  if (indices.length > 10000000) throw new Error("JOINT_MODEL_SIZE_LIMIT");
  const model: ModelData = {
    numCols: cost.length,
    numRows: rowLower.length,
    colCost: cost,
    colLower: lower,
    colUpper: upper,
    rowLower,
    rowUpper,
    integrality: Int32Array.from(integer),
    matrix: {
      format: "csr",
      numCols: cost.length,
      numRows: rowLower.length,
      starts: Int32Array.from(starts),
      indices: Int32Array.from(indices),
      values: Float64Array.from(values),
    },
  };
  const decode = (solution: ArrayLike<number>): Session[] => {
    const selected = candidates.filter((_, i) => solution[i] > 0.5);
    if (
      selected.length !== snapshot.sessions.length ||
      new Set(selected.map((x) => x.session.id)).size !== selected.length
    )
      throw new Error("JOINT_WITNESS_INCOMPLETE");
    const occupied = new Map<string, number>();
    const original = new Map(snapshot.sessions.map((x) => [x.id, x]));
    const result: Session[] = [];
    for (const { session: x, pool } of selected.sort(
      (a, b) =>
        a.session.day_of_week - b.session.day_of_week ||
        minutes(a.session.start_time) - minutes(b.session.start_time),
    )) {
      const old = original.get(x.id)!;
      const room = [...pools[pool]]
        .sort((a, b) => Number(b.id === old.room_id) - Number(a.id === old.room_id))
        .find((r) => (occupied.get(`${r.id}|${x.day_of_week}`) ?? 0) <= minutes(x.start_time));
      if (!room) throw new Error("JOINT_ROOM_ALLOCATION_FAILED");
      occupied.set(`${room.id}|${x.day_of_week}`, minutes(x.end_time));
      result.push({
        ...old,
        day_of_week: x.day_of_week,
        start_time: x.start_time,
        end_time: x.end_time,
        room_id: room.id,
      });
    }
    if (!validateJointPlan(snapshot, result, dayCap)) throw new Error("JOINT_WITNESS_REJECTED");
    return result;
  };
  return {
    model,
    generationCost: Float64Array.from(cost.map((_, i) => generationWeights.get(i) ?? 0)),
    decode,
    candidateCount: candidates.length,
    candidates,
    pools,
    startSolution: {
      indices: Int32Array.from(candidates.map((_, i) => i)),
      values: Float64Array.from(
        candidates.map((c) => {
          const old = snapshot.sessions.find((x) => x.id === c.session.id)!;
          return sameTime(old, c.session) && pools[c.pool].some((r) => r.id === old.room_id)
            ? 1
            : 0;
        }),
      ),
    },
  };
}

/** Independent final-state verification; no sequential intermediate-state assumptions. */
export function validateJointPlan(
  snapshot: Snapshot,
  sessions: Session[],
  dayCap: number,
): boolean {
  if (
    sessions.length !== snapshot.sessions.length ||
    new Set(sessions.map((x) => x.id)).size !== sessions.length
  )
    return false;
  const old = new Map(snapshot.sessions.map((x) => [x.id, x]));
  if (instructorsOverAttendanceDayCap(sessions, snapshot.instructors).length) return false;
  const ctx = context(snapshot);
  const days = new Map<string, Set<number>>();
  if (snapshot.generationScope) {
    const existing = new Set(snapshot.generationScope.existingIds);
    const moved = sessions.filter((s) => {
      const before = old.get(s.id);
      return before && existing.has(s.id) && (!sameTime(before, s) || before.room_id !== s.room_id);
    }).length;
    if (moved > snapshot.generationScope.maxRelocations) return false;
  }
  for (const x of sessions) {
    const before = old.get(x.id);
    if (!before) return false;
    if (
      [
        "cohort_id",
        "delivery_group_id",
        "instructor_id",
        "teaching_assignment_id",
        "study_system",
        "expected_students",
        "is_locked",
      ].some((k) => x[k as keyof Session] !== before[k as keyof Session]) ||
      duration(x) !== duration(before)
    )
      return false;
    if (before.is_locked && (!sameTime(before, x) || x.room_id !== before.room_id)) return false;
    if (!feasible(snapshot, sessions, { ...x, is_locked: false }, { ...before, is_locked: false }))
      return false;
    for (const level of ctx.levels(x)) {
      const set = days.get(level) ?? new Set<number>();
      set.add(x.day_of_week);
      days.set(level, set);
    }
  }
  if ([...days.values()].some((ds) => ds.size > dayCap)) return false;
  const dailyPolicy = studentDailyPolicy(snapshot.settings);
  const loads = new Map<string, number>();
  for (const x of sessions) {
    const teacher = snapshot.instructors.find((t) => t.id === x.instructor_id);
    const kind = sessionStudentLoadKind(snapshot, x);
    const subsetCap =
      kind === "practical" ? dailyPolicy.practicalMinutes : dailyPolicy.theoryMinutes;
    const entities = [
      {
        key: `teacher:${x.instructor_id}`,
        capMinutes:
          (teacher?.max_hours_per_day || snapshot.settings.max_daily_hours_per_instructor || 6) *
          60,
      },
      ...ctx.students(x).flatMap((p) => [
        { key: `student:${p}`, capMinutes: dailyPolicy.totalMinutes },
        { key: `student:${p}|${kind}`, capMinutes: subsetCap },
      ]),
    ];
    for (const { key, capMinutes } of entities) {
      const k = `${key}|${x.day_of_week}`,
        n = (loads.get(k) ?? 0) + duration(x);
      if (n > capMinutes) return false;
      loads.set(k, n);
    }
  }
  if (snapshot.settings.extended_day_policy_enabled) {
    const late = new Map<string, Set<number>>();
    for (const x of sessions)
      if (minutes(x.end_time) > minutes(snapshot.settings.standard_day_end_time ?? "14:00:00"))
        for (const p of ctx.students(x)) {
          const ds = late.get(p) ?? new Set<number>();
          ds.add(x.day_of_week);
          late.set(p, ds);
        }
    if ([...late.values()].some((ds) => ds.size > extendedDayLimit(snapshot.settings)))
      return false;
  }
  return true;
}
