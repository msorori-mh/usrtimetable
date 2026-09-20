export interface ReportDeliveryGroup {
  id: string;
  cohort_id: string;
  plan_course_id: string;
  component_id: string;
  group_code: string;
  active: boolean;
  is_obsolete: boolean;
  expected_students: number | null;
}

/** Use the full catalogue, never the sessions remaining after report filters.
 * A lecture can cover All while the same course's labs remain G1/G2.
 * This changes presentation only: IDs, memberships and stored codes are retained.
 */
export function wholeCohortGroupLabels(
  groups: readonly ReportDeliveryGroup[],
  cohortSizes: ReadonlyMap<string, number | null> = new Map(),
): Map<string, string> {
  const key = (g: ReportDeliveryGroup) =>
    JSON.stringify([g.cohort_id, g.plan_course_id, g.component_id]);
  const peers = new Map<string, Set<string>>();
  for (const g of groups) {
    if (!g.active || g.is_obsolete) continue;
    const ids = peers.get(key(g)) ?? new Set<string>();
    ids.add(g.id);
    peers.set(key(g), ids);
  }
  return new Map(
    groups.map((g) => {
      const cohortSize = cohortSizes.get(g.cohort_id);
      const knownPartial =
        cohortSize != null &&
        cohortSize > 0 &&
        g.expected_students != null &&
        g.expected_students < cohortSize;
      const whole =
        g.active &&
        !g.is_obsolete &&
        !!g.cohort_id &&
        !!g.plan_course_id &&
        !!g.component_id &&
        !knownPartial &&
        peers.get(key(g))?.size === 1;
      return [g.id, whole ? "All" : g.group_code];
    }),
  );
}
