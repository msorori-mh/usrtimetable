import type { ImportEntity } from "@/lib/excel-import/types";
import { listImportUiEntities } from "@/lib/excel-import/registry";
import type { WizardStepId, WizardStepResult } from "./types";

export type PreparationStepId = Exclude<WizardStepId, "create_schedule_version">;
export interface PreparationStep {
  id: PreparationStepId;
  title: string;
  description: string;
  manualLinks: { href: string; label: string }[];
  entities: ImportEntity[];
}

export const PREPARATION_STEPS: PreparationStep[] = [
  {
    id: "academic_structure",
    title: "الأقسام والبرامج والفصول",
    description: "عرّف أقسام الكلية وبرامجها، ثم أضف الفصول الأكاديمية التي ستعمل عليها.",
    manualLinks: [
      { href: "/departments", label: "إدارة الأقسام" },
      { href: "/programs", label: "إدارة البرامج" },
      { href: "/terms", label: "إدارة الفصول" },
    ],
    entities: ["academic_terms"],
  },
  {
    id: "study_plans",
    title: "الخطط الدراسية",
    description:
      "أضف مقررات كل برنامج ومستوياته وساعات المحاضرات والمعامل. يمكنك رفع الخطة كاملة في ملف واحد.",
    manualLinks: [
      { href: "/study-plans", label: "إدارة الخطط الدراسية" },
      { href: "/courses", label: "إدارة المقررات" },
    ],
    entities: ["full_study_plan", "study_plan_courses", "course_programs"],
  },
  {
    id: "instructors",
    title: "المدرسون والنصاب",
    description:
      "أضف المدرسين وأرقامهم الوظيفية وأنواع التوظيف والنصاب وساعات الإعفاء. راجع النصاب والتوفر قبل إسناد المقررات.",
    manualLinks: [{ href: "/instructors", label: "إدارة المدرسين والنصاب" }],
    entities: ["instructors"],
  },
  {
    id: "rooms",
    title: "القاعات والمعامل",
    description: "حدّد اسم كل قاعة ونوعها وسعتها حتى يمكن توزيع المجموعات على الأماكن المناسبة.",
    manualLinks: [{ href: "/rooms", label: "إدارة القاعات والمعامل" }],
    entities: ["rooms"],
  },
  {
    id: "cohorts",
    title: "الدفعات وأعداد الطلاب",
    description:
      "حدّد طلاب كل برنامج ومستوى وفصل، وافصل النظام العام عن الموازي. اعتمد أعداد الطلاب المستخدمة في الجدولة.",
    manualLinks: [
      { href: "/academic-cohorts", label: "إدارة الدفعات" },
      { href: "/scheduling-headcounts", label: "اعتماد أعداد الطلاب" },
    ],
    entities: ["academic_cohorts"],
  },
  {
    id: "delivery_groups",
    title: "مجموعات المحاضرات والمعامل",
    description:
      "ولّد مجموعات المحاضرات والمعامل من الدفعات والخطط وأعداد الطلاب، ثم راجع أحجامها. ينشئها النظام مباشرة.",
    manualLinks: [{ href: "/delivery-groups", label: "توليد المجموعات ومراجعتها" }],
    entities: [],
  },
  {
    id: "teaching_assignments",
    title: "إسناد المقررات للمدرسين",
    description:
      "حدّد المدرس لكل مجموعة والساعات المسندة له. عند اشتراك مدرسين، حدّد نصيب كل مدرس صراحةً.",
    manualLinks: [{ href: "/teaching-assignments", label: "إدارة الإسناد التدريسي" }],
    entities: ["teaching_assignments_v2"],
  },
  {
    id: "constraints",
    title: "أيام التدريس وتوفر المدرسين",
    description: "حدّد أيام وساعات التدريس، ثم أوقات توفر المدرسين، خصوصًا المدرسين الخارجيين.",
    manualLinks: [
      { href: "/time-slot-templates", label: "تحديد أيام وساعات التدريس" },
      { href: "/availability", label: "تحديد توفر المدرسين" },
    ],
    entities: [],
  },
  {
    id: "readiness_check",
    title: "المراجعة النهائية",
    description:
      "راجع النواقص الظاهرة هنا، ثم انتقل إلى إنشاء الجدول. يُعاد فحص الشروط عند تشغيل الجدولة.",
    manualLinks: [{ href: "/data-readiness", label: "تفاصيل فحص البيانات" }],
    entities: [],
  },
];

const supportedEntities = new Set(listImportUiEntities().map((e) => e.entity));
export function preparationStepForEntity(entity?: string): PreparationStepId {
  if (entity === "elective_slot_courses") return "study_plans";
  if (entity === "cohort_elective_selections") return "cohorts";
  if (entity === "daily_breaks") return "constraints";
  return (
    PREPARATION_STEPS.find((s) => s.entities.includes(entity as ImportEntity))?.id ??
    "academic_structure"
  );
}

export function parsePreparationSearch(search: Record<string, unknown>): {
  step?: PreparationStepId;
  entity?: ImportEntity;
  help?: boolean;
} {
  const entity =
    typeof search.entity === "string" && supportedEntities.has(search.entity as ImportEntity)
      ? (search.entity as ImportEntity)
      : undefined;
  const step = entity
    ? preparationStepForEntity(entity)
    : PREPARATION_STEPS.find((s) => s.id === search.step)?.id;
  return {
    ...(step ? { step } : {}),
    ...(entity ? { entity } : {}),
    ...(search.help === true || search.help === "true" ? { help: true } : {}),
  };
}

export function preparationEntities(
  step: PreparationStepId,
  hasElectives: boolean,
): ImportEntity[] {
  const entities = [...(PREPARATION_STEPS.find((s) => s.id === step)?.entities ?? [])];
  if (hasElectives && step === "study_plans") entities.push("elective_slot_courses");
  if (hasElectives && step === "cohorts") entities.push("cohort_elective_selections");
  return entities;
}

/** The preparation percentage must not depend on having already created a schedule. */
export function resolvePreparationProgress(results: WizardStepResult[]) {
  const steps = PREPARATION_STEPS.map((s) => results.find((r) => r.id === s.id)).filter(
    (s): s is WizardStepResult => !!s,
  );
  const complete = steps.filter((s) => s.status === "complete").length;
  const required = steps.find((s) => s.status === "blocker" || s.status === "incomplete");
  const next = required ?? steps.find((s) => s.status !== "complete");
  return {
    steps,
    complete,
    total: PREPARATION_STEPS.length,
    percent: Math.round((complete * 100) / PREPARATION_STEPS.length),
    nextStepId: (next?.id ?? "readiness_check") as PreparationStepId,
    canContinue: steps.length === PREPARATION_STEPS.length && !required,
  };
}

export function preparationStepForPath(pathname: string): PreparationStepId | undefined {
  return PREPARATION_STEPS.find((s) =>
    s.manualLinks.some((l) => pathname === l.href || pathname.startsWith(`${l.href}/`)),
  )?.id;
}

/** Keep internal identifiers out of the everyday preparation interface. */
export function preparationLabel(text: string): string {
  return text
    .replace(/نموذج التقديم V2/g, "بيانات الجدولة")
    .replace(/الدفعات الأكاديمية/g, "الدفعات الدراسية")
    .replace(/بدون section_id\./g, "")
    .replace(/academic_cohorts/g, "الدفعات الدراسية")
    .replace(/elective_slot_courses/g, "مقررات الخانات الاختيارية")
    .replace(/delivery_groups/g, "مجموعات المحاضرات والمعامل")
    .replace(/instructors/g, "المدرسون")
    .replace(/SCHEDULING_HEADCOUNT_MISSING/g, "عدد الطلاب المعتمد غير مكتمل")
    .replace(/\s*\(?V2\)?/g, "")
    .replace(/التدفق الجديد/g, "")
    .replace(/canonical/g, "معتمدة")
    .replace(/\s+/g, " ")
    .trim();
}
