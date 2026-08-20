import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildInstructorCategoryMap } from "../src/lib/instructor-category";

const root = resolve(import.meta.dir, "..");

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

  test("validator performs a flat two-query hydration and never embeds instructor_types", () => {
    const source = readFileSync(resolve(root, "src/lib/conflict-engine/validator.ts"), "utf8");

    expect(source.includes('.from("instructors")')).toBe(true);
    expect(source.includes('.select("id, instructor_type_id")')).toBe(true);
    expect(source.includes('.from("instructor_types")')).toBe(true);
    expect(source.includes('.select("id, code, is_external")')).toBe(true);
    expect(source.includes("instructor_types:instructor_type_id")).toBe(false);
    expect(source.includes("buildInstructorCategoryMap")).toBe(true);
  });
});
