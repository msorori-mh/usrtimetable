import { describe, expect, test } from "bun:test";
import { buildSmartSuggestions } from "../src/lib/smart-suggestions";

describe("smart suggestions", () => {
  test("does not suggest when instructor missing", () => {
    const r = buildSmartSuggestions({
      unscheduled: [{ id: "u1", study_system: "regular", instructor_id: null }],
      existingSessions: [],
      rooms: [{ id: "r1", capacity: 40 }],
    });
    expect(r[0].alternatives.length).toBe(0);
    expect(r[0].auto_apply).toBe(false);
    expect(r[0].preview_only).toBe(true);
  });

  test("rejects conflicting slots and keeps non-conflicting", () => {
    const r = buildSmartSuggestions({
      unscheduled: [
        {
          id: "u1",
          study_system: "regular",
          instructor_id: "i1",
          expected_students: 20,
        },
      ],
      existingSessions: [
        {
          id: "s1",
          instructor_id: "i1",
          room_id: "r9",
          study_system: "regular",
          day_of_week: 0,
          start_time: "08:00",
          end_time: "10:00",
        },
      ],
      rooms: [
        { id: "r1", capacity: 40 },
        { id: "r2", capacity: 40 },
      ],
    });
    expect(r[0].alternatives.length).toBeGreaterThan(0);
    for (const a of r[0].alternatives) {
      const conflictSame =
        a.slot.day_of_week === 0 && a.slot.start_time === "08:00" && a.slot.instructor_id === "i1";
      expect(conflictSame).toBe(false);
    }
  });

  test("isolates regular/parallel", () => {
    const r = buildSmartSuggestions({
      unscheduled: [
        { id: "u1", study_system: "parallel", instructor_id: "i1", expected_students: 10 },
      ],
      existingSessions: [
        {
          id: "s1",
          instructor_id: "i1",
          room_id: "r1",
          study_system: "regular",
          day_of_week: 0,
          start_time: "08:00",
          end_time: "10:00",
        },
      ],
      rooms: [{ id: "r1", capacity: 40 }],
    });
    // parallel may reuse same wall-clock as regular
    expect(
      r[0].alternatives.some((a) => a.slot.day_of_week === 0 && a.slot.start_time === "08:00"),
    ).toBe(true);
  });

  test("capacity rejection recorded", () => {
    const r = buildSmartSuggestions({
      unscheduled: [
        { id: "u1", study_system: "regular", instructor_id: "i1", expected_students: 100 },
      ],
      existingSessions: [],
      rooms: [{ id: "tiny", capacity: 10 }],
    });
    expect(r[0].alternatives.length).toBe(0);
  });
});
