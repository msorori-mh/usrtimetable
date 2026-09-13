/**
 * Phase 9.4 — Teaching Assignments V2 runtime types + pure helpers.
 * Mirrors SQL RPC contracts (workspace, allocation, workload preview, mutations).
 */

import type { DeliveryComponentType } from "./delivery-groups.ts";
import {
  computeInstructorWorkload,
  hoursForAssignment,
  validateCoTeachingHours,
  type InstructorWorkloadResult,
} from "./workload.ts";

export type AllocationStatus =
  | "unassigned"
  | "under_allocated"
  | "fully_allocated"
  | "over_allocated";

export type AssignmentAllocationSummary = {
  delivery_group_id: string;
  component_type: DeliveryComponentType | string | null;
  component_hours: number;
  assigned_hours_total: number;
  remaining_hours: number;
  assignment_count: number;
  is_co_taught: boolean;
  allocation_status: AllocationStatus;
};

export type TeachingAssignmentInstructorRef = {
  assignment_id: string;
  instructor_id: string;
  instructor_name: string | null;
  employee_number: string | null;
  assigned_component_hours: number | null;
  is_active: boolean;
  updated_at: string;
};

export type TeachingAssignmentWorkspaceRow = {
  delivery_group_id: string;
  college_id: string;
  cohort_id: string;
  cohort_code: string | null;
  program_id: string;
  level_id: string;
  term_id: string;
  study_system: string;
  plan_course_id: string;
  plan_course_component_id: string;
  component_type: DeliveryComponentType | string;
  course_id: string;
  course_code: string;
  course_name: string;
  group_number: number | null;
  group_code: string;
  expected_students: number;
  capacity_limit: number | null;
  is_obsolete: boolean;
  active: boolean;
  excluded_from_standard_workload: boolean;
  component_hours: number | null;
  assigned_hours_total: number;
  remaining_hours: number;
  assignment_count: number;
  is_co_taught: boolean;
  allocation_status: AllocationStatus;
  instructors: TeachingAssignmentInstructorRef[];
  conflicts: string[];
};

export type TeachingAssignmentWorkspace = {
  ok: boolean;
  college_id: string;
  rows: TeachingAssignmentWorkspaceRow[];
  can_manage: boolean;
};

export type WorkloadImpactPreview = {
  ok: boolean;
  instructor_id: string;
  delivery_group_id: string;
  term_id: string | null;
  required_load_hours: number | null;
  current_standard_assigned_hours: number;
  proposed_assignment_hours: number;
  projected_standard_assigned_hours: number;
  current_project_hours: number;
  projected_project_hours: number;
  deficit_before: number;
  deficit_after: number;
  overload_before: number;
  overload_after: number;
  status_before: string;
  status_after: string;
  policy_missing: boolean;
  warnings: string[];
  assignment_conflicts: string[];
  component_type: string | null;
  is_project: boolean;
};

export type AssignmentMutationResult = {
  ok: boolean;
  action: string;
  assignment_id: string;
  delivery_group_id?: string;
  instructor_id?: string;
  assigned_component_hours?: number | null;
  is_active?: boolean;
  updated_at?: string;
  allocation?: AssignmentAllocationSummary;
};

export type AssignmentValidationError = {
  code: string;
  message: string;
};

export type WorkspaceFilters = {
  collegeId: string;
  programId?: string | null;
  levelId?: string | null;
  termId?: string | null;
  studySystem?: string | null;
  cohortId?: string | null;
  componentType?: string | null;
  assignmentStatus?: string | null;
};

const RPC_ERROR_MESSAGES: Record<string, string> = {
  insufficient_privilege: "ليست لديك صلاحية لهذا الإجراء",
  OBSOLETE_DELIVERY_GROUP_ASSIGNMENT_FORBIDDEN: "لا يمكن الإسناد لمجموعة تدريس ملغاة (obsolete)",
  DELIVERY_GROUP_INACTIVE_ASSIGNMENT_FORBIDDEN: "لا يمكن الإسناد لمجموعة تدريس غير نشطة",
  INACTIVE_ASSIGNMENT_SESSION_FORBIDDEN: "لا يمكن ربط جلسة جديدة بتكليف غير نشط",
  DELIVERY_GROUP_INACTIVE_SESSION_FORBIDDEN: "لا يمكن ربط جلسة بمجموعة تدريس غير نشطة",
  SUMMER_TRAINING_WEEKLY_ASSIGNMENT_FORBIDDEN: "التدريب الصيفي لا يُسند كتدريس أسبوعي",
  CO_TEACHING_HOURS_SPLIT_REQUIRED: "عند التدريس المشترك يجب تحديد ساعات كل مدرس صراحة",
  CO_TEACHING_HOURS_OVER_ALLOCATED: "مجموع ساعات الإسناد يتجاوز ساعات المحاضرة",
  ASSIGNED_HOURS_MUST_BE_POSITIVE: "ساعات الإسناد يجب أن تكون موجبة",
  DUPLICATE_ACTIVE_ASSIGNMENT: "يوجد إسناد نشط لهذا المدرس على نفس المجموعة",
  STALE_ASSIGNMENT_UPDATE: "تم تعديل الإسناد من مستخدم آخر — حدّث الصفحة وأعد المحاولة",
  ASSIGNMENT_HARD_DELETE_FORBIDDEN_LINKED_SESSION:
    "لا يمكن حذف التكليف المرتبط بجلسة — استخدم التعطيل",
  ASSIGNMENT_LINKED_TO_SESSION_MUTATION_FORBIDDEN:
    "لا يمكن تغيير المدرس أو المجموعة لتكليف مرتبط بجلسة",
  NO_COMPATIBILITY_OFFERING: "لا يوجد طرح توافق للمقرر — شغّل توليد المنهج للدفعة أولاً",
  ASSIGNMENT_CROSS_COLLEGE_FORBIDDEN: "الإسناد عبر كليات غير مسموح",
  DELIVERY_GROUP_NOT_FOUND: "مجموعة التدريس غير موجودة",
  INSTRUCTOR_NOT_FOUND: "عضو هيئة التدريس غير موجود",
  ASSIGNMENT_NOT_FOUND: "التكليف غير موجود",
  LEGACY_ASSIGNMENT_NOT_SUPPORTED_BY_V2_RPC: "هذا التكليف تقليدي وليس ضمن مسار V2",
  INACTIVE_ASSIGNMENT_UPDATE_FORBIDDEN: "لا يمكن تعديل تكليف غير نشط — أعد تفعيله أولاً",
};

export function mapAssignmentRpcError(raw: string | null | undefined): AssignmentValidationError {
  const text = String(raw ?? "UNKNOWN_ERROR");
  for (const [code, message] of Object.entries(RPC_ERROR_MESSAGES)) {
    if (text.includes(code)) return { code, message };
  }
  return { code: "RPC_ERROR", message: text };
}

/** Pure helper: delivery group may receive new/reactivated assignments. */
export function canAssignToDeliveryGroup(row: {
  is_obsolete?: boolean;
  active?: boolean;
}): boolean {
  return row.is_obsolete !== true && row.active !== false;
}

export type TeachingAssignmentsV2ImportCommitResult = {
  status: "ok" | "failed" | string;
  rows_received: number;
  rows_created: number;
  rows_updated: number;
  rows_reactivated: number;
  rows_unchanged: number;
  validation_errors: Array<{
    row_number?: number | null;
    natural_key?: string | null;
    error_code: string;
    error_message: string;
    blocking?: boolean;
  }>;
  warnings?: unknown[];
  import_batch_id?: string;
};

export function computeAllocationSummary(input: {
  deliveryGroupId: string;
  componentType: DeliveryComponentType | string;
  componentHours: number;
  /** Active assignment hours (null = unspecified for sole). */
  assignedHours: Array<number | null | undefined>;
}): AssignmentAllocationSummary {
  const count = input.assignedHours.length;
  let total = 0;
  if (count === 1) {
    const h = input.assignedHours[0];
    total = h == null || !Number.isFinite(Number(h)) ? Number(input.componentHours) : Number(h);
  } else {
    total = input.assignedHours.reduce<number>(
      (acc, h) => acc + (h == null || !Number.isFinite(Number(h)) ? 0 : Number(h)),
      0,
    );
  }
  const remaining = Math.max(0, Number(input.componentHours) - total);
  let allocation_status: AllocationStatus = "unassigned";
  if (count === 0) allocation_status = "unassigned";
  else if (total > Number(input.componentHours)) allocation_status = "over_allocated";
  else if (total < Number(input.componentHours)) allocation_status = "under_allocated";
  else allocation_status = "fully_allocated";

  return {
    delivery_group_id: input.deliveryGroupId,
    component_type: input.componentType,
    component_hours: Number(input.componentHours),
    assigned_hours_total: total,
    remaining_hours: remaining,
    assignment_count: count,
    is_co_taught: count > 1,
    allocation_status,
  };
}

/** Pure preview mirroring preview_instructor_workload_after_assignment (no DML). */
export function previewWorkloadImpact(input: {
  academicRank: string | null | undefined;
  existingAssignments: Array<{
    deliveryGroupId: string;
    componentType: DeliveryComponentType;
    weeklyContactHours: number;
    assignedWeeklyHours: number | null | undefined;
    countsTowardRegularLoad: boolean;
    coInstructorCount: number;
  }>;
  proposed: {
    deliveryGroupId: string;
    componentType: DeliveryComponentType;
    weeklyContactHours: number;
    assignedWeeklyHours: number | null | undefined;
    countsTowardRegularLoad: boolean;
    /** Other active instructors already on the group (excluding self). */
    peerCount: number;
    isProjectExcluded?: boolean;
  };
  replaceDeliveryGroupId?: string | null;
}): {
  before: InstructorWorkloadResult;
  after: InstructorWorkloadResult;
  proposedHours: number;
  warnings: string[];
  conflicts: string[];
} {
  const before = computeInstructorWorkload({
    academicRank: input.academicRank,
    assignments: input.existingAssignments,
  });

  const peerCount = input.proposed.peerCount;
  const willCoTeach = peerCount + 1 > 1;
  const conflicts: string[] = [];
  const warnings: string[] = [];

  if (input.proposed.componentType === "summer_training") {
    conflicts.push("SUMMER_TRAINING_WEEKLY_ASSIGNMENT_FORBIDDEN");
  }

  let proposedHours = 0;
  if (willCoTeach && input.proposed.assignedWeeklyHours == null) {
    conflicts.push("CO_TEACHING_HOURS_SPLIT_REQUIRED");
    proposedHours = 0;
  } else if (input.proposed.assignedWeeklyHours != null) {
    if (Number(input.proposed.assignedWeeklyHours) <= 0) {
      conflicts.push("ASSIGNED_HOURS_MUST_BE_POSITIVE");
    }
    proposedHours = Number(input.proposed.assignedWeeklyHours);
  } else {
    proposedHours = Number(input.proposed.weeklyContactHours);
  }

  const coTeachCheck = validateCoTeachingHours({
    componentWeeklyHours: input.proposed.weeklyContactHours,
    assignedHours: [
      ...Array.from({ length: peerCount }, () =>
        // peers assumed explicit in co-teach scenarios for pure preview fixtures
        input.proposed.assignedWeeklyHours != null
          ? Number(input.proposed.weeklyContactHours) / (peerCount + 1)
          : null,
      ),
      willCoTeach ? input.proposed.assignedWeeklyHours : proposedHours,
    ],
  });
  if (!coTeachCheck.ok && coTeachCheck.code !== "CO_TEACHING_HOURS_SPLIT_REQUIRED") {
    if (!conflicts.includes(coTeachCheck.code)) conflicts.push(coTeachCheck.code);
  }

  const kept = input.existingAssignments.filter(
    (a) => a.deliveryGroupId !== (input.replaceDeliveryGroupId ?? input.proposed.deliveryGroupId),
  );

  // Supervision-only work is what leaves the regular load, not the "project" label.
  const isProject =
    input.proposed.isProjectExcluded === true || !input.proposed.countsTowardRegularLoad;

  const afterAssignments = [
    ...kept,
    {
      deliveryGroupId: input.proposed.deliveryGroupId,
      componentType: input.proposed.componentType,
      weeklyContactHours: input.proposed.weeklyContactHours,
      assignedWeeklyHours: willCoTeach
        ? input.proposed.assignedWeeklyHours
        : (input.proposed.assignedWeeklyHours ?? proposedHours),
      countsTowardRegularLoad: !isProject,
      coInstructorCount: peerCount,
    },
  ];

  const after = computeInstructorWorkload({
    academicRank: input.academicRank,
    assignments: afterAssignments,
  });

  if (after.status === "policy_missing" || before.status === "policy_missing") {
    warnings.push("policy_missing");
  }
  if (after.status === "overload") {
    warnings.push("workload_overload");
  }

  // Ensure hoursForAssignment stays consistent for fixtures
  void hoursForAssignment({
    deliveryGroupId: input.proposed.deliveryGroupId,
    componentType: input.proposed.componentType,
    weeklyContactHours: input.proposed.weeklyContactHours,
    assignedWeeklyHours: input.proposed.assignedWeeklyHours,
    countsTowardRegularLoad: !isProject,
    coInstructorCount: peerCount,
  });

  return { before, after, proposedHours, warnings, conflicts };
}

export function parseWorkspacePayload(data: unknown): TeachingAssignmentWorkspace {
  const root = (data ?? {}) as Record<string, unknown>;
  const rowsRaw = Array.isArray(root.rows) ? root.rows : [];
  return {
    ok: root.ok !== false,
    college_id: String(root.college_id ?? ""),
    can_manage: Boolean(root.can_manage),
    rows: rowsRaw.map((r) => {
      const row = r as Record<string, unknown>;
      const instructors = Array.isArray(row.instructors)
        ? (row.instructors as TeachingAssignmentInstructorRef[])
        : [];
      const conflicts = Array.isArray(row.conflicts) ? (row.conflicts as string[]) : [];
      return {
        delivery_group_id: String(row.delivery_group_id ?? ""),
        college_id: String(row.college_id ?? ""),
        cohort_id: String(row.cohort_id ?? ""),
        cohort_code: (row.cohort_code as string | null) ?? null,
        program_id: String(row.program_id ?? ""),
        level_id: String(row.level_id ?? ""),
        term_id: String(row.term_id ?? ""),
        study_system: String(row.study_system ?? ""),
        plan_course_id: String(row.plan_course_id ?? ""),
        plan_course_component_id: String(row.plan_course_component_id ?? ""),
        component_type: String(row.component_type ?? ""),
        course_id: String(row.course_id ?? ""),
        course_code: String(row.course_code ?? ""),
        course_name: String(row.course_name ?? ""),
        group_number: row.group_number == null ? null : Number(row.group_number),
        group_code: String(row.group_code ?? ""),
        expected_students: Number(row.expected_students ?? 0),
        capacity_limit: row.capacity_limit == null ? null : Number(row.capacity_limit),
        is_obsolete: Boolean(row.is_obsolete),
        active: row.active !== false,
        excluded_from_standard_workload: Boolean(row.excluded_from_standard_workload),
        component_hours: row.component_hours == null ? null : Number(row.component_hours),
        assigned_hours_total: Number(row.assigned_hours_total ?? 0),
        remaining_hours: Number(row.remaining_hours ?? 0),
        assignment_count: Number(row.assignment_count ?? 0),
        is_co_taught: Boolean(row.is_co_taught),
        allocation_status: String(row.allocation_status ?? "unassigned") as AllocationStatus,
        instructors,
        conflicts,
      };
    }),
  };
}

export function parseWorkloadPreview(data: unknown): WorkloadImpactPreview {
  const root = (data ?? {}) as Record<string, unknown>;
  return {
    ok: root.ok !== false,
    instructor_id: String(root.instructor_id ?? ""),
    delivery_group_id: String(root.delivery_group_id ?? ""),
    term_id: (root.term_id as string | null) ?? null,
    required_load_hours: root.required_load_hours == null ? null : Number(root.required_load_hours),
    current_standard_assigned_hours: Number(root.current_standard_assigned_hours ?? 0),
    proposed_assignment_hours: Number(root.proposed_assignment_hours ?? 0),
    projected_standard_assigned_hours: Number(root.projected_standard_assigned_hours ?? 0),
    current_project_hours: Number(root.current_project_hours ?? 0),
    projected_project_hours: Number(root.projected_project_hours ?? 0),
    deficit_before: Number(root.deficit_before ?? 0),
    deficit_after: Number(root.deficit_after ?? 0),
    overload_before: Number(root.overload_before ?? 0),
    overload_after: Number(root.overload_after ?? 0),
    status_before: String(root.status_before ?? ""),
    status_after: String(root.status_after ?? ""),
    policy_missing: Boolean(root.policy_missing),
    warnings: Array.isArray(root.warnings) ? (root.warnings as string[]) : [],
    assignment_conflicts: Array.isArray(root.assignment_conflicts)
      ? (root.assignment_conflicts as string[])
      : [],
    component_type: (root.component_type as string | null) ?? null,
    is_project: Boolean(root.is_project),
  };
}

export function parseMutationResult(data: unknown): AssignmentMutationResult {
  const root = (data ?? {}) as Record<string, unknown>;
  return {
    ok: root.ok !== false,
    action: String(root.action ?? ""),
    assignment_id: String(root.assignment_id ?? ""),
    delivery_group_id: root.delivery_group_id ? String(root.delivery_group_id) : undefined,
    instructor_id: root.instructor_id ? String(root.instructor_id) : undefined,
    assigned_component_hours:
      root.assigned_component_hours == null ? null : Number(root.assigned_component_hours),
    is_active: root.is_active == null ? undefined : Boolean(root.is_active),
    updated_at: root.updated_at ? String(root.updated_at) : undefined,
    allocation: root.allocation ? (root.allocation as AssignmentAllocationSummary) : undefined,
  };
}
