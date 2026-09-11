/**
 * Phase 9.3 — pure standard-workload calculation (fixtures/harness).
 * Mirrors compute_instructor_standard_workload SQL semantics.
 *
 * Co-teaching contract:
 * - assigned_component_hours (assignedWeeklyHours) is the explicit V2 source.
 * - Sole instructor may fall back to component weekly_contact_hours.
 * - Multi-instructor requires explicit assigned hours; never legacy weekly_hours DEFAULT 3.
 */

import type { DeliveryComponentType } from "./delivery-groups.ts";

export type WorkloadPolicy = {
  rankCode: string;
  /** Aliases matched against instructors.academic_rank (any locale). */
  rankAliases: string[];
  requiredLoadHours: number;
};

/** Extensible defaults — codes are locale-neutral; aliases may include AR/EN labels. */
export const DEFAULT_WORKLOAD_POLICIES: WorkloadPolicy[] = [
  {
    rankCode: "assistant_professor",
    rankAliases: ["assistant_professor", "Assistant Professor", "أستاذ مساعد"],
    requiredLoadHours: 12,
  },
  {
    rankCode: "associate_professor",
    rankAliases: ["associate_professor", "Associate Professor", "أستاذ مشارك"],
    requiredLoadHours: 9,
  },
  {
    rankCode: "associate_dean",
    rankAliases: ["associate_dean", "Associate Dean", "وكيل", "وكيل كلية"],
    requiredLoadHours: 6,
  },
];

export type AssignmentWorkloadInput = {
  deliveryGroupId: string;
  componentType: DeliveryComponentType;
  weeklyContactHours: number;
  /**
   * V2 assigned_component_hours. null/undefined = unspecified.
   * Do not pass legacy weekly_hours DEFAULT 3 as a stand-in.
   */
  assignedWeeklyHours: number | null | undefined;
  countsTowardRegularLoad: boolean;
  /** Other instructors sharing the same delivery_group (0 = sole). */
  coInstructorCount: number;
  /** When true, group is obsolete; existing assignments may still count. */
  isObsolete?: boolean;
};

export type InstructorWorkloadInput = {
  academicRank: string | null | undefined;
  policies?: WorkloadPolicy[];
  assignments: AssignmentWorkloadInput[];
};

export type InstructorWorkloadResult = {
  requiredLoadHours: number | null;
  standardAssignedHours: number;
  projectSupervisionHours: number;
  deficitHours: number;
  overloadHours: number;
  status: "ok" | "deficit" | "overload" | "policy_missing" | "unassigned";
  rankCode: string | null;
};

function n(v: number | null | undefined): number {
  if (v == null || Number.isNaN(Number(v))) return 0;
  return Number(v);
}

export function resolveRequiredLoadHours(
  academicRank: string | null | undefined,
  policies: WorkloadPolicy[] = DEFAULT_WORKLOAD_POLICIES,
): { requiredLoadHours: number | null; rankCode: string | null } {
  if (!academicRank || !String(academicRank).trim()) {
    return { requiredLoadHours: null, rankCode: null };
  }
  const needle = String(academicRank).trim().toLowerCase();
  for (const p of policies) {
    if (p.rankCode.toLowerCase() === needle) {
      return { requiredLoadHours: p.requiredLoadHours, rankCode: p.rankCode };
    }
    for (const a of p.rankAliases) {
      if (a.toLowerCase() === needle) {
        return { requiredLoadHours: p.requiredLoadHours, rankCode: p.rankCode };
      }
    }
  }
  return { requiredLoadHours: null, rankCode: null };
}

/**
 * Hours credited for one assignment.
 * - project → project_supervision only
 * - summer_training → ignored
 * - multi-instructor → assigned_component_hours only (0 if unspecified)
 * - sole instructor → assigned_component_hours or component weekly hours
 */
export function hoursForAssignment(a: AssignmentWorkloadInput): {
  standard: number;
  project: number;
} {
  if (a.componentType === "summer_training") {
    return { standard: 0, project: 0 };
  }
  // Only load-excluded work (graduation-project supervision) leaves the regular load.
  // A regular weekly project component counts as ordinary teaching load.
  if (!a.countsTowardRegularLoad) {
    const ph =
      a.coInstructorCount > 0
        ? a.assignedWeeklyHours != null
          ? n(a.assignedWeeklyHours)
          : 0
        : a.assignedWeeklyHours != null
          ? n(a.assignedWeeklyHours)
          : n(a.weeklyContactHours);
    return { standard: 0, project: a.componentType === "project" ? ph : 0 };
  }

  const componentHours = n(a.weeklyContactHours);
  if (a.coInstructorCount > 0) {
    if (a.assignedWeeklyHours != null && Number.isFinite(Number(a.assignedWeeklyHours))) {
      return { standard: n(a.assignedWeeklyHours), project: 0 };
    }
    // Shared group without explicit split — do not use DEFAULT 3 / full component
    return { standard: 0, project: 0 };
  }
  if (a.assignedWeeklyHours != null && Number.isFinite(Number(a.assignedWeeklyHours))) {
    return { standard: n(a.assignedWeeklyHours), project: 0 };
  }
  return { standard: componentHours, project: 0 };
}

export type CoTeachingHoursValidation =
  | { ok: true }
  | {
      ok: false;
      code:
        | "CO_TEACHING_HOURS_SPLIT_REQUIRED"
        | "CO_TEACHING_HOURS_OVER_ALLOCATED"
        | "OBSOLETE_DELIVERY_GROUP_ASSIGNMENT_FORBIDDEN"
        | "DELIVERY_GROUP_INACTIVE_ASSIGNMENT_FORBIDDEN";
    };

/** Pure validation mirroring ensure_ta_college co-teaching / obsolete / inactive rules. */
export function validateCoTeachingHours(input: {
  isObsolete?: boolean;
  /** delivery_groups.active — false rejects active assignments */
  isActiveGroup?: boolean;
  componentWeeklyHours: number;
  /** All assignments on the group including the candidate (assigned hours may be null). */
  assignedHours: Array<number | null | undefined>;
}): CoTeachingHoursValidation {
  if (input.isObsolete) {
    return { ok: false, code: "OBSOLETE_DELIVERY_GROUP_ASSIGNMENT_FORBIDDEN" };
  }
  if (input.isActiveGroup === false) {
    return { ok: false, code: "DELIVERY_GROUP_INACTIVE_ASSIGNMENT_FORBIDDEN" };
  }
  const hours = input.assignedHours;
  if (hours.length > 1 && hours.some((h) => h == null || !Number.isFinite(Number(h)))) {
    return { ok: false, code: "CO_TEACHING_HOURS_SPLIT_REQUIRED" };
  }
  const sum = hours.reduce<number>((acc, h) => acc + (h == null ? 0 : Number(h)), 0);
  if (sum > Number(input.componentWeeklyHours)) {
    return { ok: false, code: "CO_TEACHING_HOURS_OVER_ALLOCATED" };
  }
  return { ok: true };
}

export function computeInstructorWorkload(
  input: InstructorWorkloadInput,
): InstructorWorkloadResult {
  const policies = input.policies ?? DEFAULT_WORKLOAD_POLICIES;
  const { requiredLoadHours, rankCode } = resolveRequiredLoadHours(input.academicRank, policies);

  let standardAssignedHours = 0;
  let projectSupervisionHours = 0;
  for (const a of input.assignments) {
    const h = hoursForAssignment(a);
    standardAssignedHours += h.standard;
    projectSupervisionHours += h.project;
  }

  if (input.assignments.length === 0) {
    return {
      requiredLoadHours,
      standardAssignedHours: 0,
      projectSupervisionHours: 0,
      deficitHours: requiredLoadHours ?? 0,
      overloadHours: 0,
      status: requiredLoadHours == null ? "policy_missing" : "unassigned",
      rankCode,
    };
  }

  if (requiredLoadHours == null) {
    return {
      requiredLoadHours: null,
      standardAssignedHours,
      projectSupervisionHours,
      deficitHours: 0,
      overloadHours: 0,
      status: "policy_missing",
      rankCode,
    };
  }

  const deficitHours = Math.max(0, requiredLoadHours - standardAssignedHours);
  const overloadHours = Math.max(0, standardAssignedHours - requiredLoadHours);
  const status = overloadHours > 0 ? "overload" : deficitHours > 0 ? "deficit" : "ok";

  return {
    requiredLoadHours,
    standardAssignedHours,
    projectSupervisionHours,
    deficitHours,
    overloadHours,
    status,
    rankCode,
  };
}

/** Pure check used by harness / app validation before insert. */
export function validateAssignmentComponentMatch(input: {
  deliveryGroupComponentId: string | null | undefined;
  assignmentComponentId: string | null | undefined;
  deliveryGroupCohortId: string | null | undefined;
  assignmentCohortId: string | null | undefined;
  componentType: DeliveryComponentType | null | undefined;
}): { ok: true } | { ok: false; code: string } {
  if (input.componentType === "summer_training") {
    return { ok: false, code: "SUMMER_TRAINING_WEEKLY_ASSIGNMENT_FORBIDDEN" };
  }
  if (
    input.deliveryGroupComponentId &&
    input.assignmentComponentId &&
    input.deliveryGroupComponentId !== input.assignmentComponentId
  ) {
    return { ok: false, code: "ASSIGNMENT_COMPONENT_MISMATCH" };
  }
  if (
    input.deliveryGroupCohortId &&
    input.assignmentCohortId &&
    input.deliveryGroupCohortId !== input.assignmentCohortId
  ) {
    return { ok: false, code: "ASSIGNMENT_COHORT_MISMATCH" };
  }
  return { ok: true };
}

/** Offering ↔ delivery group plan_course / component integrity (V2). */
export function validateOfferingDeliveryGroupMatch(input: {
  offeringPlanCourseId: string | null | undefined;
  deliveryGroupPlanCourseId: string | null | undefined;
  componentPlanCourseId: string | null | undefined;
  offeringCollegeId: string | null | undefined;
  deliveryGroupCollegeId: string | null | undefined;
  cohortCollegeId: string | null | undefined;
}): { ok: true } | { ok: false; code: string } {
  if (
    input.offeringCollegeId &&
    input.deliveryGroupCollegeId &&
    input.offeringCollegeId !== input.deliveryGroupCollegeId
  ) {
    return { ok: false, code: "ASSIGNMENT_CROSS_COLLEGE_FORBIDDEN" };
  }
  if (
    input.cohortCollegeId &&
    input.deliveryGroupCollegeId &&
    input.cohortCollegeId !== input.deliveryGroupCollegeId
  ) {
    return { ok: false, code: "ASSIGNMENT_COHORT_COLLEGE_MISMATCH" };
  }
  if (
    input.offeringPlanCourseId &&
    input.deliveryGroupPlanCourseId &&
    input.offeringPlanCourseId !== input.deliveryGroupPlanCourseId
  ) {
    return { ok: false, code: "OFFERING_PLAN_COURSE_MISMATCH" };
  }
  if (
    input.componentPlanCourseId &&
    input.deliveryGroupPlanCourseId &&
    input.componentPlanCourseId !== input.deliveryGroupPlanCourseId
  ) {
    return { ok: false, code: "COMPONENT_PLAN_COURSE_MISMATCH" };
  }
  return { ok: true };
}
