import { supabase } from "@/integrations/supabase/client";
import { TEMPLATES } from "./templates";
import { buildDbPayload } from "./validators";
import type { ImportEntity, ImportMode, ParsedRow, RowError } from "./types";
import { logAudit } from "@/lib/audit";

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
  if (entity === "course_programs") return commitCoursePrograms(mode, collegeId, rows, r);
  if (entity === "section_groups") return commitSectionGroups(mode, collegeId, rows, r);
  if (entity === "sections") return commitSections(mode, collegeId, rows, r);
  if (entity === "academic_cohorts") return commitAcademicCohorts(mode, collegeId, rows, r);
  if (entity === "cohort_elective_selections")
    return commitCohortElectiveSelections(mode, collegeId, rows, r);
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
      const courseId = await findOrCreateCourse(collegeId, v, courseCache);
      const planId = await findOrCreateStudyPlan(collegeId, v, planCache);
      const levelId =
        v.level_number != null
          ? await findOrCreateLevel(collegeId, v._program_id, Number(v.level_number), levelCache)
          : null;
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
      let planCourseId: string;
      if (pcEx?.id) {
        if (mode === "insert_only") {
          r.skipped++;
          continue;
        }
        const { error } = await (supabase.from("plan_courses") as any)
          .update(payload)
          .eq("id", pcEx.id);
        if (error) throw error;
        planCourseId = pcEx.id;
        r.updated++;
      } else {
        if (mode === "update_existing") {
          r.skipped++;
          continue;
        }
        const { data: inserted, error } = await (supabase.from("plan_courses") as any)
          .insert(payload)
          .select("id")
          .single();
        if (error) throw error;
        planCourseId = inserted.id;
        r.inserted++;
      }

      // Upsert plan_course_components from explicit hours (Phase 9.2)
      const comps = (v._plan_components as Array<Record<string, unknown>> | undefined) ?? [];
      for (const comp of comps) {
        const ctype = String(comp.component_type);
        let roomTypeId: string | null = null;
        if (ctype === "theory" || ctype === "tutorial")
          roomTypeId = v._lecture_room_type_id ?? null;
        if (ctype === "practical") roomTypeId = v._lab_room_type_id ?? null;

        const { data: existingComp } = await (supabase.from("plan_course_components") as any)
          .select("id")
          .eq("plan_course_id", planCourseId)
          .eq("component_type", ctype)
          .maybeSingle();

        const compPayload = {
          college_id: collegeId,
          plan_course_id: planCourseId,
          component_type: ctype,
          weekly_contact_hours: comp.weekly_contact_hours,
          required_room_type_id: roomTypeId,
          is_timetabled: comp.is_timetabled ?? true,
          counts_toward_regular_load: comp.counts_toward_regular_load ?? true,
          counts_toward_overtime: comp.counts_toward_overtime ?? true,
          compensation_mode: comp.compensation_mode ?? "per_hour",
        };
        if (existingComp?.id) {
          const { error } = await (supabase.from("plan_course_components") as any)
            .update(compPayload)
            .eq("id", existingComp.id);
          if (error) throw error;
        } else {
          const { error } = await (supabase.from("plan_course_components") as any).insert(
            compPayload,
          );
          if (error) throw error;
        }
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
      if (v._import_path === "v2") {
        // resolve compatibility offering
        const { data: off } = await (supabase.from("course_offerings") as any)
          .select("id")
          .eq("college_id", collegeId)
          .eq("term_id", v._term_id)
          .eq("course_id", v._course_id)
          .eq("program_id", v._program_id)
          .eq("level_id", v._level_id)
          .eq("study_system", v.study_system)
          .limit(1)
          .maybeSingle();
        if (!off?.id)
          throw new Error(
            "لا يوجد طرح توافق (course_offering) لهذه الدفعة/المقرر — شغّل مولّد التسليم أولًا",
          );

        const sessionType = v._session_type ?? "lecture";
        const sectionNumber = v._group_code ?? v.group_code ?? null;

        const { data: ex } = await (supabase.from("teaching_assignments") as any)
          .select("id")
          .eq("college_id", collegeId)
          .eq("course_offering_id", off.id)
          .eq("instructor_id", v._instructor_id)
          .eq("session_type", sessionType)
          .eq("section_number", sectionNumber ?? "")
          .maybeSingle();

        const payload: Record<string, unknown> = {
          college_id: collegeId,
          course_offering_id: off.id,
          instructor_id: v._instructor_id,
          session_type: sessionType,
          section_number: sectionNumber,
          weekly_hours: v.weekly_hours ?? 3,
          expected_students: v.expected_students ?? 0,
          required_room_type: v.required_room_type ?? null,
          notes: v._exclude_from_regular_load
            ? `${v.notes ? v.notes + " | " : ""}exclude_regular_load:project`
            : (v.notes ?? null),
          cohort_id: v._cohort_id ?? null,
          delivery_group_id: v._delivery_group_id ?? null,
        };

        // Resolve plan_course_component_id when possible
        if (v._delivery_group_id) {
          const { data: dg } = await (supabase.from("delivery_groups") as any)
            .select("component_id")
            .eq("id", v._delivery_group_id)
            .maybeSingle();
          if (dg?.component_id) payload.plan_course_component_id = dg.component_id;
        }

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
        continue;
      }

      // Legacy path
      const { data: off } = await (supabase.from("course_offerings") as any)
        .select("id")
        .eq("college_id", collegeId)
        .eq("term_id", v._term_id)
        .eq("course_id", v._course_id)
        .limit(1)
        .maybeSingle();
      if (!off?.id) throw new Error("لا يوجد طرح مقرر مطابق لهذا الفصل/المقرر");
      const offeringId = off.id;
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
        entry_year: v.entry_year,
        term_id: v._term_id,
        expected_students: v.student_count ?? 0,
        count_status: v.count_status ?? "estimated",
        code: v.cohort_code ?? null,
        active: true,
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
        v._cohort_id = ex.id;
        r.updated++;
      } else {
        if (mode === "update_existing") {
          r.skipped++;
          continue;
        }
        const { data: ins, error } = await (supabase.from("academic_cohorts") as any)
          .insert(payload)
          .select("id")
          .single();
        if (error) throw error;
        v._cohort_id = ins.id;
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
        selected_course_id: v._selected_course_id,
        notes: v.notes ?? null,
        decided_at: new Date().toISOString(),
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
