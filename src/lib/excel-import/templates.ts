import type { TemplateDef } from "./types";
import { COURSE_NATURE_VALUES } from "./course-nature";
import { escapeSpreadsheetCell } from "./formula-escape";
import { IMPORT_CONTRACT_VERSION, PILOT_STUDY_SYSTEMS, TA_V2_COMPONENT_TYPES } from "./registry";
import { EMPLOYMENT_TYPE_IMPORT_VALUES } from "../instructor-metadata";
import { instructorStatusLabel, parseInstructorSheet } from "./instructor-sheet";

export const TEMPLATES: Record<string, TemplateDef> = {
  instructors: {
    entity: "instructors",
    label: "المحاضرون",
    sheetName: "instructors",
    uniqueKey: "employee_number",
    uniqueKeyLabel: "رقم الموظف",
    commitMode: "table",
    columns: [
      { key: "full_name", header: "اسم المدرس", required: true, example: "أحمد محمد" },
      { key: "specialization", header: "القسم (التخصص)", example: "علوم الحاسوب" },
      { key: "max_weekly_hours", header: "النصاب الأسبوعي (ساعة)", type: "number", example: "12" },
      { key: "academic_rank", header: "الرتبة الأكاديمية", example: "أستاذ مساعد" },
      { key: "admin_tasks", header: "الصفة", example: "عضو هيئة تدريس" },
      { key: "is_active", header: "الحالة", type: "boolean", example: "نشط" },
      { key: "employee_number", header: "رقم_الموظف", required: true, example: "EMP001" },
      { key: "full_name_ar", header: "الاسم_بالعربي", example: "أحمد محمد" },
      { key: "full_name_en", header: "الاسم_بالانجليزي", example: "Ahmed Mohamed" },
      { key: "email", header: "البريد_الالكتروني", example: "a@x.com" },
      { key: "phone", header: "الهاتف", example: "0555555555" },
      { key: "academic_degree", header: "الدرجة_العلمية", example: "دكتوراه" },
      { key: "instructor_type_code", header: "نوع_المحاضر_رمز", example: "PERM" },
      { key: "department_code", header: "رمز_القسم", example: "CS" },
      {
        key: "employment_type",
        header: "نوع_التوظيف",
        example: "unknown",
        enumValues: [...EMPLOYMENT_TYPE_IMPORT_VALUES],
      },
      { key: "max_hours_per_day", header: "أقصى_ساعات_يومية", type: "number", example: "6" },
      {
        key: "administrative_release_hours",
        header: "ساعات_إعفاء_إداري",
        type: "number",
        example: "0",
      },
      { key: "external_source", header: "الجهة_الخارجية" },
      { key: "notes", header: "ملاحظات" },
    ],
  },
  rooms: {
    entity: "rooms",
    label: "القاعات والمعامل",
    sheetName: "rooms",
    uniqueKey: "code",
    uniqueKeyLabel: "رمز القاعة",
    commitMode: "table",
    columns: [
      { key: "code", header: "رمز_القاعة", required: true, example: "R-101" },
      { key: "name", header: "اسم_القاعة", required: true, example: "قاعة 101" },
      { key: "capacity", header: "السعة", required: true, type: "number", example: "30" },
      {
        key: "room_type",
        header: "نوع_القاعة",
        required: true,
        example: "lecture_hall",
        enumValues: [
          "lecture_hall",
          "computer_lab",
          "network_lab",
          "cybersecurity_lab",
          "electronics_lab",
          "workshop",
          "seminar_room",
        ],
      },
      // Optional legacy compatibility — not a competing source of truth
      { key: "room_type_code", header: "نوع_القاعة_رمز", example: "" },
      { key: "building_code", header: "رمز_المبنى", example: "A" },
      { key: "floor", header: "الطابق", example: "1" },
      { key: "building", header: "المبنى_نص" },
      { key: "available_start_time", header: "متاح_من", type: "time", example: "08:00" },
      { key: "available_end_time", header: "متاح_إلى", type: "time", example: "14:00" },
      { key: "notes", header: "ملاحظات" },
      { key: "is_active", header: "نشط", type: "boolean", example: "true" },
    ],
  },
  academic_terms: {
    entity: "academic_terms",
    label: "الفصول الأكاديمية",
    sheetName: "terms",
    uniqueKey: "code",
    uniqueKeyLabel: "رمز الفصل",
    commitMode: "table",
    columns: [
      { key: "code", header: "الرمز", required: true, example: "2025-F" },
      { key: "name", header: "الاسم", required: true, example: "الفصل الأكاديمي الأول 2025" },
      { key: "academic_year", header: "السنة_الأكاديمية", example: "2025-2026" },
      {
        key: "term_type",
        header: "الفصل_الدراسي",
        enumValues: ["first", "second"],
        example: "first",
      },
      { key: "start_date", header: "تاريخ_البداية", example: "2025-09-01" },
      { key: "end_date", header: "تاريخ_النهاية", example: "2026-01-15" },
      { key: "teaching_weeks_count", header: "عدد_أسابيع_التدريس", type: "number", example: "15" },
      { key: "is_active", header: "نشط", type: "boolean", example: "false" },
    ],
  },
  daily_breaks: {
    entity: "daily_breaks",
    label: "الاستراحات اليومية",
    sheetName: "daily_breaks",
    uniqueKey: "name",
    uniqueKeyLabel: "الاسم",
    commitMode: "table",
    columns: [
      { key: "name", header: "الاسم", required: true, example: "استراحة الظهر" },
      { key: "start_time", header: "من_الساعة", required: true, type: "time", example: "12:00" },
      { key: "end_time", header: "إلى_الساعة", required: true, type: "time", example: "12:30" },
      { key: "days", header: "الأيام", type: "days_csv", example: "0,1,2,3,4", required: true },
      { key: "affects_scheduling", header: "يؤثر_على_الجدولة", type: "boolean", example: "true" },
    ],
  },

  sections: {
    entity: "sections",
    label: "المجموعات الدراسية",
    sheetName: "sections",
    uniqueKey: "_logical",
    uniqueKeyLabel: "فصل + مقرر + رقم المجموعة + نظام الدراسة",
    commitMode: "custom",
    columns: [
      { key: "term_code", header: "رمز_الفصل", required: true, example: "2025-F" },
      { key: "course_code", header: "رمز_المقرر", required: true, example: "CS101" },
      { key: "section_number", header: "رقم_المجموعة", required: true, example: "1" },
      { key: "capacity", header: "السعة_القصوى", type: "number", example: "30" },
      {
        key: "study_system",
        header: "نظام_الدراسة",
        example: "regular",
        enumValues: ["regular", "parallel", "both"],
      },
    ],
  },

  // ============== Phase 5B ==============

  study_plan_courses: {
    entity: "study_plan_courses",
    label: "خطة دراسية (مستوى/فصل)",
    sheetName: "plan_courses",
    uniqueKey: "_logical",
    uniqueKeyLabel: "خطة + رمز مقرر",
    commitMode: "custom",
    columns: [
      { key: "program_code", header: "رمز_البرنامج", required: true, example: "CS" },
      { key: "plan_code", header: "رمز_الخطة", required: true, example: "CS-2024" },
      { key: "plan_name", header: "اسم_الخطة", example: "خطة علوم الحاسب 2024" },
      { key: "plan_version", header: "نسخة_الخطة", example: "1" },
      { key: "effective_year", header: "سنة_السريان", type: "number", example: "2024" },
      { key: "level_number", header: "رقم_المستوى", type: "number", required: true, example: "1" },
      { key: "semester", header: "الفصل", type: "number", required: true, example: "1" },
      { key: "department_code", header: "رمز_القسم", required: true, example: "CS" },
      { key: "course_code", header: "رمز_المقرر", required: true, example: "CS101" },
      { key: "course_name", header: "اسم_المقرر", required: true, example: "مقدمة في الحاسب" },
      {
        key: "credit_hours",
        header: "الساعات_المعتمدة",
        type: "number",
        required: true,
        example: "3",
      },
      { key: "theory_hours", header: "ساعات_نظري", type: "number", example: "2" },
      { key: "practical_hours", header: "ساعات_عملي", type: "number", example: "2" },
      { key: "tutorial_hours", header: "ساعات_تمرين", type: "number", example: "0" },
      { key: "project_hours", header: "ساعات_مشروع", type: "number", example: "0" },
      { key: "is_elective_slot", header: "خانة_اختيارية", type: "boolean", example: "false" },
      { key: "elective_slot_code", header: "رمز_الخانة_الاختيارية", example: "" },
      { key: "is_summer_training", header: "تدريب_صيفي", type: "boolean", example: "false" },
      { key: "is_graduation_project", header: "مشروع_تخرج", type: "boolean", example: "false" },
      {
        key: "course_nature",
        header: "طبيعة_المقرر",
        enumValues: COURSE_NATURE_VALUES,
        example: "department",
      },
      { key: "is_shared", header: "مشترك", type: "boolean", example: "false" },
      { key: "is_required", header: "إجباري", type: "boolean", example: "true" },
      { key: "lectures_per_week", header: "عدد_المحاضرات_أسبوعياً", type: "number", example: "1" },
      { key: "lecture_session_duration", header: "مدة_المحاضرة", type: "number", example: "2" },
      { key: "labs_per_week", header: "عدد_المعامل_أسبوعياً", type: "number", example: "1" },
      { key: "lab_session_duration", header: "مدة_المعمل", type: "number", example: "2" },
      {
        key: "required_room_type_code_lecture",
        header: "رمز_نوع_قاعة_المحاضرة",
        example: "lecture_hall",
      },
      {
        key: "required_room_type_code_practical",
        header: "رمز_نوع_قاعة_المعمل",
        example: "computer_lab",
      },
      {
        key: "required_room_type_code_tutorial",
        header: "رمز_نوع_قاعة_التمرين",
        example: "lecture_hall",
      },
      {
        key: "required_room_type_code_project",
        header: "رمز_نوع_قاعة_المشروع",
        example: "seminar_room",
      },
      {
        key: "_legacy_required_room_type_code_lecture",
        header: "نوع_قاعة_المحاضرة",
        example: "lecture_hall",
      },
      {
        key: "_legacy_required_room_type_code_practical",
        header: "نوع_قاعة_المعمل",
        example: "computer_lab",
      },
    ],
  },

  full_study_plan: {
    entity: "full_study_plan",
    label: "خطة دراسية كاملة (كل المستويات)",
    sheetName: "full_plan",
    uniqueKey: "_logical",
    uniqueKeyLabel: "خطة + رمز مقرر",
    commitMode: "custom",
    // identical columns — same processor; the label clarifies intended use
    columns: [
      { key: "program_code", header: "رمز_البرنامج", required: true, example: "CS" },
      { key: "plan_code", header: "رمز_الخطة", required: true, example: "CS-2024" },
      { key: "plan_name", header: "اسم_الخطة", example: "خطة علوم الحاسب 2024" },
      { key: "plan_version", header: "نسخة_الخطة", example: "1" },
      { key: "effective_year", header: "سنة_السريان", type: "number", example: "2024" },
      { key: "level_number", header: "رقم_المستوى", type: "number", required: true, example: "1" },
      { key: "semester", header: "الفصل", type: "number", required: true, example: "1" },
      { key: "department_code", header: "رمز_القسم", required: true, example: "CS" },
      { key: "course_code", header: "رمز_المقرر", required: true, example: "CS101" },
      { key: "course_name", header: "اسم_المقرر", required: true, example: "مقدمة في الحاسب" },
      {
        key: "credit_hours",
        header: "الساعات_المعتمدة",
        type: "number",
        required: true,
        example: "3",
      },
      { key: "theory_hours", header: "ساعات_نظري", type: "number", example: "2" },
      { key: "practical_hours", header: "ساعات_عملي", type: "number", example: "2" },
      { key: "tutorial_hours", header: "ساعات_تمرين", type: "number", example: "0" },
      { key: "project_hours", header: "ساعات_مشروع", type: "number", example: "0" },
      { key: "is_elective_slot", header: "خانة_اختيارية", type: "boolean", example: "false" },
      { key: "elective_slot_code", header: "رمز_الخانة_الاختيارية", example: "CY3XX(E)" },
      { key: "is_summer_training", header: "تدريب_صيفي", type: "boolean", example: "false" },
      { key: "is_graduation_project", header: "مشروع_تخرج", type: "boolean", example: "false" },
      {
        key: "course_nature",
        header: "طبيعة_المقرر",
        enumValues: COURSE_NATURE_VALUES,
        example: "department",
      },
      { key: "is_shared", header: "مشترك", type: "boolean", example: "false" },
      { key: "is_required", header: "إجباري", type: "boolean", example: "true" },
      { key: "lectures_per_week", header: "عدد_المحاضرات_أسبوعياً", type: "number", example: "1" },
      { key: "lecture_session_duration", header: "مدة_المحاضرة", type: "number", example: "2" },
      { key: "labs_per_week", header: "عدد_المعامل_أسبوعياً", type: "number", example: "1" },
      { key: "lab_session_duration", header: "مدة_المعمل", type: "number", example: "2" },
      {
        key: "required_room_type_code_lecture",
        header: "رمز_نوع_قاعة_المحاضرة",
        example: "lecture_hall",
      },
      {
        key: "required_room_type_code_practical",
        header: "رمز_نوع_قاعة_المعمل",
        example: "computer_lab",
      },
      {
        key: "required_room_type_code_tutorial",
        header: "رمز_نوع_قاعة_التمرين",
        example: "lecture_hall",
      },
      {
        key: "required_room_type_code_project",
        header: "رمز_نوع_قاعة_المشروع",
        example: "seminar_room",
      },
      {
        key: "_legacy_required_room_type_code_lecture",
        header: "نوع_قاعة_المحاضرة",
        example: "lecture_hall",
      },
      {
        key: "_legacy_required_room_type_code_practical",
        header: "نوع_قاعة_المعمل",
        example: "computer_lab",
      },
    ],
  },

  course_offerings: {
    entity: "course_offerings",
    label: "إسناد المقررات",
    sheetName: "offerings",
    uniqueKey: "_logical",
    uniqueKeyLabel: "فصل + برنامج + مقرر",
    commitMode: "custom",
    columns: [
      { key: "term_code", header: "رمز_الفصل", required: true, example: "2025-F" },
      { key: "course_code", header: "رمز_المقرر", required: true, example: "CS101" },
      { key: "program_code", header: "رمز_البرنامج", example: "CS" },
      { key: "level_number", header: "رقم_المستوى", type: "number", example: "1" },
      { key: "plan_code", header: "رمز_الخطة", example: "CS-2024" },
      { key: "expected_students", header: "الطلاب_المتوقعون", type: "number", example: "60" },
      { key: "sections_count", header: "عدد_المجموعات", type: "number", example: "2" },
      {
        key: "status",
        header: "الحالة",
        enumValues: ["draft", "approved", "scheduled", "cancelled"],
        example: "draft",
      },
      { key: "is_active", header: "نشط", type: "boolean", example: "true" },
      { key: "notes", header: "ملاحظات" },
    ],
  },

  teaching_assignments: {
    entity: "teaching_assignments",
    label: "الإسناد التدريسي",
    sheetName: "assignments",
    uniqueKey: "_logical",
    uniqueKeyLabel: "محاضر + طرح + نوع محاضرة",
    commitMode: "custom",
    columns: [
      { key: "term_code", header: "رمز_الفصل", required: true, example: "2025-F" },
      { key: "course_code", header: "رمز_المقرر", required: true, example: "CS101" },
      { key: "employee_number", header: "رقم_الموظف_للمحاضر", required: true, example: "EMP001" },
      { key: "section_number", header: "رقم_المجموعة", example: "1" },
      {
        key: "session_type",
        header: "نوع_المحاضرة",
        enumValues: ["lecture", "lab", "tutorial", "seminar", "workshop"],
        required: true,
        example: "lecture",
      },
      { key: "weekly_hours", header: "ساعات_أسبوعية", type: "number", example: "3" },
      { key: "expected_students", header: "الطلاب_المتوقعون", type: "number", example: "30" },
      {
        key: "required_room_type",
        header: "نوع_القاعة_المطلوب",
        enumValues: [
          "lecture_hall",
          "computer_lab",
          "network_lab",
          "cybersecurity_lab",
          "electronics_lab",
          "workshop",
          "seminar_room",
        ],
      },
      { key: "notes", header: "ملاحظات" },
    ],
  },

  course_programs: {
    entity: "course_programs",
    label: "ربط المقررات بالبرامج (مقررات مشتركة)",
    sheetName: "course_programs",
    uniqueKey: "_logical",
    uniqueKeyLabel: "مقرر + برنامج",
    commitMode: "custom",
    columns: [
      { key: "course_code", header: "رمز_المقرر", required: true, example: "UNI100" },
      { key: "program_code", header: "رمز_البرنامج", required: true, example: "CS" },
    ],
  },

  section_groups: {
    entity: "section_groups",
    label: "المجموعات المدمجة",
    sheetName: "section_groups",
    uniqueKey: "_logical",
    uniqueKeyLabel: "فصل + مقرر + اسم المجموعة",
    commitMode: "custom",
    columns: [
      { key: "term_code", header: "رمز_الفصل", required: true, example: "2025-F" },
      { key: "course_code", header: "رمز_المقرر", required: true, example: "UNI100" },
      { key: "group_name", header: "اسم_المجموعة", required: true, example: "مجموعة A" },
      {
        key: "member_section_numbers",
        header: "أرقام_المجموعات",
        type: "csv",
        required: true,
        example: "1,2,3",
      },
      { key: "notes", header: "ملاحظات" },
    ],
  },

  academic_cohorts: {
    entity: "academic_cohorts",
    label: "الدفعات الأكاديمية (V2)",
    sheetName: "academic_cohorts",
    uniqueKey: "_logical",
    uniqueKeyLabel: "برنامج + مستوى + نظام + سنة دخول + فصل",
    commitMode: "custom",
    columns: [
      { key: "program_code", header: "رمز_البرنامج", required: true, example: "CS" },
      { key: "level_number", header: "رقم_المستوى", type: "number", required: true, example: "3" },
      {
        key: "study_system",
        header: "نظام_الدراسة",
        required: true,
        // Pilot official: regular | parallel (fully isolated). Schema also allows evening|distance|other.
        enumValues: [...PILOT_STUDY_SYSTEMS],
        example: "regular",
      },
      { key: "entry_year", header: "سنة_الدخول", type: "number", required: true, example: "2024" },
      { key: "term_code", header: "رمز_الفصل", required: true, example: "2026-F" },
      { key: "expected_students", header: "الطلاب_المتوقعون", type: "number", example: "60" },
      {
        key: "count_status",
        header: "حالة_العد",
        enumValues: ["estimated", "confirmed", "locked"],
        example: "estimated",
      },
      { key: "code", header: "رمز_الدفعة", example: "CS-L3-2024" },
      { key: "active", header: "نشط", type: "boolean", example: "true" },
    ],
  },

  elective_slot_courses: {
    entity: "elective_slot_courses",
    label: "مقررات الخانات الاختيارية (V2)",
    sheetName: "elective_slot_courses",
    uniqueKey: "_logical",
    uniqueKeyLabel: "خطة + خانة + مقرر",
    commitMode: "custom",
    columns: [
      { key: "program_code", header: "رمز_البرنامج", required: true, example: "CS" },
      { key: "plan_code", header: "رمز_الخطة", required: true, example: "CS-2024" },
      { key: "plan_version", header: "نسخة_الخطة", example: "1" },
      {
        key: "elective_slot_code",
        header: "رمز_الخانة_الاختيارية",
        required: true,
        example: "CY3XX(E)",
      },
      { key: "course_code", header: "رمز_المقرر", required: true, example: "CY301" },
    ],
  },

  cohort_elective_selections: {
    entity: "cohort_elective_selections",
    label: "اختيارات الدفعات الاختيارية (V2)",
    sheetName: "cohort_elective_selections",
    uniqueKey: "_logical",
    uniqueKeyLabel: "دفعة + خانة",
    commitMode: "custom",
    columns: [
      { key: "cohort_code", header: "رمز_الدفعة", required: true, example: "CS-L3-2024" },
      {
        key: "elective_slot_code",
        header: "رمز_الخانة_الاختيارية",
        required: true,
        example: "CY3XX(E)",
      },
      {
        key: "selected_course_code",
        header: "رمز_المقرر_المختار",
        required: true,
        example: "CY301",
      },
    ],
  },

  teaching_assignments_v2: {
    entity: "teaching_assignments_v2",
    label: "الإسناد التدريسي V2 (دفعة + مجموعة تدريس)",
    sheetName: "assignments_v2",
    uniqueKey: "_logical",
    uniqueKeyLabel: "دفعة + مقرر + مكوّن + مجموعة + محاضر",
    commitMode: "custom",
    columns: [
      { key: "cohort_code", header: "رمز_الدفعة", required: true, example: "CS-L3-2024" },
      { key: "course_code", header: "رمز_المقرر", required: true, example: "CS101" },
      {
        key: "component_type",
        header: "نوع_المكوّن",
        required: true,
        // summer_training exists in schema but is forbidden for weekly TA import
        enumValues: [...TA_V2_COMPONENT_TYPES],
        example: "theory",
      },
      {
        key: "delivery_group_code",
        header: "رمز_مجموعة_التقديم",
        required: true,
        example: "G1",
      },
      { key: "employee_number", header: "رقم_الموظف_للمحاضر", required: true, example: "EMP001" },
      {
        key: "assigned_component_hours",
        header: "ساعات_المكوّن_المسندة",
        type: "number",
        example: "3",
      },
      {
        key: "study_system",
        header: "نظام_الدراسة",
        enumValues: [...PILOT_STUDY_SYSTEMS],
        example: "regular",
      },
      {
        key: "is_active",
        header: "نشط",
        type: "boolean",
        example: "true",
      },
      { key: "expected_students", header: "الطلاب_المتوقعون", type: "number", example: "30" },
      {
        key: "required_room_type",
        header: "نوع_القاعة_المطلوب",
        enumValues: [
          "lecture_hall",
          "computer_lab",
          "network_lab",
          "cybersecurity_lab",
          "electronics_lab",
          "workshop",
          "seminar_room",
        ],
      },
      { key: "notes", header: "ملاحظات" },
    ],
  },
};

export async function buildTemplateWorkbook(
  entity: string,
  dataRows?: Record<string, unknown>[],
): Promise<Blob> {
  const XLSX = await import("xlsx");
  const tpl = TEMPLATES[entity];
  if (!tpl) throw new Error("قالب غير معروف");
  const headers = tpl.columns.map((c) => c.header);
  const example = tpl.columns.map((c) => escapeSpreadsheetCell(c.example ?? ""));
  const rows = dataRows?.map((row) =>
    tpl.columns.map((column) =>
      entity === "instructors" && column.key === "is_active"
        ? instructorStatusLabel(row.is_active !== false, row.notes as string | null)
        : typeof row[column.key] === "number"
          ? (row[column.key] as number)
          : escapeSpreadsheetCell(row[column.key]),
    ),
  );
  const ws = XLSX.utils.aoa_to_sheet([headers, ...(rows ?? [example])]);
  ws["!cols"] = headers.map(() => ({ wch: 22 }));

  // Excel data-validation dropdowns for columns with enumValues (best-effort via SheetJS)
  const validations: Array<{ sqref: string; formula1: string }> = [];
  tpl.columns.forEach((c, idx) => {
    if (!c.enumValues || c.enumValues.length === 0) return;
    const col = XLSX.utils.encode_col(idx);
    validations.push({
      sqref: `${col}2:${col}1000`,
      formula1: `"${c.enumValues.join(",")}"`,
    });
  });
  if (validations.length > 0) {
    (ws as Record<string, unknown>)["!dataValidation"] = validations.map((v) => ({
      type: "list",
      allowBlank: true,
      sqref: v.sqref,
      formulas: [v.formula1],
    }));
  }

  const wb = XLSX.utils.book_new();
  if (entity === "instructors") wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, tpl.sheetName);

  const generatedAt = new Date().toISOString();
  const notes: (string | number)[][] = [
    ["تعليمات الاستيراد"],
    [""],
    [`entity_key: ${tpl.entity}`],
    [`contract_version: ${IMPORT_CONTRACT_VERSION}`],
    [`generated_at: ${generatedAt}`],
    [`الكيان: ${tpl.label}`],
    [`المفتاح الفريد: ${tpl.uniqueKeyLabel}`],
    ["أسماء الأعمدة الإنجليزية (key) ثابتة — لا تعتمد على ترجمة العنوان العربي."],
    ["لا تضع علامة * في أسماء الأعمدة — يجب أن تطابق العناوين حرفياً."],
    ["التواريخ: YYYY-MM-DD · الأوقات: HH:MM · المنطقي: true/false"],
    [
      entity === "instructors"
        ? "أدخل بيانات المدرسين المعتمدة. لا تضع كلمات مرور أو صيغًا أو وحدات ماكرو."
        : "لا تستخدم formulas أو macros. لا تخزّن كلمات مرور أو بيانات تشغيلية حقيقية.",
    ],
    [""],
    ["الأعمدة:"],
    ["الحقل", "العنوان", "إلزامي", "مثال", "قيم مسموحة"],
    ...tpl.columns.map((c) => [
      c.key,
      c.header,
      c.required ? "نعم" : "لا",
      escapeSpreadsheetCell(c.example ?? ""),
      (c.enumValues ?? []).join(" | "),
    ]),
  ];
  if (entity === "instructors") {
    notes.push(
      ["القسم (التخصص)", "القسم في كشف المدرسين هو التخصص. رمز_القسم حقل اختياري للربط التنظيمي."],
      [
        "النصاب الأسبوعي (ساعة)",
        "أدخل النصاب المعتمد كما في الكشف؛ لا يُعاد تخفيضه عند الاستيراد.",
      ],
      ["الصفة", "تُحفظ صفة المدرس أو مهامه الإدارية كما وردت."],
      [
        "الحالة",
        "نشط، غير نشط، ابتعاث، إجازة مرضية. الابتعاث والإجازة غير نشطين للجدولة ويُحفظ السبب في الملاحظات.",
      ],
      [
        "رقم_الموظف",
        "إلزامي للمدرس الجديد. عند تحديث كشف بدون أرقام، تُطابق الأسماء الفريدة مع أرقام الموظفين الحالية في الكلية. م تسلسل فقط.",
      ],
      [
        "التحديث",
        "الأعمدة غير الموجودة في الكشف تحتفظ ببياناتها الحالية. راجع المعاينة قبل التأكيد.",
      ],
      ["التوافق", "يمكن رفع كشف بعنوان وصفوف تمهيدية. عناوين القوالب السابقة مقبولة أيضًا."],
    );
  }
  if (entity === "rooms") {
    notes.push(
      [""],
      ["ملاحظات أنواع القاعات"],
      ["نوع_القاعة", "إلزامي — استخدم القيم المرجعية الإنجليزية."],
      [
        "نوع_القاعة_رمز",
        "اختياري للتوافق القديم فقط (مثل LEC → lecture_hall، LAB → computer_lab).",
      ],
    );
  }
  if (entity === "teaching_assignments_v2") {
    notes.push(
      [""],
      ["قيود V2"],
      ["لا يوجد عمود section_id أو section_number في هذا القالب."],
      ["summer_training ممنوع في الإسناد الأسبوعي."],
      [
        "عند التدريس المشترك: عيّن assigned_component_hours لكل محاضر صراحةً، ويجب أن يساوي مجموعها إجمالي ساعات المكوّن؛ لا يوزّع النظام الساعات تلقائيًا.",
      ],
      ["delivery_groups تُولَّد من النظام قبل الاستيراد — لا تُستورد هنا."],
    );
  }
  if (entity === "academic_cohorts") {
    notes.push(
      [""],
      ["قيود الدفعات"],
      ["academic_cohort هي السياق الأكاديمي الأساسي — لا تستخدم الشعب (sections)."],
      ["Pilot: نظام الدراسة regular أو parallel فقط (منفصلان تمامًا)."],
      ["لا يوجد عمود plan_code — الخطة تُربط عبر منهج الدفعة المولَّد."],
    );
  }
  if (entity === "sections" || entity === "teaching_assignments" || entity === "section_groups") {
    notes.push(
      [""],
      ["تحذير Legacy"],
      ["هذا القالب للتوافق القديم فقط — لا تستخدمه في مسار التشغيل الجديد V2."],
    );
  }
  const wsNotes = XLSX.utils.aoa_to_sheet(notes);
  wsNotes["!cols"] = [{ wch: 25 }, { wch: 22 }, { wch: 10 }, { wch: 20 }, { wch: 50 }];
  XLSX.utils.book_append_sheet(wb, wsNotes, "تعليمات");

  const meta = [
    ["key", "value"],
    ["entity_key", tpl.entity],
    ["contract_version", IMPORT_CONTRACT_VERSION],
    ["generated_at", generatedAt],
    ["sheet_data", tpl.sheetName],
    ["unique_key_label", tpl.uniqueKeyLabel],
  ];
  const wsMeta = XLSX.utils.aoa_to_sheet(meta);
  wsMeta["!cols"] = [{ wch: 22 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, wsMeta, "Metadata");

  if (entity === "rooms") {
    const ref = [
      ["الرمز", "الوصف", "رموز قديمة مقبولة"],
      ["lecture_hall", "قاعة محاضرات", "LEC"],
      ["computer_lab", "معمل حاسوب", "LAB"],
      ["network_lab", "معمل شبكات", ""],
      ["cybersecurity_lab", "معمل أمن سيبراني", ""],
      ["electronics_lab", "معمل إلكترونيات", ""],
      ["workshop", "ورشة", ""],
      ["seminar_room", "قاعة ندوات", ""],
    ];
    const wsRef = XLSX.utils.aoa_to_sheet(ref);
    wsRef["!cols"] = [{ wch: 22 }, { wch: 24 }, { wch: 22 }];
    XLSX.utils.book_append_sheet(wb, wsRef, "أنواع_القاعات");
  }

  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new Blob([out], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export async function parseExcel(
  file: File,
  entity?: string,
): Promise<{
  headers: string[];
  rows: Record<string, unknown>[];
  rowNumbers?: number[];
  sheetName?: string;
  headerRowNumber?: number;
}> {
  if (entity === "instructors") return parseInstructorSheet(file, TEMPLATES.instructors.columns);
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "", raw: false });
  const headers = json.length > 0 ? Object.keys(json[0]) : [];
  return { headers, rows: json };
}
