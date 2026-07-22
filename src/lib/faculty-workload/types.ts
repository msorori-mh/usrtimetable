/**
 * A3.5: Faculty workload policies UI types (النصاب حسب الدرجة الأكاديمية).
 *
 * Hand-maintained mirror of the source-only RPC contract in
 * supabase/migrations/20260722110000_source_only_faculty_workload_policies.sql
 * (SOURCE ONLY — NOT APPLIED — gate APPROVE_DB_MIGRATION_APPLY).
 * The generated Supabase types cannot include these RPCs until the migration
 * is applied, so the UI carries local interfaces (house style, same as
 * src/lib/scheduling-headcount).
 */

export type WorkloadStudySystem = "regular" | "parallel" | "evening" | "distance" | "other";

export interface FacultyWorkloadPolicy {
  id: string;
  college_id: string;
  rank_code: string;
  rank_label_ar: string | null;
  rank_aliases: string[];
  required_load_hours: number;
  min_load_hours: number | null;
  max_load_hours: number | null;
  overload_allowed: boolean;
  study_system: WorkloadStudySystem | null;
  term_id: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export type WorkloadStatus =
  | "ok"
  | "deficit"
  | "overload"
  | "over_max"
  | "below_min"
  | "unassigned"
  | "policy_missing";

export interface WorkloadAssignedHoursRow {
  instructor_id: string;
  full_name: string;
  employee_number: string | null;
  academic_rank: string | null;
  standard_assigned_hours: number;
  project_supervision_hours: number;
  policy_id: string | null;
  policy_missing: boolean;
  required_load_hours: number | null;
  min_load_hours: number | null;
  max_load_hours: number | null;
  overload_allowed: boolean;
  status: WorkloadStatus;
}

export type WorkloadWarningCode =
  | "WORKLOAD_OVER_MAX"
  | "WORKLOAD_OVERLOAD"
  | "WORKLOAD_BELOW_MIN"
  | "WORKLOAD_DEFICIT"
  | "WORKLOAD_UNASSIGNED"
  | "POLICY_MISSING";

export interface WorkloadOverloadWarning {
  instructor_id: string;
  full_name: string;
  employee_number: string | null;
  academic_rank: string | null;
  warning_code: WorkloadWarningCode;
  status: WorkloadStatus;
  standard_assigned_hours: number;
  required_load_hours: number | null;
  min_load_hours: number | null;
  max_load_hours: number | null;
  overload_allowed: boolean;
  /** Manager-attention flag — advisory only, never a hard write block. */
  blocking: boolean;
}

export type WorkloadRpcResult<T = Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; code: string; message: string };

export interface WorkloadPolicyInput {
  collegeId: string;
  rankCode: string;
  requiredLoadHours: number;
  rankLabelAr?: string | null;
  rankAliases?: string[];
  studySystem?: WorkloadStudySystem | null;
  termId?: string | null;
  minLoadHours?: number | null;
  maxLoadHours?: number | null;
  overloadAllowed?: boolean;
  notes?: string | null;
}

export interface AssignedHoursResult {
  college_id: string;
  term_id: string | null;
  study_system: string | null;
  rows: WorkloadAssignedHoursRow[];
  can_manage: boolean;
}

export interface OverloadWarningsResult {
  college_id: string;
  term_id: string | null;
  study_system: string | null;
  warnings: WorkloadOverloadWarning[];
}

export interface ResolvePolicyResult {
  policy_missing: boolean;
  policy: FacultyWorkloadPolicy | null;
}
