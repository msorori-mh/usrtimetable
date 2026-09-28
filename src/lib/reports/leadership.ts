import { z } from "zod";

const amount = z.number().finite().nonnegative().nullable();
export const leadershipCollegeSchema = z.object({
  college_id: z.string().uuid(),
  college: z.string(),
  term_id: z.string().uuid().nullable(),
  term: z.string().nullable(),
  term_state: z.enum(["ready", "missing", "ambiguous"]),
  year_inferred: z.boolean().nullable(),
  departments: amount,
  programs: amount,
  faculty_count: amount,
  teaching_contributors: amount.optional().default(0),
  external_contributors: amount.optional().default(0),
  faculty_directory_count: amount.optional().default(0),
  rank_counts: z.record(z.string(), z.number().finite().nonnegative()).optional().default({}),
  availability_counts: z
    .record(z.string(), z.number().finite().nonnegative())
    .optional()
    .default({}),
  employment_counts: z.record(z.string(), z.number().finite().nonnegative()).optional().default({}),
  incomplete_faculty: amount,
  net_quota: amount,
  faculty_assigned_hours: amount,
  overload: amount,
  deficit: amount,
  groups_count: amount,
  covered_groups: amount,
  required_hours: amount,
  covered_hours: amount,
  assigned_hours: amount,
  uncovered_hours: amount,
  pending_groups: amount,
  pending_group_hours: amount,
  overallocated_groups: amount,
  version_id: z.string().uuid().nullable(),
  version: z.string().nullable(),
  version_updated_at: z.string().nullable(),
  sessions_count: amount,
  teaching_hours: amount,
  theory_hours: amount,
  practical_hours: amount,
  other_hours: amount,
  room_count: amount,
  halls: amount,
  labs: amount,
  seats: amount,
  used_rooms: amount,
});
export const leadershipOverviewSchema = z.object({
  year: z.string().nullable(),
  term_type: z.string().nullable(),
  generated_at: z.string(),
  unique_faculty: amount.optional(),
  unresolved_faculty: amount.optional(),
  periods: z.array(z.object({ year: z.string(), type: z.string() })),
  colleges: z.array(leadershipCollegeSchema),
});
export type LeadershipCollege = z.infer<typeof leadershipCollegeSchema>;
export type LeadershipAmountKey = {
  [K in keyof LeadershipCollege]: LeadershipCollege[K] extends number | null ? K : never;
}[keyof LeadershipCollege];
export const termTypeLabel = (value: string) =>
  (
    ({
      first: "الفصل الأول",
      second: "الفصل الثاني",
      summer: "الفصل الصيفي",
    }) as Record<string, string>
  )[value] ?? value;
export function sumLeadership(rows: LeadershipCollege[], key: keyof LeadershipCollege): number {
  return (
    Math.round(
      rows.reduce(
        (total, row) => total + (typeof row[key] === "number" ? Number(row[key]) : 0),
        0,
      ) * 100,
    ) / 100
  );
}

/**
 * Aggregate with an explicit completeness signal. Unlike `sumLeadership`, this
 * never turns an entirely unknown university measure into a plausible zero.
 */
export function aggregateLeadership(
  rows: LeadershipCollege[],
  key: LeadershipAmountKey,
): { value: number | null; known: number; total: number; complete: boolean } {
  const values = rows
    .map((row) => row[key])
    .filter((value): value is number => typeof value === "number");
  return {
    value:
      values.length === 0
        ? null
        : Math.round(values.reduce((total, value) => total + value, 0) * 100) / 100,
    known: values.length,
    total: rows.length,
    complete: rows.length > 0 && values.length === rows.length,
  };
}

const roundLeadership = (value: number) => Math.round(value * 100) / 100;
const isKnownLeadershipNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

export interface LeadershipTeachingSnapshot {
  publishedColleges: number;
  sessions: number | null;
  scheduledHours: number | null;
  theoryHours: number | null;
  practicalHours: number | null;
  otherHours: number | null;
  averageSessionsPerCollege: number | null;
  averageSessionHours: number | null;
  compositionDifference: number | null;
  consistent: boolean;
}

/**
 * Fail closed unless every selected reporting version proves that
 * theory + practical + other = total scheduled hours.
 */
export function leadershipTeachingSnapshot(rows: LeadershipCollege[]): LeadershipTeachingSnapshot {
  const published = rows.filter(
    (row) => row.term_state === "ready" && typeof row.version_id === "string",
  );
  const complete = published.every((row) =>
    [
      row.sessions_count,
      row.teaching_hours,
      row.theory_hours,
      row.practical_hours,
      row.other_hours,
    ].every(isKnownLeadershipNumber),
  );
  if (!published.length || !complete) {
    return {
      publishedColleges: published.length,
      sessions: null,
      scheduledHours: null,
      theoryHours: null,
      practicalHours: null,
      otherHours: null,
      averageSessionsPerCollege: null,
      averageSessionHours: null,
      compositionDifference: null,
      consistent: false,
    };
  }
  const sum = (
    key: "sessions_count" | "teaching_hours" | "theory_hours" | "practical_hours" | "other_hours",
  ) => roundLeadership(published.reduce((total, row) => total + Number(row[key]), 0));
  const sessions = sum("sessions_count");
  const scheduledHours = sum("teaching_hours");
  const theoryHours = sum("theory_hours");
  const practicalHours = sum("practical_hours");
  const otherHours = sum("other_hours");
  const compositionDifference = roundLeadership(
    theoryHours + practicalHours + otherHours - scheduledHours,
  );
  const consistent = Math.abs(compositionDifference) <= 0.01;
  return {
    publishedColleges: published.length,
    sessions: consistent ? sessions : null,
    scheduledHours: consistent ? scheduledHours : null,
    theoryHours: consistent ? theoryHours : null,
    practicalHours: consistent ? practicalHours : null,
    otherHours: consistent ? otherHours : null,
    averageSessionsPerCollege:
      consistent && published.length ? roundLeadership(sessions / published.length) : null,
    averageSessionHours:
      consistent && sessions > 0 ? roundLeadership(scheduledHours / sessions) : null,
    compositionDifference,
    consistent,
  };
}

export interface LeadershipAssignmentSnapshot {
  sourceColleges: number;
  totalColleges: number;
  requiredHours: number | null;
  approvedHours: number | null;
  awaitingHours: number | null;
  difference: number | null;
  consistent: boolean;
}

export function hasLeadershipAssignmentSource(row: LeadershipCollege): boolean {
  return (
    row.term_state === "ready" && isKnownLeadershipNumber(row.groups_count) && row.groups_count > 0
  );
}

/**
 * Pending shared-allocation hours belong in the administrative queue:
 * approved + awaiting (ordinary uncovered + pending shared) = required.
 */
export function leadershipAssignmentSnapshot(
  rows: LeadershipCollege[],
): LeadershipAssignmentSnapshot {
  const sources = rows.filter(hasLeadershipAssignmentSource);
  const complete = sources.every((row) =>
    [row.required_hours, row.covered_hours, row.uncovered_hours, row.pending_group_hours].every(
      isKnownLeadershipNumber,
    ),
  );
  if (!sources.length || !complete) {
    return {
      sourceColleges: sources.length,
      totalColleges: rows.length,
      requiredHours: null,
      approvedHours: null,
      awaitingHours: null,
      difference: null,
      consistent: false,
    };
  }
  const requiredHours = roundLeadership(
    sources.reduce((total, row) => total + Number(row.required_hours), 0),
  );
  const approvedHours = roundLeadership(
    sources.reduce((total, row) => total + Number(row.covered_hours), 0),
  );
  const awaitingHours = roundLeadership(
    sources.reduce(
      (total, row) => total + Number(row.uncovered_hours) + Number(row.pending_group_hours),
      0,
    ),
  );
  const difference = roundLeadership(approvedHours + awaitingHours - requiredHours);
  const consistent = Math.abs(difference) <= 0.01;
  return {
    sourceColleges: sources.length,
    totalColleges: rows.length,
    requiredHours: consistent ? requiredHours : null,
    approvedHours: consistent ? approvedHours : null,
    awaitingHours: consistent ? awaitingHours : null,
    difference,
    consistent,
  };
}

export function formatLeadershipAmount(value: number | null | undefined, unit = ""): string {
  if (value === null || value === undefined) return "غير محسوب";
  return `${value.toLocaleString("ar")} ${unit}`.trim();
}

export function leadershipPercent(
  numerator: number | null | undefined,
  denominator: number | null | undefined,
): number | null {
  if (
    numerator === null ||
    numerator === undefined ||
    denominator === null ||
    denominator === undefined ||
    denominator <= 0
  )
    return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}
export function coveragePercent(row: LeadershipCollege): number | null {
  if (row.required_hours === null || row.covered_hours === null || row.required_hours <= 0)
    return null;
  return Math.round((1000 * row.covered_hours) / row.required_hours) / 10;
}
export function leadershipNotice(row: LeadershipCollege): string {
  if (row.term_state === "missing") return "لم يُحدد فصل مطابق؛ المؤشرات الأكاديمية غير محسوبة";
  if (row.term_state === "ambiguous") return "أكثر من فصل مطابق؛ يلزم تحديد الفصل المعتمد";
  const notes: string[] = [];
  if (!row.version_id) notes.push("لا يوجد جدول منشور لهذا الفصل");
  if (row.incomplete_faculty) notes.push(`${row.incomplete_faculty} نصابًا غير مكتمل`);
  if (row.pending_groups) notes.push(`${row.pending_groups} مجموعة بانتظار توزيع التدريس المشترك`);
  if (row.overallocated_groups)
    notes.push(`${row.overallocated_groups} مجموعة بإسناد يتجاوز المطلوب`);
  if (row.year_inferred) notes.push("السنة مستمدة من اسم الفصل؛ يُرجى استكمال تعريفه");
  return notes.join(" · ") || "البيانات متاحة";
}

export const LEADERSHIP_WORKLOAD_HEADERS = [
  { key: "college", label: "الكلية" },
  { key: "faculty_count", label: "أعضاء هيئة التدريس" },
  { key: "net_quota", label: "النصاب المتاح المعتمد" },
  { key: "faculty_assigned_hours", label: "المسند لأعضاء الكلية" },
  { key: "overload", label: "الساعات الزائدة" },
  { key: "deficit", label: "نقص النصاب" },
  { key: "incomplete_faculty", label: "نصاب غير مكتمل" },
];
export const LEADERSHIP_ASSIGNMENT_HEADERS = [
  { key: "college", label: "الكلية" },
  { key: "groups_count", label: "مجموعات التدريس" },
  { key: "required_hours", label: "الساعات المطلوبة" },
  { key: "covered_hours", label: "الساعات المغطاة" },
  { key: "uncovered_hours", label: "عجز تغطية الإسناد" },
  { key: "pending_group_hours", label: "بانتظار التوزيع" },
  { key: "coverage", label: "تغطية الإسناد" },
];
export const LEADERSHIP_TEACHING_HEADERS = [
  { key: "college", label: "الكلية" },
  { key: "theory_hours", label: "نظري" },
  { key: "practical_hours", label: "عملي ومعامل" },
  { key: "other_hours", label: "مكونات أخرى" },
  { key: "teaching_hours", label: "إجمالي الساعات" },
  { key: "sessions_count", label: "المحاضرات" },
];
export const LEADERSHIP_ROOM_HEADERS = [
  { key: "college", label: "الكلية" },
  { key: "room_count", label: "إجمالي الموارد" },
  { key: "halls", label: "قاعات" },
  { key: "labs", label: "معامل" },
  { key: "seats", label: "المقاعد المتاحة" },
  { key: "used_rooms", label: "موارد مستخدمة في المنشور" },
];

export const LEADERSHIP_RANK_ORDER = [
  "أستاذ دكتور",
  "أستاذ",
  "أستاذ مشارك",
  "أستاذ مساعد",
  "محاضر",
  "مدرس",
  "معيد",
  "غير محدد",
] as const;

export const LEADERSHIP_AVAILABILITY_ORDER = [
  "متاح",
  "تفرغ علمي",
  "إجازة مرضية",
  "إجازة اعتيادية",
  "إجازة بدون راتب",
  "ابتعاث",
  "غير متاح",
] as const;

export const LEADERSHIP_EMPLOYMENT_LABELS: Record<string, string> = {
  full_time: "متفرغ",
  part_time: "غير متفرغ",
  visiting: "زائر",
  contract: "متعاقد",
  unknown: "غير محدد",
};

export function sumLeadershipCounts(
  rows: LeadershipCollege[],
  key: "rank_counts" | "availability_counts" | "employment_counts",
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const row of rows) {
    for (const [label, value] of Object.entries(row[key] ?? {})) {
      totals[label] = (totals[label] ?? 0) + Number(value ?? 0);
    }
  }
  return totals;
}

export function orderedLeadershipCounts(
  counts: Record<string, number>,
  preferred: readonly string[],
): Array<[string, number]> {
  const preferredSet = new Set(preferred);
  const extras = Object.entries(counts)
    .filter(([label, value]) => !preferredSet.has(label) && value > 0)
    .sort(([a], [b]) => a.localeCompare(b, "ar"));
  return [...preferred.map((label) => [label, counts[label] ?? 0] as [string, number]), ...extras];
}

export function sortLeadershipColleges(rows: LeadershipCollege[]): LeadershipCollege[] {
  return [...rows].sort((a, b) => {
    const priority = (name: string) => (name.includes("تكنولوجيا المعلومات وعلوم الحاسوب") ? 0 : 1);
    return priority(a.college) - priority(b.college) || a.college.localeCompare(b.college, "ar");
  });
}
