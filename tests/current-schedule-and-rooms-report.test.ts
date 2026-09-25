import { test } from "node:test";
import { printPageStyleCss } from "../src/lib/print-center/page-style";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  countPagedSessions,
  groupCurrentSchedulePages,
} from "../src/lib/print-center/current-schedule";
import {
  buildRoomsReportAnalytics,
  buildRoomsReportSummary,
  buildRoomsHeatmap,
  groupRoomsReportPages,
  roomWeeklyAvailableHours,
  roomsReportTotals,
} from "../src/lib/print-center/rooms-report";
import type { PrintSessionLike } from "../src/lib/print-center/types";

const session = (over: Partial<PrintSessionLike> & { id: string }): PrintSessionLike => ({
  day_of_week: 0,
  start_time: "08:00",
  end_time: "10:00",
  study_system: "regular",
  session_type: "lecture",
  college_id: "college",
  course_offerings: {
    program_id: "p1",
    level_id: "l1",
    academic_programs: { name: "نظم المعلومات" },
    academic_levels: { name: "المستوى الأول", level_number: 1 },
    courses: { code: "IS101", name: "مقرر", departments: { name: "قسم النظم" } },
  },
  ...over,
});

test("current schedule print groups every session with no silent drops", () => {
  const sessions = [
    session({ id: "a" }),
    session({ id: "b", day_of_week: 1, study_system: "parallel" }),
    session({
      id: "c",
      room_id: "r2",
      course_offerings: {
        program_id: "p2",
        level_id: "l2",
        academic_programs: { name: "علوم الحاسوب" },
        academic_levels: { name: "المستوى الثاني", level_number: 2 },
        courses: { code: "CS111", name: "برمجة", departments: { name: "قسم الحاسوب" } },
      },
    }),
  ];
  const pages = groupCurrentSchedulePages(sessions, { collegeId: "college", studySystem: "all" });
  assert.equal(countPagedSessions(pages), sessions.length);
  assert.ok(pages.length >= 3);
  assert.ok(pages.every((p) => p.sessions.length > 0));
});

test("shared sessions are printed on both system pages but counted once", () => {
  const sessions = [session({ id: "shared", study_system: "both" })];
  const pages = groupCurrentSchedulePages(sessions, { collegeId: "college", studySystem: "all" });
  assert.equal(pages.length, 2);
  assert.equal(countPagedSessions(pages), 1);
});

test("room availability rows win over the college working window", () => {
  const availability = [
    { room_id: "r1", start_time: "08:00", end_time: "16:00" },
    { room_id: "r1", start_time: "08:00", end_time: "12:00" },
  ];
  const settings = {
    working_days: [0, 1, 2, 3, 4],
    day_start_time: "08:00",
    day_end_time: "14:00",
  };
  assert.equal(roomWeeklyAvailableHours({ roomId: "r1", availability, settings }), 12);
  assert.equal(roomWeeklyAvailableHours({ roomId: "r2", availability, settings }), 30);
});

test("rooms report summarises every active room and details used rooms", () => {
  const sessions = [
    session({
      id: "a",
      room_id: "r1",
      expected_students: 20,
      rooms: { code: "A1", name: "قاعة 1" },
    }),
    session({
      id: "b",
      room_id: "r1",
      day_of_week: 2,
      start_time: "10:00",
      end_time: "13:00",
      expected_students: 40,
      rooms: { code: "A1", name: "قاعة 1" },
    }),
    session({ id: "c" }),
  ];
  const summary = buildRoomsReportSummary({
    rooms: [
      { id: "r1", code: "A1", name: "قاعة 1", capacity: 40, room_type_id: "t1" },
      { id: "r2", code: "L1", name: "معمل 1", capacity: 25, room_type_id: "t2" },
      { id: "r3", code: "X1", name: "مغلقة", is_active: false },
    ],
    roomTypes: [
      { id: "t1", code: "lecture_hall", name_ar: "قاعة محاضرات" },
      { id: "t2", code: "computer_lab", name_ar: "معمل حاسوب" },
    ],
    sessions,
    availability: [],
    settings: { working_days: [0, 1, 2, 3, 4], day_start_time: "08:00", day_end_time: "14:00" },
  });
  assert.equal(summary.length, 2);
  const a1 = summary.find((r) => r.room_code === "A1")!;
  assert.equal(a1.used_hours, 5);
  assert.equal(a1.available_hours, 30);
  assert.equal(a1.session_count, 2);
  assert.equal(a1.utilization, "17%");
  assert.equal(a1.free_hours, 25);
  assert.equal(a1.average_students, 30);
  assert.equal(a1.capacity_efficiency_percent, 75);
  assert.equal(a1.max_students, 40);
  assert.equal(a1.max_capacity_efficiency_percent, 100);
  assert.equal(a1.peak_day, "الأحد");
  assert.equal(a1.theory_sessions, 2);
  assert.equal(a1.applied_sessions, 0);
  assert.equal(a1.room_type, "قاعة محاضرات");
  assert.equal(a1.room_category, "hall");

  const totals = roomsReportTotals({ summary, sessions });
  assert.equal(totals.rooms, 2);
  assert.equal(totals.sessions, 3);
  assert.equal(totals.sessionsWithoutRoom, 1);
  assert.equal(totals.freeHours, 55);

  const pages = groupRoomsReportPages(sessions, "college");
  assert.equal(pages.length, 2);
  assert.equal(
    pages.reduce((s, p) => s + p.sessions.length, 0),
    sessions.length,
  );
});

test("rooms analytics computes bands, rankings, category averages and capacity waste", () => {
  const summary = [
    {
      room_id: "r1",
      room_code: "A",
      room_name: "قاعة أ",
      room_type: "قاعة",
      room_category: "hall" as const,
      capacity: 100,
      used_hours: 27,
      available_hours: 30,
      free_hours: 3,
      overbooked_hours: 0,
      utilization_percent: 90,
      utilization: "90%",
      session_count: 3,
      average_students: 40,
      capacity_efficiency_percent: 40,
      max_students: 50,
      max_capacity_efficiency_percent: 50,
      peak_day: "الأحد",
      peak_slot: "08:00–10:00",
      theory_sessions: 3,
      applied_sessions: 0,
    },
    {
      room_id: "r2",
      room_code: "L",
      room_name: "معمل ب",
      room_type: "معمل",
      room_category: "lab" as const,
      capacity: 20,
      used_hours: 24,
      available_hours: 30,
      free_hours: 6,
      overbooked_hours: 0,
      utilization_percent: 80,
      utilization: "80%",
      session_count: 4,
      average_students: 18,
      capacity_efficiency_percent: 90,
      max_students: 20,
      max_capacity_efficiency_percent: 100,
      peak_day: "الاثنين",
      peak_slot: "10:00–12:00",
      theory_sessions: 0,
      applied_sessions: 4,
    },
    {
      room_id: "r3",
      room_code: "C",
      room_name: "قاعة ج",
      room_type: "قاعة",
      room_category: "hall" as const,
      capacity: 30,
      used_hours: 15,
      available_hours: 30,
      free_hours: 15,
      overbooked_hours: 0,
      utilization_percent: 50,
      utilization: "50%",
      session_count: 2,
      average_students: 20,
      capacity_efficiency_percent: 67,
      max_students: 25,
      max_capacity_efficiency_percent: 83,
      peak_day: "الثلاثاء",
      peak_slot: "12:00–14:00",
      theory_sessions: 2,
      applied_sessions: 0,
    },
  ];
  const analytics = buildRoomsReportAnalytics({
    summary,
    sessions: [],
    availability: [],
    settings: null,
  });
  assert.deepEqual(analytics.bands, { crowded: 1, medium: 1, low: 1 });
  assert.equal(analytics.halls, 2);
  assert.equal(analytics.labs, 1);
  assert.equal(analytics.hallAverageUtilization, 70);
  assert.equal(analytics.labAverageUtilization, 80);
  assert.equal(analytics.highest?.room_id, "r1");
  assert.equal(analytics.lowest?.room_id, "r3");
  assert.deepEqual(
    analytics.highTimeLowCapacity.map((r) => r.room_id),
    ["r1"],
  );
  assert.match(analytics.insight, /الضغط الأعلى/);
});

test("heatmap aggregates occupied rooms against authoritative room availability", () => {
  const summary = ["r1", "r2"].map((id) => ({
    room_id: id,
    room_code: id,
    room_name: id,
    room_type: "قاعة",
    room_category: "hall" as const,
    capacity: 20,
    used_hours: 2,
    available_hours: 8,
    free_hours: 6,
    overbooked_hours: 0,
    utilization_percent: 25,
    utilization: "25%",
    session_count: 1,
    average_students: 10,
    capacity_efficiency_percent: 50,
    max_students: 10,
    max_capacity_efficiency_percent: 50,
    peak_day: "الأحد",
    peak_slot: "08:00–10:00",
    theory_sessions: 1,
    applied_sessions: 0,
  }));
  const sessions = [
    session({ id: "a", room_id: "r1", day_of_week: 0 }),
    session({ id: "b", room_id: "r2", day_of_week: 0 }),
  ];
  const cells = buildRoomsHeatmap({
    summary,
    sessions,
    availability: [
      { room_id: "r1", day_of_week: 0, start_time: "08:00", end_time: "16:00" },
      { room_id: "r2", day_of_week: 0, start_time: "08:00", end_time: "10:00" },
    ],
    settings: { working_days: [0], day_start_time: "08:00", day_end_time: "14:00" },
  });
  assert.equal(cells.length, 3);
  assert.deepEqual(cells[0], {
    day: 0,
    dayLabel: "الأحد",
    slot: "08:00–10:00",
    occupiedRooms: 2,
    availableRooms: 2,
    utilizationPercent: 100,
  });
});

test("heatmap counts overlapping durations and empty open windows with seconds", () => {
  const summary = buildRoomsReportSummary({
    rooms: [{ id: "r1" }, { id: "r2" }],
    roomTypes: [],
    sessions: [],
    availability: [],
  });
  const cells = buildRoomsHeatmap({
    summary,
    sessions: [
      session({ id: "a", room_id: "r1", start_time: "08:00:00", end_time: "11:00:00" }),
      session({ id: "b", room_id: "r2", start_time: "09:00:00", end_time: "11:00:00" }),
    ],
    availability: [],
    settings: { working_days: [0], day_start_time: "08:00:00", day_end_time: "14:00:00" },
  });
  assert.equal(cells.find((c) => c.slot === "09:00–11:00")?.occupiedRooms, 2);
  assert.equal(cells.find((c) => c.slot === "08:00–09:00")?.availableRooms, 2);
  assert.equal(cells.find((c) => c.slot === "11:00–14:00")?.occupiedRooms, 0);
});

test("current timetable print exposes a program-dependent level filter", () => {
  const route = readFileSync(
    new URL("../src/routes/_authenticated/reports.current-timetable.tsx", import.meta.url),
    "utf8",
  );
  assert.match(route, /from\("academic_levels"\)/);
  assert.match(route, /select\("id,name,level_number,program_id"\)/);
  assert.match(route, /label="المستوى"/);
  assert.match(route, /current-print-level/);
  assert.match(route, /programId === "all"/);
  assert.match(route, /filterCurrentScheduleScope\([\s\S]*levelId/);
  assert.match(route, /setLevelId\("all"\)/);
});

test("current timetable course filter is term-scoped and searchable", () => {
  const route = readFileSync(
    new URL("../src/routes/_authenticated/reports.current-timetable.tsx", import.meta.url),
    "utf8",
  );
  assert.match(route, /queryKey:\s*\["current-timetable-scope",\s*ctx\.collegeId,\s*ctx\.termId\]/);
  assert.match(route, /from\("course_offerings"\)/);
  assert.match(route, /eq\("term_id", ctx\.termId!\)/);
  assert.match(route, /eq\("is_active", true\)/);
  assert.match(route, /from\("courses"\)/);
  assert.match(route, /\.in\("id", courseIds\)/);
  assert.match(route, /label="المادة — جميع أقسام الكلية"/);
  assert.match(route, /current-print-course-search/);
  assert.match(route, /اكتب اسم المادة أو رمزها/);
  assert.match(route, /normalizedMatchKey\(courseSearch\)/);
  assert.match(route, /جميع مواد الفصل المحدد/);
  assert.match(route, /setScopeTerm\(ctx\.termId\)/);
  assert.match(route, /filterCurrentScheduleScope\([\s\S]*courseId/);
  assert.match(route, /selectedCourse\.name/);
});

test("study-system selection reaches both report queries and their cache keys", () => {
  for (const routeName of ["rooms-report", "current-timetable"]) {
    const source = readFileSync(
      new URL(`../src/routes/_authenticated/reports.${routeName}.tsx`, import.meta.url),
      "utf8",
    );
    const studySystem = routeName === "rooms-report" ? "ctx.studySystem" : "effectiveStudySystem";
    assert.match(
      source,
      new RegExp(`queryKey:\\s*\\[[^\\]]*${studySystem.replace(".", "\\.")}`, "s"),
    );
    assert.match(source, new RegExp(`studySystem: ${studySystem.replace(".", "\\.")}`));
    if (routeName === "rooms-report") {
      assert.doesNotMatch(source, /studySystem: "all"/);
    } else {
      assert.match(source, /printScope === "college" \? "all" : ctx\.studySystem/);
      // Student reports must resolve member systems before applying the filter:
      // a merged anchor can belong to a different system than its participants.
      assert.match(
        source,
        /fetchStudentPrintMemberships\(hydrated,\s*ctx\.collegeId!,\s*ctx\.versionId!\)\s*\)\.filter/,
      );
      assert.match(source, /row\.study_system === effectiveStudySystem/);
      assert.match(source, /row\.study_system === "both"/);
    }
  }
});

test("used hours and room detail grouping preserve every version session", () => {
  const sessions = [
    session({ id: "a", room_id: "r1" }),
    session({ id: "b", room_id: "r1", start_time: "10:00", end_time: "13:00" }),
    session({ id: "c", room_id: "r2", start_time: "13:00", end_time: "14:00" }),
    session({ id: "d" }),
  ];
  const summary = buildRoomsReportSummary({
    rooms: [{ id: "r1" }, { id: "r2" }],
    roomTypes: [],
    sessions,
    availability: [],
    settings: { working_days: [0], day_start_time: "08:00", day_end_time: "16:00" },
  });
  assert.equal(
    summary.reduce((sum, row) => sum + row.used_hours, 0),
    6,
  );
  const pages = groupRoomsReportPages(sessions, "college");
  assert.equal(
    pages.reduce((sum, page) => sum + page.sessions.length, 0),
    sessions.length,
  );
});

test("rooms report exposes analytical screen and printable summary structures", () => {
  const route = readFileSync(
    new URL("../src/routes/_authenticated/reports.rooms-report.tsx", import.meta.url),
    "utf8",
  );
  const dashboard = readFileSync(
    new URL("../src/components/reports/rooms-analytics-dashboard.tsx", import.meta.url),
    "utf8",
  );
  assert.match(route, /RoomsAnalyticsDashboard/);
  assert.match(route, /rooms-print-chart/);
  assert.match(route, /printPageStyleCss\(\)/);
  assert.match(printPageStyleCss(), /size: A4 portrait !important;/);
  assert.match(route, /groupRoomsReportPages/);
  assert.match(dashboard, /rooms-report-charts/);
  assert.match(dashboard, /rooms-heatmap/);
  assert.match(dashboard, /استغلال الوقت منفصل عن كفاءة استغلال السعة/);
  assert.match(dashboard, /overflow-x-auto/);
});
