// Catalog of Excel templates for the Data Templates Center.
// Read-only metadata + Excel builders. No DB access.

export type TemplateCol = {
  header: string;       // Arabic header in data sheet
  required?: boolean;
  example?: string;
  allowed?: string;     // allowed values text
  notes?: string;
  description?: string; // long description for instructions sheet
};

export type TemplateRef = {
  title: string;
  rows: string[][];     // 2D array including header row
};

export type TemplateDef = {
  id: string;
  name: string;             // Arabic display name
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
  title: "نظام الدراسة",
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
    requiredBeforeScheduling: true,
    importOrder: 3,
    sheetName: "programs",
    columns: [
      { header: "رمز_القسم", required: true, example: "CS" },
      { header: "رمز_البرنامج", required: true, example: "CS" },
      { header: "اسم_البرنامج", required: true, example: "بكالوريوس علوم الحاسب" },
      { header: "نظام_الدراسة", example: "regular", allowed: "regular | parallel | both" },
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
    name: "الفصول الدراسية",
    group: "foundational",
    groupLabel: GROUPS.foundational,
    purpose: "تعريف الفصول الدراسية (الأول/الثاني).",
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
    sampleRows: [["2025-T1", "الفصل الدراسي الأول 2025", "2025-2026", "first", "2025-09-01", "2026-01-15", "15", "true"]],
    references: [REF_TERM_TYPES],
    commonErrors: ["تنسيق تاريخ غير صحيح", "قيمة الفصل الدراسي غير معروفة (المسموح: first / second)"],
  },

  // ============= B. Academic Plan =============
  {
    id: "courses",
    name: "المقررات",
    group: "academic_plan",
    groupLabel: GROUPS.academic_plan,
    purpose: "كتالوج المقررات المعرفة.",
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
      { header: "نوع_قاعة_المحاضرة", example: "lecture_hall", allowed: "lecture_hall | seminar_room" },
      { header: "نوع_قاعة_المعمل", example: "computer_lab", allowed: "computer_lab | network_lab | cybersecurity_lab | electronics_lab | workshop" },
    ],
    sampleRows: [["CS", "CS101", "مقدمة في الحاسب", "3", "2", "2", "1", "2", "1", "2", "lecture_hall", "computer_lab"]],
    references: [REF_ROOM_TYPES],
    commonErrors: ["رمز قسم غير معروف", "رمز مقرر مكرر", "ساعات معتمدة مفقودة"],
  },
  {
    id: "study_plans",
    name: "الخطط الدراسية",
    group: "academic_plan",
    groupLabel: GROUPS.academic_plan,
    purpose: "تعريف الخطط الدراسية للبرامج.",
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
    purpose: "ربط المقررات بالخطة والمستوى والفصل الدراسي.",
    requiredBeforeScheduling: true,
    importOrder: 8,
    sheetName: "plan_courses",
    columns: [
      { header: "رمز_البرنامج", required: true, example: "CS" },
      { header: "رمز_الخطة", required: true, example: "CS-2024" },
      { header: "اسم_الخطة", example: "خطة علوم الحاسب 2024" },
      { header: "نسخة_الخطة", example: "1" },
      { header: "سنة_السريان", example: "2024" },
      { header: "رقم_المستوى", required: true, example: "1" },
      { header: "الفصل", required: true, example: "1" },
      { header: "رمز_القسم", required: true, example: "CS" },
      { header: "رمز_المقرر", required: true, example: "CS101" },
      { header: "اسم_المقرر", required: true, example: "مقدمة في الحاسب" },
      { header: "الساعات_المعتمدة", required: true, example: "3" },
      { header: "ساعات_نظري", example: "2" },
      { header: "ساعات_عملي", example: "2" },
      { header: "طبيعة_المقرر", example: "department", allowed: "department | faculty | university" },
      { header: "مشترك", example: "false" },
      { header: "إجباري", example: "true" },
      { header: "عدد_المحاضرات_أسبوعياً", example: "1" },
      { header: "مدة_المحاضرة", example: "2" },
      { header: "عدد_المعامل_أسبوعياً", example: "1" },
      { header: "مدة_المعمل", example: "2" },
      { header: "نوع_قاعة_المحاضرة", example: "lecture_hall" },
      { header: "نوع_قاعة_المعمل", example: "computer_lab" },
    ],
    sampleRows: [["CS", "CS-2024", "خطة علوم الحاسب 2024", "1", "2024", "1", "1", "CS", "CS101", "مقدمة في الحاسب", "3", "2", "2", "department", "false", "true", "1", "2", "1", "2", "lecture_hall", "computer_lab"]],
    references: [REF_ROOM_TYPES],
    commonErrors: ["رمز خطة غير معروف", "رمز مقرر غير معروف", "تكرار مقرر داخل نفس المستوى/الفصل"],
  },
  {
    id: "full_study_plan",
    name: "الخطة الدراسية الكاملة (Full Study Plan)",
    group: "academic_plan",
    groupLabel: GROUPS.academic_plan,
    purpose: "استيراد الخطة الأكاديمية الرسمية الكاملة للبرنامج بكافة المستويات والفصول والمقررات. هذا أهم قالب لاستيراد الخطط.",
    requiredBeforeScheduling: true,
    importOrder: 8,
    sheetName: "full_study_plan",
    columns: [
      { header: "program_code", required: true, example: "CS", description: "رمز البرنامج" },
      { header: "study_plan_code", required: true, example: "CS-2024", description: "رمز الخطة" },
      { header: "study_plan_name", required: true, example: "خطة علوم الحاسب 2024" },
      { header: "level_code", required: true, example: "1", description: "رقم/رمز المستوى" },
      { header: "semester", required: true, example: "1", allowed: "1 | 2 | 3" },
      { header: "course_code", required: true, example: "CS101" },
      { header: "course_name_ar", required: true, example: "مقدمة في الحاسب" },
      { header: "course_name_en", example: "Introduction to Computing" },
      { header: "course_nature", example: "department", allowed: "department | faculty | university | college" },
      { header: "is_shared", example: "false", allowed: "true | false" },
      { header: "is_required", example: "true", allowed: "true | false" },
      { header: "credit_hours", required: true, example: "3" },
      { header: "theory_hours", example: "2" },
      { header: "practical_hours", example: "2" },
      { header: "training_hours", example: "0" },
      { header: "lectures_per_week", example: "1" },
      { header: "lecture_session_duration", example: "2", description: "بالساعات" },
      { header: "labs_per_week", example: "1" },
      { header: "lab_session_duration", example: "2", description: "بالساعات" },
      { header: "required_room_type_for_lecture", example: "lecture_hall", allowed: "lecture_hall | seminar_room" },
      { header: "required_room_type_for_lab", example: "computer_lab", allowed: "computer_lab | network_lab | cybersecurity_lab | electronics_lab | workshop" },
      { header: "prerequisite_code", example: "CS100", description: "رمز المقرر المتطلب السابق" },
      { header: "notes", example: "" },
    ],
    sampleRows: [
      ["CS", "CS-2024", "خطة علوم الحاسب 2024", "1", "1", "CS101", "مقدمة في الحاسب", "Introduction to Computing", "department", "false", "true", "3", "2", "2", "0", "1", "2", "1", "2", "lecture_hall", "computer_lab", "", "مقرر تأسيسي"],
      ["CS", "CS-2024", "خطة علوم الحاسب 2024", "2", "1", "CS201", "هياكل البيانات", "Data Structures", "department", "false", "true", "3", "2", "2", "0", "1", "2", "1", "2", "lecture_hall", "computer_lab", "CS101", ""],
    ],
    references: [REF_ROOM_TYPES, REF_STUDY_SYSTEM],
    commonErrors: [
      "program_code غير معروف في جدول البرامج",
      "تكرار course_code داخل نفس level/semester",
      "credit_hours فارغة أو غير رقمية",
      "قيم غير صحيحة في required_room_type_for_lecture/lab",
      "prerequisite_code يشير إلى مقرر غير موجود",
    ],
    notes: "هذا القالب يدمج إنشاء/تحديث الخطة (study_plans) وربط المقررات بها (plan_courses) في عملية واحدة. أعمدة الإنجليزية بأسماء مفاتيح ثابتة للتسهيل على أنظمة التصدير من الجامعات.",
  },
  {
    id: "course_programs",
    name: "ربط المقررات بالبرامج (مقررات مشتركة)",
    group: "academic_plan",
    groupLabel: GROUPS.academic_plan,
    purpose: "ربط المقررات المشتركة ببرامج متعددة.",
    requiredBeforeScheduling: false,
    importOrder: 9,
    sheetName: "course_programs",
    columns: [
      { header: "رمز_المقرر", required: true, example: "UNI100" },
      { header: "رمز_البرنامج", required: true, example: "CS" },
    ],
    sampleRows: [["UNI100", "CS"], ["UNI100", "IT"]],
    commonErrors: ["رمز مقرر غير معروف", "رمز برنامج غير معروف"],
  },

  // ============= C. Resources =============
  {
    id: "instructors",
    name: "المحاضرون",
    group: "resources",
    groupLabel: GROUPS.resources,
    purpose: "بيانات المحاضرين الأساسية.",
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
    sampleRows: [["EMP001", "أحمد محمد", "أحمد محمد", "Ahmed Mohamed", "a@x.com", "0555555555", "أمن المعلومات", "دكتوراه", "أستاذ مساعد", "PERM", "CS", "full_time", "18", "6", "true"]],
    references: [REF_INSTRUCTOR_TYPES],
    commonErrors: ["رقم موظف مفقود أو مكرر", "نوع توظيف غير صحيح"],
  },
  {
    id: "instructor_availability",
    name: "توفّر المحاضرين",
    group: "resources",
    groupLabel: GROUPS.resources,
    purpose: "ساعات توفّر/عدم توفّر المحاضرين أسبوعياً.",
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
    purpose: "بيانات القاعات والسعات.",
    requiredBeforeScheduling: true,
    importOrder: 12,
    sheetName: "rooms",
    columns: [
      { header: "رمز_القاعة", required: true, example: "R-101" },
      { header: "اسم_القاعة", required: true, example: "قاعة 101" },
      { header: "السعة", required: true, example: "30" },
      { header: "نوع_القاعة", example: "lecture_hall" },
      { header: "نوع_القاعة_رمز", example: "LEC" },
      { header: "رمز_المبنى", example: "A" },
      { header: "الطابق", example: "1" },
      { header: "متاح_من", example: "08:00" },
      { header: "متاح_إلى", example: "14:00" },
      { header: "نشط", example: "true" },
    ],
    sampleRows: [["R-101", "قاعة 101", "30", "lecture_hall", "LEC", "A", "1", "08:00", "14:00", "true"]],
    references: [REF_ROOM_TYPES],
    commonErrors: ["رمز قاعة مكرر", "نوع قاعة غير معروف", "سعة مفقودة"],
  },
  {
    id: "room_availability",
    name: "توفّر القاعات",
    group: "resources",
    groupLabel: GROUPS.resources,
    purpose: "فترات توفّر القاعات الأسبوعية.",
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
    requiredBeforeScheduling: false,
    importOrder: 14,
    sheetName: "daily_breaks",
    columns: [
      { header: "الاسم", required: true, example: "استراحة الظهر" },
      { header: "من_الساعة", required: true, example: "12:00" },
      { header: "إلى_الساعة", required: true, example: "12:30" },
      { header: "الأيام", required: true, example: "0,1,2,3,4", allowed: "قائمة 0..6 مفصولة بفواصل" },
      { header: "يؤثر_على_الجدولة", example: "true", allowed: "true | false" },
    ],
    sampleRows: [["استراحة الظهر", "12:00", "12:30", "0,1,2,3,4", "true"]],
    references: [REF_DAYS],
  },
  {
    id: "time_slot_templates",
    name: "قوالب الفترات الزمنية",
    group: "resources",
    groupLabel: GROUPS.resources,
    purpose: "تعريف قوالب فترات زمنية لكل نظام دراسة.",
    requiredBeforeScheduling: true,
    importOrder: 15,
    sheetName: "time_slot_templates",
    columns: [
      { header: "اسم_القالب", required: true, example: "نظام الانتظام" },
      { header: "نظام_الدراسة", required: true, example: "regular", allowed: "regular | parallel | both" },
      { header: "من_الساعة", required: true, example: "08:00" },
      { header: "إلى_الساعة", required: true, example: "21:00" },
      { header: "مدة_الفترة_دقيقة", example: "60" },
      { header: "نشط", example: "true" },
    ],
    sampleRows: [["نظام الانتظام", "regular", "08:00", "16:00", "60", "true"]],
    references: [REF_STUDY_SYSTEM],
    commonErrors: ["نظام دراسة غير صحيح", "تنسيق وقت غير صحيح"],
  },

  // ============= D. Scheduling =============
  {
    id: "course_offerings",
    name: "إسناد المقررات",
    group: "scheduling",
    groupLabel: GROUPS.scheduling,
    purpose: "تحديد المقررات المسندة في فصل دراسي معيّن.",
    requiredBeforeScheduling: true,
    importOrder: 16,
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
    name: "الإسناد التدريسي",
    group: "scheduling",
    groupLabel: GROUPS.scheduling,
    purpose: "إسناد المحاضرين للمحاضرات.",
    requiredBeforeScheduling: true,
    importOrder: 17,
    sheetName: "assignments",
    columns: [
      { header: "رمز_الفصل", required: true, example: "2025-F" },
      { header: "رمز_المقرر", required: true, example: "CS101" },
      { header: "رقم_الموظف_للمحاضر", required: true, example: "EMP001" },
      { header: "رقم_المجموعة", example: "1" },
      { header: "نوع_المحاضرة", required: true, example: "lecture", allowed: "lecture | lab | tutorial | seminar | workshop" },
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
    name: "المجموعات الدراسية",
    group: "scheduling",
    groupLabel: GROUPS.scheduling,
    purpose: "تعريف المجموعات لكل مقرر مسند.",
    requiredBeforeScheduling: false,
    importOrder: 18,
    sheetName: "sections",
    columns: [
      { header: "رمز_الفصل", required: true, example: "2025-F" },
      { header: "رمز_المقرر", required: true, example: "CS101" },
      { header: "رقم_المجموعة", required: true, example: "1" },
      { header: "السعة_القصوى", example: "30" },
      { header: "نظام_الدراسة", example: "regular" },
      { header: "نشط", example: "true" },
    ],
    sampleRows: [["2025-F", "CS101", "1", "30", "regular", "true"]],
    references: [REF_STUDY_SYSTEM],
  },
  {
    id: "section_groups",
    name: "المجموعات المدمجة",
    group: "scheduling",
    groupLabel: GROUPS.scheduling,
    purpose: "دمج عدة مجموعات في مجموعة مدمجة واحدة لمحاضرة مشتركة.",
    requiredBeforeScheduling: false,
    importOrder: 19,
    sheetName: "section_groups",
    columns: [
      { header: "رمز_الفصل", required: true, example: "2025-F" },
      { header: "رمز_المقرر", required: true, example: "UNI100" },
      { header: "اسم_المجموعة", required: true, example: "مجموعة A" },
      { header: "أرقام_المجموعات", required: true, example: "1,2,3", allowed: "قائمة أرقام مفصولة بفواصل" },
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
    purpose: "استيراد جدول قائم (من نظام سابق) للمعاينة فقط.",
    requiredBeforeScheduling: false,
    importOrder: 20,
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
    purpose: "فترات صيانة/حجز خاصة للقاعات.",
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
  const headers = tpl.columns.map((c) => (c.required ? `${c.header} *` : c.header));
  const sample = tpl.sampleRows && tpl.sampleRows.length > 0
    ? tpl.sampleRows
    : [tpl.columns.map((c) => c.example ?? "")];
  const aoa: (string | number)[][] = [headers, ...sample];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = headers.map(() => ({ wch: 22 }));
  XLSX.utils.book_append_sheet(wb, ws, tpl.sheetName.slice(0, 31));

  // Sheet 2: instructions
  const instr: (string | number)[][] = [
    ["تعليمات الاستيراد"],
    [""],
    [`اسم القالب: ${tpl.name}`],
    [`الغرض: ${tpl.purpose}`],
    [`مطلوب قبل الجدولة: ${tpl.requiredBeforeScheduling ? "نعم" : "لا"}`],
    [`ترتيب الاستيراد: ${tpl.importOrder}`],
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
  return new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export const IMPORT_ORDER: { step: number; label: string; templateId?: string }[] = [
  { step: 1, label: "الفصول الدراسية", templateId: "academic_terms" },
  { step: 2, label: "الأقسام", templateId: "departments" },
  { step: 3, label: "البرامج", templateId: "programs" },
  { step: 4, label: "المستويات الأكاديمية", templateId: "academic_levels" },
  { step: 5, label: "المقررات", templateId: "courses" },
  { step: 6, label: "الخطة الدراسية الكاملة (Full Study Plan)", templateId: "full_study_plan" },
  { step: 7, label: "الخطط / مقررات الخطة (تفصيلي)", templateId: "plan_courses" },
  { step: 7, label: "القاعات", templateId: "rooms" },
  { step: 8, label: "المحاضرون", templateId: "instructors" },
  { step: 9, label: "توفّر المحاضرين", templateId: "instructor_availability" },
  { step: 10, label: "قوالب الفترات الزمنية", templateId: "time_slot_templates" },
  { step: 11, label: "إسناد المقررات", templateId: "course_offerings" },
  { step: 12, label: "الإسناد التدريسي", templateId: "teaching_assignments" },
  { step: 13, label: "المجموعات الدراسية / المجموعات المدمجة", templateId: "sections" },
  { step: 14, label: "المحاضرات المجدوَلة (اختياري)", templateId: "existing_schedule_sessions" },
];
