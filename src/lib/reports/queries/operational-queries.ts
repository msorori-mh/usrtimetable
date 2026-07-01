import { supabase } from "@/integrations/supabase/client";
import { applyStudySystemFilter, assertSingleVersion } from "@/lib/reports/filters";
import { DAY_NAMES_AR, fmtTime } from "@/lib/reports/formatters";
import type { ReportStudySystem } from "@/lib/reports/types";

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
    .select("id, conflict_code, severity, message_ar, message_en, schedule_session_id, related_session_id, conflict_check_id")
    .eq("college_id", collegeId)
    .eq("conflict_check_id", conflictCheckId)
    .order("created_at");
  if (error) throw error;
  return data ?? [];
}

interface SessionDetail {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  study_system: string;
  session_type: string;
  instructors: { full_name: string } | null;
  rooms: { code: string; name: string } | null;
  sections: { section_number: string } | null;
  course_offerings: {
    courses: { code: string; name: string } | null;
  } | null;
}

const CONFLICT_SESSION_SELECT = `
  id, day_of_week, start_time, end_time, study_system, session_type,
  instructors(full_name),
  rooms(code, name),
  sections(section_number),
  course_offerings(courses(code, name))
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
  const map = new Map<string, SessionDetail>();
  for (const s of (data ?? []) as unknown as SessionDetail[]) {
    map.set(s.id, s);
  }
  return map;
}

function sessionLabel(s: SessionDetail | undefined): string {
  if (!s) return "";
  const c = s.course_offerings?.courses;
  return c ? `${c.code ?? ""} ${c.name ?? ""}`.trim() : "";
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
  const check = await fetchLatestConflictCheck(params.collegeId, params.versionId);
  if (!check) return { check: null, rows: [] as Record<string, unknown>[] };

  const results = await fetchConflictResults(params.collegeId, check.id);
  const ids = new Set<string>();
  for (const r of results) {
    if (r.schedule_session_id) ids.add(r.schedule_session_id);
    if (r.related_session_id) ids.add(r.related_session_id);
  }
  const sessionMap = await fetchSessionsByIds(
    params.collegeId,
    params.versionId,
    Array.from(ids),
    params.studySystem,
  );

  const rows = results
    .filter((r) => {
      if (params.studySystem === "all") return true;
      const primary = r.schedule_session_id ? sessionMap.get(r.schedule_session_id) : undefined;
      const related = r.related_session_id ? sessionMap.get(r.related_session_id) : undefined;
      return !!(primary || related);
    })
    .map((r) => {
      const primary = r.schedule_session_id ? sessionMap.get(r.schedule_session_id) : undefined;
      const related = r.related_session_id ? sessionMap.get(r.related_session_id) : undefined;
      const sess = primary ?? related;
      return {
        conflict_code: r.conflict_code,
        severity: r.severity,
        message: r.message_ar,
        message_en: r.message_en,
        course: sessionLabel(primary) || sessionLabel(related),
        instructor: sess?.instructors?.full_name ?? "",
        room: sess?.rooms ? `${sess.rooms.code ?? ""} ${sess.rooms.name ?? ""}`.trim() : "",
        section: sess?.sections?.section_number ?? "",
        day_time: sessionTime(primary) || sessionTime(related),
        study_system: sess?.study_system ?? "",
        check_status: check.status,
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
    .select("id, schedule_version_id, total_score, hard_conflicts_count, soft_conflicts_count, total_deductions, metrics_breakdown, created_at")
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
