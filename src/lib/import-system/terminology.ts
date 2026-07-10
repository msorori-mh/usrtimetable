import type { CanonicalImportDataType, ImportLabels } from "./contracts";

/** Central Arabic/English labels for all 15 canonical import types */
export const TERMINOLOGY: Readonly<Record<CanonicalImportDataType, ImportLabels>> = {
  academic_terms: { ar: "الفترات الأكاديمية", en: "Academic Terms" },
  departments: { ar: "الأقسام", en: "Departments" },
  academic_programs: { ar: "البرامج", en: "Academic Programs" },
  study_plan_rows: { ar: "مقررات الخطة الدراسية", en: "Study Plan Rows" },
  course_programs: { ar: "ربط المقررات بالبرامج", en: "Course Programs" },
  instructors: { ar: "أعضاء هيئة التدريس", en: "Instructors" },
  rooms: { ar: "القاعات والمعامل", en: "Rooms" },
  instructor_availability: { ar: "توفّر المحاضرين", en: "Instructor Availability" },
  room_availability: { ar: "توفّر القاعات", en: "Room Availability" },
  time_slot_templates: { ar: "قوالب الفترات الزمنية", en: "Time Slot Templates" },
  daily_breaks: { ar: "الاستراحات اليومية", en: "Daily Breaks" },
  course_offerings: { ar: "عروض المقررات", en: "Course Offerings" },
  sections: { ar: "الشعب الدراسية", en: "Sections" },
  teaching_assignments: { ar: "التكليفات التدريسية", en: "Teaching Assignments" },
  section_groups: { ar: "مجموعات الشعب المدمجة", en: "Merged Section Groups" },
} as const;

/** Deprecated label index — legacy UI strings superseded by canonical terminology */
export const DEPRECATED_LABEL_INDEX: Readonly<Record<string, readonly string[]>> = {
  academic_terms: ["الفصول الدراسية"],
  sections: ["المجموعات الدراسية", "الفصول"],
  section_groups: ["المجموعات المدمجة"],
  rooms: ["قاعات فقط", "معامل"],
  course_offerings: ["إسناد المقررات", "مقررات الفصل"],
  teaching_assignments: ["الإسناد التدريسي"],
  study_plan_rows: ["خطة دراسية كاملة", "plan_courses"],
  instructors: ["المحاضرون"],
} as const;

export function getLabelAr(dataType: CanonicalImportDataType): string {
  return TERMINOLOGY[dataType].ar;
}
