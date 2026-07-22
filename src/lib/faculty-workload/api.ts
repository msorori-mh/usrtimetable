/**
 * A3.5: Faculty workload policies — RPC wrappers only.
 *
 * All writes go through the gated A3 RPCs (direct INSERT/UPDATE/DELETE on
 * public.faculty_workload_policies is revoked by the source-only migration).
 * The RPCs are SOURCE ONLY — NOT APPLIED: calls will fail until the migration
 * is approved and applied (documented readiness blocker).
 */
import { supabase } from "@/integrations/supabase/client";
import type {
  AssignedHoursResult,
  FacultyWorkloadPolicy,
  OverloadWarningsResult,
  ResolvePolicyResult,
  WorkloadPolicyInput,
  WorkloadRpcResult,
  WorkloadStudySystem,
} from "./types";

async function call<T>(
  name: string,
  args: Record<string, unknown>,
): Promise<WorkloadRpcResult<T>> {
  const { data, error } = await supabase.rpc(name as never, args as never);
  if (error) throw error;
  return data as WorkloadRpcResult<T>;
}

export function upsertFacultyWorkloadPolicy(input: WorkloadPolicyInput) {
  return call<{ action: string; policy: FacultyWorkloadPolicy }>(
    "upsert_faculty_workload_policy",
    {
      p_college_id: input.collegeId,
      p_rank_code: input.rankCode,
      p_required_load_hours: input.requiredLoadHours,
      p_rank_label_ar: input.rankLabelAr ?? null,
      p_rank_aliases: input.rankAliases ?? [],
      p_study_system: input.studySystem ?? null,
      p_term_id: input.termId ?? null,
      p_min_load_hours: input.minLoadHours ?? null,
      p_max_load_hours: input.maxLoadHours ?? null,
      p_overload_allowed: input.overloadAllowed ?? false,
      p_notes: input.notes ?? null,
    },
  );
}

export function deactivateFacultyWorkloadPolicy(id: string, notes?: string | null) {
  return call<{ action: string; policy: FacultyWorkloadPolicy }>(
    "deactivate_faculty_workload_policy",
    { p_id: id, p_notes: notes ?? null },
  );
}

export function resolveFacultyWorkloadPolicy(args: {
  instructorId: string;
  termId?: string | null;
  studySystem?: WorkloadStudySystem | null;
}) {
  return call<ResolvePolicyResult>("resolve_faculty_workload_policy", {
    p_instructor_id: args.instructorId,
    p_term_id: args.termId ?? null,
    p_study_system: args.studySystem ?? null,
  });
}

export function listFacultyWorkloadAssignedHours(args: {
  collegeId: string;
  termId?: string | null;
  studySystem?: WorkloadStudySystem | null;
}) {
  return call<AssignedHoursResult>("list_faculty_workload_assigned_hours", {
    p_college_id: args.collegeId,
    p_term_id: args.termId ?? null,
    p_study_system: args.studySystem ?? null,
  });
}

export function listFacultyWorkloadOverloadWarnings(args: {
  collegeId: string;
  termId?: string | null;
  studySystem?: WorkloadStudySystem | null;
}) {
  return call<OverloadWarningsResult>("list_faculty_workload_overload_warnings", {
    p_college_id: args.collegeId,
    p_term_id: args.termId ?? null,
    p_study_system: args.studySystem ?? null,
  });
}
