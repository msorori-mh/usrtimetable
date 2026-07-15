/**
 * Within-section capacity subgroups (distinct from multi-section section_groups).
 */

export const SUBGROUP_CODES = ["A", "B", "C", "D"] as const;
export type SubgroupCode = (typeof SUBGROUP_CODES)[number];

export const CAPACITY_EXCEPTION_LIMIT = 5;
export const MAX_SUBGROUPS = 4;

export interface SubgroupPlanRow {
  ordinal: number;
  subgroup_code: SubgroupCode;
  expected_students: number;
}

/** Balanced distribution: max−min ≤ 1 and sum === total. */
export function distributeStudentsBalanced(total: number, groupsCount: number): number[] {
  if (!Number.isInteger(total) || total < 0) {
    throw new Error("total must be a non-negative integer");
  }
  if (!Number.isInteger(groupsCount) || groupsCount < 1 || groupsCount > MAX_SUBGROUPS) {
    throw new Error(`groupsCount must be 1..${MAX_SUBGROUPS}`);
  }
  const base = Math.floor(total / groupsCount);
  const rem = total % groupsCount;
  return Array.from({ length: groupsCount }, (_, i) => base + (i < rem ? 1 : 0));
}

export function planSubgroups(totalStudents: number, groupsCount: number): SubgroupPlanRow[] {
  const sizes = distributeStudentsBalanced(totalStudents, groupsCount);
  return sizes.map((expected_students, i) => ({
    ordinal: i + 1,
    subgroup_code: SUBGROUP_CODES[i]!,
    expected_students,
  }));
}

export function maxAllowedInRoom(roomCapacity: number): number {
  return roomCapacity + CAPACITY_EXCEPTION_LIMIT;
}

export function subgroupFitsRoom(students: number, roomCapacity: number): boolean {
  return students <= maxAllowedInRoom(roomCapacity);
}

export function validateSubgroupPlan(
  totalStudents: number,
  plan: SubgroupPlanRow[],
  roomCapacity: number,
): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (plan.length < 1 || plan.length > MAX_SUBGROUPS) {
    reasons.push(`groups_count must be 1..${MAX_SUBGROUPS}`);
  }
  const sum = plan.reduce((a, r) => a + r.expected_students, 0);
  if (sum !== totalStudents) reasons.push(`sum ${sum} !== total ${totalStudents}`);
  const sizes = plan.map((p) => p.expected_students);
  if (sizes.length && Math.max(...sizes) - Math.min(...sizes) > 1) {
    reasons.push("unbalanced: max-min > 1");
  }
  for (const row of plan) {
    if (!subgroupFitsRoom(row.expected_students, roomCapacity)) {
      reasons.push(
        `subgroup ${row.subgroup_code} size ${row.expected_students} > room+5 (${maxAllowedInRoom(roomCapacity)})`,
      );
    }
  }
  const codes = new Set(plan.map((p) => p.subgroup_code));
  if (codes.size !== plan.length) reasons.push("duplicate subgroup codes");
  return { ok: reasons.length === 0, reasons };
}

/** Original session strategy for capacity splits. */
export const ORIGINAL_SESSION_STRATEGY = "REPLACE_WITH_CHILD_SESSIONS" as const;

/**
 * Why REPLACE_WITH_CHILD_SESSIONS:
 * - Parent kept with replaced_by_split=true for audit (not deleted).
 * - Children are the only schedulable rows (source_type=capacity_subgroup_child).
 * - Avoids double-counting in conflict peers / grid when parent is filtered out.
 * PARENT_NON_SCHEDULABLE_WITH_CHILDREN is equivalent in effect; we pick REPLACE
 * naming because the parent is explicitly retired rather than kept as a visible shell.
 */
export function isSchedulableSession(row: { replaced_by_split?: boolean | null }): boolean {
  return !row.replaced_by_split;
}

/** Section conflict only when same section AND same subgroup (or both null). */
export function sameSectionSubgroupConflict(
  a: { section_id?: string | null; section_subgroup_id?: string | null },
  b: { section_id?: string | null; section_subgroup_id?: string | null },
): boolean {
  if (!a.section_id || !b.section_id || a.section_id !== b.section_id) return false;
  const asg = a.section_subgroup_id ?? null;
  const bsg = b.section_subgroup_id ?? null;
  // Whole-section sessions (null subgroup) conflict with any peer in section.
  if (asg === null || bsg === null) return true;
  return asg === bsg;
}
