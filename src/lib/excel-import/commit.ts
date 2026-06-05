import { supabase } from "@/integrations/supabase/client";
import { TEMPLATES } from "./templates";
import { buildDbPayload } from "./validators";
import type { ImportEntity, ImportMode, ParsedRow, RowError } from "./types";
import { logAudit } from "@/lib/audit";

export interface CommitResult {
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: RowError[];
}

export async function commitImport(
  entity: ImportEntity,
  mode: ImportMode,
  collegeId: string,
  jobId: string,
  validRows: ParsedRow[],
): Promise<CommitResult> {
  const tpl = TEMPLATES[entity];
  let inserted = 0, updated = 0, skipped = 0, failed = 0;
  const errors: RowError[] = [];
  const table = entity;

  for (const row of validRows) {
    const exists = !!row.values._exists;
    const payload = buildDbPayload(entity, row, collegeId);

    try {
      if (exists) {
        if (mode === "insert_only") {
          skipped++;
          continue;
        }
        // update_existing or upsert
        const uniqVal = row.values[tpl.uniqueKey];
        const { error } = await supabase.from(table as never).update(payload).eq("college_id", collegeId).eq(tpl.uniqueKey, uniqVal as string);
        if (error) throw error;
        updated++;
      } else {
        if (mode === "update_existing") {
          skipped++;
          continue;
        }
        const { error } = await supabase.from(table as never).insert(payload);
        if (error) throw error;
        inserted++;
      }
    } catch (e) {
      failed++;
      const msg = e instanceof Error ? e.message : String(e);
      errors.push({ rowNumber: row.rowNumber, errorCode: "db_error", message: `فشل الحفظ: ${msg}` });
    }
  }

  // Persist errors
  if (errors.length > 0) {
    await supabase.from("import_errors").insert(
      errors.map((er) => ({
        college_id: collegeId, job_id: jobId, row_number: er.rowNumber,
        column_name: er.columnName ?? null, error_code: er.errorCode, message: er.message, raw_value: er.rawValue ?? null,
      })),
    );
  }

  // Update job
  await supabase.from("import_jobs").update({
    status: failed > 0 && inserted + updated === 0 ? "failed" : "committed",
    inserted_rows: inserted, updated_rows: updated, skipped_rows: skipped,
  }).eq("id", jobId);

  await logAudit({ action: "import_commit", entity: `import_${entity}`, entityId: jobId, collegeId, details: { inserted, updated, skipped, failed, mode } });

  return { inserted, updated, skipped, failed, errors };
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
  const { data, error } = await supabase.from("import_jobs").insert({
    college_id: collegeId, target_entity: entity, mode, status: "preview",
    file_name: fileName, total_rows: totalRows, valid_rows: validRows.length, invalid_rows: totalRows - validRows.length,
    created_by: actorId,
  }).select("id").single();
  if (error) throw error;
  const jobId = data!.id as string;

  if (errors.length > 0) {
    await supabase.from("import_errors").insert(
      errors.map((er) => ({
        college_id: collegeId, job_id: jobId, row_number: er.rowNumber,
        column_name: er.columnName ?? null, error_code: er.errorCode, message: er.message, raw_value: er.rawValue ?? null,
      })),
    );
  }
  await logAudit({ action: "import_preview", entity: `import_${entity}`, entityId: jobId, collegeId, details: { totalRows, valid: validRows.length, invalid: totalRows - validRows.length, mode } });
  return jobId;
}
