import assert from "node:assert/strict";
import { mock, test } from "node:test";
import * as XLSX from "xlsx";
import { TEMPLATES, parseExcel } from "../src/lib/excel-import/templates";
import { COURSE_NATURE_VALUES, normalizeCourseNature } from "../src/lib/excel-import/course-nature";
import type { ImportEntity, ParsedRow } from "../src/lib/excel-import/types";

const college = "college-a";
let role = "college_admin";
let savedPayload: ParsedRow[] = [];
const catalog: Record<string, Record<string, unknown>[]> = {
  user_colleges: [{ id: "membership", user_id: "admin", college_id: college }],
  departments: [{ id: "department-a", code: "IT", college_id: college }],
  academic_programs: [
    {
      id: "program-a",
      code: "cyb",
      department_id: "department-a",
      college_id: college,
    },
  ],
  room_types: [
    {
      id: "lecture",
      code: "lecture_hall",
      college_id: college,
      is_active: true,
      default_capacity: 60,
    },
  ],
};
mock.module("../src/integrations/supabase/client.ts", {
  namedExports: {
    supabase: {
      auth: {
        getUser: async () => ({ data: { user: { id: "admin" } }, error: null }),
      },
      from(table: string) {
        const filters: Record<string, unknown> = {};
        const result = () => ({
          data: (table === "user_roles" ? [{ user_id: "admin", role }] : catalog[table]).filter(
            (row) => Object.entries(filters).every(([key, value]) => row[key] === value),
          ),
          error: null,
        });
        const query = {
          select() {
            return query;
          },
          eq(key: string, value: unknown) {
            filters[key] = value;
            return query;
          },
          async maybeSingle() {
            const r = result();
            return { ...r, data: r.data[0] ?? null };
          },
          then(resolve: (result: unknown) => unknown) {
            return Promise.resolve(result()).then(resolve);
          },
        };
        return query;
      },
      async rpc(name: string, args: { p_validated_payload: ParsedRow[] }) {
        assert.equal(name, "create_import_preview_manifest");
        savedPayload = structuredClone(args.p_validated_payload);
        return { data: "job-a", error: null };
      },
    },
  },
});
const { validate } = await import("../src/lib/excel-import/validators");
const { createJobAndPersistErrors } = await import("../src/lib/excel-import/commit");

function sourceFile(entity: ImportEntity, nature: string) {
  const columns = TEMPLATES[entity].columns;
  const rows = Array.from({ length: 6 }, (_, i) => {
    const values: Record<string, unknown> = {
      program_code: "cyb",
      plan_code: "TEST_ONLY",
      plan_version: "1",
      level_number: 3,
      semester: 1,
      department_code: "IT",
      course_code: `TEST_ONLY_${i}`,
      course_name: `Test course ${i}`,
      credit_hours: 2,
      theory_hours: 2,
      lectures_per_week: 1,
      lecture_session_duration: 2,
      course_nature: nature,
      required_room_type_code_lecture: "lecture_hall",
    };
    return columns.map((c) => values[c.key] ?? "");
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([columns.map((c) => c.header), ...rows]),
    TEMPLATES[entity].sheetName,
  );
  return new File([XLSX.write(wb, { type: "array", bookType: "xlsx" })], "TEST_ONLY.xlsx");
}

test("both plan templates advertise exactly the database course classifications", () => {
  assert.deepEqual(COURSE_NATURE_VALUES, ["department", "college", "university"]);
  for (const entity of ["study_plan_courses", "full_study_plan"]) {
    assert.deepEqual(
      TEMPLATES[entity].columns.find((c) => c.key === "course_nature")?.enumValues,
      COURSE_NATURE_VALUES,
    );
  }
});

for (const entity of ["study_plan_courses", "full_study_plan"] as const) {
  for (const input of ["faculty", " Faculty ", "college"]) {
    test(`${entity}: ${input} reaches the stored preview as college after workbook parsing`, async () => {
      const parsed = await parseExcel(sourceFile(entity, input), entity);
      const result = await validate(entity, parsed.headers, parsed.rows, college);
      assert.deepEqual(result.errors, []);
      assert.equal(result.validRows.length, 6);
      assert.ok(result.validRows.every((r) => r.values.course_nature === "college"));
      assert.equal(result.validRows[0].raw["طبيعة_المقرر"], input);
      await createJobAndPersistErrors(
        entity,
        "upsert",
        college,
        "TEST_ONLY.xlsx",
        6,
        result.validRows,
        [],
        "admin",
      );
      assert.equal(savedPayload.length, 6);
      assert.ok(savedPayload.every((r) => r.values.course_nature === "college"));
    });
  }
  test(`${entity}: unknown nature is rejected before preview persistence`, async () => {
    const parsed = await parseExcel(sourceFile(entity, "facultyy"), entity);
    const result = await validate(entity, parsed.headers, parsed.rows, college);
    assert.equal(result.validRows.length, 0);
    assert.equal(result.invalidRows.length, 6);
    assert.equal(result.errors.filter((e) => e.errorCode === "invalid_enum").length, 6);
  });
}

test("canonical classifications and optional empty values retain their meaning", () => {
  for (const value of COURSE_NATURE_VALUES) assert.equal(normalizeCourseNature(value), value);
  for (const value of [null, undefined, "", " "]) assert.equal(normalizeCourseNature(value), null);
  assert.equal(normalizeCourseNature("typo"), "typo");
});

test("classification normalization does not bypass the import manager guard", async () => {
  role = "viewer";
  try {
    const parsed = await parseExcel(sourceFile("study_plan_courses", "faculty"));
    await assert.rejects(validate("study_plan_courses", parsed.headers, parsed.rows, college), {
      code: "import_forbidden",
    });
  } finally {
    role = "college_admin";
  }
});
