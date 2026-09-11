/**
 * Phase 9.3 — pure delivery-group calculation (fixtures/harness only).
 * Mirrors generate_cohort_delivery_groups SQL rules without DB access.
 */

export type DeliveryComponentType =
  | "theory"
  | "practical"
  | "tutorial"
  | "project"
  | "summer_training";

export type CapacityRef = {
  defaultCapacity: number | null | undefined;
  strictCapacity?: boolean | null;
};

export type GroupCalcInput = {
  componentType: DeliveryComponentType;
  studentCount: number;
  /** From plan_course_components.required_room_type → room_types.default_capacity */
  roomTypeCapacity?: CapacityRef | null;
  /** Explicit component setting (tutorial/project). Never invent. */
  explicitGroupSize?: number | null;
  weeklyContactHours?: number | null;
  /**
   * plan_course_components.counts_toward_regular_load.
   * true on a project component = regular weekly project (classroom rules);
   * false/undefined keeps graduation-project supervision semantics.
   */
  countsTowardRegularLoad?: boolean | null;
};

export type GroupCalcOk = {
  ok: true;
  groupCount: number;
  capacityUsed: number;
  excludedFromStandardWorkload: boolean;
  skipped?: false;
};

export type GroupCalcSkip = {
  ok: true;
  skipped: true;
  reason: "skipped_non_weekly_component";
  groupCount: 0;
  capacityUsed: null;
  excludedFromStandardWorkload: true;
};

export type GroupCalcErr = {
  ok: false;
  code: "MISSING_CAPACITY" | "INVALID_STUDENT_COUNT" | "MISSING_PROJECT_GROUP_SIZE";
  message: string;
};

export type GroupCalcResult = GroupCalcOk | GroupCalcSkip | GroupCalcErr;

/**
 * The delivery-group split source is the approved scheduling headcount.
 * Registered/legacy expected counts are deliberately not accepted as fallback inputs.
 */
export function requireSchedulingHeadcountForSplit(
  value: number | null | undefined,
):
  | { ok: true; studentCount: number }
  | { ok: false; code: "SCHEDULING_HEADCOUNT_MISSING"; message: string } {
  if (!Number.isInteger(value) || (value ?? 0) <= 0) {
    return {
      ok: false,
      code: "SCHEDULING_HEADCOUNT_MISSING",
      message: "A positive approved scheduling_headcount is required for delivery-group splitting.",
    };
  }
  return { ok: true, studentCount: Number(value) };
}

function ceilDiv(n: number, d: number): number {
  return Math.ceil(n / d);
}

function positiveInt(v: number | null | undefined): number | null {
  if (v == null || Number.isNaN(Number(v))) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

/**
 * Resolve how many delivery groups a component needs for a cohort headcount.
 */
export function calculateDeliveryGroupCount(input: GroupCalcInput): GroupCalcResult {
  const students = Number(input.studentCount);
  if (!Number.isFinite(students) || students < 0) {
    return {
      ok: false,
      code: "INVALID_STUDENT_COUNT",
      message: "student_count must be a non-negative number",
    };
  }

  if (input.componentType === "summer_training") {
    return {
      ok: true,
      skipped: true,
      reason: "skipped_non_weekly_component",
      groupCount: 0,
      capacityUsed: null,
      excludedFromStandardWorkload: true,
    };
  }

  // Regular weekly project (counts_toward_regular_load = true) uses classroom rules:
  // room-type capacity, no explicit_group_size, and it is not workload-excluded.
  if (input.componentType === "project" && input.countsTowardRegularLoad !== true) {
    const hours = Number(input.weeklyContactHours ?? 0);
    if (!Number.isFinite(hours) || hours <= 0) {
      return {
        ok: true,
        groupCount: 0,
        capacityUsed: 0,
        excludedFromStandardWorkload: true,
      };
    }
    const size = positiveInt(input.explicitGroupSize);
    if (size == null) {
      return {
        ok: false,
        code: "MISSING_PROJECT_GROUP_SIZE",
        message: "project requires explicit_group_size; capacity must not be guessed",
      };
    }
    const count = students === 0 ? 1 : ceilDiv(Math.max(students, 1), size);
    return {
      ok: true,
      groupCount: count,
      capacityUsed: size,
      excludedFromStandardWorkload: true,
    };
  }

  // tutorial may use explicit group size first
  if (input.componentType === "tutorial") {
    const explicit = positiveInt(input.explicitGroupSize);
    if (explicit != null) {
      const count = students === 0 ? 1 : ceilDiv(Math.max(students, 1), explicit);
      return {
        ok: true,
        groupCount: count,
        capacityUsed: explicit,
        excludedFromStandardWorkload: false,
      };
    }
  }

  const cap = positiveInt(input.roomTypeCapacity?.defaultCapacity ?? null);
  if (cap == null) {
    return {
      ok: false,
      code: "MISSING_CAPACITY",
      message: `missing capacity reference for ${input.componentType}; refuse to guess`,
    };
  }

  // theory (and regular weekly project): single group when within capacity; else ceil.
  if (input.componentType === "theory" || input.componentType === "project") {
    if (students <= cap) {
      return {
        ok: true,
        groupCount: 1,
        capacityUsed: cap,
        excludedFromStandardWorkload: false,
      };
    }
    return {
      ok: true,
      groupCount: ceilDiv(students, cap),
      capacityUsed: cap,
      excludedFromStandardWorkload: false,
    };
  }

  // practical / tutorial (room capacity path): ceil; strict_capacity is hard limit semantics
  const count = students === 0 ? 1 : ceilDiv(Math.max(students, 1), cap);
  return {
    ok: true,
    groupCount: count,
    capacityUsed: cap,
    excludedFromStandardWorkload: false,
  };
}

export type ExistingGroup = {
  groupNumber: number;
  hasTeachingAssignment: boolean;
  hasScheduleSession: boolean;
  isObsolete?: boolean;
};

export type ReconcileInput = {
  requiredGroupCount: number;
  existing: ExistingGroup[];
};

export type ReconcilePlan = {
  createNumbers: number[];
  updateNumbers: number[];
  unchangedNumbers: number[];
  obsoleteNumbers: number[];
  /** Natural keys to clear is_obsolete when needed again (same group_number). */
  reactivateNumbers: number[];
  warnings: Array<{ code: string; groupNumber: number; message: string }>;
  /** V1: never auto-delete */
  deleteNumbers: never[];
};

/**
 * Non-destructive reconciliation: create missing, mark obsolete, never delete.
 * Reactivation reuses the same natural key (cohort, component, group_number).
 */
export function planDeliveryGroupReconciliation(input: ReconcileInput): ReconcilePlan {
  const required = Math.max(0, Math.floor(input.requiredGroupCount));
  const byNum = new Map(input.existing.map((g) => [g.groupNumber, g]));
  const createNumbers: number[] = [];
  const updateNumbers: number[] = [];
  const unchangedNumbers: number[] = [];
  const obsoleteNumbers: number[] = [];
  const reactivateNumbers: number[] = [];
  const warnings: ReconcilePlan["warnings"] = [];

  for (let n = 1; n <= required; n++) {
    const existing = byNum.get(n);
    if (existing) {
      updateNumbers.push(n);
      if (existing.isObsolete) {
        reactivateNumbers.push(n);
      }
    } else {
      createNumbers.push(n);
    }
  }

  for (const g of input.existing) {
    if (g.groupNumber > required) {
      obsoleteNumbers.push(g.groupNumber);
      if (g.hasTeachingAssignment || g.hasScheduleSession) {
        warnings.push({
          code: "OBSOLETE_GROUP_LINKED",
          groupNumber: g.groupNumber,
          message: "obsolete group has operational links; marked obsolete, not deleted",
        });
      } else {
        warnings.push({
          code: "OBSOLETE_GROUP_UNUSED",
          groupNumber: g.groupNumber,
          message: "obsolete unused group marked obsolete and retained (non-destructive)",
        });
      }
    } else if (!createNumbers.includes(g.groupNumber) && !updateNumbers.includes(g.groupNumber)) {
      unchangedNumbers.push(g.groupNumber);
    }
  }

  return {
    createNumbers,
    updateNumbers,
    unchangedNumbers,
    obsoleteNumbers,
    reactivateNumbers,
    warnings,
    deleteNumbers: [],
  };
}

export type CompatibilityOffering = {
  id: string;
  planCourseId: string;
  createdAt: string;
  isActive?: boolean;
};

/**
 * Source of truth for generation: cohort + plan_course + component.
 * Same plan_course_id → deterministic newest created_at then id.
 * Multiple plan_course_id values → ambiguous (validation error).
 */
export function resolveCompatibilityOffering(
  offerings: CompatibilityOffering[],
):
  | { ok: true; offeringId: string; planCourseId: string }
  | { ok: false; code: "NO_COMPATIBILITY_OFFERING" | "AMBIGUOUS_COMPATIBILITY_OFFERINGS" } {
  const active = offerings.filter((o) => o.isActive !== false);
  if (active.length === 0) {
    return { ok: false, code: "NO_COMPATIBILITY_OFFERING" };
  }
  const planIds = new Set(active.map((o) => o.planCourseId));
  if (planIds.size > 1) {
    return { ok: false, code: "AMBIGUOUS_COMPATIBILITY_OFFERINGS" };
  }
  const sorted = [...active].sort((a, b) => {
    const t = b.createdAt.localeCompare(a.createdAt);
    if (t !== 0) return t;
    return a.id.localeCompare(b.id);
  });
  return {
    ok: true,
    offeringId: sorted[0]!.id,
    planCourseId: sorted[0]!.planCourseId,
  };
}

/** Deduplicate components so multiple offerings never multiply generation passes. */
export function uniqueComponentsById<T extends { componentId: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    if (seen.has(row.componentId)) continue;
    seen.add(row.componentId);
    out.push(row);
  }
  return out;
}

export function groupCodeForNumber(groupNumber: number): string {
  return `G${groupNumber}`;
}

export function distributeStudents(studentCount: number, groupCount: number): number[] {
  if (groupCount <= 0) return [];
  const base = Math.floor(studentCount / groupCount);
  const rem = studentCount % groupCount;
  return Array.from({ length: groupCount }, (_, i) => base + (i < rem ? 1 : 0));
}
