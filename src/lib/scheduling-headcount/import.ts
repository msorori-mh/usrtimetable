import type { SchedulingHeadcount } from "./types";

export const HEADCOUNT_LIMIT = 500;
export const COUNT_COLUMNS = [
  ["registered_student_count", "عدد_المسجلين"],
  ["eligible_student_count", "عدد_المؤهلين"],
  ["expected_attendance_count", "الحضور_المتوقع"],
  ["reserve_margin", "هامش_الاحتياط"],
  ["scheduling_headcount", "العدد_المعتمد_للجدولة"],
  ["exam_eligible_count", "المؤهلون_للاختبار"],
] as const;
export const HEADCOUNT_HEADERS = ["رمز_الدفعة", "رمز_الفصل", ...COUNT_COLUMNS.map((c) => c[1]), "المصدر", "ملاحظات"];
type CountKey = (typeof COUNT_COLUMNS)[number][0];
export interface ImportCohort {
  id: string; code: string | null; term_id: string; term_code: string;
  term_name: string; program_code: string; program_name: string;
  level_number: number; study_system: string; entry_year: number;
  expected_students: number; cohort_version: string; expected_version: string | null;
  headcount: SchedulingHeadcount | null;
}
export type HeadcountImportRow = Record<CountKey, number> & {
  row: number; cohort_id: string; term_id: string; cohort_version: string;
  expected_version: string | null; source: string; notes: string | null;
  allow_over_eligible: boolean;
};
export interface HeadcountPreview {
  rows: HeadcountImportRow[];
  errors: { row: number; column: string; message: string }[];
  total: number;
}
export const normalizeNumber = (v: unknown) => String(v ?? "").trim()
  .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 1632))
  .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 1776));
const clean = (v: unknown) => String(v ?? "").trim();
const normalizeHeader = (v: unknown) => clean(v).replace(/^\uFEFF/, "").replace(/\s+/g, "_");

/** Resolves exact cohort + term in the active college; never infers a missing count. */
export function previewHeadcounts(
  matrix: unknown[][], cohorts: ImportCohort[],
  options: { sameCounts: boolean; allowOverEligible: boolean; source: string },
): HeadcountPreview {
  const result: HeadcountPreview = { rows: [], errors: [], total: 0 };
  const fail = (row: number, column: string, message: string) => result.errors.push({ row, column, message });
  const aliases: Record<string, string> = {
    cohort_code: "رمز_الدفعة", term_code: "رمز_الفصل", source: "المصدر", notes: "ملاحظات",
    expected_students: "الطلاب_المتوقعون", program_code: "رمز_البرنامج", level_number: "رقم_المستوى",
    study_system: "نظام_الدراسة", entry_year: "سنة_الدخول",
    ...Object.fromEntries(COUNT_COLUMNS),
  };
  const headers = (matrix[0] ?? []).map((h) => aliases[normalizeHeader(h)] ?? normalizeHeader(h));
  for (const h of headers.filter(Boolean)) if (headers.indexOf(h) !== headers.lastIndexOf(h)) fail(1, h, "عنوان عمود مكرر");
  const legacy = headers.includes("الطلاب_المتوقعون") && !COUNT_COLUMNS.some((c) => headers.includes(c[1]));
  if (legacy && !options.sameCounts) fail(1, "الطلاب_المتوقعون", "هذا الملف يحتوي عددًا واحدًا؛ أكد تساوي الفئات أو استخدم القالب التفصيلي.");
  const required = ["رمز_الدفعة", "رمز_الفصل", ...(legacy ? ["الطلاب_المتوقعون"] : COUNT_COLUMNS.map((c) => c[1]))];
  for (const h of required) if (!headers.includes(h)) fail(1, h, "عمود مطلوب غير موجود");
  if (result.errors.length) return result;
  const seen = new Map<string, number>();
  for (let i = 1; i < matrix.length; i++) {
    const cells = matrix[i] ?? [];
    if (!cells.some((v) => clean(v))) continue;
    result.total++;
    if (result.total > HEADCOUNT_LIMIT) { fail(i + 1, "الملف", `الحد الأقصى ${HEADCOUNT_LIMIT} صف في الملف`); break; }
    const row = i + 1, before = result.errors.length;
    const value = (h: string) => cells[headers.indexOf(h)];
    const code = clean(value("رمز_الدفعة")), term = clean(value("رمز_الفصل"));
    const matches = cohorts.filter((c) => c.code === code && c.term_code === term);
    if (!code || !term || matches.length !== 1) {
      fail(row, "رمز_الدفعة / رمز_الفصل", "لم توجد دفعة نشطة وفصل نشط مطابقان بشكل فريد في الكلية المختارة.");
      continue;
    }
    const cohort = matches[0], key = `${cohort.id}:${cohort.term_id}`;
    if (seen.has(key)) {
      fail(row, "رمز_الدفعة", `دفعة وفصل مكرران؛ ظهرا في الصف ${seen.get(key)}`);
      continue;
    }
    seen.set(key, row);
    for (const [h, expected] of [
      ["رمز_البرنامج", cohort.program_code], ["رقم_المستوى", cohort.level_number],
      ["نظام_الدراسة", cohort.study_system], ["سنة_الدخول", cohort.entry_year],
    ] as const) {
      if (headers.includes(h) && normalizeNumber(value(h)) !== String(expected)) fail(row, h, "لا يطابق بيانات الدفعة المسجلة.");
    }
    const counts = {} as Record<CountKey, number>;
    for (const [key, h] of COUNT_COLUMNS) {
      const raw = legacy ? (key === "reserve_margin" ? 0 : value("الطلاب_المتوقعون")) : value(h);
      const s = normalizeNumber(raw), n = Number(s);
      if (!/^\d+$/.test(s) || !Number.isSafeInteger(n) || n > 2147483647) fail(row, h, "أدخل عددًا صحيحًا غير سالب؛ الخلية الفارغة ليست صفرًا.");
      counts[key] = n;
    }
    if (counts.scheduling_headcount === 0) fail(row, "العدد_المعتمد_للجدولة", "يلزم عدد أكبر من صفر لإعداد دفعة للجدولة.");
    const source = clean(value("المصدر")) || clean(options.source);
    const notes = clean(value("ملاحظات")) || null;
    if (!source || source.length > 500) fail(row, "المصدر", "المصدر مطلوب وبحد أقصى 500 حرف.");
    if (notes && notes.length > 2000) fail(row, "ملاحظات", "الحد الأقصى 2000 حرف.");
    const over = counts.scheduling_headcount > counts.eligible_student_count || counts.expected_attendance_count > counts.eligible_student_count;
    if (over && (!options.allowOverEligible || !notes)) fail(row, "ملاحظات", "تجاوز المؤهلين يتطلب تفعيل الاستثناء وسببًا في ملاحظات الصف.");
    if (result.errors.length === before) result.rows.push({
      row, cohort_id: cohort.id, term_id: cohort.term_id, cohort_version: cohort.cohort_version,
      expected_version: cohort.expected_version, ...counts, source, notes, allow_over_eligible: options.allowOverEligible,
    });
  }
  if (result.total === 0) fail(1, "الملف", "الملف لا يحتوي صفوف بيانات.");
  return result;
}
