/**
 * Legacy timetable editor writes (H-6). Clients have no DML on schedule_sessions; every
 * write goes through a server RPC that runs the authoritative conflict collector:
 *   - moves                 → move_or_reschedule_schedule_session (session-move-rpc.ts)
 *   - new from a V2 assignment → create_schedule_session_from_assignment_v2
 *   - other creates / edits  → save_manual_schedule_session (whitelisted payload)
 *   - delete                 → delete_schedule_session
 */
import { supabase } from "@/integrations/supabase/client";
import { invalidateTeachingAssignmentReadModels } from "@/lib/teaching-assignments/query-invalidation";
import {
  mapServerConflict,
  parseHardConflictDetails,
  sessionWriteErrorMessageAr,
} from "@/lib/conflict-engine/server-validation";
import type { Conflict } from "@/lib/conflict-engine/validator";

import { buildManualSessionPayload, type ManualSessionForm } from "./session-payload";

export {
  buildManualSessionPayload,
  MANUAL_SESSION_FIELDS,
  type ManualSessionForm,
  type StudySystem,
} from "./session-payload";

export class SessionWriteError extends Error {
  conflicts: Conflict[];
  constructor(message: string, conflicts: Conflict[] = []) {
    super(message);
    this.name = "SessionWriteError";
    this.conflicts = conflicts;
  }
}

type RpcError = { message: string; details?: string | null; code?: string | null };
type Rpc = (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: RpcError | null }>;
const rpc = (): Rpc => supabase.rpc.bind(supabase) as unknown as Rpc;

function toWriteError(error: RpcError): SessionWriteError {
  const conflicts = error.message.includes("SCHEDULE_HARD_CONFLICTS")
    ? parseHardConflictDetails(error.details)
    : [];
  return new SessionWriteError(sessionWriteErrorMessageAr(error.message), conflicts);
}

export interface ManualSessionPreview {
  valid: boolean;
  blocking: Conflict[];
  warnings: Conflict[];
  approved: Conflict[];
}

export async function previewManualScheduleSession(params: {
  sessionId: string | null;
  scheduleVersionId: string;
  form: ManualSessionForm;
}): Promise<ManualSessionPreview> {
  const { data, error } = await rpc()("preview_manual_schedule_session", {
    p_session_id: params.sessionId,
    p_payload: buildManualSessionPayload(
      params.form,
      params.sessionId ? undefined : params.scheduleVersionId,
    ),
  });
  if (error) throw toWriteError(error);
  const row = (data ?? {}) as Record<string, unknown>;
  const list = (v: unknown) =>
    Array.isArray(v) ? (v as Record<string, unknown>[]).map((c) => mapServerConflict(c)) : [];
  return {
    valid: row.valid === true,
    blocking: list(row.blocking_conflicts),
    warnings: list(row.warnings),
    approved: list(row.approved_exceptions),
  };
}

export async function saveManualScheduleSession(params: {
  sessionId: string | null;
  expectedUpdatedAt: string | null;
  scheduleVersionId: string;
  form: ManualSessionForm;
}): Promise<{ id: string; updated_at: string }> {
  const { data, error } = await rpc()("save_manual_schedule_session", {
    p_session_id: params.sessionId,
    p_expected_updated_at: params.expectedUpdatedAt,
    p_payload: buildManualSessionPayload(
      params.form,
      params.sessionId ? undefined : params.scheduleVersionId,
    ),
  });
  if (error) throw toWriteError(error);
  const row = (data ?? {}) as { id?: string; updated_at?: string };
  if (!row.id) throw new SessionWriteError("تعذر حفظ المحاضرة.");
  return { id: row.id, updated_at: row.updated_at ?? "" };
}

export async function deleteScheduleSession(params: {
  sessionId: string;
  expectedUpdatedAt: string;
}): Promise<void> {
  const { error } = await rpc()("delete_schedule_session", {
    p_session_id: params.sessionId,
    p_expected_updated_at: params.expectedUpdatedAt,
  });
  if (error) throw toWriteError(error);
}

/** Every read model that shows a version's sessions (legacy editor, builder, reports). */
export async function invalidateSessionReadModels(
  queryClient: Parameters<typeof invalidateTeachingAssignmentReadModels>[0],
): Promise<void> {
  await Promise.all([
    invalidateTeachingAssignmentReadModels(queryClient),
    queryClient.invalidateQueries({ queryKey: ["session-dialog-session"] }),
  ]);
}
