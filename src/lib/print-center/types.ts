/** Pure types for timetable print/export center (no React). */

export type PrintReportType =
  | "student"
  | "department"
  | "program"
  | "instructor"
  | "room"
  | "level";

export type PrintStudySystem = "regular" | "parallel" | "all";

export type PrintPaperSize = "A4" | "A3";
export type PrintOrientation = "landscape" | "portrait";

export interface PrintVisibilityOptions {
  showUniversityLogo: boolean;
  showCollege: boolean;
  showDepartment: boolean;
  showProgram: boolean;
  showLevel: boolean;
  showStudySystem: boolean;
  showInstructor: boolean;
  showRoom: boolean;
  showQr: boolean;
  showExportDate: boolean;
  showVersionStatus: boolean;
  showVersionNumber: boolean;
}

export const DEFAULT_PRINT_VISIBILITY: PrintVisibilityOptions = {
  showUniversityLogo: true,
  showCollege: true,
  showDepartment: true,
  showProgram: true,
  showLevel: true,
  showStudySystem: true,
  showInstructor: true,
  showRoom: true,
  showQr: true,
  showExportDate: true,
  showVersionStatus: true,
  showVersionNumber: true,
};

export interface PrintCenterFilters {
  reportType: PrintReportType;
  /** Active college — sessions with a different college_id are rejected. */
  collegeId: string;
  programId?: string | null;
  levelId?: string | null;
  studySystem?: PrintStudySystem | null;
  departmentId?: string | null;
  instructorId?: string | null;
  roomId?: string | null;
  cohortId?: string | null;
  deliveryGroupId?: string | null;
}

/** Minimal session shape for pure filter/group/export helpers. */
export interface PrintSessionLike {
  /** Preserve separate existing pathways under a common academic program. */
  intake_study_plan_id?: string;
  id: string;
  college_id?: string | null;
  day_of_week: number;
  start_time: string;
  end_time: string;
  session_type?: string | null;
  study_system?: string | null;
  instructor_id?: string | null;
  room_id?: string | null;
  cohort_id?: string | null;
  shared_cohort_ids?: string[];
  delivery_group_id?: string | null;
  /** Current headcount stored on this scheduled session. */
  expected_students?: number | null;
  updated_at?: string | null;
  course_offerings?: {
    course_id?: string | null;
    program_id?: string | null;
    level_id?: string | null;
    courses?: {
      name?: string | null;
      code?: string | null;
      department_id?: string | null;
      departments?: { name?: string | null } | null;
    } | null;
    academic_programs?: { name?: string | null } | null;
    academic_levels?: {
      name?: string | null;
      level_number?: number | null;
    } | null;
  } | null;
  instructors?: { full_name?: string | null } | null;
  rooms?: { code?: string | null; name?: string | null } | null;
}

export interface PrintPageGroup {
  key: string;
  title: string;
  programName?: string;
  levelName?: string;
  studySystem?: PrintStudySystem | "both" | string;
  departmentName?: string;
  instructorName?: string;
  roomLabel?: string;
  sessions: PrintSessionLike[];
}

export interface PrintExportRow {
  day: string;
  time: string;
  course_code: string;
  course_name: string;
  component: string;
  instructor: string;
  room: string;
  group: string;
  program?: string;
  level?: string;
  study_system?: string;
  department?: string;
  page?: string;
}

export const PRINT_EXPORT_HEADERS: {
  key: keyof PrintExportRow;
  label: string;
}[] = [
  { key: "day", label: "اليوم" },
  { key: "time", label: "الوقت" },
  { key: "course_name", label: "اسم المقرر" },
  { key: "component", label: "المحاضرة" },
  { key: "instructor", label: "المدرس" },
  { key: "room", label: "القاعة" },
  { key: "group", label: "المجموعة" },
];

export const REPORT_TYPE_LABELS_AR: Record<PrintReportType, string> = {
  student: "جدول الطلاب",
  department: "جدول القسم",
  program: "جدول البرنامج",
  instructor: "جدول المدرس",
  room: "جدول القاعة",
  level: "جدول المستوى",
};

/** Footer demo warning (Phase 1 print center copy). */
export const PRINT_DEMO_FOOTER_WARNING_AR =
  "نسخة تسليم تجريبية — بيانات افتراضية — غير صالحة للاستخدام الأكاديمي التشغيلي.";

export const PRINT_PUBLISHED_ENDORSEMENT_AR =
  "اعتماد رسمي وفق آخر نسخة منشورة في المنصة — للقراءة والطباعة فقط.";

export const PRINT_DRAFT_WATERMARK_AR = "مسودة — غير معتمدة للنشر";

/**
 * LOGICAL schedule-group numbering shown in the in-flow footer. It is deliberately NOT
 * worded as "صفحة", because one group can span several physical sheets; the physical page
 * number comes from the `@page` margin box (see print-center/page-style.ts).
 */
export function printGroupCounterLabelAr(
  groupIndex: number,
  groupCount: number,
): string {
  return `مجموعة الجدول ${groupIndex} من ${groupCount}`;
}
