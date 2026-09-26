import { describe, expect, test } from "bun:test";
import {
  analyzeScheduleQuality,
  assertNoLegacyContamination,
  type AnalyticsSession,
} from "../src/lib/schedule-quality-analytics";

const base = (over: Partial<AnalyticsSession> & { id: string }): AnalyticsSession => ({
  instructor_id: "inst-1",
  room_id: "room-1",
  cohort_id: "cohort-1",
  delivery_group_id: "dg-1",
  study_system: "regular",
  day_of_week: 0,
  start_time: "08:00",
  end_time: "10:00",
  expected_students: 30,
  college_id: "col-1",
  ...over,
});

describe("version student membership conflicts", () => {
  const pair = [
    base({ id: "a", delivery_group_id: "dg-a", course_offering_id: "course-a" }),
    base({
      id: "b",
      delivery_group_id: "dg-b",
      course_offering_id: "course-b",
      instructor_id: "inst-2",
      room_id: "room-2",
    }),
  ];

  test("separate partitions of one cohort can meet simultaneously", () => {
    const report = analyzeScheduleQuality({
      sessions: pair,
      studentMemberships: [
        { delivery_group_id: "dg-a", cohort_id: "cohort-1", partition_id: "p1" },
        { delivery_group_id: "dg-b", cohort_id: "cohort-1", partition_id: "p2" },
      ],
    });
    expect(report.hard_conflicts).toBe(0);
  });

  test("shared partition across delivery groups is a student conflict", () => {
    const report = analyzeScheduleQuality({
      sessions: pair,
      studentMemberships: [
        { delivery_group_id: "dg-a", cohort_id: "cohort-1", partition_id: "p1" },
        { delivery_group_id: "dg-b", cohort_id: "cohort-1", partition_id: "p1" },
      ],
    });
    expect(report.hard_conflicts).toBe(1);
  });

  test("missing membership retains the conservative cohort check", () => {
    expect(analyzeScheduleQuality({ sessions: pair, studentMemberships: [] }).hard_conflicts).toBe(
      1,
    );
  });

  test("different courses in the same room still conflict", () => {
    const report = analyzeScheduleQuality({
      sessions: [pair[0], { ...pair[1], instructor_id: "inst-1", room_id: "room-1" }],
      studentMemberships: [
        { delivery_group_id: "dg-a", cohort_id: "cohort-1", partition_id: "p1" },
        { delivery_group_id: "dg-b", cohort_id: "cohort-1", partition_id: "p2" },
      ],
    });
    expect(report.hard_conflicts).toBe(1);
  });
});

describe("schedule quality analytics", () => {
  test("full clean schedule scores ACCEPTABLE with zero hard conflicts", () => {
    const sessions = [
      base({ id: "a", start_time: "08:00", end_time: "10:00", day_of_week: 0 }),
      base({
        id: "b",
        start_time: "10:00",
        end_time: "12:00",
        day_of_week: 1,
        instructor_id: "inst-2",
        room_id: "room-2",
      }),
    ];
    const r = analyzeScheduleQuality({ sessions, collegeId: "col-1" });
    expect(r.hard_conflicts).toBe(0);
    expect(r.session_count).toBe(2);
    expect(r.classification === "ACCEPTABLE" || r.classification === "MINOR").toBe(true);
    expect(r.total_score).toBeGreaterThanOrEqual(70);
  });

  test("detects instructor hard conflict within same study system", () => {
    const sessions = [
      base({ id: "a", start_time: "08:00", end_time: "10:00" }),
      base({ id: "b", start_time: "09:00", end_time: "11:00", room_id: "room-2" }),
    ];
    const r = analyzeScheduleQuality({ sessions });
    expect(r.hard_conflicts).toBe(1);
    expect(r.classification).toBe("CRITICAL");
    expect(r.findings.some((f) => f.code === "hard_conflict" && f.formula.length > 0)).toBe(true);
  });

  test("isolates regular from parallel (no cross-system conflict)", () => {
    const sessions = [
      base({ id: "a", study_system: "regular", start_time: "08:00", end_time: "10:00" }),
      base({
        id: "b",
        study_system: "parallel",
        start_time: "08:00",
        end_time: "10:00",
        room_id: "room-9",
      }),
    ];
    const r = analyzeScheduleQuality({ sessions });
    expect(r.hard_conflicts).toBe(0);
  });

  test("isolates academic terms", () => {
    const sessions = [
      base({
        id: "a",
        academic_term_id: "t1",
        start_time: "08:00",
        end_time: "10:00",
      }),
      base({
        id: "b",
        academic_term_id: "t2",
        start_time: "08:00",
        end_time: "10:00",
        room_id: "room-2",
      }),
    ];
    const r = analyzeScheduleQuality({ sessions });
    expect(r.hard_conflicts).toBe(0);
  });

  test("counts unscheduled required work items", () => {
    const sessions = [base({ id: "a", delivery_group_id: "dg-1" })];
    const r = analyzeScheduleQuality({
      sessions,
      required: [
        { id: "w1", study_system: "regular", delivery_group_id: "dg-1" },
        { id: "w2", study_system: "regular", delivery_group_id: "dg-missing" },
      ],
    });
    expect(r.unscheduled_count).toBe(1);
    expect(r.findings.some((f) => f.code === "unscheduled")).toBe(true);
  });

  test("detects excessive daily load and instructor gaps", () => {
    const sessions = [
      base({ id: "a", start_time: "08:00", end_time: "10:00", day_of_week: 0 }),
      base({ id: "b", start_time: "12:00", end_time: "14:00", day_of_week: 0, room_id: "room-2" }),
      base({ id: "c", start_time: "15:00", end_time: "17:00", day_of_week: 0, room_id: "room-3" }),
      base({ id: "d", start_time: "17:00", end_time: "19:00", day_of_week: 0, room_id: "room-4" }),
    ];
    const r = analyzeScheduleQuality({ sessions });
    expect(r.excessive_daily_load).toBeGreaterThanOrEqual(1);
    expect(r.instructor_gaps).toBeGreaterThanOrEqual(1);
  });

  test("detects room overuse", () => {
    const sessions: AnalyticsSession[] = [];
    for (let i = 0; i < 12; i++) {
      sessions.push(
        base({
          id: `s${i}`,
          day_of_week: i % 5,
          start_time: "08:00",
          end_time: "12:00",
          instructor_id: `inst-${i}`,
          room_id: "room-busy",
        }),
      );
    }
    const r = analyzeScheduleQuality({ sessions, weeklyRoomCapacityHours: 40 });
    expect(r.room_overuse).toBe(1);
  });

  test("capacity violation when expected_students exceeds room capacity", () => {
    const r = analyzeScheduleQuality({
      sessions: [base({ id: "a", expected_students: 80 })],
      rooms: [{ id: "room-1", capacity: 40 }],
    });
    expect(r.capacity_violations).toBe(1);
    expect(r.classification).toBe("CRITICAL");
  });

  test("score is deterministic for identical input", () => {
    const sessions = [
      base({ id: "a" }),
      base({ id: "b", day_of_week: 2, instructor_id: "inst-2", room_id: "room-2" }),
    ];
    const a = analyzeScheduleQuality({ sessions });
    const b = analyzeScheduleQuality({ sessions });
    expect(a.total_score).toBe(b.total_score);
    expect(a.findings.map((f) => f.code).join(",")).toBe(b.findings.map((f) => f.code).join(","));
  });

  test("baseline delta compares scores", () => {
    const sessions = [base({ id: "a" })];
    const r = analyzeScheduleQuality({
      sessions,
      baseline: { total_score: 90, hard_conflicts: 0, unscheduled_count: 0 },
    });
    expect(r.baseline_delta).not.toBeNull();
    expect(typeof r.baseline_delta!.score_delta).toBe("number");
  });

  test("cross-college sessions are filtered out", () => {
    const sessions = [
      base({ id: "a", college_id: "col-1" }),
      base({ id: "b", college_id: "col-2", instructor_id: "inst-x", room_id: "room-x" }),
    ];
    const r = analyzeScheduleQuality({ sessions, collegeId: "col-1" });
    expect(r.session_count).toBe(1);
  });

  test("legacy contamination helper", () => {
    expect(
      assertNoLegacyContamination([base({ id: "a", delivery_group_id: "dg-1", cohort_id: "c1" })]),
    ).toBe(true);
  });

  test("54-session fixture remains stable shape", () => {
    const sessions = Array.from({ length: 54 }, (_, i) =>
      base({
        id: `s${String(i).padStart(2, "0")}`,
        day_of_week: i % 5,
        start_time: `${8 + (i % 4)}:00`,
        end_time: `${10 + (i % 4)}:00`,
        instructor_id: `inst-${i % 10}`,
        room_id: `room-${i % 8}`,
        cohort_id: `cohort-${i % 6}`,
        delivery_group_id: `dg-${i}`,
      }),
    );
    const r1 = analyzeScheduleQuality({ sessions, collegeId: "col-1" });
    const r2 = analyzeScheduleQuality({ sessions, collegeId: "col-1" });
    expect(r1.session_count).toBe(54);
    expect(r1.total_score).toBe(r2.total_score);
    expect(r1.hard_conflicts).toBe(r2.hard_conflicts);
  });
});
