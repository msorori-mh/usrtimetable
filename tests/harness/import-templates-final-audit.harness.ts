/**
 * IMPORT-TEMPLATES-FINAL-COMPATIBILITY-AUDIT harness.
 * Pure local checks — no DB writes, no import commit, no migration apply.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import * as XLSX from "xlsx";
import {
  TEMPLATES,
  buildTemplateWorkbook,
  parseExcel,
} from "../../src/lib/excel-import/templates.ts";
import {
  ACTIVE_NEW_FLOW_ENTITIES,
  LEGACY_ONLY_ENTITIES,
  GENERATED_NOT_IMPORTED,
  PILOT_STUDY_SYSTEMS,
  TA_V2_COMPONENT_TYPES,
  IMPORT_CONTRACT_VERSION,
  listImportUiEntities,
  listRegisteredEntities,
  suggestedTemplateFilename,
  getEntityMeta,
  OFFICIAL_IMPORT_ORDER,
} from "../../src/lib/excel-import/registry.ts";
import {
  escapeSpreadsheetCell,
  looksLikeFormulaInjection,
} from "../../src/lib/excel-import/formula-escape.ts";
import { CATALOG } from "../../src/lib/data-templates/catalog.ts";
import type { ImportEntity } from "../../src/lib/excel-import/types.ts";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(`FAIL: ${message}`);
};

async function blobToFile(blob: Blob, name: string): Promise<File> {
  const buf = await blob.arrayBuffer();
  return new File([buf], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

async function readWorkbookSheets(blob: Blob): Promise<string[]> {
  const buf = await blob.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  return wb.SheetNames;
}

async function readFirstSheetHeaders(blob: Blob): Promise<string[]> {
  const file = await blobToFile(blob, "t.xlsx");
  const { headers } = await parseExcel(file);
  return headers;
}

async function run() {
  // 1–4 inventory / template / validator / commit mapping
  const templateKeys = Object.keys(TEMPLATES) as ImportEntity[];
  assert(templateKeys.length >= 15, "inventory includes all TEMPLATES entities");
  for (const e of ACTIVE_NEW_FLOW_ENTITIES) {
    assert(TEMPLATES[e], `every active entity has template: ${e}`);
    assert(TEMPLATES[e].columns.length > 0, `template columns present: ${e}`);
    assert(getEntityMeta(e).commitRpc === "commit_import_job_atomic", `commit RPC mapped: ${e}`);
  }

  const validatorsSrc = read("src/lib/excel-import/validators.ts");
  assert(validatorsSrc.includes("export async function validate"), "validator export exists");
  assert(validatorsSrc.includes("unknown_column"), "unknown column rejection");
  assert(validatorsSrc.includes("duplicate_header"), "duplicate header rejection");
  assert(validatorsSrc.includes("summer_training_forbidden"), "summer_training rejection");

  const commitSrc = read("src/lib/excel-import/commit.ts");
  assert(commitSrc.includes('rpc("commit_import_job_atomic"'), "atomic commit only");
  assert(!commitSrc.includes(".insert("), "no direct client DML in commit");
  assert(!commitSrc.includes(".update("), "no direct client update DML in commit");
  assert(!commitSrc.includes(".upsert("), "no direct client upsert DML in commit");

  // 5–6 no section / student-registration in new-flow UI
  const uiEntities = listImportUiEntities().map((m) => m.entity);
  assert(!uiEntities.includes("sections"), "no new-flow section template in UI");
  assert(!uiEntities.includes("teaching_assignments"), "no V1 teaching_assignments in UI");
  assert(!uiEntities.includes("course_offerings"), "no course_offerings import in new-flow UI");
  assert(!uiEntities.includes("section_groups"), "no section_groups in UI");
  const importUi = read("src/routes/_authenticated/import.tsx");
  assert(importUi.includes("listImportUiEntities"), "import UI uses official registry");
  assert(!importUi.includes('value: "sections"'), "import UI source has no sections option");
  assert(!/student.*registration|تسجيل.*طالب/i.test(importUi), "no student-registration template");

  // 7–14 entity contracts
  const cohort = TEMPLATES.academic_cohorts;
  const cohortKeys = cohort.columns.map((c) => c.key);
  assert(cohortKeys.includes("program_code"), "cohort: program_code");
  assert(cohortKeys.includes("level_number"), "cohort: level_number");
  assert(cohortKeys.includes("study_system"), "cohort: study_system");
  assert(cohortKeys.includes("entry_year"), "cohort: entry_year");
  assert(cohortKeys.includes("term_code"), "cohort: term_code");
  assert(cohortKeys.includes("expected_students") || cohortKeys.includes("code"), "cohort fields");
  assert(!cohortKeys.includes("plan_code"), "cohort has no plan_code");
  assert(!cohortKeys.includes("section_number"), "cohort has no section_number");
  const ss = cohort.columns.find((c) => c.key === "study_system")!;
  assert(
    JSON.stringify(ss.enumValues) === JSON.stringify([...PILOT_STUDY_SYSTEMS]),
    "cohort study_system pilot enums",
  );

  const electives = TEMPLATES.cohort_elective_selections.columns.map((c) => c.key);
  assert(electives.includes("cohort_code"), "elective-selection: cohort");
  assert(electives.includes("elective_slot_code"), "elective-selection: slot");
  assert(electives.includes("selected_course_code"), "elective-selection: course");

  assert(
    TEMPLATES.instructors.columns.some((c) => c.key === "employee_number"),
    "instructor NK",
  );
  assert(
    TEMPLATES.rooms.columns.some((c) => c.required && c.key === "room_type"),
    "rooms room_type required",
  );
  assert(
    TEMPLATES.rooms.columns.some((c) => c.key === "capacity" && c.required),
    "rooms capacity required",
  );
  assert(
    TEMPLATES.daily_breaks.columns.some((c) => c.key === "days"),
    "time-slot/breaks days",
  );

  // availability / workload: UI-managed (no ImportEntity) — documented
  assert(
    !templateKeys.includes("instructor_availability" as ImportEntity),
    "availability not an ImportEntity",
  );
  assert(
    CATALOG.some(
      (t) => t.id === "instructor_availability" && t.classification === "UI_MANAGED_NOT_IMPORTED",
    ),
    "availability classified UI_MANAGED",
  );

  const tav2 = TEMPLATES.teaching_assignments_v2;
  const tav2Keys = tav2.columns.map((c) => c.key);
  assert(tav2Keys.includes("cohort_code"), "TA V2 cohort");
  assert(tav2Keys.includes("course_code"), "TA V2 course");
  assert(tav2Keys.includes("component_type"), "TA V2 component");
  assert(tav2Keys.includes("delivery_group_code"), "TA V2 delivery group");
  assert(tav2Keys.includes("employee_number"), "TA V2 instructor");
  assert(tav2Keys.includes("assigned_component_hours"), "TA V2 hours");
  assert(!tav2Keys.includes("section_id"), "TA V2 no section_id");
  assert(!tav2Keys.includes("section_number"), "TA V2 no section_number");
  const ct = tav2.columns.find((c) => c.key === "component_type")!;
  assert(
    JSON.stringify(ct.enumValues) === JSON.stringify([...TA_V2_COMPONENT_TYPES]),
    "TA V2 component enums exclude summer_training",
  );
  assert(!ct.enumValues?.includes("summer_training"), "summer_training not in template enums");

  // 15–17 header order / required / enums round-trip
  for (const e of ACTIVE_NEW_FLOW_ENTITIES) {
    const blob = await buildTemplateWorkbook(e);
    const sheets = await readWorkbookSheets(blob);
    assert(sheets[0] === TEMPLATES[e].sheetName, `sheet name for ${e}`);
    assert(sheets.includes("تعليمات"), `instructions sheet for ${e}`);
    assert(sheets.includes("Metadata"), `metadata sheet for ${e}`);
    const headers = await readFirstSheetHeaders(blob);
    const expected = TEMPLATES[e].columns.map((c) => c.header);
    assert(
      JSON.stringify(headers) === JSON.stringify(expected),
      `exact header order for ${e}: got ${headers.join("|")}`,
    );
    // metadata content
    const buf = await blob.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const meta = XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets.Metadata, {
      header: 1,
      defval: "",
    }) as unknown as string[][];
    const metaMap = new Map(meta.filter((r) => r[0]).map((r) => [r[0], r[1]]));
    assert(metaMap.get("entity_key") === e, `metadata entity_key ${e}`);
    assert(metaMap.get("contract_version") === IMPORT_CONTRACT_VERSION, `contract version ${e}`);
    assert(Boolean(metaMap.get("generated_at")), `generated_at ${e}`);
  }

  // 18–19 regular/parallel + college isolation (source)
  assert(
    PILOT_STUDY_SYSTEMS.includes("regular") && PILOT_STUDY_SYSTEMS.includes("parallel"),
    "r/p",
  );
  assert(validatorsSrc.includes('.eq("college_id", collegeId)'), "college isolation in lookups");
  const safety = read("src/lib/excel-import/safety.ts");
  assert(safety.includes("requireImportManager"), "auth gate");
  assert(safety.includes("college_admin") || safety.includes("super_admin"), "role checks");

  // 20 natural-key duplicate rejection
  assert(validatorsSrc.includes("seenInFile"), "in-file duplicate NK tracking");

  // 21–24 co-teaching / project / summer / delivery-group
  assert(validatorsSrc.includes("assigned_component_hours"), "co-teaching hours field validated");
  assert(TA_V2_COMPONENT_TYPES.includes("project"), "project allowed in TA V2");
  assert(validatorsSrc.includes("summer_training_forbidden"), "summer-training rejection");
  assert(validatorsSrc.includes("unknown_delivery_group"), "delivery-group dependency");

  // 25 import order
  assert(OFFICIAL_IMPORT_ORDER.length >= 10, "official import order defined");
  const orderEntities = OFFICIAL_IMPORT_ORDER.filter((s) => s.entity).map((s) => s.entity);
  assert(orderEntities.includes("academic_cohorts"), "order includes cohorts");
  assert(orderEntities.includes("teaching_assignments_v2"), "order includes TA V2");
  const cohortStep = OFFICIAL_IMPORT_ORDER.find((s) => s.entity === "academic_cohorts")!.step;
  const taStep = OFFICIAL_IMPORT_ORDER.find((s) => s.entity === "teaching_assignments_v2")!.step;
  assert(cohortStep < taStep, "cohorts before TA V2");

  // 26–27 atomic / no DML
  assert(commitSrc.includes("commit_import_job_atomic"), "atomic commit");
  assert(GENERATED_NOT_IMPORTED.includes("delivery_groups"), "delivery_groups generated");
  assert(GENERATED_NOT_IMPORTED.includes("schedule_sessions"), "schedule_sessions generated");

  // 28–29 error row numbers / blocking
  assert(validatorsSrc.includes("rowNumber: i + 2"), "Excel row numbers (header=1)");
  assert(validatorsSrc.includes('errorCode: "missing_column"'), "blocking missing column");

  // 30 formula injection
  assert(escapeSpreadsheetCell("=CMD()") === "'=CMD()", "escape =");
  assert(escapeSpreadsheetCell("+1") === "'+1", "escape +");
  assert(escapeSpreadsheetCell("-1") === "'-1", "escape -");
  assert(escapeSpreadsheetCell("@x") === "'@x", "escape @");
  assert(escapeSpreadsheetCell("normal") === "normal", "plain passthrough");
  assert(looksLikeFormulaInjection("=1+1"), "detect formula");
  const tplSrc = read("src/lib/excel-import/templates.ts");
  assert(tplSrc.includes("escapeSpreadsheetCell"), "template generator escapes examples");

  // 31 round-trip generation/parser (fill sample)
  {
    const blob = await buildTemplateWorkbook("rooms");
    const file = await blobToFile(blob, "rooms.xlsx");
    const parsed = await parseExcel(file);
    assert(parsed.headers.includes("رمز_القاعة"), "round-trip rooms header");
    assert(parsed.rows.length >= 1, "example row present");
  }

  // 32 preview no DML — validate requires auth; structural check that validate does not call .insert
  assert(!validatorsSrc.includes(".insert("), "preview validate has no insert DML");
  assert(!validatorsSrc.includes(".upsert("), "preview validate has no upsert DML");

  // 33 UI hides Legacy
  for (const e of LEGACY_ONLY_ENTITIES) {
    assert(!uiEntities.includes(e), `UI hides legacy ${e}`);
    assert(getEntityMeta(e).showInImportUi === false, `legacy not shown ${e}`);
  }

  // 34 read_only cannot commit — import page gates on canManage
  assert(importUi.includes("useCanManageActiveCollege"), "canManage gate");
  assert(importUi.includes("لا تملك صلاحية الاستيراد"), "read_only blocked message");

  // 35–37 sample workbooks / version / filename
  const name = suggestedTemplateFilename("academic_cohorts", {
    studySystem: "regular",
    context: "2026-2027",
  });
  assert(name === "academic_cohorts_regular_2026-2027.xlsx", `filename convention got ${name}`);
  assert(
    suggestedTemplateFilename("rooms", { collegeCode: "IT" }) === "rooms_college-it.xlsx",
    "rooms college filename",
  );
  assert(IMPORT_CONTRACT_VERSION.length > 0, "contract version set");

  // 38 no UUID requirement where codes available
  for (const e of ACTIVE_NEW_FLOW_ENTITIES) {
    for (const c of TEMPLATES[e].columns) {
      assert(
        !/_id$/.test(c.key) || c.key === "is_active",
        `no UUID column forced in ${e}.${c.key}`,
      );
    }
  }

  // 39 generated-not-imported excluded from UI
  assert(!uiEntities.some((e) => String(e).includes("delivery")), "no delivery import entity");

  // 40 migration/apply not invoked by this harness / scripts
  const pkg = read("package.json");
  assert(!pkg.includes("supabase db push"), "no db push script");
  assert(!pkg.includes("supabase db reset"), "no db reset script");

  // Registry covers all TEMPLATES
  const registered = new Set(listRegisteredEntities());
  for (const e of templateKeys) {
    assert(registered.has(e), `registry covers ${e}`);
  }

  // Catalog full_study_plan aligned with TEMPLATES headers
  const catFull = CATALOG.find((t) => t.id === "full_study_plan")!;
  const catHeaders = catFull.columns.map((c) => c.header);
  const tplHeaders = TEMPLATES.full_study_plan.columns.map((c) => c.header);
  assert(
    JSON.stringify(catHeaders) === JSON.stringify(tplHeaders),
    "catalog full_study_plan headers match TEMPLATES",
  );

  // Legacy section fields must not appear in V2 templates
  for (const e of [
    "academic_cohorts",
    "teaching_assignments_v2",
    "cohort_elective_selections",
  ] as const) {
    const keys = TEMPLATES[e].columns.map((c) => c.key);
    assert(!keys.includes("section_number"), `${e} has no section_number`);
    assert(!keys.includes("section_id"), `${e} has no section_id`);
  }

  // Docs exist
  assert(
    existsSync(resolve(root, "docs/IMPORT-TEMPLATES-FINAL-CONTRACT-MATRIX.md")),
    "contract matrix doc",
  );
  assert(existsSync(resolve(root, "docs/IMPORT-ORDER-AND-DEPENDENCIES.md")), "import order doc");

  console.log(
    `import-templates-final-audit.harness.ts: PASS (active=${ACTIVE_NEW_FLOW_ENTITIES.length}, legacy=${LEGACY_ONLY_ENTITIES.length}, templates=${templateKeys.length})`,
  );
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
