/**
 * M-14: deterministic synthetic generator snapshot (seeded PRNG) used by the
 * determinism test and the micro-benchmark. Exercises partitions, shared
 * lectures, practical rooms/fallback, room windows/closures, external busy
 * slots, instructor availability, locks, extended days and generation scope.
 */
import type { Session, Snapshot } from "../../src/lib/auto-scheduler/compact.ts";

function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function syntheticSnapshot(opts: {
  sessions: number;
  seed?: number;
  extended?: boolean;
  scope?: boolean;
  /** Bias toward late sessions, a 1-day extended limit, tighter student load and inactive rows. */
  stress?: boolean;
}): Snapshot {
  const rnd = prng(opts.seed ?? 7);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
  const cohortCount = Math.max(2, Math.ceil(opts.sessions / 12));
  const cohorts = Array.from({ length: cohortCount }, (_, i) => ({
    id: `c${i}`,
    program_id: `p${i % 3}`,
    level_id: `l${i % 4}`,
    study_system: "regular",
    term_id: "t",
  }));
  const groups: Snapshot["groups"] = [];
  const partitions: Snapshot["partitions"] = [];
  const members: Snapshot["members"] = [];
  for (const c of cohorts) {
    for (let g = 0; g < 2; g++) {
      const id = `${c.id}g${g}`;
      groups.push({ id, cohort_id: c.id, expected_students: 25 });
      partitions.push({ id: `${id}p`, cohort_id: c.id, headcount: 25, active: true });
      members.push({ delivery_group_id: id, partition_id: `${id}p`, cohort_id: c.id });
    }
  }
  const components = [
    { id: "theory", component_type: "theory" },
    { id: "practical", component_type: "practical" },
  ];
  const instructorCount = Math.max(2, Math.ceil(opts.sessions / 6));
  const instructors = Array.from({ length: instructorCount }, (_, i) => ({
    id: `i${i}`,
    instructor_type_id: i % 7 === 0 ? "ext" : "perm",
    max_hours_per_day: 6,
    is_active: true,
    target_attendance_days_per_week: i % 5 === 0 ? 4 : null,
    max_attendance_days_per_week: null,
  }));
  const assignments: Snapshot["assignments"] = [];
  const sessions: Session[] = [];
  const startHours = opts.stress ? [8, 11, 12, 13, 13, 14, 14] : [8, 9, 10, 11, 12, 13, 14];
  for (let k = 0; k < opts.sessions; k++) {
    const group = groups[k % groups.length];
    const practical = k % 4 === 3;
    const aid = `a${k}`;
    assignments.push({
      id: aid,
      required_room_type: practical ? "computer_lab" : "lecture_hall",
      is_active: !(opts.stress && k % 23 === 5),
      plan_course_component_id: practical ? "practical" : "theory",
    });
    const len = practical ? 2 : pick([1, 2]);
    const h = Math.min(16 - len, pick(startHours));
    sessions.push({
      id: `s${String(k).padStart(5, "0")}`,
      updated_at: "t0",
      cohort_id: group.cohort_id,
      delivery_group_id: group.id,
      instructor_id: instructors[k % instructors.length].id,
      room_id: practical ? `lab${k % 3}` : `r${k % 6}`,
      teaching_assignment_id: aid,
      day_of_week: pick([0, 1, 2, 3, 4]),
      start_time: `${String(h).padStart(2, "0")}:00:00`,
      end_time: `${String(h + len).padStart(2, "0")}:00:00`,
      study_system: "regular",
      expected_students: 25,
      is_locked: k % 17 === 0,
    });
  }
  const rooms: Snapshot["rooms"] = [
    ...Array.from({ length: 6 }, (_, i) => ({
      id: `r${i}`,
      capacity: i < 3 ? 40 : 60,
      room_type: "lecture_hall",
      is_active: !(opts.stress && i === 2),
      available_days: i === 1 ? [0, 1, 2] : null,
      available_start_time: null,
      available_end_time: i === 5 ? "14:00:00" : null,
    })),
    ...Array.from({ length: 3 }, (_, i) => ({
      id: `lab${i}`,
      capacity: 30,
      room_type: "computer_lab",
      is_active: true,
      available_days: null,
      available_start_time: null,
      available_end_time: null,
    })),
  ];
  return {
    sessions,
    cohorts,
    groups,
    members,
    partitions,
    sharedLectures: [{ anchor_group_id: groups[0].id, member_group_id: groups[2].id }],
    assignments,
    components,
    rooms,
    instructors,
    types: [
      { id: "perm", code: "permanent", is_external: false },
      { id: "ext", code: "from_other_college", is_external: true },
    ],
    availability: instructors
      .filter((t) => t.instructor_type_id === "ext")
      .flatMap((t) =>
        [0, 1, 2, 3, 4].map((day) => ({
          instructor_id: t.id,
          day_of_week: day,
          start_time: "08:00:00",
          end_time: "16:00:00",
          availability_type: "available",
        })),
      ),
    roomAvailability: [0, 1, 2, 3].map((day) => ({
      room_id: "r4",
      day_of_week: day,
      start_time: "08:00:00",
      end_time: "15:00:00",
    })),
    roomUnavailability: [
      {
        room_id: "r3",
        day_of_week: 2,
        start_time: "10:00:00",
        end_time: "12:00:00",
        start_date: null,
        end_date: null,
      },
    ],
    externalBusy: [
      { instructor_id: "i1", day_of_week: 1, start_time: "08:00:00", end_time: "10:00:00" },
    ],
    templates: [0, 1, 2, 3, 4].map((day) => ({
      study_system: "regular",
      day_of_week: day,
      start_time: "08:00:00",
      end_time: "16:00:00",
      is_active: true,
    })),
    settings: {
      working_days: [0, 1, 2, 3, 4],
      day_start_time: "08:00:00",
      day_end_time: "16:00:00",
      slot_minutes: 60,
      max_daily_hours_per_instructor: 6,
      max_daily_hours_per_section: opts.stress ? 4 : 6,
      max_daily_theory_hours_per_section: opts.stress ? 3 : null,
      break_between_sessions_min: opts.stress ? 10 : 0,
      extended_day_policy_enabled: opts.extended ?? true,
      standard_day_end_time: "14:00:00",
      max_extended_days_per_partition: opts.stress ? 1 : 2,
    },
    ...(opts.scope
      ? {
          generationScope: {
            existingIds: sessions.slice(0, Math.floor(sessions.length / 2)).map((s) => s.id),
            maxRelocations: 3,
          },
        }
      : {}),
  };
}

/** Plain, comparable representation of a built model. */
export function modelDigest(built: {
  model: {
    numCols: number;
    numRows: number;
    colCost: number[];
    colLower: number[];
    colUpper: number[];
    rowLower: number[];
    rowUpper: number[];
    integrality: Int32Array;
    matrix: { starts: Int32Array; indices: Int32Array; values: Float64Array };
  };
  generationCost: Float64Array;
  candidates: Array<{ session: Session; pool: number }>;
  startSolution: { values: Float64Array };
}) {
  const m = built.model;
  return {
    numCols: m.numCols,
    numRows: m.numRows,
    colCost: [...m.colCost],
    colLower: [...m.colLower],
    colUpper: [...m.colUpper],
    rowLower: [...m.rowLower],
    rowUpper: [...m.rowUpper],
    integrality: [...m.integrality],
    starts: [...m.matrix.starts],
    indices: [...m.matrix.indices],
    values: [...m.matrix.values],
    generationCost: [...built.generationCost],
    candidates: built.candidates.map((c) => [
      c.session.id,
      c.session.day_of_week,
      c.session.start_time,
      c.session.end_time,
      c.session.room_id,
      c.pool,
    ]),
    start: [...built.startSolution.values],
  };
}
