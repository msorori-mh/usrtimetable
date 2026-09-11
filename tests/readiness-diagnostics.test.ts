import { describe, expect, it } from "bun:test";
import { computeStudyPlanReadinessMetrics } from "@/lib/academic-delivery/study-plan-readiness";
import {
  analyzeRoomCapacities,
  roomCapacityReadinessMetrics,
} from "@/lib/reports/room-capacity-readiness";

const planCourse = (over: Record<string, unknown> = {}) => ({
  id: "pc1",
  course_id: "c1",
  lectures_per_week: 2,
  labs_per_week: 1,
  lecture_session_duration: 1,
  lab_session_duration: 2,
  ...over,
});

const component = (over: Record<string, unknown>) => ({
  plan_course_id: "pc1",
  component_type: "theory",
  weekly_hours: 1,
  is_timetabled: true,
  ...over,
});

describe("study plan weekly counter diagnostics", () => {
  it("treats theory + tutorial + weekly project as the lecture-hours source of truth", () => {
    const metrics = computeStudyPlanReadinessMetrics(
      [planCourse()],
      [
        component({ component_type: "theory", weekly_hours: 1 }),
        component({ component_type: "project", weekly_hours: 1 }),
        component({ component_type: "practical", weekly_hours: 2 }),
      ],
    );
    const mismatch = metrics.find((m) => m.label.includes("مزامنة"));
    expect(mismatch?.missing ?? 0).toBe(0);
  });

  it("still reports a real mismatch as a gap", () => {
    const metrics = computeStudyPlanReadinessMetrics(
      [planCourse({ lectures_per_week: 5 })],
      [component({ component_type: "theory", weekly_hours: 1 })],
    );
    const mismatch = metrics.find((m) => m.label.includes("مزامنة"));
    expect((mismatch?.missing ?? 0) > 0).toBe(true);
  });

  it("ignores summer training and non-timetabled components", () => {
    const metrics = computeStudyPlanReadinessMetrics(
      [planCourse({ lectures_per_week: 2, labs_per_week: 1 })],
      [
        component({ component_type: "theory", weekly_hours: 2 }),
        component({ component_type: "summer_training", weekly_hours: 40 }),
        component({ component_type: "project", weekly_hours: 8, is_timetabled: false }),
        component({ component_type: "practical", weekly_hours: 2 }),
      ],
    );
    const mismatch = metrics.find((m) => m.label.includes("مزامنة"));
    expect(mismatch?.missing ?? 0).toBe(0);
  });
});

describe("room capacity diagnostics", () => {
  const types = [
    { id: "hall", default_capacity: 75 },
    { id: "lab", default_capacity: 38 },
  ];
  const rooms = [
    { id: "r1", capacity: 75, room_type_id: "hall", is_active: true },
    { id: "r2", capacity: 75, room_type_id: "hall", is_active: true },
    { id: "r3", capacity: 38, room_type_id: "lab", is_active: true },
  ];

  it("marks uniform capacities equal to the type default as complete", () => {
    const metrics = roomCapacityReadinessMetrics(rooms, types);
    expect(metrics.every((m) => m.missing === 0)).toBe(true);
  });

  it("flags mixed active capacities for review", () => {
    const d = analyzeRoomCapacities(
      [...rooms, { id: "r4", capacity: 60, room_type_id: "hall", is_active: true }],
      types,
    );
    expect(d.mixedTypeIds).toEqual(["hall"]);
  });

  it("flags a default capacity that disagrees with the uniform active capacity", () => {
    const d = analyzeRoomCapacities(rooms, [
      { id: "hall", default_capacity: 60 },
      { id: "lab", default_capacity: 38 },
    ]);
    expect(d.defaultOutOfSyncTypeIds).toEqual(["hall"]);
  });

  it("treats invalid capacity and missing room type as blockers", () => {
    const metrics = roomCapacityReadinessMetrics(
      [{ id: "bad", capacity: 0, room_type_id: null, room_type: null }],
      types,
    );
    const critical = metrics.filter((m) => m.critical);
    expect(critical.every((m) => m.missing === 1)).toBe(true);
  });

  it("ignores inactive rooms when deriving uniform capacity", () => {
    const d = analyzeRoomCapacities(
      [...rooms, { id: "old", capacity: 10, room_type_id: "hall", is_active: false }],
      types,
    );
    expect(d.mixedTypeIds).toEqual([]);
    expect(d.roomsOffUniform).toEqual([]);
  });
});
