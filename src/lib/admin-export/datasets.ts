/**
 * ADMIN-EXPORT-01 — dataset builders for the admin lists.
 * Pure functions: pages pass the already-filtered rows plus label lookups.
 */
import type { AdminExportDataset, AdminExportFilter } from "./dataset";

export type LabelLookup = (value: string | null | undefined) => string;

const ALL_AR = "الكل";

/** Keep only filters that actually narrow the result set. */
export function activeFilters(
  entries: Array<{ label: string; value: string | null | undefined; isDefault?: boolean }>,
): AdminExportFilter[] {
  const out: AdminExportFilter[] = [];
  for (const e of entries) {
    const value = (e.value ?? "").toString().trim();
    if (!value || e.isDefault || value === ALL_AR) continue;
    out.push({ label: e.label, value });
  }
  return out;
}

/* ------------------------------- rooms ---------------------------------- */

export type RoomExportRow = {
  code: string;
  name: string;
  room_type: string;
  capacity: number | null;
  building: string | null;
  floor: string | number | null;
  is_active: boolean;
  notes: string | null;
};

export function roomsExportDataset(input: {
  rows: RoomExportRow[];
  collegeName?: string | null;
  roomTypeLabel: LabelLookup;
  filters?: AdminExportFilter[];
}): AdminExportDataset<RoomExportRow> {
  return {
    fileBase: "rooms",
    title: "القاعات والمعامل",
    sheetName: "القاعات",
    collegeName: input.collegeName ?? null,
    filters: input.filters ?? [],
    rows: input.rows,
    columns: [
      { key: "code", label: "الرمز", value: (r) => r.code },
      { key: "name", label: "الاسم", value: (r) => r.name },
      { key: "room_type", label: "النوع", value: (r) => input.roomTypeLabel(r.room_type) },
      { key: "capacity", label: "السعة", value: (r) => r.capacity },
      { key: "building", label: "المبنى", value: (r) => r.building },
      { key: "floor", label: "الطابق", value: (r) => r.floor },
      { key: "is_active", label: "مفعّلة", value: (r) => r.is_active },
      { key: "notes", label: "ملاحظات", value: (r) => r.notes },
    ],
  };
}

/* ---------------------------- instructors -------------------------------- */

export type InstructorExportRow = {
  employee_number: string | null;
  full_name: string;
  full_name_en?: string | null;
  department_id: string | null;
  academic_rank: string | null;
  employment_type: string | null;
  max_weekly_hours: number | null;
  instructor_type_id?: string | null;
  is_active: boolean;
  needs_review?: boolean;
};

export function instructorsExportDataset(input: {
  rows: InstructorExportRow[];
  collegeName?: string | null;
  departmentLabel: LabelLookup;
  categoryLabel: LabelLookup;
  employmentLabel: LabelLookup;
  filters?: AdminExportFilter[];
}): AdminExportDataset<InstructorExportRow> {
  return {
    fileBase: "instructors",
    title: "أعضاء هيئة التدريس",
    sheetName: "المحاضرون",
    collegeName: input.collegeName ?? null,
    filters: input.filters ?? [],
    rows: input.rows,
    columns: [
      { key: "employee_number", label: "الرقم الوظيفي", value: (r) => r.employee_number },
      { key: "full_name", label: "الاسم", value: (r) => r.full_name },
      { key: "full_name_en", label: "الاسم بالإنجليزية", value: (r) => r.full_name_en ?? null },
      {
        key: "department",
        label: "القسم",
        value: (r) => input.departmentLabel(r.department_id),
      },
      { key: "academic_rank", label: "الرتبة العلمية", value: (r) => r.academic_rank },
      {
        key: "employment_type",
        label: "نوع التعاقد",
        value: (r) => input.employmentLabel(r.employment_type),
      },
      { key: "max_weekly_hours", label: "الحد الأسبوعي للساعات", value: (r) => r.max_weekly_hours },
      {
        key: "category",
        label: "الفئة",
        value: (r) => input.categoryLabel(r.instructor_type_id ?? null),
      },
      { key: "is_active", label: "مفعّل", value: (r) => r.is_active },
      { key: "needs_review", label: "يحتاج مراجعة", value: (r) => r.needs_review ?? false },
    ],
  };
}

/* ------------------------------- courses --------------------------------- */

export type CourseExportRow = {
  code: string;
  name: string;
  department_id: string | null;
  credit_hours: number | null;
  theory_hours: number | null;
  practical_hours: number | null;
  course_nature?: string | null;
  is_shared?: boolean | null;
};

export function coursesExportDataset(input: {
  rows: CourseExportRow[];
  collegeName?: string | null;
  departmentLabel: LabelLookup;
  natureLabel?: LabelLookup;
  filters?: AdminExportFilter[];
  fileBase?: string;
}): AdminExportDataset<CourseExportRow> {
  const nature = input.natureLabel ?? ((v) => v ?? "");
  return {
    fileBase: input.fileBase ?? "courses",
    title: "المقررات",
    sheetName: "المقررات",
    collegeName: input.collegeName ?? null,
    filters: input.filters ?? [],
    rows: input.rows,
    columns: [
      { key: "code", label: "الرمز", value: (r) => r.code },
      { key: "name", label: "الاسم", value: (r) => r.name },
      { key: "department", label: "القسم", value: (r) => input.departmentLabel(r.department_id) },
      { key: "credit_hours", label: "الساعات المعتمدة", value: (r) => r.credit_hours },
      { key: "theory_hours", label: "نظري", value: (r) => r.theory_hours },
      { key: "practical_hours", label: "عملي", value: (r) => r.practical_hours },
      { key: "course_nature", label: "طبيعة المقرر", value: (r) => nature(r.course_nature) },
      { key: "is_shared", label: "مشترك", value: (r) => r.is_shared ?? false },
    ],
  };
}

/* -------------------------- teaching assignments ------------------------- */

export type TeachingAssignmentExportRow = {
  course_code: string;
  course_name: string;
  component_type: string;
  group_number: number | null;
  group_code: string;
  cohort_code?: string | null;
  expected_students: number;
  capacity_limit: number | null;
  component_hours: number | null;
  assigned_hours_total: number;
  remaining_hours: number;
  allocation_status: string;
  active: boolean;
  is_obsolete: boolean;
  instructors: Array<{ instructor_name?: string | null }>;
};

export function teachingAssignmentsExportDataset(input: {
  rows: TeachingAssignmentExportRow[];
  collegeName?: string | null;
  componentLabel: LabelLookup;
  allocationLabel: LabelLookup;
  filters?: AdminExportFilter[];
}): AdminExportDataset<TeachingAssignmentExportRow> {
  return {
    fileBase: "teaching-assignments",
    title: "الإسناد التدريسي",
    sheetName: "الإسناد التدريسي",
    collegeName: input.collegeName ?? null,
    filters: input.filters ?? [],
    rows: input.rows,
    columns: [
      { key: "course_code", label: "رمز المقرر", value: (r) => r.course_code },
      { key: "course_name", label: "اسم المقرر", value: (r) => r.course_name },
      {
        key: "component_type",
        label: "نوع المكوّن",
        value: (r) => input.componentLabel(r.component_type),
      },
      { key: "group", label: "المجموعة", value: (r) => r.group_number ?? r.group_code },
      { key: "cohort", label: "الدفعة", value: (r) => r.cohort_code ?? null },
      { key: "expected_students", label: "طلاب متوقع", value: (r) => r.expected_students },
      { key: "capacity_limit", label: "السعة", value: (r) => r.capacity_limit },
      {
        key: "instructors",
        label: "المحاضرون",
        value: (r) =>
          r.instructors
            .map((i) => i.instructor_name ?? "")
            .filter(Boolean)
            .join("، "),
      },
      { key: "component_hours", label: "ساعات المكوّن", value: (r) => r.component_hours },
      { key: "assigned_hours_total", label: "ساعات مسندة", value: (r) => r.assigned_hours_total },
      { key: "remaining_hours", label: "ساعات متبقية", value: (r) => r.remaining_hours },
      {
        key: "allocation_status",
        label: "حالة الإسناد",
        value: (r) => input.allocationLabel(r.allocation_status),
      },
      {
        key: "state",
        label: "حالة المجموعة",
        value: (r) => (r.is_obsolete ? "obsolete" : r.active ? "نشطة" : "غير نشطة"),
      },
    ],
  };
}

/* ------------------------------ study plans ------------------------------ */

export type StudyPlanExportRow = {
  name: string;
  code: string;
  version: string;
  program_id: string;
  effective_year: number | null;
  is_active: boolean;
};

export function studyPlansExportDataset(input: {
  rows: StudyPlanExportRow[];
  collegeName?: string | null;
  programLabel: LabelLookup;
  programDepartmentLabel: LabelLookup;
  filters?: AdminExportFilter[];
}): AdminExportDataset<StudyPlanExportRow> {
  return {
    fileBase: "study-plans",
    title: "الخطط الدراسية",
    sheetName: "الخطط الدراسية",
    collegeName: input.collegeName ?? null,
    filters: input.filters ?? [],
    rows: input.rows,
    columns: [
      { key: "name", label: "الاسم", value: (r) => r.name },
      { key: "code", label: "الرمز", value: (r) => r.code },
      { key: "version", label: "الإصدار", value: (r) => r.version },
      { key: "program", label: "البرنامج", value: (r) => input.programLabel(r.program_id) },
      {
        key: "department",
        label: "القسم",
        value: (r) => input.programDepartmentLabel(r.program_id),
      },
      { key: "effective_year", label: "سنة السريان", value: (r) => r.effective_year },
      { key: "is_active", label: "سارية", value: (r) => r.is_active },
    ],
  };
}

/* --------------------------- plan contents ------------------------------- */

export type PlanContentExportRow = {
  course_code: string;
  course_name: string;
  level_name: string | null;
  semester: number;
  is_required: boolean;
  component_type: string | null;
  weekly_contact_hours: number | null;
  room_type_name: string | null;
  is_timetabled: boolean | null;
  counts_toward_regular_load: boolean | null;
  counts_toward_overtime: boolean | null;
  compensation_mode: string | null;
  explicit_group_size: number | null;
  lectures_per_week: number | null;
  lecture_session_duration: number | null;
  labs_per_week: number | null;
  lab_session_duration: number | null;
};

export function planContentsExportDataset(input: {
  rows: PlanContentExportRow[];
  planName: string;
  collegeName?: string | null;
  componentLabel: LabelLookup;
  compensationLabel: LabelLookup;
  filters?: AdminExportFilter[];
}): AdminExportDataset<PlanContentExportRow> {
  return {
    fileBase: "plan-contents",
    title: `محتويات الخطة — ${input.planName}`,
    sheetName: "محتويات الخطة",
    collegeName: input.collegeName ?? null,
    scopeNote: `الخطة: ${input.planName}`,
    filters: input.filters ?? [{ label: "الخطة الدراسية", value: input.planName }],
    rows: input.rows,
    columns: [
      { key: "course_code", label: "رمز المقرر", value: (r) => r.course_code },
      { key: "course_name", label: "اسم المقرر", value: (r) => r.course_name },
      { key: "level_name", label: "المستوى", value: (r) => r.level_name },
      { key: "semester", label: "الفصل", value: (r) => r.semester },
      { key: "is_required", label: "إلزامي", value: (r) => r.is_required },
      {
        key: "component_type",
        label: "نوع المكوّن",
        value: (r) => (r.component_type ? input.componentLabel(r.component_type) : null),
      },
      { key: "weekly_contact_hours", label: "ساعات أسبوعية", value: (r) => r.weekly_contact_hours },
      { key: "room_type_name", label: "نوع القاعة المطلوبة", value: (r) => r.room_type_name },
      { key: "is_timetabled", label: "مجدول", value: (r) => r.is_timetabled },
      {
        key: "counts_toward_regular_load",
        label: "يُحسب في النصاب",
        value: (r) => r.counts_toward_regular_load,
      },
      {
        key: "counts_toward_overtime",
        label: "يُحسب في الإضافي",
        value: (r) => r.counts_toward_overtime,
      },
      {
        key: "compensation_mode",
        label: "نمط الاحتساب",
        value: (r) => (r.compensation_mode ? input.compensationLabel(r.compensation_mode) : null),
      },
      {
        key: "explicit_group_size",
        label: "حجم المجموعة المحدد",
        value: (r) => r.explicit_group_size,
      },
      { key: "lectures_per_week", label: "محاضرات/أسبوع", value: (r) => r.lectures_per_week },
      {
        key: "lecture_session_duration",
        label: "مدة المحاضرة",
        value: (r) => r.lecture_session_duration,
      },
      { key: "labs_per_week", label: "معامل/أسبوع", value: (r) => r.labs_per_week },
      { key: "lab_session_duration", label: "مدة المعمل", value: (r) => r.lab_session_duration },
    ],
  };
}

/* ------------------------------- cohorts --------------------------------- */

export type CohortExportRow = {
  code: string | null;
  programName: string;
  levelName: string;
  termName: string;
  study_system: string;
  entry_year: number;
  expected_students: number;
  count_status: string;
  active: boolean;
};

export function cohortsExportDataset(input: {
  rows: CohortExportRow[];
  collegeName?: string | null;
  systemLabel: LabelLookup;
  countStatusLabel: LabelLookup;
  filters?: AdminExportFilter[];
}): AdminExportDataset<CohortExportRow> {
  return {
    fileBase: "cohorts",
    title: "الدفعات الدراسية",
    sheetName: "الدفعات",
    collegeName: input.collegeName ?? null,
    scopeNote: "جميع النتائج المطابقة للفلاتر، وليس الصفحة المعروضة فقط",
    filters: input.filters ?? [],
    rows: input.rows,
    columns: [
      { key: "code", label: "رمز الدفعة", value: (r) => r.code },
      { key: "programName", label: "البرنامج", value: (r) => r.programName },
      { key: "levelName", label: "المستوى", value: (r) => r.levelName },
      { key: "termName", label: "الفصل", value: (r) => r.termName },
      {
        key: "study_system",
        label: "نظام الدراسة",
        value: (r) => input.systemLabel(r.study_system),
      },
      { key: "entry_year", label: "سنة القبول", value: (r) => r.entry_year },
      { key: "expected_students", label: "عدد الطلاب المتوقع", value: (r) => r.expected_students },
      {
        key: "count_status",
        label: "حالة العدد",
        value: (r) => input.countStatusLabel(r.count_status),
      },
      { key: "active", label: "نشطة", value: (r) => r.active },
    ],
  };
}

/* ----------------------------- headcounts -------------------------------- */

export type HeadcountExportRow = {
  cohort_id: string;
  term_id: string;
  study_system: string;
  registered_student_count: number;
  eligible_student_count: number;
  expected_attendance_count: number;
  reserve_margin: number;
  scheduling_headcount: number;
  exam_eligible_count: number;
  approval_status: string;
  source: string;
  notes: string | null;
  approved_at: string | null;
};

export function headcountsExportDataset(input: {
  rows: HeadcountExportRow[];
  collegeName?: string | null;
  cohortLabel: LabelLookup;
  termLabel: LabelLookup;
  systemLabel: LabelLookup;
  filters?: AdminExportFilter[];
}): AdminExportDataset<HeadcountExportRow> {
  return {
    fileBase: "scheduling-headcounts",
    title: "أعداد الدفعات المعتمدة للجدولة",
    sheetName: "أعداد الطلاب",
    collegeName: input.collegeName ?? null,
    filters: input.filters ?? [],
    rows: input.rows,
    columns: [
      { key: "cohort", label: "الدفعة", value: (r) => input.cohortLabel(r.cohort_id) },
      { key: "term", label: "الفصل", value: (r) => input.termLabel(r.term_id) },
      {
        key: "study_system",
        label: "نظام الدراسة",
        value: (r) => input.systemLabel(r.study_system),
      },
      { key: "registered", label: "مسجل", value: (r) => r.registered_student_count },
      { key: "eligible", label: "مؤهل", value: (r) => r.eligible_student_count },
      { key: "attendance", label: "حضور متوقع", value: (r) => r.expected_attendance_count },
      { key: "reserve_margin", label: "هامش احتياطي", value: (r) => r.reserve_margin },
      { key: "scheduling", label: "عدد الجدولة", value: (r) => r.scheduling_headcount },
      { key: "exam_eligible", label: "مؤهل للامتحان", value: (r) => r.exam_eligible_count },
      { key: "approval_status", label: "حالة الاعتماد", value: (r) => r.approval_status },
      { key: "source", label: "المصدر", value: (r) => r.source },
      { key: "approved_at", label: "تاريخ الاعتماد", value: (r) => r.approved_at },
      { key: "notes", label: "ملاحظات", value: (r) => r.notes },
    ],
  };
}

/* --------------------------- delivery groups ----------------------------- */

export type DeliveryGroupExportRow = {
  group_code: string;
  group_number?: number | null;
  component_type: string | null;
  expected_students: number;
  capacity_limit: number | null;
  is_obsolete?: boolean | null;
  excluded_from_workload: boolean;
  assigned: boolean;
};

export function deliveryGroupsExportDataset(input: {
  rows: DeliveryGroupExportRow[];
  collegeName?: string | null;
  componentLabel: LabelLookup;
  filters?: AdminExportFilter[];
}): AdminExportDataset<DeliveryGroupExportRow> {
  return {
    fileBase: "delivery-groups",
    title: "مجموعات المحاضرات والمعامل",
    sheetName: "المجموعات",
    collegeName: input.collegeName ?? null,
    filters: input.filters ?? [],
    rows: input.rows,
    columns: [
      {
        key: "component_type",
        label: "نوع المكوّن",
        value: (r) => (r.component_type ? input.componentLabel(r.component_type) : null),
      },
      { key: "group", label: "رقم المجموعة", value: (r) => r.group_number ?? r.group_code },
      { key: "expected_students", label: "طلاب متوقع", value: (r) => r.expected_students },
      { key: "capacity_limit", label: "السعة", value: (r) => r.capacity_limit },
      { key: "state", label: "الحالة", value: (r) => (r.is_obsolete ? "obsolete" : "نشطة") },
      { key: "excluded", label: "خارج النصاب", value: (r) => r.excluded_from_workload },
      { key: "assigned", label: "حالة الإسناد", value: (r) => (r.assigned ? "مسند" : "غير مسند") },
    ],
  };
}
