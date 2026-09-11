/**
 * Weekly regular project components (counts_toward_regular_load = true) are ordinary
 * timetabled classroom work; graduation-project supervision stays non-weekly.
 */
import { describe, expect, it } from "bun:test";
import { calculateDeliveryGroupCount } from "@/lib/academic-delivery/delivery-groups";
import { computeInstructorWorkload, hoursForAssignment } from "@/lib/academic-delivery/workload";
import { requiredCadenceForComponent } from "@/lib/auto-scheduler/session-plan";

describe("weekly project component", () => {
  it("uses room capacity and no explicit group size", () => {
    const r = calculateDeliveryGroupCount({
      componentType: "project",
      studentCount: 120,
      weeklyContactHours: 2,
      countsTowardRegularLoad: true,
      roomTypeCapacity: { defaultCapacity: 60 },
    });
    expect(r.ok).toBe(true);
    if (r.ok && !("skipped" in r && r.skipped)) {
      expect(r.groupCount).toBe(2);
      expect(r.capacityUsed).toBe(60);
      expect(r.excludedFromStandardWorkload).toBe(false);
    }
  });

  it("keeps supervision semantics for graduation projects", () => {
    const r = calculateDeliveryGroupCount({
      componentType: "project",
      studentCount: 120,
      weeklyContactHours: 2,
      countsTowardRegularLoad: false,
      roomTypeCapacity: { defaultCapacity: 60 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("MISSING_PROJECT_GROUP_SIZE");
  });

  it("counts weekly project hours as regular teaching load", () => {
    const h = hoursForAssignment({
      deliveryGroupId: "g1",
      componentType: "project",
      weeklyContactHours: 2,
      assignedWeeklyHours: null,
      countsTowardRegularLoad: true,
      coInstructorCount: 0,
    });
    expect(h).toEqual({ standard: 2, project: 0 });

    const supervision = hoursForAssignment({
      deliveryGroupId: "g2",
      componentType: "project",
      weeklyContactHours: 2,
      assignedWeeklyHours: null,
      countsTowardRegularLoad: false,
      coInstructorCount: 0,
    });
    expect(supervision).toEqual({ standard: 0, project: 2 });
  });

  it("aggregates 2h theory + 2h weekly project as 4 regular hours", () => {
    const w = computeInstructorWorkload({
      academicRank: "assistant_professor",
      assignments: [
        {
          deliveryGroupId: "t",
          componentType: "theory",
          weeklyContactHours: 2,
          assignedWeeklyHours: null,
          countsTowardRegularLoad: true,
          coInstructorCount: 0,
        },
        {
          deliveryGroupId: "p",
          componentType: "project",
          weeklyContactHours: 2,
          assignedWeeklyHours: null,
          countsTowardRegularLoad: true,
          coInstructorCount: 0,
        },
      ],
    });
    expect(w.standardAssignedHours).toBe(4);
    expect(w.projectSupervisionHours).toBe(0);
  });

  it("derives one 2h session per component from a shared 2x2 lecture pattern", () => {
    const plan = {
      lectures_per_week: 2,
      lecture_session_duration: 2,
      labs_per_week: 0,
      lab_session_duration: 2,
    };
    expect(
      requiredCadenceForComponent({ componentType: "theory", assignedHours: 2, planCourse: plan }),
    ).toEqual({ durations: [2], source: "plan", noteAr: null });
    expect(
      requiredCadenceForComponent({ componentType: "project", assignedHours: 2, planCourse: plan }),
    ).toEqual({ durations: [2], source: "plan", noteAr: null });
    expect(
      requiredCadenceForComponent({ componentType: "theory", assignedHours: 4, planCourse: plan }),
    ).toEqual({ durations: [2, 2], source: "plan", noteAr: null });
  });

  it("still blocks hours that do not fit the plan session duration", () => {
    const r = requiredCadenceForComponent({
      componentType: "project",
      assignedHours: 3,
      planCourse: {
        lectures_per_week: 2,
        lecture_session_duration: 2,
        labs_per_week: 0,
        lab_session_duration: 2,
      },
    });
    expect(r.source).toBe("blocked");
    expect(r.durations).toEqual([]);
  });
});
