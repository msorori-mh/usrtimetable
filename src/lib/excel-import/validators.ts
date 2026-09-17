import { supabase } from "@/integrations/supabase/client";
import { TEMPLATES } from "./templates";
import { normalizeCourseNature } from "./course-nature";
import { resolveRoomTypeFields } from "./room-type-normalize";
import { deliveryGroupIsolationKey, sectionIsolationKey } from "./keys";
import { requireImportManager } from "./safety";
import { normalizeEmploymentType } from "@/lib/instructor-metadata";
import { isHourlyContractTypeCode } from "@/lib/instructors/effective-hours";
import {
  normalizeAdministrativePosition,
  requiresAdministrativeDepartment,
} from "@/lib/instructors/administrative-positions";
import {
  instructorHeader,
  prepareInstructorRow,
  type ExistingInstructor,
} from "./instructor-sheet";
import type { ImportEntity, ParsedRow, RowError, ValidationResult } from "./types";
import { canonicalizeImportShape } from "./header-aliases";
import { matchDepartment, matchProgram, programById } from "./academic-structure-matching";
import {
  buildPlanComponentSyncPayload,
  validatePlanRowRoomTypes,
  type PlanComponentRoomTypeField,
} from "@/lib/academic-delivery/plan-component-room-types";

const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

function toBool(v: unknown): boolean | null {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).trim().toLowerCase();
  if (["true", "1", "yes", "نعم", "y"].includes(s)) return true;
  if (["false", "0", "no", "لا", "n"].includes(s)) return false;
  return null;
}

interface Lookups {
  instructorRecords?: ExistingInstructor[];
  instructorDepartments?: { id: string; name: string }[];
  instructorTypes?: Map<string, string>;
  instructorTypeCodesById?: Map<string, string>;
  affiliationColleges?: Map<string, { id: string; university_id: string }>;
  affiliationDepartments?: Map<string, { id: string; college_id: string }>;
  operationalCollegeCode?: string | null;
  roomTypes?: Map<string, string>;
  roomTypeCatalog?: Array<{
    id: string;
    code: string;
    college_id: string;
    is_active: boolean;
    default_capacity: number;
  }>;
  departments?: Map<string, string>;
  /** Full department rows of the active college (code + name matching for founding imports). */
  departmentRows?: Array<{ id: string; code: string | null; name: string }>;
  /** Full program rows of the active college. */
  programRows?: Array<{
    id: string;
    code: string | null;
    name: string;
    department_id: string | null;
  }>;
  buildings?: Map<string, string>;
  programs?: Map<string, { id: string; department_id: string }>;
  terms?: Map<string, string>;
  courses?: Map<string, { id: string; department_id: string }>;
  instructors?: Map<string, string>;
  studyPlans?: Map<string, string>; // key: program_id|plan_code|version → study_plan_id
  planCourses?: Map<string, string>; // key: study_plan_id|course_id → plan_course_id
  /** key: program_id|level_id|course_id → plan_course_ids (shared courses may appear in many plans) */
  planCoursesByProgramLevel?: Map<string, string[]>;

  offerings?: Map<string, string>; // key: term_id|course_id|program_id(opt) → offering_id
  sections?: Map<string, string>; // key: course_id|term_id|section_number → section_id
  levels?: Map<string, string>; // key: program_id|level_number → level_id
  sectionGroups?: Map<string, string>; // key: term_id|course_id|group_name → group_id
  cohortsByCode?: Map<
    string,
    {
      id: string;
      code?: string | null;
      program_id: string;
      level_id: string;
      study_system: string;
      term_id: string;
    }
  >; // code → cohort row
  electiveSlots?: Map<string, string>; // study_plan_id|slot_code → id
  /** elective_slot_id|course_id → true when active membership exists */
  electiveSlotCourses?: Map<string, boolean>;
  components?: Map<string, string>; // plan_course_id|component_type → id
  deliveryGroups?: Map<string, string>; // cohort_id|component_id|group_code → id
  deliveryGroupMeta?: Map<string, { is_obsolete: boolean; active: boolean }>;
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
    const fetchInstructorCatalog = async (
      table: "instructors" | "instructor_types" | "departments",
    ) => {
      const result: Record<string, any>[] = [];
      for (let from = 0; ; from += 500) {
        const { data, error } = await supabase
          .from(table)
          .select("*")
          .eq("college_id", collegeId)
          .order("id")
          .range(from, from + 499);
        if (error) throw error;
        result.push(...(data ?? []));
        if (!data || data.length < 500) break;
      }
      return result;
    };
    const [it, dp, instructors, activeCollege] = await Promise.all([
      fetchInstructorCatalog("instructor_types"),
      fetchInstructorCatalog("departments"),
      fetchInstructorCatalog("instructors"),
      supabase.from("colleges").select("id, code, university_id").eq("id", collegeId).maybeSingle(),
    ]);
    if (activeCollege.error) throw activeCollege.error;
    if (!activeCollege.data) throw new Error("تعذر تحديد الكلية التشغيلية للاستيراد");
    const universityId = activeCollege.data.university_id;
    const { data: collegeRows, error: collegeError } = await supabase
      .from("colleges")
      .select("id, code, university_id")
      .eq("university_id", universityId);
    if (collegeError) throw collegeError;
    const universityCollegeIds = (collegeRows ?? []).map((c) => c.id);
    const { data: affiliationDepartmentRows, error: affiliationDepartmentError } =
      universityCollegeIds.length > 0
        ? await supabase
            .from("departments")
            .select("id, code, college_id")
            .in("college_id", universityCollegeIds)
        : { data: [], error: null };
    if (affiliationDepartmentError) throw affiliationDepartmentError;

    lk.instructorTypes = new Map(
      it.map((r) => [String(r.code).trim().toLowerCase(), String(r.id)]),
    );
    lk.instructorTypeCodesById = new Map(
      it.map((r) => [String(r.id), String(r.code).trim().toLowerCase()]),
    );
    lk.departments = new Map(dp.map((r) => [String(r.code), String(r.id)]));
    lk.instructorDepartments = dp.map((r) => ({ id: r.id, name: r.name }));
    lk.instructorRecords = instructors as ExistingInstructor[];
    lk.operationalCollegeCode = activeCollege.data.code ?? null;
    lk.affiliationColleges = new Map(
      (collegeRows ?? [])
        .filter((c) => c.code)
        .map((c) => [
          String(c.code).trim().toLowerCase(),
          { id: c.id, university_id: c.university_id },
        ]),
    );
    lk.affiliationDepartments = new Map(
      (affiliationDepartmentRows ?? [])
        .filter((d) => d.code)
        .map((d) => [
          `${d.college_id}|${String(d.code).trim().toLowerCase()}`,
          { id: d.id, college_id: d.college_id },
        ]),
    );
  }
  // Founding academic structure: departments/programs are scoped to the active college only.
  if (entity === "departments" || entity === "academic_programs") {
    const dp = await fetchAll("departments", "id, code, name");
    lk.departmentRows = dp.map((r) => ({
      id: String(r.id),
      code: r.code == null ? null : String(r.code),
      name: String(r.name ?? ""),
    }));
    if (entity === "academic_programs") {
      const pg = await fetchAll("academic_programs", "id, code, name, department_id");
      lk.programRows = pg.map((r) => ({
        id: String(r.id),
        code: r.code == null ? null : String(r.code),
        name: String(r.name ?? ""),
        department_id: r.department_id == null ? null : String(r.department_id),
      }));
    }
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
      "elective_slot_courses",
      "teaching_assignments_v2",
    ].includes(entity)
  ) {
    const [dp, pg, rt] = await Promise.all([
      fetchAll("departments", "id, code"),
      fetchAll("academic_programs", "id, code, department_id"),
      fetchAll("room_types", "id, code, college_id, is_active, default_capacity"),
    ]);
    lk.departments = new Map(dp.map((r) => [r.code, r.id]));
    lk.programs = new Map(pg.map((r) => [r.code, { id: r.id, department_id: r.department_id }]));
    lk.roomTypes = new Map(rt.map((r) => [r.code, r.id]));
    lk.roomTypeCatalog = rt.map((r) => ({
      id: r.id as string,
      code: r.code as string,
      college_id: r.college_id as string,
      is_active: r.is_active !== false,
      default_capacity: Number(r.default_capacity ?? 0),
    }));
  }
  if (
    [
      "course_offerings",
      "teaching_assignments",
      "teaching_assignments_v2",
      "section_groups",
      "sections",
      "academic_cohorts",
    ].includes(entity)
  ) {
    const t = await fetchAll("academic_terms", "id, code");
    lk.terms = new Map(t.map((r) => [r.code, r.id]));
  }
  if (
    [
      "course_offerings",
      "teaching_assignments",
      "teaching_assignments_v2",
      "course_programs",
      "section_groups",
      "sections",
      "elective_slot_courses",
      "cohort_elective_selections",
    ].includes(entity)
  ) {
    const c = await fetchAll("courses", "id, code, department_id");
    lk.courses = new Map(c.map((r) => [r.code, { id: r.id, department_id: r.department_id }]));
  }
  if (entity === "sections") {
    const sec = await fetchAll("sections", "id, course_id, term_id, section_number, study_system");
    lk.sections = new Map(
      sec.map((r) => [
        `${r.course_id}|${r.term_id}|${r.section_number}|${r.study_system ?? "regular"}`,
        r.id,
      ]),
    );
  }
  if (entity === "teaching_assignments" || entity === "teaching_assignments_v2") {
    const ins = await fetchAll("instructors", "id, employee_number");
    lk.instructors = new Map(
      ins.filter((r) => r.employee_number).map((r) => [r.employee_number as string, r.id]),
    );
  }
  if (
    entity === "course_offerings" ||
    entity === "elective_slot_courses" ||
    entity === "teaching_assignments_v2"
  ) {
    const sp = await fetchAll("study_plans", "id, code, version, program_id");
    lk.studyPlans = new Map(sp.map((r) => [`${r.program_id}|${r.code}|${r.version}`, r.id]));
    const pc = await fetchAll("plan_courses", "id, study_plan_id, course_id, level_id");
    lk.planCourses = new Map(pc.map((r) => [`${r.study_plan_id}|${r.course_id}`, r.id]));
    const planProgram = new Map(sp.map((r) => [String(r.id), String(r.program_id)]));
    const byProgramLevel = new Map<string, string[]>();
    for (const r of pc) {
      const programId = planProgram.get(String(r.study_plan_id));
      if (!programId || !r.level_id) continue;
      const key = `${programId}|${r.level_id}|${r.course_id}`;
      const list = byProgramLevel.get(key);
      if (list) list.push(String(r.id));
      else byProgramLevel.set(key, [String(r.id)]);
    }
    lk.planCoursesByProgramLevel = byProgramLevel;

    const lv = await fetchAll("academic_levels", "id, program_id, level_number");
    lk.levels = new Map(lv.map((r) => [`${r.program_id}|${r.level_number}`, r.id]));
  }
  if (entity === "academic_cohorts") {
    const lv = await fetchAll("academic_levels", "id, program_id, level_number");
    lk.levels = new Map(lv.map((r) => [`${r.program_id}|${r.level_number}`, r.id]));
  }
  if (
    entity === "elective_slot_courses" ||
    entity === "cohort_elective_selections" ||
    entity === "teaching_assignments_v2"
  ) {
    const slots = await fetchAll(
      "elective_slots",
      "id, study_plan_id, slot_code, semester, level_id, active",
    );
    lk.electiveSlots = new Map(slots.map((r) => [`${r.study_plan_id}|${r.slot_code}`, r.id]));
    const cohorts = await fetchAll(
      "academic_cohorts",
      "id, code, program_id, level_id, study_system, term_id",
    );
    lk.cohortsByCode = new Map(cohorts.filter((r) => r.code).map((r) => [String(r.code), r]));
  }
  if (entity === "cohort_elective_selections") {
    const esc = await fetchAll("elective_slot_courses", "elective_slot_id, course_id, active");
    lk.electiveSlotCourses = new Map(
      esc
        .filter((r) => r.active !== false)
        .map((r) => [`${r.elective_slot_id}|${r.course_id}`, true]),
    );
  }
  if (entity === "teaching_assignments_v2") {
    const comps = await fetchAll("plan_course_components", "id, plan_course_id, component_type");
    lk.components = new Map(comps.map((r) => [`${r.plan_course_id}|${r.component_type}`, r.id]));
    const dgs = await fetchAll(
      "delivery_groups",
      "id, cohort_id, component_id, group_code, is_obsolete, active",
    );
    lk.deliveryGroups = new Map(
      dgs.map((r) => [`${r.cohort_id}|${r.component_id}|${r.group_code}`, r.id]),
    );
    lk.deliveryGroupMeta = new Map(
      dgs.map((r) => [
        r.id as string,
        {
          is_obsolete: Boolean((r as { is_obsolete?: boolean }).is_obsolete),
          active: (r as { active?: boolean }).active !== false,
        },
      ]),
    );
    const offs = await fetchAll(
      "course_offerings",
      "id, term_id, course_id, program_id, level_id, study_system",
    );
    lk.offerings = new Map(
      offs.map(
        (r) =>
          [
            `${r.term_id}|${r.course_id}|${r.program_id ?? ""}|${r.level_id ?? ""}|${r.study_system}`,
            r.id,
          ] as const,
      ),
    );
  }
  return lk;
}

function normalize(
  headers: string[],
  rows: Record<string, unknown>[],
  entity: ImportEntity,
): {
  parsed: ParsedRow[];
  missingHeaders: string[];
  unknownHeaders: string[];
  duplicateHeaders: string[];
} {
  const tpl = TEMPLATES[entity];
  if (entity === "instructors") {
    headers = headers.map((h) => instructorHeader(h, tpl.columns));
    rows = rows.map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([h, value]) => [instructorHeader(h, tpl.columns), value]),
      ),
    );
  }
  ({ headers, rows } = canonicalizeImportShape(tpl.columns, headers, rows));
  const trimmed = headers.map((h) => h.trim()).filter(Boolean);
  const headerSet = new Set(trimmed);
  const legacyInstructorShape = entity === "instructors" && !headerSet.has("كلية_التبعية_رمز");
  const missingHeaders = tpl.columns
    .filter(
      (c) =>
        c.required &&
        !(entity === "instructors" && c.key === "employee_number") &&
        !(
          legacyInstructorShape &&
          (c.key === "instructor_type_code" ||
            c.key === "affiliation_college_code" ||
            c.key === "affiliation_department_code")
        ) &&
        !(
          legacyInstructorShape &&
          (c.key === "affiliation_college_code" || c.key === "affiliation_department_code")
        ) &&
        !headerSet.has(c.header),
    )
    .map((c) => c.header);
  const knownHeaders = new Set(tpl.columns.map((c) => c.header));
  const unknownHeaders = [...headerSet].filter((h) => !knownHeaders.has(h));
  const seen = new Set<string>();
  const duplicateHeaders: string[] = [];
  for (const h of trimmed) {
    if (seen.has(h)) {
      if (!duplicateHeaders.includes(h)) duplicateHeaders.push(h);
    } else {
      seen.add(h);
    }
  }
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
      else if (
        col.key === "course_nature" &&
        (entity === "study_plan_courses" || entity === "full_study_plan")
      )
        values[col.key] = normalizeCourseNature(s);
      else values[col.key] = s;
    }
    return { rowNumber: i + 2, raw, values };
  });
  return { parsed, missingHeaders, unknownHeaders, duplicateHeaders };
}

/**
 * Pure resolver for teaching_assignments_v2: given plan_course candidates already
 * scoped to the cohort's program + level, pick the component whose delivery group
 * exists for this cohort. Falls back to the first candidate component so a missing
 * group is reported as unknown_delivery_group (not unknown_component).
 */
export function resolveTeachingAssignmentComponent(input: {
  candidatePlanCourseIds: string[];
  componentType: string;
  cohortId: string;
  deliveryGroupCode: string | null;
  components: Map<string, string>;
  deliveryGroups: Map<string, string>;
}): { componentId: string | null; deliveryGroupId: string | null } {
  const componentIds: string[] = [];
  for (const planCourseId of input.candidatePlanCourseIds) {
    const compId = input.components.get(`${planCourseId}|${input.componentType}`);
    if (compId && !componentIds.includes(compId)) componentIds.push(compId);
  }
  if (componentIds.length === 0) return { componentId: null, deliveryGroupId: null };
  if (input.deliveryGroupCode) {
    for (const compId of componentIds) {
      const dg = input.deliveryGroups.get(`${input.cohortId}|${compId}|${input.deliveryGroupCode}`);
      if (dg) return { componentId: compId, deliveryGroupId: dg };
    }
  }
  return { componentId: componentIds[0] ?? null, deliveryGroupId: null };
}

export async function validate(
  entity: ImportEntity,
  headers: string[],
  rows: Record<string, unknown>[],
  collegeId: string,
  rowNumbers?: number[],
  headerRowNumber = 1,
): Promise<ValidationResult & { missingHeaders: string[]; unknownHeaders: string[] }> {
  await requireImportManager(collegeId);
  const tpl = TEMPLATES[entity];
  const legacyInstructorInput =
    entity === "instructors" &&
    !headers.some((header) => instructorHeader(header, tpl.columns) === "كلية_التبعية_رمز");
  const { parsed, missingHeaders, unknownHeaders, duplicateHeaders } = normalize(
    headers,
    rows,
    entity,
  );
  const errors: RowError[] = [];
  if (rowNumbers)
    parsed.forEach((row, index) => {
      row.rowNumber = rowNumbers[index] ?? row.rowNumber;
    });
  const validRows: ParsedRow[] = [];
  const invalidRows: ParsedRow[] = [];

  if (duplicateHeaders.length > 0) {
    return {
      validRows: [],
      invalidRows: parsed,
      errors: duplicateHeaders.map((h) => ({
        rowNumber: headerRowNumber,
        columnName: h,
        errorCode: "duplicate_header",
        message: `عنوان عمود مكرر: ${h}`,
      })),
      missingHeaders,
      unknownHeaders,
    };
  }

  if (missingHeaders.length > 0) {
    return {
      validRows: [],
      invalidRows: parsed,
      errors: missingHeaders.map((h) => ({
        rowNumber: headerRowNumber,
        columnName: h,
        errorCode: "missing_column",
        message: `عمود مطلوب مفقود: ${h}`,
      })),
      missingHeaders,
      unknownHeaders,
    };
  }

  // Delivery policy: reject unknown columns for all ImportEntity templates (active + retained Legacy).
  if (unknownHeaders.length > 0) {
    return {
      validRows: [],
      invalidRows: parsed,
      errors: unknownHeaders.map((h) => ({
        rowNumber: headerRowNumber,
        columnName: h,
        errorCode: "unknown_column",
        message: `عمود غير معروف في القالب الرسمي: ${h}`,
      })),
      missingHeaders,
      unknownHeaders,
    };
  }

  const lk = await loadLookups(entity, collegeId);

  // Existing-key set for simple table entities
  const existingKeys = new Set<string>();
  if (entity === "instructors") {
    for (const row of lk.instructorRecords ?? []) {
      if (row.employee_number) existingKeys.add(row.employee_number.trim().toLowerCase());
    }
  } else if (tpl.commitMode !== "custom") {
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
    const rowErrors: RowError[] =
      entity === "instructors"
        ? prepareInstructorRow(
            row,
            lk.instructorRecords ?? [],
            tpl.columns,
            lk.instructorDepartments,
          )
        : [];

    for (const c of tpl.columns) {
      const legacyInstructorRequiredExempt =
        entity === "instructors" &&
        legacyInstructorInput &&
        (c.key === "instructor_type_code" ||
          c.key === "affiliation_college_code" ||
          c.key === "affiliation_department_code");
      if (
        c.required &&
        !legacyInstructorRequiredExempt &&
        (row.values[c.key] === null ||
          row.values[c.key] === undefined ||
          row.values[c.key] === "") &&
        !(
          entity === "instructors" &&
          row.values.department_code &&
          (c.key === "affiliation_college_code" || c.key === "affiliation_department_code")
        )
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
    if (entity === "study_plan_courses" || entity === "full_study_plan") {
      mergeStudyPlanLegacyRoomTypeFields(row.values);
    }
    runEntityValidation(entity, row, lk, rowErrors, collegeId);

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
        // Name-fallback matches (founding academic structure) also count as existing rows.
        row.values._exists = existingKeys.has(k) || !!row.values._name_match_id;
      } else if (row.values._name_match_id) {
        row.values._exists = true;
      }
    }

    // legacy entities (instructors/rooms)
    if (entity === "instructors") {
      let rawTypeCode = String(row.values.instructor_type_code ?? "").trim();
      let typeCode = rawTypeCode.toLowerCase();
      if (!typeCode && row.values._instructor_type_id) {
        typeCode = lk.instructorTypeCodesById?.get(String(row.values._instructor_type_id)) ?? "";
        rawTypeCode = typeCode;
        if (typeCode) row.values.instructor_type_code = typeCode;
      }
      const typeId = typeCode ? lk.instructorTypes?.get(typeCode) : null;
      if (typeCode) {
        if (!typeId)
          rowErrors.push({
            rowNumber: row.rowNumber,
            columnName: "فئة_المحاضر_رمز",
            errorCode: "unknown_instructor_type",
            message: `نوع محاضر غير معروف: ${rawTypeCode}`,
            rawValue: rawTypeCode,
          });
        else row.values._instructor_type_id = typeId;
      }
      const hourlyContract = isHourlyContractTypeCode(typeCode);
      if (!hourlyContract && !String(row.values.employee_number ?? "").trim()) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          columnName: "رقم_الموظف",
          errorCode: "instructor_employee_number_required",
          message: "رقم الموظف مطلوب لكل الفئات عدا متعاقد بالساعات (con).",
        });
      }

      const legacyDepartmentCode = String(row.values.department_code ?? "").trim();
      const affiliationCollegeCode = String(
        row.values.affiliation_college_code ?? lk.operationalCollegeCode ?? "",
      )
        .trim()
        .toLowerCase();
      const affiliationCollege = affiliationCollegeCode
        ? lk.affiliationColleges?.get(affiliationCollegeCode)
        : null;
      if (!affiliationCollege) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          columnName: "كلية_التبعية_رمز",
          errorCode: "unknown_affiliation_college",
          message: `كلية تبعية غير معروفة: ${row.values.affiliation_college_code ?? ""}`,
          rawValue: String(row.values.affiliation_college_code ?? ""),
        });
      } else {
        row.values._affiliation_college_id = affiliationCollege.id;
        row.values.affiliation_college_code = affiliationCollegeCode;
      }

      const affiliationDepartmentCode = String(
        row.values.affiliation_department_code ?? legacyDepartmentCode,
      )
        .trim()
        .toLowerCase();
      let affiliationDepartment =
        affiliationCollege && affiliationDepartmentCode
          ? lk.affiliationDepartments?.get(`${affiliationCollege.id}|${affiliationDepartmentCode}`)
          : null;
      if (!affiliationDepartment && affiliationCollege && row.values._department_id) {
        for (const [compoundKey, candidate] of lk.affiliationDepartments ?? []) {
          if (
            candidate.id === String(row.values._department_id) &&
            candidate.college_id === affiliationCollege.id
          ) {
            affiliationDepartment = candidate;
            row.values.affiliation_department_code = compoundKey.slice(
              compoundKey.indexOf("|") + 1,
            );
            break;
          }
        }
      }
      if (!affiliationDepartment) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          columnName: "قسم_التبعية_رمز",
          errorCode: "unknown_affiliation_department",
          message: "قسم التبعية غير معروف أو لا يتبع كلية التبعية المختارة.",
          rawValue: String(row.values.affiliation_department_code ?? legacyDepartmentCode ?? ""),
        });
      } else {
        row.values._affiliation_department_id = affiliationDepartment.id;
        if (!row.values.affiliation_department_code)
          row.values.affiliation_department_code = affiliationDepartmentCode;
        // Scheduling ownership remains in the operational college. Sync its department only
        // when the HR affiliation is the same college; otherwise preserve/null operational dept.
        if (affiliationCollege?.id === collegeId)
          row.values._department_id = affiliationDepartment.id;
      }

      if (legacyDepartmentCode && !row.values._department_id) {
        const operationalDepartmentId = lk.departments?.get(legacyDepartmentCode);
        if (operationalDepartmentId) row.values._department_id = operationalDepartmentId;
      }

      if (hourlyContract) {
        row.values.administrative_release_hours = 0;
        row.values.administrative_position = null;
        row.values._administrative_department_id = null;
      } else {
        const rawPosition = row.values.administrative_position;
        const normalizedPosition = rawPosition
          ? normalizeAdministrativePosition(rawPosition)
          : null;
        if (rawPosition && !normalizedPosition) {
          rowErrors.push({
            rowNumber: row.rowNumber,
            columnName: "المنصب_الإداري",
            errorCode: "invalid_administrative_position",
            message: "المنصب الإداري غير معروف.",
            rawValue: String(rawPosition),
          });
        }
        row.values.administrative_position = normalizedPosition;
        if (requiresAdministrativeDepartment(normalizedPosition)) {
          const adminCode = String(row.values.administrative_department_code ?? "")
            .trim()
            .toLowerCase();
          const adminDepartment =
            affiliationCollege && adminCode
              ? lk.affiliationDepartments?.get(`${affiliationCollege.id}|${adminCode}`)
              : null;
          if (!adminDepartment)
            rowErrors.push({
              rowNumber: row.rowNumber,
              columnName: "قسم_الرئاسة_رمز",
              errorCode: "administrative_department_required",
              message: "قسم الرئاسة مطلوب لرئيس القسم ويجب أن يتبع كلية التبعية.",
              rawValue: String(row.values.administrative_department_code ?? ""),
            });
          else row.values._administrative_department_id = adminDepartment.id;
        } else row.values._administrative_department_id = null;
      }
    }
    if (entity === "rooms") {
      const capacity = row.values.capacity;
      if (
        capacity !== null &&
        capacity !== undefined &&
        capacity !== "" &&
        (typeof capacity !== "number" || !Number.isFinite(capacity) || capacity <= 0)
      ) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          columnName: "السعة",
          errorCode: "invalid_capacity",
          message: "السعة يجب أن تكون رقمًا موجبًا أكبر من صفر",
          rawValue: String(capacity),
        });
      }
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

  return { validRows, invalidRows, errors, missingHeaders: [], unknownHeaders: [] };
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
    case "sections":
      return sectionIsolationKey(v);
    case "academic_cohorts":
      return `${v.program_code}|${v.level_number}|${v.study_system}|${v.entry_year}|${v.term_code}`.toLowerCase();
    case "elective_slot_courses":
      return `${v.plan_code}|${v.elective_slot_code}|${v.course_code}`.toLowerCase();
    case "cohort_elective_selections":
      return `${v.cohort_code}|${v.elective_slot_code}`.toLowerCase();
    case "teaching_assignments_v2":
      return deliveryGroupIsolationKey(v);
    default:
      return null;
  }
}

function mergeStudyPlanLegacyRoomTypeFields(values: Record<string, unknown>): void {
  const pairs: Array<[string, string]> = [
    ["required_room_type_code_lecture", "_legacy_required_room_type_code_lecture"],
    ["required_room_type_code_practical", "_legacy_required_room_type_code_practical"],
  ];
  for (const [canonical, legacy] of pairs) {
    const cur = values[canonical];
    if (cur === null || cur === undefined || cur === "") {
      const leg = values[legacy];
      if (leg !== null && leg !== undefined && leg !== "") {
        values[canonical] = leg;
      }
    }
    delete values[legacy];
  }
}

function studyPlanHoursFromValues(v: Record<string, unknown>) {
  return {
    theory_hours: v.theory_hours as number | null | undefined,
    practical_hours: v.practical_hours as number | null | undefined,
    tutorial_hours: v.tutorial_hours as number | null | undefined,
    training_hours: v.training_hours as number | null | undefined,
    project_hours: v.project_hours as number | null | undefined,
    is_summer_training: v.is_summer_training as boolean | null | undefined,
    is_graduation_project: v.is_graduation_project as boolean | null | undefined,
  };
}

function studyPlanRoomTypeCodesFromValues(
  v: Record<string, unknown>,
): Partial<Record<PlanComponentRoomTypeField, string | null | undefined>> {
  return {
    required_room_type_code_lecture: v.required_room_type_code_lecture as string | null | undefined,
    required_room_type_code_practical: v.required_room_type_code_practical as
      | string
      | null
      | undefined,
    required_room_type_code_tutorial: v.required_room_type_code_tutorial as
      | string
      | null
      | undefined,
    required_room_type_code_project: v.required_room_type_code_project as string | null | undefined,
  };
}

function runEntityValidation(
  entity: ImportEntity,
  row: ParsedRow,
  lk: Lookups,
  errs: RowError[],
  collegeId?: string,
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

  if (entity === "departments") {
    const code = String(v.code ?? "").trim();
    if (!code) {
      need(false, "الرمز", "department_code_required", "رمز القسم مفقود");
    }
    const match = matchDepartment(lk.departmentRows ?? [], { code, name: v.name });
    if (match.status === "ambiguous") {
      need(
        false,
        "الاسم",
        "ambiguous_department_match",
        "يوجد أكثر من قسم مطابق للاسم؛ استخدم الرمز",
        v.name,
      );
    } else if (match.status === "matched") {
      v._name_match_id = match.id;
    }
  }

  if (entity === "academic_programs") {
    const code = String(v.code ?? "").trim();
    if (!code) {
      need(false, "الرمز", "program_code_required", "رمز البرنامج مفقود");
    }
    const departmentInput = String(v.department_code ?? "").trim();
    let departmentId: string | null = null;
    if (!departmentInput) {
      need(false, "القسم", "program_department_required", "القسم مفقود");
    } else {
      const dept = matchDepartment(lk.departmentRows ?? [], {
        code: departmentInput,
        name: departmentInput,
      });
      if (dept.status === "ambiguous") {
        need(
          false,
          "القسم",
          "ambiguous_department_match",
          "يوجد أكثر من قسم مطابق للاسم؛ استخدم الرمز",
          departmentInput,
        );
      } else if (dept.status === "none") {
        need(
          false,
          "القسم",
          "unknown_department_in_college",
          `القسم ${departmentInput} غير موجود ضمن الكلية المحددة`,
          departmentInput,
        );
      } else {
        departmentId = dept.id;
        v._department_id = dept.id;
      }
    }
    const duration = v.duration_years;
    if (duration !== null && duration !== undefined && duration !== "") {
      const years = Number(duration);
      need(
        Number.isInteger(years) && years >= 1 && years <= 10,
        "المدة_بالسنوات",
        "invalid_duration_years",
        "المدة بالسنوات يجب أن تكون عددًا صحيحًا بين 1 و10",
        duration,
      );
    }
    const existing = matchProgram(lk.programRows ?? [], { code, name: v.name, departmentId });
    if (existing.status === "ambiguous") {
      need(
        false,
        "الاسم",
        "ambiguous_program_match",
        "يوجد أكثر من برنامج مطابق للاسم؛ استخدم الرمز",
        v.name,
      );
    } else if (existing.status === "matched") {
      v._name_match_id = existing.id;
      const current = programById(lk.programRows ?? [], existing.id);
      if (departmentId && current?.department_id && current.department_id !== departmentId) {
        need(
          false,
          "القسم",
          "program_department_change_blocked",
          "لا يمكن نقل برنامج قائم إلى قسم آخر عبر الاستيراد؛ عدّله من إدارة البرامج",
          departmentInput,
        );
      }
    }
  }


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

    if (collegeId && lk.roomTypeCatalog) {
      const courseCode = String(v.course_code ?? "");
      const { errors: rtErrors, resolvedIds } = validatePlanRowRoomTypes({
        courseCode,
        hours: studyPlanHoursFromValues(v),
        roomTypeCodes: studyPlanRoomTypeCodesFromValues(v),
        collegeId,
        catalog: lk.roomTypeCatalog,
      });
      for (const e of rtErrors) {
        errs.push({
          rowNumber: row.rowNumber,
          columnName: e.header,
          errorCode: e.errorCode,
          message: e.message,
          rawValue: e.rawValue,
        });
      }
      if (rtErrors.length === 0) {
        v._plan_component_sync = buildPlanComponentSyncPayload({
          hours: studyPlanHoursFromValues(v),
          resolvedRoomTypeIds: resolvedIds,
        });
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
  }

  if (entity === "academic_cohorts") {
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
      const lvId = lk.levels?.get(`${p.id}|${v.level_number}`);
      need(
        !!lvId,
        "رقم_المستوى",
        "unknown_level",
        `مستوى غير معروف: ${v.level_number}`,
        v.level_number,
      );
      if (lvId) v._level_id = lvId;
    }
    const tId = lk.terms?.get(String(v.term_code));
    need(!!tId, "رمز_الفصل", "unknown_term", `فصل غير معروف: ${v.term_code}`, v.term_code);
    if (tId) v._term_id = tId;
  }

  if (entity === "elective_slot_courses") {
    const p = lk.programs?.get(String(v.program_code));
    need(
      !!p,
      "رمز_البرنامج",
      "unknown_program",
      `برنامج غير معروف: ${v.program_code}`,
      v.program_code,
    );
    const ver = String(v.plan_version ?? "1");
    const spId = p ? lk.studyPlans?.get(`${p.id}|${v.plan_code}|${ver}`) : null;
    need(!!spId, "رمز_الخطة", "unknown_plan", `خطة غير معروفة: ${v.plan_code}`, v.plan_code);
    const slotId = spId ? lk.electiveSlots?.get(`${spId}|${v.elective_slot_code}`) : null;
    need(
      !!slotId,
      "رمز_الخانة_الاختيارية",
      "unknown_elective_slot",
      `خانة اختيارية غير معروفة: ${v.elective_slot_code}`,
      v.elective_slot_code,
    );
    const c = lk.courses?.get(String(v.course_code));
    need(!!c, "رمز_المقرر", "unknown_course", `مقرر غير معروف: ${v.course_code}`, v.course_code);
    if (slotId) v._elective_slot_id = slotId;
    if (c) v._course_id = c.id;
  }

  if (entity === "cohort_elective_selections") {
    const cohort = lk.cohortsByCode?.get(String(v.cohort_code));
    need(
      !!cohort,
      "رمز_الدفعة",
      "unknown_cohort",
      `دفعة غير معروفة: ${v.cohort_code}`,
      v.cohort_code,
    );
    if (cohort) {
      v._cohort_id = cohort.id;
      // Prefer slots on study plans for the cohort program; fall back to code match.
      let slotId: string | null = null;
      for (const [k, id] of lk.electiveSlots ?? []) {
        if (!k.endsWith(`|${v.elective_slot_code}`)) continue;
        // Prefer first match; membership check below still enforces elective_slot_courses.
        slotId = id;
        break;
      }
      need(
        !!slotId,
        "رمز_الخانة_الاختيارية",
        "unknown_elective_slot",
        `خانة اختيارية غير معروفة: ${v.elective_slot_code}`,
        v.elective_slot_code,
      );
      if (slotId) v._elective_slot_id = slotId;
    }
    const c = lk.courses?.get(String(v.selected_course_code));
    need(
      !!c,
      "رمز_المقرر_المختار",
      "unknown_course",
      `مقرر غير معروف: ${v.selected_course_code}`,
      v.selected_course_code,
    );
    if (c) v._course_id = c.id;
    // Defense in depth: selection alone is insufficient — course must be in elective_slot_courses.
    if (v._elective_slot_id && v._course_id) {
      const key = `${v._elective_slot_id}|${v._course_id}`;
      need(
        lk.electiveSlotCourses?.get(key) === true,
        "رمز_المقرر_المختار",
        "elective_course_not_in_slot",
        `المقرر المختار غير مدرج ضمن مقررات الخانة الاختيارية: ${v.selected_course_code}`,
        v.selected_course_code,
      );
    }
  }

  if (entity === "teaching_assignments_v2") {
    const cohort = lk.cohortsByCode?.get(String(v.cohort_code));
    need(
      !!cohort,
      "رمز_الدفعة",
      "unknown_cohort",
      `دفعة غير معروفة: ${v.cohort_code}`,
      v.cohort_code,
    );
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
    need(
      !!String(v.delivery_group_code ?? "").trim(),
      "رمز_مجموعة_التقديم",
      "required",
      "رمز مجموعة التدريس مطلوب — يعتمد الاستيراد على delivery_groups المولَّدة مسبقاً",
      v.delivery_group_code,
    );
    if (String(v.component_type) === "summer_training") {
      errs.push({
        rowNumber: row.rowNumber,
        columnName: "نوع_المحاضرة",
        errorCode: "summer_training_forbidden",
        message: "التدريب الصيفي لا يُسند كتدريس أسبوعي",
        rawValue: String(v.component_type),
      });
    }
    const hoursRaw = v.assigned_component_hours;
    if (hoursRaw !== null && hoursRaw !== undefined && hoursRaw !== "") {
      const h = Number(hoursRaw);
      need(
        Number.isFinite(h) && h > 0,
        "ساعات_المحاضرة_المسندة",
        "invalid_hours",
        "ساعات المحاضرة المسندة يجب أن تكون موجبة",
        hoursRaw,
      );
      v._assigned_component_hours = h;
    }
    if (v.is_active !== null && v.is_active !== undefined && v.is_active !== "") {
      const b = toBool(v.is_active);
      need(b !== null, "نشط", "invalid_boolean", "قيمة نشط غير صالحة", v.is_active);
      if (b !== null) v._is_active = b;
    }
    if (cohort) v._cohort_id = cohort.id;
    if (c) v._course_id = c.id;
    if (insId) v._instructor_id = insId;
    if (cohort && c) {
      if (v.study_system && String(v.study_system) !== String(cohort.study_system)) {
        errs.push({
          rowNumber: row.rowNumber,
          columnName: "نظام_الدراسة",
          errorCode: "study_system_mismatch",
          message: `نظام الدراسة لا يطابق الدفعة (${cohort.study_system})`,
          rawValue: String(v.study_system),
        });
      }
      // Resolve plan_course candidates scoped to the cohort's program + level,
      // then pick the component whose delivery_group actually exists for this cohort.
      const candidatePlanCourseIds =
        lk.planCoursesByProgramLevel?.get(`${cohort.program_id}|${cohort.level_id}|${c.id}`) ?? [];
      const groupCode = String(v.delivery_group_code ?? "").trim() || null;
      const resolved = resolveTeachingAssignmentComponent({
        candidatePlanCourseIds,
        componentType: String(v.component_type ?? ""),
        cohortId: cohort.id,
        deliveryGroupCode: groupCode,
        components: lk.components ?? new Map(),
        deliveryGroups: lk.deliveryGroups ?? new Map(),
      });
      const compId = resolved.componentId;
      need(
        !!compId,
        "نوع_المحاضرة",
        "unknown_component",
        `نوع محاضرة غير موجود للمقرر: ${v.component_type}`,
        v.component_type,
      );
      if (compId) v._component_id = compId;
      const offKey = `${cohort.term_id}|${c.id}|${cohort.program_id}|${cohort.level_id}|${cohort.study_system}`;
      const offId = lk.offerings?.get(offKey);
      if (offId) v._offering_id = offId;
      if (v.delivery_group_code && compId) {
        const dg = resolved.deliveryGroupId;

        need(
          !!dg,
          "رمز_مجموعة_التقديم",
          "unknown_delivery_group",
          `مجموعة تدريس غير معروفة — ولّد delivery_groups أولاً: ${v.delivery_group_code}`,
          v.delivery_group_code,
        );
        if (dg) {
          v._delivery_group_id = dg;
          const meta = lk.deliveryGroupMeta?.get(dg);
          if (meta?.is_obsolete) {
            errs.push({
              rowNumber: row.rowNumber,
              columnName: "رمز_مجموعة_التقديم",
              errorCode: "obsolete_delivery_group",
              message: "لا يمكن إسناد مجموعة تدريس ملغاة (obsolete)",
              rawValue: String(v.delivery_group_code),
            });
          } else if (meta?.active === false) {
            errs.push({
              rowNumber: row.rowNumber,
              columnName: "رمز_مجموعة_التقديم",
              errorCode: "inactive_delivery_group",
              message:
                "لا يمكن إسناد مجموعة تدريس غير نشطة (DELIVERY_GROUP_INACTIVE_ASSIGNMENT_FORBIDDEN)",
              rawValue: String(v.delivery_group_code),
            });
          }
        }
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
      const key = `${c.id}|${tId}|${v.section_number}|${v.study_system ?? "regular"}`;
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
  if (entity === "departments") {
    return {
      ...base,
      code: v.code ?? null,
      name: v.name,
      head_name: v.head_name ?? null,
      is_active: v.is_active ?? true,
      order_index: v.order_index ?? null,
    };
  }
  if (entity === "academic_programs") {
    return {
      ...base,
      code: v.code ?? null,
      name: v.name,
      department_id: v._department_id ?? null,
      degree_type: v.degree_type ?? "bachelor",
      duration_years: v.duration_years ?? 4,
      is_active: v.is_active ?? true,
      admission_status: v.admission_status ?? true,
      description: v.description ?? null,
    };
  }
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
      employment_type: normalizeEmploymentType(v.employment_type),
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
