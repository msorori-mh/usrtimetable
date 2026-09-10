/**
 * JAWF-STUDENT-PARTITIONS-02 — shared-student semantics for delivery groups.
 *
 * A cohort is divided into explicit anonymous student partitions (no PII).
 * Every delivery group declares which partitions attend it. Two groups of the
 * same cohort conflict only when their partition sets intersect; disjoint
 * groups may run in parallel.
 *
 * Fail-closed: when a mapping is missing, empty, incomplete, or the two groups
 * are mapped inconsistently, the conservative cohort-wide conflict is kept.
 * This module is pure (no DB, no writes); the guarded server RPC remains the
 * only authority.
 */

export type PartitionMembershipRow = {
  delivery_group_id: string;
  cohort_id: string;
  partition_id: string;
  /** Headcount of the partition; used for coverage validation. */
  partition_headcount?: number | null;
};

export type GroupPartitionEntry = {
  cohortId: string;
  partitionIds: string[];
  /** Mapped headcount covers the group's expected students. */
  complete: boolean;
};

export type PartitionIndex = Map<string, GroupPartitionEntry>;

export type SharedStudentsVerdict = {
  /** true = the two groups may contain the same students → must conflict. */
  share: boolean;
  reason:
    | "same_group"
    | "different_cohort"
    | "unmapped"
    | "incomplete_coverage"
    | "overlapping_partitions"
    | "disjoint_partitions";
};

/**
 * Build the group -> partitions index. `expectedStudents` lets us verify that
 * the mapped partitions actually cover the group's headcount; a group whose
 * mapping does not cover it is treated as incomplete (conservative).
 */
export function buildPartitionIndex(input: {
  rows: readonly PartitionMembershipRow[];
  expectedStudents?: Readonly<Record<string, number | null | undefined>>;
}): PartitionIndex {
  const index: PartitionIndex = new Map();
  const covered = new Map<string, number>();

  for (const row of input.rows) {
    if (!row.delivery_group_id || !row.partition_id || !row.cohort_id) continue;
    const entry = index.get(row.delivery_group_id) ?? {
      cohortId: row.cohort_id,
      partitionIds: [],
      complete: false,
    };
    if (entry.cohortId !== row.cohort_id) {
      // Inconsistent rows for one group: drop the mapping entirely (fail closed).
      index.set(row.delivery_group_id, {
        cohortId: entry.cohortId,
        partitionIds: [],
        complete: false,
      });
      covered.set(row.delivery_group_id, 0);
      continue;
    }
    if (!entry.partitionIds.includes(row.partition_id)) {
      entry.partitionIds.push(row.partition_id);
      covered.set(
        row.delivery_group_id,
        (covered.get(row.delivery_group_id) ?? 0) + Number(row.partition_headcount ?? 0),
      );
    }
    index.set(row.delivery_group_id, entry);
  }

  for (const [groupId, entry] of index) {
    if (entry.partitionIds.length === 0) continue;
    const expected = Number(input.expectedStudents?.[groupId] ?? 0);
    const mapped = covered.get(groupId) ?? 0;
    entry.complete = expected > 0 && mapped > 0 ? mapped >= expected : mapped > 0 || expected <= 0;
    index.set(groupId, entry);
  }

  return index;
}

/**
 * Shared-student verdict for a pair of delivery groups. Unknown or partial
 * information always returns `share: true` so the existing conservative
 * cohort-wide conflict is preserved.
 */
export function groupsShareStudents(
  aGroupId: string | null | undefined,
  bGroupId: string | null | undefined,
  index: PartitionIndex | null | undefined,
): SharedStudentsVerdict {
  if (aGroupId && bGroupId && aGroupId === bGroupId) {
    return { share: true, reason: "same_group" };
  }
  const a = aGroupId ? index?.get(aGroupId) : undefined;
  const b = bGroupId ? index?.get(bGroupId) : undefined;
  if (!a || !b || a.partitionIds.length === 0 || b.partitionIds.length === 0) {
    return { share: true, reason: "unmapped" };
  }
  if (a.cohortId !== b.cohortId) {
    return { share: false, reason: "different_cohort" };
  }
  if (!a.complete || !b.complete) {
    return { share: true, reason: "incomplete_coverage" };
  }
  const bSet = new Set(b.partitionIds);
  const intersects = a.partitionIds.some((id) => bSet.has(id));
  return intersects
    ? { share: true, reason: "overlapping_partitions" }
    : { share: false, reason: "disjoint_partitions" };
}

/**
 * Predicate used by the local candidate pre-filter. Falls back to the
 * conservative cohort-wide rule whenever no usable index is provided.
 */
export function makeSharedStudentsPredicate(index: PartitionIndex | null | undefined) {
  return (aGroupId: string | null | undefined, bGroupId: string | null | undefined): boolean =>
    groupsShareStudents(aGroupId, bGroupId, index).share;
}
