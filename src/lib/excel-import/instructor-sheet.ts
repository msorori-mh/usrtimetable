import type { ColumnDef, ParsedRow, RowError } from "./types";
import { normalizeArabicText, normalizeDecimalDigits } from "./arabic-normalize";
import { ACADEMIC_RANKS, UNKNOWN_EMPLOYMENT_TYPE } from "../instructor-metadata";
import { isHourlyContractTypeCode } from "@/lib/instructors/effective-hours";
import {
  normalizeAdministrativePosition,
  requiresAdministrativeDepartment,
} from "@/lib/instructors/administrative-positions";

const headerKey = (value: unknown) =>
  normalizeArabicText(String(value ?? ""))
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
// Names are matched exactly apart from whitespace and Arabic letter variants; never fuzzily.
const nameKey = (value: unknown) => normalizeArabicText(String(value ?? "")).toLowerCase();

const ALIASES: Record<string, string[]> = {
  full_name: ["اسم المدرس", "الاسم الكامل", "اسم المحاضر", "الاسم الافتراضي"],
  full_name_ar: ["الاسم بالعربية", "الاسم الرباعي"],
  specialization: ["القسم", "القسم (التخصص)", "التخصص"],
  max_weekly_hours: ["النصاب الأسبوعي (ساعة)", "النصاب الأسبوعي", "أقصى ساعات أسبوعية"],
  academic_rank: ["الرتبة الأكاديمية", "الرتبة العلمية"],
  instructor_type_code: ["نوع المحاضر رمز", "فئة المحاضر رمز"],
  affiliation_college_code: ["كلية التبعية رمز"],
  affiliation_department_code: ["قسم التبعية رمز"],
  administrative_department_code: ["قسم الرئاسة رمز"],
  employment_type: ["نوع التوظيف", "حالة التفرغ التعاقد"],
  email: ["البريد الالكتروني", "البريد الإلكتروني"],
  phone: ["الهاتف", "الجوال", "التلفون الواتساب"],
  admin_tasks: ["الصفة", "المهام الإدارية"],
  is_active: ["الحالة", "نشط"],
};

export function instructorHeader(header: unknown, columns: ColumnDef[]): string {
  const key = headerKey(header);
  const column = columns.find((c) =>
    [c.header, c.key, ...(c.headerAliases ?? []), ...(ALIASES[c.key] ?? [])].some(
      (h) => headerKey(h) === key,
    ),
  );
  return column?.header ?? String(header ?? "").trim();
}

export interface InstructorSheet {
  headers: string[];
  rows: Record<string, unknown>[];
  rowNumbers: number[];
  sheetName: string;
  headerRowNumber: number;
}

/** Locate the real header beneath report titles and preserve Excel row numbers. */
export async function parseInstructorSheet(
  file: File,
  columns: ColumnDef[],
): Promise<InstructorSheet> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const fieldHeader = (key: string) => columns.find((c) => c.key === key)!.header;
  const candidates: InstructorSheet[] = [];
  for (const sheetName of workbook.SheetNames) {
    if (["Metadata", "تعليمات"].includes(sheetName)) continue;
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
      header: 1,
      defval: "",
      raw: false,
      blankrows: true,
      range: 0,
    });
    const index = matrix.slice(0, 50).findIndex((row) => {
      const headers = row.map((h) => instructorHeader(h, columns));
      return (
        headers.includes(fieldHeader("full_name")) &&
        (headers.includes(fieldHeader("employee_number")) ||
          (headers.includes(fieldHeader("specialization")) &&
            headers.includes(fieldHeader("max_weekly_hours"))))
      );
    });
    if (index < 0) continue;
    const rawHeaders = matrix[index];
    const selected = rawHeaders.flatMap((h, i) => {
      if (!String(h ?? "").trim() || headerKey(h) === "م") return [];
      return [{ index: i, header: instructorHeader(h, columns) }];
    });
    const rows: Record<string, unknown>[] = [];
    const rowNumbers: number[] = [];
    for (let i = index + 1; i < matrix.length; i++) {
      if (!matrix[i].some((cell) => String(cell ?? "").trim())) continue;
      rows.push(Object.fromEntries(selected.map((c) => [c.header, matrix[i][c.index] ?? ""])));
      rowNumbers.push(i + 1);
    }
    candidates.push({
      headers: selected.map((c) => c.header),
      rows,
      rowNumbers,
      sheetName,
      headerRowNumber: index + 1,
    });
  }
  if (candidates.length !== 1)
    throw new Error(
      candidates.length
        ? "يوجد أكثر من كشف مدرسين. ارفع كشفًا واحدًا لكل كلية حتى لا تختلط البيانات."
        : "لم أجد جدول المدرسين. يلزم اسم المدرس مع رقم الموظف، أو مع القسم والنصاب الأسبوعي.",
    );
  return candidates[0];
}

const STATUS_NOTE = "الحالة الوظيفية: ";
const LEGACY_STATUS_NOTE = "الحالة في الكشف: ";
const INSTRUCTOR_INACTIVE_STATUS_REASONS = [
  "ابتعاث",
  "إجازة مرضية",
  "إجازة بدون راتب",
  "إجازة اعتيادية",
  "تفرغ علمي",
] as const;

export function instructorStatusLabel(isActive: boolean, notes: string | null | undefined): string {
  const lines = notes?.split("\n") ?? [];
  const canonical = lines.find((line) => line.startsWith(STATUS_NOTE))?.slice(STATUS_NOTE.length);
  const legacy = lines
    .find((line) => line.includes(LEGACY_STATUS_NOTE))
    ?.split(LEGACY_STATUS_NOTE)[1]
    ?.split("—")[0]
    ?.trim();
  const status = canonical?.trim() || legacy;
  if (!isActive && status) return status;
  return isActive ? "نشط" : "غير نشط";
}

export function parseInstructorStatus(value: unknown): { active: boolean; reason?: string } | null {
  const key = headerKey(value).toLowerCase();
  if (["نشط", "true", "1", "yes", "نعم", "y"].includes(key)) return { active: true };
  if (["غير نشط", "false", "0", "no", "لا", "n"].includes(key)) return { active: false };
  const reason = INSTRUCTOR_INACTIVE_STATUS_REASONS.find((status) => key === headerKey(status));
  if (reason) return { active: false, reason };
  return null;
}

export interface ExistingInstructor extends Record<string, unknown> {
  employee_number: string | null;
  university_number?: string | null;
  university_number_aliases?: string[];
  full_name: string;
  full_name_ar?: string | null;
  affiliation_college_id?: string | null;
  affiliation_department_id?: string | null;
  administrative_position?: string | null;
  administrative_department_id?: string | null;
}

/** Resolve identity within the selected college and retain fields omitted from a source report. */
export function prepareInstructorRow(
  row: ParsedRow,
  existing: ExistingInstructor[],
  columns: ColumnDef[],
  departments: { id: string; name: string }[] = [],
): RowError[] {
  const v = row.values;
  const hourlyContract = isHourlyContractTypeCode(String(v.instructor_type_code ?? ""));
  const errors: RowError[] = [];
  const fail = (key: string, code: string, message: string) =>
    errors.push({
      rowNumber: row.rowNumber,
      columnName: columns.find((c) => c.key === key)?.header,
      errorCode: code,
      message: `${String(v.full_name ?? "مدرس بدون اسم")}: ${message}`,
    });
  const universityNumber = String(v.university_number ?? "")
    .trim()
    .toUpperCase();
  if (universityNumber) {
    const numbered = existing.filter(
      (i) =>
        i.university_number === universityNumber ||
        i.university_number_aliases?.includes(universityNumber),
    );
    if (numbered.length !== 1) {
      fail(
        "university_number",
        "university_identity_not_unique",
        "الرقم الجامعي غير موجود أو مرتبط بأكثر من سجل داخل الكلية. راجع السجل قبل الاستيراد.",
      );
    } else {
      const identified = numbered[0];
      if (
        v.employee_number &&
        String(v.employee_number).trim().toLowerCase() !==
          identified.employee_number?.trim().toLowerCase()
      ) {
        fail(
          "university_number",
          "university_employee_mismatch",
          "الرقم الجامعي ورقم الموظف يشيران إلى سجلين مختلفين.",
        );
      }
      if (!identified.employee_number && nameKey(v.full_name) !== nameKey(identified.full_name)) {
        fail(
          "university_number",
          "university_name_mismatch",
          "احتفظ بالاسم الحالي للسجل الذي لا يملك رقم موظف لمنع إنشاء سجل مكرر.",
        );
      }
      v.employee_number = identified.employee_number;
    }
  }
  const employee = String(v.employee_number ?? "")
    .trim()
    .toLowerCase();
  const byName = existing.filter((i) =>
    [i.full_name, i.full_name_ar].some((n) => !!n && nameKey(n) === nameKey(v.full_name)),
  );
  const matches = employee
    ? existing.filter((i) => i.employee_number?.trim().toLowerCase() === employee)
    : byName;
  if (matches.length > 1)
    fail(
      "employee_number",
      "ambiguous_instructor",
      "توجد سجلات متعددة مطابقة. حدّد رقم الموظف الصحيح وأزل التكرار قبل الاستيراد.",
    );
  if (employee && !matches.length && byName.length)
    fail(
      "employee_number",
      "instructor_identity_conflict",
      "الاسم موجود برقم موظف مختلف. استخدم الرقم الحالي لمنع تكرار المدرس.",
    );
  const current = matches.length === 1 ? matches[0] : undefined;
  if (!employee) {
    if (!hourlyContract && current?.employee_number) {
      v.employee_number = current.employee_number;
      v._matched_by_name = true;
    } else if (
      !current &&
      !["permanent", "annual_contract", "con"].includes(
        String(v.instructor_type_code ?? "").toLowerCase(),
      )
    )
      fail(
        "instructor_type_code",
        "instructor_employment_category_required",
        "حدّد فئة الموظف الجديد لإصدار الرقم تلقائياً: permanent أو annual_contract أو con.",
      );
  }
  if (current) {
    for (const column of columns) {
      if (Object.hasOwn(v, column.key)) continue;
      if (column.key === "department_code") v._department_id = current.department_id ?? null;
      else if (column.key === "instructor_type_code")
        v._instructor_type_id = current.instructor_type_id ?? null;
      else v[column.key] = current[column.key] ?? null;
    }
  }
  v.employment_type = String(v.employment_type ?? "").trim() || UNKNOWN_EMPLOYMENT_TYPE;
  const statusHeader = columns.find((c) => c.key === "is_active")!.header;
  if (Object.hasOwn(row.raw, statusHeader)) {
    const status = parseInstructorStatus(row.raw[statusHeader]);
    if (!status)
      fail(
        "is_active",
        "invalid_instructor_status",
        "الحالة مطلوبة: نشط، غير نشط، ابتعاث، إجازة، أو تفرغ علمي.",
      );
    else {
      v.is_active = status.active;
      const notes = String(v.notes ?? "")
        .split("\n")
        .filter((line) => !line.startsWith(STATUS_NOTE));
      // Canonical boolean exports retain an existing reason when still inactive.
      const oldReason = String(v.notes ?? "")
        .split("\n")
        .find((line) => line.startsWith(STATUS_NOTE));
      if (status.reason) notes.push(STATUS_NOTE + status.reason);
      else if (!status.active && oldReason) notes.push(oldReason);
      v.notes = notes.filter(Boolean).join("\n") || null;
    }
  }
  if (v.academic_rank)
    v.academic_rank =
      ACADEMIC_RANKS.find((rank) => headerKey(rank) === headerKey(v.academic_rank)) ??
      v.academic_rank;
  for (const key of ["max_weekly_hours", "max_hours_per_day", "administrative_release_hours"]) {
    const raw = v[key];
    if (raw == null || raw === "") {
      if (key === "max_weekly_hours")
        fail(key, "missing_weekly_load", "أدخل النصاب الأسبوعي المعتمد كما في الكشف.");
      continue;
    }
    const number = Number(normalizeDecimalDigits(String(raw)));
    if (!Number.isFinite(number) || number < 0)
      fail(key, "invalid_instructor_hours", "الساعات يجب أن تكون رقمًا غير سالب.");
    else v[key] = number;
  }
  if (hourlyContract) {
    v.administrative_release_hours = 0;
    v.administrative_position = null;
    v.administrative_department_code = null;
  } else if (v.administrative_position) {
    const normalizedPosition = normalizeAdministrativePosition(v.administrative_position);
    if (!normalizedPosition)
      fail(
        "administrative_position",
        "invalid_administrative_position",
        "المنصب الإداري غير معروف. استخدم رئيس قسم، نائب العميد للشؤون الأكاديمية، نائب العميد لشؤون الطلاب، أو عميد الكلية.",
      );
    else {
      v.administrative_position = normalizedPosition;
      if (requiresAdministrativeDepartment(normalizedPosition) && !v.administrative_department_code)
        fail(
          "administrative_department_code",
          "administrative_department_required",
          "قسم الرئاسة مطلوب عند اختيار رئيس قسم.",
        );
      if (!requiresAdministrativeDepartment(normalizedPosition))
        v.administrative_department_code = null;
    }
  }
  if (!v._department_id && !v.department_code && v.specialization) {
    const matches = departments.filter((d) => nameKey(d.name) === nameKey(v.specialization));
    if (matches.length === 1) v._department_id = matches[0].id;
  }
  return errors;
}
