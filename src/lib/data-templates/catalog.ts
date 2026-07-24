// Catalog of Excel templates for the Data Templates Center.
// Read-only metadata + Excel builders. No DB access.
// Operational commit path is src/lib/excel-import (TEMPLATES + commit_import_job_atomic).

export type CatalogClassification =
  | "ACTIVE_NEW_FLOW"
  | "LEGACY_ONLY"
  | "GENERATED_NOT_IMPORTED"
  | "UI_MANAGED_NOT_IMPORTED"
  | "CATALOG_DOWNLOAD_ONLY"
  | "DEPRECATED";

export type TemplateCol = {
  header: string; // Arabic header in data sheet (must match excel-import when importable)
  required?: boolean;
  example?: string;
  allowed?: string; // allowed values text
  notes?: string;
  description?: string; // long description for instructions sheet
};

export type TemplateRef = {
  title: string;
  rows: string[][]; // 2D array including header row
};

export type TemplateDef = {
  id: string;
  name: string; // Arabic display name
  group: "foundational" | "academic_plan" | "resources" | "scheduling" | "optional";
  groupLabel: string;
  purpose: string;
  requiredBeforeScheduling: boolean;
  importOrder: number;
  sheetName: string;
  columns: TemplateCol[];
  sampleRows?: string[][];
  references?: TemplateRef[];
  commonErrors?: string[];
  notes?: string;
  /** Pilot classification — controls badges / download warnings */
  classification?: CatalogClassification;
  /** True when /import atomic commit supports this id as ImportEntity */
  atomicImport?: boolean;
};

export const GROUPS: Record<TemplateDef["group"], string> = {
  foundational: "أ. البيانات التأسيسية",
  academic_plan: "ب. بيانات الخطط الأكاديمية",
  resources: "ج. الموارد",
  scheduling: "د. بيانات الجدولة",
  optional: "هـ. بيانات اختيارية/تشغيلية",
};

const REF_DAYS: TemplateRef = {
  title: "أيام الأسبوع",
  rows: [
    ["الرمز", "اليوم"],
    ["0", "الأحد"],
    ["1", "الإثنين"],
    ["2", "الثلاثاء"],
    ["3", "الأربعاء"],
    ["4", "الخميس"],
    ["5", "الجمعة"],
    ["6", "السبت"],
  ],
};

const REF_ROOM_TYPES: TemplateRef = {
  title: "أنواع القاعات",
  rows: [
    ["الرمز", "الوصف"],
    ["lecture_hall", "قاعة محاضرات"],
    ["computer_lab", "معمل حاسوب"],
    ["network_lab", "معمل شبكات"],
    ["cybersecurity_lab", "معمل أمن سيبراني"],
    ["electronics_lab", "معمل إلكترونيات"],
    ["workshop", "ورشة"],
    ["seminar_room", "قاعة ندوات"],
  ],
};

const REF_SESSION_TYPES: TemplateRef = {
  title: "أنواع المحاضرات",
  rows: [
    ["الرمز", "الوصف"],
    ["lecture", "محاضرة"],
    ["lab", "معمل"],
    ["tutorial", "تمارين"],
    ["seminar", "ندوة"],
    ["workshop", "ورشة"],
  ],
};

const REF_STUDY_SYSTEM: TemplateRef = {
  title: "نظام الدراسة (Pilot)",
  rows: [
    ["الرمز", "الوصف"],
    ["regular", "انتظام"],
    ["parallel", "موازي"],
  ],
};

const REF_STUDY_SYSTEM_LEGACY: TemplateRef = {
  title: "نظام الدراسة (Legacy — يتضمن both)",
  rows: [
    ["الرمز", "الوصف"],
    ["regular", "انتظام"],
    ["parallel", "موازي"],
    ["both", "كلاهما"],
  ],
};

const REF_TERM_TYPES: TemplateRef = {
  title: "الفصل الدراسي",
  rows: [
    ["الرمز", "الوصف"],
    ["first", "الفصل الدراسي الأول"],
    ["second", "الفصل الدراسي الثاني"],
  ],
};

const REF_INSTRUCTOR_TYPES: TemplateRef = {
  title: "نوع المحاضر (أمثلة)",
  rows: [
    ["الرمز", "الوصف"],
    ["PERM", "متفرغ"],
    ["VIS", "زائر"],
    ["PART", "غير متفرغ"],
  ],
};

export const CATALOG: TemplateDef[] = [
  // ============= A. Foundational =============
  {
    id: "colleges",
    name: "الكلّيات",
    group: "foundational",
    groupLabel: GROUPS.foundational,
    purpose: "تعريف الكليات داخل الجامعة.",
    classification: "UI_MANAGED_NOT_IMPORTED",
    atomicImport: false,
    requiredBeforeScheduling: true,
    importOrder: 1,
    sheetName: "colleges",
    columns: [
      { header: "رمز_الكلية", required: true, example: "FITCS", description: "رمز فريد للكلية" },
      { header: "اسم_الكلية", required: true, example: "كلية تقنية المعلومات وعلوم الحاسب" },
      { header: "اسم_الكلية_انجليزي", example: "Faculty of IT and CS" },
      { header: "نشط", example: "true", allowed: "true | false" },
    ],
    sampleRows: [["FITCS", "كلية تقنية المعلومات وعلوم الحاسب", "Faculty of IT and CS", "true"]],
    commonErrors: ["رمز كلية مكرر", "اسم كلية فارغ"],
  },
  {
    id: "departments",
    name: "الأقسام",
    group: "foundational",
    groupLabel: GROUPS.foundational,
    purpose: "تعريف الأقسام داخل كل كلية.",
    classification: "UI_MANAGED_NOT_IMPORTED",
    atomicImport: false,
    requiredBeforeScheduling: true,
    importOrder: 2,
    sheetName: "departments",
    columns: [
      { header: "رمز_الكلية", required: true, example: "FITCS" },
      { header: "رمز_القسم", required: true, example: "CS" },
      { header: "اسم_القسم", required: true, example: "علوم الحاسب" },
      { header: "اسم_القسم_انجليزي", example: "Computer Science" },
      { header: "نشط", example: "true", allowed: "true | false" },
    ],
    sampleRows: [["FITCS", "CS", "علوم الحاسب", "Computer Science", "true"]],
    commonErrors: ["رمز كلية غير معروف", "رمز قسم مكرر داخل نفس الكلية"],
  },
  {
    id: "programs",
    name: "البرامج",
    group: "foundational",
    groupLabel: GROUPS.foundational,
    purpose: "تعريف البرامج الأكاديمية.",
    classification: "UI_MANAGED_NOT_IMPORTED",
    atomicImport: false,
    requiredBeforeScheduling: true,
    importOrder: 3,
    sheetName: "programs",
    columns: [
      { header: "رمز_القسم", required: true, example: "CS" },
      { header: "رمز_البرنامج", required: true, example: "CS" },
      { header: "اسم_البرنامج", required: true, example: "بكالوريوس علوم الحاسب" },
      { header: "نظام_الدراسة", example: "regular", allowed: "regular | parallel" },
      { header: "عدد_المستويات", example: "8" },
      { header: "نشط", example: "true" },
    ],
    sampleRows: [["CS", "CS", "بكالوريوس علوم الحاسب", "regular", "8", "true"]],
    references: [REF_STUDY_SYSTEM],
    commonErrors: ["رمز قسم غير معروف", "قيمة نظام_الدراسة غير صحيحة"],
  },
  {
    id: "academic_levels",
    name: "المستويات الأكاديمية",
    group: "foundational",
    groupLabel: GROUPS.foundational,
    purpose: "تعريف المستويات الدراسية لكل برنامج.",
    classification: "UI_MANAGED_NOT_IMPORTED",
    atomicImport: false,
    requiredBeforeScheduling: false,
    importOrder: 4,
    sheetName: "levels",
    columns: [
      { header: "رمز_البرنامج", required: true, example: "CS" },
      { header: "رقم_المستوى", required: true, example: "1" },
      { header: "اسم_المستوى", example: "المستوى الأول" },
    ],
    sampleRows: [["CS", "1", "المستوى الأول"]],
    commonErrors: ["رمز برنامج غير معروف", "تكرار رقم المستوى"],
  },
  {
    id: "academic_terms",
    name: "الفصول الأكاديمية",
    group: "foundational",
    groupLabel: GROUPS.foundational,
    purpose: "الفصول المرتبطة بالعام الأكاديمي، مثل الفصل الأول والفصل الثاني.",
    classification: "ACTIVE_NEW_FLOW",
    atomicImport: true,
    requiredBeforeScheduling: true,
    importOrder: 5,
    sheetName: "terms",
    columns: [
      { header: "الرمز", required: true, example: "2025-T1" },
      { header: "الاسم", required: true, example: "الفصل الدراسي الأول 2025" },
      { header: "السنة_الأكاديمية", example: "2025-2026" },
      { header: "الفصل_الدراسي", example: "first", allowed: "first | second" },
      { header: "تاريخ_البداية", example: "2025-09-01" },
      { header: "تاريخ_النهاية", example: "2026-01-15" },
      { header: "عدد_أسابيع_التدريس", example: "15" },
      { header: "نشط", example: "false" },
    ],
    sampleRows: [
      [
        "2025-T1",
        "الفصل الدراسي الأول 2025",
        "2025-2026",
        "first",
        "2025-09-01",
        "2026-01-15",
        "15",
        "true",
      ],
    ],
    references: [REF_TERM_TYPES],
    commonErrors: [
      "تنسيق تاريخ غير صحيح",
      "قيمة الفصل الدراسي غير معروفة (المسموح: first / second)",
    ],
  },

  // ============= B. Academic Plan =============
  {
    id: "courses",
    name: "المقررات",
    group: "academic_plan",
    groupLabel: GROUPS.academic_plan,
    purpose: "كتالوج المقررات المعرفة. في Pilot تُنشأ عادة عبر استيراد الخطة الدراسية.",
    classification: "CATALOG_DOWNLOAD_ONLY",
    atomicImport: false,
    requiredBeforeScheduling: true,
    importOrder: 6,
    sheetName: "courses",
    columns: [
      { header: "رمز_القسم", required: true, example: "CS" },
      { header: "رمز_المقرر", required: true, example: "CS101" },
      { header: "اسم_المقرر", required: true, example: "مقدمة في الحاسب" },
      { header: "الساعات_المعتمدة", required: true, example: "3" },
      { header: "ساعات_نظري", example: "2" },
      { header: "ساعات_عملي", example: "2" },
      { header: "عدد_المحاضرات_أسبوعياً", example: "1" },
      { header: "مدة_المحاضرة", example: "2" },
      { header: "عدد_المعامل_أسبوعياً", example: "1" },
      { header: "مدة_المعمل", example: "2" },
      {
        header: "نوع_قاعة_المحاضرة",
        example: "lecture_hall",
        allowed: "lecture_hall | seminar_room",
      },
      {
        header: "نوع_قاعة_المعمل",
        example: "computer_lab",
        allowed: "computer_lab | network_lab | cybersecurity_lab | electronics_lab | workshop",
      },
    ],
    sampleRows: [
      [
        "CS",
        "CS101",
        "مقدمة في الحاسب",
        "3",
        "2",
        "2",
        "1",
        "2",
        "1",
        "2",
        "lecture_hall",
        "computer_lab",
      ],
    ],
    references: [REF_ROOM_TYPES],
    commonErrors: ["رمز قسم غير معروف", "رمز مقرر مكرر", "ساعات معتمدة مفقودة"],
  },
  {
    id: "study_plans",
    name: "الخطط الدراسية",
    group: "academic_plan",
    groupLabel: GROUPS.academic_plan,
    purpose: "تعريف الخطط الدراسية للبرامج. يُفضّل full_study_plan للاستيراد الذري.",
    classification: "CATALOG_DOWNLOAD_ONLY",
    atomicImport: false,
    requiredBeforeScheduling: true,
    importOrder: 7,
    sheetName: "study_plans",
    columns: [
      { header: "رمز_البرنامج", required: true, example: "CS" },
      { header: "رمز_الخطة", required: true, example: "CS-2024" },
      { header: "اسم_الخطة", required: true, example: "خطة علوم الحاسب 2024" },
      { header: "نسخة_الخطة", example: "1" },
      { header: "سنة_السريان", example: "2024" },
      { header: "نشط", example: "true" },
    ],
    sampleRows: [["CS", "CS-2024", "خطة علوم الحاسب 2024", "1", "2024", "true"]],
    commonErrors: ["رمز برنامج غير معروف"],
  },
  {
    id: "plan_courses",
    name: "مقررات الخطة (مستوى/فصل)",
    group: "academic_plan",
    groupLabel: GROUPS.academic_plan,
    purpose:
      "ربط المقررات بالخطة والمستوى والفصل الدراسي. يطابق TEMPLATES.study_plan_courses حرفيًا (نفس أعمدة full_study_plan).",
    classification: "ACTIVE_NEW_FLOW",
    atomicImport: true,
    requiredBeforeScheduling: true,
    importOrder: 8,
    sheetName: "plan_courses",
    columns: [
      { header: "رمز_البرنامج", required: true, example: "CS", description: "program_code" },
      { header: "رمز_الخطة", required: true, example: "CS-2024", description: "plan_code" },
      { header: "اسم_الخطة", example: "خطة علوم الحاسب 2024", description: "plan_name" },
      { header: "نسخة_الخطة", example: "1", description: "plan_version" },
      { header: "سنة_السريان", example: "2024", description: "effective_year" },
      { header: "رقم_المستوى", required: true, example: "1", description: "level_number" },
      { header: "الفصل", required: true, example: "1", allowed: "1 | 2", description: "semester" },
      { header: "رمز_القسم", required: true, example: "CS", description: "department_code" },
      { header: "رمز_المقرر", required: true, example: "CS101", description: "course_code" },
      {
        header: "اسم_المقرر",
        required: true,
        example: "مقدمة في الحاسب",
        description: "course_name",
      },
      { header: "الساعات_المعتمدة", required: true, example: "3", description: "credit_hours" },
      { header: "ساعات_نظري", example: "2", description: "theory_hours" },
      { header: "ساعات_عملي", example: "2", description: "practical_hours" },
      { header: "ساعات_تمرين", example: "0", description: "tutorial_hours" },
      { header: "ساعات_مشروع", example: "0", description: "project_hours" },
      {
        header: "خانة_اختيارية",
        example: "false",
        allowed: "true | false",
        description: "is_elective_slot",
      },
      { header: "رمز_الخانة_الاختيارية", example: "", description: "elective_slot_code" },
      {
        header: "تدريب_صيفي",
        example: "false",
        allowed: "true | false",
        description: "is_summer_training",
      },
      {
        header: "مشروع_تخرج",
        example: "false",
        allowed: "true | false",
        description: "is_graduation_project",
      },
      {
        header: "طبيعة_المقرر",
        example: "department",
        allowed: "department | faculty | university",
        description: "course_nature",
      },
      { header: "مشترك", example: "false", allowed: "true | false", description: "is_shared" },
      { header: "إجباري", example: "true", allowed: "true | false", description: "is_required" },
      { header: "عدد_المحاضرات_أسبوعياً", example: "1", description: "lectures_per_week" },
      { header: "مدة_المحاضرة", example: "2", description: "lecture_session_duration" },
      { header: "عدد_المعامل_أسبوعياً", example: "1", description: "labs_per_week" },
      { header: "مدة_المعمل", example: "2", description: "lab_session_duration" },
      {
        header: "نوع_قاعة_المحاضرة_رمز",
        example: "lecture_hall",
        description: "required_room_type_code_lecture",
      },
      {
        header: "نوع_قاعة_العملي_رمز",
        example: "computer_lab",
        description: "required_room_type_code_practical",
      },
      {
        header: "نوع_قاعة_التمرين_رمز",
        example: "",
        description: "required_room_type_code_tutorial",
      },
      {
        header: "نوع_قاعة_المشروع_رمز",
        example: "",
        description: "required_room_type_code_project",
      },
      {
        header: "نوع_قاعة_المحاضرة",
        example: "lecture_hall",
        description: "required_room_type_for_lecture",
      },
      {
        header: "نوع_قاعة_المعمل",
        example: "computer_lab",
        description: "required_room_type_for_lab",
      },
    ],
    sampleRows: [
      [
        "CS",
        "CS-2024",
        "خطة علوم الحاسب 2024",
        "1",
        "2024",
        "1",
        "1",
        "CS",
        "CS101",
        "مقدمة في الحاسب",
        "3",
        "2",
        "2",
        "0",
        "0",
        "false",
        "",
        "false",
        "false",
        "department",
        "false",
        "true",
        "1",
        "2",
        "1",
        "2",
        "lecture_hall",
        "computer_lab",
        "",
        "",
        "lecture_hall",
        "computer_lab",
      ],
    ],
    references: [REF_ROOM_TYPES],
    commonErrors: ["رمز خطة غير معروف", "رمز مقرر غير معروف", "تكرار مقرر داخل نفس المستوى/الفصل"],
    notes:
      "عند التنزيل من مركز القوالب استخدم هذه الأعمدة حرفيًا — مسار commit هو study_plan_courses.",
  },
  {
    id: "full_study_plan",
    name: "الخطة الدراسية الكاملة (Full Study Plan)",
    group: "academic_plan",
    groupLabel: GROUPS.academic_plan,
    purpose:
      "استيراد الخطة الأكاديمية الرسمية الكاملة للبرنامج بكافة المستويات والفصول والمقررات. يطابق أعمدة excel-import حرفيًا.",
    classification: "ACTIVE_NEW_FLOW",
    atomicImport: true,
    requiredBeforeScheduling: true,
    importOrder: 8,
    sheetName: "full_plan",
    columns: [
      { header: "رمز_البرنامج", required: true, example: "CS", description: "program_code" },
      { header: "رمز_الخطة", required: true, example: "CS-2024", description: "plan_code" },
      { header: "اسم_الخطة", example: "خطة علوم الحاسب 2024", description: "plan_name" },
      { header: "نسخة_الخطة", example: "1", description: "plan_version" },
      { header: "سنة_السريان", example: "2024", description: "effective_year" },
      { header: "رقم_المستوى", required: true, example: "1", description: "level_number" },
      { header: "الفصل", required: true, example: "1", allowed: "1 | 2", description: "semester" },
      { header: "رمز_القسم", required: true, example: "CS", description: "department_code" },
      { header: "رمز_المقرر", required: true, example: "CS101", description: "course_code" },
      {
        header: "اسم_المقرر",
        required: true,
        example: "مقدمة في الحاسب",
        description: "course_name",
      },
      { header: "الساعات_المعتمدة", required: true, example: "3", description: "credit_hours" },
      { header: "ساعات_نظري", example: "2", description: "theory_hours" },
      { header: "ساعات_عملي", example: "2", description: "practical_hours" },
      { header: "ساعات_تمرين", example: "0", description: "tutorial_hours" },
      { header: "ساعات_مشروع", example: "0", description: "project_hours" },
      {
        header: "خانة_اختيارية",
        example: "false",
        allowed: "true | false",
        description: "is_elective_slot",
      },
      { header: "رمز_الخانة_الاختيارية", example: "CY3XX(E)", description: "elective_slot_code" },
      {
        header: "تدريب_صيفي",
        example: "false",
        allowed: "true | false",
        description: "is_summer_training",
      },
      {
        header: "مشروع_تخرج",
        example: "false",
        allowed: "true | false",
        description: "is_graduation_project",
      },
      {
        header: "طبيعة_المقرر",
        example: "department",
        allowed: "department | college | university",
        description: "course_nature",
      },
      { header: "مشترك", example: "false", allowed: "true | false", description: "is_shared" },
      { header: "إجباري", example: "true", allowed: "true | false", description: "is_required" },
      { header: "عدد_المحاضرات_أسبوعياً", example: "1", description: "lectures_per_week" },
      { header: "مدة_المحاضرة", example: "2", description: "lecture_session_duration" },
      { header: "عدد_المعامل_أسبوعياً", example: "1", description: "labs_per_week" },
      { header: "مدة_المعمل", example: "2", description: "lab_session_duration" },
      {
        header: "نوع_قاعة_المحاضرة_رمز",
        example: "lecture_hall",
        description: "required_room_type_code_lecture",
      },
      {
        header: "نوع_قاعة_العملي_رمز",
        example: "computer_lab",
        description: "required_room_type_code_practical",
      },
      {
        header: "نوع_قاعة_التمرين_رمز",
        example: "",
        description: "required_room_type_code_tutorial",
      },
      {
        header: "نوع_قاعة_المشروع_رمز",
        example: "",
        description: "required_room_type_code_project",
      },
      {
        header: "نوع_قاعة_المحاضرة",
        example: "lecture_hall",
        allowed: "lecture_hall | seminar_room",
        description: "required_room_type_for_lecture",
      },
      {
        header: "نوع_قاعة_المعمل",
        example: "computer_lab",
        allowed: "computer_lab | network_lab | cybersecurity_lab | electronics_lab | workshop",
        description: "required_room_type_for_lab",
      },
    ],
    sampleRows: [
      [
        "CS",
        "CS-2024",
        "خطة علوم الحاسب 2024",
        "1",
        "2024",
        "1",
        "1",
        "CS",
        "CS101",
        "مقدمة في الحاسب",
        "3",
        "2",
        "2",
        "0",
        "0",
        "false",
        "",
        "false",
        "false",
        "department",
        "false",
        "true",
        "1",
        "2",
        "1",
        "2",
        "lecture_hall",
        "computer_lab",
        "",
        "",
        "lecture_hall",
        "computer_lab",
      ],
    ],
    references: [REF_ROOM_TYPES],
    commonErrors: [
      "رمز_البرنامج غير معروف",
      "تكرار رمز_المقرر داخل نفس الخطة",
      "الساعات_المعتمدة فارغة أو غير رقمية",
      "قيم غير صحيحة في نوع قاعة المحاضرة/المعمل",
    ],
    notes:
      "العناوين العربية تطابق TEMPLATES.full_study_plan حرفيًا. المفاتيح الإنجليزية موثّقة في عمود الوصف. لا تستخدم أعمدة إنجليزية قديمة (program_code كعنوان ورقة).",
  },
  {
    id: "course_programs",
    name: "ربط المقررات بالبرامج (مقررات مشتركة)",
    group: "academic_plan",
    groupLabel: GROUPS.academic_plan,
    purpose: "ربط المقررات المشتركة ببرامج متعددة.",
    classification: "ACTIVE_NEW_FLOW",
    atomicImport: true,
    requiredBeforeScheduling: false,
    importOrder: 9,
    sheetName: "course_programs",
    columns: [
      { header: "رمز_المقرر", required: true, example: "UNI100" },
      { header: "رمز_البرنامج", required: true, example: "CS" },
    ],
    sampleRows: [
      ["UNI100", "CS"],
      ["UNI100", "IT"],
    ],
    commonErrors: ["رمز مقرر غير معروف", "رمز برنامج غير معروف"],
  },

  // ============= C. Resources =============
  {
    id: "instructors",
    name: "المحاضرون",
    group: "resources",
    groupLabel: GROUPS.resources,
    purpose: "بيانات المحاضرين الأساسية.",
    classification: "ACTIVE_NEW_FLOW",
    atomicImport: true,
    requiredBeforeScheduling: true,
    importOrder: 10,
    sheetName: "instructors",
    columns: [
      { header: "رقم_الموظف", required: true, example: "EMP001" },
      { header: "الاسم_الكامل", required: true, example: "أحمد محمد" },
      { header: "الاسم_بالعربي", example: "أحمد محمد" },
      { header: "الاسم_بالانجليزي", example: "Ahmed Mohamed" },
      { header: "البريد_الالكتروني", example: "a@x.com" },
      { header: "الهاتف", example: "0555555555" },
      { header: "التخصص", example: "أمن المعلومات" },
      { header: "الدرجة_العلمية", example: "دكتوراه" },
      { header: "الرتبة_الأكاديمية", example: "أستاذ مساعد" },
      { header: "نوع_المحاضر_رمز", example: "PERM", allowed: "PERM | VIS | PART" },
      { header: "رمز_القسم", example: "CS" },
      { header: "نوع_التوظيف", example: "full_time", allowed: "full_time | part_time | visiting" },
      { header: "أقصى_ساعات_أسبوعية", example: "18" },
      { header: "أقصى_ساعات_يومية", example: "6" },
      { header: "نشط", example: "true" },
    ],
    sampleRows: [
      [
        "EMP001",
        "أحمد محمد",
        "أحمد محمد",
        "Ahmed Mohamed",
        "a@x.com",
        "0555555555",
        "أمن المعلومات",
        "دكتوراه",
        "أستاذ مساعد",
        "PERM",
        "CS",
        "full_time",
        "18",
        "6",
        "true",
      ],
    ],
    references: [REF_INSTRUCTOR_TYPES],
    commonErrors: ["رقم موظف مفقود أو مكرر", "نوع توظيف غير صحيح"],
  },
  {
    id: "instructor_availability",
    name: "توفّر المحاضرين",
    group: "resources",
    groupLabel: GROUPS.resources,
    purpose:
      "ساعات توفّر/عدم توفّر المحاضرين أسبوعياً. تُدار من واجهة التوفر — لا مسار commit ذري.",
    classification: "UI_MANAGED_NOT_IMPORTED",
    atomicImport: false,
    requiredBeforeScheduling: false,
    importOrder: 11,
    sheetName: "instructor_availability",
    columns: [
      { header: "رقم_الموظف", required: true, example: "EMP001" },
      { header: "اليوم", required: true, example: "0", allowed: "0..6" },
      { header: "من_الساعة", required: true, example: "08:00" },
      { header: "إلى_الساعة", required: true, example: "12:00" },
      { header: "الحالة", example: "available", allowed: "available | unavailable | preferred" },
      { header: "ملاحظات" },
    ],
    sampleRows: [["EMP001", "0", "08:00", "12:00", "available", ""]],
    references: [REF_DAYS],
    commonErrors: ["رقم موظف غير معروف", "قيمة يوم خارج النطاق 0..6", "تنسيق وقت غير صحيح"],
  },
  {
    id: "rooms",
    name: "القاعات والمعامل",
    group: "resources",
    groupLabel: GROUPS.resources,
    purpose: "الأماكن المادية المستخدمة لتقديم المحاضرات والتطبيقات.",
    classification: "ACTIVE_NEW_FLOW",
    atomicImport: true,
    requiredBeforeScheduling: true,
    importOrder: 12,
    sheetName: "rooms",
    columns: [
      { header: "رمز_القاعة", required: true, example: "R-101" },
      { header: "اسم_القاعة", required: true, example: "قاعة 101" },
      { header: "السعة", required: true, example: "30" },
      {
        header: "نوع_القاعة",
        required: true,
        example: "lecture_hall",
        allowed:
          "lecture_hall | computer_lab | network_lab | cybersecurity_lab | electronics_lab | workshop | seminar_room",
      },
      { header: "نوع_القاعة_رمز", example: "", allowed: "اختياري للتوافق القديم: LEC | LAB" },
      { header: "رمز_المبنى", example: "A" },
      { header: "الطابق", example: "1" },
      { header: "متاح_من", example: "08:00" },
      { header: "متاح_إلى", example: "14:00" },
      { header: "نشط", example: "true" },
    ],
    sampleRows: [
      ["R-101", "قاعة 101", "30", "lecture_hall", "", "A", "1", "08:00", "14:00", "true"],
    ],
    references: [REF_ROOM_TYPES],
    commonErrors: [
      "رمز قاعة مكرر",
      "نوع قاعة غير معروف",
      "تعارض بين نوع القاعة ورمز نوع القاعة",
      "سعة مفقودة",
    ],
  },
  {
    id: "room_availability",
    name: "توفّر القاعات",
    group: "resources",
    groupLabel: GROUPS.resources,
    purpose: "فترات توفّر القاعات الأسبوعية. تُدار من الواجهة — لا مسار commit ذري.",
    classification: "UI_MANAGED_NOT_IMPORTED",
    atomicImport: false,
    requiredBeforeScheduling: false,
    importOrder: 13,
    sheetName: "room_availability",
    columns: [
      { header: "رمز_القاعة", required: true, example: "R-101" },
      { header: "اليوم", required: true, example: "0", allowed: "0..6" },
      { header: "من_الساعة", required: true, example: "08:00" },
      { header: "إلى_الساعة", required: true, example: "14:00" },
      { header: "الحالة", example: "available", allowed: "available | unavailable" },
    ],
    sampleRows: [["R-101", "0", "08:00", "14:00", "available"]],
    references: [REF_DAYS],
    commonErrors: ["رمز قاعة غير معروف", "تداخل فترات"],
  },
  {
    id: "daily_breaks",
    name: "الاستراحات اليومية",
    group: "resources",
    groupLabel: GROUPS.resources,
    purpose: "تعريف فترات استراحة تؤثر/لا تؤثر على الجدولة.",
    classification: "ACTIVE_NEW_FLOW",
    atomicImport: true,
    requiredBeforeScheduling: false,
    importOrder: 14,
    sheetName: "daily_breaks",
    columns: [
      { header: "الاسم", required: true, example: "استراحة الظهر" },
      { header: "من_الساعة", required: true, example: "12:00" },
      { header: "إلى_الساعة", required: true, example: "12:30" },
      {
        header: "الأيام",
        required: true,
        example: "0,1,2,3,4",
        allowed: "قائمة 0..6 مفصولة بفواصل",
      },
      { header: "يؤثر_على_الجدولة", example: "true", allowed: "true | false" },
    ],
    sampleRows: [["استراحة الظهر", "12:00", "12:30", "0,1,2,3,4", "true"]],
    references: [REF_DAYS],
  },
  {
    id: "time_slot_templates",
    name: "قوالب أوقات المحاضرات",
    group: "resources",
    groupLabel: GROUPS.resources,
    purpose: "تحديد أيام وساعات التدريس والمدد المسموح بها لتوليد أوقات الجدولة. تُدار من الواجهة.",
    classification: "UI_MANAGED_NOT_IMPORTED",
    atomicImport: false,
    requiredBeforeScheduling: true,
    importOrder: 15,
    sheetName: "time_slot_templates",
    columns: [
      { header: "اسم_القالب", required: true, example: "نظام الانتظام" },
      {
        header: "نظام_الدراسة",
        required: true,
        example: "regular",
        allowed: "regular | parallel",
      },
      { header: "من_الساعة", required: true, example: "08:00" },
      { header: "إلى_الساعة", required: true, example: "21:00" },
      { header: "مدة_الفترة_دقيقة", example: "60" },
      { header: "نشط", example: "true" },
    ],
    sampleRows: [["نظام الانتظام", "regular", "08:00", "16:00", "60", "true"]],
    references: [REF_STUDY_SYSTEM],
    commonErrors: ["نظام دراسة غير صحيح", "تنسيق وقت غير صحيح"],
  },

  // ============= D. Scheduling (V2 active + Legacy) =============
  {
    id: "academic_cohorts",
    name: "الدفعات الأكاديمية (V2)",
    group: "scheduling",
    groupLabel: GROUPS.scheduling,
    purpose: "السياق الأكاديمي الأساسي — برنامج/مستوى/نظام دراسة/سنة دخول/فصل. بدون شعب.",
    classification: "ACTIVE_NEW_FLOW",
    atomicImport: true,
    requiredBeforeScheduling: true,
    importOrder: 16,
    sheetName: "academic_cohorts",
    columns: [
      { header: "رمز_البرنامج", required: true, example: "CS" },
      { header: "رقم_المستوى", required: true, example: "3" },
      { header: "نظام_الدراسة", required: true, example: "regular", allowed: "regular | parallel" },
      { header: "سنة_الدخول", required: true, example: "2024" },
      { header: "رمز_الفصل", required: true, example: "2026-F" },
      { header: "الطلاب_المتوقعون", example: "60" },
      { header: "حالة_العد", example: "estimated", allowed: "estimated | confirmed | locked" },
      { header: "رمز_الدفعة", example: "CS-L3-2024" },
      { header: "نشط", example: "true", allowed: "true | false" },
    ],
    sampleRows: [["CS", "3", "regular", "2024", "2026-F", "60", "estimated", "CS-L3-2024", "true"]],
    references: [REF_STUDY_SYSTEM],
    commonErrors: ["رمز برنامج غير معروف", "فصل غير معروف", "نظام دراسة خارج Pilot"],
    notes: "لا يوجد plan_code. الخطة تُربط عبر توليد منهج الدفعة.",
  },
  {
    id: "elective_slot_courses",
    name: "مقررات الخانات الاختيارية (V2)",
    group: "scheduling",
    groupLabel: GROUPS.scheduling,
    purpose: "المقررات المسموح بها داخل خانة اختيارية على مستوى الخطة.",
    classification: "ACTIVE_NEW_FLOW",
    atomicImport: true,
    requiredBeforeScheduling: true,
    importOrder: 17,
    sheetName: "elective_slot_courses",
    columns: [
      { header: "رمز_البرنامج", required: true, example: "CS" },
      { header: "رمز_الخطة", required: true, example: "CS-2024" },
      { header: "نسخة_الخطة", example: "1" },
      { header: "رمز_الخانة_الاختيارية", required: true, example: "CY3XX(E)" },
      { header: "رمز_المقرر", required: true, example: "CY301" },
    ],
    sampleRows: [["CS", "CS-2024", "1", "CY3XX(E)", "CY301"]],
  },
  {
    id: "cohort_elective_selections",
    name: "اختيارات الدفعات الاختيارية (V2)",
    group: "scheduling",
    groupLabel: GROUPS.scheduling,
    purpose: "اختيار مقرر واحد لكل دفعة وخانة — لا تسجيل فردي للطالب.",
    classification: "ACTIVE_NEW_FLOW",
    atomicImport: true,
    requiredBeforeScheduling: true,
    importOrder: 18,
    sheetName: "cohort_elective_selections",
    columns: [
      { header: "رمز_الدفعة", required: true, example: "CS-L3-2024" },
      { header: "رمز_الخانة_الاختيارية", required: true, example: "CY3XX(E)" },
      { header: "رمز_المقرر_المختار", required: true, example: "CY301" },
    ],
    sampleRows: [["CS-L3-2024", "CY3XX(E)", "CY301"]],
  },
  {
    id: "teaching_assignments_v2",
    name: "الإسناد التدريسي V2",
    group: "scheduling",
    groupLabel: GROUPS.scheduling,
    purpose: "إسناد محاضر لدفعة + مقرر + مكوّن + مجموعة تقديم. يتطلب delivery_groups مولَّدة.",
    classification: "ACTIVE_NEW_FLOW",
    atomicImport: true,
    requiredBeforeScheduling: true,
    importOrder: 19,
    sheetName: "assignments_v2",
    columns: [
      { header: "رمز_الدفعة", required: true, example: "CS-L3-2024" },
      { header: "رمز_المقرر", required: true, example: "CS101" },
      {
        header: "نوع_المكوّن",
        required: true,
        example: "theory",
        allowed: "theory | practical | tutorial | project",
      },
      { header: "رمز_مجموعة_التقديم", required: true, example: "G1" },
      { header: "رقم_الموظف_للمحاضر", required: true, example: "EMP001" },
      { header: "ساعات_المكوّن_المسندة", example: "3" },
      { header: "نظام_الدراسة", example: "regular", allowed: "regular | parallel" },
      { header: "نشط", example: "true" },
      { header: "الطلاب_المتوقعون", example: "30" },
      { header: "نوع_القاعة_المطلوب", example: "lecture_hall" },
      { header: "ملاحظات" },
    ],
    sampleRows: [
      [
        "CS-L3-2024",
        "CS101",
        "theory",
        "G1",
        "EMP001",
        "3",
        "regular",
        "true",
        "30",
        "lecture_hall",
        "",
      ],
    ],
    references: [REF_ROOM_TYPES, REF_STUDY_SYSTEM],
    commonErrors: [
      "delivery_group غير موجودة — ولّد المجموعات أولًا",
      "summer_training ممنوع",
      "تدريس مشترك بدون تقسيم ساعات",
    ],
    notes: "لا section_id. course_offerings/delivery_groups مولَّدة — ليست أعمدة استيراد تشغيلية.",
  },
  {
    id: "course_offerings",
    name: "إسناد المقررات (Legacy)",
    group: "scheduling",
    groupLabel: GROUPS.scheduling,
    purpose: "Legacy فقط. في المسار الجديد تُولَّد العروض من منهج الدفعة.",
    classification: "LEGACY_ONLY",
    atomicImport: true,
    requiredBeforeScheduling: false,
    importOrder: 90,
    sheetName: "offerings",
    columns: [
      { header: "رمز_الفصل", required: true, example: "2025-F" },
      { header: "رمز_المقرر", required: true, example: "CS101" },
      { header: "رمز_البرنامج", example: "CS" },
      { header: "رقم_المستوى", example: "1" },
      { header: "رمز_الخطة", example: "CS-2024" },
      { header: "الطلاب_المتوقعون", example: "60" },
      { header: "عدد_المجموعات", example: "2" },
      { header: "الحالة", example: "draft", allowed: "draft | approved | scheduled | cancelled" },
      { header: "نشط", example: "true" },
    ],
    sampleRows: [["2025-F", "CS101", "CS", "1", "CS-2024", "60", "2", "draft", "true"]],
    commonErrors: ["رمز فصل غير معروف", "رمز مقرر غير معروف", "طلاب متوقعون = 0"],
  },
  {
    id: "teaching_assignments",
    name: "الإسناد التدريسي V1 (Legacy)",
    group: "scheduling",
    groupLabel: GROUPS.scheduling,
    purpose: "Legacy — يعتمد section_number. استخدم teaching_assignments_v2.",
    classification: "LEGACY_ONLY",
    atomicImport: true,
    requiredBeforeScheduling: false,
    importOrder: 91,
    sheetName: "assignments",
    columns: [
      { header: "رمز_الفصل", required: true, example: "2025-F" },
      { header: "رمز_المقرر", required: true, example: "CS101" },
      { header: "رقم_الموظف_للمحاضر", required: true, example: "EMP001" },
      { header: "رقم_المجموعة", example: "1" },
      {
        header: "نوع_المحاضرة",
        required: true,
        example: "lecture",
        allowed: "lecture | lab | tutorial | seminar | workshop",
      },
      { header: "ساعات_أسبوعية", example: "3" },
      { header: "الطلاب_المتوقعون", example: "30" },
      { header: "نوع_القاعة_المطلوب", example: "lecture_hall" },
    ],
    sampleRows: [["2025-F", "CS101", "EMP001", "1", "lecture", "3", "30", "lecture_hall"]],
    references: [REF_SESSION_TYPES, REF_ROOM_TYPES],
    commonErrors: ["رقم موظف غير معروف", "نوع محاضرة غير صحيح", "إسناد بدون طرح مقابل"],
  },
  {
    id: "sections",
    name: "المجموعات الدراسية (Legacy)",
    group: "scheduling",
    groupLabel: GROUPS.scheduling,
    purpose: "Legacy compatibility فقط — لا تظهر في واجهة الاستيراد الجديدة.",
    classification: "LEGACY_ONLY",
    atomicImport: true,
    requiredBeforeScheduling: false,
    importOrder: 92,
    sheetName: "sections",
    columns: [
      { header: "رمز_الفصل", required: true, example: "2025-F" },
      { header: "رمز_المقرر", required: true, example: "CS101" },
      { header: "رقم_المجموعة", required: true, example: "1" },
      { header: "السعة_القصوى", example: "30" },
      { header: "نظام_الدراسة", example: "regular", allowed: "regular | parallel | both" },
    ],
    sampleRows: [["2025-F", "CS101", "1", "30", "regular"]],
    references: [REF_STUDY_SYSTEM_LEGACY],
    notes: "لا تستخدم هذا القالب في Pilot V2.",
  },
  {
    id: "section_groups",
    name: "المجموعات المدمجة (Legacy)",
    group: "scheduling",
    groupLabel: GROUPS.scheduling,
    purpose: "Legacy — يعتمد sections.",
    classification: "LEGACY_ONLY",
    atomicImport: true,
    requiredBeforeScheduling: false,
    importOrder: 93,
    sheetName: "section_groups",
    columns: [
      { header: "رمز_الفصل", required: true, example: "2025-F" },
      { header: "رمز_المقرر", required: true, example: "UNI100" },
      { header: "اسم_المجموعة", required: true, example: "مجموعة A" },
      {
        header: "أرقام_المجموعات",
        required: true,
        example: "1,2,3",
        allowed: "قائمة أرقام مفصولة بفواصل",
      },
      { header: "ملاحظات" },
    ],
    sampleRows: [["2025-F", "UNI100", "مجموعة A", "1,2,3", ""]],
  },

  // ============= E. Optional / Operational =============
  {
    id: "existing_schedule_sessions",
    name: "المحاضرات المجدوَلة الموجودة",
    group: "optional",
    groupLabel: GROUPS.optional,
    purpose: "مستبعد من Pilot — الجداول تُنشأ من محرر الجدول.",
    classification: "GENERATED_NOT_IMPORTED",
    atomicImport: false,
    requiredBeforeScheduling: false,
    importOrder: 94,
    sheetName: "schedule_sessions",
    columns: [
      { header: "رمز_الفصل", required: true, example: "2025-F" },
      { header: "رمز_المقرر", required: true, example: "CS101" },
      { header: "رقم_المجموعة", example: "1" },
      { header: "نوع_المحاضرة", required: true, example: "lecture" },
      { header: "اليوم", required: true, example: "0", allowed: "0..6" },
      { header: "من_الساعة", required: true, example: "08:00" },
      { header: "إلى_الساعة", required: true, example: "10:00" },
      { header: "رمز_القاعة", example: "R-101" },
      { header: "رقم_الموظف_للمحاضر", example: "EMP001" },
    ],
    sampleRows: [["2025-F", "CS101", "1", "lecture", "0", "08:00", "10:00", "R-101", "EMP001"]],
    references: [REF_DAYS, REF_SESSION_TYPES],
  },
  {
    id: "room_unavailability",
    name: "عدم توفّر القاعات (استثناءات)",
    group: "optional",
    groupLabel: GROUPS.optional,
    purpose: "فترات صيانة/حجز خاصة للقاعات. تُدار من الواجهة.",
    classification: "UI_MANAGED_NOT_IMPORTED",
    atomicImport: false,
    requiredBeforeScheduling: false,
    importOrder: 21,
    sheetName: "room_unavailability",
    columns: [
      { header: "رمز_القاعة", required: true, example: "R-101" },
      { header: "اليوم", example: "0", allowed: "0..6 أو فارغ لكل الأيام" },
      { header: "من_الساعة", required: true, example: "10:00" },
      { header: "إلى_الساعة", required: true, example: "12:00" },
      { header: "السبب", example: "صيانة" },
    ],
    sampleRows: [["R-101", "0", "10:00", "12:00", "صيانة"]],
    references: [REF_DAYS],
  },
  {
    id: "constraint_settings",
    name: "إعدادات القيود",
    group: "optional",
    groupLabel: GROUPS.optional,
    purpose: "إعدادات قيود الجدولة (مرجعية).",
    classification: "CATALOG_DOWNLOAD_ONLY",
    atomicImport: false,
    requiredBeforeScheduling: false,
    importOrder: 22,
    sheetName: "constraint_settings",
    columns: [
      { header: "مفتاح_القيد", required: true, example: "max_consecutive_hours" },
      { header: "القيمة", required: true, example: "4" },
      { header: "مفعّل", example: "true", allowed: "true | false" },
      { header: "ملاحظات" },
    ],
    sampleRows: [["max_consecutive_hours", "4", "true", ""]],
  },
  {
    id: "quality_settings",
    name: "إعدادات الجودة",
    group: "optional",
    groupLabel: GROUPS.optional,
    purpose: "أوزان وسياسات تقييم جودة الجدول.",
    classification: "CATALOG_DOWNLOAD_ONLY",
    atomicImport: false,
    requiredBeforeScheduling: false,
    importOrder: 23,
    sheetName: "quality_settings",
    columns: [
      { header: "مفتاح_العنصر", required: true, example: "instructor_gaps_weight" },
      { header: "الوزن", required: true, example: "10" },
      { header: "مفعّل", example: "true" },
      { header: "ملاحظات" },
    ],
    sampleRows: [["instructor_gaps_weight", "10", "true", ""]],
  },
];

export function getTemplate(id: string): TemplateDef | undefined {
  return CATALOG.find((t) => t.id === id);
}

export async function buildCatalogTemplate(id: string): Promise<Blob> {
  const tpl = getTemplate(id);
  if (!tpl) throw new Error("قالب غير معروف");
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();

  // Sheet 1: data entry
  // Headers must match the import parser literally — never append " *" to names.
  const headers = tpl.columns.map((c) => c.header);
  const sample =
    tpl.sampleRows && tpl.sampleRows.length > 0
      ? tpl.sampleRows
      : [tpl.columns.map((c) => c.example ?? "")];
  const aoa: (string | number)[][] = [headers, ...sample];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = headers.map(() => ({ wch: 22 }));
  XLSX.utils.book_append_sheet(wb, ws, tpl.sheetName.slice(0, 31));

  // Sheet 2: instructions (required flags live here, not in header text)
  const instr: (string | number)[][] = [
    ["تعليمات الاستيراد"],
    [""],
    [`اسم القالب: ${tpl.name}`],
    [`الغرض: ${tpl.purpose}`],
    [`مطلوب قبل الجدولة: ${tpl.requiredBeforeScheduling ? "نعم" : "لا"}`],
    [`ترتيب الاستيراد: ${tpl.importOrder}`],
    ["لا تضع علامة * في أسماء الأعمدة — يجب أن تطابق العناوين حرفياً."],
    [""],
    ["وصف الأعمدة:"],
    ["العمود", "إلزامي", "مثال", "قيم مسموحة", "ملاحظات / وصف"],
    ...tpl.columns.map((c) => [
      c.header,
      c.required ? "نعم" : "لا",
      c.example ?? "",
      c.allowed ?? "",
      c.notes ?? c.description ?? "",
    ]),
  ];
  if (tpl.commonErrors && tpl.commonErrors.length) {
    instr.push([""], ["الأخطاء الشائعة:"], ...tpl.commonErrors.map((e) => [`• ${e}`]));
  }
  const wsI = XLSX.utils.aoa_to_sheet(instr);
  wsI["!cols"] = [{ wch: 28 }, { wch: 10 }, { wch: 18 }, { wch: 30 }, { wch: 50 }];
  XLSX.utils.book_append_sheet(wb, wsI, "تعليمات");

  // Sheet 3: references (if any)
  if (tpl.references && tpl.references.length > 0) {
    const ref: (string | number)[][] = [];
    tpl.references.forEach((r, idx) => {
      if (idx > 0) ref.push([""]);
      ref.push([r.title]);
      r.rows.forEach((row) => ref.push(row));
    });
    const wsR = XLSX.utils.aoa_to_sheet(ref);
    wsR["!cols"] = [{ wch: 20 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, wsR, "قيم مرجعية");
  }

  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new Blob([out], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/** Official Pilot import order shown in Data Templates Center. */
export const IMPORT_ORDER: { step: number; label: string; templateId?: string; note?: string }[] = [
  { step: 1, label: "الكليات / الأقسام / البرامج (واجهة)", note: "UI — ليس استيرادًا ذريًا" },
  { step: 2, label: "الفصول الأكاديمية", templateId: "academic_terms" },
  { step: 3, label: "الخطة الدراسية الكاملة", templateId: "full_study_plan" },
  { step: 4, label: "ربط المقررات بالبرامج", templateId: "course_programs" },
  { step: 5, label: "المحاضرون", templateId: "instructors" },
  { step: 6, label: "القاعات والمعامل", templateId: "rooms" },
  { step: 7, label: "الاستراحات اليومية", templateId: "daily_breaks" },
  {
    step: 8,
    label: "التوفر / النصاب / قوالب الفترات (واجهة)",
    note: "UI — instructor_availability / workload / time slots",
  },
  { step: 9, label: "الدفعات الأكاديمية", templateId: "academic_cohorts" },
  { step: 10, label: "مقررات الخانات الاختيارية", templateId: "elective_slot_courses" },
  { step: 11, label: "اختيارات الدفعات", templateId: "cohort_elective_selections" },
  {
    step: 12,
    label: "توليد منهج الدفعة (cohort curriculum)",
    note: "مولَّد من النظام — ليس Excel",
  },
  {
    step: 13,
    label: "توليد مجموعات التقديم (delivery groups)",
    note: "مولَّد من النظام — ليس Excel",
  },
  { step: 14, label: "الإسناد التدريسي V2", templateId: "teaching_assignments_v2" },
  { step: 15, label: "محرر الجدول", note: "لا استيراد schedule_sessions في Pilot" },
];
