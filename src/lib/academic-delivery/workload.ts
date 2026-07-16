/**
 * Phase 9.3 — pure standard-workload calculation (fixtures/harness).
 * Mirrors compute_instructor_standard_workload SQL semantics.
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
  /** Assignment weekly_hours when present */
  assignedWeeklyHours: number | null | undefined;
  countsTowardRegularLoad: boolean;
  /** Other instructors sharing the same delivery_group */
  coInstructorCount: number;
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
 * - multi-instructor group → use assignedWeeklyHours when set; else do not auto-full-count
 * - sole instructor → component weekly hours (not legacy total course hours)
 */
export function hoursForAssignment(a: AssignmentWorkloadInput): {
  standard: number;
  project: number;
} {
  if (a.componentType === "summer_training") {
    return { standard: 0, project: 0 };
  }
  if (a.componentType === "project" || !a.countsTowardRegularLoad) {
    const ph =
      a.coInstructorCount > 0 && a.assignedWeeklyHours != null
        ? n(a.assignedWeeklyHours)
        : n(a.weeklyContactHours);
    return { standard: 0, project: a.componentType === "project" ? ph : 0 };
  }

  const componentHours = n(a.weeklyContactHours);
  if (a.coInstructorCount > 0) {
    if (a.assignedWeeklyHours != null && Number.isFinite(Number(a.assignedWeeklyHours))) {
      return { standard: n(a.assignedWeeklyHours), project: 0 };
    }
    // Shared group without explicit split — do not auto-full-count each instructor
    return { standard: 0, project: 0 };
  }
  return { standard: componentHours, project: 0 };
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
