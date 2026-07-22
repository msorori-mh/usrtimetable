/**
 * A2.3: Shared lecture groups (المجموعات المشتركة للمحاضرات) — RPC wrappers only.
 *
 * Every write goes through the gated A2.1/A2.2 SECURITY DEFINER RPCs. Direct
 * INSERT/UPDATE/DELETE on public.shared_lecture_group* is revoked by the
 * source-only migrations, so this layer intentionally contains no table DML.
 * The RPCs are SOURCE ONLY — NOT APPLIED: calls fail until the migrations are
 * approved and applied (documented readiness blocker, gate
 * APPROVE_DB_MIGRATION_APPLY).
 */
import { supabase } from "@/integrations/supabase/client";
import type {
  SharedGroupCapacityBreakdownRow,
  SharedGroupRevision,
  SharedGroupRpcResult,
  SharedGroupStatus,
  SharedLectureGroup,
} from "./types";

async function call<T>(
  name: string,
  args: Record<string, unknown>,
): Promise<SharedGroupRpcResult<T>> {
  const { data, error } = await supabase.rpc(name as never, args as never);
  if (error) throw error;
  return data as SharedGroupRpcResult<T>;
}

export function createSharedLectureGroup(input: {
  collegeId: string;
  termId: string;
  name: string;
  notes?: string | null;
}) {
  return call<{ group: SharedLectureGroup }>("create_shared_lecture_group", {
    p_college_id: input.collegeId,
    p_term_id: input.termId,
    p_name: input.name,
    p_notes: input.notes ?? null,
  });
}

export function addComponentToSharedLectureGroup(input: {
  groupId: string;
  planCourseComponentId: string;
  notes?: string | null;
}) {
  return call("add_component_to_shared_lecture_group", {
    p_group_id: input.groupId,
    p_plan_course_component_id: input.planCourseComponentId,
    p_notes: input.notes ?? null,
  });
}

export function removeComponentFromSharedLectureGroup(input: {
  groupId: string;
  planCourseComponentId: string;
  notes?: string | null;
}) {
  return call("remove_component_from_shared_lecture_group", {
    p_group_id: input.groupId,
    p_plan_course_component_id: input.planCourseComponentId,
    p_notes: input.notes ?? null,
  });
}

export function addCohortToSharedLectureGroup(input: {
  groupId: string;
  cohortId: string;
  notes?: string | null;
}) {
  return call("add_cohort_to_shared_lecture_group", {
    p_group_id: input.groupId,
    p_cohort_id: input.cohortId,
    p_notes: input.notes ?? null,
  });
}

export function removeCohortFromSharedLectureGroup(input: {
  groupId: string;
  cohortId: string;
  notes?: string | null;
}) {
  return call("remove_cohort_from_shared_lecture_group", {
    p_group_id: input.groupId,
    p_cohort_id: input.cohortId,
    p_notes: input.notes ?? null,
  });
}

/** super_admin-only cross-college path (A2.2). Never call for non-super_admin. */
export function addCrossCollegeCohortToSharedLectureGroup(input: {
  groupId: string;
  cohortId: string;
  notes?: string | null;
}) {
  return call("add_cross_college_cohort_to_shared_lecture_group", {
    p_group_id: input.groupId,
    p_cohort_id: input.cohortId,
    p_notes: input.notes ?? null,
  });
}

/** super_admin-only cross-college path (A2.2). Never call for non-super_admin. */
export function removeCrossCollegeCohortFromSharedLectureGroup(input: {
  groupId: string;
  cohortId: string;
  notes?: string | null;
}) {
  return call("remove_cross_college_cohort_from_shared_lecture_group", {
    p_group_id: input.groupId,
    p_cohort_id: input.cohortId,
    p_notes: input.notes ?? null,
  });
}

export function transitionSharedLectureGroupStatus(input: {
  groupId: string;
  targetStatus: SharedGroupStatus;
  notes?: string | null;
}) {
  return call<{ group: SharedLectureGroup }>("transition_shared_lecture_group_status", {
    p_group_id: input.groupId,
    p_target_status: input.targetStatus,
    p_notes: input.notes ?? null,
  });
}

/**
 * Fail-closed capacity: the RPC returns the SUM of approved
 * scheduling_headcount over both membership paths, or a blocker
 * (SHARED_GROUP_NO_COHORTS / SHARED_GROUP_HEADCOUNT_MISSING). The UI never
 * computes or guesses a number itself.
 */
export function resolveSharedLectureGroupCapacity(groupId: string) {
  return call<{
    group_id: string;
    capacity: number;
    breakdown: SharedGroupCapacityBreakdownRow[];
  }>("resolve_shared_lecture_group_capacity", { p_group_id: groupId });
}

export function listSharedLectureGroupRevisions(groupId: string) {
  return call<{ revisions: SharedGroupRevision[] }>("list_shared_lecture_group_revisions", {
    p_group_id: groupId,
  });
}
