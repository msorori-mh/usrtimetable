/**
 * Phase 9.5 — Schedule Builder V2 RPC service.
 * No direct schedule_sessions / teaching_assignments DML.
 */

import { supabase } from "@/integrations/supabase/client";
import { normalizeTimeHHMM } from "@/lib/schedule-builder/pending-change";
import {
  mapCreateSessionError,
  parseCreateSessionResult,
  parseWorkItemsPayload,
  type CreateSessionFromAssignmentInput,
  type CreateSessionFromAssignmentResult,
  type WorkItemsFilters,
  type WorkItemsPayload,
} from "@/lib/schedule-builder/v2-assignment-integration";

type RpcClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

function client(): RpcClient {
  return supabase as unknown as RpcClient;
}

function toTimeParam(value: string): string {
  const t = normalizeTimeHHMM(value);
  return t.length === 5 ? `${t}:00` : t;
}

export async function listScheduleBuilderV2WorkItems(
  filters: WorkItemsFilters,
): Promise<WorkItemsPayload> {
  if (!filters.scheduleVersionId) {
    throw new Error("SCHEDULE_VERSION_ID_REQUIRED");
  }
  const { data, error } = await client().rpc("list_schedule_builder_v2_work_items", {
    p_schedule_version_id: filters.scheduleVersionId,
    p_program_id: filters.programId || null,
    p_level_id: filters.levelId || null,
    p_cohort_id: filters.cohortId || null,
    p_study_system: filters.studySystem === "all" ? null : filters.studySystem || null,
    p_component_type: filters.componentType || null,
    p_instructor_id: filters.instructorId || null,
    p_scheduling_status: filters.schedulingStatus || null,
  });
  if (error) {
    throw new Error(`RPC_ERROR: ${error.message}`);
  }
  return parseWorkItemsPayload(data);
}

export async function createScheduleSessionFromAssignmentV2(
  input: CreateSessionFromAssignmentInput,
): Promise<CreateSessionFromAssignmentResult> {
  const { data, error } = await client().rpc("create_schedule_session_from_assignment_v2", {
    p_schedule_version_id: input.scheduleVersionId,
    p_teaching_assignment_id: input.teachingAssignmentId,
    p_day_of_week: input.dayOfWeek,
    p_start_time: toTimeParam(input.startTime),
    p_end_time: toTimeParam(input.endTime),
    p_room_id: input.roomId,
    p_expected_version_updated_at: input.expectedVersionUpdatedAt,
    p_note: input.note ?? null,
  });

  if (error) {
    return {
      ok: false,
      code: "RPC_ERROR",
      stale: false,
      message_ar: mapCreateSessionError("RPC_ERROR", error.message),
      blocking_conflicts: [],
      warnings: [],
      session: null,
      schedule_version_updated_at: null,
      scheduling_summary: null,
    };
  }

  return parseCreateSessionResult(data);
}
