/**
 * New Flow cohort curriculum resolution — plan_courses path (no course_offerings embeds).
 * Mirrors generate_cohort_curriculum selection rules for client-side pre-checks.
 */

import { uniqueMatchingStudyPlan } from "./generation-messages";
import { supabase } from "@/integrations/supabase/client";
import {
  isElectivePlaceholderCode,
  termTypeToSemester,
  validateElectiveSelectionForGeneration,
  type ElectiveSlotCourseMembership,
  type ElectiveValidationContext,
} from "./plan-course-components";

export type CohortCurriculumPlanCourse = {
  id: string;
  courseCode: string;
  courseName: string;
};

export type ResolvedCohortCurriculumContext = {
  collegeId: string;
  programName: string;
  levelName: string;
  termLabel: string;
  semester: number;
  studyPlanId: string;
  planCourses: CohortCurriculumPlanCourse[];
};

type PlanCourseComponentRow = {
  plan_course_id: string;
  component_type: string;
  is_timetabled: boolean;
};

function isSummerOnlyPlanCourse(components: PlanCourseComponentRow[]): boolean {
  const forCourse = components.filter(Boolean);
  if (forCourse.length === 0) return false;
  const hasSummer = forCourse.some(
    (c) => c.component_type === "summer_training" && c.is_timetabled === false,
  );
  if (!hasSummer) return false;
  return !forCourse.some((c) => c.component_type !== "summer_training" && c.is_timetabled === true);
}

async function resolveStudyPlanId(
  collegeId: string,
  programId: string,
  levelId: string,
  semester: number,
): Promise<string> {
  const { data: plans, error } = await supabase
    .from("study_plans")
    .select("id")
    .eq("college_id", collegeId)
    .eq("program_id", programId)
    .eq("is_active", true);
  if (error) throw error;
  const planIds = (plans ?? []).map((p) => p.id);
  if (!planIds.length) throw new Error("STUDY_PLAN_MISSING_FOR_COHORT_PROGRAM");
  const [courses, slots] = await Promise.all([
    supabase
      .from("plan_courses")
      .select("study_plan_id")
      .eq("college_id", collegeId)
      .in("study_plan_id", planIds)
      .eq("level_id", levelId)
      .eq("semester", semester),
    supabase
      .from("elective_slots")
      .select("study_plan_id, level_id")
      .eq("college_id", collegeId)
      .in("study_plan_id", planIds)
      .eq("semester", semester)
      .eq("active", true),
  ]);
  if (courses.error) throw courses.error;
  if (slots.error) throw slots.error;
  return uniqueMatchingStudyPlan([
    ...(courses.data ?? []).map((p) => p.study_plan_id),
    ...(slots.data ?? [])
      .filter((p) => p.level_id === null || p.level_id === levelId)
      .map((p) => p.study_plan_id),
  ]);
}

async function fetchRequiredPlanCourses(
  collegeId: string,
  studyPlanId: string,
  levelId: string,
  semester: number,
): Promise<CohortCurriculumPlanCourse[]> {
  const { data, error } = await supabase
    .from("plan_courses")
    .select("id, course_id, courses(code, name)")
    .eq("college_id", collegeId)
    .eq("study_plan_id", studyPlanId)
    .eq("level_id", levelId)
    .eq("semester", semester)
    .eq("is_required", true);
  if (error) throw error;

  return (data ?? [])
    .map((row) => {
      const course = row.courses as { code?: string; name?: string } | null;
      const courseCode = course?.code ?? "";
      return {
        id: row.id,
        courseCode,
        courseName: course?.name ?? "—",
      };
    })
    .filter((row) => !isElectivePlaceholderCode(row.courseCode));
}

async function fetchElectivePlanCourses(
  cohortId: string,
  collegeId: string,
  studyPlanId: string,
  levelId: string,
  semester: number,
): Promise<CohortCurriculumPlanCourse[]> {
  const { data: selections, error: selError } = await supabase
    .from("cohort_elective_selections")
    .select("elective_slot_id, selected_course_id, decided_at, decided_by")
    .eq("cohort_id", cohortId)
    .eq("college_id", collegeId);
  if (selError) throw selError;
  if ((selections ?? []).some((s) => !s.decided_at || !s.decided_by)) {
    throw new Error("ELECTIVE_DECISION_NOT_APPROVED");
  }
  if ((selections ?? []).length === 0) return [];

  const slotIds = [...new Set((selections ?? []).map((s) => s.elective_slot_id))];
  const { data: slots, error: slotError } = await supabase
    .from("elective_slots")
    .select("id, study_plan_id, semester, level_id, active, slot_code")
    .eq("college_id", collegeId)
    .in("id", slotIds);
  if (slotError) throw slotError;

  const slotMap = new Map((slots ?? []).map((s) => [s.id, s]));
  const { data: memberships, error: memError } = await supabase
    .from("elective_slot_courses")
    .select("elective_slot_id, course_id, active")
    .eq("college_id", collegeId)
    .in("elective_slot_id", slotIds);
  if (memError) throw memError;

  const allowed: ElectiveSlotCourseMembership[] = (memberships ?? []).map((m) => ({
    electiveSlotId: m.elective_slot_id,
    courseId: m.course_id,
    active: m.active ?? true,
  }));
  const ctx: ElectiveValidationContext = {
    studyPlanId,
    semester,
    levelId,
    allowed,
  };

  const selectedCourseIds = [
    ...new Set((selections ?? []).map((s) => s.selected_course_id).filter(Boolean)),
  ];
  const { data: courses, error: courseError } = await supabase
    .from("courses")
    .select("id, code, name")
    .eq("college_id", collegeId)
    .in("id", selectedCourseIds);
  if (courseError) throw courseError;
  const courseMap = new Map((courses ?? []).map((c) => [c.id, c]));

  const { data: electivePlanRows, error: planError } = await supabase
    .from("plan_courses")
    .select("id, course_id, courses(code, name)")
    .eq("college_id", collegeId)
    .eq("study_plan_id", studyPlanId)
    .eq("semester", semester)
    .eq("level_id", levelId)
    .in("course_id", selectedCourseIds);
  if (planError) throw planError;

  const planByCourseId = new Map((electivePlanRows ?? []).map((p) => [p.course_id, p]));
  const out: CohortCurriculumPlanCourse[] = [];

  for (const sel of selections ?? []) {
    const slot = slotMap.get(sel.elective_slot_id);
    const course = courseMap.get(sel.selected_course_id);
    if (!slot || !course) continue;

    const validation = validateElectiveSelectionForGeneration(
      {
        electiveSlotId: sel.elective_slot_id,
        selectedCourseId: sel.selected_course_id,
        slotStudyPlanId: slot.study_plan_id,
        slotSemester: slot.semester,
        slotLevelId: slot.level_id,
        slotActive: slot.active ?? true,
        courseCode: course.code,
      },
      ctx,
    );
    if (!validation.ok) continue;

    const planRow = planByCourseId.get(sel.selected_course_id);
    if (!planRow) continue;
    out.push({
      id: planRow.id,
      courseCode: course.code ?? "—",
      courseName: course.name ?? "—",
    });
  }

  return out;
}

async function filterSummerOnlyPlanCourses(
  collegeId: string,
  planCourses: CohortCurriculumPlanCourse[],
): Promise<CohortCurriculumPlanCourse[]> {
  if (planCourses.length === 0) return [];
  const ids = planCourses.map((p) => p.id);
  const { data: components, error } = await supabase
    .from("plan_course_components")
    .select("plan_course_id, component_type, is_timetabled")
    .eq("college_id", collegeId)
    .in("plan_course_id", ids);
  if (error) throw error;

  const byPlanCourse = new Map<string, PlanCourseComponentRow[]>();
  for (const row of components ?? []) {
    const list = byPlanCourse.get(row.plan_course_id) ?? [];
    list.push(row);
    byPlanCourse.set(row.plan_course_id, list);
  }

  return planCourses.filter((pc) => !isSummerOnlyPlanCourse(byPlanCourse.get(pc.id) ?? []));
}

/**
 * Resolve plan courses for a cohort using academic_cohorts → plan_courses → courses.
 * Regular and parallel cohorts stay isolated via cohort row context (study_system is cohort-scoped).
 */
export async function resolveCohortCurriculumPlanCourses(
  cohortId: string,
): Promise<ResolvedCohortCurriculumContext | null> {
  if (!cohortId) return null;

  const { data: cohort, error: cohortError } = await supabase
    .from("academic_cohorts")
    .select(
      "id, college_id, program_id, level_id, term_id, study_system, academic_programs!ac_program_college_fkey(name), academic_levels!ac_level_college_fkey(name), academic_terms!ac_term_college_fkey(name, term_type)",
    )
    .eq("id", cohortId)
    .maybeSingle();
  if (cohortError) throw cohortError;
  if (!cohort) return null;

  const programName = (cohort.academic_programs as { name?: string } | null)?.name ?? "—";
  const levelName = (cohort.academic_levels as { name?: string } | null)?.name ?? "—";
  const term = cohort.academic_terms as { name?: string; term_type?: string | null } | null;
  const termLabel = term?.name ?? "—";
  const semester = termTypeToSemester(term?.term_type);
  if (semester == null) {
    return {
      collegeId: cohort.college_id,
      programName,
      levelName,
      termLabel,
      semester: 0,
      studyPlanId: "",
      planCourses: [],
    };
  }

  const studyPlanId = await resolveStudyPlanId(
    cohort.college_id,
    cohort.program_id,
    cohort.level_id,
    semester,
  );
  if (!studyPlanId) {
    return {
      collegeId: cohort.college_id,
      programName,
      levelName,
      termLabel,
      semester,
      studyPlanId: "",
      planCourses: [],
    };
  }

  const [required, elective] = await Promise.all([
    fetchRequiredPlanCourses(cohort.college_id, studyPlanId, cohort.level_id, semester),
    fetchElectivePlanCourses(cohortId, cohort.college_id, studyPlanId, cohort.level_id, semester),
  ]);

  const merged = new Map<string, CohortCurriculumPlanCourse>();
  for (const row of [...required, ...elective]) {
    merged.set(row.id, row);
  }
  const planCourses = await filterSummerOnlyPlanCourses(cohort.college_id, [...merged.values()]);

  return {
    collegeId: cohort.college_id,
    programName,
    levelName,
    termLabel,
    semester,
    studyPlanId,
    planCourses,
  };
}
