import { test } from "node:test";
import assert from "node:assert/strict";
import {
  countPagedSessions,
  groupCurrentSchedulePages,
} from "../src/lib/print-center/current-schedule";
import {
  buildRoomsReportSummary,
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
    session({ id: "a", room_id: "r1", rooms: { code: "A1", name: "قاعة 1" } }),
    session({
      id: "b",
      room_id: "r1",
      day_of_week: 2,
      start_time: "10:00",
      end_time: "13:00",
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
      { id: "t1", name_ar: "قاعة محاضرات" },
      { id: "t2", name_ar: "معمل حاسوب" },
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
  assert.equal(a1.room_type, "قاعة محاضرات");

  const totals = roomsReportTotals({ summary, sessions });
  assert.equal(totals.rooms, 2);
  assert.equal(totals.sessions, 3);
  assert.equal(totals.sessionsWithoutRoom, 1);

  const pages = groupRoomsReportPages(sessions, "college");
  assert.equal(pages.length, 2);
  assert.equal(
    pages.reduce((s, p) => s + p.sessions.length, 0),
    sessions.length,
  );
});
