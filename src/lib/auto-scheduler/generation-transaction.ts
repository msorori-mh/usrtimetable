import type { Session, Snapshot } from "./compact.ts";
import { validateJointPlan } from "./joint-model.ts";
import type { RepairPlan } from "./repair.ts";

export const GENERATION_MAX_RELOCATIONS = 32;
export type GenerationRpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{
  data: unknown;
  error: { code?: string; message?: string } | null;
}>;
export type GenerationSave = {
  status: "saved" | "rejected" | "unknown";
  code: string;
  operationId: string;
  request: Record<string, unknown>;
  created: Partial<Session>[];
  relocated: number;
  versionUpdatedAt?: string;
  revision?: string;
};

export async function applyRepairPlan(input: {
  collegeId: string;
  versionId: string;
  snapshot: Snapshot;
  missing: Session;
  plan: RepairPlan;
  dayCap: number;
  rpc: GenerationRpc;
  note?: string;
}): Promise<GenerationSave> {
  const moves = new Map(input.plan.moves.map((m) => [m.sessionId, m]));
  if (!moves.size || moves.size !== input.plan.moves.length || moves.size > 2)
    throw new Error("INVALID_REPAIR_BUDGET");
  for (const move of moves.values()) {
    const old = input.snapshot.sessions.find((s) => s.id === move.sessionId);
    if (!old || old.is_locked || old.updated_at !== move.updatedAt)
      throw new Error("STALE_OR_LOCKED_REPAIR");
  }
  const snapshot = {
    ...input.snapshot,
    sessions: [...input.snapshot.sessions, input.missing],
  };
  const sessions = input.snapshot.sessions.map((s) => ({
    ...s,
    ...(moves.get(s.id)?.to ?? {}),
  }));
  sessions.push({ ...input.missing, ...input.plan.placement });
  return applyGenerationPlan({
    ...input,
    snapshot,
    sessions,
    existingIds: input.snapshot.sessions.map((s) => s.id),
  });
}

/** One transaction for the final arrangement and inserts. Never compensate with individual moves. */
export async function applyGenerationPlan(input: {
  collegeId: string;
  versionId: string;
  snapshot: Snapshot;
  sessions: Session[];
  existingIds: string[];
  dayCap: number;
  rpc: GenerationRpc;
  note?: string;
  operationId?: string;
}): Promise<GenerationSave> {
  const operationId = input.operationId ?? crypto.randomUUID();
  const existing = new Set(input.existingIds);
  const scope = {
    ...input.snapshot,
    generationScope: {
      existingIds: input.existingIds,
      maxRelocations: GENERATION_MAX_RELOCATIONS,
    },
  };
  if (!validateJointPlan(scope, input.sessions, input.dayCap))
    throw new Error("GENERATION_FINAL_STATE_INVALID");
  if (!scope.versionUpdatedAt || scope.revision == null)
    throw new Error("GENERATION_SNAPSHOT_REVISION_REQUIRED");
  const old = new Map(scope.sessions.map((s) => [s.id, s]));
  const moves = input.sessions
    .filter((s) => {
      const before = old.get(s.id)!;
      return (
        existing.has(s.id) &&
        (s.day_of_week !== before.day_of_week ||
          s.start_time !== before.start_time ||
          s.end_time !== before.end_time ||
          s.room_id !== before.room_id)
      );
    })
    .map((s) => ({
      id: s.id,
      expected_updated_at: old.get(s.id)!.updated_at,
      day_of_week: s.day_of_week,
      start_time: s.start_time,
      end_time: s.end_time,
      room_id: s.room_id,
    }));
  const additions = input.sessions
    .filter((s) => !existing.has(s.id))
    .map((s) => ({
      teaching_assignment_id: s.teaching_assignment_id,
      day_of_week: s.day_of_week,
      start_time: s.start_time,
      end_time: s.end_time,
      room_id: s.room_id,
    }));
  if (!additions.length || additions.length > 512) throw new Error("GENERATION_BATCH_SIZE_INVALID");
  const request = {
    p_college_id: input.collegeId,
    p_version_id: input.versionId,
    p_operation_id: operationId,
    p_expected_revision: scope.revision,
    p_expected_version_updated_at: scope.versionUpdatedAt,
    p_day_cap: input.dayCap,
    p_moves: moves,
    p_additions: additions,
    p_note: input.note ?? "auto:joint-generation",
  };
  const base = { operationId, request, created: [], relocated: 0 };
  try {
    const { data, error } = await input.rpc("apply_schedule_generation", request);
    if (error)
      return {
        ...base,
        status: ["PGRST202", "42883"].includes(error.code ?? "") ? "rejected" : "unknown",
        code: error.code ?? "TRANSPORT_ERROR",
      };
    const result = data as {
      ok?: boolean;
      code?: string;
      operation_id?: string;
      sessions?: Partial<Session>[];
      relocated?: number;
      schedule_version_updated_at?: string;
      revision?: string | number;
    } | null;
    if (result?.ok === false)
      return { ...base, status: "rejected", code: result.code ?? "REJECTED" };
    if (
      result?.ok !== true ||
      result.operation_id !== operationId ||
      result.sessions?.length !== additions.length ||
      result.relocated !== moves.length ||
      !result.schedule_version_updated_at ||
      result.revision == null
    )
      return { ...base, status: "unknown", code: "UNCONFIRMED_RECEIPT" };
    return {
      ...base,
      status: "saved",
      code: "SAVED",
      created: result.sessions,
      relocated: moves.length,
      versionUpdatedAt: result.schedule_version_updated_at,
      revision: String(result.revision),
    };
  } catch {
    return { ...base, status: "unknown", code: "TRANSPORT_ERROR" };
  }
}
