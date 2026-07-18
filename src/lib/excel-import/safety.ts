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

export async function claimImportJob(input: ClaimImportJobInput): Promise<void> {
  const { data: job, error: readError } = await supabase
    .from("import_jobs")
    .select("id, college_id, created_by, target_entity, mode, status, valid_rows")
    .eq("id", input.jobId)
    .eq("college_id", input.collegeId)
    .maybeSingle();
  if (readError || !job) throw new ImportSafetyError("invalid_import_job", "Import preview not found");
  if (
    job.created_by !== input.actorId ||
    job.target_entity !== input.entity ||
    job.mode !== input.mode ||
    job.valid_rows !== input.rows.length
  ) {
    throw new ImportSafetyError("import_job_mismatch", "Import preview does not match this commit");
  }
  if (job.status !== "preview") {
    throw new ImportSafetyError("import_job_replayed", "Import preview was already committed or claimed");
  }

  const { data: claimed, error: claimError } = await supabase
    .from("import_jobs")
    .update({ status: "committing" })
    .eq("id", input.jobId)
    .eq("college_id", input.collegeId)
    .eq("created_by", input.actorId)
    .eq("status", "preview")
    .select("id")
    .maybeSingle();
  if (claimError || !claimed) {
    throw new ImportSafetyError("import_job_replayed", "Import preview could not be claimed");
  }
}
