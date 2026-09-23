import type { Session, Snapshot } from "./compact.ts";

/** Exact cohort and curriculum component IDs keep programs, systems and theory/labs separate. */
export function cohortCourseGroups(snapshot: Snapshot, sessions = snapshot.sessions) {
  const assignments = new Map(snapshot.assignments.map((a) => [a.id, a]));
  const groups = new Map(snapshot.groups.map((g) => [g.id, g]));
  const buckets = new Map<string, Map<string, Session[]>>();
  for (const session of sessions) {
    const assignment = assignments.get(session.teaching_assignment_id);
    const group = groups.get(session.delivery_group_id);
    if (
      session.replaced_by_split ||
      !assignment?.is_active ||
      !assignment.plan_course_component_id ||
      !group ||
      group.active === false ||
      group.is_obsolete ||
      group.cohort_id !== session.cohort_id
    )
      continue;
    const key = JSON.stringify([group.cohort_id, assignment.plan_course_component_id]);
    const peers = buckets.get(key) ?? new Map<string, Session[]>();
    peers.set(group.id, [...(peers.get(group.id) ?? []), session]);
    buckets.set(key, peers);
  }
  return [...buckets.values()].filter((peers) => peers.size > 1);
}

/** Missing group/day attendances relative to the union; zero means matching day sets.
 * Repeated weekly meetings can align across several days without being collapsed. */
export function cohortCourseDayMismatch(snapshot: Snapshot, sessions = snapshot.sessions): number {
  return cohortCourseGroups(snapshot, sessions).reduce((total, peers) => {
    const days = [...peers.values()].map((rows) => new Set(rows.map((s) => s.day_of_week)));
    const union = new Set(days.flatMap((set) => [...set]));
    return total + union.size * peers.size - days.reduce((sum, set) => sum + set.size, 0);
  }, 0);
}
