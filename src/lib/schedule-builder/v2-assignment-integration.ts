/**
 * Phase 9.5 — Schedule Builder V2 assignment integration contracts (pure).
 * No Supabase client calls here.
 */

export type SchedulingStatus =
  | "unscheduled"
  | "partially_scheduled"
  | "scheduled"
  | "over_scheduled"
  | "blocked";

export type ScheduleBuilderV2WorkItem = {
  teaching_assignment_id: string;
  delivery_group_id: string;
  cohort_id: string;
  cohort_code: string | null;
  program_id: string | null;
  level_id: string | null;
  semester_term_id: string | null;
  study_system: string | null;
  course_id: string;
  course_code: string;
  course_name: string;
  component_id: string;
  component_type: string;
  group_number: number | null;
  group_code: string | null;
  instructor_id: string;
  instructor_name: string;
  assigned_component_hours: number;
  component_hours: number | null;
  time_unit: string;
  currently_scheduled_hours: number;
  remaining_schedule_hours: number;
  session_count: number;
  scheduling_status: SchedulingStatus;
  blocking_reason: string | null;
  can_create_session: boolean;
  is_project: boolean;
  is_summer_training: boolean;
  assignment_active: boolean;
  delivery_group_active: boolean;
  delivery_group_obsolete: boolean;
  allocation_status: string;
  course_offering_id: string;
  plan_course_component_id: string | null;
  session_type: string | null;
  expected_students: number;
  assignment_updated_at: string | null;
};

export type AssignmentSchedulingSummary = {
  assigned_component_hours: number;
  currently_scheduled_hours: number;
  remaining_schedule_hours: number;
  session_count: number;
};

export type ScheduleConflictPreview = {
  code: string;
  severity?: string;
  message_ar?: string;
  message_en?: string;
  related_session_id?: string | null;
  metadata?: Record<string, unknown>;
};

export type CreateSessionFromAssignmentInput = {
  scheduleVersionId: string;
  teachingAssignmentId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  roomId: string;
  expectedVersionUpdatedAt: string;
  note?: string | null;
};

export type CreateSessionFromAssignmentResult = {
  ok: boolean;
  code: string | null;
  stale: boolean;
  message_ar: string | null;
  blocking_conflicts: ScheduleConflictPreview[];
  warnings: ScheduleConflictPreview[];
  session: {
    id: string;
    day_of_week: number;
    start_time: string;
    end_time: string;
    room_id: string | null;
    teaching_assignment_id: string | null;
    delivery_group_id: string | null;
    updated_at: string;
  } | null;
  schedule_version_updated_at: string | null;
  scheduling_summary: AssignmentSchedulingSummary | null;
};

export type WorkItemsFilters = {
  scheduleVersionId: string;
  programId?: string | null;
  levelId?: string | null;
  cohortId?: string | null;
  studySystem?: string | null;
  componentType?: string | null;
  instructorId?: string | null;
  schedulingStatus?: string | null;
};

export type WorkItemsPayload = {
  ok: boolean;
  schedule_version_id: string;
  college_id: string;
  academic_term_id: string;
  version_status: string;
  version_updated_at: string;
  time_unit: string;
  time_unit_note: string | null;
  rows: ScheduleBuilderV2WorkItem[];
  can_manage: boolean;
};

export const SCHEDULING_STATUS_LABEL_AR: Record<SchedulingStatus, string> = {
  unscheduled: "غير مجدول",
  partially_scheduled: "مجدول جزئيًا",
  scheduled: "مجدول بالكامل",
  over_scheduled: "تجاوز الجدول",
  blocked: "محظور",
};

export const COMPONENT_TYPE_LABEL_AR: Record<string, string> = {
  theory: "نظري",
  practical: "عملي",
  tutorial: "تمارين",
  project: "مشروع",
  summer_training: "تدريب صيفي",
};

const CREATE_ERROR_AR: Record<string, string> = {
  COHORT_COMPONENT_SINGLE_INSTRUCTOR_REQUIRED:
    "يجب توحيد محاضر مجموعات النظري، وتوحيد محاضر مجموعات العملي للمقرر نفسه داخل الدفعة.",
  UNAUTHORIZED: "يجب تسجيل الدخول.",
  INVALID_ARGS: "بيانات الإنشاء غير مكتملة.",
  INVALID_DAY: "يوم غير صالح.",
  INVALID_TIME_RANGE: "نطاق الوقت غير صالح.",
  ROOM_REQUIRED: "القاعة مطلوبة.",
  NOT_FOUND: "العنصر غير موجود.",
  FORBIDDEN_COLLEGE: "لا تملك صلاحية إدارة هذه الكلية.",
  VERSION_PUBLISHED: "لا يمكن الإنشاء على نسخة منشورة.",
  VERSION_ARCHIVED: "لا يمكن الإنشاء على نسخة مؤرشفة.",
  VERSION_LOCKED: "نسخة الجدول مقفلة.",
  STALE_VERSION: "تغيّرت نسخة الجدول. أعد التحميل ثم حاول مجددًا.",
  ASSIGNMENT_NOT_FOUND: "التكليف غير موجود.",
  CROSS_COLLEGE_FORBIDDEN: "التكليف لا ينتمي لنفس كلية النسخة.",
  CROSS_TERM_FORBIDDEN: "التكليف لا ينتمي إلى الفصل الأكاديمي لنسخة الجدول.",
  NOT_V2_ASSIGNMENT: "هذا المسار مخصص لتكليفات V2.",
  INACTIVE_ASSIGNMENT: "التكليف غير نشط.",
  INACTIVE_DELIVERY_GROUP: "مجموعة التدريس غير نشطة.",
  OBSOLETE_DELIVERY_GROUP: "مجموعة التدريس ملغاة.",
  SUMMER_TRAINING_BLOCKED: "التدريب الصيفي غير قابل للجدولة الأسبوعية.",
  PROJECT_NON_WEEKLY: "المشروع لا يُجدول كجلسة أسبوعية قياسية.",
  OFFERING_COMPATIBILITY: "عرض المقرر غير متوافق.",
  ASSIGNMENT_IDENTITY_MISMATCH: "عدم تطابق بيانات التكليف.",
  OVER_SCHEDULED: "تجاوز الساعات المكلف بها.",
  BLOCKED_CONFLICTS: "توجد تعارضات مانعة.",
  BLOCKED_WARNINGS: "توجد تحذيرات غير محلولة.",
  RPC_ERROR: "فشل استدعاء الخادم.",
};

export function mapCreateSessionError(
  code: string | null | undefined,
  fallback?: string | null,
): string {
  if (code && CREATE_ERROR_AR[code]) return CREATE_ERROR_AR[code];
  return fallback || "تعذّر إنشاء الجلسة.";
}

export function blockingReasonLabelAr(reason: string | null | undefined): string {
  if (!reason) return "—";
  return CREATE_ERROR_AR[reason] ?? reason;
}

function asNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asStatus(value: unknown): SchedulingStatus {
  const s = String(value ?? "");
  if (
    s === "unscheduled" ||
    s === "partially_scheduled" ||
    s === "scheduled" ||
    s === "over_scheduled" ||
    s === "blocked"
  ) {
    return s;
  }
  return "blocked";
}

export function parseWorkItem(raw: unknown): ScheduleBuilderV2WorkItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = String(r.teaching_assignment_id ?? "");
  if (!id) return null;
  return {
    teaching_assignment_id: id,
    delivery_group_id: String(r.delivery_group_id ?? ""),
    cohort_id: String(r.cohort_id ?? ""),
    cohort_code: (r.cohort_code as string | null) ?? null,
    program_id: (r.program_id as string | null) ?? null,
    level_id: (r.level_id as string | null) ?? null,
    semester_term_id: (r.semester_term_id as string | null) ?? null,
    study_system: (r.study_system as string | null) ?? null,
    course_id: String(r.course_id ?? ""),
    course_code: String(r.course_code ?? ""),
    course_name: String(r.course_name ?? ""),
    component_id: String(r.component_id ?? ""),
    component_type: String(r.component_type ?? ""),
    group_number: r.group_number == null ? null : asNumber(r.group_number),
    group_code: (r.group_code as string | null) ?? null,
    instructor_id: String(r.instructor_id ?? ""),
    instructor_name: String(r.instructor_name ?? ""),
    assigned_component_hours: asNumber(r.assigned_component_hours),
    component_hours: r.component_hours == null ? null : asNumber(r.component_hours),
    time_unit: String(r.time_unit ?? "component_hours_wallclock_equivalent"),
    currently_scheduled_hours: asNumber(r.currently_scheduled_hours),
    remaining_schedule_hours: Math.max(0, asNumber(r.remaining_schedule_hours)),
    session_count: asNumber(r.session_count),
    scheduling_status: asStatus(r.scheduling_status),
    blocking_reason: (r.blocking_reason as string | null) ?? null,
    can_create_session: !!r.can_create_session,
    is_project: !!r.is_project,
    is_summer_training: !!r.is_summer_training,
    assignment_active: r.assignment_active !== false,
    delivery_group_active: r.delivery_group_active !== false,
    delivery_group_obsolete: !!r.delivery_group_obsolete,
    allocation_status: String(r.allocation_status ?? "unassigned"),
    course_offering_id: String(r.course_offering_id ?? ""),
    plan_course_component_id: (r.plan_course_component_id as string | null) ?? null,
    session_type: (r.session_type as string | null) ?? null,
    expected_students: asNumber(r.expected_students),
    assignment_updated_at: (r.assignment_updated_at as string | null) ?? null,
  };
}

export function parseWorkItemsPayload(data: unknown): WorkItemsPayload {
  const row = (data ?? {}) as Record<string, unknown>;
  const rowsRaw = Array.isArray(row.rows) ? row.rows : [];
  return {
    ok: row.ok !== false,
    schedule_version_id: String(row.schedule_version_id ?? ""),
    college_id: String(row.college_id ?? ""),
    academic_term_id: String(row.academic_term_id ?? ""),
    version_status: String(row.version_status ?? ""),
    version_updated_at: String(row.version_updated_at ?? ""),
    time_unit: String(row.time_unit ?? "component_hours_wallclock_equivalent"),
    time_unit_note: (row.time_unit_note as string | null) ?? null,
    rows: rowsRaw.map(parseWorkItem).filter((x): x is ScheduleBuilderV2WorkItem => !!x),
    can_manage: !!row.can_manage,
  };
}

function asConflictArray(value: unknown): ScheduleConflictPreview[] {
  if (!Array.isArray(value)) return [];
  return value.map((c) => {
    const r = (c ?? {}) as Record<string, unknown>;
    return {
      code: String(r.code ?? "unknown"),
      severity: r.severity as string | undefined,
      message_ar:
        (r.message_ar as string | undefined) ??
        (
          {
            cohort_component_single_instructor:
              "يجب توحيد محاضر جميع مجموعات هذا المكوّن قبل حفظ الجدول.",
            instructor_availability: "المحاضر غير متاح في وقت المحاضرة المقترح.",
            instructor_availability_required: "يلزم تحديد توافر المحاضر لهذا اليوم.",
            instructor_daily_hours: "يتجاوز الموعد سقف ساعات المحاضر اليومية.",
            instructor_attendance_days: "يتجاوز الموعد الحد الأعلى لأيام حضور المحاضر أسبوعيًا.",
            student_daily_hours: "يتجاوز الموعد إجمالي ساعات مجموعة الطلاب اليومية.",
            student_daily_theory_hours: "يتجاوز الموعد سقف الساعات النظرية اليومية للطلاب.",
            student_daily_practical_hours: "يتجاوز الموعد سقف الساعات العملية اليومية للطلاب.",
            student_extended_days: "يتجاوز الموعد أيام التدريس الممتدة المسموح بها للطلاب.",
          } as Record<string, string>
        )[String(r.code ?? "")],
      message_en: r.message_en as string | undefined,
      related_session_id: (r.related_session_id as string | null) ?? null,
      metadata: (r.metadata as Record<string, unknown>) ?? undefined,
    };
  });
}

export function parseCreateSessionResult(data: unknown): CreateSessionFromAssignmentResult {
  const row = (data ?? {}) as Record<string, unknown>;
  const code = (row.code as string | null) ?? null;
  const ok = !!row.ok;
  const summary = row.scheduling_summary as Record<string, unknown> | null | undefined;
  const session = row.session as Record<string, unknown> | null | undefined;
  return {
    ok,
    code,
    stale: !!row.stale,
    message_ar: mapCreateSessionError(code, (row.message_ar as string | null) ?? null),
    blocking_conflicts: asConflictArray(row.blocking_conflicts),
    warnings: asConflictArray(row.warnings),
    session: session
      ? {
          id: String(session.id ?? ""),
          day_of_week: asNumber(session.day_of_week),
          start_time: String(session.start_time ?? ""),
          end_time: String(session.end_time ?? ""),
          room_id: (session.room_id as string | null) ?? null,
          teaching_assignment_id: (session.teaching_assignment_id as string | null) ?? null,
          delivery_group_id: (session.delivery_group_id as string | null) ?? null,
          updated_at: String(session.updated_at ?? ""),
        }
      : null,
    schedule_version_updated_at: (row.schedule_version_updated_at as string | null) ?? null,
    scheduling_summary: summary
      ? {
          assigned_component_hours: asNumber(summary.assigned_component_hours),
          currently_scheduled_hours: asNumber(summary.currently_scheduled_hours),
          remaining_schedule_hours: Math.max(0, asNumber(summary.remaining_schedule_hours)),
          session_count: asNumber(summary.session_count),
        }
      : null,
  };
}

/** Pure: wall-clock hours from HH:MM[/SS] — mirrors SQL helper for UI preview. */
export function wallClockHours(start: string, end: string): number {
  const toMin = (s: string) => {
    const [h, m] = s.slice(0, 5).split(":").map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
    return h * 60 + m;
  };
  const a = toMin(start);
  const b = toMin(end);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  return Math.round(((b - a) / 60) * 10000) / 10000;
}

export function computeSchedulingStatus(input: {
  assigned: number;
  scheduled: number;
  blockedReason?: string | null;
}): SchedulingStatus {
  if (input.blockedReason) return "blocked";
  if (input.scheduled > input.assigned) return "over_scheduled";
  if (input.scheduled <= 0) return "unscheduled";
  if (input.scheduled < input.assigned) return "partially_scheduled";
  return "scheduled";
}

export type SessionV2Visibility = {
  teaching_assignment_id: string | null;
  delivery_group_id: string | null;
  cohort_id: string | null;
  plan_course_component_id: string | null;
  assignment_active: boolean | null;
  delivery_group_active: boolean | null;
  delivery_group_obsolete: boolean | null;
  component_type: string | null;
  assigned_component_hours: number | null;
  currently_scheduled_hours: number | null;
  remaining_schedule_hours: number | null;
  inactive_assignment_warning: boolean;
};

export function buildInactiveAssignmentWarning(
  vis: SessionV2Visibility | null | undefined,
): string | null {
  if (!vis?.teaching_assignment_id) return null;
  if (vis.assignment_active === false) {
    return "تحذير: التكليف المرتبط بهذه الجلسة لم يعد نشطًا. الجلسة التاريخية ظاهرة؛ لا تُنشأ جلسات جديدة من هذا التكليف.";
  }
  if (vis.delivery_group_obsolete) {
    return "تحذير: مجموعة التدريس المرتبطة أصبحت ملغاة.";
  }
  if (vis.delivery_group_active === false) {
    return "تحذير: مجموعة التدريس المرتبطة غير نشطة.";
  }
  return null;
}
