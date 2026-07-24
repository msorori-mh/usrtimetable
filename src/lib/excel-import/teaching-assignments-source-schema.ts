/**
 * Academic source workbook schema for teaching assignments bulk import.
 * Dual-mode: auto-detect vs official teaching_assignments_v2 template.
 */
import { TEMPLATES } from "./templates";

/** Source workbook column headers (Arabic). */
export const SOURCE_WORKBOOK_COLUMNS = [
  "م",
  "الاسم",
  "اسم المادة",
  "المستوى",
  "البرنامج",
  "اجمالي الساعات",
  "ملاحظات",
] as const;

export type SourceWorkbookColumn = (typeof SOURCE_WORKBOOK_COLUMNS)[number];

export const SOURCE_COLUMN_KEYS = {
  serial: "م",
  instructorName: "الاسم",
  courseName: "اسم المادة",
  level: "المستوى",
  program: "البرنامج",
  totalHours: "اجمالي الساعات",
  notes: "ملاحظات",
} as const;

/** Sheets skipped during source workbook parsing. */
export const SOURCE_WORKBOOK_SKIP_SHEETS = new Set([
  "تعليمات",
  "metadata",
  "Metadata",
  "أنواع_القاعات",
]);

export type TeachingImportWorkbookMode = "official_template" | "academic_source_workbook";

/** Study system scope selector (mandatory for source workbook import UI). */
export type SourceStudySystemScope = "regular_only" | "parallel_only" | "both";

export const SOURCE_STUDY_SYSTEM_OPTIONS: ReadonlyArray<{
  value: SourceStudySystemScope;
  label: string;
  systems: readonly ("regular" | "parallel")[];
}> = [
  { value: "regular_only", label: "منتظم فقط", systems: ["regular"] },
  { value: "parallel_only", label: "نفقة خاصة فقط", systems: ["parallel"] },
  { value: "both", label: "المنتظم والنفقة الخاصة", systems: ["regular", "parallel"] },
];

export function expandStudySystems(scope: SourceStudySystemScope): ("regular" | "parallel")[] {
  const opt = SOURCE_STUDY_SYSTEM_OPTIONS.find((o) => o.value === scope);
  return opt ? [...opt.systems] : ["regular"];
}

const OFFICIAL_REQUIRED = TEMPLATES.teaching_assignments_v2.columns
  .filter((c) => c.required)
  .map((c) => c.header);

function headerSet(headers: string[]): Set<string> {
  return new Set(headers.map((h) => h.trim()).filter(Boolean));
}

/** Detect workbook mode from sheet headers. */
export function detectTeachingImportWorkbookMode(
  sheetHeaders: ReadonlyArray<ReadonlyArray<string>>,
): TeachingImportWorkbookMode {
  for (const headers of sheetHeaders) {
    const hs = headerSet(headers);
    const officialHits = OFFICIAL_REQUIRED.filter((h) => hs.has(h)).length;
    const sourceHits = SOURCE_WORKBOOK_COLUMNS.filter((h) => hs.has(h)).length;
    if (officialHits >= OFFICIAL_REQUIRED.length) return "official_template";
    if (sourceHits >= SOURCE_WORKBOOK_COLUMNS.length - 1) return "academic_source_workbook";
  }
  return "official_template";
}

export function isSourceWorkbookHeaderRow(headers: string[]): boolean {
  const hs = headerSet(headers);
  return (
    hs.has(SOURCE_COLUMN_KEYS.instructorName) &&
    hs.has(SOURCE_COLUMN_KEYS.courseName) &&
    hs.has(SOURCE_COLUMN_KEYS.program)
  );
}

export function isTotalOrSummaryRow(values: Record<string, unknown>): boolean {
  const joined = Object.values(values)
    .map((v) => String(v ?? "").trim())
    .join(" ");
  const lower = joined.toLocaleLowerCase("ar");
  if (!joined) return true;
  if (lower.includes("اجمالي") || lower.includes("إجمالي")) return true;
  if (lower.includes("المجموع") || lower.includes("total")) return true;
  return false;
}
