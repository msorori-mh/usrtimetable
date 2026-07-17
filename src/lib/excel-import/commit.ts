import { supabase } from "@/integrations/supabase/client";
import { TEMPLATES } from "./templates";
import { buildDbPayload } from "./validators";
import type { ImportEntity, ImportMode, ParsedRow, RowError } from "./types";
import { logAudit } from "@/lib/audit";
import {
  derivePlanCourseComponents,
  isElectivePlaceholderCode,
} from "@/lib/academic-delivery/plan-course-components";
import { commitTeachingAssignmentsV2Import } from "@/lib/academic-delivery/teaching-assignments-v2-service";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface CommitResult {
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: RowError[];
}

export async function commitImport(
  entity: ImportEntity,
  mode: ImportMode,
  collegeId: string,
  jobId: string,
  validRows: ParsedRow[],
): Promise<CommitResult> {
  const tpl = TEMPLATES[entity];
  const result: CommitResult = { inserted: 0, updated: 0, skipped: 0, failed: 0, errors: [] };

  if (tpl.commitMode === "custom") {
    await commitCustom(entity, mode, collegeId, validRows, result);
  } else {
    await commitTable(entity, mode, collegeId, validRows, result);
  }

  if (result.errors.length > 0) {
    await supabase.from("import_errors").insert(
      result.errors.map((er) => ({
        college_id: collegeId,
        job_id: jobId,
        row_number: er.rowNumber,
        column_name: er.columnName ?? null,
        error_code: er.errorCode,
        message: er.message,
        raw_value: er.rawValue ?? null,
      })),
    );
  }

  await supabase
    .from("import_jobs")
    .update({
      status: result.failed > 0 && result.inserted + result.updated === 0 ? "failed" : "committed",
      inserted_rows: result.inserted,
      updated_rows: result.updated,
      skipped_rows: result.skipped,
    })
    .eq("id", jobId);

  await logAudit({
    action: "import_commit",
    entity: `import_${entity}`,
    entityId: jobId,
    collegeId,
    details: {
      inserted: result.inserted,
      updated: result.updated,
      skipped: result.skipped,
      failed: result.failed,
      mode,
    },
  });

  return result;
}

async function commitTable(
  entity: ImportEntity,
  mode: ImportMode,
  collegeId: string,
  rows: ParsedRow[],
  r: CommitResult,
) {
  const tpl = TEMPLATES[entity];
  for (const row of rows) {
    const exists = !!row.values._exists;
    const payload = buildDbPayload(entity, row, collegeId);
    const tbl = supabase.from(entity as never) as any;
    try {
      if (exists) {
        if (mode === "insert_only") {
          r.skipped++;
          continue;
        }
        const uniqVal = row.values[tpl.uniqueKey];
        const { error } = await tbl
          .update(payload)
          .eq("college_id", collegeId)
          .eq(tpl.uniqueKey, uniqVal);
        if (error) throw error;
        r.updated++;
      } else {
        if (mode === "update_existing") {
          r.skipped++;
          continue;
        }
        const { error } = await tbl.insert(payload);
        if (error) throw error;
        r.inserted++;
      }
    } catch (e) {
      r.failed++;
      r.errors.push({
        rowNumber: row.rowNumber,
        errorCode: "db_error",
        message: `فشل الحفظ: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }
}

async function commitCustom(
  entity: ImportEntity,
  mode: ImportMode,
  collegeId: string,
  rows: ParsedRow[],
  r: CommitResult,
) {
  if (entity === "study_plan_courses" || entity === "full_study_plan")
    return commitStudyPlan(mode, collegeId, rows, r);
  if (entity === "course_offerings") return commitCourseOfferings(mode, collegeId, rows, r);
  if (entity === "teaching_assignments") return commitTeachingAssignments(mode, collegeId, rows, r);
  if (entity === "teaching_assignments_v2")
    return commitTeachingAssignmentsV2(mode, collegeId, rows, r);
  if (entity === "academic_cohorts") return commitAcademicCohorts(mode, collegeId, rows, r);
  if (entity === "elective_slot_courses")
    return commitElectiveSlotCourses(mode, collegeId, rows, r);
  if (entity === "cohort_elective_selections")
    return commitCohortElectiveSelections(mode, collegeId, rows, r);
  if (entity === "course_programs") return commitCoursePrograms(mode, collegeId, rows, r);
  if (entity === "section_groups") return commitSectionGroups(mode, collegeId, rows, r);
  if (entity === "sections") return commitSections(mode, collegeId, rows, r);
}

async function syncPlanCourseComponents(
  planCourseId: string,
  collegeId: string,
  v: Record<string, any>,
) {
  const derived = derivePlanCourseComponents({
    theory_hours: v.theory_hours,
    practical_hours: v.practical_hours,
    tutorial_hours: v.tutorial_hours,
    training_hours: v.training_hours,
    project_hours: v.project_hours,
    is_summer_training: v.is_summer_training,
    is_graduation_project: v.is_graduation_project,
    credit_hours: v.credit_hours,
  });
  for (const d of derived) {
    const { data: ex } = await (supabase.from("plan_course_components") as any)
      .select("id")
      .eq("plan_course_id", planCourseId)
      .eq("component_type", d.component_type)
      .maybeSingle();
    const payload = {
      college_id: collegeId,
      plan_course_id: planCourseId,
      component_type: d.component_type,
      weekly_contact_hours: d.weekly_contact_hours,
      is_timetabled: d.is_timetabled,
      counts_toward_regular_load: d.counts_toward_regular_load,
      counts_toward_overtime: d.counts_toward_overtime,
      compensation_mode: d.compensation_mode,
    };
    if (ex?.id) {
      const { error } = await (supabase.from("plan_course_components") as any)
        .update(payload)
        .eq("id", ex.id);
      if (error) throw error;
    } else {
      const { error } = await (supabase.from("plan_course_components") as any).insert(payload);
      if (error) throw error;
    }
  }
}

async function findOrCreateCourse(
  collegeId: string,
  v: Record<string, any>,
  cache: Map<string, string>,
): Promise<string> {
  const k = String(v.course_code);
  const hit = cache.get(k);
  if (hit) return hit;
  const { data: existing } = await (supabase.from("courses") as any)
    .select("id")
    .eq("college_id", collegeId)
    .eq("code", v.course_code)
    .maybeSingle();
  if (existing?.id) {
    cache.set(k, existing.id);
    return existing.id;
  }
  const { data, error } = await (supabase.from("courses") as any)
    .insert({
      college_id: collegeId,
      department_id: v._department_id,
      code: v.course_code,
      name: v.course_name,
      credit_hours: v.credit_hours ?? 3,
      theory_hours: v.theory_hours ?? 0,
      practical_hours: v.practical_hours ?? 0,
      course_nature: v.course_nature ?? "department",
      is_shared: v.is_shared ?? false,
    })
    .select("id")
    .single();
  if (error) throw error;
  cache.set(k, data.id);
  return data.id;
}

async function findOrCreateStudyPlan(
  collegeId: string,
  v: Record<string, any>,
  cache: Map<string, string>,
): Promise<string> {
  const ver = String(v.plan_version ?? "1");
  const k = `${v._program_id}|${v.plan_code}|${ver}`;
  const hit = cache.get(k);
  if (hit) return hit;
  const { data: existing } = await (supabase.from("study_plans") as any)
    .select("id")
    .eq("college_id", collegeId)
    .eq("program_id", v._program_id)
    .eq("code", v.plan_code)
    .eq("version", ver)
    .maybeSingle();
  if (existing?.id) {
    cache.set(k, existing.id);
    return existing.id;
  }
  const { data, error } = await (supabase.from("study_plans") as any)
    .insert({
      college_id: collegeId,
      program_id: v._program_id,
      code: v.plan_code,
      name: v.plan_name ?? v.plan_code,
      version: ver,
      effective_year: v.effective_year ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  cache.set(k, data.id);
  return data.id;
}

async function findOrCreateLevel(
  collegeId: string,
  programId: string,
  levelNumber: number,
  cache: Map<string, string>,
): Promise<string> {
  const k = `${programId}|${levelNumber}`;
  const hit = cache.get(k);
  if (hit) return hit;
  const { data: existing } = await (supabase.from("academic_levels") as any)
    .select("id")
    .eq("college_id", collegeId)
    .eq("program_id", programId)
    .eq("level_number", levelNumber)
    .maybeSingle();
  if (existing?.id) {
    cache.set(k, existing.id);
    return existing.id;
  }
  const { data, error } = await (supabase.from("academic_levels") as any)
    .insert({
      college_id: collegeId,
      program_id: programId,
      level_number: levelNumber,
      name: `المستوى ${levelNumber}`,
    })
    .select("id")
    .single();
  if (error) throw error;
  cache.set(k, data.id);
  return data.id;
}

async function commitStudyPlan(
  mode: ImportMode,
  collegeId: string,
  rows: ParsedRow[],
  r: CommitResult,
) {
  const courseCache = new Map<string, string>();
  const planCache = new Map<string, string>();
  const levelCache = new Map<string, string>();
  for (const row of rows) {
    const v = row.values as any;
    try {
      const planId = await findOrCreateStudyPlan(collegeId, v, planCache);
      const levelId =
        v.level_number != null
          ? await findOrCreateLevel(collegeId, v._program_id, Number(v.level_number), levelCache)
          : null;

      // Elective slot row: create slot only — never placeholder course/offering
      if (
        v.is_elective_slot === true ||
        (v.elective_slot_code &&
          isElectivePlaceholderCode(String(v.course_code ?? v.elective_slot_code)))
      ) {
        const slotCode = String(v.elective_slot_code || v.course_code);
        const { data: slotEx } = await (supabase.from("elective_slots") as any)
          .select("id")
          .eq("college_id", collegeId)
          .eq("study_plan_id", planId)
          .eq("slot_code", slotCode)
          .maybeSingle();
        const slotPayload = {
          college_id: collegeId,
          study_plan_id: planId,
          level_id: levelId,
          semester: v.semester ?? 1,
          slot_code: slotCode,
          label: v.course_name ?? slotCode,
          required_component_type: "theory",
          active: true,
        };
        if (slotEx?.id) {
          if (mode === "insert_only") {
            r.skipped++;
            continue;
          }
          const { error } = await (supabase.from("elective_slots") as any)
            .update(slotPayload)
            .eq("id", slotEx.id);
          if (error) throw error;
          r.updated++;
        } else {
          if (mode === "update_existing") {
            r.skipped++;
            continue;
          }
          const { error } = await (supabase.from("elective_slots") as any).insert(slotPayload);
          if (error) throw error;
          r.inserted++;
        }
        continue;
      }

      const courseId = await findOrCreateCourse(collegeId, v, courseCache);
      const { data: pcEx } = await (supabase.from("plan_courses") as any)
        .select("id")
        .eq("college_id", collegeId)
        .eq("study_plan_id", planId)
        .eq("course_id", courseId)
        .maybeSingle();
      const payload = {
        college_id: collegeId,
        study_plan_id: planId,
        course_id: courseId,
        level_id: levelId,
        semester: v.semester ?? 1,
        is_required: v.is_required ?? true,
        lectures_per_week: v.lectures_per_week ?? 0,
        lecture_session_duration: v.lecture_session_duration ?? 2,
        labs_per_week: v.labs_per_week ?? 0,
        lab_session_duration: v.lab_session_duration ?? 2,
        required_room_type_for_lecture: v.required_room_type_for_lecture ?? null,
        required_room_type_for_lab: v.required_room_type_for_lab ?? null,
      };
      let planCourseId: string | null = pcEx?.id ?? null;
      if (pcEx?.id) {
        if (mode === "insert_only") {
          r.skipped++;
          continue;
        }
        const { error } = await (supabase.from("plan_courses") as any)
          .update(payload)
          .eq("id", pcEx.id);
        if (error) throw error;
        r.updated++;
      } else {
        if (mode === "update_existing") {
          r.skipped++;
          continue;
        }
        const { data: created, error } = await (supabase.from("plan_courses") as any)
          .insert(payload)
          .select("id")
          .single();
        if (error) throw error;
        planCourseId = created.id;
        r.inserted++;
      }
      if (planCourseId) await syncPlanCourseComponents(planCourseId, collegeId, v);
    } catch (e) {
      r.failed++;
      r.errors.push({
        rowNumber: row.rowNumber,
        errorCode: "db_error",
        message: `فشل: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }
}

async function commitAcademicCohorts(
  mode: ImportMode,
  collegeId: string,
  rows: ParsedRow[],
  r: CommitResult,
) {
  for (const row of rows) {
    const v = row.values as any;
    try {
      const { data: ex } = await (supabase.from("academic_cohorts") as any)
        .select("id")
        .eq("college_id", collegeId)
        .eq("program_id", v._program_id)
        .eq("level_id", v._level_id)
        .eq("study_system", v.study_system)
        .eq("entry_year", v.entry_year)
        .eq("term_id", v._term_id)
        .maybeSingle();
      const payload = {
        college_id: collegeId,
        program_id: v._program_id,
        level_id: v._level_id,
        study_system: v.study_system,
        entry_year: Number(v.entry_year),
        term_id: v._term_id,
        expected_students: v.expected_students ?? 0,
        count_status: v.count_status ?? "estimated",
        code: v.code ?? null,
        active: v.active ?? true,
      };
      if (ex?.id) {
        if (mode === "insert_only") {
          r.skipped++;
          continue;
        }
        const { error } = await (supabase.from("academic_cohorts") as any)
          .update(payload)
          .eq("id", ex.id);
        if (error) throw error;
        r.updated++;
      } else {
        if (mode === "update_existing") {
          r.skipped++;
          continue;
        }
        const { error } = await (supabase.from("academic_cohorts") as any).insert(payload);
        if (error) throw error;
        r.inserted++;
      }
    } catch (e) {
      r.failed++;
      r.errors.push({
        rowNumber: row.rowNumber,
        errorCode: "db_error",
        message: `فشل: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }
}

async function commitElectiveSlotCourses(
  mode: ImportMode,
  collegeId: string,
  rows: ParsedRow[],
  r: CommitResult,
) {
  for (const row of rows) {
    const v = row.values as any;
    try {
      const { data: ex } = await (supabase.from("elective_slot_courses") as any)
        .select("id")
        .eq("elective_slot_id", v._elective_slot_id)
        .eq("course_id", v._course_id)
        .maybeSingle();
      const payload = {
        college_id: collegeId,
        elective_slot_id: v._elective_slot_id,
        course_id: v._course_id,
      };
      if (ex?.id) {
        if (mode === "insert_only") {
          r.skipped++;
          continue;
        }
        r.skipped++;
      } else {
        if (mode === "update_existing") {
          r.skipped++;
          continue;
        }
        const { error } = await (supabase.from("elective_slot_courses") as any).insert(payload);
        if (error) throw error;
        r.inserted++;
      }
    } catch (e) {
      r.failed++;
      r.errors.push({
        rowNumber: row.rowNumber,
        errorCode: "db_error",
        message: `فشل: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }
}

async function commitCohortElectiveSelections(
  mode: ImportMode,
  collegeId: string,
  rows: ParsedRow[],
  r: CommitResult,
) {
  for (const row of rows) {
    const v = row.values as any;
    try {
      const { data: ex } = await (supabase.from("cohort_elective_selections") as any)
        .select("id")
        .eq("cohort_id", v._cohort_id)
        .eq("elective_slot_id", v._elective_slot_id)
        .maybeSingle();
      const payload = {
        college_id: collegeId,
        cohort_id: v._cohort_id,
        elective_slot_id: v._elective_slot_id,
        selected_course_id: v._course_id,
      };
      if (ex?.id) {
        if (mode === "insert_only") {
          r.skipped++;
          continue;
        }
        const { error } = await (supabase.from("cohort_elective_selections") as any)
          .update(payload)
          .eq("id", ex.id);
        if (error) throw error;
        r.updated++;
      } else {
        if (mode === "update_existing") {
          r.skipped++;
          continue;
        }
        const { error } = await (supabase.from("cohort_elective_selections") as any).insert(
          payload,
        );
        if (error) throw error;
        r.inserted++;
      }
    } catch (e) {
      r.failed++;
      r.errors.push({
        rowNumber: row.rowNumber,
        errorCode: "db_error",
        message: `فشل: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }
}

/**
 * Phase 9.4 V2 import — preparation/validation in TS; atomic commit via gated RPC.
 * Atomic contract: all rows succeed or zero teaching_assignments DML / audit.
 * No client-side insert/update/upsert/delete on teaching_assignments.
 */
async function commitTeachingAssignmentsV2(
  mode: ImportMode,
  _collegeId: string,
  rows: ParsedRow[],
  r: CommitResult,
) {
  const sessionTypeMap: Record<string, string> = {
    theory: "lecture",
    practical: "lab",
    tutorial: "tutorial",
    project: "seminar",
    summer_training: "seminar",
  };

  // Local pre-checks (also enforced in RPC). Blocking → do not call commit RPC.
  const byGroup = new Map<string, ParsedRow[]>();
  for (const row of rows) {
    const v = row.values as any;
    const key = String(v._delivery_group_id ?? "");
    if (!key) continue;
    const list = byGroup.get(key) ?? [];
    list.push(row);
    byGroup.set(key, list);
  }
  let localBlocking = false;
  for (const [, groupRows] of byGroup) {
    const instructors = new Set(
      groupRows.map((row) => String((row.values as any)._instructor_id ?? "")),
    );
    if (instructors.size > 1) {
      for (const row of groupRows) {
        const v = row.values as any;
        if (v._assigned_component_hours == null) {
          localBlocking = true;
          r.failed++;
          r.errors.push({
            rowNumber: row.rowNumber,
            errorCode: "co_teaching_hours_split_required",
            message: "عند التدريس المشترك يجب تحديد ساعات_المكوّن_المسندة لكل مدرس",
          });
          (row.values as any)._skip_commit = true;
        }
      }
    }
  }
  if (localBlocking) {
    // Atomic: do not partially commit when local co-teach validation failed
    return;
  }

  const payloadRows: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    const v = row.values as any;
    if (v._skip_commit) continue;
    if (!v._cohort_id || !v._course_id || !v._component_id || !v._delivery_group_id) {
      r.failed++;
      r.errors.push({
        rowNumber: row.rowNumber,
        errorCode: "required",
        message: "حقول إلزامية ناقصة للدفعة/المقرر/المكوّن/مجموعة التدريس",
      });
      continue;
    }
    if (v.component_type === "summer_training") {
      r.failed++;
      r.errors.push({
        rowNumber: row.rowNumber,
        errorCode: "summer_training_forbidden",
        message: "لا يُسند التدريب الصيفي عبر الإسناد المجدول",
      });
      continue;
    }
    const assignedHours =
      v._assigned_component_hours != null
        ? Number(v._assigned_component_hours)
        : v.assigned_component_hours != null && v.assigned_component_hours !== ""
          ? Number(v.assigned_component_hours)
          : null;
    payloadRows.push({
      row_number: row.rowNumber,
      delivery_group_id: v._delivery_group_id,
      instructor_id: v._instructor_id,
      assigned_component_hours:
        assignedHours != null && Number.isFinite(assignedHours) ? assignedHours : null,
      notes: v.notes ?? null,
      is_active: v._is_active !== false,
      course_offering_id: v._offering_id ?? null,
      expected_students: v.expected_students ?? 0,
      required_room_type: v.required_room_type ?? null,
      session_type: sessionTypeMap[String(v.component_type)] ?? "lecture",
    });
  }

  if (r.failed > 0) {
    // Atomic: validation errors collected → do not call RPC
    return;
  }
  if (payloadRows.length === 0) {
    return;
  }

  try {
    const result = await commitTeachingAssignmentsV2Import({ mode, rows: payloadRows });
    if (result.status !== "ok") {
      r.failed += result.validation_errors.length || 1;
      for (const err of result.validation_errors) {
        r.errors.push({
          rowNumber: err.row_number ?? 0,
          errorCode: err.error_code,
          message: err.error_message,
        });
      }
      if (result.validation_errors.length === 0) {
        r.errors.push({
          rowNumber: 0,
          errorCode: "import_batch_failed",
          message: "فشل استيراد تكليفات التدريس V2 دون تفاصيل صفوف",
        });
      }
      return;
    }
    r.inserted += result.rows_created + result.rows_reactivated;
    r.updated += result.rows_updated;
    r.skipped += result.rows_unchanged;
  } catch (e) {
    r.failed++;
    r.errors.push({
      rowNumber: 0,
      errorCode: "db_error",
      message: `فشل الاستيراد الذري: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
}

async function commitCourseOfferings(
  mode: ImportMode,
  collegeId: string,
  rows: ParsedRow[],
  r: CommitResult,
) {
  for (const row of rows) {
    const v = row.values as any;
    try {
      // match key: term + course + program
      const q = (supabase.from("course_offerings") as any)
        .select("id")
        .eq("college_id", collegeId)
        .eq("term_id", v._term_id)
        .eq("course_id", v._course_id);
      const matchQ = v._program_id ? q.eq("program_id", v._program_id) : q.is("program_id", null);
      const { data: ex } = await matchQ.maybeSingle();
      const payload = {
        college_id: collegeId,
        term_id: v._term_id,
        course_id: v._course_id,
        program_id: v._program_id ?? null,
        level_id: v._level_id ?? null,
        study_plan_id: v._study_plan_id ?? null,
        plan_course_id: v._plan_course_id ?? null,
        expected_students: v.expected_students ?? 0,
        sections_count: v.sections_count ?? 1,
        status: v.status ?? "draft",
        is_active: v.is_active ?? true,
        notes: v.notes ?? null,
      };
      if (ex?.id) {
        if (mode === "insert_only") {
          r.skipped++;
          continue;
        }
        const { error } = await (supabase.from("course_offerings") as any)
          .update(payload)
          .eq("id", ex.id);
        if (error) throw error;
        r.updated++;
      } else {
        if (mode === "update_existing") {
          r.skipped++;
          continue;
        }
        const { error } = await (supabase.from("course_offerings") as any).insert(payload);
        if (error) throw error;
        r.inserted++;
      }
    } catch (e) {
      r.failed++;
      r.errors.push({
        rowNumber: row.rowNumber,
        errorCode: "db_error",
        message: `فشل: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }
}

async function commitTeachingAssignments(
  mode: ImportMode,
  collegeId: string,
  rows: ParsedRow[],
  r: CommitResult,
) {
  for (const row of rows) {
    const v = row.values as any;
    try {
      // resolve course_offering by (term, course); pick first available
      const { data: off } = await (supabase.from("course_offerings") as any)
        .select("id")
        .eq("college_id", collegeId)
        .eq("term_id", v._term_id)
        .eq("course_id", v._course_id)
        .limit(1)
        .maybeSingle();
      if (!off?.id) throw new Error("لا يوجد طرح مقرر مطابق لهذا الفصل/المقرر");
      const offeringId = off.id;
      // optional section resolution
      let sectionId: string | null = null;
      if (v.section_number) {
        const { data: sec } = await (supabase.from("sections") as any)
          .select("id")
          .eq("college_id", collegeId)
          .eq("course_id", v._course_id)
          .eq("term_id", v._term_id)
          .eq("section_number", String(v.section_number))
          .maybeSingle();
        sectionId = sec?.id ?? null;
      }
      // dedupe per unique idx (offering, instructor, session_type, section_number)
      const { data: ex } = await (supabase.from("teaching_assignments") as any)
        .select("id")
        .eq("college_id", collegeId)
        .eq("course_offering_id", offeringId)
        .eq("instructor_id", v._instructor_id)
        .eq("session_type", v.session_type)
        .eq("section_number", v.section_number ?? "")
        .maybeSingle();
      const payload = {
        college_id: collegeId,
        course_offering_id: offeringId,
        instructor_id: v._instructor_id,
        session_type: v.session_type,
        section_number: v.section_number ?? null,
        section_id: sectionId,
        weekly_hours: v.weekly_hours ?? 3,
        expected_students: v.expected_students ?? 0,
        required_room_type: v.required_room_type ?? null,
        notes: v.notes ?? null,
      };
      if (ex?.id) {
        if (mode === "insert_only") {
          r.skipped++;
          continue;
        }
        const { error } = await (supabase.from("teaching_assignments") as any)
          .update(payload)
          .eq("id", ex.id);
        if (error) throw error;
        r.updated++;
      } else {
        if (mode === "update_existing") {
          r.skipped++;
          continue;
        }
        const { error } = await (supabase.from("teaching_assignments") as any).insert(payload);
        if (error) throw error;
        r.inserted++;
      }
    } catch (e) {
      r.failed++;
      r.errors.push({
        rowNumber: row.rowNumber,
        errorCode: "db_error",
        message: `فشل: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }
}

async function commitCoursePrograms(
  mode: ImportMode,
  collegeId: string,
  rows: ParsedRow[],
  r: CommitResult,
) {
  for (const row of rows) {
    const v = row.values as any;
    try {
      const { data: ex } = await (supabase.from("course_programs") as any)
        .select("id")
        .eq("college_id", collegeId)
        .eq("course_id", v._course_id)
        .eq("program_id", v._program_id)
        .maybeSingle();
      if (ex?.id) {
        if (mode === "insert_only") {
          r.skipped++;
          continue;
        }
        r.skipped++; // nothing meaningful to update on a pure link table
      } else {
        if (mode === "update_existing") {
          r.skipped++;
          continue;
        }
        const { error } = await (supabase.from("course_programs") as any).insert({
          college_id: collegeId,
          course_id: v._course_id,
          program_id: v._program_id,
        });
        if (error) throw error;
        r.inserted++;
      }
    } catch (e) {
      r.failed++;
      r.errors.push({
        rowNumber: row.rowNumber,
        errorCode: "db_error",
        message: `فشل: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }
}

async function commitSectionGroups(
  mode: ImportMode,
  collegeId: string,
  rows: ParsedRow[],
  r: CommitResult,
) {
  for (const row of rows) {
    const v = row.values as any;
    try {
      // resolve member sections by (course_id, term_id, section_number)
      const memberNums = (v.member_section_numbers as string[]) ?? [];
      const sectionIds: { id: string; expected: number }[] = [];
      for (const num of memberNums) {
        const { data: sec } = await (supabase.from("sections") as any)
          .select("id, capacity")
          .eq("college_id", collegeId)
          .eq("course_id", v._course_id)
          .eq("term_id", v._term_id)
          .eq("section_number", String(num))
          .maybeSingle();
        if (!sec?.id) throw new Error(`مجموعة غير موجودة: ${num}`);
        sectionIds.push({ id: sec.id, expected: sec.capacity ?? 0 });
      }
      const expectedTotal = sectionIds.reduce((s, x) => s + (x.expected ?? 0), 0);
      const { data: ex } = await (supabase.from("section_groups") as any)
        .select("id")
        .eq("college_id", collegeId)
        .eq("academic_term_id", v._term_id)
        .eq("course_id", v._course_id)
        .eq("group_name", v.group_name)
        .maybeSingle();
      let groupId: string;
      if (ex?.id) {
        if (mode === "insert_only") {
          r.skipped++;
          continue;
        }
        const { error } = await (supabase.from("section_groups") as any)
          .update({
            expected_students_total: expectedTotal,
            notes: v.notes ?? null,
          })
          .eq("id", ex.id);
        if (error) throw error;
        groupId = ex.id;
        r.updated++;
        await (supabase.from("section_group_members") as any)
          .delete()
          .eq("section_group_id", groupId);
      } else {
        if (mode === "update_existing") {
          r.skipped++;
          continue;
        }
        const { data: ins, error } = await (supabase.from("section_groups") as any)
          .insert({
            college_id: collegeId,
            academic_term_id: v._term_id,
            course_id: v._course_id,
            group_name: v.group_name,
            expected_students_total: expectedTotal,
            notes: v.notes ?? null,
          })
          .select("id")
          .single();
        if (error) throw error;
        groupId = ins.id;
        r.inserted++;
      }
      if (sectionIds.length > 0) {
        const { error: memErr } = await (supabase.from("section_group_members") as any).insert(
          sectionIds.map((s) => ({
            college_id: collegeId,
            section_group_id: groupId,
            section_id: s.id,
            expected_students: s.expected,
          })),
        );
        if (memErr) throw memErr;
      }
    } catch (e) {
      r.failed++;
      r.errors.push({
        rowNumber: row.rowNumber,
        errorCode: "db_error",
        message: `فشل: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }
}

async function commitSections(
  mode: ImportMode,
  collegeId: string,
  rows: ParsedRow[],
  r: CommitResult,
) {
  for (const row of rows) {
    const v = row.values as any;
    try {
      const { data: ex } = await (supabase.from("sections") as any)
        .select("id")
        .eq("college_id", collegeId)
        .eq("course_id", v._course_id)
        .eq("term_id", v._term_id)
        .eq("section_number", String(v.section_number))
        .maybeSingle();
      const payload = {
        college_id: collegeId,
        course_id: v._course_id,
        term_id: v._term_id,
        section_number: String(v.section_number),
        capacity: v.capacity ?? 30,
        study_system: v.study_system ?? "regular",
      };
      if (ex?.id) {
        if (mode === "insert_only") {
          r.skipped++;
          continue;
        }
        const { error } = await (supabase.from("sections") as any).update(payload).eq("id", ex.id);
        if (error) throw error;
        r.updated++;
      } else {
        if (mode === "update_existing") {
          r.skipped++;
          continue;
        }
        const { error } = await (supabase.from("sections") as any).insert(payload);
        if (error) throw error;
        r.inserted++;
      }
    } catch (e) {
      r.failed++;
      r.errors.push({
        rowNumber: row.rowNumber,
        errorCode: "db_error",
        message: `فشل: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }
}

export async function createJobAndPersistErrors(
  entity: ImportEntity,
  mode: ImportMode,
  collegeId: string,
  fileName: string,
  totalRows: number,
  validRows: ParsedRow[],
  errors: RowError[],
  actorId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("import_jobs")
    .insert({
      college_id: collegeId,
      target_entity: entity,
      mode,
      status: "preview",
      file_name: fileName,
      total_rows: totalRows,
      valid_rows: validRows.length,
      invalid_rows: totalRows - validRows.length,
      created_by: actorId,
    })
    .select("id")
    .single();
  if (error) throw error;
  const jobId = data!.id as string;

  if (errors.length > 0) {
    await supabase.from("import_errors").insert(
      errors.map((er) => ({
        college_id: collegeId,
        job_id: jobId,
        row_number: er.rowNumber,
        column_name: er.columnName ?? null,
        error_code: er.errorCode,
        message: er.message,
        raw_value: er.rawValue ?? null,
      })),
    );
  }
  await logAudit({
    action: "import_preview",
    entity: `import_${entity}`,
    entityId: jobId,
    collegeId,
    details: { totalRows, valid: validRows.length, invalid: totalRows - validRows.length, mode },
  });
  return jobId;
}
