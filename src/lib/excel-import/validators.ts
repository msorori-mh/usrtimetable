import { supabase } from "@/integrations/supabase/client";
import { TEMPLATES } from "./templates";
import type { ImportEntity, ParsedRow, RowError, ValidationResult } from "./types";

const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

function toBool(v: unknown): boolean | null {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).trim().toLowerCase();
  if (["true", "1", "yes", "نعم", "y"].includes(s)) return true;
  if (["false", "0", "no", "لا", "n"].includes(s)) return false;
  return null;
}

function normalize(headers: string[], rows: Record<string, unknown>[], entity: ImportEntity): { parsed: ParsedRow[]; missingHeaders: string[] } {
  const tpl = TEMPLATES[entity];
  const headerSet = new Set(headers.map((h) => h.trim()));
  const missingHeaders = tpl.columns.filter((c) => c.required && !headerSet.has(c.header)).map((c) => c.header);
  const byHeader = new Map(tpl.columns.map((c) => [c.header, c]));
  const parsed: ParsedRow[] = rows.map((raw, i) => {
    const values: Record<string, unknown> = {};
    for (const [h, v] of Object.entries(raw)) {
      const col = byHeader.get(h.trim());
      if (!col) continue;
      const s = v === null || v === undefined ? "" : String(v).trim();
      if (s === "") { values[col.key] = null; continue; }
      if (col.type === "number") values[col.key] = Number.isFinite(Number(s)) ? Number(s) : s;
      else if (col.type === "boolean") values[col.key] = toBool(s);
      else if (col.type === "days_csv") values[col.key] = s.split(",").map((x) => x.trim()).filter(Boolean).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
      else values[col.key] = s;
    }
    return { rowNumber: i + 2, raw, values };
  });
  return { parsed, missingHeaders };
}

export async function validate(entity: ImportEntity, headers: string[], rows: Record<string, unknown>[], collegeId: string): Promise<ValidationResult & { missingHeaders: string[] }> {
  const tpl = TEMPLATES[entity];
  const { parsed, missingHeaders } = normalize(headers, rows, entity);
  const errors: RowError[] = [];
  const validRows: ParsedRow[] = [];
  const invalidRows: ParsedRow[] = [];

  if (missingHeaders.length > 0) {
    return { validRows: [], invalidRows: parsed, errors: missingHeaders.map((h) => ({ rowNumber: 1, columnName: h, errorCode: "missing_column", message: `عمود مطلوب مفقود: ${h}` })), missingHeaders };
  }

  // Preload lookups for foreign-key style fields (scoped to college via RLS)
  let instructorTypes: { id: string; code: string }[] = [];
  let roomTypes: { id: string; code: string }[] = [];
  let departments: { id: string; code: string }[] = [];
  let buildings: { id: string; code: string }[] = [];
  if (entity === "instructors") {
    const [it, dp] = await Promise.all([
      supabase.from("instructor_types").select("id, code").eq("college_id", collegeId),
      supabase.from("departments").select("id, code").eq("college_id", collegeId),
    ]);
    instructorTypes = (it.data ?? []) as { id: string; code: string }[];
    departments = (dp.data ?? []) as { id: string; code: string }[];
  }
  if (entity === "rooms") {
    const [rt, bd] = await Promise.all([
      supabase.from("room_types").select("id, code").eq("college_id", collegeId),
      supabase.from("academic_buildings").select("id, code").eq("college_id", collegeId),
    ]);
    roomTypes = (rt.data ?? []) as { id: string; code: string }[];
    buildings = (bd.data ?? []) as { id: string; code: string }[];
  }

  // Existing rows for duplicate-detection in same college
  const existingKeys = new Set<string>();
  const uniqueColHeader = tpl.columns.find((c) => c.key === tpl.uniqueKey)?.header;
  
  const uniqueCol = tpl.uniqueKey;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (supabase.from(entity as never) as any).select(uniqueCol).eq("college_id", collegeId);
  (existing ?? []).forEach((r: Record<string, unknown>) => {
    const k = r[uniqueCol];
    if (k) existingKeys.add(String(k).toLowerCase());
  });

  // In-file duplicate detection
  const seenInFile = new Map<string, number>();

  for (const row of parsed) {
    const rowErrors: RowError[] = [];

    // Required check
    for (const c of tpl.columns) {
      if (c.required && (row.values[c.key] === null || row.values[c.key] === undefined || row.values[c.key] === "")) {
        rowErrors.push({ rowNumber: row.rowNumber, columnName: c.header, errorCode: "required", message: `قيمة مطلوبة: ${c.header}` });
      }
    }

    // Enum checks
    for (const c of tpl.columns) {
      if (!c.enumValues || c.enumValues.length === 0) continue;
      const v = row.values[c.key];
      if (v !== null && v !== undefined && v !== "" && !c.enumValues.includes(String(v))) {
        rowErrors.push({ rowNumber: row.rowNumber, columnName: c.header, errorCode: "invalid_enum", message: `قيمة غير مسموحة في ${c.header}. المسموح: ${c.enumValues.join(", ")}`, rawValue: String(v) });
      }
    }

    // Time format checks
    for (const c of tpl.columns) {
      if (c.type !== "time") continue;
      const v = row.values[c.key];
      if (v && !TIME_RE.test(String(v))) {
        rowErrors.push({ rowNumber: row.rowNumber, columnName: c.header, errorCode: "invalid_time", message: `صيغة وقت غير صحيحة (HH:MM): ${v}`, rawValue: String(v) });
      }
    }

    // Entity-specific
    if (entity === "daily_breaks") {
      const days = row.values.days as number[] | null;
      if (!days || days.length === 0) rowErrors.push({ rowNumber: row.rowNumber, columnName: "الأيام", errorCode: "invalid_days", message: "يجب تحديد يوم واحد على الأقل (0-6)" });
      else if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6))
        rowErrors.push({ rowNumber: row.rowNumber, columnName: "الأيام", errorCode: "invalid_day_of_week", message: "أيام غير صحيحة. القيم المسموحة: 0-6" });
      const st = row.values.start_time as string | null;
      const et = row.values.end_time as string | null;
      if (st && et && TIME_RE.test(st) && TIME_RE.test(et) && et <= st)
        rowErrors.push({ rowNumber: row.rowNumber, columnName: "إلى_الساعة", errorCode: "invalid_time_range", message: "وقت النهاية يجب أن يكون بعد وقت البداية" });
    }
    if (entity === "academic_terms") {
      const sd = row.values.start_date as string | null;
      const ed = row.values.end_date as string | null;
      if (sd && ed && ed < sd) rowErrors.push({ rowNumber: row.rowNumber, columnName: "تاريخ_النهاية", errorCode: "invalid_date_range", message: "تاريخ النهاية يجب أن يكون بعد البداية" });
    }
    if (entity === "rooms") {
      const st = row.values.available_start_time as string | null;
      const et = row.values.available_end_time as string | null;
      if (st && et && TIME_RE.test(st) && TIME_RE.test(et) && et <= st)
        rowErrors.push({ rowNumber: row.rowNumber, columnName: "متاح_إلى", errorCode: "invalid_time_range", message: "وقت النهاية يجب أن يكون بعد وقت البداية" });
      const rtCode = row.values.room_type_code as string | null;
      if (rtCode) {
        const found = roomTypes.find((x) => x.code === rtCode);
        if (!found) rowErrors.push({ rowNumber: row.rowNumber, columnName: "نوع_القاعة_رمز", errorCode: "unknown_room_type", message: `نوع قاعة غير معروف في هذه الكلية: ${rtCode}`, rawValue: rtCode });
        else row.values._room_type_id = found.id;
      }
      const bCode = row.values.building_code as string | null;
      if (bCode) {
        const found = buildings.find((x) => x.code === bCode);
        if (!found) rowErrors.push({ rowNumber: row.rowNumber, columnName: "رمز_المبنى", errorCode: "unknown_building", message: `مبنى غير معروف في هذه الكلية: ${bCode}`, rawValue: bCode });
        else row.values._building_id = found.id;
      }
    }
    if (entity === "instructors") {
      const itCode = row.values.instructor_type_code as string | null;
      if (itCode) {
        const found = instructorTypes.find((x) => x.code === itCode);
        if (!found) rowErrors.push({ rowNumber: row.rowNumber, columnName: "نوع_المحاضر_رمز", errorCode: "unknown_instructor_type", message: `نوع محاضر غير معروف في هذه الكلية: ${itCode}`, rawValue: itCode });
        else row.values._instructor_type_id = found.id;
      }
      const dCode = row.values.department_code as string | null;
      if (dCode) {
        const found = departments.find((x) => x.code === dCode);
        if (!found) rowErrors.push({ rowNumber: row.rowNumber, columnName: "رمز_القسم", errorCode: "unknown_department", message: `قسم غير معروف في هذه الكلية: ${dCode}`, rawValue: dCode });
        else row.values._department_id = found.id;
      }
    }

    // Duplicates
    const uniq = row.values[tpl.uniqueKey];
    if (uniq) {
      const k = String(uniq).toLowerCase();
      if (seenInFile.has(k)) {
        rowErrors.push({ rowNumber: row.rowNumber, columnName: uniqueColHeader, errorCode: "duplicate_in_file", message: `قيمة مكررة في الملف (${tpl.uniqueKeyLabel}): ${uniq} — مكررة مع الصف ${seenInFile.get(k)}`, rawValue: String(uniq) });
      } else {
        seenInFile.set(k, row.rowNumber);
      }
      row.values._exists = existingKeys.has(k);
    }

    if (rowErrors.length > 0) { invalidRows.push(row); errors.push(...rowErrors); }
    else validRows.push(row);
  }

  return { validRows, invalidRows, errors, missingHeaders: [] };
}

export function buildDbPayload(entity: ImportEntity, row: ParsedRow, collegeId: string): Record<string, unknown> {
  const v = row.values;
  const base: Record<string, unknown> = { college_id: collegeId };
  if (entity === "instructors") {
    return {
      ...base,
      employee_number: v.employee_number, full_name: v.full_name,
      full_name_ar: v.full_name_ar ?? v.full_name, full_name_en: v.full_name_en ?? null,
      email: v.email ?? null, phone: v.phone ?? null, specialization: v.specialization ?? null,
      academic_degree: v.academic_degree ?? null, academic_rank: v.academic_rank ?? null,
      instructor_type_id: v._instructor_type_id ?? null, department_id: v._department_id ?? null,
      employment_type: v.employment_type ?? "full_time",
      max_weekly_hours: v.max_weekly_hours ?? 18, max_hours_per_day: v.max_hours_per_day ?? null,
      administrative_release_hours: v.administrative_release_hours ?? 0,
      admin_tasks: v.admin_tasks ?? null, external_source: v.external_source ?? null,
      notes: v.notes ?? null, is_active: v.is_active ?? true,
    };
  }
  if (entity === "rooms") {
    return {
      ...base,
      code: v.code, name: v.name, capacity: v.capacity ?? 30,
      room_type: v.room_type ?? "lecture_room", room_type_id: v._room_type_id ?? null,
      building_id: v._building_id ?? null, building: v.building ?? null, floor: v.floor ?? null,
      available_start_time: v.available_start_time ?? null, available_end_time: v.available_end_time ?? null,
      notes: v.notes ?? null, is_active: v.is_active ?? true,
    };
  }
  if (entity === "academic_terms") {
    return {
      ...base,
      code: v.code, name: v.name, academic_year: v.academic_year ?? null,
      term_type: v.term_type ?? null, start_date: v.start_date ?? null, end_date: v.end_date ?? null,
      teaching_weeks_count: v.teaching_weeks_count ?? null, is_active: v.is_active ?? false,
    };
  }
  if (entity === "daily_breaks") {
    return {
      ...base,
      name: v.name, start_time: v.start_time, end_time: v.end_time,
      days: v.days ?? [], affects_scheduling: v.affects_scheduling ?? true,
    };
  }
  return base;
}
