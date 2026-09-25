import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ACADEMIC_REPORT_HEADERS,
  buildAcademicReport,
  homeRosterInstructors,
} from "../src/lib/reports/academic-affairs.ts";

const rosterMember = (overrides = {}) => ({
  id: "home-member",
  home_college_id: "IT",
  university_number: "USABA-ITCS-000004",
  full_name: "عضو الكلية",
  academic_rank: "أستاذ مشارك",
  administrative_position: null,
  department_id: "CS",
  home_department: "علوم الحاسوب",
  authoritative_quota: null,
  administrative_release_hours: 0,
  ...overrides,
});

const reportFor = (roster, workload) =>
  buildAcademicReport(
    {
      scope: {
        collegeId: "IT",
        termId: "term",
        departmentId: "all",
        programId: "all",
        instructorId: "all",
      },
      instructors: homeRosterInstructors(roster, "IT"),
      programs: [],
      departments: [{ id: "CS", name: "علوم الحاسوب" }],
      groups: [],
      workloads: workload,
    },
    "workload",
  );

test("visiting faculty never enter the college quota list or its totals", () => {
  const visitor = rosterMember({
    id: "arts-member",
    home_college_id: "ARTS",
    university_number: "USABA-HUM-000062",
    full_name: "سبأ النجاشي",
    authoritative_quota: 18,
  });
  const rows = reportFor(
    [rosterMember({ authoritative_quota: 12 }), visitor],
    [{ instructor_id: "home-member", required_load_hours: 12, standard_assigned_hours: 15, project_supervision_hours: 0 }],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].university_number, "USABA-ITCS-000004");
  assert.equal(rows[0].overload, 3);
  assert(!JSON.stringify(rows).includes("USABA-HUM-000062"));
});

test("missing home quota stays undefined even when the operational card is zero", () => {
  const [row] = reportFor(
    [rosterMember()],
    [{ instructor_id: "home-member", required_load_hours: null, standard_assigned_hours: 0, project_supervision_hours: 0 }],
  );
  assert.equal(row.required, "غير محدد");
  assert.equal(row.overload, "غير محدد");
  assert.equal(row.deficit, "غير محدد");
  assert.notEqual(row.status, "مكتمل النصاب");
});

test("home net quota is counted once after release and exports the university number", () => {
  const [row] = reportFor(
    [rosterMember({ authoritative_quota: 9, administrative_release_hours: 3 })],
    [{ instructor_id: "home-member", required_load_hours: 9, standard_assigned_hours: 16, project_supervision_hours: 0 }],
  );
  assert.equal(row.base_required, 12);
  assert.equal(row.release, 3);
  assert.equal(row.required, 9);
  assert.equal(row.overload, 7);
  for (const kind of ["workload", "overload", "deficit"]) {
    assert(ACADEMIC_REPORT_HEADERS[kind].some((column) => column.key === "university_number"));
    assert(!ACADEMIC_REPORT_HEADERS[kind].some((column) => column.key === "employee_number"));
  }
});

test("unresolved shared teaching in another college cannot become a personal overload", () => {
  const [row] = reportFor(
    [rosterMember({ authoritative_quota: 9 })],
    [{ instructor_id: "home-member", required_load_hours: 9, standard_assigned_hours: 16, project_supervision_hours: 0, allocation_pending: true }],
  );
  assert.equal(row.overload, "غير محدد");
  assert.equal(row.deficit, "غير محدد");
  assert.match(row.status, /التدريس المشترك/);
});
