/**
 * Generate sample Pilot import workbooks outside the repository.
 * Synthetic data only. No DB access / no commit.
 */
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { buildTemplateWorkbook } from "../src/lib/excel-import/templates.ts";
import {
  ACTIVE_NEW_FLOW_ENTITIES,
  suggestedTemplateFilename,
  IMPORT_CONTRACT_VERSION,
  OFFICIAL_IMPORT_ORDER,
  getEntityMeta,
} from "../src/lib/excel-import/registry.ts";

const outDir =
  process.env.FINAL_IMPORT_TEMPLATES_DIR || "C:\\projects\\usrtimetable-final-import-templates";

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const catalog: Array<Record<string, unknown>> = [];

for (const entity of ACTIVE_NEW_FLOW_ENTITIES) {
  const meta = getEntityMeta(entity);
  const blob = await buildTemplateWorkbook(entity);
  const buf = Buffer.from(await blob.arrayBuffer());
  const studySystem = meta.studySystemScoped ? "regular" : undefined;
  const context = meta.studySystemScoped ? "2026-2027-s1-SAMPLE" : undefined;
  const collegeCode = meta.studySystemScoped ? undefined : "it";
  const filename = suggestedTemplateFilename(entity, { studySystem, context, collegeCode });
  writeFileSync(join(outDir, filename), buf);
  catalog.push({
    entity,
    filename,
    label: meta.label,
    classification: meta.classification,
    dependsOn: meta.dependsOn,
    naturalKey: meta.naturalKey,
    targetTables: meta.targetTables,
    contract_version: IMPORT_CONTRACT_VERSION,
    sample: true,
    operational_data: false,
  });
  console.log("wrote", filename);
}

writeFileSync(
  join(outDir, "MANIFEST.json"),
  JSON.stringify(
    {
      contract_version: IMPORT_CONTRACT_VERSION,
      generated_at: new Date().toISOString(),
      note: "Synthetic sample templates only — not for production commit.",
      official_import_order: OFFICIAL_IMPORT_ORDER,
      files: catalog,
    },
    null,
    2,
  ),
);

console.log("OUT_DIR", outDir);
