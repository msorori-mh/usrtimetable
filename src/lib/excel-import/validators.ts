import { supabase } from "@/integrations/supabase/client";
import { TEMPLATES } from "./templates";
import { resolveRoomTypeFields } from "./room-type-normalize";
import {
  parsePlanComponentHours,
  isApprovedComponentType,
} from "@/lib/academic-delivery-v2/component-hours";
import { componentTypeToSessionType } from "@/lib/academic-delivery-v2/types";
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
  roomTypes?: Map<string, string>; // code → id
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
  cohorts?: Map<string, string>; // program|level|system|entry_year|term → cohort_id
  electiveSlots?: Map<string, { id: string; study_plan_id: string }>; // slot_code → ...
  electiveSlotCourses?: Map<string, Set<string>>; // elective_slot_id → course_ids
  deliveryGroups?: Map<string, string>; // cohort|course_code|component|group_code → dg_id
  planComponents?: Map<string, { id: string; plan_course_id: string; component_type: string }>;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function loadLookups(entity: ImportEntity, collegeId: string): Promise<Lookups> {
  const lk: Lookups = {};
  const fetchAll = async (table: string, cols: string): Promise<any[]> => {
    const { data } = await (supabase.from(table as never) as any)
      .select(cols)
      .eq("college_id", collegeId);
    return (data ?? []) as any[];
  };

  if (entity === "instructors") {
    const [it, dp] = await Promise.all([
      fetchAll("instructor_types", "id, code"),
      fetchAll("departments", "id, code"),
    ]);
    lk.instructorTypes = new Map(it.map((r) => [r.code, r.id]));
    lk.departments = new Map(dp.map((r) => [r.code, r.id]));
  }
  if (entity === "rooms") {
    const [rt, bd] = await Promise.all([
      fetchAll("room_types", "id, code"),
      fetchAll("academic_buildings", "id, code"),
    ]);
    lk.roomTypes = new Map(rt.map((r) => [r.code, r.id]));
    lk.buildings = new Map(bd.map((r) => [r.code, r.id]));
  }
  if (
    [
      "study_plan_courses",
      "full_study_plan",
      "course_offerings",
      "course_programs",
      "academic_cohorts",
      "cohort_elective_selections",
      "teaching_assignments",
    ].includes(entity)
  ) {
    const [dp, pg] = await Promise.all([
      fetchAll("departments", "id, code"),
      fetchAll("academic_programs", "id, code, department_id"),
    ]);
    lk.departments = new Map(dp.map((r) => [r.code, r.id]));
    lk.programs = new Map(pg.map((r) => [r.code, { id: r.id, department_id: r.department_id }]));
  }
  if (
    [
      "course_offerings",
      "teaching_assignments",
      "section_groups",
      "sections",
      "academic_cohorts",
      "cohort_elective_selections",
    ].includes(entity)
  ) {
    const t = await fetchAll("academic_terms", "id, code");
    lk.terms = new Map(t.map((r) => [r.code, r.id]));
  }
  if (
    [
      "course_offerings",
      "teaching_assignments",
      "course_programs",
      "section_groups",
      "sections",
      "cohort_elective_selections",
    ].includes(entity)
  ) {
    const c = await fetchAll("courses", "id, code, department_id");
    lk.courses = new Map(c.map((r) => [r.code, { id: r.id, department_id: r.department_id }]));
  }
  if (entity === "sections") {
    const sec = await fetchAll("sections", "id, course_id, term_id, section_number");
    lk.sections = new Map(
      sec.map((r) => [`${r.course_id}|${r.term_id}|${r.section_number}`, r.id]),
    );
  }
  if (entity === "teaching_assignments") {
    const ins = await fetchAll("instructors", "id, employee_number");
    lk.instructors = new Map(
      ins.filter((r) => r.employee_number).map((r) => [r.employee_number as string, r.id]),
    );
    const lv = await fetchAll("academic_levels", "id, program_id, level_number");
    lk.levels = new Map(lv.map((r) => [`${r.program_id}|${r.level_number}`, r.id]));
    const cohorts = await fetchAll(
      "academic_cohorts",
      "id, program_id, level_id, study_system, entry_year, term_id",
    );
    lk.cohorts = new Map(
      cohorts.map((r) => [
        `${r.program_id}|${r.level_id}|${r.study_system}|${r.entry_year}|${r.term_id}`,
        r.id,
      ]),
    );
    try {
      const dg = await fetchAll(
        "delivery_groups",
        "id, cohort_id, group_code, component_id, plan_course_id",
      );
      const pcc = await fetchAll("plan_course_components", "id, plan_course_id, component_type");
      const pccById = new Map(pcc.map((r) => [r.id, r]));
      const pc = await fetchAll("plan_courses", "id, course_id");
      const courseByPc = new Map(pc.map((r) => [r.id, r.course_id]));
      lk.deliveryGroups = new Map();
      for (const g of dg) {
        const comp = pccById.get(g.component_id);
        const courseId = courseByPc.get(g.plan_course_id);
        if (!comp || !courseId) continue;
        const courseCode = [...(lk.courses?.entries() ?? [])].find(
          ([, c]) => c.id === courseId,
        )?.[0];
        if (!courseCode) continue;
        lk.deliveryGroups.set(
          `${g.cohort_id}|${courseCode}|${comp.component_type}|${g.group_code}`.toLowerCase(),
          g.id,
        );
      }
      lk.planComponents = new Map(
        pcc.map((r) => [
          `${r.plan_course_id}|${r.component_type}`,
          { id: r.id, plan_course_id: r.plan_course_id, component_type: r.component_type },
        ]),
      );
    } catch {
      // V2 tables may be unavailable until migration apply — legacy TA path still works
    }
  }
  if (entity === "course_offerings") {
    const sp = await fetchAll("study_plans", "id, code, version, program_id");
    lk.studyPlans = new Map(sp.map((r) => [`${r.program_id}|${r.code}|${r.version}`, r.id]));
    const pc = await fetchAll("plan_courses", "id, study_plan_id, course_id");
    lk.planCourses = new Map(pc.map((r) => [`${r.study_plan_id}|${r.course_id}`, r.id]));
    const lv = await fetchAll("academic_levels", "id, program_id, level_number");
    lk.levels = new Map(lv.map((r) => [`${r.program_id}|${r.level_number}`, r.id]));
  }
  if (entity === "academic_cohorts") {
    const lv = await fetchAll("academic_levels", "id, program_id, level_number");
    lk.levels = new Map(lv.map((r) => [`${r.program_id}|${r.level_number}`, r.id]));
  }
  if (entity === "cohort_elective_selections") {
    const lv = await fetchAll("academic_levels", "id, program_id, level_number");
    lk.levels = new Map(lv.map((r) => [`${r.program_id}|${r.level_number}`, r.id]));
    const cohorts = await fetchAll(
      "academic_cohorts",
      "id, program_id, level_id, study_system, entry_year, term_id",
    );
    lk.cohorts = new Map(
      cohorts.map((r) => [
        `${r.program_id}|${r.level_id}|${r.study_system}|${r.entry_year}|${r.term_id}`,
        r.id,
      ]),
    );
    try {
      const slots = await fetchAll("elective_slots", "id, slot_code, study_plan_id, active");
      lk.electiveSlots = new Map(
        slots
          .filter((r) => r.active !== false)
          .map((r) => [
            String(r.slot_code).toLowerCase(),
            { id: r.id, study_plan_id: r.study_plan_id },
          ]),
      );
      const esc = await fetchAll("elective_slot_courses", "elective_slot_id, course_id, active");
      lk.electiveSlotCourses = new Map();
      for (const r of esc) {
        if (r.active === false) continue;
        const set = lk.electiveSlotCourses.get(r.elective_slot_id) ?? new Set<string>();
        set.add(r.course_id);
        lk.electiveSlotCourses.set(r.elective_slot_id, set);
      }
    } catch {
      // V2 tables unavailable until migration apply
    }
  }
  if (entity === "study_plan_courses" || entity === "full_study_plan") {
    try {
      const rt = await fetchAll("room_types", "id, code");
      lk.roomTypes = new Map(rt.map((r) => [r.code, r.id]));
    } catch {
      /* optional */
    }
  }
  return lk;
}

function normalize(
  headers: string[],
  rows: Record<string, unknown>[],
  entity: ImportEntity,
): { parsed: ParsedRow[]; missingHeaders: string[] } {
  const tpl = TEMPLATES[entity];
  const headerSet = new Set(headers.map((h) => h.trim()));
  const missingHeaders = tpl.columns
    .filter((c) => c.required && !headerSet.has(c.header))
    .map((c) => c.header);
  const byHeader = new Map(tpl.columns.map((c) => [c.header, c]));
  const parsed: ParsedRow[] = rows.map((raw, i) => {
    const values: Record<string, unknown> = {};
    for (const [h, v] of Object.entries(raw)) {
      const col = byHeader.get(h.trim());
      if (!col) continue;
      const s = v === null || v === undefined ? "" : String(v).trim();
      if (s === "") {
        values[col.key] = null;
        continue;
      }
      if (col.type === "number") values[col.key] = Number.isFinite(Number(s)) ? Number(s) : s;
      else if (col.type === "boolean") values[col.key] = toBool(s);
      else if (col.type === "days_csv")
        values[col.key] = s
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean)
          .map(Number)
          .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
      else if (col.type === "csv")
        values[col.key] = s
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);
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
      errors: missingHeaders.map((h) => ({
        rowNumber: 1,
        columnName: h,
        errorCode: "missing_column",
        message: `عمود مطلوب مفقود: ${h}`,
      })),
      missingHeaders,
    };
  }

  const lk = await loadLookups(entity, collegeId);

  // Existing-key set for simple table entities
  const existingKeys = new Set<string>();
  if (tpl.commitMode !== "custom") {
    const uniqueCol = tpl.uniqueKey;

    const { data: existing } = await (supabase.from(entity as never) as any)
      .select(uniqueCol)
      .eq("college_id", collegeId);
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
      if (
        c.required &&
        (row.values[c.key] === null || row.values[c.key] === undefined || row.values[c.key] === "")
      ) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          columnName: c.header,
          errorCode: "required",
          message: `قيمة مطلوبة: ${c.header}`,
        });
      }
    }
    for (const c of tpl.columns) {
      if (!c.enumValues || c.enumValues.length === 0) continue;
      // rooms: room_type / room_type_code resolved via alias-aware normalizer
      if (entity === "rooms" && (c.key === "room_type" || c.key === "room_type_code")) continue;
      const v = row.values[c.key];
      if (v !== null && v !== undefined && v !== "" && !c.enumValues.includes(String(v))) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          columnName: c.header,
          errorCode: "invalid_enum",
          message: `قيمة غير مسموحة في ${c.header}. المسموح: ${c.enumValues.join(", ")}`,
          rawValue: String(v),
        });
      }
    }
    for (const c of tpl.columns) {
      if (c.type !== "time") continue;
      const v = row.values[c.key];
      if (v && !TIME_RE.test(String(v))) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          columnName: c.header,
          errorCode: "invalid_time",
          message: `صيغة وقت غير صحيحة (HH:MM): ${v}`,
          rawValue: String(v),
        });
      }
    }

    // Entity-specific validation
    runEntityValidation(entity, row, lk, rowErrors);

    // Duplicate / existence
    if (tpl.commitMode === "custom") {
      const logical = buildLogicalKey(entity, row);
      if (logical) {
        if (seenInFile.has(logical)) {
          rowErrors.push({
            rowNumber: row.rowNumber,
            errorCode: "duplicate_in_file",
            message: `صف مكرر في الملف (${tpl.uniqueKeyLabel}) — مكرر مع الصف ${seenInFile.get(logical)}`,
          });
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
          rowErrors.push({
            rowNumber: row.rowNumber,
            columnName: uniqueColHeader,
            errorCode: "duplicate_in_file",
            message: `قيمة مكررة في الملف (${tpl.uniqueKeyLabel}): ${uniq} — مكررة مع الصف ${seenInFile.get(k)}`,
            rawValue: String(uniq),
          });
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
        if (!id)
          rowErrors.push({
            rowNumber: row.rowNumber,
            columnName: "نوع_المحاضر_رمز",
            errorCode: "unknown_instructor_type",
            message: `نوع محاضر غير معروف: ${itCode}`,
            rawValue: itCode,
          });
        else row.values._instructor_type_id = id;
      }
      const dCode = row.values.department_code as string | null;
      if (dCode) {
        const id = lk.departments?.get(dCode);
        if (!id)
          rowErrors.push({
            rowNumber: row.rowNumber,
            columnName: "رمز_القسم",
            errorCode: "unknown_department",
            message: `قسم غير معروف: ${dCode}`,
            rawValue: dCode,
          });
        else row.values._department_id = id;
      }
    }
    if (entity === "rooms") {
      const st = row.values.available_start_time as string | null;
      const et = row.values.available_end_time as string | null;
      if (st && et && TIME_RE.test(st) && TIME_RE.test(et) && et <= st)
        rowErrors.push({
          rowNumber: row.rowNumber,
          columnName: "متاح_إلى",
          errorCode: "invalid_time_range",
          message: "وقت النهاية يجب أن يكون بعد وقت البداية",
        });
      const resolved = resolveRoomTypeFields(
        row.values.room_type as string | null,
        row.values.room_type_code as string | null,
      );
      if (!resolved.ok) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          columnName: resolved.columnName,
          errorCode: resolved.errorCode,
          message: resolved.message,
          rawValue: resolved.rawValue,
        });
      } else {
        row.values.room_type = resolved.roomType;
        const id = lk.roomTypes?.get(resolved.roomType);
        if (id) row.values._room_type_id = id;
      }
      const bCode = row.values.building_code as string | null;
      if (bCode) {
        const id = lk.buildings?.get(bCode);
        if (!id)
          rowErrors.push({
            rowNumber: row.rowNumber,
            columnName: "رمز_المبنى",
            errorCode: "unknown_building",
            message: `مبنى غير معروف: ${bCode}`,
            rawValue: bCode,
          });
        else row.values._building_id = id;
      }
    }
    if (entity === "academic_terms") {
      const sd = row.values.start_date as string | null;
      const ed = row.values.end_date as string | null;
      if (sd && ed && ed < sd)
        rowErrors.push({
          rowNumber: row.rowNumber,
          columnName: "تاريخ_النهاية",
          errorCode: "invalid_date_range",
          message: "تاريخ النهاية يجب أن يكون بعد البداية",
        });
    }
    if (entity === "daily_breaks") {
      const days = row.values.days as number[] | null;
      if (!days || days.length === 0)
        rowErrors.push({
          rowNumber: row.rowNumber,
          columnName: "الأيام",
          errorCode: "invalid_days",
          message: "يجب تحديد يوم واحد على الأقل (0-6)",
        });
      const st = row.values.start_time as string | null;
      const et = row.values.end_time as string | null;
      if (st && et && TIME_RE.test(st) && TIME_RE.test(et) && et <= st)
        rowErrors.push({
          rowNumber: row.rowNumber,
          columnName: "إلى_الساعة",
          errorCode: "invalid_time_range",
          message: "وقت النهاية يجب أن يكون بعد وقت البداية",
        });
    }

    if (rowErrors.length > 0) {
      invalidRows.push(row);
      errors.push(...rowErrors);
    } else validRows.push(row);
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
    case "teaching_assignments": {
      const group =
        v.group_code ??
        (v.group_number != null ? `G${v.group_number}` : null) ??
        v.section_number ??
        "";
      const kind = v.component_type ?? v.session_type ?? "";
      return `${v.term_code}|${v.course_code}|${v.employee_number}|${kind}|${group}|${v.program_code ?? ""}|${v.level_number ?? ""}|${v.study_system ?? ""}|${v.entry_year ?? ""}`.toLowerCase();
    }
    case "academic_cohorts":
      return `${v.program_code}|${v.level_number}|${v.study_system}|${v.entry_year}|${v.term_code}`.toLowerCase();
    case "cohort_elective_selections":
      return `${v.program_code}|${v.level_number}|${v.study_system}|${v.entry_year}|${v.term_code}|${v.slot_code}`.toLowerCase();
    case "course_programs":
      return `${v.course_code}|${v.program_code}`.toLowerCase();
    case "section_groups":
      return `${v.term_code}|${v.course_code}|${v.group_name}`.toLowerCase();
    case "sections":
      return `${v.term_code}|${v.course_code}|${v.section_number}`.toLowerCase();
    default:
      return null;
  }
}

function runEntityValidation(
  entity: ImportEntity,
  row: ParsedRow,
  lk: Lookups,
  errs: RowError[],
): void {
  const v = row.values;
  const need = (cond: boolean, header: string, code: string, msg: string, raw?: unknown) => {
    if (!cond)
      errs.push({
        rowNumber: row.rowNumber,
        columnName: header,
        errorCode: code,
        message: msg,
        rawValue: raw == null ? undefined : String(raw),
      });
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
      errs.push({
        rowNumber: row.rowNumber,
        columnName: "مدة_المحاضرة",
        errorCode: "invalid_pattern",
        message: "مدة المحاضرة يجب أن تكون > 0 عند وجود محاضرات",
      });
    if (lab > 0 && !(Number(v.lab_session_duration) > 0))
      errs.push({
        rowNumber: row.rowNumber,
        columnName: "مدة_المعمل",
        errorCode: "invalid_pattern",
        message: "مدة المعمل يجب أن تكون > 0 عند وجود معامل",
      });

    // Phase 9.2: explicit component hours required (no silent distribution guess)
    const hoursResult = parsePlanComponentHours(
      {
        theory_hours: v.theory_hours as number | null,
        practical_hours: v.practical_hours as number | null,
        tutorial_hours: v.tutorial_hours as number | null,
        project_hours: v.project_hours as number | null,
        summer_training_hours: v.summer_training_hours as number | null,
      },
      { credit_hours: v.credit_hours as number | null, requireExplicit: true },
    );
    if (!hoursResult.ok) {
      for (const e of hoursResult.errors) {
        errs.push({
          rowNumber: row.rowNumber,
          columnName: e.column
            ? (
                {
                  theory_hours: "ساعات_نظري",
                  practical_hours: "ساعات_عملي",
                  tutorial_hours: "ساعات_تمارين",
                  project_hours: "ساعات_مشروع",
                  summer_training_hours: "ساعات_تدريب_صيفي",
                } as Record<string, string>
              )[e.column]
            : undefined,
          errorCode: e.code,
          message: e.message_ar,
        });
      }
    } else {
      v._plan_components = hoursResult.data.components;
      if (v.required_room_type_for_lecture && lk.roomTypes) {
        const rid = lk.roomTypes.get(String(v.required_room_type_for_lecture));
        if (rid) v._lecture_room_type_id = rid;
      }
      if (v.required_room_type_for_lab && lk.roomTypes) {
        const rid = lk.roomTypes.get(String(v.required_room_type_for_lab));
        if (rid) v._lab_room_type_id = rid;
      }
    }
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
      need(
        !!p,
        "رمز_البرنامج",
        "unknown_program",
        `برنامج غير معروف: ${v.program_code}`,
        v.program_code,
      );
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
          else
            errs.push({
              rowNumber: row.rowNumber,
              columnName: "رمز_الخطة",
              errorCode: "missing_plan_course_link",
              message: "المقرر غير موجود في خطة دراسية محدّدة",
            });
        }
      } else {
        errs.push({
          rowNumber: row.rowNumber,
          columnName: "رمز_الخطة",
          errorCode: "unknown_plan",
          message: `خطة غير معروفة: ${v.plan_code}`,
          rawValue: String(v.plan_code),
        });
      }
    }
  }

  if (entity === "teaching_assignments") {
    const tId = lk.terms?.get(String(v.term_code));
    need(!!tId, "رمز_الفصل", "unknown_term", `فصل غير معروف: ${v.term_code}`, v.term_code);
    const c = lk.courses?.get(String(v.course_code));
    need(!!c, "رمز_المقرر", "unknown_course", `مقرر غير معروف: ${v.course_code}`, v.course_code);
    const insId = lk.instructors?.get(String(v.employee_number));
    need(
      !!insId,
      "رقم_الموظف_للمحاضر",
      "unknown_instructor",
      `محاضر غير معروف: ${v.employee_number}`,
      v.employee_number,
    );
    if (tId) v._term_id = tId;
    if (c) v._course_id = c.id;
    if (insId) v._instructor_id = insId;

    const hasV2 =
      v.program_code != null &&
      v.level_number != null &&
      v.study_system != null &&
      v.entry_year != null &&
      v.component_type != null;

    if (hasV2) {
      const prog = lk.programs?.get(String(v.program_code));
      need(
        !!prog,
        "رمز_البرنامج",
        "unknown_program",
        `برنامج غير معروف: ${v.program_code}`,
        v.program_code,
      );
      if (prog) {
        v._program_id = prog.id;
        const lvId = lk.levels?.get(`${prog.id}|${v.level_number}`);
        need(
          !!lvId,
          "رقم_المستوى",
          "unknown_level",
          `مستوى غير معروف: ${v.level_number}`,
          v.level_number,
        );
        if (lvId) v._level_id = lvId;
      }
      if (v.component_type && !isApprovedComponentType(String(v.component_type))) {
        errs.push({
          rowNumber: row.rowNumber,
          columnName: "نوع_المكوّن",
          errorCode: "unsupported_component",
          message: `مكوّن غير معتمد: ${v.component_type}`,
          rawValue: String(v.component_type),
        });
      }
      if (v.component_type === "summer_training") {
        errs.push({
          rowNumber: row.rowNumber,
          columnName: "نوع_المكوّن",
          errorCode: "summer_training_not_schedulable",
          message: "لا يمكن إسناد التدريب الصيفي لجدولة أسبوعية.",
        });
      }
      const groupCode =
        (v.group_code as string | null) ?? (v.group_number != null ? `G${v.group_number}` : null);
      need(
        !!groupCode,
        "رمز_مجموعة_التسليم",
        "required",
        "رمز أو رقم مجموعة التسليم مطلوب لمسار V2",
      );
      if (prog && v._level_id && tId && groupCode && v.component_type) {
        const cohortKey = `${prog.id}|${v._level_id}|${v.study_system}|${v.entry_year}|${tId}`;
        const cohortId = lk.cohorts?.get(cohortKey);
        need(
          !!cohortId,
          "رمز_البرنامج",
          "unknown_cohort",
          "دفعة أكاديمية غير معروفة لهذه التركيبة",
          cohortKey,
        );
        if (cohortId) {
          v._cohort_id = cohortId;
          v._group_code = groupCode;
          v._session_type =
            componentTypeToSessionType(v.component_type as never) ?? v.session_type ?? "lecture";
          if (v.component_type === "project") v._exclude_from_regular_load = true;
          const dgKey =
            `${cohortId}|${String(v.course_code)}|${v.component_type}|${groupCode}`.toLowerCase();
          const dgId = lk.deliveryGroups?.get(dgKey);
          need(
            !!dgId,
            "رمز_مجموعة_التسليم",
            "unknown_delivery_group",
            `مجموعة تسليم غير موجودة: ${groupCode} / ${v.component_type}`,
            groupCode,
          );
          if (dgId) v._delivery_group_id = dgId;
        }
      }
      v._import_path = "v2";
    } else {
      // Legacy path: session_type required
      need(
        v.session_type != null && v.session_type !== "",
        "نوع_المحاضرة",
        "required",
        "نوع المحاضرة مطلوب في المسار القديم، أو استخدم حقول V2 (برنامج/مستوى/مكوّن/مجموعة).",
      );
      if (v.section_number != null && v.section_number !== "")
        v._group_code = String(v.section_number);
      v._session_type = v.session_type;
      v._import_path = "legacy";
    }
  }

  if (entity === "academic_cohorts") {
    const prog = lk.programs?.get(String(v.program_code));
    need(
      !!prog,
      "رمز_البرنامج",
      "unknown_program",
      `برنامج غير معروف: ${v.program_code}`,
      v.program_code,
    );
    const tId = lk.terms?.get(String(v.term_code));
    need(!!tId, "رمز_الفصل", "unknown_term", `فصل غير معروف: ${v.term_code}`, v.term_code);
    if (prog) {
      v._program_id = prog.id;
      const lvId = lk.levels?.get(`${prog.id}|${v.level_number}`);
      need(
        !!lvId,
        "رقم_المستوى",
        "unknown_level",
        `مستوى غير معروف للبرنامج: ${v.level_number}`,
        v.level_number,
      );
      if (lvId) v._level_id = lvId;
    }
    if (tId) v._term_id = tId;
    const sc = v.student_count;
    if (sc != null && (!(typeof sc === "number") || !Number.isInteger(sc) || sc < 0)) {
      errs.push({
        rowNumber: row.rowNumber,
        columnName: "عدد_الطلاب",
        errorCode: "invalid_student_count",
        message: "عدد الطلاب يجب أن يكون عددًا صحيحًا ≥ 0",
        rawValue: String(sc),
      });
    }
    const ey = v.entry_year;
    if (
      ey != null &&
      (!(typeof ey === "number") || !Number.isInteger(ey) || ey < 1990 || ey > 2100)
    ) {
      errs.push({
        rowNumber: row.rowNumber,
        columnName: "سنة_الدخول",
        errorCode: "invalid_entry_year",
        message: "سنة الدخول غير صالحة",
        rawValue: String(ey),
      });
    }
  }

  if (entity === "cohort_elective_selections") {
    const prog = lk.programs?.get(String(v.program_code));
    need(
      !!prog,
      "رمز_البرنامج",
      "unknown_program",
      `برنامج غير معروف: ${v.program_code}`,
      v.program_code,
    );
    const tId = lk.terms?.get(String(v.term_code));
    need(!!tId, "رمز_الفصل", "unknown_term", `فصل غير معروف: ${v.term_code}`, v.term_code);
    const course = lk.courses?.get(String(v.selected_course_code));
    need(
      !!course,
      "رمز_المقرر_المختار",
      "unknown_course",
      `مقرر غير معروف: ${v.selected_course_code}`,
      v.selected_course_code,
    );
    if (prog && tId) {
      v._program_id = prog.id;
      v._term_id = tId;
      const lvId = lk.levels?.get(`${prog.id}|${v.level_number}`);
      need(
        !!lvId,
        "رقم_المستوى",
        "unknown_level",
        `مستوى غير معروف: ${v.level_number}`,
        v.level_number,
      );
      if (lvId) {
        v._level_id = lvId;
        const cohortKey = `${prog.id}|${lvId}|${v.study_system}|${v.entry_year}|${tId}`;
        const cohortId = lk.cohorts?.get(cohortKey);
        need(
          !!cohortId,
          "رمز_البرنامج",
          "unknown_cohort",
          "دفعة أكاديمية غير معروفة — استورد الدفعات أولًا",
          cohortKey,
        );
        if (cohortId) v._cohort_id = cohortId;
      }
    }
    if (course) v._selected_course_id = course.id;
    const slot = lk.electiveSlots?.get(String(v.slot_code).toLowerCase());
    need(
      !!slot,
      "رمز_الخانة_الاختيارية",
      "unknown_elective_slot",
      `خانة اختيارية غير معروفة: ${v.slot_code}`,
      v.slot_code,
    );
    if (slot) {
      v._elective_slot_id = slot.id;
      if (course && lk.electiveSlotCourses) {
        const allowed = lk.electiveSlotCourses.get(slot.id);
        need(
          !!allowed?.has(course.id),
          "رمز_المقرر_المختار",
          "elective_course_not_allowed",
          `المقرر ${v.selected_course_code} غير مسموح في الخانة ${v.slot_code}`,
          v.selected_course_code,
        );
      }
    }
  }

  if (entity === "course_programs") {
    const c = lk.courses?.get(String(v.course_code));
    need(!!c, "رمز_المقرر", "unknown_course", `مقرر غير معروف: ${v.course_code}`, v.course_code);
    const p = lk.programs?.get(String(v.program_code));
    need(
      !!p,
      "رمز_البرنامج",
      "unknown_program",
      `برنامج غير معروف: ${v.program_code}`,
      v.program_code,
    );
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
      errs.push({
        rowNumber: row.rowNumber,
        columnName: "أرقام_المجموعات",
        errorCode: "required",
        message: "حدّد رقم مجموعة واحد على الأقل",
      });
  }

  if (entity === "sections") {
    const tId = lk.terms?.get(String(v.term_code));
    need(!!tId, "رمز_الفصل", "unknown_term", `فصل غير معروف: ${v.term_code}`, v.term_code);
    const c = lk.courses?.get(String(v.course_code));
    need(!!c, "رمز_المقرر", "unknown_course", `مقرر غير معروف: ${v.course_code}`, v.course_code);
    if (tId) v._term_id = tId;
    if (c) v._course_id = c.id;
    if (tId && c && v.section_number != null && v.section_number !== "") {
      const key = `${c.id}|${tId}|${v.section_number}`;
      if (lk.sections?.has(key)) v._exists = true;
    }
  }
}

export function buildDbPayload(
  entity: ImportEntity,
  row: ParsedRow,
  collegeId: string,
): Record<string, unknown> {
  const v = row.values;
  const base: Record<string, unknown> = { college_id: collegeId };
  if (entity === "instructors") {
    return {
      ...base,
      employee_number: v.employee_number,
      full_name: v.full_name,
      full_name_ar: v.full_name_ar ?? v.full_name,
      full_name_en: v.full_name_en ?? null,
      email: v.email ?? null,
      phone: v.phone ?? null,
      specialization: v.specialization ?? null,
      academic_degree: v.academic_degree ?? null,
      academic_rank: v.academic_rank ?? null,
      instructor_type_id: v._instructor_type_id ?? null,
      department_id: v._department_id ?? null,
      employment_type: v.employment_type ?? "full_time",
      max_weekly_hours: v.max_weekly_hours ?? 18,
      max_hours_per_day: v.max_hours_per_day ?? null,
      administrative_release_hours: v.administrative_release_hours ?? 0,
      admin_tasks: v.admin_tasks ?? null,
      external_source: v.external_source ?? null,
      notes: v.notes ?? null,
      is_active: v.is_active ?? true,
    };
  }
  if (entity === "rooms") {
    return {
      ...base,
      code: v.code,
      name: v.name,
      capacity: v.capacity ?? 30,
      room_type: v.room_type as string,
      room_type_id: v._room_type_id ?? null,
      building_id: v._building_id ?? null,
      building: v.building ?? null,
      floor: v.floor ?? null,
      available_start_time: v.available_start_time ?? null,
      available_end_time: v.available_end_time ?? null,
      notes: v.notes ?? null,
      is_active: v.is_active ?? true,
    };
  }
  if (entity === "academic_terms") {
    return {
      ...base,
      code: v.code,
      name: v.name,
      academic_year: v.academic_year ?? null,
      term_type: v.term_type ?? null,
      start_date: v.start_date ?? null,
      end_date: v.end_date ?? null,
      teaching_weeks_count: v.teaching_weeks_count ?? null,
      is_active: v.is_active ?? false,
    };
  }
  if (entity === "daily_breaks") {
    return {
      ...base,
      name: v.name,
      start_time: v.start_time,
      end_time: v.end_time,
      days: v.days ?? [],
      affects_scheduling: v.affects_scheduling ?? true,
    };
  }
  return base;
}
