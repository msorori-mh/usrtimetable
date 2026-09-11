/** Pure, bounded timetable compaction. No database writes. */
import {
  ATTENDANCE_POLICY,
  compareAttendance,
  measureAttendance,
  type AttendanceMetrics,
} from "./attendance-objective.ts";
export interface Session {
  id: string;
  updated_at: string;
  cohort_id: string;
  delivery_group_id: string;
  instructor_id: string;
  room_id: string;
  teaching_assignment_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  study_system: string;
  expected_students: number;
  is_locked: boolean;
  replaced_by_split?: boolean;
}
export interface Snapshot {
  sessions: Session[];
  cohorts: {
    id: string;
    program_id: string;
    level_id: string;
    study_system: string;
    term_id: string;
  }[];
  groups: {
    id: string;
    cohort_id: string;
    expected_students: number;
    active?: boolean;
    is_obsolete?: boolean;
  }[];
  members: { delivery_group_id: string; partition_id: string; cohort_id: string }[];
  partitions: { id: string; cohort_id: string; headcount: number; active: boolean }[];
  assignments: { id: string; required_room_type: string; is_active: boolean }[];
  rooms: {
    id: string;
    capacity: number;
    room_type: string;
    is_active: boolean;
    available_days: number[] | null;
    available_start_time: string | null;
    available_end_time: string | null;
  }[];
  instructors: {
    id: string;
    instructor_type_id: string | null;
    max_hours_per_day: number | null;
    is_active?: boolean;
  }[];
  types: { id: string; code: string; is_external: boolean }[];
  availability: {
    instructor_id: string;
    day_of_week: number;
    start_time: string;
    end_time: string;
    availability_type: string;
    is_preference?: boolean;
  }[];
  roomAvailability?: {
    room_id: string;
    day_of_week: number;
    start_time: string;
    end_time: string;
  }[];
  roomUnavailability?: {
    room_id: string;
    day_of_week: number | null;
    start_time: string | null;
    end_time: string | null;
    start_date: string | null;
    end_date: string | null;
  }[];
  templates: {
    study_system: string;
    day_of_week: number;
    start_time: string;
    end_time: string;
    is_active: boolean;
  }[];
  settings: {
    working_days: number[];
    day_start_time: string;
    day_end_time: string;
    slot_minutes: number;
    max_daily_hours_per_instructor: number;
    max_daily_hours_per_section: number;
    break_between_sessions_min: number;
  };
}
export type Metrics = AttendanceMetrics;
export interface Move {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  room_id: string;
}
export type SearchOutcome =
  "local_minimum" | "time_limit" | "candidate_limit" | "pass_limit" | "cancelled" | "empty";
export interface Proposal {
  before: Metrics;
  after: Metrics;
  moves: Move[];
  fingerprint: string;
  inputFingerprint: string;
  stopped: boolean;
  outcome?: SearchOutcome;
  evaluatedCandidates?: number;
}
export const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const time = (n: number) =>
  `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}:00`;
const duration = (s: Session) => minutes(s.end_time) - minutes(s.start_time);
export const fingerprint = (sessions: Session[]) =>
  JSON.stringify([...sessions].sort((a, b) => a.id.localeCompare(b.id)));
export const inputFingerprint = (s: Snapshot) => JSON.stringify({ ...s, sessions: [] });
const contexts = new WeakMap<
  Snapshot,
  {
    students: (x: Session) => string[];
    share: (a: Session, b: Session) => boolean;
    level: (x: Session) => string;
    weight: (id: string) => number;
  }
>();
export function context(s: Snapshot) {
  const cached = contexts.get(s);
  if (cached) return cached;
  const partitions = new Map(s.partitions.filter((p) => p.active).map((p) => [p.id, p]));
  const memberMap = new Map<string, string[]>();
  for (const m of s.members) {
    if (partitions.get(m.partition_id)?.cohort_id !== m.cohort_id) continue;
    memberMap.set(m.delivery_group_id, [
      ...new Set([...(memberMap.get(m.delivery_group_id) || []), m.partition_id]),
    ]);
  }
  const groups = new Map(s.groups.map((g) => [g.id, g]));
  const complete = (id: string) => {
    const g = groups.get(id),
      ids = memberMap.get(id) || [];
    return (
      !!g &&
      g.expected_students > 0 &&
      ids.length > 0 &&
      ids.every((p) => partitions.get(p)?.cohort_id === g.cohort_id) &&
      ids.reduce((n, p) => n + (partitions.get(p)?.headcount || 0), 0) === g.expected_students
    );
  };
  // If any scheduled group in a cohort is incomplete, measure/collide conservatively for the entire cohort.
  const fallback = new Set([
    ...s.sessions.filter((x) => !complete(x.delivery_group_id)).map((x) => x.cohort_id),
    ...s.groups
      .filter((g) => g.active !== false && !g.is_obsolete && !complete(g.id))
      .map((g) => g.cohort_id),
  ]);
  const students = (x: Session) =>
    fallback.has(x.cohort_id)
      ? [`cohort:${x.cohort_id}`]
      : memberMap.get(x.delivery_group_id) || [`cohort:${x.cohort_id}`];
  const share = (a: Session, b: Session) =>
    a.cohort_id === b.cohort_id &&
    (fallback.has(a.cohort_id) || students(a).some((p) => students(b).includes(p)));
  const cohorts = new Map(s.cohorts.map((c) => [c.id, c]));
  const level = (x: Session) => {
    const c = cohorts.get(x.cohort_id);
    return c ? `${c.program_id}|${c.level_id}|${c.study_system}|${c.term_id}` : x.cohort_id;
  };
  const weight = (id: string) =>
    partitions.get(id)?.headcount ||
    Math.max(
      1,
      ...s.groups.filter((g) => `cohort:${g.cohort_id}` === id).map((g) => g.expected_students),
    );
  const result = { students, share, level, weight };
  contexts.set(s, result);
  return result;
}
export function measure(s: Snapshot, sessions = s.sessions): Metrics {
  const ctx = context(s);
  return measureAttendance(
    sessions.map((x) => ({
      day: x.day_of_week,
      start: minutes(x.start_time),
      end: minutes(x.end_time),
      students: ctx.students(x),
      instructor: x.instructor_id,
      level: ctx.level(x),
    })),
    ctx.weight,
  );
}
export function better(a: Metrics, b: Metrics) {
  // A forbidden sixth day is repaired first. Ordinary improvements may not
  // sacrifice either side's gaps, short days or attendance for the aggregate.
  if (a.excessDaysOverFive < b.excessDaysOverFive) return true;
  if (a.excessDaysOverFive > b.excessDaysOverFive) return false;
  const protectedMetrics: Array<
    keyof Pick<
      Metrics,
      | "studentGapMinutes"
      | "instructorGapMinutes"
      | "worstStudentGapMinutes"
      | "worstInstructorGapMinutes"
      | "shortStudentDays"
      | "shortInstructorDays"
      | "studentAttendanceDays"
      | "instructorAttendanceDays"
    >
  > = [
    "studentGapMinutes",
    "instructorGapMinutes",
    "worstStudentGapMinutes",
    "worstInstructorGapMinutes",
    "shortStudentDays",
    "shortInstructorDays",
    "studentAttendanceDays",
    "instructorAttendanceDays",
  ];
  if (protectedMetrics.some((key) => a[key] > b[key])) return false;
  return compareAttendance(a, b) < 0;
}
export function feasible(
  s: Snapshot,
  sessions: Session[],
  candidate: Session,
  original: Session,
): boolean {
  const ctx = context(s),
    settings = s.settings,
    assignment = s.assignments.find((a) => a.id === candidate.teaching_assignment_id);
  const room = s.rooms.find((r) => r.id === candidate.room_id),
    teacher = s.instructors.find((t) => t.id === candidate.instructor_id);
  if (
    !assignment?.is_active ||
    !room?.is_active ||
    !teacher ||
    teacher.is_active === false ||
    candidate.is_locked ||
    duration(candidate) !== duration(original)
  )
    return false;
  const start = minutes(candidate.start_time),
    end = minutes(candidate.end_time),
    day = candidate.day_of_week;
  if (
    end <= start ||
    !settings.working_days.includes(day) ||
    start < minutes(settings.day_start_time) ||
    end > minutes(settings.day_end_time)
  )
    return false;
  if (
    room.capacity < candidate.expected_students ||
    (assignment.required_room_type && room.room_type !== assignment.required_room_type)
  )
    return false;
  if (room.available_days?.length && !room.available_days.includes(day)) return false;
  if (
    (room.available_start_time && start < minutes(room.available_start_time)) ||
    (room.available_end_time && end > minutes(room.available_end_time))
  )
    return false;
  const roomWindows = (s.roomAvailability || []).filter(
    (w) => w.room_id === room.id && w.day_of_week === day,
  );
  if (
    roomWindows.length &&
    !roomWindows.some((w) => start >= minutes(w.start_time) && end <= minutes(w.end_time))
  )
    return false;
  // Date-specific closures are still checked by the authoritative save RPC.
  if (
    (s.roomUnavailability || []).some(
      (w) =>
        w.room_id === room.id &&
        !w.start_date &&
        !w.end_date &&
        (w.day_of_week === null || w.day_of_week === day) &&
        start < (w.end_time ? minutes(w.end_time) : 1440) &&
        end > (w.start_time ? minutes(w.start_time) : 0),
    )
  )
    return false;
  if (
    !s.templates.some(
      (t) =>
        t.is_active &&
        t.day_of_week === day &&
        (t.study_system === candidate.study_system || t.study_system === "both") &&
        start >= minutes(t.start_time) &&
        end <= minutes(t.end_time),
    )
  )
    return false;
  const windows = (s.availability || []).filter(
    (a) => a.instructor_id === teacher.id && a.day_of_week === day && !a.is_preference,
  );
  const type = s.types.find((t) => t.id === teacher.instructor_type_id);
  if ((type?.is_external || type?.code === "from_other_college") && !windows.length) return false;
  const positiveWindows = windows.filter((w) => w.availability_type !== "unavailable");
  if (
    (positiveWindows.length &&
      !positiveWindows.some((w) => start >= minutes(w.start_time) && end <= minutes(w.end_time))) ||
    windows.some(
      (w) =>
        w.availability_type === "unavailable" &&
        start < minutes(w.end_time) &&
        end > minutes(w.start_time),
    )
  )
    return false;
  const others = sessions.filter((x) => x.id !== candidate.id),
    sameDay = others.filter((x) => x.day_of_week === day);
  if (
    sameDay.some(
      (x) =>
        start < minutes(x.end_time) &&
        end > minutes(x.start_time) &&
        (x.room_id === candidate.room_id ||
          x.instructor_id === teacher.id ||
          ctx.share(x, candidate)),
    )
  )
    return false;
  const requiredGap = Math.max(0, settings.break_between_sessions_min || 0);
  if (
    requiredGap &&
    sameDay.some(
      (x) =>
        (x.instructor_id === teacher.id || ctx.share(x, candidate)) &&
        start < minutes(x.end_time) + requiredGap &&
        end > minutes(x.start_time) - requiredGap,
    )
  )
    return false;
  const levelKey = ctx.level(candidate),
    days = new Set(others.filter((x) => ctx.level(x) === levelKey).map((x) => x.day_of_week));
  days.add(day);
  const beforeDays = new Set(
    sessions.filter((x) => ctx.level(x) === levelKey).map((x) => x.day_of_week),
  ).size;
  if (days.size > Math.max(ATTENDANCE_POLICY.maximumDays, beforeDays)) return false;
  // Existing violations may be repaired incrementally; never enlarge them.
  const teacherMinutes =
    sameDay.filter((x) => x.instructor_id === teacher.id).reduce((a, x) => a + duration(x), 0) +
    duration(candidate);
  const priorTeacher = sessions
    .filter((x) => x.day_of_week === day && x.instructor_id === teacher.id)
    .reduce((a, x) => a + duration(x), 0);
  if (
    teacherMinutes >
    Math.max(
      (teacher.max_hours_per_day || settings.max_daily_hours_per_instructor || 6) * 60,
      priorTeacher,
    )
  )
    return false;
  for (const p of ctx.students(candidate)) {
    const prior = sessions
      .filter((x) => x.day_of_week === day && ctx.students(x).includes(p))
      .reduce((a, x) => a + duration(x), 0);
    const next =
      sameDay.filter((x) => ctx.students(x).includes(p)).reduce((a, x) => a + duration(x), 0) +
      duration(candidate);
    if (next > Math.max((settings.max_daily_hours_per_section || 6) * 60, prior)) return false;
  }
  return true;
}
export interface CompactOptions {
  signal?: AbortSignal;
  maxPasses?: number;
  maxDurationMs?: number;
  maxCandidateEvaluations?: number;
  onProgress?: (moves: number, metrics: Metrics) => void;
}

/** Candidate grid plus exact adjacency anchors; a zero break permits end-to-start placement. */
export function compactSlots(
  s: Snapshot,
  old: Session,
): Array<{ day: number; start: string; end: string }> {
  const slots = new Map<string, { day: number; start: string; end: string }>();
  const length = duration(old);
  const step = Math.max(1, s.settings.slot_minutes || 60);
  for (const template of s.templates.filter(
    (t) => t.is_active && (t.study_system === old.study_system || t.study_system === "both"),
  )) {
    const begin = minutes(template.start_time),
      end = minutes(template.end_time);
    const anchors = new Set<number>([begin, end - length]);
    for (let start = begin; start + length <= end; start += step) anchors.add(start);
    for (const session of s.sessions.filter((x) => x.day_of_week === template.day_of_week)) {
      anchors.add(minutes(session.end_time));
      anchors.add(minutes(session.start_time) - length);
    }
    for (const start of anchors) {
      if (start < begin || start + length > end) continue;
      const slot = { day: template.day_of_week, start: time(start), end: time(start + length) };
      slots.set(`${slot.day}|${slot.start}`, slot);
    }
  }
  return [...slots.values()].sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));
}

export async function compact(s: Snapshot, options: CompactOptions = {}): Promise<Proposal> {
  const sessions = s.sessions.map((x) => ({ ...x })).sort((a, b) => a.id.localeCompare(b.id));
  const before = measure(s),
    moves: Move[] = [];
  let current = before,
    evaluated = 0;
  const budget = Math.max(0, Math.min(60000, options.maxDurationMs ?? 15000));
  const deadline = Date.now() + budget;
  const evaluationLimit = Math.max(
    0,
    options.maxCandidateEvaluations ?? Math.max(150000, budget * 100),
  );
  const passLimit = Math.max(1, Math.min(20, options.maxPasses ?? 5));
  const finished = (outcome: SearchOutcome): Proposal => ({
    before,
    after: current,
    moves,
    fingerprint: fingerprint(s.sessions),
    inputFingerprint: inputFingerprint(s),
    stopped: outcome === "cancelled",
    outcome,
    evaluatedCandidates: evaluated,
  });
  const stopReason = (): SearchOutcome | null =>
    options.signal?.aborted
      ? "cancelled"
      : Date.now() >= deadline
        ? "time_limit"
        : evaluated >= evaluationLimit
          ? "candidate_limit"
          : null;
  if (options.signal?.aborted) return finished("cancelled");
  if (!sessions.length) return finished("empty");
  const rooms = [...s.rooms].sort((a, b) => a.capacity - b.capacity || a.id.localeCompare(b.id));
  const roomCache = new Map<string, typeof rooms>();
  const roomsFor = (session: Session) => {
    const key = `${session.teaching_assignment_id}|${session.expected_students}`;
    if (!roomCache.has(key)) {
      const type = s.assignments.find(
        (a) => a.id === session.teaching_assignment_id,
      )?.required_room_type;
      roomCache.set(
        key,
        rooms.filter(
          (room) =>
            room.is_active &&
            room.capacity >= session.expected_students &&
            (!type || room.room_type === type),
        ),
      );
    }
    return roomCache.get(key)!;
  };
  const candidateCache = new Map<string, ReturnType<typeof compactSlots>>();
  for (const old of sessions) {
    const key = `${old.study_system}|${duration(old)}`;
    if (!candidateCache.has(key)) candidateCache.set(key, compactSlots(s, old));
  }
  const slotsFor = (old: Session) =>
    candidateCache.get(`${old.study_system}|${duration(old)}`) ?? [];
  const move = (value: Session): Move => ({
    id: value.id,
    day_of_week: value.day_of_week,
    start_time: value.start_time,
    end_time: value.end_time,
    room_id: value.room_id,
  });
  const progress = async () => {
    options.onProgress?.(moves.length, current);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  };
  const ctx = context(s);
  for (let pass = 0; pass < passLimit; pass++) {
    let changed = false;
    for (let i = 0; i < sessions.length; i++) {
      const reason = stopReason();
      if (reason) return finished(reason);
      const old = sessions[i];
      if (old.is_locked) continue;
      let best: Session | null = null,
        bestScore = current;
      candidateSearch: for (const slot of slotsFor(old)) {
        if (slot.day === old.day_of_week && slot.start === old.start_time) continue;
        for (const room of roomsFor(old)) {
          if (stopReason()) break candidateSearch;
          evaluated++;
          const candidate = {
            ...old,
            day_of_week: slot.day,
            start_time: slot.start,
            end_time: slot.end,
            room_id: room.id,
          };
          if (!feasible(s, sessions, candidate, old)) continue;
          const trial = [...sessions];
          trial[i] = candidate;
          const score = measure(s, trial);
          if (better(score, current) && compareAttendance(score, bestScore) < 0) {
            best = candidate;
            bestScore = score;
          }
          break; // Room identity does not change the attendance objective.
        }
      }
      if (best) {
        sessions[i] = best;
        current = bestScore;
        changed = true;
        moves.push(move(best));
      }
      await progress();
    }
    if (changed) continue;
    // At a local minimum, try a legal preparatory relocation followed by the target.
    // Applies to student AND instructor gaps, short days and attendance days, not only a sixth day.
    let pairFound = false;
    const targets = sessions
      .filter((x) => !x.is_locked)
      .sort(
        (a, b) =>
          (current.levelDays[ctx.level(b)] ?? 0) - (current.levelDays[ctx.level(a)] ?? 0) ||
          a.id.localeCompare(b.id),
      );
    pairSearch: for (const target of targets) {
      for (const slot of slotsFor(target)) {
        for (const room of roomsFor(target)) {
          const reason = stopReason();
          if (reason) return finished(reason);
          const candidate = {
            ...target,
            day_of_week: slot.day,
            start_time: slot.start,
            end_time: slot.end,
            room_id: room.id,
          };
          if (
            candidate.day_of_week === target.day_of_week &&
            candidate.start_time === target.start_time &&
            candidate.room_id === target.room_id
          )
            continue;
          evaluated++;
          const blockers = sessions.filter(
            (x) =>
              x.id !== target.id &&
              x.day_of_week === slot.day &&
              minutes(slot.start) < minutes(x.end_time) &&
              minutes(slot.end) > minutes(x.start_time) &&
              (x.instructor_id === target.instructor_id ||
                ctx.share(x, target) ||
                x.room_id === room.id),
          );
          if (blockers.length !== 1 || blockers[0].is_locked) continue;
          const blocker = blockers[0];
          if (
            !feasible(
              s,
              sessions.filter((x) => x.id !== blocker.id),
              candidate,
              target,
            )
          )
            continue;
          for (const alt of slotsFor(blocker)) {
            for (const altRoom of roomsFor(blocker)) {
              const reason = stopReason();
              if (reason) return finished(reason);
              evaluated++;
              const relocated = {
                ...blocker,
                day_of_week: alt.day,
                start_time: alt.start,
                end_time: alt.end,
                room_id: altRoom.id,
              };
              if (!feasible(s, sessions, relocated, blocker)) continue;
              const intermediate = sessions.map((x) => (x.id === blocker.id ? relocated : x));
              if (!feasible(s, intermediate, candidate, target)) continue;
              const final = intermediate.map((x) => (x.id === target.id ? candidate : x)),
                score = measure(s, final);
              if (!better(score, current)) continue;
              sessions.splice(0, sessions.length, ...final);
              current = score;
              moves.push(move(relocated), move(candidate));
              pairFound = true;
              break pairSearch;
            }
          }
        }
        await progress();
      }
    }
    if (!pairFound) return finished("local_minimum");
    await progress();
  }
  return finished(stopReason() ?? "pass_limit");
}
