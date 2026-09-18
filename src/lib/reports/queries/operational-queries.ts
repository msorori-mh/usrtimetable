import { supabase } from "@/integrations/supabase/client";
import { applyStudySystemFilter, assertSingleVersion } from "@/lib/reports/filters";
import { DAY_NAMES_AR, fmtTime } from "@/lib/reports/formatters";
import type { ReportStudySystem } from "@/lib/reports/types";
import {
  buildApprovedExceptionIndex,
  loadApprovedExceptions,
} from "@/lib/conflict-engine/exceptions";
import {
  approvedExceptionForResult,
  classifyConflict,
  type ConflictSessionEvidence,
} from "@/lib/reports/conflict-read-model";
import {
  hydrateWorkspaceSessions,
  type WorkspaceSessionFlatRow,
  type WorkspaceSessionHydratedRow,
} from "@/lib/schedule-builder/queries";
import { entityDisplayName } from "@/lib/entity-display";
import { fetchCohortDeliveryGroupLabels } from "@/lib/reports/queries/session-queries";

export interface ConflictCheckSummary {
  id: string;
  status: string;
  total_conflicts: number;
  created_at: string;
  check_type: string;
}

export interface ConflictResultRow {
  id: string;
  conflict_code: string;
  severity: string;
  message_ar: string;
  message_en: string;
  schedule_session_id: string | null;
  related_session_id: string | null;
  conflict_check_id: string;
}

/** Latest conflict check for one schedule version (read-only). */
export async function fetchLatestConflictCheck(
  collegeId: string,
  versionId: string | null,
): Promise<ConflictCheckSummary | null> {
  assertSingleVersion(versionId);
  const { data, error } = await supabase
    .from("conflict_checks")
    .select("id, status, total_conflicts, created_at, check_type")
    .eq("college_id", collegeId)
    .eq("schedule_version_id", versionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchConflictResults(
  collegeId: string,
  conflictCheckId: string,
): Promise<ConflictResultRow[]> {
  const { data, error } = await supabase
    .from("conflict_results")
    .select(
      "id, conflict_code, severity, message_ar, message_en, schedule_session_id, related_session_id, conflict_check_id",
    )
    .eq("college_id", collegeId)
    .eq("conflict_check_id", conflictCheckId)
    .order("created_at");
  if (error) throw error;
  return data ?? [];
}

type SessionDetail = WorkspaceSessionHydratedRow;

/** Flat conflict evidence select — no nested courses()/instructors()/rooms() embeds. */
const CONFLICT_SESSION_SELECT = `
  id, schedule_version_id, day_of_week, start_time, end_time, session_type, study_system,
  section_id, section_subgroup_id, instructor_id, room_id, updated_at, is_locked,
  replaced_by_split, expected_students, course_offering_id,
  cohort_id, delivery_group_id, source_type, teaching_assignment_id, section_group_id
`;

async function fetchSessionsByIds(
  collegeId: string,
  versionId: string,
  sessionIds: string[],
  studySystem: ReportStudySystem,
): Promise<Map<string, SessionDetail>> {
  if (!sessionIds.length) return new Map();
  let q = supabase
    .from("schedule_sessions")
    .select(CONFLICT_SESSION_SELECT)
    .eq("college_id", collegeId)
    .eq("schedule_version_id", versionId)
    .in("id", sessionIds);
  q = applyStudySystemFilter(q, studySystem);
  const { data, error } = await q;
  if (error) throw error;
  const hydrated = await hydrateWorkspaceSessions((data ?? []) as WorkspaceSessionFlatRow[]);
  const map = new Map<string, SessionDetail>();
  for (const s of hydrated) {
    map.set(s.id, s);
  }
  return map;
}

function sessionLabel(s: SessionDetail | undefined): string {
  if (!s) return "";
  const c = s.course_offerings?.courses;
  if (!c) return "مقرر غير متاح";
  return entityDisplayName(c, "مقرر غير متاح");
}

function sessionTime(s: SessionDetail | undefined): string {
  if (!s) return "";
  return `${DAY_NAMES_AR[s.day_of_week] ?? ""} ${fmtTime(s.start_time)}-${fmtTime(s.end_time)}`;
}

/** Build export rows for conflict report — single version, read-only. */
export async function fetchConflictReportRows(params: {
  collegeId: string;
  versionId: string | null;
  studySystem: ReportStudySystem;
}) {
  assertSingleVersion(params.versionId);
  const versionId = params.versionId;
  const check = await fetchLatestConflictCheck(params.collegeId, versionId);
  if (!check) return { check: null, rows: [] as Record<string, unknown>[] };

  const [results, exceptions] = await Promise.all([
    fetchConflictResults(params.collegeId, check.id),
    loadApprovedExceptions({ scheduleVersionId: versionId, collegeId: params.collegeId }),
  ]);
  const exceptionIndex = buildApprovedExceptionIndex(exceptions, versionId);
  const ids = new Set<string>();
  for (const r of results) {
    if (r.schedule_session_id) ids.add(r.schedule_session_id);
    if (r.related_session_id) ids.add(r.related_session_id);
  }
  const sessionMap = await fetchSessionsByIds(
    params.collegeId,
    versionId,
    Array.from(ids),
    params.studySystem,
  );
  const labels = await fetchCohortDeliveryGroupLabels(
    params.collegeId,
    Array.from(sessionMap.values()),
  );

  const rows = results
    .filter((r) => {
      if (params.studySystem === "all") return true;
      const primary = r.schedule_session_id ? sessionMap.get(r.schedule_session_id) : undefined;
      const related = r.related_session_id ? sessionMap.get(r.related_session_id) : undefined;
      return r.schedule_session_id && r.related_session_id
        ? !!(primary && related)
        : !!(primary || related);
    })
    .map((r) => {
      const primary = r.schedule_session_id ? sessionMap.get(r.schedule_session_id) : undefined;
      const related = r.related_session_id ? sessionMap.get(r.related_session_id) : undefined;
      const sess = primary ?? related;
      const approvedException = approvedExceptionForResult(exceptionIndex, versionId, r);
      const classified = classifyConflict({
        result: r,
        versionId,
        primary: primary as ConflictSessionEvidence | undefined,
        related: related as ConflictSessionEvidence | undefined,
        approvedException,
        checkCreatedAt: check.created_at,
      });
      const day = primary?.day_of_week ?? related?.day_of_week;
      const overlapText = classified.overlap
        ? `${DAY_NAMES_AR[day ?? -1] ?? day ?? ""} ${fmtTime(classified.overlap.start)}-${fmtTime(classified.overlap.end)}`
        : "";
      return {
        conflict_code: r.conflict_code,
        severity: r.severity,
        message: r.message_ar,
        message_en: r.message_en,
        course: sessionLabel(primary) || sessionLabel(related),
        instructor: sess?.instructors?.full_name ?? "",
        room: sess?.rooms ? entityDisplayName(sess.rooms, "") : "",
        cohort: sess?.cohort_id ? (labels.cohorts.get(sess.cohort_id) ?? "دفعة غير مسماة") : "—",
        delivery_group: sess?.delivery_group_id
          ? (labels.deliveryGroups.get(sess.delivery_group_id) ?? "مجموعة غير مسماة")
          : "—",
        legacy_section: sess?.sections?.section_number ?? "",
        day_time: overlapText || sessionTime(primary) || sessionTime(related),
        study_system:
          sess?.study_system === "regular"
            ? "عام"
            : sess?.study_system === "parallel"
              ? "موازي"
              : sess?.study_system === "both"
                ? "مشترك"
                : (sess?.study_system ?? "—"),
        check_status:
          check.status === "completed" || check.status === "complete"
            ? "مكتمل"
            : check.status === "running"
              ? "قيد الفحص"
              : check.status === "failed"
                ? "فشل الفحص"
                : check.status,
        classification: classified.classification,
        evidence_status: classified.evidenceStatus,
        schedule_version_id: versionId,
        primary_session_id: r.schedule_session_id ?? "",
        related_session_id: r.related_session_id ?? "",
        resolution_detail: approvedException
          ? `استثناء معتمد: ${approvedException.reason}`
          : classified.classification === "unknown"
            ? "الأدلة غير مكتملة؛ أعد فحص التعارضات بعد التحقق من بيانات الجلسة."
            : "—",
        resolution: "—",
      };
    });

  return { check, rows };
}

export interface QualityRunRow {
  id: string;
  schedule_version_id: string;
  total_score: number;
  hard_conflicts_count: number;
  soft_conflicts_count: number;
  total_deductions: number;
  metrics_breakdown: Record<string, unknown> | null;
  created_at: string;
}

/** Latest quality run for one version only. */
export async function fetchLatestQualityRun(
  collegeId: string,
  versionId: string | null,
): Promise<QualityRunRow | null> {
  assertSingleVersion(versionId);
  const { data, error } = await supabase
    .from("schedule_quality_runs")
    .select(
      "id, schedule_version_id, total_score, hard_conflicts_count, soft_conflicts_count, total_deductions, metrics_breakdown, created_at",
    )
    .eq("college_id", collegeId)
    .eq("schedule_version_id", versionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as QualityRunRow | null;
}

export interface UnscheduledSessionCount {
  course_offering_id: string;
  session_type: string;
}

/** Session counts for one version — used by unscheduled report. */
export async function fetchUnscheduledSessionCounts(params: {
  collegeId: string;
  versionId: string | null;
  studySystem: ReportStudySystem;
}): Promise<UnscheduledSessionCount[]> {
  assertSingleVersion(params.versionId);
  let q = supabase
    .from("schedule_sessions")
    .select("course_offering_id, session_type, study_system")
    .eq("college_id", params.collegeId)
    .eq("schedule_version_id", params.versionId);
  q = applyStudySystemFilter(q, params.studySystem);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

/** Latest auto_schedule run unplaced data (read-only — does not run scheduler). */
export async function fetchLatestUnplacedReasons(versionId: string | null) {
  assertSingleVersion(versionId);
  const { data, error } = await supabase
    .from("auto_schedule_runs")
    .select("unplaced, created_at")
    .eq("schedule_version_id", versionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}
