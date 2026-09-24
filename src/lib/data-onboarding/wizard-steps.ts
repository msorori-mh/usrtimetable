import type { ReadinessData, ReadinessMetric } from "@/lib/reports/readiness";
import {
  classifyMetricSeverity,
  classifyNewFlowReadinessIssues,
  countSeverities,
  newFlowBlockers,
} from "./classify";
import type { WizardStepDef, WizardStepId, WizardStepResult, WizardStepStatus } from "./types";

export const WIZARD_STEPS: WizardStepDef[] = [
  {
    id: "academic_structure",
    order: 1,
    titleAr: "البنية الأكاديمية",
    helpEli5Ar: "مثل خريطة الكلية: أقسام وبرامج وفصول دراسية. بدونها لا نعرف أين يدرس الطلاب.",
    fixHref: "/programs",
  },
  {
    id: "study_plans",
    order: 2,
    titleAr: "الخطط الدراسية",
    helpEli5Ar: "الخطة تقول أي مقررات يدرسها الطالب في كل مستوى. بدونها لا نعرف ماذا نجدول.",
    fixHref: "/study-plans",
  },
  {
    id: "cohorts",
    order: 3,
    titleAr: "الدفعات الدراسية",
    helpEli5Ar: "الدفعة = مجموعة طلاب في نفس البرنامج والمستوى والفصل. هي أساس التدفق الجديد.",
    fixHref: "/academic-cohorts",
  },
  {
    id: "delivery_groups",
    order: 4,
    titleAr: "مجموعات المحاضرات والمعامل",
    helpEli5Ar: "تقسيم الدفعة إلى مجموعات محاضرة/معمل بحجم مناسب للقاعات. تُولَّد من الدفعة.",
    fixHref: "/delivery-groups",
  },
  {
    id: "instructors",
    order: 5,
    titleAr: "المحاضرون",
    helpEli5Ar: "قائمة من يدرّس. بدون محاضرين لا يمكن إسناد المقررات.",
    fixHref: "/instructors",
  },
  {
    id: "rooms",
    order: 6,
    titleAr: "القاعات والمعامل",
    helpEli5Ar: "أماكن التدريس بسعة ونوع صحيحين. قاعة بسعة صفر تمنع الجدولة.",
    fixHref: "/rooms",
  },
  {
    id: "teaching_assignments",
    order: 7,
    titleAr: "الإسناد التدريسي",
    helpEli5Ar: "ربط كل مجموعة محاضرات بمحاضر (التدفق الجديد V2). بدون إسناد لا تُنشأ محاضرات.",
    fixHref: "/teaching-assignments",
  },
  {
    id: "constraints",
    order: 8,
    titleAr: "القيود والتوفر",
    helpEli5Ar:
      "أيام العمل، قوالب الفترات، وتوفّر المحاضرين — خاصة المحاضرين من كليات أخرى. بدونها الجدول غير واقعي.",
    fixHref: "/availability",
  },
  {
    id: "readiness_check",
    order: 9,
    titleAr: "فحص الجاهزية",
    helpEli5Ar: "ملخص سريع: هل بقي شيء يمنع إنشاء الجدول؟ الحواجز الحمراء يجب إصلاحها أولاً.",
    fixHref: "/data-onboarding",
  },
  {
    id: "create_schedule_version",
    order: 10,
    titleAr: "إنشاء نسخة جدول",
    helpEli5Ar:
      "بعد الجاهزية: أنشئ نسخة مسودة من صفحة نسخ الجدول ثم شغّل الجدولة التلقائية إن لزم.",
    fixHref: "/schedule-versions",
  },
];

export interface OnboardingCounts {
  departments: number;
  programs: number;
  terms: number;
  planCourses: number;
  cohorts: number;
  deliveryGroups: number;
  instructors: number;
  rooms: number;
  /** TA rows with delivery_group_id (New Flow V2). */
  teachingAssignmentsV2: number;
  /** Instructors with at least one availability row. */
  instructorsWithAvailability: number;
  scheduleVersions: number;
}

function metricsMissing(metrics: ReadinessMetric[], pred: (m: ReadinessMetric) => boolean): number {
  return metrics.filter(pred).reduce((s, m) => s + m.missing, 0);
}

function statusFromCounts(opts: {
  empty: boolean;
  blockerMissing: number;
  warnMissing: number;
}): WizardStepStatus {
  if (opts.empty) return "incomplete";
  if (opts.blockerMissing > 0) return "blocker";
  if (opts.warnMissing > 0) return "warning";
  return "complete";
}

function detail(status: WizardStepStatus, okMsg: string, badMsg: string): string {
  return status === "complete" ? okMsg : badMsg;
}

/**
 * Derive wizard step statuses from read-only counts + New Flow readiness metrics.
 * Never writes to the database.
 */
export function buildWizardStepResults(
  counts: OnboardingCounts,
  readiness: ReadinessData,
): WizardStepResult[] {
  const allMetrics = [...readiness.studyPlan, ...readiness.resources, ...readiness.scheduling];
  const newFlowIssues = classifyNewFlowReadinessIssues(allMetrics);
  const blockers = newFlowBlockers(newFlowIssues);
  const severityCounts = countSeverities(newFlowIssues);

  const studyPlanMissing = readiness.studyPlan.reduce((s, m) => s + m.missing, 0);
  const studyPlanCritical = metricsMissing(
    readiness.studyPlan,
    (m) => !!m.critical && m.missing > 0,
  );
  // ROOMS-CAPACITY-DIAGNOSTICS-FIX-01 — a room whose capacity matches its type
  // default is healthy. Only critical room findings block; uniform-capacity
  // deviations are surfaced as a review warning.
  const isRoomMetric = (m: ReadinessMetric) =>
    m.label.includes("قاعات") || m.label.includes("أنواع قاعات");
  const roomCritical = metricsMissing(
    readiness.resources,
    (m) => isRoomMetric(m) && !!m.critical && m.missing > 0,
  );
  const roomWarnings = metricsMissing(
    readiness.resources,
    (m) => isRoomMetric(m) && !m.critical && m.missing > 0,
  );
  const instructorGaps = metricsMissing(
    readiness.resources,
    (m) => m.label.includes("محاضر") && m.missing > 0,
  );
  const cohortDgMissing = metricsMissing(
    readiness.scheduling,
    (m) => m.label.includes("بدون مجموعات") && m.missing > 0,
  );
  const taV2Missing = metricsMissing(
    readiness.scheduling,
    (m) =>
      (m.label.includes("بدون إسناد تدريسي (V2)") || m.label.includes("إسناد تدريسي (V2) بدون")) &&
      m.missing > 0,
  );
  const headcountMissing = metricsMissing(
    readiness.scheduling,
    (m) => m.label.includes("SCHEDULING_HEADCOUNT") && m.missing > 0,
  );

  const byId: Record<
    WizardStepId,
    Omit<WizardStepResult, "id" | "titleAr" | "helpEli5Ar" | "fixHref">
  > = {
    academic_structure: (() => {
      const empty = counts.departments === 0 || counts.programs === 0 || counts.terms === 0;
      const status = empty ? "incomplete" : "complete";
      return {
        status,
        detailAr: detail(
          status,
          `أقسام ${counts.departments} · برامج ${counts.programs} · فصول ${counts.terms}`,
          "أضف قسماً وبرنامجاً وفصلاً أكاديمياً نشطاً للبدء.",
        ),
      };
    })(),
    study_plans: (() => {
      const empty = counts.planCourses === 0;
      const status = statusFromCounts({
        empty,
        blockerMissing: studyPlanCritical,
        warnMissing: studyPlanMissing,
      });
      return {
        status: empty
          ? "incomplete"
          : status === "complete" && studyPlanMissing > 0
            ? "needs-review"
            : status,
        detailAr: detail(
          empty ? "incomplete" : status,
          `صفوف الخطة: ${counts.planCourses}`,
          empty
            ? "اربط المقررات بالخطط والمستويات."
            : `${studyPlanMissing} نقص في بيانات الخطة تحتاج مراجعة.`,
        ),
      };
    })(),
    cohorts: (() => {
      const empty = counts.cohorts === 0;
      const status = statusFromCounts({
        empty,
        blockerMissing: headcountMissing,
        warnMissing: 0,
      });
      return {
        status: empty ? "incomplete" : status,
        detailAr: detail(
          empty ? "incomplete" : status,
          `دفعات: ${counts.cohorts}`,
          empty
            ? "أنشئ دفعات دراسية للتدفق الجديد."
            : headcountMissing > 0
              ? "بعض الدفعات بلا عدد طلاب معتمد للجدولة."
              : "راجع الدفعات.",
        ),
      };
    })(),
    delivery_groups: (() => {
      const empty = counts.deliveryGroups === 0;
      const status = statusFromCounts({
        empty,
        blockerMissing: cohortDgMissing,
        warnMissing: 0,
      });
      return {
        status: empty ? "incomplete" : status,
        detailAr: detail(
          empty ? "incomplete" : status,
          `مجموعات: ${counts.deliveryGroups}`,
          empty
            ? "ولّد مجموعات المحاضرات من الدفعات."
            : "بعض الدفعات النشطة بلا مجموعات محاضرات/معامل.",
        ),
      };
    })(),
    instructors: (() => {
      const empty = counts.instructors === 0;
      const status = statusFromCounts({
        empty,
        blockerMissing: 0,
        warnMissing: instructorGaps,
      });
      return {
        status: empty ? "incomplete" : status,
        detailAr: detail(
          empty ? "incomplete" : status,
          `محاضرون: ${counts.instructors}`,
          empty ? "أضف المحاضرين." : "أكمل تخصص/قسم بعض المحاضرين.",
        ),
      };
    })(),
    rooms: (() => {
      const empty = counts.rooms === 0;
      const status = statusFromCounts({
        empty,
        blockerMissing: roomCritical,
        warnMissing: roomWarnings,
      });
      return {
        status: empty ? "incomplete" : status,
        detailAr: detail(
          empty ? "incomplete" : status,
          `قاعات: ${counts.rooms}`,
          empty
            ? "أضف القاعات وأنواعها وسعاتها."
            : roomCritical > 0
              ? "يوجد قاعات بسعة غير صالحة أو بدون نوع."
              : "راجع تفاوت السعات بين غرف النوع نفسه.",
        ),
      };
    })(),
    teaching_assignments: (() => {
      const empty = counts.teachingAssignmentsV2 === 0;
      const status = statusFromCounts({
        empty,
        blockerMissing: taV2Missing,
        warnMissing: 0,
      });
      return {
        status: empty ? "incomplete" : status,
        detailAr: detail(
          empty ? "incomplete" : status,
          `إسناد V2: ${counts.teachingAssignmentsV2}`,
          empty ? "أكمل الإسناد التدريسي للمجموعات." : "مجموعات أو إسنادات V2 تحتاج محاضرين.",
        ),
      };
    })(),
    constraints: (() => {
      const empty = counts.instructors > 0 && counts.instructorsWithAvailability === 0;
      // Availability gaps for external instructors show as critical in resources/scheduling
      // when present; here we only signal incomplete/warning from local counts.
      const status: WizardStepStatus = empty
        ? "warning"
        : counts.instructorsWithAvailability > 0
          ? "complete"
          : counts.instructors === 0
            ? "incomplete"
            : "needs-review";
      return {
        status,
        detailAr:
          status === "complete"
            ? `محاضرون لديهم توفر: ${counts.instructorsWithAvailability}`
            : "راجع أيام العمل وقوالب الفترات وتوفّر المحاضرين من كليات أخرى.",
      };
    })(),
    readiness_check: (() => {
      const status: WizardStepStatus =
        blockers.length > 0
          ? "blocker"
          : severityCounts.WARNING > 0
            ? "warning"
            : severityCounts.INFO > 0
              ? "needs-review"
              : "complete";
      return {
        status,
        detailAr: `حواجز ${severityCounts.BLOCKER} · تحذيرات ${severityCounts.WARNING} · معلومات ${severityCounts.INFO}`,
      };
    })(),
    create_schedule_version: (() => {
      const blocked = blockers.length > 0;
      const status: WizardStepStatus = blocked
        ? "blocker"
        : counts.scheduleVersions > 0
          ? "complete"
          : "incomplete";
      return {
        status,
        detailAr: blocked
          ? "أصلح حواجز الجاهزية قبل إنشاء/تشغيل نسخة الجدول."
          : counts.scheduleVersions > 0
            ? `نسخ موجودة: ${counts.scheduleVersions} — يمكنك فتح نسخ الجدول.`
            : "أنشئ نسخة مسودة من صفحة نسخ الجدول (رابط فقط من هنا).",
      };
    })(),
  };

  return WIZARD_STEPS.map((step) => {
    const body = byId[step.id];
    return {
      id: step.id,
      titleAr: step.titleAr,
      helpEli5Ar: step.helpEli5Ar,
      fixHref: step.fixHref,
      status: body.status,
      detailAr: body.detailAr,
    };
  });
}

export function wizardPercentComplete(steps: WizardStepResult[]): number {
  const preparation = steps.filter((s) => s.id !== "create_schedule_version");
  if (preparation.length === 0) return 0;
  const done = preparation.filter((s) => s.status === "complete").length;
  return Math.round((done * 100) / preparation.length);
}

export function worstStepStatus(steps: WizardStepResult[]): WizardStepStatus {
  const order: WizardStepStatus[] = [
    "blocker",
    "incomplete",
    "warning",
    "needs-review",
    "complete",
  ];
  for (const s of order) {
    if (steps.some((step) => step.status === s)) return s;
  }
  return "complete";
}

/** Re-export severity helper for UI badges. */
export { classifyMetricSeverity, classifyNewFlowReadinessIssues, countSeverities, newFlowBlockers };
