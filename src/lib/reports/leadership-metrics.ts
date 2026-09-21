import { z } from "zod";

/**
 * Single source of truth for the university leadership metrics: the label, the
 * plain-Arabic definition, which read-only detail source proves it, and which
 * detail column must add up to the card value.
 *
 * Nothing here writes data. `leadership_metric_details` is a read-only RPC
 * guarded by the same role check as the leadership dashboard.
 */
export type LeadershipDetailSource = "faculty" | "teaching" | "schedules";

export type LeadershipMetricKey =
  | "faculty_count"
  | "available_faculty"
  | "assignment_coverage"
  | "uncovered_hours"
  | "required_after_release"
  | "faculty_assigned_hours"
  | "scheduled_hours"
  | "overload_hours"
  | "quota_deficit_hours"
  | "published_sessions"
  | "published_versions";

export type LeadershipMetricDefinition = {
  key: LeadershipMetricKey;
  label: string;
  definition: string;
  source: LeadershipDetailSource;
  /** Detail column whose sum must equal the displayed card value. */
  detailColumn: string | null;
  /** When true the card value is a record count, not a column sum. */
  countsRecords?: boolean;
  unit: "hours" | "people" | "records";
};

const metric = (definition: LeadershipMetricDefinition) => definition;

export const LEADERSHIP_METRICS: Record<LeadershipMetricKey, LeadershipMetricDefinition> = {
  faculty_count: metric({
    key: "faculty_count",
    label: "أعضاء هيئة التدريس",
    definition: "عدد الهويات الجامعية الفريدة؛ المحاضر الذي يدرّس في أكثر من كلية يُحتسب مرة واحدة.",
    source: "faculty",
    detailColumn: null,
    countsRecords: true,
    unit: "people",
  }),
  available_faculty: metric({
    key: "available_faculty",
    label: "المحاضرون المتاحون",
    definition: "الهويات التي حالتها «متاح» في بيانات المحاضرين الحالية.",
    source: "faculty",
    detailColumn: null,
    countsRecords: true,
    unit: "people",
  }),
  assignment_coverage: metric({
    key: "assignment_coverage",
    label: "تغطية إسناد الساعات التدريسية للمقررات",
    definition:
      "الساعات التدريسية المغطاة بإسناد ÷ الساعات التدريسية المطلوبة لمجموعات التدريس. لا تُعرض نسبة إذا كان المقام صفرًا أو كانت بيانات إحدى الكليات ناقصة.",
    source: "teaching",
    detailColumn: "covered_hours",
    unit: "hours",
  }),
  uncovered_hours: metric({
    key: "uncovered_hours",
    label: "ساعات التدريس غير المسندة",
    definition: "ساعات مجموعات التدريس التي لا يقابلها إسناد محاضر. مستقلة عن نقص أنصبة المحاضرين.",
    source: "teaching",
    detailColumn: "uncovered_hours",
    unit: "hours",
  }),
  required_after_release: metric({
    key: "required_after_release",
    label: "المطلوب بعد الإعفاء",
    definition: "النصاب الأساسي ناقص ساعات الإعفاء لكل محاضر، مجموعًا على الهويات الفريدة.",
    source: "faculty",
    detailColumn: "required_hours",
    unit: "hours",
  }),
  faculty_assigned_hours: metric({
    key: "faculty_assigned_hours",
    label: "الساعات المسندة ضمن أنصبة المحاضرين",
    definition:
      "ساعات الإسناد المحسوبة داخل نصاب المحاضر. تختلف عن الساعات التدريسية المسندة للمقررات.",
    source: "faculty",
    detailColumn: "assigned_hours",
    unit: "hours",
  }),
  scheduled_hours: metric({
    key: "scheduled_hours",
    label: "المجدول في النسخ المنشورة",
    definition: "ساعات الجلسات في النسخ المنشورة فقط؛ لا تُحسب من الإسنادات ولا من المسودات.",
    source: "schedules",
    detailColumn: "teaching_hours",
    unit: "hours",
  }),
  overload_hours: metric({
    key: "overload_hours",
    label: "الساعات الزائدة",
    definition: "مجموع ما يتجاوز به المحاضرون مطلوبهم بعد الإعفاء؛ لا يشمل ساعات التدريس غير المسندة.",
    source: "faculty",
    detailColumn: "overload_hours",
    unit: "hours",
  }),
  quota_deficit_hours: metric({
    key: "quota_deficit_hours",
    label: "ساعات نقص أنصبة المحاضرين",
    definition:
      "الفرق بين المطلوب بعد الإعفاء والمسند لكل محاضر. مقياس مستقل تمامًا عن ساعات التدريس غير المسندة.",
    source: "faculty",
    detailColumn: "deficit_hours",
    unit: "hours",
  }),
  published_sessions: metric({
    key: "published_sessions",
    label: "المحاضرات المنشورة",
    definition: "عدد جلسات النسخ المنشورة؛ الجلسة المشتركة بين كليتين تُحتسب مرة واحدة.",
    source: "schedules",
    detailColumn: "sessions_count",
    unit: "records",
  }),
  published_versions: metric({
    key: "published_versions",
    label: "حالة الجداول",
    definition: "عدد الكليات التي لديها نسخة منشورة معتمدة لهذه الفترة.",
    source: "schedules",
    detailColumn: null,
    countsRecords: true,
    unit: "records",
  }),
};

export const leadershipDetailSchema = z.object({
  ok: z.boolean().optional().default(true),
  metric: z.string(),
  year: z.string().nullable().optional(),
  term_type: z.string().nullable().optional(),
  college_id: z.string().nullable().optional(),
  generated_at: z.string().optional(),
  rows: z.array(z.record(z.string(), z.unknown())).default([]),
  totals: z.record(z.string(), z.unknown()).default({}),
});
export type LeadershipDetailPayload = z.infer<typeof leadershipDetailSchema>;
export type LeadershipDetailRow = Record<string, unknown>;

const round2 = (value: number) => Math.round(value * 100) / 100;
const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** المطلوب بعد الإعفاء = النصاب الأساسي - ساعات الإعفاء (لا يقل عن صفر). */
export function requiredAfterRelease(
  baseQuota: number | null | undefined,
  releaseHours: number | null | undefined,
): number | null {
  if (baseQuota === null || baseQuota === undefined) return null;
  return round2(Math.max(0, baseQuota - (releaseHours ?? 0)));
}

/** نقص النصاب = المطلوب بعد الإعفاء - المسند ضمن النصاب. لا علاقة له بالساعات غير المسندة. */
export function quotaDeficit(
  required: number | null | undefined,
  assigned: number | null | undefined,
): number | null {
  if (required === null || required === undefined) return null;
  return round2(Math.max(0, required - (assigned ?? 0)));
}

/** الساعات الزائدة = المسند ضمن النصاب - المطلوب بعد الإعفاء. */
export function quotaOverload(
  required: number | null | undefined,
  assigned: number | null | undefined,
): number | null {
  if (required === null || required === undefined || assigned === null || assigned === undefined)
    return null;
  return round2(Math.max(0, assigned - required));
}

/**
 * تغطية إسناد الساعات التدريسية للمقررات. تُعاد null عند نقص المصدر بدل عرض 0 أو 100%.
 */
export function assignmentCoveragePercent(input: {
  required: number | null | undefined;
  covered: number | null | undefined;
  incompleteColleges?: number;
}): number | null {
  const required = num(input.required);
  const covered = num(input.covered);
  if (required === null || covered === null) return null;
  if (required <= 0) return null;
  if ((input.incompleteColleges ?? 0) > 0) return null;
  return Math.round((covered / required) * 1000) / 10;
}

/** عدد المحاضرين = الهويات الفريدة، حتى لو ظهر المحاضر في أكثر من كلية. */
export function uniqueFacultyCount(rows: LeadershipDetailRow[], key = "identity_id"): number {
  const seen = new Set<string>();
  for (const row of rows) {
    const id = row[key];
    if (typeof id === "string" && id !== "") seen.add(id);
  }
  return seen.size;
}

/** حصر الجلسات في النسخ المنشورة ومنع تكرار الجلسة المشتركة. */
export function dedupePublishedSessions<T extends LeadershipDetailRow>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    if (row["published"] === false) continue;
    const id = row["session_id"] ?? row["version"] ?? row["college"];
    const key = typeof id === "string" || typeof id === "number" ? String(id) : JSON.stringify(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

export type LeadershipReconciliation =
  | { status: "ok"; card: number; detail: number }
  | { status: "needs_review"; card: number | null; detail: number | null; difference: number | null };

/**
 * تحقق اتساق: مجموع التفاصيل يجب أن يساوي رقم البطاقة، وإلا «يحتاج مراجعة».
 */
export function reconcileMetric(
  card: number | null | undefined,
  detail: number | null | undefined,
  tolerance = 0.01,
): LeadershipReconciliation {
  const cardValue = num(card);
  const detailValue = num(detail);
  if (cardValue === null || detailValue === null)
    return {
      status: "needs_review",
      card: cardValue,
      detail: detailValue,
      difference: null,
    };
  const difference = round2(detailValue - cardValue);
  if (Math.abs(difference) <= tolerance)
    return { status: "ok", card: cardValue, detail: detailValue };
  return { status: "needs_review", card: cardValue, detail: detailValue, difference };
}

export function sumDetailColumn(rows: LeadershipDetailRow[], column: string | null): number | null {
  if (!column) return rows.length;
  const values = rows.map((row) => num(row[column])).filter((value): value is number => value !== null);
  if (values.length === 0) return rows.length === 0 ? 0 : null;
  return round2(values.reduce((total, value) => total + value, 0));
}

export function detailCollegeOptions(rows: LeadershipDetailRow[]): string[] {
  return [
    ...new Set(
      rows
        .map((row) => row["college"])
        .filter((value): value is string => typeof value === "string" && value !== ""),
    ),
  ].sort((a, b) => a.localeCompare(b, "ar"));
}

export function detailDepartmentOptions(rows: LeadershipDetailRow[]): string[] {
  return [
    ...new Set(
      rows
        .map((row) => row["department"])
        .filter((value): value is string => typeof value === "string" && value !== ""),
    ),
  ].sort((a, b) => a.localeCompare(b, "ar"));
}

export function filterDetailRows(
  rows: LeadershipDetailRow[],
  filters: { search?: string; college?: string; department?: string },
): LeadershipDetailRow[] {
  const search = (filters.search ?? "").trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.college && filters.college !== "all" && row["college"] !== filters.college)
      return false;
    if (
      filters.department &&
      filters.department !== "all" &&
      row["department"] !== filters.department
    )
      return false;
    if (!search) return true;
    return Object.values(row).some(
      (value) =>
        (typeof value === "string" || typeof value === "number") &&
        String(value).toLowerCase().includes(search),
    );
  });
}
