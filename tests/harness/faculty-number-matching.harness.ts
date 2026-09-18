import assert from "node:assert/strict";
import { prepareInstructorRow } from "../../src/lib/excel-import/instructor-sheet";
import type { ParsedRow } from "../../src/lib/excel-import/types";

const columns = ["is_active", "employee_number", "university_number"].map((key) => ({
  key,
  header: key,
}));
const existing = [
  { full_name: "محاضر", employee_number: "LEGACY-1", university_number: "USABA-HUM-000001" },
];
const row = (values: Record<string, unknown>): ParsedRow => ({
  rowNumber: 2,
  raw: {},
  values: { full_name: "محاضر", max_weekly_hours: 18, ...values },
});
const matched = row({ university_number: "USABA-HUM-000001" });
assert.equal(prepareInstructorRow(matched, existing, columns).length, 0);
assert.equal(matched.values.employee_number, "LEGACY-1");
assert.ok(
  prepareInstructorRow(row({ university_number: "USABA-HUM-999999" }), existing, columns).some(
    (e) => e.errorCode === "university_identity_not_unique",
  ),
);
assert.ok(
  prepareInstructorRow(
    row({ university_number: "USABA-HUM-000001", employee_number: "OTHER" }),
    existing,
    columns,
  ).some((e) => e.errorCode === "university_employee_mismatch"),
);
const legacy = row({ employee_number: "LEGACY-1" });
assert.equal(prepareInstructorRow(legacy, existing, columns).length, 0);
assert.equal(legacy.values.employee_number, "LEGACY-1");
console.log("FACULTY_NUMBER_MATCHING_PASS");
