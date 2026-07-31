import { describe, expect, test } from "bun:test";
import {
  evaluateDropTarget,
  isProtectedDemoVersion,
  popUndo,
  publishedVersionConfirmMessage,
  pushUndo,
  PROTECTED_DEMO_VERSION_ID,
} from "../src/lib/schedule-builder/drag-drop-safety";
import type { PendingScheduleSessionChange } from "../src/lib/schedule-builder/pending-change";

const moving = {
  id: "s1",
  instructor_id: "i1",
  room_id: "r1",
  study_system: "regular",
  day_of_week: 0,
  start_time: "08:00",
  end_time: "10:00",
};

describe("drag-drop safety", () => {
  test("marks conflicting instructor slot forbidden", () => {
    const r = evaluateDropTarget({
      sourceSlot: {
        day_of_week: 0,
        start_time: "08:00",
        end_time: "10:00",
        room_id: "r1",
      },
      movingSession: moving,
      day_of_week: 1,
      start_time: "08:00",
      others: [
        {
          id: "s2",
          instructor_id: "i1",
          room_id: "r9",
          study_system: "regular",
          day_of_week: 1,
          start_time: "08:00",
          end_time: "10:00",
        },
      ],
    });
    expect(r.kind).toBe("forbidden");
    expect(r.tone).toBe("red");
    expect(r.reason_ar).toContain("مدرس");
  });

  test("marks free slot valid green", () => {
    const r = evaluateDropTarget({
      sourceSlot: {
        day_of_week: 0,
        start_time: "08:00",
        end_time: "10:00",
        room_id: "r1",
      },
      movingSession: moving,
      day_of_week: 2,
      start_time: "10:00",
      others: [],
    });
    expect(r.kind).toBe("valid");
    expect(r.tone).toBe("green");
    expect(r.proposed?.start_time).toBe("10:00");
  });

  test("protects demo version id", () => {
    expect(isProtectedDemoVersion(PROTECTED_DEMO_VERSION_ID)).toBe(true);
    expect(isProtectedDemoVersion("other")).toBe(false);
  });

  test("published confirm message", () => {
    expect(publishedVersionConfirmMessage("published")).toContain("منشورة");
    expect(publishedVersionConfirmMessage("draft")).toBeNull();
  });

  test("undo stack push/pop", () => {
    const item = {
      sessionId: "s1",
      expectedUpdatedAt: null,
      original: { day_of_week: 0, start_time: "08:00", end_time: "10:00", room_id: "r1" },
      proposed: { day_of_week: 1, start_time: "08:00", end_time: "10:00", room_id: "r1" },
      changeReason: "",
    } satisfies PendingScheduleSessionChange;
    const stack = pushUndo([], item);
    const popped = popUndo(stack);
    expect(popped.item?.sessionId).toBe("s1");
    expect(popped.stack.length).toBe(0);
  });
});
