import { supabase } from "@/integrations/supabase/client";
import type { SVStatus } from "@/lib/schedule-versions/lifecycle";
import { statusesForMode } from "@/lib/reports/filters";
import type {
  AcademicTermOption,
  ReportStatusMode,
  ScheduleVersionOption,
} from "@/lib/reports/types";

export async function fetchAcademicTerms(collegeId: string): Promise<AcademicTermOption[]> {
  const { data, error } = await supabase
    .from("academic_terms")
    .select("id, name")
    .eq("college_id", collegeId)
    .order("start_date", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function fetchScheduleVersions(params: {
  collegeId: string;
  termId?: string | null;
  statusMode: ReportStatusMode;
}): Promise<ScheduleVersionOption[]> {
  const statuses = statusesForMode(params.statusMode);
  let q = supabase
    .from("schedule_versions")
    .select("id, name, status, academic_term_id")
    .eq("college_id", params.collegeId)
    .in("status", statuses as SVStatus[])
    .order("created_at", { ascending: false });

  if (params.termId) {
    q = q.eq("academic_term_id", params.termId);
  }

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as ScheduleVersionOption[];
}

/** Published versions only — for official / published reports. */
export async function fetchPublishedVersions(params: {
  collegeId: string;
  termId?: string | null;
}): Promise<ScheduleVersionOption[]> {
  return fetchScheduleVersions({ ...params, statusMode: "published_only" });
}

/** Draft / review / approved versions — for operational reports. */
export async function fetchWorkingVersions(params: {
  collegeId: string;
  termId?: string | null;
}): Promise<ScheduleVersionOption[]> {
  return fetchScheduleVersions({ ...params, statusMode: "working" });
}
