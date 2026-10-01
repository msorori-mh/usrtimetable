/**
 * Phase 9.4 — application service for Teaching Assignments V2 RPCs.
 * Client never writes teaching_assignments directly for V2 mutations.
 */

import { supabase } from "@/integrations/supabase/client";
import {
  mapAssignmentRpcError,
  parseMutationResult,
  parseWorkloadPreview,
  parseWorkspacePayload,
  workspaceRpcArgs,
  type AssignmentMutationResult,
  type TeachingAssignmentWorkspace,
  type TeachingAssignmentsV2ImportCommitResult,
  type WorkloadImpactPreview,
  type WorkspaceFilters,
} from "@/lib/academic-delivery/teaching-assignments-v2";

type RpcClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

function client(): RpcClient {
  return supabase as unknown as RpcClient;
}

function throwMapped(error: { message: string } | null): never {
  const mapped = mapAssignmentRpcError(error?.message);
  throw new Error(`${mapped.code}: ${mapped.message}`);
}

export async function listTeachingAssignmentWorkspace(
  filters: WorkspaceFilters,
): Promise<TeachingAssignmentWorkspace> {
  if (!filters.collegeId) throw new Error("COLLEGE_ID_REQUIRED: اختر كلية");
  const versionView = !!filters.scheduleVersionId;
  const { data, error } = await client().rpc(
    versionView
      ? "list_teaching_assignment_workspace_for_version"
      : "list_teaching_assignment_workspace",
    workspaceRpcArgs(filters),
  );
  if (error) throwMapped(error);
  return parseWorkspacePayload(data);
}

export async function getDeliveryGroupAssignmentCandidates(deliveryGroupId: string) {
  if (!deliveryGroupId) throw new Error("DELIVERY_GROUP_ID_REQUIRED");
  const { data, error } = await client().rpc("get_delivery_group_assignment_candidates", {
    p_delivery_group_id: deliveryGroupId,
  });
  if (error) throwMapped(error);
  return data as Record<string, unknown>;
}

export async function previewInstructorWorkloadAfterAssignment(input: {
  instructorId: string;
  deliveryGroupId: string;
  assignedComponentHours?: number | null;
  assignmentId?: string | null;
}): Promise<WorkloadImpactPreview> {
  const { data, error } = await client().rpc("preview_instructor_workload_after_assignment", {
    p_instructor_id: input.instructorId,
    p_delivery_group_id: input.deliveryGroupId,
    p_assigned_component_hours: input.assignedComponentHours ?? null,
    p_assignment_id: input.assignmentId ?? null,
  });
  if (error) throwMapped(error);
  return parseWorkloadPreview(data);
}

export async function createTeachingAssignmentV2(input: {
  deliveryGroupId: string;
  instructorId: string;
  assignedComponentHours?: number | null;
  notes?: string | null;
}): Promise<AssignmentMutationResult> {
  const { data, error } = await client().rpc("create_teaching_assignment_v2", {
    p_delivery_group_id: input.deliveryGroupId,
    p_instructor_id: input.instructorId,
    p_assigned_component_hours: input.assignedComponentHours ?? null,
    p_notes: input.notes ?? null,
  });
  if (error) throwMapped(error);
  const result = parseMutationResult(data);
  if (!result.ok) throw new Error("ASSIGNMENT_MUTATION_FAILED");
  return result;
}

export async function updateTeachingAssignmentV2(input: {
  assignmentId: string;
  expectedUpdatedAt: string;
  assignedComponentHours?: number | null;
  notes?: string | null;
}): Promise<AssignmentMutationResult> {
  const { data, error } = await client().rpc("update_teaching_assignment_v2", {
    p_assignment_id: input.assignmentId,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_assigned_component_hours: input.assignedComponentHours ?? null,
    p_notes: input.notes ?? null,
  });
  if (error) throwMapped(error);
  const result = parseMutationResult(data);
  if (!result.ok) throw new Error("ASSIGNMENT_MUTATION_FAILED");
  return result;
}

export async function deactivateTeachingAssignmentV2(input: {
  assignmentId: string;
  expectedUpdatedAt: string;
  reason?: string | null;
}): Promise<AssignmentMutationResult> {
  const { data, error } = await client().rpc("deactivate_teaching_assignment_v2", {
    p_assignment_id: input.assignmentId,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_reason: input.reason ?? null,
  });
  if (error) throwMapped(error);
  const result = parseMutationResult(data);
  if (!result.ok) throw new Error("ASSIGNMENT_MUTATION_FAILED");
  return result;
}

/**
 * Atomic Excel import commit via gated batch RPC.
 * No client-side insert/update/upsert on teaching_assignments.
 */
export async function commitTeachingAssignmentsV2Import(input: {
  mode: "insert_only" | "update_existing" | "upsert";
  rows: Array<Record<string, unknown>>;
}): Promise<TeachingAssignmentsV2ImportCommitResult> {
  const { data, error } = await client().rpc("commit_teaching_assignments_v2_import", {
    p_rows: input.rows,
    p_mode: input.mode,
  });
  if (error) throwMapped(error);
  const payload = (data ?? {}) as TeachingAssignmentsV2ImportCommitResult;
  return {
    status: payload.status ?? "failed",
    rows_received: Number(payload.rows_received ?? 0),
    rows_created: Number(payload.rows_created ?? 0),
    rows_updated: Number(payload.rows_updated ?? 0),
    rows_reactivated: Number(payload.rows_reactivated ?? 0),
    rows_unchanged: Number(payload.rows_unchanged ?? 0),
    validation_errors: Array.isArray(payload.validation_errors) ? payload.validation_errors : [],
    warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
    import_batch_id: payload.import_batch_id,
  };
}
