import { supabase } from "@/integrations/supabase/client";
import { validateProposed, type ProposedSession } from "@/lib/conflict-engine/validator";
import { scoreScheduleVersion } from "@/lib/conflict-engine/scorer";

export type SVStatus = "draft" | "review" | "approved" | "published" | "archived";

export const STATUS_LABEL_AR: Record<SVStatus, string> = {
  draft: "مسودة",
  review: "قيد المراجعة",
  approved: "معتمد",
  published: "منشور",
  archived: "مؤرشف",
};

export const STATUS_BADGE_VARIANT: Record<SVStatus, "secondary" | "default" | "outline" | "destructive"> = {
  draft: "secondary",
  review: "outline",
  approved: "default",
  published: "default",
  archived: "destructive",
};

/** Forward + rollback edges. */
const ALLOWED: Array<[SVStatus, SVStatus]> = [
  ["draft", "review"],
  ["review", "approved"],
  ["approved", "published"],
  ["published", "archived"],
  // rollbacks
  ["review", "draft"],
  ["approved", "review"],
];

export function canTransition(from: SVStatus, to: SVStatus): boolean {
  return ALLOWED.some(([a, b]) => a === from && b === to);
}

export function nextActions(status: SVStatus): Array<{ to: SVStatus; label: string; kind: "forward" | "rollback" }> {
  const out: ReturnType<typeof nextActions> = [];
  for (const [a, b] of ALLOWED) {
    if (a !== status) continue;
    const forward = ["review", "approved", "published", "archived"].indexOf(b) >
      ["draft", "review", "approved", "published"].indexOf(a);
    out.push({
      to: b,
      label: actionLabel(a, b),
      kind: forward ? "forward" : "rollback",
    });
  }
  return out;
}

function actionLabel(from: SVStatus, to: SVStatus): string {
  if (from === "draft" && to === "review") return "إرسال للمراجعة";
  if (from === "review" && to === "approved") return "اعتماد";
  if (from === "approved" && to === "published") return "نشر";
  if (from === "published" && to === "archived") return "أرشفة";
  if (from === "review" && to === "draft") return "إعادة إلى مسودة";
  if (from === "approved" && to === "review") return "إعادة إلى المراجعة";
  return `${from} → ${to}`;
}

const EVENT_FOR: Record<string, string> = {
  "draft->review": "submitted_for_review",
  "review->approved": "approved",
  "approved->published": "published",
  "published->archived": "archived",
  "review->draft": "rolled_back_to_draft",
  "approved->review": "rolled_back_to_review",
};

export interface EligibilityResult {
  ok: boolean;
  reasons: string[];
  warnings: string[];
  hardConflicts: number;
  qualityScore: number | null;
  sessionsCount: number;
}

/** Read sessions + run hard validation + load latest quality. */
export async function evaluateEligibility(params: {
  collegeId: string;
  scheduleVersionId: string;
}): Promise<EligibilityResult> {
  const { collegeId, scheduleVersionId } = params;
  const reasons: string[] = [];
  const warnings: string[] = [];

  const { data: ss, error: se } = await supabase
    .from("schedule_sessions")
    .select("*")
    .eq("college_id", collegeId)
    .eq("schedule_version_id", scheduleVersionId);
  if (se) throw se;
  const sessions = ss ?? [];

  const proposed: ProposedSession[] = sessions.map((s) => ({
    id: s.id,
    schedule_version_id: s.schedule_version_id,
    course_offering_id: s.course_offering_id,
    teaching_assignment_id: s.teaching_assignment_id,
    instructor_id: s.instructor_id,
    room_id: s.room_id,
    section_id: s.section_id,
    section_group_id: s.section_group_id,
    study_system: s.study_system as ProposedSession["study_system"],
    day_of_week: s.day_of_week,
    start_time: s.start_time,
    end_time: s.end_time,
    session_type: s.session_type,
    expected_students: s.expected_students,
  }));

  let hard = 0;
  if (sessions.length > 0) {
    const conflicts = await validateProposed({ collegeId, scheduleVersionId, sessions: proposed });
    hard = conflicts.length;
  }

  // Latest quality run
  const { data: qrow } = await supabase
    .from("schedule_quality_runs")
    .select("total_score, soft_conflicts_count")
    .eq("college_id", collegeId)
    .eq("schedule_version_id", scheduleVersionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (qrow && qrow.soft_conflicts_count > 0) {
    warnings.push(`يوجد ${qrow.soft_conflicts_count} مخالفة مرنة (مسموح بها لكن يُنصح بمراجعتها).`);
  }

  return {
    ok: reasons.length === 0,
    reasons,
    warnings,
    hardConflicts: hard,
    qualityScore: qrow?.total_score ?? null,
    sessionsCount: sessions.length,
  };
}

/** Validate gate for a specific target status. */
export function validateGate(target: SVStatus, e: EligibilityResult): string[] {
  const errs: string[] = [];
  if (target === "review") {
    if (e.sessionsCount < 1) errs.push("النسخة لا تحتوي على أي محاضرات.");
  }
  if (target === "approved") {
    if (e.hardConflicts > 0) errs.push(`يوجد ${e.hardConflicts} تعارض إلزامي — يجب أن يكون صفراً.`);
  }
  if (target === "published") {
    if (e.hardConflicts > 0) errs.push(`يوجد ${e.hardConflicts} تعارض إلزامي — يجب أن يكون صفراً.`);
    if (e.qualityScore === null) errs.push("يجب وجود نتيجة جودة — شغّل تقييم الجودة أولاً.");
  }
  return errs;
}

/** Transition with validation + audit event. */
export async function transitionVersion(params: {
  collegeId: string;
  scheduleVersionId: string;
  from: SVStatus;
  to: SVStatus;
  notes?: string;
}): Promise<void> {
  const { collegeId, scheduleVersionId, from, to, notes } = params;
  if (!canTransition(from, to)) {
    throw new Error(`انتقال غير مسموح: ${from} → ${to}`);
  }

  // Hard gates for forward transitions
  if (to === "review" || to === "approved" || to === "published") {
    const e = await evaluateEligibility({ collegeId, scheduleVersionId });
    // For published, auto-score if missing to guarantee a score
    if (to === "published" && e.qualityScore === null) {
      try {
        await scoreScheduleVersion({ collegeId, scheduleVersionId, persist: true });
      } catch {
        // ignore — gate will fail below
      }
    }
    const refreshed = to === "published" ? await evaluateEligibility({ collegeId, scheduleVersionId }) : e;
    const errs = validateGate(to, refreshed);
    if (errs.length > 0) throw new Error(errs.join(" • "));
  }

  const { error: ue } = await supabase
    .from("schedule_versions")
    .update({ status: to })
    .eq("id", scheduleVersionId)
    .eq("college_id", collegeId);
  if (ue) throw ue;

  const { data: userRes } = await supabase.auth.getUser();
  const event_type = EVENT_FOR[`${from}->${to}`] ?? "reverted";
  await supabase.from("schedule_version_events").insert({
    college_id: collegeId,
    schedule_version_id: scheduleVersionId,
    event_type,
    from_status: from,
    to_status: to,
    performed_by: userRes.user?.id ?? null,
    notes: notes ?? null,
  });
}

/** Clone version: copies metadata + sessions only. */
export async function cloneVersion(params: {
  collegeId: string;
  sourceVersionId: string;
  targetTermId: string;
  newName: string;
  notes?: string;
}): Promise<string> {
  const { collegeId, sourceVersionId, targetTermId, newName, notes } = params;

  const { data: src, error: se } = await supabase
    .from("schedule_versions")
    .select("*")
    .eq("id", sourceVersionId)
    .single();
  if (se) throw se;

  const { data: newV, error: ie } = await supabase
    .from("schedule_versions")
    .insert({
      college_id: collegeId,
      academic_term_id: targetTermId,
      name: newName,
      status: "draft",
      notes: notes ?? src.notes ?? null,
    })
    .select("id")
    .single();
  if (ie) throw ie;

  const { data: sessions, error: se2 } = await supabase
    .from("schedule_sessions")
    .select("*")
    .eq("schedule_version_id", sourceVersionId)
    .eq("college_id", collegeId);
  if (se2) throw se2;

  if (sessions && sessions.length > 0) {
    const rows = sessions.map((s) => ({
      college_id: s.college_id,
      schedule_version_id: newV.id,
      course_offering_id: s.course_offering_id,
      teaching_assignment_id: s.teaching_assignment_id,
      instructor_id: s.instructor_id,
      room_id: s.room_id,
      section_id: s.section_id,
      section_group_id: s.section_group_id,
      study_system: s.study_system,
      day_of_week: s.day_of_week,
      start_time: s.start_time,
      end_time: s.end_time,
      session_type: s.session_type,
      expected_students: s.expected_students,
    }));
    const { error: insE } = await supabase.from("schedule_sessions").insert(rows);
    if (insE) throw insE;
  }

  const { data: userRes } = await supabase.auth.getUser();
  await supabase.from("schedule_version_events").insert({
    college_id: collegeId,
    schedule_version_id: newV.id,
    event_type: "cloned",
    from_status: null,
    to_status: "draft",
    performed_by: userRes.user?.id ?? null,
    notes: `Cloned from ${sourceVersionId}`,
    metadata: { source_version_id: sourceVersionId, sessions_copied: sessions?.length ?? 0 },
  });

  return newV.id;
}
