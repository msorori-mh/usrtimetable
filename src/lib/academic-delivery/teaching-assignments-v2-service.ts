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
  type AssignmentMutationResult,
  type TeachingAssignmentWorkspace,
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
  const { data, error } = await client().rpc("list_teaching_assignment_workspace", {
    p_college_id: filters.collegeId,
    p_program_id: filters.programId || null,
    p_level_id: filters.levelId || null,
    p_term_id: filters.termId || null,
    p_study_system: filters.studySystem || null,
    p_cohort_id: filters.cohortId || null,
    p_component_type: filters.componentType || null,
    p_assignment_status: filters.assignmentStatus || null,
  });
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
