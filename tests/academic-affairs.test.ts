import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAcademicReport,
  parseAcademicWorkload,
  parseAcademicReportKind,
  isWorkloadReport,
  summarizeCourseAssignmentStatusRows,
  summarizeWorkloadRows,
  ACADEMIC_REPORT_HEADERS,
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

test("reports support an empty academic structure before details are entered", () => {
  const data = fixture();
  data.instructors = [];
  data.programs = [];
  data.departments = [];
  data.groups = [];
  data.workloads = [];
  for (const kind of [
    "workload",
    "overload",
    "deficit",
    "assignments",
    "course_status",
    "shortages",
  ] as const) {
    assert.deepEqual(buildAcademicReport(data, kind), []);
  }
});

test("co-teaching reports each assigned share exactly once", () => {
  const rows = buildAcademicReport(fixture(), "assignments");
  assert.deepEqual(
    rows.map((r) => r.assigned),
    [2, 2],
  );
});
test("assignment report carries operational context for compact tables and exports", () => {
  const row = buildAcademicReport(fixture(), "assignments")[0];
  assert.equal(row.study_system, "عام");
  assert.equal(row.students, 30);
  assert.equal(row.capacity, 40);
  assert.equal(row.allocation_status, "مغطى بالكامل");
  assert.equal(row.employee_number, "—");
});
test("course assignment status includes assigned, partial and unassigned groups with details", () => {
  const data = fixture();
  data.groups = [
    group({ delivery_group_id: "complete" }),
    group({
      delivery_group_id: "partial",
      instructors: [instructor("i1", 2)],
      assignment_count: 1,
      assigned_hours_total: 2,
      remaining_hours: 2,
      allocation_status: "under_allocated",
    }),
    group({
      delivery_group_id: "unassigned",
      instructors: [],
      assignment_count: 0,
      assigned_hours_total: 0,
      remaining_hours: 4,
      allocation_status: "unassigned",
    }),
  ];
  const rows = buildAcademicReport(data, "course_status");
  assert.deepEqual(
    rows.map((row) => row.allocation_status_code),
    ["fully_allocated", "under_allocated", "unassigned"],
  );
  assert.match(String(rows[0].instructors), /i1 \(2 س\).*i2 \(2 س\)/);
  assert.equal(rows[2].instructors, "لم يُسند");
  assert.deepEqual(summarizeCourseAssignmentStatusRows(rows), {
    groups: 3,
    unassignedGroups: 1,
    partialGroups: 1,
    completeGroups: 1,
    overAllocatedGroups: 0,
    pendingSplitGroups: 0,
    requiredHours: 12,
    assignedHours: 6,
    remainingHours: 6,
  });
});
test("unresolved shared teaching remains pending instead of fabricating assigned hours", () => {
  const data = fixture();
  data.groups[0].instructors[0].assigned_component_hours = null;
  data.groups[0].assigned_hours_total = 2;
  data.groups[0].remaining_hours = 2;
  const row = buildAcademicReport(data, "course_status")[0];
  assert.equal(row.allocation_status_code, "pending_split");
  assert.equal(row.assigned, null);
  assert.equal(row.remaining, null);
  assert.equal(row.shared_hours_pending, 4);
});
test("an unspecified shared allocation stays unknown instead of copying the component", () => {
  const data = fixture();
  data.groups[0].instructors[0].assigned_component_hours = null;
  const row = buildAcademicReport(data, "assignments")[0];
  assert.equal(row.assigned, null);
  assert.match(String(row.note), /غير محددة/);
});
test("shortage report does not fabricate a numeric deficit while shared teaching is unresolved", () => {
  const data = fixture();
  data.groups[0].instructors[0].assigned_component_hours = null;
  data.groups[0].assigned_hours_total = 2;
  data.groups[0].remaining_hours = 2;
  const row = buildAcademicReport(data, "shortages")[0];
  assert.equal(row.assigned, null);
  assert.equal(row.shortage, null);
  assert.equal(row.shared_hours_pending, 4);
  assert.match(String(row.note), /بانتظار|توزيع/);
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
  assert.equal(row.required, "غير محدد");
  assert.equal(row.overload, "غير محدد");
  assert.equal(row.deficit, "غير محدد");
  assert.equal(row.assigned, 14);
  assert.equal(row.status, "الساعات الزائدة بانتظار استكمال بيانات النصاب");
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

test("separate reports contain only their positive balance, including zero-assignment deficits", () => {
  const over = buildAcademicReport(fixture(), "overload");
  const deficit = buildAcademicReport(fixture(), "deficit");
  assert.deepEqual(
    over.map((r) => [r.instructor, r.overload]),
    [["أحمد", 2]],
  );
  assert.deepEqual(
    deficit.map((r) => [r.instructor, r.assigned, r.deficit]),
    [["محمد", 0, 9]],
  );
  assert.equal(summarizeWorkloadRows(over).overloadHours, 2);
  assert.equal(summarizeWorkloadRows(deficit).deficitHours, 9);
});

test("missing quotas and unresolved shared allocations stay out of both separate reports", () => {
  const data = fixture();
  data.workloads[0].required_load_hours = null;
  data.groups[0].instructors[1].assigned_component_hours = null;
  assert.deepEqual(buildAcademicReport(data, "overload"), []);
  assert.deepEqual(buildAcademicReport(data, "deficit"), []);
});

test("balanced members are excluded; explicit zero quotas are real and release applies once", () => {
  const data = fixture();
  data.instructors[0] = {
    ...data.instructors[0],
    max_weekly_hours: 18,
    administrative_release_hours: 4,
  };
  data.instructors[1] = { ...data.instructors[1], max_weekly_hours: 0 };
  data.workloads[1].standard_assigned_hours = 3;
  const rows = buildAcademicReport(data, "overload");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].instructor, "محمد");
  assert.equal(rows[0].overload, 3);
  assert.deepEqual(buildAcademicReport(data, "deficit"), []);
});

test("separate reports sort by largest difference and preserve fractional hours", () => {
  const data = fixture();
  data.workloads[1].standard_assigned_hours = 12.5;
  const rows = buildAcademicReport(data, "overload");
  assert.deepEqual(
    rows.map((r) => r.overload),
    [3.5, 2],
  );
  assert.equal(summarizeWorkloadRows(rows).overloadHours, 5.5);
  assert.equal(data.workloads[0].standard_assigned_hours, 14);
});

test("program and instructor filters retain full college workload without a false deficit", () => {
  const data = fixture();
  data.scope.programId = "p1";
  data.scope.instructorId = "i1";
  assert.equal(buildAcademicReport(data, "overload")[0].assigned, 14);
  assert.deepEqual(buildAcademicReport(data, "deficit"), []);
  data.scope.programId = "p2";
  assert.deepEqual(buildAcademicReport(data, "overload"), []);
});

test("links validate report kind and every workload report loads the quota facts", () => {
  for (const kind of ["workload", "overload", "deficit"] as const) {
    assert.equal(parseAcademicReportKind(kind), kind);
    assert.equal(isWorkloadReport(kind), true);
  }
  assert.equal(parseAcademicReportKind("course_status"), "course_status");
  assert.equal(isWorkloadReport("course_status"), false);
  for (const value of [undefined, null, "unknown", {}, "__proto__"]) {
    assert.equal(parseAcademicReportKind(value), "workload");
  }
  assert.equal(isWorkloadReport("shortages"), false);
});

test("separate export schemas expose the requested measure without the opposite balance", () => {
  assert.ok(ACADEMIC_REPORT_HEADERS.overload.some((h) => h.key === "overload"));
  assert.ok(!ACADEMIC_REPORT_HEADERS.overload.some((h) => h.key === "deficit"));
  assert.ok(ACADEMIC_REPORT_HEADERS.deficit.some((h) => h.key === "deficit"));
  assert.ok(!ACADEMIC_REPORT_HEADERS.deficit.some((h) => h.key === "overload"));
  const data = fixture();
  data.workloads = [];
  assert.throws(() => buildAcademicReport(data, "overload"), /غير مكتملة/);
  assert.throws(() => buildAcademicReport(data, "deficit"), /غير مكتملة/);
});
