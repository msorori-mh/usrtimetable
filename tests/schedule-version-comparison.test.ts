import { describe, expect, test } from "bun:test";
import {
  assertSameCollegeVersions,
  compareScheduleVersions,
  type CompareSession,
} from "../src/lib/schedule-version-comparison";

const s = (over: Partial<CompareSession> & { id: string }): CompareSession => ({
  instructor_id: "i1",
  room_id: "r1",
  cohort_id: "c1",
  delivery_group_id: "d1",
  study_system: "regular",
  day_of_week: 0,
  start_time: "08:00",
  end_time: "10:00",
  course_offering_id: "co1",
  teaching_assignment_id: "ta1",
  college_id: "col-1",
  ...over,
});

describe("schedule version comparison", () => {
  test("identical versions = no changes", () => {
    const rows = [s({ id: "a" }), s({ id: "b", day_of_week: 1, delivery_group_id: "d2" })];
    const r = compareScheduleVersions({ versionA: rows, versionB: rows });
    expect(r.changes.length).toBe(0);
    expect(r.summary.unchanged).toBe(2);
  });

  test("detects time change", () => {
    const a = [s({ id: "a", start_time: "08:00", end_time: "10:00" })];
    const b = [s({ id: "b", start_time: "10:00", end_time: "12:00" })];
    const r = compareScheduleVersions({ versionA: a, versionB: b });
    expect(r.summary.time_changed).toBe(1);
  });

  test("detects room change", () => {
    const a = [s({ id: "a", room_id: "r1" })];
    const b = [s({ id: "b", room_id: "r2" })];
    const r = compareScheduleVersions({ versionA: a, versionB: b });
    expect(r.summary.room_changed).toBe(1);
  });

  test("detects added and removed", () => {
    const a = [s({ id: "a" }), s({ id: "x", delivery_group_id: "dx", day_of_week: 2 })];
    const b = [s({ id: "a2" }), s({ id: "y", delivery_group_id: "dy", day_of_week: 3 })];
    const r = compareScheduleVersions({ versionA: a, versionB: b });
    expect(r.summary.removed).toBeGreaterThanOrEqual(1);
    expect(r.summary.added).toBeGreaterThanOrEqual(1);
  });

  test("isolates regular/parallel keys", () => {
    const a = [s({ id: "a", study_system: "regular" })];
    const b = [s({ id: "b", study_system: "parallel" })];
    const r = compareScheduleVersions({ versionA: a, versionB: b });
    expect(r.summary.removed).toBe(1);
    expect(r.summary.added).toBe(1);
  });

  test("cross-college denied helper", () => {
    expect(assertSameCollegeVersions("c1", "c2", "c1")).toBe(false);
    expect(assertSameCollegeVersions("c1", "c1", "c1")).toBe(true);
  });

  test("filters foreign college sessions", () => {
    const a = [s({ id: "a", college_id: "col-1" })];
    const b = [
      s({ id: "a2", college_id: "col-1" }),
      s({ id: "x", college_id: "col-2", delivery_group_id: "other" }),
    ];
    const r = compareScheduleVersions({
      versionA: a,
      versionB: b,
      collegeId: "col-1",
    });
    expect(r.summary.sessions_b).toBe(1);
  });

  test("deterministic diff", () => {
    const a = [s({ id: "a" })];
    const b = [s({ id: "b", room_id: "r9" })];
    const r1 = compareScheduleVersions({ versionA: a, versionB: b });
    const r2 = compareScheduleVersions({ versionA: a, versionB: b });
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });
});
