import { test } from "node:test";
import assert from "node:assert/strict";
import {
  matchDepartment,
  matchProgram,
  normalizeStructureName,
  programById,
  type DepartmentRow,
  type ProgramRow,
} from "../src/lib/excel-import/academic-structure-matching";
import { TEMPLATES } from "../src/lib/excel-import/templates";
import {
  ACTIVE_NEW_FLOW_ENTITIES,
  OFFICIAL_IMPORT_ORDER,
  getEntityMeta,
} from "../src/lib/excel-import/registry";
import { CATALOG, catalogImportEntity } from "../src/lib/data-templates/catalog";
import { PREPARATION_STEPS, preparationEntities } from "../src/lib/data-onboarding/preparation";

// Rows are always pre-scoped to the active college by the loader.
const collegeDepartments: DepartmentRow[] = [
  { id: "d-cs", code: "CS", name: "علوم الحاسب" },
  { id: "d-it", code: "IT", name: "تقنية المعلومات" },
];
const collegePrograms: ProgramRow[] = [
  { id: "p-cs", code: "CS-BSC", name: "بكالوريوس علوم الحاسب", department_id: "d-cs" },
];

test("a new department row matches nothing and is treated as an insert", () => {
  assert.deepEqual(matchDepartment(collegeDepartments, { code: "SE", name: "هندسة البرمجيات" }), {
    status: "none",
  });
});

test("a duplicate department is matched by code, then by normalized name", () => {
  assert.deepEqual(matchDepartment(collegeDepartments, { code: "cs", name: "قسم آخر" }), {
    status: "matched",
    id: "d-cs",
  });
  assert.deepEqual(matchDepartment(collegeDepartments, { code: "", name: "علوم  الحاسب" }), {
    status: "matched",
    id: "d-cs",
  });
  assert.equal(normalizeStructureName("تقنيه المعلومات"), normalizeStructureName("تقنية المعلومات"));
});

test("an ambiguous department name is rejected instead of guessed", () => {
  const rows: DepartmentRow[] = [
    { id: "a", code: "A", name: "علوم الحاسب" },
    { id: "b", code: "B", name: "علوم الحاسب" },
  ];
  assert.deepEqual(matchDepartment(rows, { code: "", name: "علوم الحاسب" }), {
    status: "ambiguous",
  });
});

test("a department from another college is never reachable", () => {
  // Another college's department is absent from the scoped rows.
  assert.deepEqual(matchDepartment(collegeDepartments, { code: "ENG", name: "الهندسة" }), {
    status: "none",
  });
});

test("a program resolves its department and its own existing row", () => {
  const dept = matchDepartment(collegeDepartments, { code: "CS", name: "CS" });
  assert.deepEqual(dept, { status: "matched", id: "d-cs" });
  assert.deepEqual(
    matchProgram(collegePrograms, {
      code: "CS-BSC",
      name: "بكالوريوس علوم الحاسب",
      departmentId: "d-cs",
    }),
    { status: "matched", id: "p-cs" },
  );
  assert.deepEqual(
    matchProgram(collegePrograms, { code: "CS-MSC", name: "ماجستير الحاسب", departmentId: "d-cs" }),
    { status: "none" },
  );
});

test("a program keeps its current department so imports cannot re-parent it silently", () => {
  const match = matchProgram(collegePrograms, { code: "CS-BSC", name: "أي اسم" });
  assert.equal(match.status, "matched");
  assert.equal(programById(collegePrograms, "p-cs")?.department_id, "d-cs");
});

test("both founding entities are active imports with the college-scoped contract", () => {
  for (const entity of ["departments", "academic_programs"] as const) {
    assert.ok(ACTIVE_NEW_FLOW_ENTITIES.includes(entity));
    const meta = getEntityMeta(entity);
    assert.equal(meta.classification, "ACTIVE_NEW_FLOW");
    assert.equal(meta.showInImportUi, true);
    assert.equal(meta.naturalKey, "code");
    const headers = TEMPLATES[entity].columns.map((c) => c.header);
    assert.deepEqual(headers.slice(0, 2), ["الرمز", "الاسم"]);
    // No college column: the import always targets the selected college.
    assert.ok(!headers.some((h) => h.includes("الكلية")));
    const guide = CATALOG.find((c) => catalogImportEntity(c.id) === entity);
    assert.ok(guide?.atomicImport, entity);
  }
  assert.deepEqual(TEMPLATES.academic_programs.columns[2].header, "القسم");
  const order = OFFICIAL_IMPORT_ORDER.filter((s) => s.entity).map((s) => s.entity);
  assert.ok(order.indexOf("departments") < order.indexOf("academic_programs"));
  assert.ok(order.indexOf("academic_programs") < order.indexOf("academic_terms"));
});

test("the founding step prepares departments, then programs, then terms", () => {
  assert.deepEqual(preparationEntities("academic_structure", false), [
    "departments",
    "academic_programs",
    "academic_terms",
  ]);
  assert.equal(PREPARATION_STEPS[0].id, "academic_structure");
});
