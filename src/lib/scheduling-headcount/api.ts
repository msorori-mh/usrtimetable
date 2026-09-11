import { supabase } from "@/integrations/supabase/client";
import type {
  HeadcountInput,
  HeadcountOverrideInput,
  HeadcountRpcResult,
  SchedulingHeadcountRevision,
} from "./types";
import type { HeadcountImportRow, ImportCohort } from "./import";

export async function getHeadcountImportContext(collegeId: string) {
  const result = await call<{ cohorts: ImportCohort[] }>("get_scheduling_headcount_import_context", { p_college_id: collegeId });
  if (!result.ok) throw new Error(result.message);
  return result.cohorts;
}

export interface HeadcountImportResult {
  changed: number;
  rows: { cohort_id: string; term_id: string; expected_version: string; approval_status: string }[];
}
export async function commitHeadcountImport(collegeId: string, rows: HeadcountImportRow[], action: "save" | "approve") {
  const result = await call<HeadcountImportResult>("import_scheduling_headcounts", { p_college_id: collegeId, p_rows: rows, p_action: action });
  if (!result.ok) throw new Error(result.message);
  return result;
}

async function call<T>(
  name: string,
  args: Record<string, unknown>,
): Promise<HeadcountRpcResult<T>> {
  const { data, error } = await supabase.rpc(name as never, args as never);
  if (error) throw error;
  return data as HeadcountRpcResult<T>;
}

export function upsertSchedulingCohortTermHeadcount(input: HeadcountInput) {
  return call("upsert_scheduling_cohort_term_headcount", {
    p_cohort_id: input.cohortId,
    p_term_id: input.termId,
    p_registered_student_count: input.registeredStudentCount,
    p_eligible_student_count: input.eligibleStudentCount,
    p_expected_attendance_count: input.expectedAttendanceCount,
    p_reserve_margin: input.reserveMargin ?? 0,
    p_scheduling_headcount: input.schedulingHeadcount,
    p_exam_eligible_count: input.examEligibleCount,
    p_source: input.source,
    p_notes: input.notes ?? null,
    p_allow_over_eligible: input.allowOverEligible ?? false,
  });
}

export function approveSchedulingCohortTermHeadcount(id: string, notes?: string | null) {
  return call("approve_scheduling_cohort_term_headcount", { p_id: id, p_notes: notes ?? null });
}

export function upsertSchedulingHeadcountOverride(input: HeadcountOverrideInput) {
  return call("upsert_scheduling_headcount_override", {
    p_headcount_id: input.headcountId,
    p_course_offering_id: input.courseOfferingId ?? null,
    p_plan_course_component_id: input.planCourseComponentId ?? null,
    p_scheduling_headcount: input.schedulingHeadcount,
    p_exam_eligible_count: input.examEligibleCount ?? null,
    p_reserve_margin: input.reserveMargin ?? null,
    p_source: input.source,
    p_notes: input.notes ?? null,
    p_allow_over_eligible: input.allowOverEligible ?? false,
  });
}

export function archiveSchedulingHeadcountOverride(id: string, notes?: string | null) {
  return call("archive_scheduling_headcount_override", { p_id: id, p_notes: notes ?? null });
}

export function resolveSchedulingHeadcountRpc(args: {
  collegeId: string;
  cohortId: string;
  termId: string;
  courseOfferingId?: string | null;
  planCourseComponentId?: string | null;
}) {
  return call("resolve_scheduling_headcount", {
    p_college_id: args.collegeId,
    p_cohort_id: args.cohortId,
    p_term_id: args.termId,
    p_course_offering_id: args.courseOfferingId ?? null,
    p_plan_course_component_id: args.planCourseComponentId ?? null,
  });
}

export function listSchedulingHeadcountRevisions(headcountId: string) {
  return call<{ revisions: SchedulingHeadcountRevision[] }>("list_scheduling_headcount_revisions", {
    p_headcount_id: headcountId,
  });
}
