/**
 * Read-only Schedule Builder workspace queries.
 * College-scoped; no mutations.
 */
import { supabase } from "@/integrations/supabase/client";
import { applyStudySystemFilter } from "@/lib/reports/filters";
import { TIMETABLE_SESSION_SELECT } from "@/lib/reports/queries/session-queries";
import type { SVStatus } from "@/lib/schedule-versions/lifecycle";

export type WorkspaceStudySystem = "regular" | "parallel";

export interface WorkspaceTerm {
  id: string;
  name: string;
  code: string | null;
  academic_year: string | null;
  is_active: boolean;
}

export interface WorkspaceVersion {
  id: string;
  name: string;
  status: SVStatus;
  academic_term_id: string;
  updated_at: string;
  created_at: string;
}

export interface WorkspaceSchedulingSettings {
  working_days: number[] | null;
  day_start_time: string | null;
  day_end_time: string | null;
}

export async function fetchWorkspaceTerms(collegeId: string): Promise<WorkspaceTerm[]> {
  const { data, error } = await supabase
    .from("academic_terms")
    .select("id, name, code, academic_year, is_active")
    .eq("college_id", collegeId)
    .order("start_date", { ascending: false });
  if (error) throw error;
  return (data ?? []) as WorkspaceTerm[];
}

/** All version statuses for the college + term (read-only list). */
export async function fetchWorkspaceVersions(params: {
  collegeId: string;
  termId: string;
}): Promise<WorkspaceVersion[]> {
  const { data, error } = await supabase
    .from("schedule_versions")
    .select("id, name, status, academic_term_id, updated_at, created_at")
    .eq("college_id", params.collegeId)
    .eq("academic_term_id", params.termId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as WorkspaceVersion[];
}

export async function fetchWorkspaceSessions(params: {
  collegeId: string;
  versionId: string;
  studySystem: WorkspaceStudySystem;
}) {
  let q = supabase
    .from("schedule_sessions")
    .select(TIMETABLE_SESSION_SELECT)
    .eq("college_id", params.collegeId)
    .eq("schedule_version_id", params.versionId)
    .order("day_of_week")
    .order("start_time");

  q = applyStudySystemFilter(q, params.studySystem);

  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function fetchWorkspaceSchedulingSettings(
  collegeId: string,
): Promise<WorkspaceSchedulingSettings | null> {
  const { data, error } = await supabase
    .from("scheduling_settings")
    .select("working_days, day_start_time, day_end_time")
    .eq("college_id", collegeId)
    .maybeSingle();
  if (error) throw error;
  return data as WorkspaceSchedulingSettings | null;
}

export interface WorkspaceTimeTemplate {
  start_time: string;
  end_time: string;
  day_of_week: number;
  study_system: string;
}

export async function fetchWorkspaceTimeTemplates(
  collegeId: string,
): Promise<WorkspaceTimeTemplate[]> {
  const { data, error } = await supabase
    .from("time_slot_templates")
    .select("start_time, end_time, day_of_week, study_system")
    .eq("college_id", collegeId)
    .eq("is_active", true);
  if (error) throw error;
  return (data ?? []) as WorkspaceTimeTemplate[];
}
