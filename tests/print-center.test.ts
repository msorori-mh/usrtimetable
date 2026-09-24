import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PRINT_DEMO_FOOTER_WARNING_AR,
  buildExportRows,
  buildPrintQrUrl,
  filterPrintSessions,
  groupPrintPages,
  preparePrintSessions,
  rejectMismatchedCollege,
  studentFiltersComplete,
  type PrintCenterFilters,
  type PrintSessionLike,
} from "../src/lib/print-center/index.ts";
import { isDeliveryDemoVersion } from "../src/lib/schedule-versions/delivery-demo.ts";

function makeSession(overrides: Partial<PrintSessionLike> & { id: string }): PrintSessionLike {
  return {
    day_of_week: 0,
    start_time: "08:00:00",
    end_time: "10:00:00",
    session_type: "lecture",
    study_system: "regular",
    college_id: "college-a",
    instructor_id: "ins-1",
    room_id: "room-1",
    cohort_id: "cohort-1",
    delivery_group_id: "dg-1",
    course_offerings: {
      program_id: "prog-1",
      level_id: "lvl-1",
      courses: {
        code: "CS101",
        name: "مقدمة",
        department_id: "dept-1",
        departments: { name: "علوم الحاسوب" },
      },
      academic_programs: { name: "تقنية معلومات" },
      academic_levels: { name: "المستوى 1", level_number: 1 },
    },
    instructors: { full_name: "د. أحمد" },
    rooms: { code: "A1", name: "قاعة 1" },
    ...overrides,
  };
}

function baseFilters(partial: Partial<PrintCenterFilters> = {}): PrintCenterFilters {
  return {
    reportType: "student",
    collegeId: "college-a",
    programId: "prog-1",
    levelId: "lvl-1",
    studySystem: "regular",
    ...partial,
  };
}

describe("print-center filters", () => {
  it("filters student by program + level + study system", () => {
    const sessions = [
      makeSession({ id: "1", study_system: "regular" }),
      makeSession({
        id: "2",
        study_system: "parallel",
        course_offerings: {
          program_id: "prog-1",
          level_id: "lvl-1",
          courses: { code: "CS102", name: "ب", department_id: "dept-1" },
        },
      }),
      makeSession({
        id: "3",
        course_offerings: {
          program_id: "prog-2",
          level_id: "lvl-1",
          courses: { code: "CS103", name: "ج", department_id: "dept-1" },
        },
      }),
    ];
    const out = filterPrintSessions(sessions, baseFilters());
    assert.deepEqual(
      out.map((s) => s.id),
      ["1"],
    );
  });

  it("filters department / program / instructor / room", () => {
    const sessions = [
      makeSession({ id: "d1" }),
      makeSession({
        id: "d2",
        course_offerings: {
          program_id: "prog-1",
          level_id: "lvl-1",
          courses: {
            code: "X",
            name: "Y",
            department_id: "dept-2",
            departments: { name: "أخرى" },
          },
        },
      }),
      makeSession({ id: "i2", instructor_id: "ins-2" }),
      makeSession({ id: "r2", room_id: "room-2" }),
    ];

    assert.deepEqual(
      filterPrintSessions(sessions, {
        reportType: "department",
        collegeId: "college-a",
        departmentId: "dept-1",
        studySystem: "all",
      }).map((s) => s.id),
      ["d1", "i2", "r2"],
    );

    assert.deepEqual(
      filterPrintSessions(sessions, {
        reportType: "program",
        collegeId: "college-a",
        programId: "prog-1",
        studySystem: "all",
      }).map((s) => s.id),
      ["d1", "d2", "i2", "r2"],
    );

    assert.deepEqual(
      filterPrintSessions(sessions, {
        reportType: "instructor",
        collegeId: "college-a",
        instructorId: "ins-1",
        studySystem: "all",
      }).map((s) => s.id),
      ["d1", "d2", "r2"],
    );

    assert.deepEqual(
      filterPrintSessions(sessions, {
        reportType: "room",
        collegeId: "college-a",
        roomId: "room-1",
        studySystem: "all",
      }).map((s) => s.id),
      ["d1", "d2", "i2"],
    );
  });

  it("ignores leftover programId/levelId/departmentId on instructor reports", () => {
    const sessions = [
      makeSession({ id: "1" }),
      makeSession({
        id: "2",
        course_offerings: {
          program_id: "prog-OTHER",
          level_id: "lvl-OTHER",
          courses: { code: "Z", name: "Z", department_id: "dept-OTHER" },
        },
      }),
    ];
    const out = filterPrintSessions(sessions, {
      reportType: "instructor",
      collegeId: "college-a",
      programId: "prog-1",
      levelId: "lvl-1",
      departmentId: "dept-1",
      studySystem: "all",
    });
    assert.deepEqual(out.map((s) => s.id).sort(), ["1", "2"]);
  });

  it("separates regular and parallel in program grouping", () => {
    const sessions = [
      makeSession({ id: "r", study_system: "regular", day_of_week: 0 }),
      makeSession({ id: "p", study_system: "parallel", day_of_week: 1 }),
      makeSession({ id: "b", study_system: "both", day_of_week: 2 }),
    ];
    const filtered = filterPrintSessions(sessions, {
      reportType: "program",
      collegeId: "college-a",
      programId: "prog-1",
      studySystem: "all",
    });
    const pages = groupPrintPages(filtered, {
      reportType: "program",
      collegeId: "college-a",
      programId: "prog-1",
      studySystem: "all",
    });
    assert.equal(
      pages.every((page) => page.levelName === "الأول"),
      true,
    );
    assert.equal(
      pages.every((page) => !page.title.includes("المستوى")),
      true,
    );
    const keys = pages.map((p) => p.key).sort();
    assert.ok(keys.some((k) => k.includes("sys:regular")));
    assert.ok(keys.some((k) => k.includes("sys:parallel")));
    const regularIds = pages.find((p) => p.key.includes("sys:regular"))!.sessions.map((s) => s.id);
    const parallelIds = pages
      .find((p) => p.key.includes("sys:parallel"))!
      .sessions.map((s) => s.id);
    assert.ok(regularIds.includes("r") && regularIds.includes("b"));
    assert.ok(parallelIds.includes("p") && parallelIds.includes("b"));
    assert.ok(!regularIds.includes("p"));
    assert.ok(!parallelIds.includes("r"));
  });

  it("keeps all 54 sessions without drop or dup when no filters", () => {
    const sessions = Array.from({ length: 54 }, (_, i) =>
      makeSession({
        id: `s-${i}`,
        day_of_week: i % 5,
        start_time: `${String(8 + (i % 8)).padStart(2, "0")}:00:00`,
        course_offerings: {
          program_id: "prog-1",
          level_id: `lvl-${i % 4}`,
          courses: {
            code: `C${i}`,
            name: `Course ${i}`,
            department_id: "dept-1",
          },
        },
      }),
    );
    // intentional duplicate id to prove dedupe
    sessions.push(makeSession({ id: "s-0", day_of_week: 0 }));
    const prepared = preparePrintSessions(sessions, "college-a");
    assert.equal(prepared.length, 54);
    const ids = new Set(prepared.map((s) => s.id));
    assert.equal(ids.size, 54);
  });

  it("rejects mismatched college_id (cross-college)", () => {
    const sessions = [
      makeSession({ id: "a", college_id: "college-a" }),
      makeSession({ id: "b", college_id: "college-b" }),
    ];
    const rejected = rejectMismatchedCollege(sessions, "college-a");
    assert.deepEqual(
      rejected.map((s) => s.id),
      ["a"],
    );
    const filtered = filterPrintSessions(sessions, baseFilters({ studySystem: "regular" }));
    assert.deepEqual(
      filtered.map((s) => s.id),
      ["a"],
    );
  });

  it("export row count matches filtered sessions for student report", () => {
    const sessions = [
      makeSession({ id: "1" }),
      makeSession({ id: "2", study_system: "parallel" }),
      makeSession({
        id: "3",
        course_offerings: {
          program_id: "prog-1",
          level_id: "lvl-2",
          courses: { code: "Z", name: "Z", department_id: "dept-1" },
        },
      }),
    ];
    const filters = baseFilters();
    const filtered = filterPrintSessions(sessions, filters);
    const pages = groupPrintPages(filtered, filters);
    const rows = buildExportRows(pages);
    assert.equal(rows[0]?.course_name, "مقدمة");
    assert.equal(rows[0]?.course_code, "");
    assert.equal(rows[0]?.room, "قاعة 1");
    assert.equal(rows[0]?.level, "الأول");
    assert.ok(!JSON.stringify(rows[0]).includes("CS101"));
    assert.ok(!JSON.stringify(rows[0]).includes("A1"));
    assert.equal(filtered.length, 1);
    assert.equal(rows.length, filtered.length);
  });

  it("requires student filters and exposes demo warning text", () => {
    assert.equal(
      studentFiltersComplete({
        reportType: "student",
        collegeId: "c",
        programId: null,
        levelId: "l",
        studySystem: "regular",
      }),
      false,
    );
    assert.ok(
      isDeliveryDemoVersion({ name: "نسخة التسليم التجريبية النهائية", notes: "DELIVERY_DEMO" }),
    );
    assert.match(PRINT_DEMO_FOOTER_WARNING_AR, /نسخة تسليم تجريبية/);
    assert.match(PRINT_DEMO_FOOTER_WARNING_AR, /بيانات افتراضية/);
    assert.match(PRINT_DEMO_FOOTER_WARNING_AR, /غير صالحة للاستخدام الأكاديمي التشغيلي/);
  });

  it("QR URL includes versionId and filter params", () => {
    const url = buildPrintQrUrl("https://example.com", {
      versionId: "ver-54",
      reportType: "student",
      programId: "prog-1",
      levelId: "lvl-1",
      studySystem: "regular",
    });
    assert.match(url, /\/timetable\/ver-54\/print/);
    assert.match(url, /type=student/);
    assert.match(url, /program=prog-1/);
    assert.match(url, /level=lvl-1/);
    assert.match(url, /study=regular/);
    assert.doesNotMatch(url, /paper=/);
    assert.doesNotMatch(url, /orient=/);
  });
});
