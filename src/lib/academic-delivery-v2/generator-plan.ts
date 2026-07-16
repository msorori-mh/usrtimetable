/**
 * Pure planning logic for V2 cohort delivery generation (idempotent keys).
 * Used by harness tests; SQL RPC is the authoritative DB executor.
 */
import { buildGroupCodes, computeDeliveryGroupCount, distributeStudents } from "./group-count";
import {
  emptyGeneratorSummary,
  formatElectiveCourseLabel,
  type ComponentType,
  type GeneratorSummary,
  type RoomTypeCapacityRef,
} from "./types";

export interface PlanCourseRef {
  id: string;
  course_id: string;
  course_code: string;
  course_name: string;
  level_id: string;
  semester: number;
  is_required: boolean;
  is_elective_slot?: boolean;
  elective_slot_id?: string | null;
}

export interface ComponentRef {
  id: string;
  plan_course_id: string;
  component_type: ComponentType;
  weekly_contact_hours: number;
  required_room_type_id: string | null;
  is_timetabled: boolean;
  counts_toward_regular_load: boolean;
}

export interface ElectiveSelectionRef {
  elective_slot_id: string;
  selected_course_id: string;
  selected_course_code: string;
  selected_course_name: string;
  plan_course_id: string | null;
}

export interface ElectiveSlotRef {
  id: string;
  slot_code: string;
  semester: number;
  level_id: string | null;
  allowed_course_ids: string[];
}

export interface CohortRef {
  id: string;
  college_id: string;
  program_id: string;
  level_id: string;
  study_system: string;
  term_id: string;
  entry_year: number;
  expected_students: number;
  semester: number; // resolved from term_type
}

export interface ExistingOfferingKey {
  course_id: string;
  /** Natural key slice already scoped to college/term/program/level/study_system */
}

export interface ExistingDeliveryGroupKey {
  component_id: string;
  group_code: string;
}

export interface PlannedOffering {
  course_id: string;
  plan_course_id: string | null;
  study_plan_id: string | null;
  expected_students: number;
  sections_count: number;
  display_name: string;
  is_elective: boolean;
  action: "create" | "update" | "unchanged";
}

export interface PlannedDeliveryGroup {
  plan_course_id: string;
  component_id: string;
  component_type: ComponentType;
  group_code: string;
  expected_students: number;
  capacity_limit: number | null;
  counts_toward_regular_load: boolean;
  action: "create" | "update" | "unchanged";
}

export interface CohortGenerationPlan {
  cohort_id: string;
  offerings: PlannedOffering[];
  delivery_groups: PlannedDeliveryGroup[];
  summary: GeneratorSummary;
}

export interface PlanGeneratorInput {
  cohort: CohortRef;
  study_plan_id: string | null;
  plan_courses: PlanCourseRef[];
  components: ComponentRef[];
  elective_slots: ElectiveSlotRef[];
  elective_selections: ElectiveSelectionRef[];
  room_types: Map<string, RoomTypeCapacityRef>;
  existing_offerings: Set<string>; // course_id
  existing_delivery_groups: Set<string>; // component_id|group_code
}

function pushErr(
  summary: GeneratorSummary,
  code: string,
  message_ar: string,
  cohort_id: string,
  detail?: string,
) {
  summary.validation_errors.push({ code, message_ar, cohort_id, detail });
}

function pushWarn(
  summary: GeneratorSummary,
  code: string,
  message_ar: string,
  cohort_id: string,
  detail?: string,
) {
  summary.warnings.push({ code, message_ar, cohort_id, detail });
}

/**
 * Build an idempotent generation plan for one cohort (no DB I/O).
 */
export function planCohortDelivery(input: PlanGeneratorInput): CohortGenerationPlan {
  const summary = emptyGeneratorSummary();
  summary.cohorts_processed = 1;
  const { cohort } = input;
  const offerings: PlannedOffering[] = [];
  const delivery_groups: PlannedDeliveryGroup[] = [];

  if (!input.study_plan_id) {
    pushErr(summary, "missing_study_plan", "لا توجد خطة دراسية مرتبطة ببرنامج الدفعة.", cohort.id);
    return { cohort_id: cohort.id, offerings, delivery_groups, summary };
  }

  // Resolve elective slots for this semester/level
  const slots = input.elective_slots.filter(
    (s) => s.semester === cohort.semester && (s.level_id == null || s.level_id === cohort.level_id),
  );
  const selectionBySlot = new Map(input.elective_selections.map((s) => [s.elective_slot_id, s]));

  type ResolvedCourse = {
    course_id: string;
    plan_course_id: string;
    display_name: string;
    is_elective: boolean;
  };
  const resolved: ResolvedCourse[] = [];

  for (const pc of input.plan_courses) {
    if (pc.level_id !== cohort.level_id || pc.semester !== cohort.semester) continue;
    if (pc.is_elective_slot) continue; // handled via elective_slots
    resolved.push({
      course_id: pc.course_id,
      plan_course_id: pc.id,
      display_name: pc.course_name,
      is_elective: false,
    });
  }

  for (const slot of slots) {
    const sel = selectionBySlot.get(slot.id);
    if (!sel) {
      pushErr(
        summary,
        "elective_slot_unselected",
        `خانة اختيارية بلا اختيار فعلي: ${slot.slot_code}`,
        cohort.id,
        slot.slot_code,
      );
      continue;
    }
    if (!slot.allowed_course_ids.includes(sel.selected_course_id)) {
      pushErr(
        summary,
        "elective_course_not_allowed",
        `المقرر المختار غير مسموح في الخانة ${slot.slot_code}`,
        cohort.id,
        sel.selected_course_code,
      );
      continue;
    }
    if (!sel.plan_course_id) {
      pushErr(
        summary,
        "elective_plan_course_missing",
        `المقرر الاختياري المختار غير مربوط بمقرر خطة: ${sel.selected_course_code}`,
        cohort.id,
      );
      continue;
    }
    resolved.push({
      course_id: sel.selected_course_id,
      plan_course_id: sel.plan_course_id,
      display_name: formatElectiveCourseLabel(sel.selected_course_name),
      is_elective: true,
    });
  }

  // Dedupe by course_id (elective + required collision → keep first, warn)
  const seenCourses = new Set<string>();
  const uniqueResolved: ResolvedCourse[] = [];
  for (const r of resolved) {
    if (seenCourses.has(r.course_id)) {
      pushWarn(
        summary,
        "duplicate_course_skipped",
        `تخطي مقرر مكرر داخل الدفعة: ${r.display_name}`,
        cohort.id,
      );
      continue;
    }
    seenCourses.add(r.course_id);
    uniqueResolved.push(r);
  }

  const compsByPlanCourse = new Map<string, ComponentRef[]>();
  for (const c of input.components) {
    const arr = compsByPlanCourse.get(c.plan_course_id) ?? [];
    arr.push(c);
    compsByPlanCourse.set(c.plan_course_id, arr);
  }

  for (const course of uniqueResolved) {
    const comps = compsByPlanCourse.get(course.plan_course_id) ?? [];
    if (comps.length === 0) {
      pushErr(
        summary,
        "missing_plan_components",
        `لا توجد مكونات خطة للمقرر: ${course.display_name}`,
        cohort.id,
        course.plan_course_id,
      );
      continue;
    }

    // sections_count for compat offering = max group count across timetabled components
    let maxGroups = 1;
    const plannedGroups: PlannedDeliveryGroup[] = [];
    let componentFailed = false;

    for (const comp of comps) {
      if (comp.component_type === "summer_training") {
        pushWarn(
          summary,
          "summer_training_skipped",
          "التدريب الصيفي خارج الجدولة الأسبوعية — لم تُنشأ مجموعات تسليم.",
          cohort.id,
          comp.id,
        );
        continue;
      }

      const roomType =
        comp.required_room_type_id != null
          ? (input.room_types.get(comp.required_room_type_id) ?? null)
          : null;

      const gc = computeDeliveryGroupCount({
        component_type: comp.component_type,
        student_count: cohort.expected_students,
        roomType,
      });

      if (!gc.ok) {
        pushErr(
          summary,
          gc.error_code ?? "group_count_failed",
          gc.message_ar ?? "فشل حساب عدد المجموعات",
          cohort.id,
          `${comp.component_type}:${comp.id}`,
        );
        componentFailed = true;
        break;
      }
      if (gc.warning) {
        pushWarn(summary, gc.warning, "تم الإبقاء على مجموعة واحدة لغياب سعة مناسبة.", cohort.id);
      }

      maxGroups = Math.max(maxGroups, gc.group_count);
      const codes = buildGroupCodes(gc.group_count);
      const sizes = distributeStudents(cohort.expected_students, gc.group_count);
      for (let i = 0; i < codes.length; i++) {
        const key = `${comp.id}|${codes[i]}`;
        const exists = input.existing_delivery_groups.has(key);
        plannedGroups.push({
          plan_course_id: course.plan_course_id,
          component_id: comp.id,
          component_type: comp.component_type,
          group_code: codes[i],
          expected_students: sizes[i] ?? 0,
          capacity_limit: gc.capacity_limit,
          counts_toward_regular_load: comp.counts_toward_regular_load,
          action: exists ? "update" : "create",
        });
      }
    }

    if (componentFailed) continue;

    // Only emit groups for successfully planned courses
    for (const g of plannedGroups) {
      delivery_groups.push(g);
      if (g.action === "create") summary.delivery_groups_created++;
      else {
        // Treat identical re-run as update intent; caller may count unchanged
        summary.delivery_groups_updated++;
      }
    }

    const offeringExists = input.existing_offerings.has(course.course_id);
    const offeringAction = offeringExists ? "update" : "create";
    offerings.push({
      course_id: course.course_id,
      plan_course_id: course.plan_course_id,
      study_plan_id: input.study_plan_id,
      expected_students: cohort.expected_students,
      sections_count: Math.max(1, maxGroups),
      display_name: course.display_name,
      is_elective: course.is_elective,
      action: offeringAction,
    });
    if (offeringAction === "create") summary.offerings_created++;
    else summary.offerings_updated++;
  }

  if (
    summary.validation_errors.length === 0 &&
    offerings.length === 0 &&
    delivery_groups.length === 0
  ) {
    pushWarn(
      summary,
      "no_courses_for_cohort",
      "لا توجد مقررات مطابقة للمستوى/الفصل لهذه الدفعة.",
      cohort.id,
    );
  }

  return { cohort_id: cohort.id, offerings, delivery_groups, summary };
}

/** Merge multiple cohort summaries (for multi-cohort RPC result shape). */
export function mergeSummaries(parts: GeneratorSummary[]): GeneratorSummary {
  const out = emptyGeneratorSummary();
  for (const s of parts) {
    out.cohorts_processed += s.cohorts_processed;
    out.offerings_created += s.offerings_created;
    out.offerings_updated += s.offerings_updated;
    out.delivery_groups_created += s.delivery_groups_created;
    out.delivery_groups_updated += s.delivery_groups_updated;
    out.unchanged += s.unchanged;
    out.warnings.push(...s.warnings);
    out.validation_errors.push(...s.validation_errors);
  }
  return out;
}
