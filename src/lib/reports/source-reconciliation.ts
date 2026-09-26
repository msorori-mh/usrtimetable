/** Reconcile a recorded timetable row without manufacturing academic data. */
export interface SourceReconciliationRow {
  study_plan_id?: string | null;
  plan_course_id?: string | null;
  component_id?: string | null;
  delivery_group_id?: string | null;
  teaching_assignment_id?: string | null;
  schedule_session_id?: string | null;
  day_of_week?: number | null;
  start_time?: string | null;
  end_time?: string | null;
  pending_reasons?: readonly string[] | null;
  shared_member?: boolean;
}

export interface ReconciliationSession {
  id: string;
  delivery_group_id: string | null;
  day_of_week: number;
  start_time: string;
  end_time: string;
}

export type SourceStage =
  | "missing_time"
  | "missing_plan"
  | "missing_component"
  | "missing_group"
  | "missing_assignment"
  | "missing_session"
  | "unlinked_session"
  | "shared_review"
  | "review"
  | "complete";

export const SOURCE_STAGE_LABELS: Record<SourceStage, string> = {
  missing_time: "موعد المصدر غير مكتمل",
  missing_plan: "المقرر غير مربوط بالخطة",
  missing_component: "مكوّن المقرر غير محدد",
  missing_group: "لا توجد مجموعة مرتبطة",
  missing_assignment: "الإسناد غير مربوط",
  missing_session: "لا توجد جلسة مثبتة للمجموعة في هذه المسودة",
  unlinked_session: "جلسة موجودة؛ رابط صف المصدر يحتاج تسوية",
  shared_review:
    "المحاضرة المشتركة محفوظة؛ تحقق من عضوية المجموعة في الربط المشترك",
  review: "المصدر مرتبط؛ ملاحظات المراجعة معلقة",
  complete: "مكتمل الربط والتحقق",
};

const normalizedTime = (value: string | null | undefined) =>
  value?.slice(0, 5) ?? "";

export function reconcileSourceRow(
  source: SourceReconciliationRow,
  sessions: readonly ReconciliationSession[],
): { stage: SourceStage; issues: string[]; sessionId: string | null } {
  const issues: SourceStage[] = [];
  if (
    source.day_of_week == null ||
    !source.start_time ||
    !source.end_time ||
    normalizedTime(source.end_time) <= normalizedTime(source.start_time)
  )
    issues.push("missing_time");
  if (!source.study_plan_id || !source.plan_course_id)
    issues.push("missing_plan");
  if (!source.component_id) issues.push("missing_component");
  if (!source.delivery_group_id) issues.push("missing_group");
  if (!source.teaching_assignment_id) issues.push("missing_assignment");

  // A foreign key alone does not prove that a session belongs to the selected
  // version or matches the source's group and slot.
  const match = sessions.find(
    (session) =>
      session.delivery_group_id === source.delivery_group_id &&
      session.day_of_week === source.day_of_week &&
      normalizedTime(session.start_time) ===
        normalizedTime(source.start_time) &&
      normalizedTime(session.end_time) === normalizedTime(source.end_time),
  );
  const sharedSession = source.shared_member
    ? sessions.find(
        (session) =>
          session.id === source.schedule_session_id &&
          session.day_of_week === source.day_of_week &&
          normalizedTime(session.start_time) ===
            normalizedTime(source.start_time) &&
          normalizedTime(session.end_time) === normalizedTime(source.end_time),
      )
    : null;
  const linked = match && match.id === source.schedule_session_id;
  if (sharedSession) issues.push("shared_review");
  else if (!linked) issues.push(match ? "unlinked_session" : "missing_session");
  if (source.pending_reasons?.length) issues.push("review");
  const stage = issues[0] ?? "complete";
  return {
    stage,
    issues: issues.length
      ? issues.map((issue) => SOURCE_STAGE_LABELS[issue])
      : [SOURCE_STAGE_LABELS.complete],
    sessionId: (match ?? sharedSession)?.id ?? null,
  };
}

export function sourceReconciliationSummary(
  sources: readonly SourceReconciliationRow[],
  sessions: readonly ReconciliationSession[],
) {
  const stages = sources.map((row) => reconcileSourceRow(row, sessions).stage);
  return {
    sourceRows: stages.length,
    completeRows: stages.filter((stage) => stage === "complete").length,
    pendingRows: stages.filter((stage) => stage !== "complete").length,
    // Completeness of uploaded sources requires an independent file manifest.
    sourceFilesVerified: false,
  };
}
