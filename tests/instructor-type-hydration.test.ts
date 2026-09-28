import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildInstructorCategoryMap,
  CATEGORY_LABEL_AR,
  categorizeInstructor,
  OTHER_COLLEGE_INSTRUCTOR_LABEL_AR,
  requiresAvailability,
} from "../src/lib/instructor-category";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("instructor type hydration without PostgREST embeds", () => {
  test("maps permanent, other-college, external, missing and unknown types", () => {
    const categories = buildInstructorCategoryMap(
      [
        { id: "permanent", instructor_type_id: "type-permanent" },
        { id: "other-college", instructor_type_id: "type-other" },
        { id: "external", instructor_type_id: "type-external" },
        { id: "legacy", instructor_type_id: null },
        { id: "missing-type-row", instructor_type_id: "type-missing" },
      ],
      [
        { id: "type-permanent", code: "permanent", is_external: false },
        { id: "type-other", code: "from_other_college", is_external: false },
        { id: "type-external", code: "contract", is_external: true },
      ],
    );

    expect(categories.get("permanent")).toBe("permanent");
    expect(categories.get("other-college")).toBe("other_college");
    expect(categories.get("external")).toBe("external");
    expect(categories.get("legacy")).toBe("permanent");
    expect(categories.get("missing-type-row")).toBe("permanent");
  });

  test("unifies both non-permanent Arabic category labels", () => {
    expect(OTHER_COLLEGE_INSTRUCTOR_LABEL_AR).toBe("محاضر من كلية أخرى");
    expect(CATEGORY_LABEL_AR.other_college).toBe(OTHER_COLLEGE_INSTRUCTOR_LABEL_AR);
    expect(CATEGORY_LABEL_AR.external).toBe(OTHER_COLLEGE_INSTRUCTOR_LABEL_AR);
  });

  test("keeps an unspecified placeholder separate from availability rules", () => {
    const category = categorizeInstructor({ code: "unspecified", is_external: false });

    expect(category).toBe("unspecified");
    expect(requiresAvailability(category)).toBe(false);
    expect(CATEGORY_LABEL_AR[category]).toBe("غير محدد");
  });

  test("validator performs a flat two-query hydration and never embeds instructor_types", () => {
    const source = readFileSync(resolve(root, "src/lib/conflict-engine/validator.ts"), "utf8");

    expect(source.includes('.from("instructors")')).toBe(true);
    expect(source.includes('.select("id, instructor_type_id")')).toBe(true);
    expect(source.includes('.from("instructor_types")')).toBe(true);
    expect(source.includes('.select("id, code, is_external")')).toBe(true);
    expect(source.includes("instructor_types:instructor_type_id")).toBe(false);
    expect(source.includes("buildInstructorCategoryMap")).toBe(true);
  });

  test("active UI copy no longer exposes the old external-lecturer wording", () => {
    const files = [
      "src/routes/_authenticated/instructor-types.tsx",
      "src/routes/_authenticated/data-readiness.tsx",
      "src/lib/conflict-engine/validator.ts",
      "src/lib/data-onboarding/wizard-steps.ts",
      "src/lib/data-onboarding/preparation.ts",
    ];
    const forbidden = [
      "محاضر خارجي",
      "محاضرون خارجيون",
      "المحاضر الخارجي",
      "متعاون خارجي",
      "الخارجيين",
      "المدرسين الخارجيين",
    ];

    for (const file of files) {
      const source = readFileSync(resolve(root, file), "utf8");
      for (const phrase of forbidden) expect(source.includes(phrase)).toBe(false);
    }
  });

  test("migration normalizes legacy instructor-type rows to the unified label", () => {
    const migration = readFileSync(
      resolve(root, "supabase/migrations/20260914023000_unify_instructor_category_labels.sql"),
      "utf8",
    );
    expect(migration.includes("محاضر من كلية أخرى")).toBe(true);
    expect(migration.includes("from_other_college")).toBe(true);
    expect(migration.includes("external_collaborator")).toBe(true);
  });
});
