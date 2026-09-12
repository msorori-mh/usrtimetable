/**
 * Cadence source-of-truth: a component of up to 3 weekly hours is always ONE
 * contiguous weekly session of exactly its assigned hours; legacy plan columns
 * (lectures_per_week / lecture_session_duration) must not slice it into 1h
 * sessions. Components above 3h keep the validated plan pattern (4h → 2×2h).
 */
import { describe, expect, test } from "bun:test";

import { requiredCadenceForComponent } from "../src/lib/auto-scheduler/session-plan";

// Legacy-style plan row: 5 lecture-like hours declared as 5 x 1h.
const legacyOneHourPlan = {
  lectures_per_week: 5,
  lecture_session_duration: 1,
  labs_per_week: 0,
  lab_session_duration: 0,
};

describe("component hours drive cadence for <= 3h components", () => {
  test("FR181: theory 3h is one 3h session, tutorial 2h is one 2h session", () => {
    const theory = requiredCadenceForComponent({
      componentType: "theory",
      assignedHours: 3,
      planCourse: legacyOneHourPlan,
    });
    const tutorial = requiredCadenceForComponent({
      componentType: "tutorial",
      assignedHours: 2,
      planCourse: legacyOneHourPlan,
    });
    expect(theory.durations).toEqual([3]);
    expect(theory.source).toBe("plan");
    expect(tutorial.durations).toEqual([2]);
    expect(tutorial.source).toBe("plan");
  });

  test("USR07 / CS111: theory 2h + weekly project 2h are two 2h sessions", () => {
    const plan = {
      lectures_per_week: 4,
      lecture_session_duration: 1,
      labs_per_week: 0,
      lab_session_duration: 0,
    };
    const theory = requiredCadenceForComponent({
      componentType: "theory",
      assignedHours: 2,
      planCourse: plan,
    });
    const project = requiredCadenceForComponent({
      componentType: "project",
      assignedHours: 2,
      planCourse: plan,
    });
    expect(theory.durations).toEqual([2]);
    expect(project.durations).toEqual([2]);
    expect(project.source).toBe("plan");
  });

  test("practical 2h stays one 2h session even with 2x1 lab pattern", () => {
    const cadence = requiredCadenceForComponent({
      componentType: "practical",
      assignedHours: 2,
      planCourse: {
        lectures_per_week: 0,
        lecture_session_duration: 0,
        labs_per_week: 2,
        lab_session_duration: 1,
      },
    });
    expect(cadence.durations).toEqual([2]);
  });

  test("theory 4h keeps the plan pattern of 2 x 2h", () => {
    const cadence = requiredCadenceForComponent({
      componentType: "theory",
      assignedHours: 4,
      planCourse: {
        lectures_per_week: 2,
        lecture_session_duration: 2,
        labs_per_week: 0,
        lab_session_duration: 0,
      },
    });
    expect(cadence.durations).toEqual([2, 2]);
    expect(cadence.source).toBe("plan");
  });

  test("1h component is one 1h session", () => {
    expect(
      requiredCadenceForComponent({
        componentType: "theory",
        assignedHours: 1,
        planCourse: legacyOneHourPlan,
      }).durations,
    ).toEqual([1]);
  });

  test("missing plan row is still blocked (fail-closed)", () => {
    const cadence = requiredCadenceForComponent({
      componentType: "theory",
      assignedHours: 2,
      planCourse: null,
    });
    expect(cadence.durations).toEqual([]);
    expect(cadence.source).toBe("blocked");
  });
});
