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

  if (input.componentType === "project") {
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

  // theory: single group when within capacity; else ceil. Never invent lab default.
  if (input.componentType === "theory") {
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
  warnings: Array<{ code: string; groupNumber: number; message: string }>;
  /** V1: never auto-delete */
  deleteNumbers: never[];
};

/**
 * Non-destructive reconciliation: create missing, mark obsolete, never delete.
 */
export function planDeliveryGroupReconciliation(input: ReconcileInput): ReconcilePlan {
  const required = Math.max(0, Math.floor(input.requiredGroupCount));
  const byNum = new Map(input.existing.map((g) => [g.groupNumber, g]));
  const createNumbers: number[] = [];
  const updateNumbers: number[] = [];
  const unchangedNumbers: number[] = [];
  const obsoleteNumbers: number[] = [];
  const warnings: ReconcilePlan["warnings"] = [];

  for (let n = 1; n <= required; n++) {
    if (byNum.has(n)) {
      updateNumbers.push(n);
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
          message: "obsolete group has operational links; not deleted",
        });
      } else {
        warnings.push({
          code: "OBSOLETE_GROUP_UNUSED",
          groupNumber: g.groupNumber,
          message: "obsolete unused group retained (non-destructive V1)",
        });
      }
    } else if (!createNumbers.includes(g.groupNumber) && !updateNumbers.includes(g.groupNumber)) {
      unchangedNumbers.push(g.groupNumber);
    }
  }

  // Treat existing-in-range as update candidates; harness may distinguish unchanged after compare
  return {
    createNumbers,
    updateNumbers,
    unchangedNumbers,
    obsoleteNumbers,
    warnings,
    deleteNumbers: [],
  };
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
