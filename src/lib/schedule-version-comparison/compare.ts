/**
 * Read-only schedule version comparison — pure functions, no DB writes.
 * Mission: SCHEDULE-VERSION-COMPARISON-01
 */

export interface CompareSession {
  id: string;
  college_id?: string | null;
  schedule_version_id?: string | null;
  instructor_id: string | null;
  room_id: string | null;
  cohort_id?: string | null;
  delivery_group_id?: string | null;
  study_system: string | null;
  day_of_week: number;
  start_time: string;
  end_time: string;
  course_offering_id?: string | null;
  teaching_assignment_id?: string | null;
  academic_term_id?: string | null;
}

export type ChangeKind =
  | "added"
  | "removed"
  | "time_changed"
  | "room_changed"
  | "instructor_or_group_changed";

export interface SessionChange {
  kind: ChangeKind;
  match_key: string;
  before_id?: string;
  after_id?: string;
  detail_ar: string;
  study_system: string;
}

export interface VersionCompareSummary {
  sessions_a: number;
  sessions_b: number;
  added: number;
  removed: number;
  time_changed: number;
  room_changed: number;
  instructor_or_group_changed: number;
  unchanged: number;
}

export interface VersionCompareResult {
  summary: VersionCompareSummary;
  changes: SessionChange[];
  student_impact: number;
  instructor_impact: number;
  room_impact: number;
}

/** Stable logical key for cross-version matching (not row id). */
export function sessionMatchKey(s: CompareSession): string {
  const sys = s.study_system ?? "";
  const dg = s.delivery_group_id ?? "";
  const cohort = s.cohort_id ?? "";
  const offering = s.course_offering_id ?? "";
  const ta = s.teaching_assignment_id ?? "";
  return [sys, dg || cohort, offering, ta, s.day_of_week].join("|");
}

function normalizeTime(t: string): string {
  return t.length === 5 ? `${t}:00` : t;
}

function sameSlot(a: CompareSession, b: CompareSession): boolean {
  return (
    a.day_of_week === b.day_of_week &&
    normalizeTime(a.start_time) === normalizeTime(b.start_time) &&
    normalizeTime(b.end_time) === normalizeTime(a.end_time)
  );
}

/**
 * Compare two versions. Isolates study_system; rejects cross-college when collegeId set.
 */
export function compareScheduleVersions(input: {
  versionA: CompareSession[];
  versionB: CompareSession[];
  collegeId?: string;
}): VersionCompareResult {
  const filterCollege = (rows: CompareSession[]) =>
    input.collegeId ? rows.filter((s) => !s.college_id || s.college_id === input.collegeId) : rows;

  const a = [...filterCollege(input.versionA)].sort((x, y) =>
    sessionMatchKey(x).localeCompare(sessionMatchKey(y)),
  );
  const b = [...filterCollege(input.versionB)].sort((x, y) =>
    sessionMatchKey(x).localeCompare(sessionMatchKey(y)),
  );

  const mapA = new Map<string, CompareSession[]>();
  const mapB = new Map<string, CompareSession[]>();
  for (const s of a) {
    const k = sessionMatchKey(s);
    const list = mapA.get(k) ?? [];
    list.push(s);
    mapA.set(k, list);
  }
  for (const s of b) {
    const k = sessionMatchKey(s);
    const list = mapB.get(k) ?? [];
    list.push(s);
    mapB.set(k, list);
  }

  const keys = [...new Set([...mapA.keys(), ...mapB.keys()])].sort();
  const changes: SessionChange[] = [];
  let unchanged = 0;

  for (const key of keys) {
    const left = mapA.get(key) ?? [];
    const right = mapB.get(key) ?? [];
    const n = Math.max(left.length, right.length);
    for (let i = 0; i < n; i++) {
      const L = left[i];
      const R = right[i];
      if (L && !R) {
        changes.push({
          kind: "removed",
          match_key: key,
          before_id: L.id,
          detail_ar: "جلسة حُذفت في النسخة الثانية",
          study_system: String(L.study_system ?? ""),
        });
        continue;
      }
      if (!L && R) {
        changes.push({
          kind: "added",
          match_key: key,
          after_id: R.id,
          detail_ar: "جلسة أُضيفت في النسخة الثانية",
          study_system: String(R.study_system ?? ""),
        });
        continue;
      }
      if (!L || !R) continue;
      if (
        sameSlot(L, R) &&
        L.room_id === R.room_id &&
        L.instructor_id === R.instructor_id &&
        (L.delivery_group_id ?? null) === (R.delivery_group_id ?? null) &&
        (L.cohort_id ?? null) === (R.cohort_id ?? null)
      ) {
        unchanged += 1;
        continue;
      }
      if (!sameSlot(L, R)) {
        changes.push({
          kind: "time_changed",
          match_key: key,
          before_id: L.id,
          after_id: R.id,
          detail_ar: `تغيّر الوقت: ${L.day_of_week} ${L.start_time}-${L.end_time} → ${R.day_of_week} ${R.start_time}-${R.end_time}`,
          study_system: String(L.study_system ?? R.study_system ?? ""),
        });
      }
      if (L.room_id !== R.room_id) {
        changes.push({
          kind: "room_changed",
          match_key: key,
          before_id: L.id,
          after_id: R.id,
          detail_ar: `تغيّرت القاعة: ${L.room_id ?? "—"} → ${R.room_id ?? "—"}`,
          study_system: String(L.study_system ?? R.study_system ?? ""),
        });
      }
      if (
        L.instructor_id !== R.instructor_id ||
        (L.delivery_group_id ?? null) !== (R.delivery_group_id ?? null) ||
        (L.cohort_id ?? null) !== (R.cohort_id ?? null)
      ) {
        changes.push({
          kind: "instructor_or_group_changed",
          match_key: key,
          before_id: L.id,
          after_id: R.id,
          detail_ar: "تغيّر المدرس أو المجموعة/الدفعة",
          study_system: String(L.study_system ?? R.study_system ?? ""),
        });
      }
    }
  }

  const summary: VersionCompareSummary = {
    sessions_a: a.length,
    sessions_b: b.length,
    added: changes.filter((c) => c.kind === "added").length,
    removed: changes.filter((c) => c.kind === "removed").length,
    time_changed: changes.filter((c) => c.kind === "time_changed").length,
    room_changed: changes.filter((c) => c.kind === "room_changed").length,
    instructor_or_group_changed: changes.filter((c) => c.kind === "instructor_or_group_changed")
      .length,
    unchanged,
  };

  const student_impact = changes.filter((c) =>
    ["added", "removed", "time_changed", "instructor_or_group_changed"].includes(c.kind),
  ).length;
  const instructor_impact = changes.filter((c) =>
    ["added", "removed", "time_changed", "instructor_or_group_changed"].includes(c.kind),
  ).length;
  const room_impact = changes.filter((c) =>
    ["added", "removed", "room_changed", "time_changed"].includes(c.kind),
  ).length;

  return {
    summary,
    changes,
    student_impact,
    instructor_impact,
    room_impact,
  };
}

export function assertSameCollegeVersions(
  collegeA: string | null | undefined,
  collegeB: string | null | undefined,
  actorCollegeId: string,
): boolean {
  if (!collegeA || !collegeB) return false;
  return collegeA === actorCollegeId && collegeB === actorCollegeId;
}
