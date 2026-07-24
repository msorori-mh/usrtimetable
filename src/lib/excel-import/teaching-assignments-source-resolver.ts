/**
 * Resolve academic source rows → teaching_assignments_v2 import rows.
 * Pure logic with injectable lookup context (harness + runtime).
 */
import {
  looksLikeCourseCode,
  looksLikeEmployeeNumber,
  normalizedMatchKey,
} from "./arabic-normalize";
import {
  PROGRAM_ALIAS_TARGETS,
  resolveProgramField,
  type ProgramAliasCode,
} from "./program-aliases";
import { TA_V2_COMPONENT_TYPES } from "./registry";
import type { ParsedRow, RowError } from "./types";
import type { ParsedSourceRow } from "./teaching-assignments-source-parser";
import type { SourceStudySystemScope } from "./teaching-assignments-source-schema";
import { expandStudySystems } from "./teaching-assignments-source-schema";

export type TimetabledComponentType = (typeof TA_V2_COMPONENT_TYPES)[number];

export interface ResolverInstructor {
  id: string;
  employee_number: string;
  full_name_ar: string | null;
  full_name: string | null;
}

export interface ResolverProgram {
  id: string;
  code: string;
}

export interface ResolverCourse {
  id: string;
  code: string;
  name: string;
}

export interface ResolverLevel {
  id: string;
  program_id: string;
  level_number: number;
}

export interface ResolverTerm {
  id: string;
  code: string;
  term_type: string | null;
}

export interface ResolverStudyPlan {
  id: string;
  program_id: string;
  is_active: boolean;
}

export interface ResolverPlanCourse {
  id: string;
  study_plan_id: string;
  course_id: string;
  level_id: string | null;
  semester: number;
}

export interface ResolverComponent {
  id: string;
  plan_course_id: string;
  component_type: string;
  weekly_contact_hours: number;
  is_timetabled: boolean;
}

export interface ResolverCohort {
  id: string;
  code: string | null;
  program_id: string;
  level_id: string;
  study_system: string;
  term_id: string;
  active: boolean;
}

export interface ResolverDeliveryGroup {
  id: string;
  cohort_id: string;
  component_id: string;
  group_code: string;
  plan_course_id: string;
  is_obsolete: boolean;
  active: boolean;
}

export interface SourceResolverContext {
  instructors: ResolverInstructor[];
  programs: ResolverProgram[];
  courses: ResolverCourse[];
  levels: ResolverLevel[];
  terms: ResolverTerm[];
  studyPlans: ResolverStudyPlan[];
  planCourses: ResolverPlanCourse[];
  components: ResolverComponent[];
  cohorts: ResolverCohort[];
  deliveryGroups: ResolverDeliveryGroup[];
}

export type SourceRowOutcome = "MATCHED" | "BLOCKED" | "ERROR" | "IGNORED" | "AMBIGUOUS";

export interface ResolvedSourceAssignment {
  outcome: SourceRowOutcome;
  sourceSheet: string;
  sourceRowNumber: number;
  studySystem: string;
  programCode: string;
  cohortCode?: string;
  courseCode?: string;
  componentType?: string;
  deliveryGroupCode?: string;
  employeeNumber?: string;
  assignedComponentHours?: number;
  notes?: string | null;
  blockedDependency?: string;
  errorCode?: string;
  message?: string;
  importRow?: ParsedRow;
}

export interface SourceResolutionPreview {
  assignments: ResolvedSourceAssignment[];
  errors: RowError[];
  totals: {
    sheets: number;
    sourceRows: number;
    ignored: number;
    matched: number;
    blocked: number;
    errors: number;
    ambiguous: number;
    expandedAssignments: number;
  };
  hasBlockers: boolean;
}

function termTypeToSemester(termType: string | null | undefined): number | null {
  if (termType === "first") return 1;
  if (termType === "second") return 2;
  return null;
}

function isAssignableComponent(c: ResolverComponent): boolean {
  if (c.component_type === "summer_training") return false;
  if (!c.is_timetabled) return false;
  if (c.component_type === "project" && Number(c.weekly_contact_hours) <= 0) return false;
  return (TA_V2_COMPONENT_TYPES as readonly string[]).includes(c.component_type);
}

function programByCode(ctx: SourceResolverContext, code: string): ResolverProgram | undefined {
  return ctx.programs.find((p) => p.code.toUpperCase() === code.toUpperCase());
}

function buildInstructorIndex(ctx: SourceResolverContext): Map<string, ResolverInstructor[]> {
  const byKey = new Map<string, ResolverInstructor[]>();
  for (const ins of ctx.instructors) {
    const keys = new Set<string>();
    if (ins.employee_number) keys.add(normalizedMatchKey(ins.employee_number));
    if (ins.full_name_ar) keys.add(normalizedMatchKey(ins.full_name_ar));
    if (ins.full_name) keys.add(normalizedMatchKey(ins.full_name));
    for (const k of keys) {
      const arr = byKey.get(k) ?? [];
      arr.push(ins);
      byKey.set(k, arr);
    }
  }
  return byKey;
}

function matchInstructor(
  ctx: SourceResolverContext,
  index: Map<string, ResolverInstructor[]>,
  rawName: string,
): { ok: true; instructor: ResolverInstructor } | { ok: false; code: string; message: string } {
  const trimmed = String(rawName ?? "").trim();
  if (!trimmed) {
    return { ok: false, code: "missing_instructor", message: "اسم المحاضر مطلوب" };
  }
  if (looksLikeEmployeeNumber(trimmed)) {
    const hit = ctx.instructors.filter(
      (i) => normalizedMatchKey(i.employee_number) === normalizedMatchKey(trimmed),
    );
    if (hit.length === 1) return { ok: true, instructor: hit[0] };
    if (hit.length > 1) {
      return {
        ok: false,
        code: "ambiguous_instructor",
        message: `أكثر من محاضر لرقم الموظف: ${trimmed}`,
      };
    }
    return {
      ok: false,
      code: "instructor_not_found",
      message: `محاضر غير موجود لرقم الموظف: ${trimmed}`,
    };
  }
  const key = normalizedMatchKey(trimmed);
  const hits = index.get(key) ?? [];
  if (hits.length === 1) return { ok: true, instructor: hits[0] };
  if (hits.length > 1) {
    return {
      ok: false,
      code: "ambiguous_instructor",
      message: `أكثر من محاضر للاسم: ${trimmed}`,
    };
  }
  return {
    ok: false,
    code: "instructor_not_found",
    message: `محاضر غير موجود: ${trimmed}`,
  };
}

function matchCourse(
  ctx: SourceResolverContext,
  courseName: string,
  programId: string,
  levelId: string,
  semester: number,
): { ok: true; course: ResolverCourse } | { ok: false; code: string; message: string } {
  const raw = String(courseName ?? "").trim();
  if (!raw) {
    return { ok: false, code: "missing_course", message: "اسم المقرر مطلوب" };
  }
  if (looksLikeCourseCode(raw)) {
    const codeHit = ctx.courses.filter((c) => c.code.toUpperCase() === raw.toUpperCase());
    if (codeHit.length === 1) return { ok: true, course: codeHit[0] };
    if (codeHit.length > 1) {
      return {
        ok: false,
        code: "ambiguous_course_code",
        message: `رمز مقرر مكرر: ${raw}`,
      };
    }
  }
  const activePlans = ctx.studyPlans.filter((sp) => sp.is_active && sp.program_id === programId);
  const planIds = new Set(activePlans.map((sp) => sp.id));
  const planCourseCourseIds = new Set(
    ctx.planCourses
      .filter(
        (pc) =>
          planIds.has(pc.study_plan_id) && pc.level_id === levelId && pc.semester === semester,
      )
      .map((pc) => pc.course_id),
  );
  const key = normalizedMatchKey(raw);
  const nameHits = ctx.courses.filter(
    (c) => planCourseCourseIds.has(c.id) && normalizedMatchKey(c.name) === key,
  );
  if (nameHits.length === 1) return { ok: true, course: nameHits[0] };
  if (nameHits.length > 1) {
    return {
      ok: false,
      code: "ambiguous_course",
      message: `أكثر من مقرر للاسم: ${raw}`,
    };
  }
  return {
    ok: false,
    code: "course_not_found",
    message: `مقرر غير موجود في البرنامج/المستوى/الفصل: ${raw}`,
  };
}

function findCohort(
  ctx: SourceResolverContext,
  programId: string,
  levelId: string,
  termId: string,
  studySystem: string,
): ResolverCohort | undefined {
  return ctx.cohorts.find(
    (c) =>
      c.active &&
      c.program_id === programId &&
      c.level_id === levelId &&
      c.term_id === termId &&
      c.study_system === studySystem,
  );
}

function planCourseFor(
  ctx: SourceResolverContext,
  programId: string,
  courseId: string,
  levelId: string,
  semester: number,
): ResolverPlanCourse | undefined {
  const activePlans = ctx.studyPlans.filter((sp) => sp.is_active && sp.program_id === programId);
  for (const sp of activePlans) {
    const pc = ctx.planCourses.find(
      (p) =>
        p.study_plan_id === sp.id &&
        p.course_id === courseId &&
        p.level_id === levelId &&
        p.semester === semester,
    );
    if (pc) return pc;
  }
  return undefined;
}

type ComponentMatch =
  | { kind: "single"; componentIds: string[] }
  | { kind: "expand_all"; componentIds: string[] }
  | { kind: "ambiguous"; message: string }
  | { kind: "none"; message: string };

function matchComponentsByHours(
  components: ResolverComponent[],
  totalHours: number | null,
): ComponentMatch {
  const assignable = components.filter(isAssignableComponent);
  if (assignable.length === 0) {
    return { kind: "none", message: "لا توجد مكوّنات قابلة للجدولة" };
  }
  if (assignable.length === 1) {
    return { kind: "single", componentIds: [assignable[0].id] };
  }
  if (totalHours === null) {
    return {
      kind: "ambiguous",
      message: "عدة مكوّنات بدون ساعات كافية للتمييز",
    };
  }
  const hour = Number(totalHours);
  const exact = assignable.filter((c) => Number(c.weekly_contact_hours) === hour);
  if (exact.length === 1) {
    return { kind: "single", componentIds: [exact[0].id] };
  }
  const sum = assignable.reduce((a, c) => a + Number(c.weekly_contact_hours), 0);
  if (Math.abs(sum - hour) < 0.001) {
    return { kind: "expand_all", componentIds: assignable.map((c) => c.id) };
  }
  if (exact.length > 1) {
    return { kind: "ambiguous", message: "عدة مكوّنات بنفس الساعات" };
  }
  return {
    kind: "ambiguous",
    message: `تعارض مطابقة الساعات (${hour}) مع المكوّنات`,
  };
}

function deliveryGroupsForComponent(
  ctx: SourceResolverContext,
  cohortId: string,
  componentId: string,
): ResolverDeliveryGroup[] {
  return ctx.deliveryGroups.filter(
    (dg) =>
      dg.cohort_id === cohortId && dg.component_id === componentId && !dg.is_obsolete && dg.active,
  );
}

function toImportRow(
  rowNumber: number,
  cohort: ResolverCohort,
  course: ResolverCourse,
  component: ResolverComponent,
  dg: ResolverDeliveryGroup,
  instructor: ResolverInstructor,
  hours: number | null,
  notes: string | null,
): ParsedRow {
  const perComponentHours =
    hours !== null && component.component_type !== "project"
      ? hours
      : component.weekly_contact_hours;
  const values: Record<string, unknown> = {
    cohort_code: cohort.code,
    course_code: course.code,
    component_type: component.component_type,
    delivery_group_code: dg.group_code,
    employee_number: instructor.employee_number,
    assigned_component_hours: perComponentHours,
    study_system: cohort.study_system,
    is_active: true,
    notes: notes ?? null,
    _cohort_id: cohort.id,
    _course_id: course.id,
    _component_id: component.id,
    _delivery_group_id: dg.id,
    _instructor_id: instructor.id,
    _offering_id: null,
    _is_active: true,
  };
  return { rowNumber, raw: {}, values };
}

function resolveProgramsForRow(
  ctx: SourceResolverContext,
  programRaw: string,
  levelNumber: number | null,
  termId: string,
  studySystems: ("regular" | "parallel")[],
): ProgramAliasCode[] | { blocked: string } | { error: string } {
  const resolution = resolveProgramField(programRaw);
  if (resolution.kind === "unknown") {
    return { error: `برنامج غير معروف: ${programRaw}` };
  }
  if (levelNumber === null) {
    return { blocked: "level" };
  }
  if (resolution.kind === "codes") return resolution.codes;

  const term = ctx.terms.find((t) => t.id === termId);
  const sem = termTypeToSemester(term?.term_type);
  if (sem === null) return { blocked: "term" };

  const eligible: ProgramAliasCode[] = [];
  for (const alias of PROGRAM_ALIAS_TARGETS) {
    const prog = programByCode(ctx, alias);
    if (!prog) continue;
    const level = ctx.levels.find(
      (l) => l.program_id === prog.id && l.level_number === levelNumber,
    );
    if (!level) continue;
    const activePlan = ctx.studyPlans.some((sp) => sp.is_active && sp.program_id === prog.id);
    if (!activePlan) continue;
    const hasCohort = studySystems.some((ss) => findCohort(ctx, prog.id, level.id, termId, ss));
    if (!hasCohort) continue;
    const hasDg = ctx.deliveryGroups.some((dg) => {
      const cohort = ctx.cohorts.find((c) => c.id === dg.cohort_id);
      return (
        cohort &&
        cohort.program_id === prog.id &&
        cohort.level_id === level.id &&
        cohort.term_id === termId &&
        studySystems.includes(cohort.study_system as "regular" | "parallel")
      );
    });
    if (!hasDg) continue;
    eligible.push(alias);
  }
  if (eligible.length === 0) return { blocked: "all_departments_expansion" };
  return eligible;
}

export function resolveSourceTeachingAssignments(input: {
  rows: ParsedSourceRow[];
  ctx: SourceResolverContext;
  sheetTermMap: Record<string, string>;
  studySystemScope: SourceStudySystemScope;
}): SourceResolutionPreview {
  const instructorIndex = buildInstructorIndex(input.ctx);
  const studySystems = expandStudySystems(input.studySystemScope);
  const assignments: ResolvedSourceAssignment[] = [];
  const errors: RowError[] = [];
  let ignored = 0;
  let matched = 0;
  let blocked = 0;
  let errorCount = 0;
  let ambiguous = 0;
  let expandedAssignments = 0;

  for (const row of input.rows) {
    if (row.ignored) {
      ignored++;
      assignments.push({
        outcome: "IGNORED",
        sourceSheet: row.sheetName,
        sourceRowNumber: row.rowNumber,
        studySystem: "",
        programCode: row.programRaw,
        message: row.ignoreReason,
      });
      continue;
    }

    const termId = input.sheetTermMap[row.sheetName];
    if (!termId) {
      errorCount++;
      errors.push({
        rowNumber: row.rowNumber,
        columnName: row.sheetName,
        errorCode: "missing_sheet_term",
        message: `حدد الفصل الأكاديمي للورقة: ${row.sheetName}`,
      });
      assignments.push({
        outcome: "ERROR",
        sourceSheet: row.sheetName,
        sourceRowNumber: row.rowNumber,
        studySystem: "",
        programCode: row.programRaw,
        errorCode: "missing_sheet_term",
        message: `حدد الفصل الأكاديمي للورقة: ${row.sheetName}`,
      });
      continue;
    }

    const term = input.ctx.terms.find((t) => t.id === termId);
    const semester = termTypeToSemester(term?.term_type);
    if (semester === null) {
      blocked++;
      assignments.push({
        outcome: "BLOCKED",
        sourceSheet: row.sheetName,
        sourceRowNumber: row.rowNumber,
        studySystem: "",
        programCode: row.programRaw,
        blockedDependency: "term",
        message: "نوع الفصل الأكاديمي غير مدعوم",
      });
      continue;
    }

    const insMatch = matchInstructor(input.ctx, instructorIndex, row.instructorName);
    if (!insMatch.ok) {
      errorCount++;
      errors.push({
        rowNumber: row.rowNumber,
        columnName: "الاسم",
        errorCode: insMatch.code,
        message: insMatch.message,
        rawValue: row.instructorName,
      });
      assignments.push({
        outcome: insMatch.code === "ambiguous_instructor" ? "AMBIGUOUS" : "ERROR",
        sourceSheet: row.sheetName,
        sourceRowNumber: row.rowNumber,
        studySystem: "",
        programCode: row.programRaw,
        errorCode: insMatch.code,
        message: insMatch.message,
      });
      if (insMatch.code === "ambiguous_instructor") ambiguous++;
      continue;
    }

    const programCodes = resolveProgramsForRow(
      input.ctx,
      row.programRaw,
      row.levelNumber,
      termId,
      studySystems,
    );
    if ("error" in programCodes) {
      errorCount++;
      errors.push({
        rowNumber: row.rowNumber,
        columnName: "البرنامج",
        errorCode: "unknown_program",
        message: programCodes.error,
        rawValue: row.programRaw,
      });
      assignments.push({
        outcome: "ERROR",
        sourceSheet: row.sheetName,
        sourceRowNumber: row.rowNumber,
        studySystem: "",
        programCode: row.programRaw,
        errorCode: "unknown_program",
        message: programCodes.error,
      });
      continue;
    }
    if ("blocked" in programCodes) {
      blocked++;
      assignments.push({
        outcome: "BLOCKED",
        sourceSheet: row.sheetName,
        sourceRowNumber: row.rowNumber,
        studySystem: "",
        programCode: row.programRaw,
        blockedDependency: programCodes.blocked,
        message: `اعتمادية ناقصة: ${programCodes.blocked}`,
      });
      continue;
    }

    for (const studySystem of studySystems) {
      for (const pCode of programCodes) {
        const prog = programByCode(input.ctx, pCode);
        if (!prog) {
          blocked++;
          assignments.push({
            outcome: "BLOCKED",
            sourceSheet: row.sheetName,
            sourceRowNumber: row.rowNumber,
            studySystem,
            programCode: pCode,
            blockedDependency: "program",
            message: `برنامج غير موجود: ${pCode}`,
          });
          continue;
        }
        const level = input.ctx.levels.find(
          (l) => l.program_id === prog.id && l.level_number === row.levelNumber,
        );
        if (!level) {
          blocked++;
          assignments.push({
            outcome: "BLOCKED",
            sourceSheet: row.sheetName,
            sourceRowNumber: row.rowNumber,
            studySystem,
            programCode: pCode,
            blockedDependency: "level",
            message: `مستوى غير موجود: ${row.levelNumber}`,
          });
          continue;
        }
        const cohort = findCohort(input.ctx, prog.id, level.id, termId, studySystem);
        if (!cohort || !cohort.code) {
          blocked++;
          assignments.push({
            outcome: "BLOCKED",
            sourceSheet: row.sheetName,
            sourceRowNumber: row.rowNumber,
            studySystem,
            programCode: pCode,
            blockedDependency: "cohort",
            message: "دفعة غير موجودة للبرنامج/المستوى/الفصل/نظام الدراسة",
          });
          continue;
        }

        const courseMatch = matchCourse(input.ctx, row.courseName, prog.id, level.id, semester);
        if (!courseMatch.ok) {
          const outcome = courseMatch.code.startsWith("ambiguous") ? "AMBIGUOUS" : "ERROR";
          if (outcome === "AMBIGUOUS") ambiguous++;
          else errorCount++;
          errors.push({
            rowNumber: row.rowNumber,
            columnName: "اسم المادة",
            errorCode: courseMatch.code,
            message: courseMatch.message,
            rawValue: row.courseName,
          });
          assignments.push({
            outcome,
            sourceSheet: row.sheetName,
            sourceRowNumber: row.rowNumber,
            studySystem,
            programCode: pCode,
            errorCode: courseMatch.code,
            message: courseMatch.message,
          });
          continue;
        }

        const planCourse = planCourseFor(
          input.ctx,
          prog.id,
          courseMatch.course.id,
          level.id,
          semester,
        );
        if (!planCourse) {
          blocked++;
          assignments.push({
            outcome: "BLOCKED",
            sourceSheet: row.sheetName,
            sourceRowNumber: row.rowNumber,
            studySystem,
            programCode: pCode,
            blockedDependency: "curriculum",
            message: "مقرر غير موجود في منهج الخطة النشطة",
          });
          continue;
        }

        const comps = input.ctx.components.filter((c) => c.plan_course_id === planCourse.id);
        const compMatch = matchComponentsByHours(comps, row.totalHours);
        if (compMatch.kind === "none") {
          blocked++;
          assignments.push({
            outcome: "BLOCKED",
            sourceSheet: row.sheetName,
            sourceRowNumber: row.rowNumber,
            studySystem,
            programCode: pCode,
            blockedDependency: "component",
            message: compMatch.message,
          });
          continue;
        }
        if (compMatch.kind === "ambiguous") {
          ambiguous++;
          errors.push({
            rowNumber: row.rowNumber,
            columnName: "اجمالي الساعات",
            errorCode: "ambiguous_component",
            message: compMatch.message,
            rawValue: String(row.totalHours ?? ""),
          });
          assignments.push({
            outcome: "AMBIGUOUS",
            sourceSheet: row.sheetName,
            sourceRowNumber: row.rowNumber,
            studySystem,
            programCode: pCode,
            errorCode: "ambiguous_component",
            message: compMatch.message,
          });
          continue;
        }

        for (const compId of compMatch.componentIds) {
          const component = comps.find((c) => c.id === compId);
          if (!component) continue;
          const dgs = deliveryGroupsForComponent(input.ctx, cohort.id, compId);
          if (dgs.length === 0) {
            blocked++;
            assignments.push({
              outcome: "BLOCKED",
              sourceSheet: row.sheetName,
              sourceRowNumber: row.rowNumber,
              studySystem,
              programCode: pCode,
              blockedDependency: "delivery_groups",
              message: "مجموعات التقديم غير مولَّدة",
            });
            continue;
          }
          for (const dg of dgs) {
            const importRow = toImportRow(
              row.rowNumber,
              cohort,
              courseMatch.course,
              component,
              dg,
              insMatch.instructor,
              row.totalHours,
              row.notes,
            );
            matched++;
            expandedAssignments++;
            assignments.push({
              outcome: "MATCHED",
              sourceSheet: row.sheetName,
              sourceRowNumber: row.rowNumber,
              studySystem,
              programCode: pCode,
              cohortCode: cohort.code ?? undefined,
              courseCode: courseMatch.course.code,
              componentType: component.component_type,
              deliveryGroupCode: dg.group_code,
              employeeNumber: insMatch.instructor.employee_number,
              assignedComponentHours: importRow.values.assigned_component_hours as number,
              notes: row.notes,
              importRow,
            });
          }
        }
      }
    }
  }

  const hasBlockers = blocked > 0 || errorCount > 0 || ambiguous > 0;

  return {
    assignments,
    errors,
    totals: {
      sheets: new Set(input.rows.map((r) => r.sheetName)).size,
      sourceRows: input.rows.length,
      ignored,
      matched,
      blocked,
      errors: errorCount,
      ambiguous,
      expandedAssignments,
    },
    hasBlockers,
  };
}

export function sourcePreviewToValidatedRows(preview: SourceResolutionPreview): {
  validRows: ParsedRow[];
  errors: RowError[];
} {
  const validRows = preview.assignments
    .filter((a) => a.outcome === "MATCHED" && a.importRow)
    .map((a) => a.importRow as ParsedRow);
  return { validRows, errors: preview.errors };
}
