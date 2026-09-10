import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAcademicReport,
  parseAcademicWorkload,
  type AcademicReportInput,
} from "../src/lib/reports/academic-affairs.ts";
import type { TeachingAssignmentWorkspaceRow } from "../src/lib/academic-delivery/teaching-assignments-v2.ts";

const instructor = (id: string, hours: number | null) => ({
  assignment_id: `a-${id}`,
  instructor_id: id,
  instructor_name: id,
  employee_number: null,
  assigned_component_hours: hours,
  is_active: true,
  updated_at: "2026-09-10",
});
function group(
  extra: Partial<TeachingAssignmentWorkspaceRow> = {},
): TeachingAssignmentWorkspaceRow {
  return {
    delivery_group_id: "g1",
    college_id: "c1",
    cohort_id: "co1",
    cohort_code: "2026",
    program_id: "p1",
    level_id: "l1",
    term_id: "t1",
    study_system: "regular",
    plan_course_id: "pc1",
    plan_course_component_id: "component1",
    component_type: "theory",
    course_id: "course1",
    course_code: "MATH",
    course_name: "رياضيات",
    group_number: 1,
    group_code: "G1",
    expected_students: 30,
    capacity_limit: 40,
    is_obsolete: false,
    active: true,
    excluded_from_standard_workload: false,
    component_hours: 4,
    assigned_hours_total: 4,
    remaining_hours: 0,
    assignment_count: 2,
    is_co_taught: true,
    allocation_status: "fully_allocated",
    instructors: [instructor("i1", 2), instructor("i2", 2)],
    conflicts: [],
    ...extra,
  };
}
function fixture(): AcademicReportInput {
  return {
    scope: {
      collegeId: "c1",
      termId: "t1",
      departmentId: "all",
      programId: "all",
      instructorId: "all",
    },
    instructors: [
      {
        id: "i1",
        full_name: "أحمد",
        academic_rank: "أستاذ مساعد",
        department_id: "d1",
      },
      {
        id: "i2",
        full_name: "محمد",
        academic_rank: "أستاذ مشارك",
        department_id: "d1",
      },
    ],
    programs: [
      { id: "p1", name: "الحاسب", department_id: "d1" },
      { id: "p2", name: "الشبكات", department_id: "d2" },
    ],
    departments: [
      { id: "d1", name: "الحاسب" },
      { id: "d2", name: "الشبكات" },
    ],
    groups: [group()],
    workloads: [
      {
        instructor_id: "i1",
        required_load_hours: 12,
        standard_assigned_hours: 14,
        project_supervision_hours: 3,
      },
      {
        instructor_id: "i2",
        required_load_hours: 9,
        standard_assigned_hours: 0,
        project_supervision_hours: 0,
      },
    ],
  };
}

test("co-teaching reports each assigned share exactly once", () => {
  const rows = buildAcademicReport(fixture(), "assignments");
  assert.deepEqual(
    rows.map((r) => r.assigned),
    [2, 2],
  );
});
test("an unspecified shared allocation stays unknown instead of copying the component", () => {
  const data = fixture();
  data.groups[0].instructors[0].assigned_component_hours = null;
  const row = buildAcademicReport(data, "assignments")[0];
  assert.equal(row.assigned, null);
  assert.match(String(row.note), /غير محددة/);
});
test("sole instructor falls back to component contact hours", () => {
  const data = fixture();
  data.groups[0].instructors = [instructor("i1", null)];
  assert.equal(buildAcademicReport(data, "assignments")[0].assigned, 4);
});
test("foreign college, other term, inactive and obsolete groups are excluded", () => {
  const data = fixture();
  data.groups.push(
    group({ college_id: "c2" }),
    group({ term_id: "t2" }),
    group({ active: false }),
    group({ is_obsolete: true }),
  );
  assert.equal(buildAcademicReport(data, "assignments").length, 2);
});
test("unassigned and partially assigned groups appear in the assignment shortage report", () => {
  const data = fixture();
  data.groups = [
    group({ instructors: [], assigned_hours_total: 0, remaining_hours: 4 }),
    group({ remaining_hours: 2, assigned_hours_total: 2 }),
  ];
  const rows = buildAcademicReport(data, "shortages");
  assert.deepEqual(
    rows.map((r) => r.shortage),
    [4, 2],
  );
  assert.equal(rows[0].instructors, "لم يُسند");
});
test("zero assigned hours means full required-load deficit, including unassigned faculty", () => {
  assert.equal(buildAcademicReport(fixture(), "workload")[1].deficit, 9);
});
test("missing policies leave all compliance metrics unknown", () => {
  const data = fixture();
  data.workloads[0].required_load_hours = null;
  const row = buildAcademicReport(data, "workload")[0];
  assert.equal(row.required, null);
  assert.equal(row.overload, null);
  assert.equal(row.deficit, null);
  assert.equal(row.assigned, 14);
  assert.equal(row.status, "سياسة النصاب غير محددة");
});
test("project hours remain separate from standard load", () => {
  const row = buildAcademicReport(fixture(), "workload")[0];
  assert.equal(row.assigned, 14);
  assert.equal(row.project, 3);
  assert.equal(row.overload, 2);
});
test("program filtering keeps full-term workload and does not fabricate a deficit", () => {
  const data = fixture();
  data.scope.programId = "p1";
  const row = buildAcademicReport(data, "workload")[0];
  assert.equal(row.assigned, 14);
  assert.equal(row.deficit, 0);
  assert.equal(row.overload, 2);
});
test("department and instructor filters restrict assignment detail", () => {
  const data = fixture();
  data.scope.instructorId = "i2";
  assert.deepEqual(
    buildAcademicReport(data, "assignments").map((r) => r.instructor),
    ["i2"],
  );
  data.scope.departmentId = "d2";
  assert.deepEqual(buildAcademicReport(data, "assignments"), []);
});
test("missing workload records fail rather than rendering zero", () => {
  const data = fixture();
  data.workloads = [];
  assert.throws(() => buildAcademicReport(data, "workload"), /غير مكتملة/);
});
test("RPC payload validation rejects foreign identities and invalid numbers", () => {
  const fact = fixture().workloads[0];
  assert.equal(parseAcademicWorkload(fact, "i1"), fact);
  for (const value of [
    null,
    {},
    { ...fact, instructor_id: "other" },
    { ...fact, standard_assigned_hours: NaN },
    { ...fact, required_load_hours: undefined },
  ]) {
    assert.throws(() => parseAcademicWorkload(value, "i1"));
  }
});
