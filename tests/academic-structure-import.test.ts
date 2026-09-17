import { test } from "node:test";
import assert from "node:assert/strict";
import {
  matchDepartment,
  matchExistingStructureRow,
  normalizeStructureName,
} from "../src/lib/excel-import/academic-structure-matching";
import { TEMPLATES } from "../src/lib/excel-import/templates";
import { ACTIVE_NEW_FLOW_ENTITIES } from "../src/lib/excel-import/registry";

const departments = [
  { id: "d1", code: "CS", name: "علوم الحاسب" },
  { id: "d2", code: "IS", name: "نظم المعلومات" },
];

test("academic structure templates are active and use the requested Arabic headers", () => {
  assert.ok(ACTIVE_NEW_FLOW_ENTITIES.includes("departments"));
  assert.ok(ACTIVE_NEW_FLOW_ENTITIES.includes("academic_programs"));
  assert.deepEqual(
    TEMPLATES.departments.columns.map((c) => c.header),
    ["الرمز", "الاسم", "رئيس القسم", "نشط", "الترتيب"],
  );
  assert.deepEqual(
    TEMPLATES.academic_programs.columns.map((c) => c.header),
    ["الرمز", "الاسم", "القسم", "نوع الدرجة", "المدة بالسنوات", "نشط", "القبول مفتوح", "الوصف"],
  );
});

test("department lookup prefers code and accepts normalized Arabic name", () => {
  assert.deepEqual(matchDepartment("CS", departments), { kind: "matched", row: departments[0] });
  assert.equal(matchDepartment("علومُ   الحاسب", departments).kind, "matched");
  assert.equal(normalizeStructureName("إدارة الـنُظُم"), "اداره النظم");
});

test("department lookup rejects missing and ambiguous names", () => {
  assert.equal(matchDepartment("غير موجود", departments).kind, "missing");
  assert.equal(
    matchDepartment("علوم الحاسب", [...departments, { id: "d3", code: "CS2", name: "علوم الحاسب" }])
      .kind,
    "ambiguous",
  );
});

test("existing rows match by code before normalized name", () => {
  assert.equal(matchExistingStructureRow("CS", "اسم آخر", departments)?.id, "d1");
  assert.equal(matchExistingStructureRow("", "نظم المعلومات", departments)?.id, "d2");
});
