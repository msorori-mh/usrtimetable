/** Pure helpers of the client conflict pre-check (no database access). */
import type { Conflict } from "./validator";

/**
 * Collapse repeated findings for the same rule and the same (unordered) session
 * pair. A batch pass reports A↔B from both sides; only one row is meaningful.
 * Version-wide findings without sessions (cohort_component_single_instructor) are
 * distinct per cohort / plan course / component, so they never collapse into one (L-11).
 */
export function dedupeConflicts(conflicts: Conflict[]): Conflict[] {
  const seen = new Set<string>();
  const out: Conflict[] = [];
  for (const c of conflicts) {
    const a = c.schedule_session_id ?? "";
    const b = c.related_session_id ?? "";
    const pair = b && a > b ? `${b}|${a}` : `${a}|${b}`;
    const m = c.metadata ?? {};
    const scope = [m.cohort_id, m.plan_course_id, m.component_type]
      .map((v) => (v == null ? "" : String(v)))
      .join("|");
    const key = `${c.code}|${pair}|${scope}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/**
 * Headcount used for the capacity rule. Same fallback as the server (_ss_enroll): a
 * non-positive session headcount falls back to the offering headcount instead of silently
 * skipping the capacity check (M-12).
 */
export function effectiveExpectedStudents(
  sessionExpected: number | null | undefined,
  offeringExpected: number | null | undefined,
): number {
  if (sessionExpected != null && sessionExpected > 0) return sessionExpected;
  return offeringExpected ?? 0;
}
