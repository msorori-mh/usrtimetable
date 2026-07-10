import type {
  CanonicalImportDataType,
  ImportCapabilityFlags,
  ImportDefinition,
  ImportDependency,
  ImportPermissions,
} from "../contracts";
import { PR1_CAPABILITY_DEFAULTS } from "../contracts";
import { TERMINOLOGY } from "../terminology";

const TEMPLATE_VERSION = "2026.1" as const;
const DEFAULT_MAX_ROWS = 5000;

const DEFAULT_PERMISSIONS = {
  view: "can_view_college",
  execute: "can_manage_college",
  roles: ["super_admin", "college_admin"],
} as const satisfies ImportPermissions;

function r1Capabilities(): ImportCapabilityFlags {
  return {
    ...PR1_CAPABILITY_DEFAULTS,
    legacyImportOperational: true,
  };
}

function comingSoonCapabilities(): ImportCapabilityFlags {
  return { ...PR1_CAPABILITY_DEFAULTS };
}

function dep(dataType: CanonicalImportDataType, required = true): ImportDependency {
  return { dataType, required };
}

function define(
  dataType: CanonicalImportDataType,
  config: {
    category: ImportDefinition["category"];
    targetEntity: ImportDefinition["targetEntity"];
    naturalKeySummary: string;
    naturalKeyParts: ImportDefinition["naturalKey"]["parts"];
    dependencies: readonly ImportDependency[];
    importModePolicy: ImportDefinition["importModePolicy"];
    releasePhase: ImportDefinition["releasePhase"];
    availability: ImportDefinition["availability"];
    capabilities: ImportCapabilityFlags;
    descriptionAr: string;
    descriptionEn: string;
    deprecationMetadata?: ImportDefinition["deprecationMetadata"];
  },
): ImportDefinition {
  return {
    dataType,
    templateIdentity: {
      templateId: dataType,
      templateVersion: TEMPLATE_VERSION,
    },
    labels: TERMINOLOGY[dataType],
    description: { ar: config.descriptionAr, en: config.descriptionEn },
    category: config.category,
    targetEntity: config.targetEntity,
    naturalKey: {
      parts: config.naturalKeyParts,
      summary: config.naturalKeySummary,
    },
    dependencies: config.dependencies,
    permissions: DEFAULT_PERMISSIONS,
    importModePolicy: config.importModePolicy,
    releasePhase: config.releasePhase,
    availability: config.availability,
    capabilities: config.capabilities,
    deprecationMetadata: config.deprecationMetadata,
    maxRows: DEFAULT_MAX_ROWS,
    sheetName: dataType,
  } satisfies ImportDefinition;
}

export const IMPORT_DEFINITIONS = [
  define("academic_terms", {
    category: "foundational",
    targetEntity: "academic_terms",
    naturalKeySummary: "code",
    naturalKeyParts: [{ kind: "field", field: "code" }],
    dependencies: [],
    importModePolicy: "UPSERT",
    releasePhase: "R1",
    availability: "available",
    capabilities: r1Capabilities(),
    descriptionAr: "فترات زمنية رسمية للدراسة (فصل أول/ثاني).",
    descriptionEn: "Official study time periods (semesters/terms).",
  }),
  define("departments", {
    category: "foundational",
    targetEntity: "departments",
    naturalKeySummary: "code",
    naturalKeyParts: [{ kind: "field", field: "code" }],
    dependencies: [],
    importModePolicy: "UPSERT",
    releasePhase: "R2",
    availability: "coming_soon",
    capabilities: comingSoonCapabilities(),
    descriptionAr: "أقسام الكلية الأكاديمية.",
    descriptionEn: "Academic departments within the college.",
  }),
  define("academic_programs", {
    category: "foundational",
    targetEntity: "academic_programs",
    naturalKeySummary: "code",
    naturalKeyParts: [{ kind: "field", field: "code" }],
    dependencies: [dep("departments")],
    importModePolicy: "UPSERT",
    releasePhase: "R2",
    availability: "coming_soon",
    capabilities: comingSoonCapabilities(),
    descriptionAr: "البرامج الأكاديمية المرتبطة بالأقسام.",
    descriptionEn: "Academic programs linked to departments.",
  }),
  define("study_plan_rows", {
    category: "academic_plan",
    targetEntity: ["study_plans", "plan_courses", "courses"],
    naturalKeySummary: "plan+course+level+semester",
    naturalKeyParts: [
      {
        kind: "composite",
        parts: ["plan_code", "course_code", "level", "semester"],
      },
    ],
    dependencies: [dep("academic_programs"), dep("departments")],
    importModePolicy: "UPSERT",
    releasePhase: "R1",
    availability: "available",
    capabilities: r1Capabilities(),
    descriptionAr: "صفوف الخطة الدراسية — يوحّد استيراد مقررات الخطة والخطة الكاملة.",
    descriptionEn: "Study plan rows — unifies study plan courses and full study plan imports.",
    deprecationMetadata: {
      deprecatedAliases: [],
      legacyEntityKeys: ["study_plan_courses", "full_study_plan"],
      migrationNoteAr: "استخدم study_plan_rows بدلاً من study_plan_courses أو full_study_plan.",
    },
  }),
  define("course_programs", {
    category: "academic_plan",
    targetEntity: "course_programs",
    naturalKeySummary: "course+program",
    naturalKeyParts: [{ kind: "composite", parts: ["course_code", "program_code"] }],
    dependencies: [dep("academic_programs")],
    importModePolicy: "UPSERT",
    releasePhase: "R1",
    availability: "available",
    capabilities: r1Capabilities(),
    descriptionAr: "ربط المقررات بالبرامج الأكاديمية.",
    descriptionEn: "Links courses to academic programs.",
  }),
  define("instructors", {
    category: "resources",
    targetEntity: "instructors",
    naturalKeySummary: "employee_number",
    naturalKeyParts: [{ kind: "field", field: "employee_number" }],
    dependencies: [],
    importModePolicy: "UPSERT",
    releasePhase: "R1",
    availability: "available",
    capabilities: r1Capabilities(),
    descriptionAr: "أعضاء هيئة التدريس والمحاضرين.",
    descriptionEn: "Faculty and teaching staff members.",
  }),
  define("rooms", {
    category: "resources",
    targetEntity: "rooms",
    naturalKeySummary: "code",
    naturalKeyParts: [{ kind: "field", field: "code" }],
    dependencies: [],
    importModePolicy: "UPSERT",
    releasePhase: "R1",
    availability: "available",
    capabilities: r1Capabilities(),
    descriptionAr: "القاعات والمعامل — كيان موحّد بدون تقسيم labs.",
    descriptionEn: "Rooms and labs as a single unified entity.",
  }),
  define("instructor_availability", {
    category: "resources",
    targetEntity: "instructor_availability",
    naturalKeySummary: "employee+day+time",
    naturalKeyParts: [
      {
        kind: "composite",
        parts: ["employee_number", "day", "start_time"],
      },
    ],
    dependencies: [dep("instructors")],
    importModePolicy: "CREATE_ONLY",
    releasePhase: "R3",
    availability: "coming_soon",
    capabilities: comingSoonCapabilities(),
    descriptionAr: "نوافذ توفّر المحاضرين الأسبوعية.",
    descriptionEn: "Weekly instructor availability windows.",
  }),
  define("room_availability", {
    category: "resources",
    targetEntity: "room_availability",
    naturalKeySummary: "room+day+time",
    naturalKeyParts: [{ kind: "composite", parts: ["room_code", "day", "start_time"] }],
    dependencies: [dep("rooms")],
    importModePolicy: "CREATE_ONLY",
    releasePhase: "R3",
    availability: "coming_soon",
    capabilities: comingSoonCapabilities(),
    descriptionAr: "نوافذ توفّر القاعات والمعامل.",
    descriptionEn: "Weekly room availability windows.",
  }),
  define("time_slot_templates", {
    category: "scheduling",
    targetEntity: "time_slot_templates",
    naturalKeySummary: "system+day+start",
    naturalKeyParts: [
      {
        kind: "composite",
        parts: ["schedule_system", "day", "start_time"],
      },
    ],
    dependencies: [],
    importModePolicy: "UPSERT",
    releasePhase: "R3",
    availability: "coming_soon",
    capabilities: comingSoonCapabilities(),
    descriptionAr: "قوالب الفترات الزمنية للجدولة.",
    descriptionEn: "Time slot templates for scheduling.",
  }),
  define("daily_breaks", {
    category: "scheduling",
    targetEntity: "daily_breaks",
    naturalKeySummary: "name",
    naturalKeyParts: [{ kind: "field", field: "name" }],
    dependencies: [],
    importModePolicy: "UPSERT",
    releasePhase: "R1",
    availability: "available",
    capabilities: r1Capabilities(),
    descriptionAr: "فترات الاستراحة اليومية في الجدول.",
    descriptionEn: "Daily break periods in the schedule.",
  }),
  define("course_offerings", {
    category: "scheduling",
    targetEntity: "course_offerings",
    naturalKeySummary: "term+course+program",
    naturalKeyParts: [
      {
        kind: "composite",
        parts: ["term_code", "course_code", "program_code"],
      },
    ],
    dependencies: [dep("academic_terms")],
    importModePolicy: "UPSERT",
    releasePhase: "R1",
    availability: "available",
    capabilities: r1Capabilities(),
    descriptionAr: "إسناد المقررات لفترات وبرامج أكاديمية.",
    descriptionEn: "Course assignments to terms and academic programs.",
  }),
  define("sections", {
    category: "scheduling",
    targetEntity: "sections",
    naturalKeySummary: "course+term+section_number",
    naturalKeyParts: [
      {
        kind: "composite",
        parts: ["course_code", "term_code", "section_number"],
      },
    ],
    dependencies: [dep("academic_terms")],
    importModePolicy: "UPSERT",
    releasePhase: "R2",
    availability: "coming_soon",
    capabilities: comingSoonCapabilities(),
    descriptionAr: "الشعب الدراسية لمقررات الفصل.",
    descriptionEn: "Class sections for term course offerings.",
  }),
  define("teaching_assignments", {
    category: "scheduling",
    targetEntity: "teaching_assignments",
    naturalKeySummary: "logical_key",
    naturalKeyParts: [
      {
        kind: "logical",
        description: "offering + instructor + session_type composite",
      },
    ],
    dependencies: [dep("course_offerings"), dep("instructors"), dep("sections")],
    importModePolicy: "UPSERT",
    releasePhase: "R1",
    availability: "available",
    capabilities: r1Capabilities(),
    descriptionAr: "تكليفات المحاضرين بعروض المقررات والشعب.",
    descriptionEn: "Instructor assignments to offerings and sections.",
  }),
  define("section_groups", {
    category: "scheduling",
    targetEntity: "section_groups",
    naturalKeySummary: "term+course+group_name",
    naturalKeyParts: [
      {
        kind: "composite",
        parts: ["term_code", "course_code", "group_name"],
      },
    ],
    dependencies: [dep("sections"), dep("course_offerings")],
    importModePolicy: "UPSERT",
    releasePhase: "R1",
    availability: "available",
    capabilities: r1Capabilities(),
    descriptionAr: "مجموعات الشعب المدمجة للمحاضرات المشتركة.",
    descriptionEn: "Merged section groups for shared lectures.",
  }),
] as const satisfies readonly ImportDefinition[];
