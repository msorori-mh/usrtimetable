import { describe, expect, it } from "vitest";
import { resolveTeachingAssignmentComponent } from "@/lib/excel-import/validators";

// Shared course CS111 exists in two programs' plans (different plan_course ids),
// and twice in one program across two levels.
const components = new Map<string, string>([
  ["pc-progA-l1|theory", "comp-progA-l1"],
  ["pc-progB-l1|theory", "comp-progB-l1"],
  ["pc-progA-l2|theory", "comp-progA-l2"],
]);

const deliveryGroups = new Map<string, string>([
  ["cohort-A1|comp-progA-l1|G1", "dg-A1"],
  ["cohort-B1|comp-progB-l1|G1", "dg-B1"],
  ["cohort-A2|comp-progA-l2|G1", "dg-A2"],
]);

describe("resolveTeachingAssignmentComponent", () => {
  it("matches the correct program's group for a course shared across programs", () => {
    const a = resolveTeachingAssignmentComponent({
      candidatePlanCourseIds: ["pc-progA-l1", "pc-progB-l1"],
      componentType: "theory",
      cohortId: "cohort-A1",
      deliveryGroupCode: "G1",
      components,
      deliveryGroups,
    });
    expect(a).toEqual({ componentId: "comp-progA-l1", deliveryGroupId: "dg-A1" });

    const b = resolveTeachingAssignmentComponent({
      candidatePlanCourseIds: ["pc-progA-l1", "pc-progB-l1"],
      componentType: "theory",
      cohortId: "cohort-B1",
      deliveryGroupCode: "G1",
      components,
      deliveryGroups,
    });
    expect(b).toEqual({ componentId: "comp-progB-l1", deliveryGroupId: "dg-B1" });
  });

  it("keeps two levels of the same program separate", () => {
    const l2 = resolveTeachingAssignmentComponent({
      candidatePlanCourseIds: ["pc-progA-l2"],
      componentType: "theory",
      cohortId: "cohort-A2",
      deliveryGroupCode: "G1",
      components,
      deliveryGroups,
    });
    expect(l2).toEqual({ componentId: "comp-progA-l2", deliveryGroupId: "dg-A2" });

    const wrongLevel = resolveTeachingAssignmentComponent({
      candidatePlanCourseIds: ["pc-progA-l1"],
      componentType: "theory",
      cohortId: "cohort-A2",
      deliveryGroupCode: "G1",
      components,
      deliveryGroups,
    });
    expect(wrongLevel.componentId).toBe("comp-progA-l1");
    expect(wrongLevel.deliveryGroupId).toBeNull();
  });

  it("still rejects a delivery group that does not exist", () => {
    const res = resolveTeachingAssignmentComponent({
      candidatePlanCourseIds: ["pc-progA-l1", "pc-progB-l1"],
      componentType: "theory",
      cohortId: "cohort-A1",
      deliveryGroupCode: "G9",
      components,
      deliveryGroups,
    });
    expect(res.componentId).toBe("comp-progA-l1");
    expect(res.deliveryGroupId).toBeNull();
  });

  it("still rejects a component that does not exist", () => {
    const res = resolveTeachingAssignmentComponent({
      candidatePlanCourseIds: ["pc-progA-l1", "pc-progB-l1"],
      componentType: "practical",
      cohortId: "cohort-A1",
      deliveryGroupCode: "G1",
      components,
      deliveryGroups,
    });
    expect(res).toEqual({ componentId: null, deliveryGroupId: null });
  });

  it("reports no component when the course is outside the cohort's program/level", () => {
    const res = resolveTeachingAssignmentComponent({
      candidatePlanCourseIds: [],
      componentType: "theory",
      cohortId: "cohort-A1",
      deliveryGroupCode: "G1",
      components,
      deliveryGroups,
    });
    expect(res).toEqual({ componentId: null, deliveryGroupId: null });
  });
});
