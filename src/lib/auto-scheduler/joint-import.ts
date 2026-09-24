import { context, minutes, studentWeeklyCapacity, fingerprint, inputFingerprint, measure, type Snapshot, type Session, type Proposal } from "./compact.ts";
import { qualityBetter, qualityPlanValid } from "./quality-search.ts";
import { jointProposal } from "./joint-search.ts";
import type { AttendanceAttempt } from "./attendance-search.ts";
/** Import only placements; identity, hours, assignments and proof come from the fresh snapshot. */
export function importJointPlan(snapshot: Snapshot, versionId: string, text: string) {
  if (text.length > 1048576) throw new Error("حجم الخطة أكبر من المسموح.");
  const raw = JSON.parse(text);
  if (
    raw.versionId !== versionId ||
    String(raw.revision) !== snapshot.revision ||
    raw.versionUpdatedAt !== snapshot.versionUpdatedAt
  )
    throw new Error("تغير الجدول أو موارده منذ حساب الخطة؛ أعد الحساب.");
  if (
    ![3, 4, 5].includes(raw.days) ||
    !Array.isArray(raw.moves) ||
    raw.moves.length !== snapshot.sessions.length
  )
    throw new Error("خطة توزيع غير مكتملة.");
  const moves = new Map<string, Record<string, unknown>>();
  for (const move of raw.moves) {
    if (!move || typeof move.id !== "string" || moves.has(move.id))
      throw new Error("محاضرة مكررة أو غير صالحة.");
    moves.set(move.id, move);
  }
  const final: Session[] = snapshot.sessions.map((s) => {
    const m = moves.get(s.id);
    if (
      !m ||
      m.expected_updated_at !== s.updated_at ||
      !Number.isInteger(m.day_of_week) ||
      typeof m.room_id !== "string" ||
      ![m.start_time, m.end_time].every(
        (t) => typeof t === "string" && /^\d{2}:\d{2}(:00)?$/.test(t),
      )
    )
      throw new Error("تغيرت المحاضرات أو تعذر التحقق من الخطة.");
    return {
      ...s,
      day_of_week: m.day_of_week as number,
      room_id: m.room_id as string,
      start_time: m.start_time as string,
      end_time: m.end_time as string,
    };
  });
  if (raw.purpose === "quality") {
    // Distribution improvement preserves each person's existing attendance envelope.
    // It does not claim that fewer days were proven impossible.
    const before = measure(snapshot), after = measure(snapshot, final);
    const cap = Math.max(3, Math.min(5, Math.max(0, ...Object.values(before.levelDays)))) as 3 | 4 | 5;
    if (raw.days !== cap || !qualityPlanValid(snapshot, final, cap))
      throw new Error("خطة التحسين تخالف القيود أو تزيد أيام الحضور أو فراغات الطلاب.");
    if (!qualityBetter(after, before))
      throw new Error("لم تحقق الخطة تحسنًا مع الحفاظ على مؤشرات الطلاب والمحاضرين.");
    const changed = final.filter((s) => {
      const old = snapshot.sessions.find((x) => x.id === s.id)!;
      return s.day_of_week !== old.day_of_week || s.start_time !== old.start_time ||
        s.end_time !== old.end_time || s.room_id !== old.room_id;
    }).map(({ id, day_of_week, start_time, end_time, room_id }) =>
      ({ id, day_of_week, start_time, end_time, room_id }));
    const proposal: Proposal = {
      before, after, moves: changed, fingerprint: fingerprint(snapshot.sessions),
      inputFingerprint: inputFingerprint(snapshot), stopped: false, applicationMode: "simultaneous",
      qualitySearch: {
        dayCap: cap, reason: "improved", evaluated: final.length, accepted: changed.length,
        solverAttempts: 0, solverFailures: 0, elapsedMs: 0,
      },
    };
    return proposal;
  }
  const ctx = context(snapshot),
    demand = new Map<string, number>(),
    attempts: AttendanceAttempt[] = [];
  for (const s of snapshot.sessions)
    for (const p of ctx.students(s))
      demand.set(p, (demand.get(p) ?? 0) + minutes(s.end_time) - minutes(s.start_time));
  if ([...demand.keys()].some((p) => p.startsWith("cohort:")))
    throw new Error("استكمل ربط مجموعات الطلاب أولاً.");
  for (const days of [3, 4, 5] as const) {
    if (days === raw.days) {
      attempts.push({ days, status: "feasible", reason: "solution", evaluated: 0 });
      break;
    }
    if (![...demand.values()].some((n) => n > studentWeeklyCapacity(snapshot, days)))
      throw new Error(
        "لا يوجد إثبات مستقل لتعذر عدد الأيام الأقل؛ لا يمكن اعتماد الزيادة من ملف الخطة.",
      );
    attempts.push({ days, status: "infeasible", reason: "capacity", evaluated: 0 });
  }
  return jointProposal(snapshot, {
    status: "feasible",
    days: raw.days,
    attempts,
    sessions: final,
    scope: "all_sessions_joint_grid",
  });
}
