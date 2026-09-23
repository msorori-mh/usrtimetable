import type { LeadershipCollege } from "./leadership";

export const ACADEMIC_STAFFING_TITLE = "الاحتياج الأكاديمي والدرجات الوظيفية";
export const ACADEMIC_STAFFING_STATUS = "جاري التطوير";
export const ACADEMIC_STAFFING_NOTICE =
  "تُتاح نتائج الاحتياج وتوصيات الدرجات بعد إثبات اكتمال البيانات واعتماد مصادرها والتحقق من صحة الحسابات.";

/**
 * Stage 1 reads only the already authorized leadership snapshot. These are
 * observations, never certification of permanent staffing or curricular demand.
 * In particular, leadership.deficit is UNUSED personal quota, not a hiring gap.
 * This adapter intentionally cannot produce a staffing total or recommendation.
 * Unlocking requires a later server-verified, period-bound evidence contract;
 * publication, complete-looking counts and browser state cannot unlock results.
 */
export type StaffingObservationState = "available" | "incomplete" | "unavailable";
export interface StaffingObservation {
  state: StaffingObservationState;
  detail: string;
}
export interface StaffingReadinessRow {
  collegeId: string;
  college: string;
  period: StaffingObservation;
  demand: StaffingObservation;
  quotas: StaffingObservation;
  ranks: StaffingObservation;
  assignments: StaffingObservation;
  status: typeof ACADEMIC_STAFFING_STATUS;
  recommendation: null;
  staffingGapHours: null;
  proposedPositions: null;
}

export const STAFFING_VERIFICATION_REQUIREMENTS = [
  {
    id: "curriculum",
    title: "مطابقة الخطط والمجموعات",
    detail: "كل مقرر مطلوب ومكوناته ومجموعاته، بما فيها غير المسندة، مع منع تكرار اللقاء المشترك.",
    owner: "الكلية والشؤون الأكاديمية",
  },
  {
    id: "appointments",
    title: "إثبات المعينين وهوية العضو",
    detail: "تعيين دائم موثق، وكلية أصل معتمدة، واحتساب العضو مرة واحدة على مستوى الجامعة.",
    owner: "شؤون أعضاء هيئة التدريس",
  },
  {
    id: "quotas",
    title: "اعتماد الأنصبة وفترات التوافر",
    detail: "نصاب وإعفاء معتمدان، مع الإجازة والابتعاث والتقاعد، وتطبيق الإعفاء مرة واحدة.",
    owner: "شؤون أعضاء هيئة التدريس",
  },
  {
    id: "eligibility",
    title: "التخصص والفئة والأهلية التدريسية",
    detail: "فصل هيئة التدريس عن الهيئة المساعدة وتحديد ما يؤهل كل عضو لتدريسه.",
    owner: "الأقسام والشؤون الأكاديمية",
  },
  {
    id: "scope",
    title: "فصل العبء الأساسي والخدمات",
    detail: "فصل خدمات الكليات الأخرى والتغطية المؤقتة، واستبعاد إشراف التخرج الخارج عن النصاب.",
    owner: "الشؤون الأكاديمية",
  },
  {
    id: "positions",
    title: "الدرجات المعتمدة والشاغرة",
    detail: "تمييز شغل الشاغر والاستحداث والإحلال، مع مراجعة عبء الفصلين.",
    owner: "الموارد البشرية والقيادة الجامعية",
  },
  {
    id: "growth",
    title: "أعداد الدفعات والنمو",
    detail: "أعداد موثقة وانتقال الدفعات وحدود المجموعات لسيناريوهَي النمو السنوي 10% و15%.",
    owner: "القبول والتسجيل والكليات",
  },
  {
    id: "validation",
    title: "إثبات صحة النتائج",
    detail: "مطابقة الحسابات بالمصادر واعتماد سياسة الحساب وإصدارها والفترة التي تنطبق عليها.",
    owner: "الشؤون الأكاديمية والقيادة الجامعية",
  },
] as const;

const knownCount = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0
    ? value
    : null;
const format = (value: number) => value.toLocaleString("ar");
const unavailable = (detail: string): StaffingObservation => ({ state: "unavailable", detail });
const normalizeRank = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670ـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/[_\s]+/g, " ");
// Unknown labels, academic degrees and "محاضر" are not silently classified.
const classifiedRanks = new Set(
  [
    "أستاذ",
    "أستاذ مشارك",
    "أستاذ مساعد",
    "معيد",
    "مدرس",
    "professor",
    "associate_professor",
    "assistant_professor",
    "teaching_assistant",
    "instructor",
  ].map(normalizeRank),
);

function rankObservation(college: LeadershipCollege): StaffingObservation {
  const total = knownCount(college.faculty_directory_count);
  const ranks = Object.entries(college.rank_counts);
  if (total === null || total === 0 || ranks.length === 0)
    return unavailable("لا تتوفر بيانات كافية لتصنيف الرتب");
  if (ranks.some(([, count]) => knownCount(count) === null))
    return unavailable("تعذر التحقق من حصر الرتب");
  const recorded = ranks.reduce((sum, [, count]) => sum + count, 0);
  if (recorded > total) return unavailable("حصر الرتب لا يطابق عدد السجلات");
  const unclassified =
    total -
    recorded +
    ranks.reduce(
      (sum, [rank, count]) => sum + (classifiedRanks.has(normalizeRank(rank)) ? 0 : count),
      0,
    );
  return unclassified > 0
    ? {
        state: "incomplete",
        detail: `${format(unclassified)} من ${format(total)} رتبة تحتاج تصنيفًا`,
      }
    : { state: "available", detail: `${format(total)} رتبة مسجلة؛ الأهلية تحتاج اعتمادًا` };
}

export function buildStaffingReadiness(college: LeadershipCollege): StaffingReadinessRow {
  const termKnown = college.term_state === "ready" && !!college.term_id;
  const groups = knownCount(college.groups_count);
  const programs = knownCount(college.programs);
  const faculty = knownCount(college.faculty_count);
  const incomplete = knownCount(college.incomplete_faculty);
  const pending = knownCount(college.pending_groups);
  const overallocated = knownCount(college.overallocated_groups);
  const quotaKnown =
    typeof college.net_quota === "number" &&
    Number.isFinite(college.net_quota) &&
    college.net_quota >= 0;
  let quotas = unavailable("لا يتوفر حصر مكتمل للأنصبة في هذه الفترة");
  if (
    termKnown &&
    faculty !== null &&
    faculty > 0 &&
    incomplete !== null &&
    incomplete <= faculty
  ) {
    quotas =
      incomplete > 0
        ? {
            state: "incomplete",
            detail: `${format(incomplete)} من ${format(faculty)} سجلًا يحتاج مراجعة النصاب أو توزيع الإسناد`,
          }
        : quotaKnown
          ? {
              state: "available",
              detail: `${format(faculty)} سجلًا متاحًا للمراجعة؛ اعتماد صفة التعيين مطلوب`,
            }
          : quotas;
  }
  let assignments = unavailable("لا تتوفر بيانات كافية لمراجعة توزيع الساعات");
  if (termKnown && groups !== null && groups > 0 && pending !== null && overallocated !== null) {
    assignments =
      pending > 0 || overallocated > 0
        ? {
            state: "incomplete",
            detail: `${format(pending)} مجموعة بانتظار التوزيع؛ ${format(overallocated)} بإسناد زائد`,
          }
        : { state: "available", detail: "لا تظهر ملاحظات توزيع؛ اكتمال الطلب يحتاج مطابقة الخطة" };
  }
  return {
    collegeId: college.college_id,
    college: college.college,
    period: !termKnown
      ? {
          state: "incomplete",
          detail:
            college.term_state === "ambiguous" ? "أكثر من فصل مطابق" : "الفصل المطابق غير محدد",
        }
      : college.year_inferred !== false
        ? { state: "incomplete", detail: "يلزم تثبيت السنة الأكاديمية" }
        : { state: "available", detail: college.term ?? "الفترة محددة" },
    demand:
      !termKnown || groups === null || programs === null
        ? unavailable("بيانات البرامج والمجموعات غير مكتملة لهذه الفترة")
        : groups === 0 || programs === 0
          ? { state: "incomplete", detail: "يلزم استكمال البرامج والمجموعات ومطابقتها بالخطة" }
          : {
              state: "available",
              detail: `${format(programs)} برنامج؛ ${format(groups)} مجموعة مسجلة؛ مطابقة الخطة مطلوبة`,
            },
    quotas,
    ranks: rankObservation(college),
    assignments,
    status: ACADEMIC_STAFFING_STATUS,
    recommendation: null,
    staffingGapHours: null,
    proposedPositions: null,
  };
}

/** Same gating and wording for the screen and the executive CSV/XLSX export. */
export function staffingReadinessExport(college: LeadershipCollege) {
  const row = buildStaffingReadiness(college);
  return {
    staffing_status: row.status,
    staffing_period: row.period.detail,
    staffing_demand: row.demand.detail,
    staffing_quotas: row.quotas.detail,
    staffing_ranks: row.ranks.detail,
    staffing_assignments: row.assignments.detail,
    staffing_verification: "بانتظار إثبات اكتمال البيانات واعتماد المصادر وصحة الحسابات",
  };
}

export const STAFFING_EXPORT_HEADERS = [
  { key: "staffing_status", label: "حالة وحدة الاحتياج الأكاديمي" },
  { key: "staffing_period", label: "الاحتياج الأكاديمي: الفترة" },
  { key: "staffing_demand", label: "الاحتياج الأكاديمي: البرامج والمجموعات" },
  { key: "staffing_quotas", label: "الاحتياج الأكاديمي: الأنصبة" },
  { key: "staffing_ranks", label: "الاحتياج الأكاديمي: تصنيف الرتب" },
  { key: "staffing_assignments", label: "الاحتياج الأكاديمي: توزيع الساعات" },
  { key: "staffing_verification", label: "الاحتياج الأكاديمي: متطلبات الاعتماد" },
];
