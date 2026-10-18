import { supabase } from "@/integrations/supabase/client";
import { chunkIds, readAllRows } from "@/lib/supabase/read-all";
import { fetchServerVersionValidation } from "@/lib/conflict-engine/server-validation";
import {
  assignmentIntegrityReason,
  findSessionAssignmentIssues,
  type AssignmentIntegrityAssignment,
} from "./assignment-integrity";
import {
  type DisposablePurgeResult,
  PURGE_RPC_NAME,
} from "@/lib/schedule-versions/disposable-purge";

export {
  assertDisposablePurgeEligibility,
  type DisposablePurgeResult,
} from "@/lib/schedule-versions/disposable-purge";

export type SVStatus = "draft" | "review" | "approved" | "published" | "archived";

export const STATUS_LABEL_AR: Record<SVStatus, string> = {
  draft: "مسودة",
  review: "قيد المراجعة",
  approved: "معتمد",
  published: "منشور",
  archived: "مؤرشف",
};

export const STATUS_BADGE_VARIANT: Record<
  SVStatus,
  "secondary" | "default" | "outline" | "destructive"
> = {
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

export function nextActions(
  status: SVStatus,
): Array<{ to: SVStatus; label: string; kind: "forward" | "rollback" }> {
  const out: ReturnType<typeof nextActions> = [];
  for (const [a, b] of ALLOWED) {
    if (a !== status) continue;
    const forward =
      ["review", "approved", "published", "archived"].indexOf(b) >
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

export interface EligibilityResult {
  ok: boolean;
  reasons: string[];
  warnings: string[];
  /** Unapproved hard conflicts — used for gate eligibility. */
  hardConflicts: number;
  totalHardConflicts: number;
  approvedHardConflicts: number;
  unapprovedHardConflicts: number;
  qualityScore: number | null;
  sessionsCount: number;
  assignmentIntegrityErrors?: string[];
}

/**
 * Eligibility for the lifecycle actions. Hard-conflict counts come from the server
 * (public.validate_schedule_version — the same computation transition_schedule_version
 * runs), including approved exceptions and super-admin policy waivers (Q-2, M-11).
 */
export async function evaluateEligibility(params: {
  collegeId: string;
  scheduleVersionId: string;
}): Promise<EligibilityResult> {
  const { collegeId, scheduleVersionId } = params;
  const reasons: string[] = [];
  const warnings: string[] = [];

  const sessions = await readAllRows<{
    id: string;
    instructor_id: string;
    teaching_assignment_id: string | null;
    replaced_by_split: boolean | null;
  }>((from, to) =>
    supabase
      .from("schedule_sessions")
      .select("id, instructor_id, teaching_assignment_id, replaced_by_split")
      .eq("college_id", collegeId)
      .eq("schedule_version_id", scheduleVersionId)
      .order("id")
      .range(from, to),
  );

  const assignmentIds = [
    ...new Set(
      sessions.flatMap((s) =>
        !s.replaced_by_split && s.teaching_assignment_id ? [s.teaching_assignment_id] : [],
      ),
    ),
  ];
  const assignments: AssignmentIntegrityAssignment[] = [];
  for (const ids of chunkIds(assignmentIds, 100)) {
    const { data, error } = await supabase
      .from("teaching_assignments")
      .select("id,instructor_id,is_active")
      .in("id", ids);
    if (error) throw error;
    assignments.push(...(data ?? []));
  }
  const assignmentIssues = findSessionAssignmentIssues(sessions, assignments);
  const assignmentIntegrityErrors = assignmentIssues.length
    ? [assignmentIntegrityReason(assignmentIssues.length)]
    : [];
  reasons.push(...assignmentIntegrityErrors);

  let totalHard = 0;
  let approvedHard = 0;
  let unapprovedHard = 0;
  if (sessions.length > 0) {
    const server = await fetchServerVersionValidation(scheduleVersionId);
    totalHard = server.totalHardCount;
    approvedHard = server.approvedCount;
    unapprovedHard = server.hardCount;
    if (server.waivedCount > 0) {
      warnings.push(
        `يوجد ${server.waivedCount} تعارض مُستثنى بقرار إداري معتمد (يظهر كتحذير ولا يمنع الاعتماد).`,
      );
    }
  }

  if (unapprovedHard > 0) {
    reasons.push(
      `يوجد ${unapprovedHard} تعارض إلزامي غير معتمد (${totalHard} إجمالي، ${approvedHard} معتمد).`,
    );
  }

  // Latest quality run
  const { data: qrow, error: qerr } = await supabase
    .from("schedule_quality_runs")
    .select("total_score, soft_conflicts_count")
    .eq("college_id", collegeId)
    .eq("schedule_version_id", scheduleVersionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (qerr) throw qerr;

  if (qrow && qrow.soft_conflicts_count > 0) {
    warnings.push(`يوجد ${qrow.soft_conflicts_count} مخالفة مرنة (مسموح بها لكن يُنصح بمراجعتها).`);
  }

  return {
    ok: reasons.length === 0,
    reasons,
    warnings,
    hardConflicts: unapprovedHard,
    totalHardConflicts: totalHard,
    approvedHardConflicts: approvedHard,
    unapprovedHardConflicts: unapprovedHard,
    qualityScore: qrow?.total_score ?? null,
    sessionsCount: sessions.length,
    assignmentIntegrityErrors,
  };
}

/** Validate gate for a specific target status. */
export function validateGate(target: SVStatus, e: EligibilityResult, from?: SVStatus): string[] {
  const errs: string[] = [];
  if (
    (target === "review" || target === "approved" || target === "published") &&
    !(from === "approved" && target === "review")
  ) {
    errs.push(...(e.assignmentIntegrityErrors ?? []));
  }
  if (target === "review") {
    if (e.sessionsCount < 1) errs.push("النسخة لا تحتوي على أي محاضرات.");
    if (e.unapprovedHardConflicts > 0) {
      errs.push(
        `يوجد ${e.unapprovedHardConflicts} تعارض إلزامي غير معتمد — يجب معالجته قبل المراجعة (${e.totalHardConflicts} إجمالي، ${e.approvedHardConflicts} معتمد).`,
      );
    }
  }
  if (target === "approved") {
    if (e.unapprovedHardConflicts > 0) {
      errs.push(
        `يوجد ${e.unapprovedHardConflicts} تعارض إلزامي غير معتمد — يجب أن يكون صفراً (${e.totalHardConflicts} إجمالي، ${e.approvedHardConflicts} معتمد).`,
      );
    }
  }
  if (target === "published") {
    if (e.unapprovedHardConflicts > 0) {
      errs.push(
        `يوجد ${e.unapprovedHardConflicts} تعارض إلزامي غير معتمد — يجب أن يكون صفراً (${e.totalHardConflicts} إجمالي، ${e.approvedHardConflicts} معتمد).`,
      );
    }
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
  if (!canTransition(from, to)) throw new Error(`Invalid transition: ${from} -> ${to}`);

  const { error } = await supabase.rpc("transition_schedule_version", {
    p_college_id: collegeId,
    p_schedule_version_id: scheduleVersionId,
    p_expected_status: from,
    p_target_status: to,
    p_notes: notes ?? undefined,
  });
  if (error) {
    if (error.message.includes("PUBLISH_BLOCKER:UNAPPROVED_HARD_CONFLICTS")) {
      throw new Error(
        "رفض الخادم الانتقال: توجد تعارضات إلزامية غير معتمدة في النسخة. أعد فحص التعارضات وعالجها أو اعتمد استثناءً رسمياً.",
      );
    }
    if (error.message.includes("PUBLISH_BLOCKER:QUALITY_RUN_STALE")) {
      throw new Error("تغيرت النسخة بعد آخر تقييم جودة. أعد احتساب الجودة ثم حاول مجدداً.");
    }
    if (error.message.includes("PUBLISH_BLOCKER:QUALITY_RUN_REQUIRED")) {
      throw new Error("يجب احتساب جودة النسخة قبل هذا الإجراء.");
    }
    if (error.message.includes("SCHEDULE_SESSION_ASSIGNMENT_INTEGRITY")) {
      throw new Error(
        "تعذر اعتماد أو نشر النسخة: توجد جلسات مرتبطة بإسنادات ملغاة أو لا تطابق محاضريها. صحّح ارتباط الجلسات بالإسنادات ثم أعد فحص التعارضات.",
      );
    }
    throw error;
  }
}

/** Clone version: copies metadata + sessions only. */
export type CloneVersionResult = {
  version_id: string;
  source_sessions: number;
  sessions_copied: number;
  sessions_skipped: number;
  skipped_sessions: Array<{
    session_id: string;
    reason: string;
    was_locked: boolean;
  }>;
};

export async function cloneVersion(params: CloneVersionParams): Promise<string> {
  return (await cloneVersionWithSummary({ ...params, requireComplete: true })).version_id;
}

export type CloneVersionParams = {
  collegeId: string;
  sourceVersionId: string;
  targetTermId: string;
  newName: string;
  notes?: string;
  /** When true, marks the clone as disposable_test (super_admin only). Default false. */
  disposableTest?: boolean;
  requireComplete?: boolean;
};

export async function cloneVersionWithSummary(
  params: CloneVersionParams,
): Promise<CloneVersionResult> {
  const { data, error } = await supabase.rpc(
    "clone_schedule_version_current" as never,
    {
      p_college_id: params.collegeId,
      p_source_version_id: params.sourceVersionId,
      p_target_term_id: params.targetTermId,
      p_name: params.newName,
      p_notes: params.notes ?? null,
      p_disposable_test: params.disposableTest === true,
      p_require_complete: params.requireComplete === true,
    } as never,
  );
  if (error) {
    const messages: Record<string, string> = {
      CLONE_SOURCE_HAS_STALE_SESSIONS:
        "لا يمكن إنشاء نسخة احتياطية كاملة قبل مطابقة الإسنادات المتغيرة. استخدم استنساخ المسودة للمراجعة.",
      CLONE_TERM_REMAP_REQUIRED:
        "استنساخ المحاضرات متاح داخل الفصل نفسه. الفصل الآخر يحتاج مطابقة إسناداته أولًا.",
      CLONE_NOT_AUTHORIZED: "ليس لديك صلاحية استنساخ جدول هذه الكلية.",
      CLONE_SOURCE_NOT_FOUND: "لم تُعثر على النسخة الأصلية في الكلية المختارة.",
      INACTIVE_ASSIGNMENT_SESSION_FORBIDDEN:
        "تغيرت الإسنادات أثناء الاستنساخ. حدّث الصفحة وأعد المحاولة؛ لم تُحفظ مسودة جزئية.",
    };
    throw new Error(
      messages[error.message] ?? `تعذر الاستنساخ؛ لم تُحفظ مسودة جزئية. ${error.message}`,
    );
  }
  return data as unknown as CloneVersionResult;
}

/** Atomic super_admin-only purge of an explicitly marked disposable draft version. */
export async function purgeDisposableDraftScheduleVersion(
  versionId: string,
): Promise<DisposablePurgeResult> {
  // RPC is source-only until controlled migration apply; cast avoids regenerating full types.ts in this PR.
  const { data, error } = await supabase.rpc(
    PURGE_RPC_NAME as never,
    {
      p_version_id: versionId,
    } as never,
  );
  if (error) throw error;
  return data as DisposablePurgeResult;
}
