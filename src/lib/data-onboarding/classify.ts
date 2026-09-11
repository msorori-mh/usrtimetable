import type { ReadinessMetric } from "@/lib/reports/readiness";
import type {
  ClassifiedReadinessIssue,
  PilotStudySystem,
  ReadinessFlowKind,
  ReadinessIssueSeverity,
  ReadinessSeverityCounts,
} from "./types";
import { PILOT_STUDY_SYSTEMS } from "./types";
import { instructorReviewForMetric } from "./instructor-review";

/** Labels that belong exclusively to the Legacy course-offering / V1 TA path. */
const LEGACY_LABEL_MARKERS = [
  "عروض مقررات",
  "إسناد بدون محاضر", // V1 (New Flow uses "إسناد تدريسي (V2) بدون محاضر")
] as const;

/** Labels that belong exclusively to New Flow (cohort / DG / TA V2). */
const NEW_FLOW_LABEL_MARKERS = [
  "SCHEDULING_HEADCOUNT_MISSING",
  "دفعات نشطة",
  "دفعات دراسية",
  "مجموعات محاضرات/معامل",
  "إسناد تدريسي (V2)",
  "هوية دفعة/مجموعة",
  "التدفق الجديد",
] as const;

/**
 * Classify a readiness metric as New Flow, Legacy, or shared foundational.
 * Wizard / New Flow dashboard never surfaces Legacy-only metrics.
 */
export function classifyReadinessMetricFlow(metric: ReadinessMetric): ReadinessFlowKind {
  const label = metric.label;
  for (const marker of NEW_FLOW_LABEL_MARKERS) {
    if (label.includes(marker)) return "new_flow";
  }
  for (const marker of LEGACY_LABEL_MARKERS) {
    // Avoid classifying the V2 instructor-missing metric as Legacy.
    if (marker === "إسناد بدون محاضر" && label.includes("(V2)")) continue;
    if (label.includes(marker)) return "legacy";
  }
  return "shared";
}

export function isNewFlowReadinessMetric(metric: ReadinessMetric): boolean {
  const kind = classifyReadinessMetricFlow(metric);
  return kind === "new_flow" || kind === "shared";
}

export function classifyMetricSeverity(metric: ReadinessMetric): ReadinessIssueSeverity {
  if (metric.missing <= 0) return "INFO";
  if (metric.critical) return "BLOCKER";
  const pct = metric.total > 0 ? (metric.missing * 100) / metric.total : 100;
  if (pct >= 50) return "BLOCKER";
  if (pct >= 20) return "WARNING";
  return "INFO";
}

/** Map metric labels to existing fix routes (أصلح الآن). */
export function fixHrefForMetric(metric: ReadinessMetric): { href: string; labelAr: string } {
  const label = metric.label;
  if (label.includes("SCHEDULING_HEADCOUNT"))
    return { href: "/scheduling-headcounts", labelAr: "اعتماد أعداد الطلاب" };
  if (label.includes("إسناد") && !label.includes("توفر") && !label.includes("توفّر"))
    return { href: "/teaching-assignments", labelAr: "إكمال الإسناد التدريسي" };
  if (label.includes("بدون مجموعات") || label.includes("هوية دفعة/مجموعة"))
    return { href: "/delivery-groups", labelAr: "مراجعة مجموعات المحاضرات والمعامل" };
  if (label.includes("غير مرتبطة بأي خطة")) {
    return { href: "/study-plans", labelAr: "أصلح الآن — إدارة مقررات الخطة" };
  }
  if (label.includes("خطة") || metric.category === "study_plan") {
    return { href: "/study-plans", labelAr: "أصلح الآن — الخطط الدراسية" };
  }
  if (label.includes("محاضر") && !label.includes("قاعة")) {
    if (label.includes("توفر") || label.includes("توفّر")) {
      return { href: "/availability", labelAr: "أصلح الآن — التوفر" };
    }
    return { href: "/instructors", labelAr: "أصلح الآن — المحاضرون" };
  }
  if (label.includes("قاعة") || label.includes("معمل")) {
    return { href: "/rooms", labelAr: "أصلح الآن — القاعات" };
  }
  if (label.includes("دفعة") || label.includes("SCHEDULING_HEADCOUNT")) {
    if (label.includes("عدد") || label.includes("HEADCOUNT")) {
      return { href: "/scheduling-headcounts", labelAr: "أصلح الآن — أعداد الدفعات" };
    }
    return { href: "/academic-cohorts", labelAr: "أصلح الآن — الدفعات" };
  }
  if (label.includes("مجموعات محاضرات") || label.includes("مجموعة")) {
    return { href: "/delivery-groups", labelAr: "أصلح الآن — مجموعات المحاضرات" };
  }
  if (label.includes("إسناد")) {
    return { href: "/teaching-assignments", labelAr: "أصلح الآن — الإسناد التدريسي" };
  }
  if (label.includes("محاضرة") || label.includes("جدولة")) {
    return { href: "/auto-schedule", labelAr: "أصلح الآن — الجدولة التلقائية" };
  }
  if (metric.category === "resources") {
    return { href: "/rooms", labelAr: "أصلح الآن — الموارد" };
  }
  return { href: "/data-onboarding", labelAr: "أصلح الآن" };
}

export function classifyNewFlowReadinessIssues(
  metrics: ReadinessMetric[],
): ClassifiedReadinessIssue[] {
  return metrics.filter(isNewFlowReadinessMetric).map((m) => {
    const severity = classifyMetricSeverity(m);
    const fix = fixHrefForMetric(m);
    return {
      label: m.label,
      severity,
      flow: classifyReadinessMetricFlow(m),
      missing: m.missing,
      total: m.total,
      fixHref: m.missing > 0 ? fix.href : null,
      fixSearch:
        m.missing > 0 && instructorReviewForMetric(m.label)
          ? { review: instructorReviewForMetric(m.label) }
          : undefined,
      fixLabelAr: fix.labelAr,
    };
  });
}

export function countSeverities(issues: ClassifiedReadinessIssue[]): ReadinessSeverityCounts {
  const counts: ReadinessSeverityCounts = { BLOCKER: 0, WARNING: 0, INFO: 0 };
  for (const issue of issues) {
    if (issue.missing <= 0) continue;
    counts[issue.severity] += 1;
  }
  return counts;
}

export function newFlowBlockers(issues: ClassifiedReadinessIssue[]): ClassifiedReadinessIssue[] {
  return issues.filter((i) => i.missing > 0 && i.severity === "BLOCKER");
}

/**
 * Guard for optional study-system filters: never treat "all" as merging
 * regular+parallel into one operational bucket for New Flow readiness.
 * Returns true only when the filter is a single Pilot system or unset.
 */
export function isStudySystemFilterIsolated(
  studySystem: PilotStudySystem | "all" | null | undefined,
): boolean {
  if (studySystem == null || studySystem === "all") return true;
  return (PILOT_STUDY_SYSTEMS as readonly string[]).includes(studySystem);
}

/** Pure partition helper — regular and parallel never share a bucket. */
export function partitionByStudySystem<T extends { study_system?: string | null }>(
  rows: T[],
): Record<PilotStudySystem, T[]> {
  const out: Record<PilotStudySystem, T[]> = { regular: [], parallel: [] };
  for (const row of rows) {
    const sys = row.study_system;
    if (sys === "regular") out.regular.push(row);
    else if (sys === "parallel") out.parallel.push(row);
  }
  return out;
}
