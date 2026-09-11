import { fetchStudyPlanReadiness } from "@/lib/academic-delivery/fetch-study-plan-readiness";
import { supabase } from "@/integrations/supabase/client";
import {
  isMissingInstructorSpecialization,
  isMissingInstructorDepartment,
} from "@/lib/data-onboarding/instructor-review";
import { roomCapacityReadinessMetrics } from "./room-capacity-readiness";

export interface ReadinessMetric {
  label: string;
  total: number;
  missing: number;
  critical?: boolean;
  category: "study_plan" | "resources" | "scheduling";
}

export interface ReadinessCheckRow extends Record<string, unknown> {
  category: string;
  check_name: string;
  status: string;
  missing_count: number;
  total_count: number;
  pct_missing: number;
  severity: string;
  message: string;
  suggested_action: string;
}

export interface ReadinessData {
  totals: Record<string, number>;
  studyPlan: ReadinessMetric[];
  resources: ReadinessMetric[];
  scheduling: ReadinessMetric[];
  scores: {
    studyPlanScore: number;
    resourcesScore: number;
    schedulingScore: number;
    overall: number;
  };
}

const CATEGORY_LABELS: Record<ReadinessMetric["category"], string> = {
  study_plan: "الخطط الدراسية",
  resources: "الموارد",
  scheduling: "الجدولة",
};

const SUGGESTED_ACTIONS: Record<string, string> = {
  study_plan: "راجع الخطط الدراسية واربط المقررات بالمستويات والفصول.",
  resources: "أكمل بيانات المحاضرين والقاعات في صفحات الموارد.",
  scheduling: "راجع عروض المقررات والإسناد قبل الجدولة.",
};

function score(items: ReadinessMetric[]): number {
  const denom = items.reduce((s, m) => s + (m.total || 0), 0);
  const miss = items.reduce((s, m) => s + (m.missing || 0), 0);
  if (denom === 0) return 0;
  return Math.max(0, Math.min(100, Math.round(100 - (miss * 100) / denom)));
}

function metricStatus(m: ReadinessMetric): string {
  if (m.missing === 0) return "جاهز";
  if (m.critical) return "حرج";
  const pct = m.total > 0 ? (m.missing * 100) / m.total : 100;
  if (pct >= 50) return "حرج";
  if (pct >= 20) return "يحتاج مراجعة";
  return "تحذير";
}

function metricSeverity(m: ReadinessMetric): string {
  const st = metricStatus(m);
  if (st === "جاهز") return "منخفض";
  if (st === "حرج") return "عالٍ";
  if (st === "يحتاج مراجعة") return "متوسط";
  return "منخفض";
}

/** Score band for dashboard cards (shared with /data-readiness). */
export function readinessScoreStatus(score: number): {
  label: string;
  tone: "ok" | "warn" | "bad";
} {
  if (score >= 80) return { label: "جاهز", tone: "ok" };
  if (score >= 50) return { label: "يحتاج مراجعة", tone: "warn" };
  return { label: "حرج", tone: "bad" };
}

/**
 * A1.5 New Flow readiness signals (cohort / delivery-group / TA V2 / session
 * identity). Fail-closed by design: any error (e.g. Phase 9.x columns not yet
 * applied in a given environment) yields `null`, and the caller surfaces a
 * single informational metric instead of presenting stale V1 data as New Flow
 * truth — and never breaks the base readiness report.
 */
interface NewFlowSignals {
  cohorts: { id: string; active: boolean | null; term_id: string }[];
  deliveryGroups: { id: string; cohort_id: string | null }[];
  dgAssignments: { delivery_group_id: string | null; instructor_id: string | null }[];
  sessionIdentity: { id: string; cohort_id: string | null; delivery_group_id: string | null }[];
  approvedHeadcounts: { cohort_id: string; term_id: string }[];
}

async function fetchNewFlowSignals(collegeId: string): Promise<NewFlowSignals | null> {
  try {
    const [cohorts, deliveryGroups, dgAssignments, sessionIdentity, approvedHeadcounts] =
      await Promise.all([
        supabase.from("academic_cohorts").select("id, active, term_id").eq("college_id", collegeId),
        // DELIVERY-GROUP-COVERAGE-FIX-01: historical (obsolete) groups never count.
        supabase
          .from("delivery_groups")
          .select("id, cohort_id")
          .eq("college_id", collegeId)
          .or("is_obsolete.is.null,is_obsolete.eq.false"),
        supabase
          .from("teaching_assignments")
          .select("delivery_group_id, instructor_id")
          .eq("college_id", collegeId)
          .or("is_active.is.null,is_active.eq.true")
          .not("delivery_group_id", "is", null),
        supabase
          .from("schedule_sessions")
          .select("id, cohort_id, delivery_group_id")
          .eq("college_id", collegeId),
        // Generated client types can lag a source-only migration; runtime errors
        // are still checked and thrown below.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any)
          .from("scheduling_cohort_term_headcounts")
          .select("cohort_id, term_id")
          .eq("college_id", collegeId)
          .eq("approval_status", "approved"),
      ]);
    const error =
      cohorts.error ||
      deliveryGroups.error ||
      dgAssignments.error ||
      sessionIdentity.error ||
      approvedHeadcounts.error;
    if (error) throw new Error(`NEW_FLOW_READINESS_QUERY_FAILED: ${error.message}`);
    return {
      cohorts: (cohorts.data ?? []) as NewFlowSignals["cohorts"],
      deliveryGroups: (deliveryGroups.data ?? []) as NewFlowSignals["deliveryGroups"],
      dgAssignments: (dgAssignments.data ?? []) as NewFlowSignals["dgAssignments"],
      sessionIdentity: (sessionIdentity.data ?? []) as NewFlowSignals["sessionIdentity"],
      approvedHeadcounts: (approvedHeadcounts.data ?? []) as NewFlowSignals["approvedHeadcounts"],
    };
  } catch (error) {
    throw error instanceof Error
      ? error
      : new Error("NEW_FLOW_READINESS_QUERY_FAILED: unknown query failure");
  }
}

/** New Flow (cohort/DG/TA V2) readiness metrics — appended to the scheduling category. */
export function newFlowReadinessMetrics(signals: NewFlowSignals | null): ReadinessMetric[] {
  if (signals === null) {
    return [
      {
        label:
          "مقاييس التدفق الجديد (الدفعات/المجموعات) غير متاحة — بنية V2 غير مكتملة في هذه البيئة",
        total: 1,
        missing: 1,
        critical: true,
        category: "scheduling",
      },
    ];
  }
  const activeCohorts = signals.cohorts.filter((c) => c.active !== false);
  const cohortsWithGroups = new Set(signals.deliveryGroups.map((d) => d.cohort_id));
  const assignedGroups = new Set(signals.dgAssignments.map((a) => a.delivery_group_id));
  const approvedHeadcountKeys = new Set(
    signals.approvedHeadcounts.map((h) => `${h.cohort_id}:${h.term_id}`),
  );
  return [
    {
      label: "دفعات نشطة دون عدد معتمد للجدولة (SCHEDULING_HEADCOUNT_MISSING)",
      total: activeCohorts.length,
      missing: activeCohorts.filter((c) => !approvedHeadcountKeys.has(`${c.id}:${c.term_id}`))
        .length,
      critical: true,
      category: "scheduling",
    },
    {
      label: "دفعات دراسية نشطة بدون مجموعات محاضرات/معامل",
      total: activeCohorts.length,
      missing: activeCohorts.filter((c) => !cohortsWithGroups.has(c.id)).length,
      category: "scheduling",
    },
    {
      label: "مجموعات محاضرات/معامل بدون إسناد تدريسي (V2)",
      total: signals.deliveryGroups.length,
      missing: signals.deliveryGroups.filter((d) => !assignedGroups.has(d.id)).length,
      category: "scheduling",
    },
    {
      label: "إسناد تدريسي (V2) بدون محاضر",
      total: signals.dgAssignments.length,
      missing: signals.dgAssignments.filter((a) => !a.instructor_id).length,
      critical: true,
      category: "scheduling",
    },
    {
      label: "محاضرات بدون هوية دفعة/مجموعة (توافقية)",
      total: signals.sessionIdentity.length,
      missing: signals.sessionIdentity.filter((s) => !s.cohort_id && !s.delivery_group_id).length,
      category: "scheduling",
    },
  ];
}

/** College-level readiness checks (read-only). Same logic as /data-readiness dashboard. */
export async function fetchCollegeReadiness(collegeId: string): Promise<ReadinessData> {
  const [courses, planCourses, instructors, rooms, offerings, assignments, sessions, roomTypes] =
    await Promise.all([
      supabase
        .from("courses")
        .select("id, code, name", { count: "exact" })
        .eq("college_id", collegeId),
      supabase
        .from("plan_courses")
        .select(
          "id, level_id, semester, lectures_per_week, labs_per_week, lecture_session_duration, lab_session_duration, course_id",
          { count: "exact" },
        )
        .eq("college_id", collegeId),
      supabase
        .from("instructors")
        .select("id, specialization, department_id", { count: "exact" })
        .eq("college_id", collegeId),
      supabase
        .from("rooms")
        .select("id, capacity, room_type_id, room_type, is_active", { count: "exact" })
        .eq("college_id", collegeId),
      supabase
        .from("course_offerings")
        .select("id, expected_students", { count: "exact" })
        .eq("college_id", collegeId),
      supabase
        .from("teaching_assignments")
        .select("id, instructor_id, course_offering_id", { count: "exact" })
        .eq("college_id", collegeId),
      supabase
        .from("schedule_sessions")
        .select("id, room_id, start_time, end_time, day_of_week", { count: "exact" })
        .eq("college_id", collegeId),
      supabase
        .from("room_types")
        .select("id, default_capacity, name_ar")
        .eq("college_id", collegeId),
    ]);

  const baseQueries = [
    ["courses", courses],
    ["plan_courses", planCourses],
    ["instructors", instructors],
    ["rooms", rooms],
    ["course_offerings", offerings],
    ["teaching_assignments", assignments],
    ["schedule_sessions", sessions],
    ["room_types", roomTypes],
  ] as const;
  for (const [relation, result] of baseQueries) {
    if (result.error) {
      throw new Error(`READINESS_QUERY_FAILED[${relation}]: ${result.error.message}`);
    }
  }

  const coursesRows = courses.data ?? [];
  const planRows = planCourses.data ?? [];
  const instructorsRows = instructors.data ?? [];
  const roomsRows = rooms.data ?? [];
  const offeringsRows = offerings.data ?? [];
  const assignmentsRows = assignments.data ?? [];
  const sessionsRows = sessions.data ?? [];
  const roomTypeMap = new Map(
    (roomTypes.data ?? []).map((r: { id: string; default_capacity: number }) => [
      r.id,
      r.default_capacity,
    ]),
  );

  const offeringsWithAssignments = new Set(
    assignmentsRows.map((a: { course_offering_id: string }) => a.course_offering_id),
  );

  const { metrics: studyPlan } = await fetchStudyPlanReadiness(collegeId, coursesRows, planRows);

  const resources: ReadinessMetric[] = [
    {
      label: "محاضرون بدون تخصص",
      total: instructorsRows.length,
      missing: instructorsRows.filter(isMissingInstructorSpecialization).length,
      category: "resources",
    },
    {
      label: "محاضرون بدون قسم",
      total: instructorsRows.length,
      missing: instructorsRows.filter(isMissingInstructorDepartment).length,
      category: "resources",
    },
    ...roomCapacityReadinessMetrics(
      roomsRows as {
        id: string;
        capacity: number | null;
        room_type_id: string | null;
        room_type?: string | null;
        is_active?: boolean | null;
      }[],
      (roomTypes.data ?? []) as { id: string; default_capacity: number | null }[],
    ),
  ];

  const scheduling: ReadinessMetric[] = [
    {
      label: "عروض مقررات بأعداد طلاب ≤ 0",
      total: offeringsRows.length,
      missing: offeringsRows.filter(
        (o: { expected_students: number | null }) =>
          !o.expected_students || o.expected_students <= 0,
      ).length,
      category: "scheduling",
    },
    {
      label: "عروض مقررات بدون إسناد تدريسي",
      total: offeringsRows.length,
      missing: offeringsRows.filter((o: { id: string }) => !offeringsWithAssignments.has(o.id))
        .length,
      category: "scheduling",
    },
    {
      label: "إسناد بدون محاضر",
      total: assignmentsRows.length,
      missing: assignmentsRows.filter((a: { instructor_id: string | null }) => !a.instructor_id)
        .length,
      critical: true,
      category: "scheduling",
    },
    {
      label: "محاضرات بدون قاعة",
      total: sessionsRows.length,
      missing: sessionsRows.filter((s: { room_id: string | null }) => !s.room_id).length,
      category: "scheduling",
    },
    {
      label: "محاضرات بدون وقت",
      total: sessionsRows.length,
      missing: sessionsRows.filter(
        (s: { start_time: string | null; end_time: string | null; day_of_week: number | null }) =>
          !s.start_time || !s.end_time || s.day_of_week === null,
      ).length,
      category: "scheduling",
    },
  ];

  // A1.5: New Flow cohort/DG/TA V2 readiness — separate fail-closed fetch so a
  // partially-applied V2 schema degrades to an informational note, never a crash.
  const newFlowSignals = await fetchNewFlowSignals(collegeId);
  scheduling.push(...newFlowReadinessMetrics(newFlowSignals));

  const studyPlanScore = score(studyPlan);
  const resourcesScore = score(resources);
  const schedulingScore = score(scheduling);

  return {
    totals: {
      courses: courses.count ?? 0,
      planCourses: planCourses.count ?? 0,
      instructors: instructors.count ?? 0,
      rooms: rooms.count ?? 0,
      offerings: offerings.count ?? 0,
      assignments: assignments.count ?? 0,
      sessions: sessions.count ?? 0,
    },
    studyPlan,
    resources,
    scheduling,
    scores: {
      studyPlanScore,
      resourcesScore,
      schedulingScore,
      overall: Math.round((studyPlanScore + resourcesScore + schedulingScore) / 3),
    },
  };
}

export function readinessMetricsToRows(data: ReadinessData): ReadinessCheckRow[] {
  const all = [...data.studyPlan, ...data.resources, ...data.scheduling];
  return all.map((m) => {
    const pct = m.total > 0 ? Math.round((m.missing * 100) / m.total) : 0;
    const status = metricStatus(m);
    return {
      category: CATEGORY_LABELS[m.category],
      check_name: m.label,
      status,
      missing_count: m.missing,
      total_count: m.total,
      pct_missing: pct,
      severity: metricSeverity(m),
      message: m.missing === 0 ? "لا توجد مشكلات." : `${m.missing} من ${m.total} (${pct}%)`,
      suggested_action: m.missing === 0 ? "—" : SUGGESTED_ACTIONS[m.category],
    };
  });
}
