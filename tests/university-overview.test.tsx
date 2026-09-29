import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import {
  buildUniversityOverview,
  completeSum,
  selectOverviewSource,
  summarizeUniversityOverview,
  type OverviewSession,
  type OverviewVersion,
  type UniversityOverviewSources,
} from "../src/lib/reports/university-overview";
import {
  CollegeOverviewCard,
  UniversitySummary,
} from "../src/components/reports/university-overview-report";
import type { LeadershipCollege } from "../src/lib/reports/leadership";

function fixture(): UniversityOverviewSources {
  const c: LeadershipCollege = {
    college_id: "c1",
    college: "تكنولوجيا المعلومات وعلوم الحاسوب",
    term_id: "t1",
    term: "الأول",
    term_state: "ready",
    year_inferred: false,
    departments: 2,
    programs: 2,
    faculty_count: 8,
    faculty_directory_count: 10,
    teaching_contributors: 12,
    external_contributors: 4,
    rank_counts: { "أستاذ مساعد": 10 },
    availability_counts: { متاح: 8, ابتعاث: 2 },
    employment_counts: {},
    incomplete_faculty: 0,
    net_quota: 80,
    faculty_assigned_hours: 60,
    overload: 0,
    deficit: 20,
    groups_count: 2,
    covered_groups: 2,
    required_hours: 5,
    covered_hours: 5,
    assigned_hours: 5,
    uncovered_hours: 0,
    pending_groups: 0,
    pending_group_hours: 0,
    overallocated_groups: 0,
    version_id: "pub",
    version: "المنشور",
    version_updated_at: null,
    sessions_count: 2,
    teaching_hours: 5,
    theory_hours: 3,
    practical_hours: 2,
    other_hours: 0,
    room_count: 2,
    halls: 1,
    labs: 1,
    seats: 105,
    used_rooms: 2,
  };
  const version: OverviewVersion = {
    id: "pub",
    college_id: "c1",
    academic_term_id: "t1",
    name: "المنشور",
    status: "published",
    created_at: "2026-09-01",
    updated_at: "2026-09-01",
    disposable_test: false,
  };
  const session = (
    id: string,
    group: string,
    room: string,
    start: string,
    end: string,
  ): OverviewSession => ({
    id,
    college_id: "c1",
    schedule_version_id: "pub",
    delivery_group_id: group,
    cohort_id: "co1",
    instructor_id: "i1",
    room_id: room,
    session_type: room === "lab" ? "lab" : "theory",
    day_of_week: 6,
    start_time: start,
    end_time: end,
    replaced_by_split: false,
  });
  return {
    colleges: [c],
    collegeCodes: [{ id: "c1", code: "ITCS" }],
    departments: [
      { id: "d1", college_id: "c1", name: "علوم الحاسوب", is_archived: false },
      { id: "d2", college_id: "c1", name: "نظم المعلومات", is_archived: false },
      { id: "old", college_id: "c1", name: "قسم مؤرشف", is_archived: true },
    ],
    programs: [
      { id: "p1", college_id: "c1", department_id: "d1", name: "علوم الحاسوب", is_archived: false },
      {
        id: "p2",
        college_id: "c1",
        department_id: "d2",
        name: "نظم المعلومات",
        is_archived: false,
      },
    ],
    cohorts: [{ id: "co1", college_id: "c1", term_id: "t1", program_id: "p1" }],
    groups: [
      { id: "g1", college_id: "c1", cohort_id: "co1" },
      { id: "g2", college_id: "c1", cohort_id: "co1" },
    ],
    teaching: [
      {
        id: "g1",
        college_id: "c1",
        course_code: "CS101",
        component_type: "theory",
        required_hours: 3,
        covered_hours: 3,
      },
      {
        id: "g2",
        college_id: "c1",
        course_code: "CS101",
        component_type: "lab",
        required_hours: 2,
        covered_hours: 2,
      },
    ],
    rooms: [
      {
        id: "hall",
        college_id: "c1",
        name: "قاعة 1",
        code: "H1",
        room_type_id: "rt1",
        capacity: 75,
        is_active: true,
        available_days: [6, 0],
        available_start_time: "08:00",
        available_end_time: "14:00",
      },
      {
        id: "lab",
        college_id: "c1",
        name: "معمل 1",
        code: "L1",
        room_type_id: "rt2",
        capacity: 30,
        is_active: true,
        available_days: [6, 0],
        available_start_time: "08:00",
        available_end_time: "12:00",
      },
    ],
    settings: [
      { college_id: "c1", working_days: [6, 0], day_start_time: "08:00", day_end_time: "16:00" },
    ],
    availability: [],
    roomTypes: [
      { id: "rt1", name_ar: "قاعة", code: "lecture_hall" },
      { id: "rt2", name_ar: "معمل", code: "computer_lab" },
    ],
    versions: [version],
    sessions: [
      session("s1", "g1", "hall", "08:00", "11:00"),
      session("s2", "g2", "lab", "10:00", "12:00"),
    ],
  };
}

test("department totals reconcile; empty departments stay visible and archived ones do not inflate counts", () => {
  const [c] = buildUniversityOverview(fixture(), "published");
  assert.equal(c.departmentCount, 2);
  assert.equal(c.programCount, 2);
  assert.equal(c.courseCount, 1);
  assert.equal(c.requiredHours, 5);
  assert.equal(c.scheduledHours, 5);
  assert.equal(
    c.departments.reduce((n, d) => n + d.requiredHours!, 0),
    5,
  );
  assert.equal(c.departments.find((d) => d.id === "d2")?.requiredHours, 0);
});

test("halls and labs have separate seat stock, actual capacity, occupancy and free time", () => {
  const [c] = buildUniversityOverview(fixture(), "published");
  assert.deepEqual(c.halls, {
    count: 1,
    seats: 75,
    capacityHours: 12,
    occupiedHours: 3,
    freeHours: 9,
    utilization: 25,
    usedCount: 1,
    unusedCount: 0,
  });
  assert.deepEqual(c.labs, {
    count: 1,
    seats: 30,
    capacityHours: 8,
    occupiedHours: 2,
    freeHours: 6,
    utilization: 25,
    usedCount: 1,
    unusedCount: 0,
  });
});

test("ITCS uses the newest complete working draft; incomplete and disposable copies never win", () => {
  const x = fixture();
  x.versions.push(
    { ...x.versions[0], id: "draft", name: "المسودة", status: "draft", created_at: "2026-09-20" },
    { ...x.versions[0], id: "empty", status: "draft", created_at: "2026-09-22" },
    {
      ...x.versions[0],
      id: "test",
      status: "draft",
      created_at: "2026-09-23",
      disposable_test: true,
    },
  );
  x.sessions.push(
    ...x.sessions.map((s) => ({
      ...s,
      id: `${s.id}-draft`,
      schedule_version_id: "draft",
      day_of_week: 0,
    })),
  );
  assert.equal(buildUniversityOverview(x, "presentation")[0].source?.id, "draft");
  assert.equal(buildUniversityOverview(x, "published")[0].source?.id, "pub");
  assert.equal(buildUniversityOverview(x, "presentation")[0].sessionCount, 2);
  const other = selectOverviewSource(
    x.colleges[0],
    "EDU",
    x.versions,
    x.sessions,
    x.teaching,
    "presentation",
  );
  assert.equal(other.version?.id, "pub");
});

test("no published source does not imply empty rooms or zero scheduled demand", () => {
  const x = fixture();
  x.colleges[0].version_id = null;
  const [c] = buildUniversityOverview(x, "published");
  assert.equal(c.requiredHours, 5);
  assert.equal(c.scheduledHours, null);
  assert.equal(c.halls.capacityHours, 12);
  assert.equal(c.halls.freeHours, null);
  assert.equal(c.halls.unusedCount, null);
});

test("missing sessions or inventory are reported as unknown instead of understating use", () => {
  const x = fixture();
  x.sessions.pop();
  let c = buildUniversityOverview(x, "published")[0];
  assert.equal(c.scheduledHours, null);
  assert.equal(c.halls.freeHours, null);
  assert(c.issues.length > 0);
  const y = fixture();
  y.rooms.pop();
  c = buildUniversityOverview(y, "published")[0];
  assert.equal(c.halls.capacityHours, null);
  assert.equal(c.halls.occupiedHours, null);
  assert.equal(c.halls.usedCount, null);
  assert.equal(c.halls.unusedCount, null);
});

test("an unavailable university faculty count stays unknown", () => {
  const rows = buildUniversityOverview(fixture(), "published");
  assert.equal(summarizeUniversityOverview(rows, null).faculty, null);
  assert.equal(summarizeUniversityOverview(rows).faculty, 10);
});

test("overlapping room bookings use interval union and remain visible as a data issue", () => {
  const x = fixture();
  x.sessions[1] = { ...x.sessions[1], room_id: "hall", start_time: "10:00", end_time: "12:00" };
  const [c] = buildUniversityOverview(x, "published");
  assert.equal(c.scheduledHours, 5);
  assert.equal(c.halls.occupiedHours, 4);
  assert.equal(c.halls.freeHours, 8);
  assert.equal(c.rooms.find((r) => r.id === "hall")?.overlapHours, 1);
  assert.equal(c.labs.unusedCount, 1);
});

test("cross-college hosting counts teaching for the beneficiary and occupancy for the owner exactly once", () => {
  const x = fixture();
  const c2 = {
    ...x.colleges[0],
    college_id: "c2",
    college: "الجوف",
    term_id: "t2",
    version_id: "pub2",
    sessions_count: 1,
    teaching_hours: 2,
    required_hours: 0,
    room_count: 0,
    faculty_directory_count: 4,
  };
  x.colleges.push(c2);
  x.collegeCodes.push({ id: "c2", code: "JAWF" });
  x.versions.push({ ...x.versions[0], id: "pub2", college_id: "c2", academic_term_id: "t2" });
  x.sessions.push({
    ...x.sessions[0],
    id: "hosted",
    college_id: "c2",
    schedule_version_id: "pub2",
    cohort_id: null,
    delivery_group_id: null,
    start_time: "12:00",
    end_time: "14:00",
  });
  const report = buildUniversityOverview(x, "published");
  assert.equal(report.find((c) => c.id === "c1")?.halls.occupiedHours, 5);
  assert.equal(report.find((c) => c.id === "c1")?.scheduledHours, 5);
  assert.equal(report.find((c) => c.id === "c2")?.scheduledHours, 2);
  assert.equal(report.find((c) => c.id === "c2")?.hostedElsewhereHours, 2);
  assert.equal(summarizeUniversityOverview(report, 13).faculty, 13);
  // Narrowing the authorized college scope cannot expose another college's sessions or staff.
  x.colleges = [c2];
  const scoped = buildUniversityOverview(x, "published");
  assert.equal(scoped.length, 1);
  assert.equal(scoped[0].rooms.length, 0);
  assert.equal(scoped[0].facultyCount, 4);
});

test("unmapped teaching hours remain visible in the department reconciliation", () => {
  const x = fixture();
  x.groups[0].cohort_id = "missing";
  const [c] = buildUniversityOverview(x, "published");
  assert.equal(c.departments.find((d) => d.id === "unresolved")?.requiredHours, 3);
  assert.equal(c.requiredHours, 5);
  assert(c.issues.some((i) => i.includes("ربطًا بالقسم")));
});

test("incomplete demand, null assignment coverage and unknown resource types are not silently invented", () => {
  const x = fixture();
  x.teaching[0].covered_hours = null;
  x.roomTypes[1].code = null;
  let c = buildUniversityOverview(x, "published")[0];
  assert.equal(c.coveredHours, null);
  assert.equal(c.otherRooms.count, 1);
  assert.equal(c.labs.count, 0);
  x.teaching.pop();
  c = buildUniversityOverview(x, "published")[0];
  assert.equal(c.requiredHours, null);
  assert.equal(c.theoryHours, null);
  assert.equal(completeSum([0, null]), null);
  assert.equal(completeSum([0, 0]), 0);
});

test("same session is not counted twice and inconsistent duplicates fail", () => {
  const x = fixture();
  x.sessions.push({ ...x.sessions[0] });
  assert.equal(buildUniversityOverview(x, "published")[0].scheduledHours, 5);
  x.sessions.push({ ...x.sessions[0], end_time: "12:00" });
  assert.throws(() => buildUniversityOverview(x, "published"), /تغيرت بيانات التقرير/);
});

test("rendered report contains requested departments, separate labs, seats, remaining hours and staffing", () => {
  const rows = buildUniversityOverview(fixture(), "published");
  const html = renderToStaticMarkup(
    createElement(CollegeOverviewCard, { college: rows[0], expanded: true }),
  );
  for (const text of [
    "الساعات التدريسية لكل قسم",
    "نظم المعلومات",
    "معمل 1",
    "غير المشغول",
    "الطاقة",
    "المقاعد",
    "الدرجات العلمية",
    "مصدر الأرقام",
  ])
    assert(html.includes(text), text);
  const summary = renderToStaticMarkup(
    createElement(UniversitySummary, { rows, uniqueFaculty: 10, onSelect: () => undefined }),
  );
  assert(summary.includes("الصورة الأكاديمية والتشغيلية"));
  assert(summary.includes("المعامل والورش"));
});

test("report is linked, role-gated, scoped from the overview RPC and print includes collapsed detail", () => {
  const page = readFileSync("src/routes/_authenticated/reports.university-overview.tsx", "utf8");
  const fetcher = readFileSync("src/lib/reports/fetch-university-overview.ts", "utf8");
  const css = readFileSync("src/components/reports/university-overview.css", "utf8");
  assert(page.includes("canViewLeadership(me)"));
  assert(page.includes("leadershipViewerKey(me)"));
  assert(fetcher.includes('rpc("leadership_overview"'));
  assert(!fetcher.includes(".insert("));
  assert(!fetcher.includes(".update("));
  assert(css.includes("@media print"));
  assert.match(css, /uo-collapsed[^}]*uo-slide-hidden[^}]*display:\s*block\s*!important/);
  for (const path of [
    "src/routes/_authenticated/reports.index.tsx",
    "src/routes/_authenticated/reports.leadership.tsx",
  ])
    assert(readFileSync(path, "utf8").includes('to="/reports/university-overview"'));
});
