/**
 * Runtime orchestration: load resolver context + preview source workbook import.
 */
import { supabase } from "@/integrations/supabase/client";
import { requireImportManager } from "./safety";
import type { ParsedRow, RowError } from "./types";
import {
  parseSourceWorkbookFile,
  readWorkbookSheetHeaders,
  type ParsedSourceWorkbook,
} from "./teaching-assignments-source-parser";
import {
  resolveSourceTeachingAssignments,
  sourcePreviewToValidatedRows,
  type SourceResolutionPreview,
  type SourceResolverContext,
} from "./teaching-assignments-source-resolver";
import type { SourceStudySystemScope } from "./teaching-assignments-source-schema";
import {
  detectTeachingImportWorkbookMode,
  type TeachingImportWorkbookMode,
} from "./teaching-assignments-source-schema";

export type SourceWorkbookPreview = {
  mode: TeachingImportWorkbookMode;
  workbook: ParsedSourceWorkbook;
  resolution: SourceResolutionPreview;
  validRows: ParsedRow[];
  errors: RowError[];
};

async function fetchAll<T extends Record<string, unknown>>(
  table: string,
  cols: string,
  collegeId: string,
): Promise<T[]> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data, error } = await (supabase.from(table as never) as any)
    .select(cols)
    .eq("college_id", collegeId);
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (error) throw error;
  return (data ?? []) as T[];
}

export async function loadSourceResolverContext(collegeId: string): Promise<SourceResolverContext> {
  await requireImportManager(collegeId);
  const [
    instructors,
    programs,
    courses,
    levels,
    terms,
    studyPlans,
    planCourses,
    components,
    cohorts,
    deliveryGroups,
  ] = await Promise.all([
    fetchAll<{
      id: string;
      employee_number: string;
      full_name_ar: string | null;
      full_name: string | null;
    }>("instructors", "id, employee_number, full_name_ar, full_name", collegeId),
    fetchAll<{ id: string; code: string }>("academic_programs", "id, code", collegeId),
    fetchAll<{ id: string; code: string; name: string }>("courses", "id, code, name", collegeId),
    fetchAll<{ id: string; program_id: string; level_number: number }>(
      "academic_levels",
      "id, program_id, level_number",
      collegeId,
    ),
    fetchAll<{ id: string; code: string; term_type: string | null }>(
      "academic_terms",
      "id, code, term_type",
      collegeId,
    ),
    fetchAll<{ id: string; program_id: string; is_active: boolean }>(
      "study_plans",
      "id, program_id, is_active",
      collegeId,
    ),
    fetchAll<{
      id: string;
      study_plan_id: string;
      course_id: string;
      level_id: string | null;
      semester: number;
    }>("plan_courses", "id, study_plan_id, course_id, level_id, semester", collegeId),
    fetchAll<{
      id: string;
      plan_course_id: string;
      component_type: string;
      weekly_contact_hours: number;
      is_timetabled: boolean;
    }>(
      "plan_course_components",
      "id, plan_course_id, component_type, weekly_contact_hours, is_timetabled",
      collegeId,
    ),
    fetchAll<{
      id: string;
      code: string | null;
      program_id: string;
      level_id: string;
      study_system: string;
      term_id: string;
      active: boolean;
    }>(
      "academic_cohorts",
      "id, code, program_id, level_id, study_system, term_id, active",
      collegeId,
    ),
    fetchAll<{
      id: string;
      cohort_id: string;
      component_id: string;
      group_code: string;
      plan_course_id: string;
      is_obsolete: boolean;
      active: boolean;
    }>(
      "delivery_groups",
      "id, cohort_id, component_id, group_code, plan_course_id, is_obsolete, active",
      collegeId,
    ),
  ]);

  return {
    instructors: instructors.filter((i) => i.employee_number),
    programs,
    courses,
    levels,
    terms,
    studyPlans,
    planCourses,
    components,
    cohorts,
    deliveryGroups,
  };
}

export async function detectWorkbookMode(file: File): Promise<TeachingImportWorkbookMode> {
  const headers = await readWorkbookSheetHeaders(file);
  return detectTeachingImportWorkbookMode(headers);
}

export async function previewSourceWorkbookImport(input: {
  file: File;
  collegeId: string;
  sheetTermMap: Record<string, string>;
  studySystemScope: SourceStudySystemScope;
}): Promise<SourceWorkbookPreview> {
  const mode = await detectWorkbookMode(input.file);
  if (mode !== "academic_source_workbook") {
    throw new Error("الملف ليس دفتر إسناد أكاديمي معروف");
  }
  const workbook = await parseSourceWorkbookFile(input.file);
  const ctx = await loadSourceResolverContext(input.collegeId);
  const allRows = workbook.sheets.flatMap((s) => s.rows);
  const resolution = resolveSourceTeachingAssignments({
    rows: allRows,
    ctx,
    sheetTermMap: input.sheetTermMap,
    studySystemScope: input.studySystemScope,
  });
  const { validRows, errors } = sourcePreviewToValidatedRows(resolution);
  return { mode, workbook, resolution, validRows, errors };
}
