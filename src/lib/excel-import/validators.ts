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

interface Lookups {
  instructorTypes?: Map<string, string>;
  roomTypes?: Map<string, string>;
  departments?: Map<string, string>;
  buildings?: Map<string, string>;
  programs?: Map<string, { id: string; department_id: string }>;
  terms?: Map<string, string>;
  courses?: Map<string, { id: string; department_id: string }>;
  instructors?: Map<string, string>;
  studyPlans?: Map<string, string>; // key: program_id|plan_code|version → study_plan_id
  planCourses?: Map<string, string>; // key: study_plan_id|course_id → plan_course_id
  offerings?: Map<string, string>; // key: term_id|course_id|program_id(opt) → offering_id
  sections?: Map<string, string>; // key: course_id|term_id|section_number → section_id
  levels?: Map<string, string>; // key: program_id|level_number → level_id
  sectionGroups?: Map<string, string>; // key: term_id|course_id|group_name → group_id
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function loadLookups(entity: ImportEntity, collegeId: string): Promise<Lookups> {
  const lk: Lookups = {};
  const fetchAll = async (table: string, cols: string): Promise<any[]> => {
    const { data } = await (supabase.from(table as never) as any).select(cols).eq("college_id", collegeId);
    return (data ?? []) as any[];
  };

  if (entity === "instructors") {
    const [it, dp] = await Promise.all([fetchAll("instructor_types", "id, code"), fetchAll("departments", "id, code")]);
    lk.instructorTypes = new Map(it.map((r) => [r.code, r.id]));
    lk.departments = new Map(dp.map((r) => [r.code, r.id]));
  }
  if (entity === "rooms") {
    const [rt, bd] = await Promise.all([fetchAll("room_types", "id, code"), fetchAll("academic_buildings", "id, code")]);
    lk.roomTypes = new Map(rt.map((r) => [r.code, r.id]));
    lk.buildings = new Map(bd.map((r) => [r.code, r.id]));
  }
  if (["study_plan_courses", "full_study_plan", "course_offerings", "course_programs"].includes(entity)) {
    const [dp, pg] = await Promise.all([fetchAll("departments", "id, code"), fetchAll("academic_programs", "id, code, department_id")]);
    lk.departments = new Map(dp.map((r) => [r.code, r.id]));
    lk.programs = new Map(pg.map((r) => [r.code, { id: r.id, department_id: r.department_id }]));
  }
  if (["course_offerings", "teaching_assignments", "section_groups"].includes(entity)) {
    const t = await fetchAll("academic_terms", "id, code");
    lk.terms = new Map(t.map((r) => [r.code, r.id]));
  }
  if (["course_offerings", "teaching_assignments", "course_programs", "section_groups"].includes(entity)) {
    const c = await fetchAll("courses", "id, code, department_id");
    lk.courses = new Map(c.map((r) => [r.code, { id: r.id, department_id: r.department_id }]));
  }
  if (entity === "teaching_assignments") {
    const ins = await fetchAll("instructors", "id, employee_number");
    lk.instructors = new Map(ins.filter((r) => r.employee_number).map((r) => [r.employee_number as string, r.id]));
  }
  if (entity === "course_offerings") {
    const sp = await fetchAll("study_plans", "id, code, version, program_id");
    lk.studyPlans = new Map(sp.map((r) => [`${r.program_id}|${r.code}|${r.version}`, r.id]));
    const pc = await fetchAll("plan_courses", "id, study_plan_id, course_id");
    lk.planCourses = new Map(pc.map((r) => [`${r.study_plan_id}|${r.course_id}`, r.id]));
    const lv = await fetchAll("academic_levels", "id, program_id, level_number");
    lk.levels = new Map(lv.map((r) => [`${r.program_id}|${r.level_number}`, r.id]));
  }
  return lk;
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
      else if (col.type === "csv") values[col.key] = s.split(",").map((x) => x.trim()).filter(Boolean);
      else values[col.key] = s;
    }
    return { rowNumber: i + 2, raw, values };
  });
  return { parsed, missingHeaders };
}

export async function validate(
  entity: ImportEntity,
  headers: string[],
  rows: Record<string, unknown>[],
  collegeId: string,
): Promise<ValidationResult & { missingHeaders: string[] }> {
  const tpl = TEMPLATES[entity];
  const { parsed, missingHeaders } = normalize(headers, rows, entity);
  const errors: RowError[] = [];
  const validRows: ParsedRow[] = [];
  const invalidRows: ParsedRow[] = [];

  if (missingHeaders.length > 0) {
    return {
      validRows: [],
      invalidRows: parsed,
      errors: missingHeaders.map((h) => ({ rowNumber: 1, columnName: h, errorCode: "missing_column", message: `عمود مطلوب مفقود: ${h}` })),
      missingHeaders,
    };
  }

  const lk = await loadLookups(entity, collegeId);

  // Existing-key set for simple table entities
  const existingKeys = new Set<string>();
  if (tpl.commitMode !== "custom") {
    const uniqueCol = tpl.uniqueKey;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing } = await (supabase.from(entity as never) as any).select(uniqueCol).eq("college_id", collegeId);
    (existing ?? []).forEach((r: Record<string, unknown>) => {
      const k = r[uniqueCol];
      if (k) existingKeys.add(String(k).toLowerCase());
    });
  }

  const seenInFile = new Map<string, number>();
  const uniqueColHeader = tpl.columns.find((c) => c.key === tpl.uniqueKey)?.header;

  for (const row of parsed) {
    const rowErrors: RowError[] = [];

    for (const c of tpl.columns) {
      if (c.required && (row.values[c.key] === null || row.values[c.key] === undefined || row.values[c.key] === "")) {
        rowErrors.push({ rowNumber: row.rowNumber, columnName: c.header, errorCode: "required", message: `قيمة مطلوبة: ${c.header}` });
      }
    }
    for (const c of tpl.columns) {
      if (!c.enumValues || c.enumValues.length === 0) continue;
      const v = row.values[c.key];
      if (v !== null && v !== undefined && v !== "" && !c.enumValues.includes(String(v))) {
        rowErrors.push({ rowNumber: row.rowNumber, columnName: c.header, errorCode: "invalid_enum", message: `قيمة غير مسموحة في ${c.header}. المسموح: ${c.enumValues.join(", ")}`, rawValue: String(v) });
      }
    }
    for (const c of tpl.columns) {
      if (c.type !== "time") continue;
      const v = row.values[c.key];
      if (v && !TIME_RE.test(String(v))) {
        rowErrors.push({ rowNumber: row.rowNumber, columnName: c.header, errorCode: "invalid_time", message: `صيغة وقت غير صحيحة (HH:MM): ${v}`, rawValue: String(v) });
      }
    }

    // Entity-specific validation
    runEntityValidation(entity, row, lk, rowErrors);

    // Duplicate / existence
    if (tpl.commitMode === "custom") {
      const logical = buildLogicalKey(entity, row);
      if (logical) {
        if (seenInFile.has(logical)) {
          rowErrors.push({ rowNumber: row.rowNumber, errorCode: "duplicate_in_file", message: `صف مكرر في الملف (${tpl.uniqueKeyLabel}) — مكرر مع الصف ${seenInFile.get(logical)}` });
        } else {
          seenInFile.set(logical, row.rowNumber);
        }
        row.values._logical = logical;
      }
    } else {
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
    }

    // legacy entities (instructors/rooms)
    if (entity === "instructors") {
      const itCode = row.values.instructor_type_code as string | null;
      if (itCode) {
        const id = lk.instructorTypes?.get(itCode);
        if (!id) rowErrors.push({ rowNumber: row.rowNumber, columnName: "نوع_المحاضر_رمز", errorCode: "unknown_instructor_type", message: `نوع محاضر غير معروف: ${itCode}`, rawValue: itCode });
        else row.values._instructor_type_id = id;
      }
      const dCode = row.values.department_code as string | null;
      if (dCode) {
        const id = lk.departments?.get(dCode);
        if (!id) rowErrors.push({ rowNumber: row.rowNumber, columnName: "رمز_القسم", errorCode: "unknown_department", message: `قسم غير معروف: ${dCode}`, rawValue: dCode });
        else row.values._department_id = id;
      }
    }
    if (entity === "rooms") {
      const st = row.values.available_start_time as string | null;
      const et = row.values.available_end_time as string | null;
      if (st && et && TIME_RE.test(st) && TIME_RE.test(et) && et <= st)
        rowErrors.push({ rowNumber: row.rowNumber, columnName: "متاح_إلى", errorCode: "invalid_time_range", message: "وقت النهاية يجب أن يكون بعد وقت البداية" });
      const rtCode = row.values.room_type_code as string | null;
      if (rtCode) {
        const id = lk.roomTypes?.get(rtCode);
        if (!id) rowErrors.push({ rowNumber: row.rowNumber, columnName: "نوع_القاعة_رمز", errorCode: "unknown_room_type", message: `نوع قاعة غير معروف: ${rtCode}`, rawValue: rtCode });
        else row.values._room_type_id = id;
      }
      const bCode = row.values.building_code as string | null;
      if (bCode) {
        const id = lk.buildings?.get(bCode);
        if (!id) rowErrors.push({ rowNumber: row.rowNumber, columnName: "رمز_المبنى", errorCode: "unknown_building", message: `مبنى غير معروف: ${bCode}`, rawValue: bCode });
        else row.values._building_id = id;
      }
    }
    if (entity === "academic_terms") {
      const sd = row.values.start_date as string | null;
      const ed = row.values.end_date as string | null;
      if (sd && ed && ed < sd) rowErrors.push({ rowNumber: row.rowNumber, columnName: "تاريخ_النهاية", errorCode: "invalid_date_range", message: "تاريخ النهاية يجب أن يكون بعد البداية" });
    }
    if (entity === "daily_breaks") {
      const days = row.values.days as number[] | null;
      if (!days || days.length === 0) rowErrors.push({ rowNumber: row.rowNumber, columnName: "الأيام", errorCode: "invalid_days", message: "يجب تحديد يوم واحد على الأقل (0-6)" });
      const st = row.values.start_time as string | null;
      const et = row.values.end_time as string | null;
      if (st && et && TIME_RE.test(st) && TIME_RE.test(et) && et <= st)
        rowErrors.push({ rowNumber: row.rowNumber, columnName: "إلى_الساعة", errorCode: "invalid_time_range", message: "وقت النهاية يجب أن يكون بعد وقت البداية" });
    }

    if (rowErrors.length > 0) { invalidRows.push(row); errors.push(...rowErrors); }
    else validRows.push(row);
  }

  return { validRows, invalidRows, errors, missingHeaders: [] };
}

function buildLogicalKey(entity: ImportEntity, row: ParsedRow): string | null {
  const v = row.values;
  switch (entity) {
    case "study_plan_courses":
    case "full_study_plan":
      return `${v.program_code}|${v.plan_code}|${v.plan_version ?? "1"}|${v.course_code}`.toLowerCase();
    case "course_offerings":
      return `${v.term_code}|${v.course_code}|${v.program_code ?? ""}`.toLowerCase();
    case "teaching_assignments":
      return `${v.term_code}|${v.course_code}|${v.employee_number}|${v.session_type}|${v.section_number ?? ""}`.toLowerCase();
    case "course_programs":
      return `${v.course_code}|${v.program_code}`.toLowerCase();
    case "section_groups":
      return `${v.term_code}|${v.course_code}|${v.group_name}`.toLowerCase();
    default:
      return null;
  }
}

function runEntityValidation(entity: ImportEntity, row: ParsedRow, lk: Lookups, errs: RowError[]): void {
  const v = row.values;
  const need = (cond: boolean, header: string, code: string, msg: string, raw?: unknown) => {
    if (!cond) errs.push({ rowNumber: row.rowNumber, columnName: header, errorCode: code, message: msg, rawValue: raw == null ? undefined : String(raw) });
  };

  if (entity === "study_plan_courses" || entity === "full_study_plan") {
    const dCode = v.department_code as string | null;
    const pCode = v.program_code as string | null;
    if (dCode) {
      const id = lk.departments?.get(dCode);
      need(!!id, "رمز_القسم", "unknown_department", `قسم غير معروف: ${dCode}`, dCode);
      if (id) v._department_id = id;
    }
    if (pCode) {
      const prog = lk.programs?.get(pCode);
      need(!!prog, "رمز_البرنامج", "unknown_program", `برنامج غير معروف: ${pCode}`, pCode);
      if (prog) v._program_id = prog.id;
    }
    const lec = (v.lectures_per_week as number) ?? 0;
    const lab = (v.labs_per_week as number) ?? 0;
    if (lec > 0 && !(Number(v.lecture_session_duration) > 0))
      errs.push({ rowNumber: row.rowNumber, columnName: "مدة_المحاضرة", errorCode: "invalid_pattern", message: "مدة المحاضرة يجب أن تكون > 0 عند وجود محاضرات" });
    if (lab > 0 && !(Number(v.lab_session_duration) > 0))
      errs.push({ rowNumber: row.rowNumber, columnName: "مدة_المعمل", errorCode: "invalid_pattern", message: "مدة المعمل يجب أن تكون > 0 عند وجود معامل" });
  }

  if (entity === "course_offerings") {
    const tId = lk.terms?.get(String(v.term_code));
    need(!!tId, "رمز_الفصل", "unknown_term", `فصل غير معروف: ${v.term_code}`, v.term_code);
    if (tId) v._term_id = tId;
    const c = lk.courses?.get(String(v.course_code));
    need(!!c, "رمز_المقرر", "unknown_course", `مقرر غير معروف: ${v.course_code}`, v.course_code);
    if (c) v._course_id = c.id;
    if (v.program_code) {
      const p = lk.programs?.get(String(v.program_code));
      need(!!p, "رمز_البرنامج", "unknown_program", `برنامج غير معروف: ${v.program_code}`, v.program_code);
      if (p) {
        v._program_id = p.id;
        if (v.level_number != null) {
          const lvId = lk.levels?.get(`${p.id}|${v.level_number}`);
          if (lvId) v._level_id = lvId;
        }
      }
    }
    if (v.plan_code && v._program_id) {
      const spId = lk.studyPlans?.get(`${v._program_id}|${v.plan_code}|1`);
      if (spId) {
        v._study_plan_id = spId;
        if (v._course_id) {
          const pcId = lk.planCourses?.get(`${spId}|${v._course_id}`);
          if (pcId) v._plan_course_id = pcId;
          else errs.push({ rowNumber: row.rowNumber, columnName: "رمز_الخطة", errorCode: "missing_plan_course_link", message: "المقرر غير موجود في خطة دراسية محدّدة" });
        }
      } else {
        errs.push({ rowNumber: row.rowNumber, columnName: "رمز_الخطة", errorCode: "unknown_plan", message: `خطة غير معروفة: ${v.plan_code}`, rawValue: String(v.plan_code) });
      }
    }
  }

  if (entity === "teaching_assignments") {
    const tId = lk.terms?.get(String(v.term_code));
    need(!!tId, "رمز_الفصل", "unknown_term", `فصل غير معروف: ${v.term_code}`, v.term_code);
    const c = lk.courses?.get(String(v.course_code));
    need(!!c, "رمز_المقرر", "unknown_course", `مقرر غير معروف: ${v.course_code}`, v.course_code);
    const insId = lk.instructors?.get(String(v.employee_number));
    need(!!insId, "رقم_الموظف_للمحاضر", "unknown_instructor", `محاضر غير معروف: ${v.employee_number}`, v.employee_number);
    if (tId) v._term_id = tId;
    if (c) v._course_id = c.id;
    if (insId) v._instructor_id = insId;
  }

  if (entity === "course_programs") {
    const c = lk.courses?.get(String(v.course_code));
    need(!!c, "رمز_المقرر", "unknown_course", `مقرر غير معروف: ${v.course_code}`, v.course_code);
    const p = lk.programs?.get(String(v.program_code));
    need(!!p, "رمز_البرنامج", "unknown_program", `برنامج غير معروف: ${v.program_code}`, v.program_code);
    if (c) v._course_id = c.id;
    if (p) v._program_id = p.id;
  }

  if (entity === "section_groups") {
    const tId = lk.terms?.get(String(v.term_code));
    need(!!tId, "رمز_الفصل", "unknown_term", `فصل غير معروف: ${v.term_code}`, v.term_code);
    const c = lk.courses?.get(String(v.course_code));
    need(!!c, "رمز_المقرر", "unknown_course", `مقرر غير معروف: ${v.course_code}`, v.course_code);
    if (tId) v._term_id = tId;
    if (c) v._course_id = c.id;
    const members = v.member_section_numbers as string[] | null;
    if (!members || members.length === 0)
      errs.push({ rowNumber: row.rowNumber, columnName: "أرقام_المجموعات", errorCode: "required", message: "حدّد رقم مجموعة واحد على الأقل" });
  }
}

export function buildDbPayload(entity: ImportEntity, row: ParsedRow, collegeId: string): Record<string, unknown> {
  const v = row.values;
  const base: Record<string, unknown> = { college_id: collegeId };
  if (entity === "instructors") {
    return { ...base,
      employee_number: v.employee_number, full_name: v.full_name,
      full_name_ar: v.full_name_ar ?? v.full_name, full_name_en: v.full_name_en ?? null,
      email: v.email ?? null, phone: v.phone ?? null, specialization: v.specialization ?? null,
      academic_degree: v.academic_degree ?? null, academic_rank: v.academic_rank ?? null,
      instructor_type_id: v._instructor_type_id ?? null, department_id: v._department_id ?? null,
      employment_type: v.employment_type ?? "full_time",
      max_weekly_hours: v.max_weekly_hours ?? 18, max_hours_per_day: v.max_hours_per_day ?? null,
      administrative_release_hours: v.administrative_release_hours ?? 0,
      admin_tasks: v.admin_tasks ?? null, external_source: v.external_source ?? null,
      notes: v.notes ?? null, is_active: v.is_active ?? true };
  }
  if (entity === "rooms") {
    return { ...base,
      code: v.code, name: v.name, capacity: v.capacity ?? 30,
      room_type: v.room_type ?? "lecture_hall", room_type_id: v._room_type_id ?? null,
      building_id: v._building_id ?? null, building: v.building ?? null, floor: v.floor ?? null,
      available_start_time: v.available_start_time ?? null, available_end_time: v.available_end_time ?? null,
      notes: v.notes ?? null, is_active: v.is_active ?? true };
  }
  if (entity === "academic_terms") {
    return { ...base,
      code: v.code, name: v.name, academic_year: v.academic_year ?? null,
      term_type: v.term_type ?? null, start_date: v.start_date ?? null, end_date: v.end_date ?? null,
      teaching_weeks_count: v.teaching_weeks_count ?? null, is_active: v.is_active ?? false };
  }
  if (entity === "daily_breaks") {
    return { ...base, name: v.name, start_time: v.start_time, end_time: v.end_time,
      days: v.days ?? [], affects_scheduling: v.affects_scheduling ?? true };
  }
  return base;
}
