import { supabase } from "@/integrations/supabase/client";
import type { ImportEntity, ImportMode, ParsedRow } from "./types";

export class ImportSafetyError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ImportSafetyError";
  }
}

export async function requireImportManager(collegeId: string): Promise<string> {
  if (!collegeId) throw new ImportSafetyError("invalid_college", "Import college is required");

  const { data: authData, error: authError } = await supabase.auth.getUser();
  const user = authData.user;
  if (authError || !user) {
    throw new ImportSafetyError("unauthenticated", "An authenticated user is required for import");
  }

  const { data: roles, error: rolesError } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id);
  if (rolesError) {
    throw new ImportSafetyError("authorization_check_failed", "Could not verify import role");
  }
  const roleSet = new Set((roles ?? []).map((row) => row.role));
  if (roleSet.has("super_admin")) return user.id;
  if (!roleSet.has("college_admin")) {
    throw new ImportSafetyError("import_forbidden", "College administrator access is required");
  }

  const { data: membership, error: membershipError } = await supabase
    .from("user_colleges")
    .select("id")
    .eq("user_id", user.id)
    .eq("college_id", collegeId)
    .maybeSingle();
  if (membershipError) {
    throw new ImportSafetyError("authorization_check_failed", "Could not verify college access");
  }
  if (!membership) {
    throw new ImportSafetyError("college_forbidden", "User cannot import into this college");
  }
  return user.id;
}

interface ClaimImportJobInput {
  jobId: string;
  collegeId: string;
  actorId: string;
  entity: ImportEntity;
  mode: ImportMode;
  rows: ParsedRow[];
}

export async function claimImportJob(input: ClaimImportJobInput): Promise<ParsedRow[]> {
  const { data, error } = await supabase.rpc("claim_import_job_manifest", {
    p_job_id: input.jobId,
    p_college_id: input.collegeId,
    p_target_entity: input.entity,
    p_mode: input.mode,
    p_validated_payload: input.rows as never,
  });
  if (error || !data) {
    throw new ImportSafetyError("import_job_replayed", "Import preview could not be claimed");
  }
  const payload = (data as { validated_payload?: unknown }).validated_payload;
  if (!Array.isArray(payload)) {
    throw new ImportSafetyError("invalid_import_job", "Claimed import payload is missing");
  }
  return payload as ParsedRow[];
}

export async function finalizeImportJob(params: {
  jobId: string;
  collegeId: string;
  entity: ImportEntity;
  mode: ImportMode;
  result: { inserted: number; updated: number; skipped: number; failed: number; errors: unknown[] };
}): Promise<void> {
  const { error } = await supabase.rpc("finalize_import_job", {
    p_job_id: params.jobId,
    p_college_id: params.collegeId,
    p_inserted_rows: params.result.inserted,
    p_updated_rows: params.result.updated,
    p_skipped_rows: params.result.skipped,
    p_failed_rows: params.result.failed,
    p_errors: params.result.errors as never,
  });
  if (error) throw error;
}

export async function failImportJob(params: {
  jobId: string;
  collegeId: string;
  entity: ImportEntity;
  mode: ImportMode;
  message: string;
}): Promise<void> {
  const { error } = await supabase.rpc("fail_import_job", {
    p_job_id: params.jobId,
    p_college_id: params.collegeId,
    p_message: params.message,
  });
  if (error) throw error;
}
