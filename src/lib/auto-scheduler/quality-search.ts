import { diagnoseQuality, qualityImpact, type QualityIssue } from "./quality-diagnostics.ts";
import type { Highs } from "highs";
import {
  compactSlots,
  context,
  feasible,
  fingerprint,
  inputFingerprint,
  measure,
  minutes,
  sessionStudentLoadKind,
  type Metrics,
  type Proposal,
  type Session,
  type Snapshot,
} from "./compact.ts";
import { buildJointModel, validateJointPlan } from "./joint-model.ts";
import { roomTypeRank } from "../scheduling/room-type-policy.ts";

export interface QualitySearchReport {
  dayCap: 3 | 4 | 5;
  reason:
    | "improved"
    | "time_limit"
    | "candidate_limit"
    | "neighborhood_exhausted"
    | "all_locked"
    | "invalid_baseline"
    | "cancelled"
    | "empty";
  evaluated: number;
  accepted: number;
  solverAttempts: number;
  solverFailures: number;
  elapsedMs: number;
  issues?: QualityIssue[];
}

/** Hard ceilings and no extra attendance days for any individual student or instructor. */
export function qualityPlanValid(snapshot: Snapshot, sessions: Session[], dayCap: 3 | 4 | 5) {
  if (![3, 4, 5].includes(dayCap) || !validateJointPlan(snapshot, sessions, dayCap)) return false;
  if (
    qualityImpact(snapshot, sessions).some(
      (p) => p.kind === "student" && p.after.gapMinutes > p.before.gapMinutes,
    )
  )
    return false;
  const ctx = context(snapshot);
  const days = (list: Session[]) => {
    const result = new Map<string, Set<number>>();
    for (const s of list) {
      for (const key of [
        `teacher:${s.instructor_id}`,
        ...ctx.students(s).map((p) => `student:${p}`),
        ...ctx.levels(s).map((p) => `level:${p}`),
      ]) {
        const set = result.get(key) ?? new Set<number>();
        set.add(s.day_of_week);
        result.set(key, set);
      }
    }
    return result;
  };
  const before = days(snapshot.sessions);
  return [...days(sessions)].every(([key, value]) => value.size <= (before.get(key)?.size ?? 0));
}

/** Prefer labs, hour-based day targets and fewer one-lecture days, while protecting idle time. */
export function qualityBetter(a: Metrics, b: Metrics): boolean {
  const studentAndHardKeys: (keyof Metrics)[] = [
    "studentGapMinutes",
    "worstStudentGapMinutes",
    "studentAttendanceDays",
    "shortStudentDays",
    "practicalHallSessions",
    "excessDaysOverThree",
    "extendedDayViolations",
  ];
  if (studentAndHardKeys.some((k) => Number(a[k] ?? 0) > Number(b[k] ?? 0))) return false;
  if (a.instructorTargetDayDeviation !== b.instructorTargetDayDeviation)
    return a.instructorTargetDayDeviation < b.instructorTargetDayDeviation;
  if ((a.instructorExcessTargetDays ?? 0) !== (b.instructorExcessTargetDays ?? 0))
    return (a.instructorExcessTargetDays ?? 0) < (b.instructorExcessTargetDays ?? 0);
  if ((a.instructorSingleLectureDays ?? 0) !== (b.instructorSingleLectureDays ?? 0))
    return (a.instructorSingleLectureDays ?? 0) < (b.instructorSingleLectureDays ?? 0);
  if (a.instructorAttendanceDays !== b.instructorAttendanceDays)
    return a.instructorAttendanceDays < b.instructorAttendanceDays;
  const instructorPolish: (keyof Metrics)[] = [
    "instructorGapMinutes",
    "worstInstructorGapMinutes",
    "shortInstructorDays",
  ];
  if (instructorPolish.some((k) => Number(a[k] ?? 0) > Number(b[k] ?? 0))) return false;
  return (
    studentAndHardKeys.some((k) => Number(a[k] ?? 0) < Number(b[k] ?? 0)) ||
    instructorPolish.some((k) => Number(a[k] ?? 0) < Number(b[k] ?? 0))
  );
}

export function qualitySearchMessage(p: Proposal): string {
  const q = p.qualitySearch;
  if (!q) return "";
  const reasons: Record<QualitySearchReport["reason"], string> = {
    improved: "اكتمل البحث في النطاق المحدد.",
    time_limit: "انتهت مدة البحث؛ هذا لا يثبت أن الجدول هو الأفضل الممكن.",
    candidate_limit: "وصل البحث إلى حد المحاولات المحدد؛ لا يعني ذلك تعذر التحسين.",
    neighborhood_exhausted:
      "لم يجد البحث المحدود نقلًا أو تبادلًا مقبولًا ضمن القيود؛ هذه ليست شهادة بالأمثلية.",
    all_locked: "جميع المحاضرات مقفلة؛ لا توجد محاضرات متاحة للتحريك.",
    invalid_baseline:
      "الجدول الحالي لا يجتاز التحقق الكامل من القيود أو بيانات المجموعات؛ يلزم معالجة مخالفاته قبل هذا التحسين.",
    cancelled: "أُوقف البحث دون حفظ تغييرات.",
    empty: "لا توجد محاضرات مجدولة لتحسينها.",
  };
  return `${p.moves.length ? `وُجد تحسين يشمل ${p.moves.length} محاضرة.` : "لم يُعثر على تحسين قابل للتطبيق."} ${reasons[q.reason]} فُحص ${q.evaluated} بديلًا و${q.solverAttempts} محاولة تبادل موسعة.${q.solverFailures ? ` تعذرت ${q.solverFailures} محاولة حساب موسعة؛ لا تُعد دليلًا على التعذر.` : ""} لم تُحفظ تغييرات بعد.`;
}

/** Anytime improvement of the existing draft; never stops at mere feasibility. */
export async function improveDistribution(
  snapshot: Snapshot,
  highs: Highs,
  options: {
    maxDurationMs?: number;
    maxEvaluations?: number;
    /** Internal deterministic neighborhood ordering for portfolio search. */
    scenario?: number;
    signal?: AbortSignal;
    onProgress?: (moves: number, metrics: Metrics) => void;
  } = {},
): Promise<Proposal> {
  if (options.scenario === undefined) {
    const started = Date.now();
    const budget = Math.max(0, Math.min(options.maxDurationMs ?? 180000, 180000));
    const limit = options.maxEvaluations ?? 250000;
    let current = snapshot;
    let best: Proposal | undefined;
    let evaluated = 0,
      accepted = 0,
      solverAttempts = 0,
      solverFailures = 0;
    for (let scenario = 0; scenario < 3; scenario++) {
      const remaining = Math.max(0, budget - (Date.now() - started));
      if (best && (remaining === 0 || evaluated >= limit || options.signal?.aborted)) break;
      const next = await improveDistribution(current, highs, {
        ...options,
        scenario,
        maxDurationMs: remaining / (3 - scenario),
        maxEvaluations: Math.max(0, Math.floor((limit - evaluated) / (3 - scenario))),
      });
      evaluated += next.qualitySearch!.evaluated;
      accepted += next.qualitySearch!.accepted;
      solverAttempts += next.qualitySearch!.solverAttempts;
      solverFailures += next.qualitySearch!.solverFailures;
      const moves = new Map(next.moves.map((m) => [m.id, m]));
      const sessions = current.sessions.map((s) => ({ ...s, ...moves.get(s.id) }));
      // Each new scenario starts from the best incumbent, never discards earlier gains.
      current = { ...current, sessions };
      best = {
        ...next,
        before: measure(snapshot),
        fingerprint: fingerprint(snapshot.sessions),
        inputFingerprint: inputFingerprint(snapshot),
        moves: sessions
          .filter((s) => {
            const old = snapshot.sessions.find((x) => x.id === s.id)!;
            return (
              s.day_of_week !== old.day_of_week ||
              s.start_time !== old.start_time ||
              s.end_time !== old.end_time ||
              s.room_id !== old.room_id
            );
          })
          .map(({ id, day_of_week, start_time, end_time, room_id }) => ({
            id,
            day_of_week,
            start_time,
            end_time,
            room_id,
          })),
        qualitySearch: {
          ...next.qualitySearch!,
          evaluated,
          accepted,
          solverAttempts,
          solverFailures,
          elapsedMs: Date.now() - started,
        },
      };
      if (
        ["invalid_baseline", "all_locked", "empty", "cancelled"].includes(
          next.qualitySearch!.reason,
        )
      )
        break;
    }
    if (best!.moves.length && best!.qualitySearch!.reason === "neighborhood_exhausted")
      best!.qualitySearch!.reason = "improved";
    return best!;
  }
  const started = Date.now();
  const budget = Math.max(0, Math.min(options.maxDurationMs ?? 180000, 180000));
  const deadline = started + budget;
  const before = measure(snapshot);
  // Use the actual maximum, never the smallest level's day count.
  const cap = Math.max(3, Math.min(5, Math.max(0, ...Object.values(before.levelDays)))) as
    | 3
    | 4
    | 5;
  let sessions = snapshot.sessions.map((s) => ({ ...s }));
  let score = before;
  let evaluated = 0,
    accepted = 0,
    solverAttempts = 0,
    solverFailures = 0;
  const limit = options.maxEvaluations ?? 250000;
  const moves = () =>
    sessions
      .filter((s) => {
        const old = snapshot.sessions.find((x) => x.id === s.id)!;
        return (
          s.day_of_week !== old.day_of_week ||
          s.start_time !== old.start_time ||
          s.end_time !== old.end_time ||
          s.room_id !== old.room_id
        );
      })
      .map(({ id, day_of_week, start_time, end_time, room_id }) => ({
        id,
        day_of_week,
        start_time,
        end_time,
        room_id,
      }));
  const finish = (reason: QualitySearchReport["reason"]): Proposal => ({
    before,
    after: score,
    moves: moves(),
    applicationMode: "simultaneous",
    fingerprint: fingerprint(snapshot.sessions),
    inputFingerprint: inputFingerprint(snapshot),
    stopped: reason === "cancelled",
    qualitySearch: {
      dayCap: cap,
      reason,
      evaluated,
      accepted,
      solverAttempts,
      solverFailures,
      elapsedMs: Date.now() - started,
      ...(reason === "invalid_baseline" ? { issues: diagnoseQuality(snapshot) } : {}),
    },
  });
  const stop = (): QualitySearchReport["reason"] | null =>
    options.signal?.aborted
      ? "cancelled"
      : Date.now() >= deadline
        ? "time_limit"
        : evaluated >= limit
          ? "candidate_limit"
          : null;
  if (!sessions.length) return finish("empty");
  if (!qualityPlanValid(snapshot, sessions, cap)) {
    const issues = diagnoseQuality(snapshot);
    // Repair attendance violations together; incomplete/stale academic data is never guessed.
    if (!issues.length || issues.some((x) => x.code !== "instructor_day_cap"))
      return finish("invalid_baseline");
    if (stop()) return finish(stop()!);
    const affected = new Set(issues.map((x) => x.instructorId));
    const repairSnapshot = {
      ...snapshot,
      sessions: sessions.map((s) => ({
        ...s,
        is_locked: s.is_locked || !affected.has(s.instructor_id),
      })),
    };
    let repairModel: ReturnType<Highs["createModel"]> | undefined;
    try {
      const built = buildJointModel(repairSnapshot, cap);
      repairModel = highs.createModel(built.model);
      solverAttempts++;
      repairModel.options.set({
        output_flag: false,
        time_limit: Math.max(0, Math.min(5, (deadline - Date.now()) / 1000)),
      });
      repairModel.run();
      if (
        repairModel.info.get("primal_solution_status") === highs.constants.solutionStatus.feasible
      ) {
        const candidate = built.decode(repairModel.getSolution().colValue).map((s) => ({
          ...s,
          is_locked: snapshot.sessions.find((x) => x.id === s.id)!.is_locked,
        }));
        if (
          qualityPlanValid(snapshot, candidate, cap) &&
          qualityBetter(measure(snapshot, candidate), score)
        ) {
          sessions = candidate;
          score = measure(snapshot, sessions);
          accepted++;
          options.onProgress?.(moves().length, score);
        }
      }
    } catch {
      solverFailures++;
    } finally {
      repairModel?.dispose();
    }
    if (!qualityPlanValid(snapshot, sessions, cap)) return finish("invalid_baseline");
  }
  if (
    snapshot.sessions.some((s) =>
      context(snapshot)
        .students(s)
        .some((p) => p.startsWith("cohort:")),
    )
  )
    return finish("invalid_baseline");
  if (sessions.every((s) => s.is_locked)) return finish("all_locked");
  const ctx = context(snapshot);
  const counts = (keys: (s: Session) => string[]) => {
    const map = new Map<string, Set<number>>();
    for (const s of snapshot.sessions)
      for (const key of keys(s)) {
        const days = map.get(key) ?? new Set<number>();
        days.add(s.day_of_week);
        map.set(key, days);
      }
    return Object.fromEntries([...map].map(([key, days]) => [key, days.size]));
  };
  const qualityScope = {
    studentDays: counts((s) => ctx.students(s)),
    instructorDays: counts((s) => [s.instructor_id]),
    levelDays: counts((s) => ctx.levels(s)),
  };
  const slots = new Map(snapshot.sessions.map((s) => [s.id, compactSlots(snapshot, s)]));
  const roomRank = (s: Session, r: Snapshot["rooms"][number]) =>
    roomTypeRank({
      componentType: sessionStudentLoadKind(snapshot, s),
      requiredRoomType: snapshot.assignments.find((a) => a.id === s.teaching_assignment_id)
        ?.required_room_type,
      roomType: r.room_type,
    });
  const rooms = (s: Session) =>
    snapshot.rooms
      .filter((r) => r.is_active && r.capacity >= s.expected_students && roomRank(s, r) !== null)
      .sort(
        (a, b) =>
          roomRank(s, a)! - roomRank(s, b)! ||
          Number(b.id === s.room_id) - Number(a.id === s.room_id),
      );
  const accept = (trial: Session[]) => {
    let next = measure(snapshot, trial);
    if (!qualityBetter(next, score) || !qualityPlanValid(snapshot, trial, cap)) return false;
    // An exchange can free a lab. Re-check unchanged practical lectures too before accepting.
    for (const lecture of [...trial]) {
      if (
        lecture.is_locked ||
        roomRank(lecture, snapshot.rooms.find((r) => r.id === lecture.room_id)!) !== 1
      )
        continue;
      for (const room of rooms(lecture).filter((r) => roomRank(lecture, r) === 0)) {
        const candidate = { ...lecture, room_id: room.id };
        if (!feasible(snapshot, trial, candidate, lecture)) continue;
        trial = trial.map((s) => (s.id === lecture.id ? candidate : s));
        break;
      }
    }
    next = measure(snapshot, trial);
    if (!qualityPlanValid(snapshot, trial, cap)) return false;
    if (
      trial.filter((s) => {
        const o = snapshot.sessions.find((x) => x.id === s.id)!;
        return (
          o.day_of_week !== s.day_of_week ||
          o.start_time !== s.start_time ||
          o.room_id !== s.room_id
        );
      }).length > 512
    )
      return false;
    sessions = trial;
    score = next;
    accepted++;
    options.onProgress?.(moves().length, score);
    return true;
  };
  const replace = (...changed: Session[]) => {
    const map = new Map(changed.map((s) => [s.id, s]));
    return sessions.map((s) => map.get(s.id) ?? s);
  };
  const rank = (s: Session) => {
    const peers = sessions.filter((x) => x.instructor_id === s.instructor_id);
    return (
      (roomRank(s, snapshot.rooms.find((r) => r.id === s.room_id)!) ?? 0) * 100 +
      new Set(peers.map((x) => x.day_of_week)).size * 10 +
      (peers.filter((x) => x.day_of_week === s.day_of_week).length === 1 ? 5 : 0)
    );
  };
  // Always repair same-time lab fallback first: no attendance metric needs to change.
  for (const old of [...sessions]) {
    if (stop()) return finish(stop()!);
    if (old.is_locked) continue;
    for (const room of rooms(old)) {
      if (room.id === old.room_id) continue;
      if (stop()) return finish(stop()!);
      evaluated++;
      const candidate = { ...old, room_id: room.id };
      if (feasible(snapshot, sessions, candidate, old) && accept(replace(candidate))) break;
    }
  }
  const localDeadline = started + budget * 0.45;
  const localLimit = Math.floor(limit * 0.4);
  const pairLimit = Math.floor(limit * 0.8);
  const pairDeadline = started + budget * 0.7;
  // Compare every feasible placement in the budget before committing a lecture move.
  localSearch: for (let pass = 0; pass < 12 && Date.now() < localDeadline; pass++) {
    let changed = false;
    for (const entry of [...sessions]
      .filter((s) => !s.is_locked)
      .sort(
        (a, b) =>
          rank(b) - rank(a) ||
          (options.scenario === 1 ? b.id.localeCompare(a.id) : a.id.localeCompare(b.id)),
      )) {
      const old = sessions.find((s) => s.id === entry.id)!;
      const peers = sessions.filter(
        (s) => s.instructor_id === old.instructor_id && s.id !== old.id,
      );
      const ordered = [...(slots.get(old.id) ?? [])].sort(
        (a, b) =>
          Number(!peers.some((s) => s.day_of_week === a.day)) -
            Number(!peers.some((s) => s.day_of_week === b.day)) ||
          (options.scenario === 2
            ? b.day - a.day || b.start.localeCompare(a.start)
            : a.day - b.day || a.start.localeCompare(b.start)),
      );
      let bestTrial: Session[] | null = null;
      let bestScore = score;
      candidate: for (const slot of ordered) {
        if (stop()) break candidate;
        if (Date.now() >= localDeadline || evaluated >= localLimit) break candidate;
        for (const room of rooms(old)) {
          if (stop()) break candidate;
          if (Date.now() >= localDeadline || evaluated >= localLimit) break candidate;
          evaluated++;
          const candidate = {
            ...old,
            day_of_week: slot.day,
            start_time: slot.start,
            end_time: slot.end,
            room_id: room.id,
          };
          if (!feasible(snapshot, sessions, candidate, old)) continue;
          const trial = replace(candidate);
          const metrics = measure(snapshot, trial);
          if (qualityBetter(metrics, bestScore) && qualityPlanValid(snapshot, trial, cap)) {
            bestTrial = trial;
            bestScore = metrics;
          }
        }
      }
      if (bestTrial && accept(bestTrial)) changed = true;
      if (Date.now() >= localDeadline || evaluated >= localLimit) break localSearch;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    if (!changed) break;
  }
  // True simultaneous exchanges: neither lecture needs a temporary empty room.
  pairSearch: for (const entry of [...sessions]
    .filter((s) => !s.is_locked)
    .sort(
      (a, b) =>
        rank(b) - rank(a) ||
        (options.scenario === 1 ? b.id.localeCompare(a.id) : a.id.localeCompare(b.id)),
    )) {
    const a = sessions.find((s) => s.id === entry.id)!;
    for (const b of [...sessions]) {
      if (Date.now() >= pairDeadline || evaluated >= pairLimit) break pairSearch;
      if (stop()) return finish(stop()!);
      if (b.is_locked || a.id === b.id) continue;
      if (
        minutes(a.end_time) - minutes(a.start_time) !==
        minutes(b.end_time) - minutes(b.start_time)
      )
        continue;
      for (const swapRooms of [false, true]) {
        if (stop()) return finish(stop()!);
        evaluated++;
        const aa = {
          ...a,
          day_of_week: b.day_of_week,
          start_time: b.start_time,
          end_time: b.end_time,
          room_id: swapRooms ? b.room_id : a.room_id,
        };
        const bb = {
          ...b,
          day_of_week: a.day_of_week,
          start_time: a.start_time,
          end_time: a.end_time,
          room_id: swapRooms ? a.room_id : b.room_id,
        };
        const trial = replace(aa, bb);
        if (!feasible(snapshot, trial, aa, a) || !feasible(snapshot, trial, bb, b)) continue;
        if (accept(trial)) break;
      }
      if (sessions.find((s) => s.id === a.id) !== a) break;
    }
  }
  // Re-optimize bounded neighborhoods with everyone else fixed, seeding the saved witness.
  const teachers = [
    ...new Set(
      [...sessions]
        .filter((s) => !s.is_locked)
        .sort(
          (a, b) =>
            rank(b) - rank(a) ||
            (options.scenario === 1 ? b.id.localeCompare(a.id) : a.id.localeCompare(b.id)),
        )
        .map((s) => s.instructor_id),
    ),
  ];
  for (const teacher of teachers) {
    if (stop()) return finish(stop()!);
    const own = sessions.filter((s) => s.instructor_id === teacher && !s.is_locked);
    const neighbors = sessions
      .filter(
        (s) =>
          !s.is_locked &&
          s.instructor_id !== teacher &&
          own.some((x) => ctx.share(x, s) || x.room_id === s.room_id),
      )
      .sort(
        (a, b) =>
          rank(b) - rank(a) ||
          (options.scenario === 1 ? b.id.localeCompare(a.id) : a.id.localeCompare(b.id)),
      )
      .slice(0, Math.max(0, 12 - own.length));
    const free = new Set([...own, ...neighbors].map((s) => s.id));
    const neighborhood = {
      ...snapshot,
      qualityScope,
      sessions: sessions.map((s) => ({ ...s, is_locked: s.is_locked || !free.has(s.id) })),
    };
    let model: ReturnType<Highs["createModel"]> | undefined;
    try {
      const built = buildJointModel(neighborhood, cap);
      if (stop()) return finish(stop()!);
      model = highs.createModel(built.model);
      solverAttempts++;
      model.options.set({
        output_flag: false,
        time_limit: Math.max(0, Math.min(2, (deadline - Date.now()) / 1000)),
        mip_rel_gap: 0.01,
      });
      model.setSolution(built.startSolution);
      model.run();
      if (model.info.get("primal_solution_status") === highs.constants.solutionStatus.feasible) {
        const final = built.decode(model.getSolution().colValue).map((s) => ({
          ...s,
          is_locked: snapshot.sessions.find((x) => x.id === s.id)!.is_locked,
        }));
        accept(final);
      }
    } catch {
      solverFailures++;
    } finally {
      model?.dispose();
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return finish(stop() ?? (accepted ? "improved" : "neighborhood_exhausted"));
}
