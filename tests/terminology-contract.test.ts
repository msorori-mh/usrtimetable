import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { canonicalizeImportShape } from "../src/lib/excel-import/header-aliases.ts";
import { detectTeachingImportWorkbookMode } from "../src/lib/excel-import/teaching-assignments-source-schema.ts";
import { TEMPLATES } from "../src/lib/excel-import/templates.ts";

const root = resolve(import.meta.dirname, "..");
const userFacingFiles = [
  "src/components/data-onboarding/import-workspace.tsx",
  "src/components/print-center/print-sheet.tsx",
  "src/components/study-plans/plan-courses-manager.tsx",
  "src/hooks/use-generate-delivery-groups.ts",
  "src/lib/academic-delivery/generation-messages.ts",
  "src/lib/academic-delivery/plan-component-room-types.ts",
  "src/lib/academic-delivery/plan-course-editor.ts",
  "src/lib/academic-delivery/study-plan-readiness.ts",
  "src/lib/academic-delivery/teaching-assignments-v2.ts",
  "src/lib/academic-delivery/tutorial-room-type.ts",
  "src/lib/admin-export/datasets.ts",
  "src/lib/admin-nav.ts",
  "src/lib/auto-scheduler/session-plan.ts",
  "src/lib/data-templates/catalog.ts",
  "src/lib/excel-import/registry.ts",
  "src/lib/excel-import/teaching-assignments-source-resolver.ts",
  "src/lib/excel-import/teaching-assignments-v2-hours-preflight.ts",
  "src/lib/print-center/types.ts",
  "src/lib/reports/academic-affairs.ts",
  "src/routes/_authenticated/academic-cohorts.tsx",
  "src/routes/_authenticated/data-readiness.tsx",
  "src/routes/_authenticated/delivery-groups.tsx",
  "src/routes/_authenticated/scheduling-headcounts.tsx",
  "src/routes/_authenticated/teaching-assignments.tsx",
];

describe("Arabic academic lecture terminology contract", () => {
  it("leaves no legacy academic component wording in user-facing paths", () => {
    for (const path of userFacingFiles) {
      assert.doesNotMatch(readFileSync(resolve(root, path), "utf8"), /مكوّن|مكون/gu, path);
    }
  });

  it("exports the new headers and canonicalizes both old and new headers", () => {
    const columns = TEMPLATES.teaching_assignments_v2.columns;
    const component = columns.find((column) => column.key === "component_type");
    const hours = columns.find((column) => column.key === "assigned_component_hours");
    assert.equal(component?.header, "نوع_المحاضرة");
    assert.equal(hours?.header, "ساعات_المحاضرة_المسندة");

    for (const headers of [
      ["نوع_المحاضرة", "ساعات_المحاضرة_المسندة"],
      ["نوع_المكوّن", "ساعات_المكوّن_المسندة"],
      ["نوع_المكون", "ساعات_المكون_المسندة"],
    ]) {
      const normalized = canonicalizeImportShape(columns, headers, [
        { [headers[0]]: "theory", [headers[1]]: 3 },
      ]);
      assert.deepEqual(normalized.headers, ["نوع_المحاضرة", "ساعات_المحاضرة_المسندة"]);
      assert.equal(normalized.rows[0].نوع_المحاضرة, "theory");
      assert.equal(normalized.rows[0].ساعات_المحاضرة_المسندة, 3);
    }
  });

  it("detects official assignment workbooks with old or new Arabic headers", () => {
    const base = ["رمز_الدفعة", "رمز_المقرر", "رمز_مجموعة_التقديم", "رقم_الموظف_للمحاضر"];
    assert.equal(
      detectTeachingImportWorkbookMode([[...base, "نوع_المحاضرة"]]),
      "official_template",
    );
    assert.equal(detectTeachingImportWorkbookMode([[...base, "نوع_المكوّن"]]), "official_template");
  });
});
