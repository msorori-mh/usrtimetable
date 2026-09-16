import { extendedResourceConflict } from "./extended-resource-capacity.ts";
import type { Highs } from "highs";
import { buildJointModel, validateJointPlan } from "./joint-model.ts";
import {
  searchAttendance,
  resourceConflictResult,
  type AttendanceSearchResult,
  type AttendanceAttempt,
} from "./attendance-search.ts";
import {
  context,
  minutes,
  studentWeeklyCapacity,
  measure,
  better,
  fingerprint,
  inputFingerprint,
  type Snapshot,
  type Session,
  type Proposal,
} from "./compact.ts";

export function jointProposal(snapshot: Snapshot, search: AttendanceSearchResult): Proposal {
  const before = measure(snapshot);
  const base: Proposal = {
    before,
    after: before,
    moves: [],
    fingerprint: fingerprint(snapshot.sessions),
    inputFingerprint: inputFingerprint(snapshot),
    stopped: false,
    attendanceSearch: search,
    applicationMode: "simultaneous",
  };
  if (search.status !== "feasible" || !search.days) return base;
  if (!validateJointPlan(snapshot, search.sessions, search.days))
    throw new Error("خطة التوزيع لا تجتاز قيود الجدول.");
  const after = measure(snapshot, search.sessions);
  const moves = search.sessions
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
  if (moves.length && !better(after, before))
    return { ...base, executionBlocked: "لم تُحسّن الخطة مؤشرات جودة الجدول." };
  return { ...base, after, moves };
}

/** A capacity bound is a proof. A grid timeout or grid exhaustion never permits extra days. */
export async function searchJointAttendance(
  snapshot: Snapshot,
  highs: Highs,
  budgetMs = 180000,
  purpose: "compaction" | "generation" = "compaction",
): Promise<Proposal> {
  const conflict = extendedResourceConflict(snapshot);
  if (conflict) return jointProposal(snapshot, resourceConflictResult(conflict));
  const started = Date.now(),
    attempts: AttendanceAttempt[] = [];
  const finish = (
    status: AttendanceSearchResult["status"],
    days: 3 | 4 | 5 | null,
    sessions: Session[] = [],
  ) =>
    jointProposal(snapshot, { status, days, sessions, attempts, scope: "all_sessions_joint_grid" });
  if (!snapshot.sessions.length) return { ...finish("feasible", 3, []), outcome: "empty" };
  const ctx = context(snapshot),
    demand = new Map<string, number>();
  if (snapshot.sessions.some((s) => ctx.students(s).some((p) => p.startsWith("cohort:")))) {
    attempts.push({ days: 3, status: "unknown", reason: "invalid_input", evaluated: 0 });
    return finish("unknown", null);
  }
  for (const s of snapshot.sessions)
    for (const p of ctx.students(s))
      demand.set(p, (demand.get(p) ?? 0) + minutes(s.end_time) - minutes(s.start_time));
  for (const days of [3, 4, 5] as const) {
    if ([...demand.values()].some((n) => n > studentWeeklyCapacity(snapshot, days))) {
      attempts.push({ days, status: "infeasible", reason: "capacity", evaluated: 0 });
      continue;
    }
    if (Date.now() - started >= budgetMs) {
      attempts.push({ days, status: "unknown", reason: "budget", evaluated: 0 });
      return finish("unknown", null);
    }
    const built = buildJointModel(snapshot, days, purpose !== "generation");
    // Generation needs a complete valid timetable before quality optimization.
    // A constant objective lets presolve discard soft span/idle-time machinery;
    // all attendance, availability, capacity and collision constraints remain.
    // Compaction retains its quality objective for the explicit improvement step.
    if (purpose === "generation") built.model.colCost = new Float64Array(built.model.numCols);
    const model = highs.createModel(built.model);
    try {
      model.options.set({
        output_flag: false,
        time_limit: Math.max(0, (budgetMs - (Date.now() - started)) / 1000),
        mip_rel_gap: 0.05,
        mip_heuristic_effort: 0.2,
      });
      // Synthetic pending sessions have no feasible original placement to seed.
      if (purpose !== "generation") model.setSolution(built.startSolution);
      model.run();
      if (model.info.get("primal_solution_status") === highs.constants.solutionStatus.feasible) {
        let final: Session[];
        try {
          final = built.decode(model.getSolution().colValue);
        } catch {
          attempts.push({
            days,
            status: "unknown",
            reason: "budget",
            evaluated: built.candidateCount,
          });
          return finish("unknown", null);
        }
        attempts.push({
          days,
          status: "feasible",
          reason: "solution",
          evaluated: built.candidateCount,
        });
        return finish("feasible", days, final);
      }
      // Only the exhaustive minute-domain solver may turn grid exhaustion into a proof.
      if (
        model.getModelStatus() === highs.constants.modelStatus.infeasible &&
        Date.now() - started < budgetMs
      ) {
        const exact = await searchAttendance(snapshot, {
          maxDurationMs: budgetMs - (Date.now() - started),
        });
        return jointProposal(snapshot, exact);
      }
      attempts.push({ days, status: "unknown", reason: "budget", evaluated: built.candidateCount });
      return finish("unknown", null);
    } finally {
      model.dispose();
    }
  }
  return finish("infeasible", null);
}
