/**
 * Phase 9.2 — derive plan_course_components from explicit hour columns only.
 * Never infer practical/theory from credit_hours or course name.
 */

export type ComponentType = "theory" | "practical" | "tutorial" | "project" | "summer_training";

export type ExplicitHoursInput = {
  theory_hours?: number | null;
  practical_hours?: number | null;
  /** Regular-term training maps to tutorial (not summer_training). */
  tutorial_hours?: number | null;
  /** Legacy alias for regular-term training → tutorial. */
  training_hours?: number | null;
  project_hours?: number | null;
  is_summer_training?: boolean | null;
  is_graduation_project?: boolean | null;
  credit_hours?: number | null;
};

export type DerivedComponent = {
  component_type: ComponentType;
  weekly_contact_hours: number;
  is_timetabled: boolean;
  counts_toward_regular_load: boolean;
  counts_toward_overtime: boolean;
  compensation_mode: "per_hour" | "per_group_flat" | "none";
};

function n(v: number | null | undefined): number {
  if (v == null || Number.isNaN(Number(v))) return 0;
  return Number(v);
}

/**
 * Build components strictly from explicit hour fields / flags.
 * credit_hours is ignored for component derivation.
 */
export function derivePlanCourseComponents(input: ExplicitHoursInput): DerivedComponent[] {
  const out: DerivedComponent[] = [];
  const theory = n(input.theory_hours);
  const practical = n(input.practical_hours);
  const tutorial = n(input.tutorial_hours) + n(input.training_hours);
  const project = n(input.project_hours);
  const summer = !!input.is_summer_training;
  const gradProject = !!input.is_graduation_project;

  if (theory > 0) {
    out.push({
      component_type: "theory",
      weekly_contact_hours: theory,
      is_timetabled: true,
      counts_toward_regular_load: true,
      counts_toward_overtime: true,
      compensation_mode: "per_hour",
    });
  }
  if (practical > 0) {
    out.push({
      component_type: "practical",
      weekly_contact_hours: practical,
      is_timetabled: true,
      counts_toward_regular_load: true,
      counts_toward_overtime: true,
      compensation_mode: "per_hour",
    });
  }
  if (tutorial > 0 && !summer) {
    out.push({
      component_type: "tutorial",
      weekly_contact_hours: tutorial,
      is_timetabled: true,
      counts_toward_regular_load: true,
      counts_toward_overtime: true,
      compensation_mode: "per_hour",
    });
  }
  if (project > 0 || gradProject) {
    out.push({
      component_type: "project",
      weekly_contact_hours: project > 0 ? project : 0,
      is_timetabled: true,
      counts_toward_regular_load: false,
      counts_toward_overtime: false,
      compensation_mode: "none",
    });
  }
  if (summer) {
    out.push({
      component_type: "summer_training",
      weekly_contact_hours: tutorial > 0 ? tutorial : n(input.training_hours),
      is_timetabled: false,
      counts_toward_regular_load: false,
      counts_toward_overtime: false,
      compensation_mode: "none",
    });
  }

  return out;
}

/** Display label for elective offerings. */
export function electiveCourseDisplayLabel(courseName: string): string {
  return `مقرر اختياري (${courseName})`;
}

/** Placeholder elective codes like CY3XX(E) must never become offerings. */
export function isElectivePlaceholderCode(code: string): boolean {
  const c = (code ?? "").trim().toUpperCase();
  return /\(E\)$/.test(c) || /^[A-Z]{2,}\dXX\(E\)$/.test(c);
}

export type GeneratorCourseCandidate = {
  courseCode: string;
  courseName: string;
  isRequired: boolean;
  isElectiveSelection: boolean;
  components: DerivedComponent[];
};

/**
 * Pure selection rules mirroring generate_cohort_curriculum (no DB).
 */
export function selectCoursesForCurriculumGeneration(
  candidates: GeneratorCourseCandidate[],
): GeneratorCourseCandidate[] {
  return candidates.filter((c) => {
    if (isElectivePlaceholderCode(c.courseCode)) return false;
    if (c.isElectiveSelection) return true;
    if (!c.isRequired) return false;
    const timetabled = c.components.filter((x) => x.is_timetabled);
    const summerOnly =
      c.components.length > 0 &&
      c.components.every((x) => x.component_type === "summer_training" && !x.is_timetabled);
    if (summerOnly) return false;
    return timetabled.length > 0 || c.components.length === 0;
  });
}

/** Map academic_terms.term_type → plan_courses.semester (fail closed on unknown/null). */
export function termTypeToSemester(termType: string | null | undefined): number | null {
  if (termType === "first") return 1;
  if (termType === "second") return 2;
  return null;
}

export type PlanCourseSemesterCandidate = {
  courseCode: string;
  levelId: string;
  semester: number;
  programId: string;
  studySystem: string;
};

/** Filter plan courses to the cohort's program/level/study_system/semester context. */
export function filterPlanCoursesByCohortContext(
  courses: PlanCourseSemesterCandidate[],
  ctx: { programId: string; levelId: string; studySystem: string; semester: number },
): PlanCourseSemesterCandidate[] {
  return courses.filter(
    (c) =>
      c.programId === ctx.programId &&
      c.levelId === ctx.levelId &&
      c.studySystem === ctx.studySystem &&
      c.semester === ctx.semester,
  );
}

export type ElectiveSlotCourseMembership = {
  electiveSlotId: string;
  courseId: string;
  active?: boolean;
};

export type ElectiveSelectionCandidate = {
  electiveSlotId: string;
  selectedCourseId: string;
  slotStudyPlanId: string;
  slotSemester: number;
  slotLevelId: string | null;
  slotActive?: boolean;
  courseCode?: string;
};

export type ElectiveValidationContext = {
  studyPlanId: string;
  semester: number;
  levelId: string;
  allowed: ElectiveSlotCourseMembership[];
};

export type ElectiveValidationResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | "ELECTIVE_SLOT_CONTEXT_MISMATCH"
        | "ELECTIVE_COURSE_NOT_IN_SLOT"
        | "ELECTIVE_PLACEHOLDER_FORBIDDEN";
    };

/** Mirror RPC elective gates (static / unit contract — no DB). */
export function validateElectiveSelectionForGeneration(
  selection: ElectiveSelectionCandidate,
  ctx: ElectiveValidationContext,
): ElectiveValidationResult {
  if (
    selection.slotStudyPlanId !== ctx.studyPlanId ||
    selection.slotSemester !== ctx.semester ||
    selection.slotActive === false ||
    (selection.slotLevelId != null && selection.slotLevelId !== ctx.levelId)
  ) {
    return { ok: false, code: "ELECTIVE_SLOT_CONTEXT_MISMATCH" };
  }
  if (selection.courseCode && isElectivePlaceholderCode(selection.courseCode)) {
    return { ok: false, code: "ELECTIVE_PLACEHOLDER_FORBIDDEN" };
  }
  const allowed = ctx.allowed.some(
    (m) =>
      m.electiveSlotId === selection.electiveSlotId &&
      m.courseId === selection.selectedCourseId &&
      m.active !== false,
  );
  if (!allowed) {
    return { ok: false, code: "ELECTIVE_COURSE_NOT_IN_SLOT" };
  }
  return { ok: true };
}
