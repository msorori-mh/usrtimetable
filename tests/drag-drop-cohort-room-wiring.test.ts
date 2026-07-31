import { describe, expect, test } from "bun:test";
import {
  buildEvaluateDropTargetInput,
  conflictIdentityForSession,
  evaluateDropTarget,
  resolveDropRoomConstraints,
  toOccupancySession,
} from "../src/lib/schedule-builder/drag-drop-safety";

const sourceSlot = {
  day_of_week: 0,
  start_time: "08:00",
  end_time: "10:00",
  room_id: "r-hall",
};

const baseMoving = {
  id: "s1",
  instructor_id: "i1",
  room_id: "r-hall",
  cohort_id: "cohort-A",
  section_id: "sec-1",
  study_system: "regular",
  day_of_week: 0,
  start_time: "08:00",
  end_time: "10:00",
  session_type: "lecture",
  enrollment_count: 40,
  subgroup_expected_students: null as number | null,
  is_locked: false,
};

const lectureHall = { id: "r-hall", room_type: "lecture_hall", capacity: 60 };
const computerLab = { id: "r-lab", room_type: "computer_lab", capacity: 30 };
const smallHall = { id: "r-small", room_type: "lecture_hall", capacity: 20 };

describe("drop preview cohort + room wiring", () => {
  test("cohort_id is not forced null when session is cohort-linked", () => {
    const occ = toOccupancySession(baseMoving);
    expect(occ.cohort_id).toBe("cohort-A");
    expect(conflictIdentityForSession(baseMoving)).toBe("cohort-A");

    const input = buildEvaluateDropTargetInput({
      sourceSlot,
      movingSession: baseMoving,
      day_of_week: 2,
      start_time: "10:00",
      others: [],
      rooms: [lectureHall],
    });
    expect(input.movingSession.cohort_id).toBe("cohort-A");
    expect(input.movingSession.cohort_id).not.toBeNull();
  });

  test("cohort conflict marks slot forbidden with reason", () => {
    const r = evaluateDropTarget(
      buildEvaluateDropTargetInput({
        sourceSlot,
        movingSession: baseMoving,
        day_of_week: 1,
        start_time: "08:00",
        others: [
          {
            id: "s2",
            instructor_id: "i9",
            room_id: "r-other",
            cohort_id: "cohort-A",
            study_system: "regular",
            day_of_week: 1,
            start_time: "08:00",
            end_time: "10:00",
            session_type: "lecture",
          },
        ],
        rooms: [lectureHall],
      }),
    );
    expect(r.kind).toBe("forbidden");
    expect(r.tone).toBe("red");
    expect(r.reason_ar).toContain("دفعة");
    expect(r.proposed).toBeNull();
  });

  test("incompatible room type blocks drop with reason", () => {
    const r = evaluateDropTarget(
      buildEvaluateDropTargetInput({
        sourceSlot: { ...sourceSlot, room_id: computerLab.id },
        movingSession: { ...baseMoving, room_id: computerLab.id, session_type: "lecture" },
        day_of_week: 2,
        start_time: "10:00",
        others: [],
        rooms: [computerLab],
      }),
    );
    expect(r.kind).toBe("forbidden");
    expect(r.reason_ar).toContain("نوع القاعة");
    expect(r.proposed).toBeNull();
  });

  test("insufficient room capacity blocks drop with reason", () => {
    const r = evaluateDropTarget(
      buildEvaluateDropTargetInput({
        sourceSlot: { ...sourceSlot, room_id: smallHall.id },
        movingSession: {
          ...baseMoving,
          room_id: smallHall.id,
          enrollment_count: 45,
        },
        day_of_week: 2,
        start_time: "10:00",
        others: [],
        rooms: [smallHall],
      }),
    );
    expect(r.kind).toBe("forbidden");
    expect(r.reason_ar).toContain("سعة");
    expect(r.proposed).toBeNull();
  });

  test("compatible room yields valid green preview with wired constraints", () => {
    const input = buildEvaluateDropTargetInput({
      sourceSlot,
      movingSession: baseMoving,
      day_of_week: 2,
      start_time: "10:00",
      others: [],
      rooms: [lectureHall],
    });
    expect(input.roomTypeOk).toBe(true);
    expect(input.roomCapacity).toBe(60);
    expect(input.expectedStudents).toBe(40);

    const r = evaluateDropTarget(input);
    expect(r.kind).toBe("valid");
    expect(r.tone).toBe("green");
    expect(r.proposed?.room_id).toBe("r-hall");
    expect(r.proposed?.start_time).toBe("10:00");
  });

  test("invalid preview has null proposed (no pending / no DB write path)", () => {
    const r = evaluateDropTarget(
      buildEvaluateDropTargetInput({
        sourceSlot,
        movingSession: baseMoving,
        day_of_week: 1,
        start_time: "08:00",
        others: [
          {
            id: "s2",
            instructor_id: "i9",
            room_id: "r-other",
            cohort_id: "cohort-A",
            study_system: "regular",
            day_of_week: 1,
            start_time: "08:00",
            end_time: "10:00",
          },
        ],
        rooms: [lectureHall],
      }),
    );
    expect(r.kind).toBe("forbidden");
    expect(r.proposed).toBeNull();
  });

  test("instructor conflict still blocks (regression)", () => {
    const r = evaluateDropTarget(
      buildEvaluateDropTargetInput({
        sourceSlot,
        movingSession: baseMoving,
        day_of_week: 1,
        start_time: "08:00",
        others: [
          {
            id: "s2",
            instructor_id: "i1",
            room_id: "r-other",
            cohort_id: "cohort-B",
            study_system: "regular",
            day_of_week: 1,
            start_time: "08:00",
            end_time: "10:00",
          },
        ],
        rooms: [lectureHall],
      }),
    );
    expect(r.kind).toBe("forbidden");
    expect(r.reason_ar).toContain("مدرس");
  });

  test("resolveDropRoomConstraints exposes room id/type/capacity", () => {
    const c = resolveDropRoomConstraints({
      targetRoom: lectureHall,
      sessionType: "lecture",
      expectedStudents: 40,
    });
    expect(c.roomId).toBe("r-hall");
    expect(c.roomType).toBe("lecture_hall");
    expect(c.roomCapacity).toBe(60);
    expect(c.requiredRoomType).toBe("lecture_hall");
    expect(c.roomTypeOk).toBe(true);
  });
});
