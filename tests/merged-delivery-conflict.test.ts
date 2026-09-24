import { describe, expect, test } from "bun:test";
import { isSameDeliveryEntry } from "../src/lib/scheduling/merged-delivery";
import { analyzeScheduleQuality } from "../src/lib/schedule-quality-analytics";
import type { AnalyticsSession } from "../src/lib/schedule-quality-analytics/types";

const base = (over: Partial<AnalyticsSession> & { id: string }): AnalyticsSession => ({
  instructor_id: "inst-1",
  room_id: "room-1",
  cohort_id: "cohort-1",
  delivery_group_id: "dg-1",
  course_offering_id: "off-1",
  study_system: "regular",
  day_of_week: 0,
  start_time: "08:00",
  end_time: "10:00",
  college_id: "col-1",
  ...over,
});

describe("merged delivery does not conflict with itself", () => {
  test("one lecture serving several merged groups is one delivery", () => {
    const a = base({ id: "a", delivery_group_id: "dg-1" });
    const b = base({ id: "b", delivery_group_id: "dg-2" });
    expect(isSameDeliveryEntry(a, b)).toBe(true);
    const r = analyzeScheduleQuality({ sessions: [a, b], collegeId: "col-1" });
    expect(r.hard_conflicts).toBe(0);
  });

  test("two different overlapping deliveries for the same students stay hard", () => {
    const a = base({ id: "a", delivery_group_id: "dg-1", course_offering_id: "off-1" });
    const b = base({
      id: "b",
      delivery_group_id: "dg-2",
      course_offering_id: "off-2",
      room_id: "room-2",
      instructor_id: "inst-2",
      start_time: "09:00",
      end_time: "11:00",
    });
    expect(isSameDeliveryEntry(a, b)).toBe(false);
    const r = analyzeScheduleQuality({ sessions: [a, b], collegeId: "col-1" });
    expect(r.hard_conflicts).toBe(1);
  });

  test("same room and time but different courses is not a merged delivery", () => {
    expect(
      isSameDeliveryEntry(
        base({ id: "a", course_offering_id: "off-1" }),
        base({ id: "b", course_offering_id: "off-2" }),
      ),
    ).toBe(false);
  });

  test("different time windows are never one delivery", () => {
    expect(
      isSameDeliveryEntry(
        base({ id: "a", start_time: "08:00", end_time: "10:00" }),
        base({ id: "b", start_time: "09:00", end_time: "11:00" }),
      ),
    ).toBe(false);
  });

  test("missing room or instructor is never treated as one delivery", () => {
    expect(
      isSameDeliveryEntry(base({ id: "a", room_id: null }), base({ id: "b", room_id: null })),
    ).toBe(false);
    expect(
      isSameDeliveryEntry(
        base({ id: "a", instructor_id: null }),
        base({ id: "b", instructor_id: null }),
      ),
    ).toBe(false);
  });

  test("same session id is always one delivery", () => {
    expect(isSameDeliveryEntry({ id: "x" }, { id: "x" })).toBe(true);
  });
});
