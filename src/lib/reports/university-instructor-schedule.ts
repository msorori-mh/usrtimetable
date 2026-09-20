import { computeQuotaBalance, type QuotaInput } from "./instructor-quota";
import type { TimetableReportSession } from "./session-mappers";

export interface UniversityTerm {
  id: string;
  college_id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
}
export interface UniversityVersion {
  id: string;
  college_id: string;
  academic_term_id: string;
  name: string;
  status: string;
  created_at: string;
  is_coordination: boolean;
}
export interface CollegeScheduleScope {
  collegeId: string;
  collegeName: string;
  version: UniversityVersion;
  options: UniversityVersion[];
}

export function canViewInstructorAcrossColleges(roles: readonly string[]) {
  return roles.includes("super_admin");
}

/** Explicit fixture marker used by production test data. */
export function isTestScheduleLabel(name: string) {
  return /TEST_ONLY/i.test(name);
}

/** Keep the issuing college; other colleges require actual teaching evidence. */
export function instructorTeachingScopes(
  scopes: CollegeScheduleScope[],
  anchorCollegeId: string,
  teachingCollegeIds: string[],
  canViewAcrossColleges = false,
) {
  const ids = new Set(teachingCollegeIds);
  return scopes.filter(
    (scope) =>
      !isTestScheduleLabel(scope.collegeName) &&
      (scope.collegeId === anchorCollegeId || (canViewAcrossColleges && ids.has(scope.collegeId))),
  );
}

/** Dated semesters only: never combine different academic years by display name. */
export function overlappingTerms(a: UniversityTerm, b: UniversityTerm) {
  if (a.id === b.id) return true;
  return !!(
    a.start_date &&
    a.end_date &&
    b.start_date &&
    b.end_date &&
    a.start_date <= a.end_date &&
    b.start_date <= b.end_date &&
    a.start_date <= b.end_date &&
    b.start_date <= a.end_date
  );
}

export function resolveCollegeScheduleScopes(input: {
  colleges: { id: string; name: string }[];
  terms: UniversityTerm[];
  versions: UniversityVersion[];
  anchorVersionId: string;
  selections: Record<string, string>;
}): CollegeScheduleScope[] {
  const anchor = input.versions.find((v) => v.id === input.anchorVersionId);
  const term = input.terms.find((t) => t.id === anchor?.academic_term_id);
  if (!anchor || !term) throw new Error("تعذر تحديد الفصل الدراسي لنسخة الجدول المختارة.");
  if (!term.start_date || !term.end_date || term.start_date > term.end_date)
    throw new Error("أكمل تاريخ بداية ونهاية الفصل لربط جداول الكليات دون خلط الفصول.");
  const termIds = new Set(input.terms.filter((t) => overlappingTerms(term, t)).map((t) => t.id));
  const rank = (v: UniversityVersion) => (v.status === "published" ? 0 : v.is_coordination ? 1 : 2);
  return input.colleges
    .filter((college) => !isTestScheduleLabel(college.name))
    .flatMap((college) => {
      const options = input.versions
        .filter(
          (v) =>
            v.college_id === college.id &&
            termIds.has(v.academic_term_id) &&
            v.status !== "archived" &&
            !isTestScheduleLabel(v.name),
        )
        .sort(
          (a, b) =>
            rank(a) - rank(b) ||
            b.created_at.localeCompare(a.created_at) ||
            a.id.localeCompare(b.id),
        );
      if (!options.length) return [];
      const selected = college.id === anchor.college_id ? anchor.id : input.selections[college.id];
      const version = selected ? options.find((v) => v.id === selected) : options[0];
      if (!version)
        throw new Error(`نسخة ${college.name} لم تعد متاحة ضمن الفصل المختار؛ أعد اختيارها.`);
      return [{ collegeId: college.id, collegeName: college.name, version, options }];
    });
}

/** Canonical record ID or verified university number, never fuzzy name matching. */
export function facultyRecordIds<
  T extends { id: string; university_number: string | null; record_ids?: readonly string[] },
>(selected: T, records: T[]) {
  return [
    ...new Set([
      selected.id,
      ...(selected.record_ids ?? []),
      ...records
        .filter(
          (r) => selected.university_number && r.university_number === selected.university_number,
        )
        .map((r) => r.id),
    ]),
  ];
}

export interface UniversityInstructorSession extends TimetableReportSession {
  college_id: string;
  college_name: string;
  version_name: string;
  source_college_id?: string;
  source_college_name?: string;
  workload_pending?: boolean;
}

/** Repeated memberships/identity aliases must not multiply one physical session. */
export function summarizeUniversitySchedule(
  sessions: UniversityInstructorSession[],
  quota: QuotaInput,
) {
  const unique = [
    ...new Map(sessions.map((s) => [`${s.source_college_id ?? s.college_id}:${s.id}`, s])).values(),
  ];
  const byCollege = new Map<
    string,
    { collegeId: string; collegeName: string; versionName: string; hours: number }
  >();
  let pending = false;
  for (const s of unique) {
    const minutes = (t: string) => {
      const [h, m] = t.split(":").map(Number);
      return h * 60 + m;
    };
    const duration = (minutes(s.end_time) - minutes(s.start_time)) / 60;
    if (!Number.isFinite(duration) || duration <= 0)
      throw new Error("تعذر حساب الساعات: يوجد وقت محاضرة غير صالح.");
    pending ||= !!s.workload_pending;
    const row = byCollege.get(s.college_id) ?? {
      collegeId: s.college_id,
      collegeName: s.college_name,
      versionName: s.version_name,
      hours: 0,
    };
    row.hours += duration;
    byCollege.set(s.college_id, row);
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  const colleges = [...byCollege.values()].map((r) => ({ ...r, hours: round(r.hours) }));
  const totalHours = round(colleges.reduce((n, r) => n + r.hours, 0));
  return {
    sessions: unique,
    colleges,
    totalHours,
    pending,
    balance: computeQuotaBalance({ ...quota, assignedHours: totalHours }),
  };
}
