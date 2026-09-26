/**
 * Single source of truth for the university leadership metrics.
 *
 * Every card, college row, drill-down table and export on /reports/leadership
 * must read its label, definition and formula from this module. Nothing here
 * writes data; the constituent records come from the read-only RPC
 * `leadership_metric_details`.
 *
 * Deliberate separations that must never be merged:
 *  - «الساعات التدريسية المسندة للمقررات» counts component/group hours that
 *    carry an approved assignment (teaching-side measure).
 *  - «الساعات المسندة ضمن أنصبة المحاضرين» counts the same assignments
 *    projected onto each instructor's weekly quota, excluding components that
 *    do not count toward the regular load (quota-side measure).
 *  - «نقص الأنصبة» never overlaps «ساعات التدريس غير المسندة»: the first is a
 *    per-instructor quota gap, the second is unassigned teaching demand.
 */
import { z } from "zod";

export type LeadershipMetricSource = "faculty" | "teaching" | "schedules";

export const LEADERSHIP_UNCALCULATED = "غير محسوب";
export const LEADERSHIP_NEEDS_REVIEW = "يحتاج مراجعة";

/* ------------------------------------------------------------------ formulas */

/** المطلوب بعد الإعفاء لكل محاضر = max(الأساسي − الإعفاء، 0). */
export function requiredAfterRelease(
  baseQuota: number | null | undefined,
  releaseHours: number | null | undefined,
): number | null {
  if (baseQuota === null || baseQuota === undefined) return null;
  return Math.max(baseQuota - (releaseHours ?? 0), 0);
}

/** نقص نصاب المحاضر = max(المطلوب بعد الإعفاء − المسند للمحاضر، 0). */
export function quotaDeficit(
  required: number | null | undefined,
  assigned: number | null | undefined,
): number | null {
  if (required === null || required === undefined) return null;
  return Math.max(required - (assigned ?? 0), 0);
}

/** الساعات الزائدة = max(المسند للمحاضر − المطلوب بعد الإعفاء، 0). */
export function quotaOverload(
  required: number | null | undefined,
  assigned: number | null | undefined,
): number | null {
  if (required === null || required === undefined) return null;
  return Math.max((assigned ?? 0) - required, 0);
}

/**
 * نسبة التكليف المعتمد = ساعات المجموعات ذات التكليف الإداري المعتمد / إجمالي ساعات المجموعات المطلوبة.
 * ساعات النصاب لا تدخل المقام، ولا تُعرض نسبة إذا كان المقام أو كليات المصدر
 * غير مكتملة.
 */
export function assignmentCoveragePercent(input: {
  coveredCourseHours: number | null | undefined;
  requiredCourseHours: number | null | undefined;
  sourceComplete: boolean;
}): number | null {
  const { coveredCourseHours, requiredCourseHours, sourceComplete } = input;
  if (!sourceComplete) return null;
  if (
    coveredCourseHours === null ||
    coveredCourseHours === undefined ||
    requiredCourseHours === null ||
    requiredCourseHours === undefined ||
    requiredCourseHours <= 0
  )
    return null;
  return Math.round((coveredCourseHours / requiredCourseHours) * 1000) / 10;
}

/** المحاضر يُحتسب مرة واحدة بهويته الجامعية عبر جميع الكليات. */
export function uniqueFacultyCount(rows: Array<{ id?: unknown }>): number {
  return new Set(rows.map((row) => String(row.id ?? ""))).size;
}

/** الجلسة المشتركة تُحتسب مرة واحدة، والمجدول من النسخ المنشورة فقط. */
export function dedupePublishedSessions<T extends { id?: unknown; published?: unknown }>(
  rows: T[],
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    if (row.published === false) continue;
    const key = String(row.id ?? "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

/* ------------------------------------------------- card / detail consistency */

export type ReconcileStatus = "ok" | "needs_review" | "unknown";

/**
 * إجمالي التفاصيل يجب أن يساوي رقم البطاقة. عند الاختلاف نعرض «يحتاج مراجعة»
 * مع مقدار الفرق بدل رقم مضلل.
 */
export function reconcileMetric(
  cardValue: number | null | undefined,
  detailTotal: number | null | undefined,
  tolerance = 0.01,
): { status: ReconcileStatus; difference: number | null } {
  if (
    cardValue === null ||
    cardValue === undefined ||
    detailTotal === null ||
    detailTotal === undefined
  )
    return { status: "unknown", difference: null };
  const difference = Math.round((detailTotal - cardValue) * 100) / 100;
  return { status: Math.abs(difference) <= tolerance ? "ok" : "needs_review", difference };
}

/* ------------------------------------------------------------ metric registry */

export interface LeadershipMetricDefinition {
  id: string;
  label: string;
  /** تعريف قصير يظهر بجانب الرقم. */
  definition: string;
  source: LeadershipMetricSource;
  /** مفتاح الإجمالي في مخرجات دالة التفاصيل. */
  totalKey: string;
  unit?: "ساعة" | "محاضرة" | "محاضر" | "كلية";
}

export const LEADERSHIP_METRICS = {
  faculty_count: {
    id: "faculty_count",
    label: "أعضاء هيئة التدريس",
    definition: "عدد الهويات الجامعية الفريدة، لا مجموع صفوف الكليات.",
    source: "faculty",
    totalKey: "unique_faculty",
    unit: "محاضر",
  },
  net_quota: {
    id: "net_quota",
    label: "المطلوب بعد الإعفاء",
    definition: "لكل محاضر: أقصى(النصاب الأساسي − الإعفاء الإداري، 0) ثم يُجمع.",
    source: "faculty",
    totalKey: "net_quota",
    unit: "ساعة",
  },
  faculty_assigned_hours: {
    id: "faculty_assigned_hours",
    label: "الساعات المسندة ضمن أنصبة المحاضرين",
    definition:
      "الإسنادات المعتمدة محمولة على نصاب كل محاضر بهويته الجامعية عبر جميع الكليات دون تكرار، بعد استثناء ما لا يُحتسب في النصاب النظامي.",
    source: "faculty",
    totalKey: "assigned_hours",
    unit: "ساعة",
  },
  deficit: {
    id: "deficit",
    label: "نقص أنصبة المحاضرين",
    definition:
      "مجموع أقصى(المطلوب بعد الإعفاء − المسند للمحاضر، 0)؛ مقياس مستقل تمامًا عن ساعات التدريس غير المسندة.",
    source: "faculty",
    totalKey: "deficit_hours",
    unit: "ساعة",
  },
  overload: {
    id: "overload",
    label: "الساعات الزائدة",
    definition: "مجموع أقصى(المسند للمحاضر − المطلوب بعد الإعفاء، 0).",
    source: "faculty",
    totalKey: "overload_hours",
    unit: "ساعة",
  },
  required_course_hours: {
    id: "required_course_hours",
    label: "إجمالي الساعات التدريسية المطلوبة",
    definition: "ساعات مكونات ومجموعات التدريس الفعّالة المطلوبة تدريسها في الفصل.",
    source: "teaching",
    totalKey: "required_hours",
    unit: "ساعة",
  },
  covered_course_hours: {
    id: "covered_course_hours",
    label: "ساعات المجموعات بتكليف تدريسي معتمد",
    definition:
      "ساعات المكونات التي يوجد لها إسناد معتمد؛ تُقاس على المقرر/المجموعة وليست ساعات نصاب.",
    source: "teaching",
    totalKey: "covered_hours",
    unit: "ساعة",
  },
  uncovered_course_hours: {
    id: "uncovered_course_hours",
    label: "ساعات مجموعات بانتظار اعتماد التكليف",
    definition:
      "ساعات مكونات التدريس المطلوبة التي لم يُعتمد تكليفها إداريًا؛ قد تحمل محاضراتها المنشورة اسم محاضر، ولا تتداخل مع نقص الأنصبة.",
    source: "teaching",
    totalKey: "uncovered_hours",
    unit: "ساعة",
  },
  scheduled_hours: {
    id: "scheduled_hours",
    label: "الساعات المجدولة في النسخ المنشورة",
    definition: "جلسات النسخ المنشورة فقط، والجلسة المشتركة تُحتسب مرة واحدة.",
    source: "schedules",
    totalKey: "teaching_hours",
    unit: "ساعة",
  },
  sessions_count: {
    id: "sessions_count",
    label: "المحاضرات المنشورة",
    definition: "عدد جلسات النسخ المنشورة فقط دون تكرار.",
    source: "schedules",
    totalKey: "sessions_count",
    unit: "محاضرة",
  },
  published_colleges: {
    id: "published_colleges",
    label: "الكليات المنشورة",
    definition: "الكليات التي لها نسخة منشورة معتمدة لهذا الفصل.",
    source: "schedules",
    totalKey: "published",
    unit: "كلية",
  },
} as const satisfies Record<string, LeadershipMetricDefinition>;

export type LeadershipMetricKey = keyof typeof LEADERSHIP_METRICS;

/* ------------------------------------------------------------ detail payload */

const detailValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const leadershipDetailsSchema = z.object({
  ok: z.literal(true),
  metric: z.enum(["faculty", "teaching", "schedules"]),
  year: z.string().nullable(),
  term_type: z.string().nullable(),
  college_id: z.string().uuid().nullable(),
  generated_at: z.string(),
  rows: z.array(z.record(z.string(), detailValue)),
  totals: z.record(z.string(), z.union([z.number(), z.null()])),
});

export type LeadershipDetails = z.infer<typeof leadershipDetailsSchema>;
export type LeadershipDetailRow = LeadershipDetails["rows"][number];

export interface LeadershipDetailColumn {
  key: string;
  label: string;
  numeric?: boolean;
}

const HOURS_SUM_KEYS: Record<LeadershipMetricSource, string> = {
  faculty: "assigned_hours",
  teaching: "required_hours",
  schedules: "teaching_hours",
};

export function detailHoursKey(source: LeadershipMetricSource): string {
  return HOURS_SUM_KEYS[source];
}

export const LEADERSHIP_DETAIL_COLUMNS: Record<LeadershipMetricSource, LeadershipDetailColumn[]> = {
  faculty: [
    { key: "name", label: "المحاضر" },
    { key: "university_number", label: "الرقم الجامعي" },
    { key: "college", label: "الكلية الأصلية" },
    { key: "status", label: "الحالة" },
    { key: "rank", label: "الرتبة" },
    { key: "base_quota", label: "الأساسي", numeric: true },
    { key: "release_hours", label: "الإعفاء", numeric: true },
    { key: "required_hours", label: "المطلوب بعد الإعفاء", numeric: true },
    { key: "assigned_hours", label: "المسند عبر الكليات", numeric: true },
    { key: "scheduled_hours", label: "المجدول في المنشور", numeric: true },
    { key: "deficit_hours", label: "النقص", numeric: true },
    { key: "overload_hours", label: "الزيادة", numeric: true },
    { key: "teaching_colleges", label: "يدرّس في" },
    { key: "incomplete_reason", label: "سبب عدم الاحتساب" },
  ],
  teaching: [
    { key: "college", label: "الكلية" },
    { key: "department", label: "القسم" },
    { key: "program", label: "البرنامج" },
    { key: "study_system", label: "النظام" },
    { key: "cohort", label: "الدفعة" },
    { key: "course_code", label: "رمز المقرر" },
    { key: "course", label: "المقرر" },
    { key: "component_type", label: "المكوّن" },
    { key: "group_code", label: "المجموعة" },
    { key: "required_hours", label: "الساعات المطلوبة", numeric: true },
    { key: "covered_hours", label: "بتكليف معتمد", numeric: true },
    { key: "uncovered_hours", label: "بانتظار اعتماد التكليف", numeric: true },
    { key: "assignment_status", label: "حالة التكليف" },
    { key: "instructors", label: "المحاضرون" },
  ],
  schedules: [
    { key: "college", label: "الكلية" },
    { key: "term", label: "الفصل" },
    { key: "version", label: "النسخة المنشورة" },
    { key: "sessions_count", label: "المحاضرات", numeric: true },
    { key: "teaching_hours", label: "الساعات", numeric: true },
    { key: "theory_hours", label: "نظري", numeric: true },
    { key: "practical_hours", label: "عملي", numeric: true },
    { key: "unplaced_sessions", label: "غير مسكّنة", numeric: true },
    { key: "used_rooms", label: "قاعات مستخدمة", numeric: true },
  ],
};

export const LEADERSHIP_ASSIGNMENT_STATUS_LABELS: Record<string, string> = {
  unassigned: "دون تكليف معتمد",
  under_allocated: "إسناد ناقص",
  over_allocated: "إسناد زائد",
  fully_allocated: "مسند بالكامل",
};

/** بحث نصي عربي بسيط داخل صفوف التفاصيل. */
export function filterDetailRows(
  rows: LeadershipDetailRow[],
  options: { search?: string; collegeId?: string | null },
): LeadershipDetailRow[] {
  const needle = (options.search ?? "").trim().toLowerCase();
  return rows.filter((row) => {
    if (options.collegeId && String(row.college_id ?? "") !== options.collegeId) return false;
    if (!needle) return true;
    return Object.values(row).some((value) =>
      value === null || value === undefined ? false : String(value).toLowerCase().includes(needle),
    );
  });
}

export function sumDetailColumn(rows: LeadershipDetailRow[], key: string): number {
  return (
    Math.round(
      rows.reduce(
        (total, row) => total + (typeof row[key] === "number" ? Number(row[key]) : 0),
        0,
      ) * 100,
    ) / 100
  );
}

export function detailCollegeOptions(
  rows: LeadershipDetailRow[],
): Array<{ id: string; name: string }> {
  const map = new Map<string, string>();
  for (const row of rows) {
    const id = row.college_id ? String(row.college_id) : "";
    if (!id) continue;
    map.set(id, String(row.college ?? LEADERSHIP_UNCALCULATED));
  }
  return [...map.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "ar"));
}
