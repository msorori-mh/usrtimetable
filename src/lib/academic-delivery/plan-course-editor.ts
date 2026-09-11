/**
 * SOURCE_ONLY_PLAN_COURSE_COMPONENTS_UI_E2E_FIX_01
 * Pure validation / payload builders for the study-plan course & component editor.
 * No DB access, no SECURITY DEFINER, no schema assumptions beyond existing columns.
 */
import {
  derivePlanCourseComponents,
  type ComponentType,
} from "@/lib/academic-delivery/plan-course-components";
import {
  resolveTutorialRoomTypeId,
  tutorialRoomTypeIsLocked,
} from "@/lib/academic-delivery/tutorial-room-type";

export const PLAN_COMPONENT_TYPES = [
  "theory",
  "practical",
  "tutorial",
  "project",
  "summer_training",
] as const;

export const COMPENSATION_MODES = ["per_hour", "per_group_flat", "none"] as const;

export const COMPONENT_TYPE_LABEL_AR: Record<ComponentType, string> = {
  theory: "نظري",
  practical: "عملي",
  tutorial: "تمارين/تدريب",
  project: "مشروع",
  summer_training: "تدريب صيفي",
};

export const COMPENSATION_MODE_LABEL_AR: Record<(typeof COMPENSATION_MODES)[number], string> = {
  per_hour: "بالساعة",
  per_group_flat: "مبلغ ثابت للمجموعة",
  none: "بدون",
};

export type PlanContext = {
  collegeId: string;
  studyPlanId: string;
  programId: string;
};

export type CourseOption = {
  id: string;
  code: string;
  name: string;
  college_id: string;
  theory_hours?: number | null;
  practical_hours?: number | null;
  credit_hours?: number | null;
};

export type LevelOption = {
  id: string;
  name: string;
  level_number: number;
  program_id: string;
  college_id: string;
};

export type RoomTypeOption = {
  id: string;
  name_ar: string;
  college_id: string;
  is_active?: boolean;
  /** canonical code (e.g. lecture_hall / computer_lab) — required by the tutorial rule */
  code?: string | null;
  default_capacity?: number | null;
};

export type ExistingPlanCourse = {
  id: string;
  course_id: string;
  level_id: string | null;
  semester: number;
  study_plan_id: string;
  college_id: string;
};

export type PlanCourseForm = {
  course_id: string;
  level_id: string;
  semester: number;
  is_required: boolean;
};

export type ComponentForm = {
  component_type: string;
  weekly_contact_hours: number;
  required_room_type_id: string | null;
  is_timetabled: boolean;
  counts_toward_regular_load: boolean;
  counts_toward_overtime: boolean;
  compensation_mode: string;
  explicit_group_size: number | null;
};

export type ValidationFailure = {
  ok: false;
  code: string;
  messageAr: string;
};

export type ValidationResult = { ok: true } | ValidationFailure;

const fail = (code: string, messageAr: string): ValidationFailure => ({
  ok: false,
  code,
  messageAr,
});

/** Fail-closed validation for a plan_courses row before insert/update. */
export function validatePlanCourseForm(args: {
  ctx: PlanContext;
  form: PlanCourseForm;
  courses: CourseOption[];
  levels: LevelOption[];
  existing: ExistingPlanCourse[];
  editingId?: string | null;
}): ValidationResult {
  const { ctx, form, courses, levels, existing, editingId } = args;
  const course = courses.find((c) => c.id === form.course_id);
  if (!course) return fail("COURSE_REQUIRED", "اختر مقرراً من مقررات هذه الكلية.");
  if (course.college_id !== ctx.collegeId) {
    return fail("COURSE_COLLEGE_MISMATCH", "المقرر لا ينتمي إلى الكلية النشطة.");
  }
  const level = levels.find((l) => l.id === form.level_id);
  if (!level) return fail("LEVEL_REQUIRED", "اختر المستوى الدراسي.");
  if (level.program_id !== ctx.programId || level.college_id !== ctx.collegeId) {
    return fail("LEVEL_SCOPE_MISMATCH", "المستوى لا ينتمي إلى برنامج الخطة أو الكلية النشطة.");
  }
  if (form.semester !== 1 && form.semester !== 2) {
    return fail("SEMESTER_INVALID", "الفصل يجب أن يكون 1 أو 2.");
  }
  const duplicate = existing.find(
    (r) =>
      r.id !== editingId &&
      r.study_plan_id === ctx.studyPlanId &&
      r.college_id === ctx.collegeId &&
      r.course_id === form.course_id &&
      r.level_id === form.level_id &&
      r.semester === form.semester,
  );
  if (duplicate) {
    return fail(
      "PLAN_COURSE_DUPLICATE",
      "هذا المقرر مضاف مسبقاً لنفس المستوى ونفس الفصل في هذه الخطة.",
    );
  }
  return { ok: true };
}

export function buildPlanCourseInsert(ctx: PlanContext, form: PlanCourseForm) {
  return {
    college_id: ctx.collegeId,
    study_plan_id: ctx.studyPlanId,
    course_id: form.course_id,
    level_id: form.level_id,
    semester: form.semester,
    is_required: form.is_required,
  };
}

/**
 * 01B — editable fields only. course_id / study_plan_id / college_id are immutable
 * after creation and are deliberately absent from the update payload.
 */
export function buildPlanCourseUpdate(form: PlanCourseForm) {
  return {
    level_id: form.level_id,
    semester: form.semester,
    is_required: form.is_required,
  };
}

export type PlanCourseUpdateScope = {
  id: string;
  collegeId: string;
  studyPlanId: string;
};

/** Fail-closed scope for the plan_courses update mutation (id + college + plan). */
export function planCourseUpdateScope(
  ctx: PlanContext,
  row: ExistingPlanCourse,
): PlanCourseUpdateScope | ValidationFailure {
  if (row.college_id !== ctx.collegeId || row.study_plan_id !== ctx.studyPlanId) {
    return fail("PLAN_COURSE_SCOPE_MISMATCH", "السجل لا ينتمي إلى هذه الخطة أو الكلية النشطة.");
  }
  return { id: row.id, collegeId: ctx.collegeId, studyPlanId: ctx.studyPlanId };
}

export type ExistingComponent = {
  id: string;
  plan_course_id: string;
  component_type: string;
};

export function validateComponentForm(args: {
  ctx: PlanContext;
  form: ComponentForm;
  roomTypes: RoomTypeOption[];
  /** Components already attached to the same plan_course (duplicate type guard). */
  siblings?: ExistingComponent[];
  planCourseId?: string;
  editingId?: string | null;
}): ValidationResult {
  const { ctx, form, roomTypes, siblings, planCourseId, editingId } = args;
  if (!(PLAN_COMPONENT_TYPES as readonly string[]).includes(form.component_type)) {
    return fail("COMPONENT_TYPE_INVALID", "نوع المكوّن غير مسموح.");
  }
  if (!(COMPENSATION_MODES as readonly string[]).includes(form.compensation_mode)) {
    return fail("COMPENSATION_MODE_INVALID", "طريقة الاحتساب غير مسموحة.");
  }
  if (!Number.isFinite(form.weekly_contact_hours) || form.weekly_contact_hours < 0) {
    return fail("HOURS_INVALID", "الساعات الأسبوعية يجب أن تكون رقماً غير سالب.");
  }
  if (form.is_timetabled && form.weekly_contact_hours <= 0) {
    return fail(
      "HOURS_REQUIRED_FOR_TIMETABLED",
      "المكوّن المجدول يحتاج ساعات أسبوعية أكبر من صفر.",
    );
  }
  if (form.explicit_group_size != null) {
    if (!Number.isInteger(form.explicit_group_size) || form.explicit_group_size <= 0) {
      return fail("GROUP_SIZE_INVALID", "حجم المجموعة يجب أن يكون عدداً صحيحاً أكبر من صفر.");
    }
  }
  if (form.required_room_type_id) {
    const rt = roomTypes.find((r) => r.id === form.required_room_type_id);
    if (!rt || rt.college_id !== ctx.collegeId) {
      return fail("ROOM_TYPE_SCOPE_MISMATCH", "نوع القاعة لا ينتمي إلى الكلية النشطة.");
    }
  }
  // TUTORIAL-LECTURE-HALL-PERMANENT-RULE-01 — tutorial is lecture_hall only.
  {
    const tutorial = resolveTutorialRoomTypeId({
      componentType: form.component_type,
      requiredRoomTypeId: form.required_room_type_id,
      roomTypes,
      collegeId: ctx.collegeId,
    });
    if (!tutorial.ok) return fail(tutorial.errorCode, tutorial.message);
  }
  if (siblings && planCourseId) {
    const dup = siblings.find(
      (s) =>
        s.plan_course_id === planCourseId &&
        s.component_type === form.component_type &&
        s.id !== editingId,
    );
    if (dup) {
      return fail("COMPONENT_TYPE_DUPLICATE", "يوجد مكوّن بنفس النوع لهذا المقرر في الخطة.");
    }
  }
  return { ok: true };
}

export function buildComponentInsert(ctx: PlanContext, planCourseId: string, form: ComponentForm) {
  return {
    college_id: ctx.collegeId,
    plan_course_id: planCourseId,
    component_type: form.component_type,
    weekly_contact_hours: form.weekly_contact_hours,
    required_room_type_id: form.required_room_type_id ?? null,
    is_timetabled: form.is_timetabled,
    counts_toward_regular_load: form.counts_toward_regular_load,
    counts_toward_overtime: form.counts_toward_overtime,
    compensation_mode: form.compensation_mode,
    explicit_group_size: form.explicit_group_size ?? null,
  };
}

/** 01B — operational fields only; college_id / plan_course_id stay immutable. */
export function buildComponentUpdate(form: ComponentForm) {
  return {
    component_type: form.component_type,
    weekly_contact_hours: form.weekly_contact_hours,
    required_room_type_id: form.required_room_type_id ?? null,
    is_timetabled: form.is_timetabled,
    counts_toward_regular_load: form.counts_toward_regular_load,
    counts_toward_overtime: form.counts_toward_overtime,
    compensation_mode: form.compensation_mode,
    explicit_group_size: form.explicit_group_size ?? null,
  };
}

export type ComponentUpdateScope = {
  id: string;
  collegeId: string;
  planCourseId: string;
};

export function componentUpdateScope(
  ctx: PlanContext,
  row: { id: string; plan_course_id: string },
  planCourseIdsInPlan: string[],
): ComponentUpdateScope | ValidationFailure {
  if (!planCourseIdsInPlan.includes(row.plan_course_id)) {
    return fail("COMPONENT_SCOPE_MISMATCH", "المكوّن لا ينتمي إلى مقررات هذه الخطة.");
  }
  return { id: row.id, collegeId: ctx.collegeId, planCourseId: row.plan_course_id };
}

/**
 * Generate component rows strictly from the course's explicit hour columns.
 * credit_hours is never used for derivation.
 */
export function deriveComponentInsertsFromCourse(
  ctx: PlanContext,
  planCourseId: string,
  course: Pick<CourseOption, "theory_hours" | "practical_hours">,
) {
  const derived = derivePlanCourseComponents({
    theory_hours: course.theory_hours ?? 0,
    practical_hours: course.practical_hours ?? 0,
  });
  return derived.map((d) =>
    buildComponentInsert(ctx, planCourseId, {
      component_type: d.component_type,
      weekly_contact_hours: d.weekly_contact_hours,
      required_room_type_id: null,
      is_timetabled: d.is_timetabled,
      counts_toward_regular_load: d.counts_toward_regular_load,
      counts_toward_overtime: d.counts_toward_overtime,
      compensation_mode: d.compensation_mode,
      explicit_group_size: null,
    }),
  );
}

export type DeleteStep =
  | {
      table: "plan_course_components";
      ids: string[];
      collegeId: string;
    }
  | {
      table: "plan_courses";
      id: string;
      collegeId: string;
    };

/** Components first (explicit IDs), then the plan course row — always scoped by college. */
export function planCourseDeleteSteps(args: {
  collegeId: string;
  planCourseId: string;
  componentIds: string[];
}): DeleteStep[] {
  const steps: DeleteStep[] = [];
  if (args.componentIds.length > 0) {
    steps.push({
      table: "plan_course_components",
      ids: [...args.componentIds],
      collegeId: args.collegeId,
    });
  }
  steps.push({ table: "plan_courses", id: args.planCourseId, collegeId: args.collegeId });
  return steps;
}

export type LevelForm = { name: string; level_number: number };

export function validateLevelForm(args: {
  form: LevelForm;
  durationYears: number;
  existing: LevelOption[];
}): ValidationResult {
  const { form, durationYears, existing } = args;
  if (!form.name.trim()) return fail("LEVEL_NAME_REQUIRED", "اسم المستوى مطلوب.");
  const max = Number.isFinite(durationYears) && durationYears > 0 ? durationYears : 0;
  if (max <= 0) {
    return fail("PROGRAM_DURATION_UNKNOWN", "مدة البرنامج غير معروفة، لا يمكن إضافة مستوى.");
  }
  if (!Number.isInteger(form.level_number) || form.level_number < 1 || form.level_number > max) {
    return fail("LEVEL_NUMBER_OUT_OF_RANGE", `رقم المستوى يجب أن يكون بين 1 و ${max}.`);
  }
  if (existing.some((l) => l.level_number === form.level_number)) {
    return fail("LEVEL_DUPLICATE", "يوجد مستوى بنفس الرقم في هذا البرنامج.");
  }
  return { ok: true };
}

export function buildLevelInsert(ctx: PlanContext, form: LevelForm) {
  return {
    college_id: ctx.collegeId,
    program_id: ctx.programId,
    name: form.name.trim(),
    level_number: form.level_number,
  };
}

/** Query keys invalidated after any plan-course/component write so readiness refreshes. */
export const PLAN_COURSE_READINESS_QUERY_KEYS = [
  "plan-courses",
  "plan-course-components",
  "data-readiness",
  "data-onboarding-readiness",
  "dashboard-core-readiness",
] as const;

/* ------------------------------------------------------------------ *
 * SOURCE-ONLY E2E FIX 02 — legacy scheduling counter compatibility.
 * plan_courses.lectures_per_week / labs_per_week (+ session durations)
 * are still read by readiness (src/lib/reports/readiness.ts,
 * routes/_authenticated/data-readiness.tsx), data-cleanup and the greedy
 * auto-scheduler. Components are the source of truth; these helpers derive
 * the legacy counters deterministically from component weekly hours.
 * ------------------------------------------------------------------ */

export type LegacyCounterComponent = {
  component_type: string;
  weekly_contact_hours: number | null;
  is_timetabled?: boolean | null;
};

export type LegacyCounters = {
  lectures_per_week: number;
  lecture_session_duration: number;
  labs_per_week: number;
  lab_session_duration: number;
};

export const DEFAULT_SESSION_DURATION = 2;

/** theory + tutorial map to lectures; practical maps to labs. */
export const LECTURE_COMPONENT_TYPES = ["theory", "tutorial"] as const;
export const LAB_COMPONENT_TYPES = ["practical"] as const;

function sumHours(components: LegacyCounterComponent[], types: readonly string[]): number {
  return components
    .filter((c) => types.includes(c.component_type) && c.is_timetabled !== false)
    .reduce((acc, c) => acc + (Number(c.weekly_contact_hours) || 0), 0);
}

/**
 * Pick a session duration (hours per session) that divides the weekly hours
 * exactly, preferring the value already stored on the row.
 */
export function pickSessionDuration(weeklyHours: number, currentDuration: number | null): number {
  const cur = Number(currentDuration) || 0;
  if (weeklyHours <= 0) return cur > 0 ? cur : DEFAULT_SESSION_DURATION;
  for (const candidate of [cur, DEFAULT_SESSION_DURATION, 3, 1]) {
    if (candidate > 0 && Number.isInteger(weeklyHours / candidate)) return candidate;
  }
  return 1;
}

/** Deterministic legacy counters derived from the component rows. */
export function deriveLegacyCounters(
  components: LegacyCounterComponent[],
  current: Partial<LegacyCounters> | null | undefined,
): LegacyCounters {
  const lectureHours = sumHours(components, LECTURE_COMPONENT_TYPES);
  const labHours = sumHours(components, LAB_COMPONENT_TYPES);
  const lectureDuration = pickSessionDuration(lectureHours, current?.lecture_session_duration ?? 0);
  const labDuration = pickSessionDuration(labHours, current?.lab_session_duration ?? 0);
  return {
    lectures_per_week: lectureHours > 0 ? Math.round(lectureHours / lectureDuration) : 0,
    lecture_session_duration: lectureDuration,
    labs_per_week: labHours > 0 ? Math.round(labHours / labDuration) : 0,
    lab_session_duration: labDuration,
  };
}

/** Update payload — only the four legacy scheduling columns, nothing else. */
export function buildLegacyCounterUpdate(counters: LegacyCounters): LegacyCounters {
  return {
    lectures_per_week: counters.lectures_per_week,
    lecture_session_duration: counters.lecture_session_duration,
    labs_per_week: counters.labs_per_week,
    lab_session_duration: counters.lab_session_duration,
  };
}

export function countersDiffer(
  current: Partial<LegacyCounters> | null | undefined,
  next: LegacyCounters,
): boolean {
  return (
    Number(current?.lectures_per_week ?? -1) !== next.lectures_per_week ||
    Number(current?.lecture_session_duration ?? -1) !== next.lecture_session_duration ||
    Number(current?.labs_per_week ?? -1) !== next.labs_per_week ||
    Number(current?.lab_session_duration ?? -1) !== next.lab_session_duration
  );
}

/** Explicit, actionable message when the component write succeeded but sync failed. */
export const LEGACY_SYNC_PARTIAL_ERROR_AR =
  "تم حفظ المكوّنات لكن فشلت مزامنة بيانات الجدولة (عدد المحاضرات/المعامل). استخدم زر «مزامنة بيانات الجدولة» لهذا المقرر لإعادة المحاولة.";
