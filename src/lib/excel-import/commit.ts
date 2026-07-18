import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { ImportEntity, ImportMode, ParsedRow, RowError } from "./types";
import { ImportSafetyError, requireImportManager } from "./safety";

export interface CommitResult {
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: RowError[];
  replay?: boolean;
  jobId?: string;
  entity?: string;
  mode?: string;
  collegeId?: string;
  payloadManifest?: string | null;
}

/**
 * Atomic import commit: single server RPC. No client operational DML.
 * Sends job_id (+ optional concurrency token) only; stored payload is authoritative.
 */
export async function commitImport(input: {
  jobId: string;
  expectedUpdatedAt?: string | null;
}): Promise<CommitResult> {
  if (!input.jobId) {
    throw new ImportSafetyError("invalid_import_job", "Import job id is required");
  }

  const { data, error } = await supabase.rpc("commit_import_job_atomic", {
    p_job_id: input.jobId,
    p_expected_updated_at: input.expectedUpdatedAt ?? null,
  });

  if (error) {
    const message = error.message || "Import commit failed";
    if (/unauthenticated|authentication required/i.test(message)) {
      throw new ImportSafetyError("unauthenticated", message);
    }
    if (/denied|forbidden|access/i.test(message)) {
      throw new ImportSafetyError("import_forbidden", message);
    }
    if (/stale|serialization/i.test(message)) {
      throw new ImportSafetyError("import_job_stale", message);
    }
    if (/replay|not claimable|not committable|prerequisite/i.test(message)) {
      throw new ImportSafetyError("import_job_replayed", message);
    }
    if (/manifest|payload/i.test(message)) {
      throw new ImportSafetyError("import_payload_mismatch", message);
    }
    if (/validation|check_violation|22023/i.test(message)) {
      throw new ImportSafetyError("import_validation_failed", message);
    }
    throw new ImportSafetyError("import_commit_failed", message);
  }

  const payload = (data ?? {}) as Record<string, unknown>;
  if (payload.status !== "ok") {
    throw new ImportSafetyError(
      "import_commit_failed",
      typeof payload.message === "string" ? payload.message : "Import commit did not return ok",
    );
  }

  return {
    inserted: Number(payload.inserted ?? 0),
    updated: Number(payload.updated ?? 0),
    skipped: Number(payload.skipped ?? 0),
    failed: Number(payload.failed ?? 0),
    errors: [],
    replay: Boolean(payload.replay),
    jobId: typeof payload.job_id === "string" ? payload.job_id : input.jobId,
    entity: typeof payload.entity === "string" ? payload.entity : undefined,
    mode: typeof payload.mode === "string" ? payload.mode : undefined,
    collegeId: typeof payload.college_id === "string" ? payload.college_id : undefined,
    payloadManifest: typeof payload.payload_manifest === "string" ? payload.payload_manifest : null,
  };
}

export async function createJobAndPersistErrors(
  entity: ImportEntity,
  mode: ImportMode,
  collegeId: string,
  fileName: string,
  totalRows: number,
  validRows: ParsedRow[],
  errors: RowError[],
  actorId: string,
): Promise<string> {
  const authenticatedActorId = await requireImportManager(collegeId);
  if (actorId !== authenticatedActorId) {
    throw new Error("Import actor does not match the authenticated user");
  }
  const { data, error } = await supabase.rpc("create_import_preview_manifest", {
    p_college_id: collegeId,
    p_target_entity: entity,
    p_mode: mode,
    p_file_name: fileName,
    p_total_rows: totalRows,
    p_validated_payload: validRows as unknown as Json,
    p_errors: errors as unknown as Json,
  });
  if (error) throw error;
  return data as string;
}
