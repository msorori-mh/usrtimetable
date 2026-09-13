/** Complete finite-domain search. Exhaustion, never a timeout, authorizes relaxation. */
import { context, feasible, minutes, type Session, type Snapshot } from "./compact.ts";

export type AttendanceSearchStatus = "feasible" | "infeasible" | "unknown";
export interface AttendanceAttempt {
  days: 3 | 4 | 5;
  status: AttendanceSearchStatus;
  reason: "solution" | "exhausted" | "capacity" | "budget" | "cancelled" | "invalid_input";
  evaluated: number;
}
export interface AttendanceSearchResult {
  status: AttendanceSearchStatus;
  days: 3 | 4 | 5 | null;
  attempts: AttendanceAttempt[];
  sessions: Session[];
  /** Fixed assignments/durations/locks; all unlocked sessions and rooms are movable. */
  scope: "all_sessions_minute_domain";
}
export interface AttendanceSearchOptions {
  signal?: AbortSignal;
  maxDurationMs?: number;
  maxEvaluations?: number;
  preferExisting?: boolean;
  onAttempt?: (attempt: AttendanceAttempt) => void;
}
const time = (n: number) =>
  `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}:00`;
const length = (s: Session) => minutes(s.end_time) - minutes(s.start_time);

/** Search every minute, including off-grid placements: a coarse slot grid cannot prove UNSAT. */
export async function searchAttendance(
  snapshot: Snapshot,
  options: AttendanceSearchOptions = {},
): Promise<AttendanceSearchResult> {
  const started = Date.now();
  const budget = Math.max(0, options.maxDurationMs ?? 60000);
  const quick = await runAttendanceSearch(
    snapshot,
    {
      ...options,
      onAttempt: undefined,
      maxDurationMs: Math.min(8000, budget / 3),
      maxEvaluations: Math.min(options.maxEvaluations ?? 1000000, 200000),
    },
    Math.max(1, snapshot.settings.slot_minutes || 60),
  );
  if (quick.status !== "unknown") {
    quick.attempts.forEach((a) => options.onAttempt?.(a));
    return quick;
  }
  return runAttendanceSearch(
    snapshot,
    { ...options, maxDurationMs: Math.max(0, budget - (Date.now() - started)) },
    1,
  );
}

async function runAttendanceSearch(
  snapshot: Snapshot,
  options: AttendanceSearchOptions,
  step: number,
): Promise<AttendanceSearchResult> {
  const attempts: AttendanceAttempt[] = [];
  const finish = (
    status: AttendanceSearchStatus,
    days: 3 | 4 | 5 | null,
    sessions: Session[] = [],
  ): AttendanceSearchResult => ({
    status,
    days,
    sessions,
    attempts,
    scope: "all_sessions_minute_domain",
  });
  const deadline = Date.now() + Math.max(0, options.maxDurationMs ?? 60000);
  const limit = Math.max(0, options.maxEvaluations ?? 1000000);
  let evaluated = 0;
  const stopped = () => options.signal?.aborted || Date.now() >= deadline || evaluated >= limit;
  const reason = () => (options.signal?.aborted ? ("cancelled" as const) : ("budget" as const));
  const record = (
    days: 3 | 4 | 5,
    status: AttendanceSearchStatus,
    why: AttendanceAttempt["reason"],
  ) => {
    const attempt = { days, status, reason: why, evaluated };
    attempts.push(attempt);
    options.onAttempt?.(attempt);
  };
  const sessions = [...snapshot.sessions].sort((a, b) => a.id.localeCompare(b.id));
  if (
    sessions.length > 4096 ||
    new Set(sessions.map((s) => s.id)).size !== sessions.length ||
    sessions.some(
      (s) =>
        !snapshot.cohorts.some((c) => c.id === s.cohort_id) ||
        !Number.isFinite(length(s)) ||
        length(s) <= 0 ||
        ![s.start_time, s.end_time].every((t) => /^\d{2}:\d{2}(:00)?$/.test(t)),
    )
  ) {
    record(3, "unknown", "invalid_input");
    return finish("unknown", null);
  }
  const ctx = context(snapshot);
  // A conservative cohort fallback can reject a valid partition timetable; it cannot certify UNSAT.
  if (sessions.some((s) => ctx.students(s).some((p) => p.startsWith("cohort:")))) {
    record(3, "unknown", "invalid_input");
    return finish("unknown", null);
  }
  const domains = new Map<string, Session[]>();
  const yieldTask = async () => {
    if (evaluated % 256 === 0) await new Promise<void>((r) => setTimeout(r, 0));
  };
  for (const original of sessions) {
    const candidates: Session[] = [];
    const unlocked = { ...original, is_locked: false };
    if (original.is_locked) {
      if (feasible(snapshot, [], unlocked, unlocked)) candidates.push(original);
    } else {
      const seen = new Set<string>();
      for (const template of snapshot.templates.filter(
        (t) =>
          t.is_active && (t.study_system === original.study_system || t.study_system === "both"),
      )) {
        for (
          let start = minutes(template.start_time);
          start + length(original) <= minutes(template.end_time);
          start += step
        ) {
          for (const room of snapshot.rooms.filter((r) => r.is_active)) {
            if (stopped()) {
              record(3, "unknown", reason());
              return finish("unknown", null);
            }
            evaluated++;
            const candidate = {
              ...unlocked,
              day_of_week: template.day_of_week,
              start_time: time(start),
              end_time: time(start + length(original)),
              room_id: room.id,
            };
            const key = `${candidate.day_of_week}|${start}|${room.id}`;
            if (!seen.has(key) && feasible(snapshot, [], candidate, unlocked)) {
              seen.add(key);
              candidates.push(candidate);
            }
            await yieldTask();
          }
        }
      }
    }
    domains.set(original.id, candidates);
  }
  const studentMinutes = new Map<string, number>();
  for (const s of sessions)
    for (const p of ctx.students(s))
      studentMinutes.set(p, (studentMinutes.get(p) ?? 0) + length(s));
  const studentAvailableDays = new Map<string, Set<number>>();
  for (const s of sessions)
    for (const p of ctx.students(s)) {
      const available = studentAvailableDays.get(p) ?? new Set<number>();
      // The coarse pass uses a superset bound: missing off-grid candidates must
      // never turn its smaller domain into a false capacity proof.
      for (const template of snapshot.templates.filter(
        (t) => t.is_active && (t.study_system === s.study_system || t.study_system === "both"),
      ))
        available.add(template.day_of_week);
      studentAvailableDays.set(p, available);
    }
  const dailyLimit = (snapshot.settings.max_daily_hours_per_section || 6) * 60;
  const ordered = [...sessions].sort(
    (a, b) =>
      Number(b.is_locked) - Number(a.is_locked) ||
      Number(b.updated_at !== "") - Number(a.updated_at !== "") ||
      domains.get(a.id)!.length - domains.get(b.id)!.length ||
      length(b) - length(a) ||
      a.id.localeCompare(b.id),
  );
  for (const days of [3, 4, 5] as const) {
    if (stopped()) {
      record(days, "unknown", reason());
      return finish("unknown", null);
    }
    if (
      [...studentMinutes].some(
        ([p, n]) => n > dailyLimit * Math.min(days, studentAvailableDays.get(p)!.size),
      )
    ) {
      record(days, "infeasible", "capacity");
      continue;
    }
    const placed: Session[] = [];
    const visit = async (depth: number): Promise<AttendanceSearchStatus> => {
      if (stopped()) return "unknown";
      if (depth === ordered.length) return "feasible";
      const old = ordered[depth];
      const level = ctx.level(old);
      const peers = placed.filter((s) => ctx.level(s) === level);
      const used = new Set(peers.map((s) => s.day_of_week));
      // Prefer filling existing days contiguously; the hard daily load cap gives 3–3–2 for eight 2h sessions.
      const score = (s: Session) => {
        const teacherPeers = placed.filter((p) => p.instructor_id === s.instructor_id);
        const sameDay = placed.filter(
          (p) =>
            p.day_of_week === s.day_of_week &&
            (ctx.level(p) === level || p.instructor_id === s.instructor_id),
        );
        const end = Math.max(0, ...sameDay.map((p) => minutes(p.end_time)));
        return (
          (options.preferExisting &&
          old.updated_at &&
          s.day_of_week === old.day_of_week &&
          s.start_time === old.start_time &&
          s.room_id === old.room_id
            ? -200000
            : 0) +
          (used.has(s.day_of_week) ? 0 : 100000) +
          (teacherPeers.length && !teacherPeers.some((p) => p.day_of_week === s.day_of_week)
            ? 10000
            : 0) +
          (sameDay.length ? Math.abs(minutes(s.start_time) - end) : minutes(s.start_time)) * 10 +
          s.day_of_week
        );
      };
      const candidates = domains
        .get(old.id)!
        .filter((s) => used.has(s.day_of_week) || used.size < days)
        .map((s) => ({ s, score: score(s) }))
        .sort((a, b) => a.score - b.score);
      for (const { s } of candidates) {
        if (stopped()) return "unknown";
        evaluated++;
        await yieldTask();
        const candidate = { ...s, is_locked: false };
        if (!feasible(snapshot, placed, candidate, { ...old, is_locked: false })) continue;
        placed.push(s);
        const result = await visit(depth + 1);
        if (result !== "infeasible") return result;
        placed.pop();
      }
      return "infeasible";
    };
    let status = await visit(0);
    if (status === "infeasible" && step > 1) status = "unknown";
    record(
      days,
      status,
      status === "feasible" ? "solution" : status === "infeasible" ? "exhausted" : reason(),
    );
    if (status === "feasible") return finish(status, days, [...placed]);
    if (status === "unknown") return finish(status, null);
  }
  return finish("infeasible", null);
}

export function attendanceSearchMessage(result: AttendanceSearchResult): string {
  const evidence = result.attempts
    .map(
      (a) =>
        `${a.days} أيام: ${a.status === "feasible" ? "وُجد حل" : a.status === "infeasible" ? "ثبت التعذر ضمن القيود الحالية" : "لم يُحسم البحث"}`,
    )
    .join("؛ ");
  return `${evidence}. ${result.status === "unknown" ? "لم يُسمح بزيادة الأيام؛ وسّع البحث أو راجع القيود." : result.days === 5 ? "خمسة أيام استثناء حرج بعد إثبات تعذر ثلاثة وأربعة أيام." : ""} نطاق الإثبات: محاضرات هذه النسخة بإسناداتها ومددها وأقفالها الحالية، وجميع الأوقات بدقة الدقيقة والقاعات المتاحة.`;
}
