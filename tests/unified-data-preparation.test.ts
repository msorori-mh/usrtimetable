import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PREPARATION_STEPS,
  parsePreparationSearch,
  preparationEntities,
  preparationStepForPath,
  resolvePreparationProgress,
  preparationLabel,
} from "../src/lib/data-onboarding/preparation";
import {
  buildWizardStepResults,
  wizardPercentComplete,
  type OnboardingCounts,
} from "../src/lib/data-onboarding/wizard-steps";
import { fixHrefForMetric } from "../src/lib/data-onboarding/classify";
import {
  CATALOG,
  buildCatalogTemplate,
  catalogImportEntity,
} from "../src/lib/data-templates/catalog";
import { TEMPLATES, buildTemplateWorkbook } from "../src/lib/excel-import/templates";
import { ACTIVE_NEW_FLOW_ENTITIES } from "../src/lib/excel-import/registry";
import type { ReadinessData } from "../src/lib/reports/readiness";
import type { WizardStepResult } from "../src/lib/data-onboarding/types";

const counts: OnboardingCounts = {
  departments: 1,
  programs: 1,
  terms: 1,
  planCourses: 1,
  cohorts: 1,
  deliveryGroups: 1,
  instructors: 1,
  rooms: 1,
  teachingAssignmentsV2: 1,
  instructorsWithAvailability: 1,
  scheduleVersions: 0,
};
const readiness: ReadinessData = {
  totals: {},
  studyPlan: [],
  resources: [],
  scheduling: [],
  scores: { studyPlanScore: 100, resourcesScore: 100, schedulingScore: 100, overall: 100 },
};

test("an empty college starts with academic structure and cannot proceed to scheduling", () => {
  const empty = Object.fromEntries(
    Object.keys(counts).map((key) => [key, 0]),
  ) as unknown as OnboardingCounts;
  const progress = resolvePreparationProgress(buildWizardStepResults(empty, readiness));
  assert.equal(progress.nextStepId, "academic_structure");
  assert.equal(progress.canContinue, false);
});

test("preparation can reach 100 percent before the first schedule exists", () => {
  const steps = buildWizardStepResults(counts, readiness);
  assert.equal(steps.find((s) => s.id === "create_schedule_version")?.status, "incomplete");
  assert.equal(wizardPercentComplete(steps), 100);
  assert.deepEqual(resolvePreparationProgress(steps), {
    steps: PREPARATION_STEPS.map((s) => steps.find((r) => r.id === s.id)),
    complete: 9,
    total: 9,
    percent: 100,
    nextStepId: "readiness_check",
    canContinue: true,
  });
});

test("a blocker or unknown step prevents continuation even with existing schedules", () => {
  const steps = buildWizardStepResults({ ...counts, scheduleVersions: 4 }, readiness);
  const blocked = steps.map((s) => (s.id === "rooms" ? { ...s, status: "blocker" as const } : s));
  assert.equal(resolvePreparationProgress(blocked).canContinue, false);
  assert.equal(resolvePreparationProgress(blocked).nextStepId, "rooms");
  assert.equal(
    resolvePreparationProgress(steps.filter((s) => s.id !== "rooms")).canContinue,
    false,
  );
});

test("required omissions take precedence over non-blocking review notes", () => {
  const steps = buildWizardStepResults(counts, readiness).map(
    (s): WizardStepResult =>
      s.id === "instructors"
        ? { ...s, status: "warning" }
        : s.id === "cohorts"
          ? { ...s, status: "incomplete" }
          : s,
  );
  assert.equal(resolvePreparationProgress(steps).nextStepId, "cohorts");
});

test("template and guide fields stay identical for every active import", () => {
  for (const entity of ACTIVE_NEW_FLOW_ENTITIES) {
    const guide = CATALOG.find((c) => catalogImportEntity(c.id) === entity);
    assert.ok(guide, entity);
    assert.deepEqual(
      guide.columns.map((c) => [c.header, c.required, c.allowed]),
      TEMPLATES[entity].columns.map((c) => [c.header, c.required, c.enumValues?.join(" | ")]),
      entity,
    );
  }
  assert.equal(CATALOG.find((c) => c.id === "instructors")?.columns.length, 19);
});

test("guide and importer produce the same workbook data and metadata contract", async () => {
  const XLSX = await import("xlsx");
  for (const entity of ["instructors", "rooms", "full_study_plan", "teaching_assignments_v2"]) {
    const catalog = XLSX.read(await (await buildCatalogTemplate(entity)).arrayBuffer());
    const official = XLSX.read(await (await buildTemplateWorkbook(entity)).arrayBuffer());
    assert.deepEqual(catalog.SheetNames, official.SheetNames, entity);
    const sheetName = TEMPLATES[entity].sheetName;
    assert.deepEqual(
      XLSX.utils.sheet_to_json(catalog.Sheets[sheetName], { header: 1 }),
      XLSX.utils.sheet_to_json(official.Sheets[sheetName], { header: 1 }),
      entity,
    );
    assert.ok(catalog.Sheets.Metadata);
  }
});

test("elective imports are conditional and breaks are absent from the normal preparation journey", () => {
  assert.ok(!preparationEntities("study_plans", false).includes("elective_slot_courses"));
  assert.ok(preparationEntities("study_plans", true).includes("elective_slot_courses"));
  assert.ok(preparationEntities("cohorts", true).includes("cohort_elective_selections"));
  assert.ok(
    !PREPARATION_STEPS.flatMap((s) => preparationEntities(s.id, true)).includes("daily_breaks"),
  );
});

test("old import links select their own step and reject unknown or legacy imports", () => {
  assert.deepEqual(parsePreparationSearch({ step: "rooms", entity: "teaching_assignments_v2" }), {
    step: "teaching_assignments",
    entity: "teaching_assignments_v2",
  });
  assert.deepEqual(parsePreparationSearch({ entity: "sections", step: "unknown", help: "true" }), {
    help: true,
  });
  assert.deepEqual(parsePreparationSearch({ entity: "daily_breaks" }), {
    step: "constraints",
    entity: "daily_breaks",
  });
  assert.deepEqual(parsePreparationSearch({ entity: ["rooms"] }), {});
});

test("manual pages return to the corresponding preparation step", () => {
  assert.equal(preparationStepForPath("/terms"), "academic_structure");
  assert.equal(preparationStepForPath("/study-plans/one"), "study_plans");
  assert.equal(preparationStepForPath("/scheduling-headcounts"), "cohorts");
  assert.equal(preparationStepForPath("/reports"), undefined);
});

test("repair links route teaching and group shortages to the correct management page", () => {
  const metric = (label: string) => ({
    label,
    missing: 1,
    total: 2,
    category: "scheduling" as const,
  });
  assert.equal(
    fixHrefForMetric(metric("إسناد تدريسي (V2) بدون محاضر")).href,
    "/teaching-assignments",
  );
  assert.equal(
    fixHrefForMetric(metric("دفعات دراسية نشطة بدون مجموعات المحاضرات/المعامل")).href,
    "/delivery-groups",
  );
  assert.equal(
    fixHrefForMetric(metric("SCHEDULING_HEADCOUNT_MISSING")).href,
    "/scheduling-headcounts",
  );
  assert.ok(!preparationLabel("إسناد (V2) في التدفق الجديد").includes("V2"));
});

test("current-data workbook preserves employee keys and numeric workload without adding example staff", async () => {
  const XLSX = await import("xlsx");
  const blob = await buildTemplateWorkbook("instructors", [
    {
      employee_number: "EMP42",
      full_name: "=untrusted",
      max_weekly_hours: 12,
      administrative_release_hours: 0,
      is_active: true,
    },
  ]);
  const wb = XLSX.read(await blob.arrayBuffer());
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.instructors);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]["رقم_الموظف"], "EMP42");
  assert.equal(rows[0]["النصاب الأسبوعي (ساعة)"], 12);
  assert.equal(rows[0]["ساعات_إعفاء_إداري"], 0);
  assert.equal(rows[0]["اسم المدرس"], "'=untrusted");
});
