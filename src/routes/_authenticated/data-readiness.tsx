import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  isMissingInstructorSpecialization,
  isMissingInstructorDepartment,
} from "@/lib/data-onboarding/instructor-review";
import { useActiveCollege } from "@/hooks/use-colleges";
import { CollegeSwitcher } from "@/components/college-switcher";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Gauge,
  BookOpen,
  Users,
  CalendarClock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  CalendarCheck,
} from "lucide-react";
import {
  categorizeInstructor,
  type InstructorCategory,
  CATEGORY_LABEL_AR,
} from "@/lib/instructor-category";
import { PLAN_COMPONENT_ROOM_TYPE_MISSING_BLOCKER } from "@/lib/academic-delivery/plan-component-room-type-readiness";
import { fetchStudyPlanReadiness } from "@/lib/academic-delivery/fetch-study-plan-readiness";
import { roomCapacityReadinessMetrics } from "@/lib/reports/room-capacity-readiness";
import { fetchActionableScheduleVersionIds } from "@/lib/reports/readiness";

export const Route = createFileRoute("/_authenticated/data-readiness")({
  head: () => ({ meta: [{ title: "جاهزية البيانات" }] }),
  component: DataReadinessPage,
});

type Metric = { label: string; total: number; missing: number; critical?: boolean };

type ReadinessCourseRow = { id: string; code: string; name: string };
type ReadinessPlanCourseRow = {
  id: string;
  level_id: string | null;
  semester: number | null;
  lectures_per_week: number | null;
  labs_per_week: number | null;
  lecture_session_duration: number | null;
  lab_session_duration: number | null;
  course_id: string;
};
type ReadinessInstructorRow = {
  id: string;
  specialization: string | null;
  department_id: string | null;
  instructor_type_id: string | null;
};
type ReadinessInstructorTypeRow = { id: string; code: string; is_external: boolean };
type ReadinessRoomRow = {
  id: string;
  capacity: number | null;
  room_type_id: string | null;
  room_type: string | null;
  is_active: boolean | null;
};
type ReadinessOfferingRow = { id: string; expected_students: number | null };
type ReadinessAssignmentRow = {
  id: string;
  instructor_id: string | null;
  course_offering_id: string;
};
type ReadinessSessionRow = {
  id: string;
  room_id: string | null;
  start_time: string | null;
  end_time: string | null;
  day_of_week: number | null;
};
type ReadinessRoomTypeRow = { id: string; default_capacity: number | null };
type ReadinessAvailabilityRow = {
  instructor_id: string;
  availability_type: string | null;
  is_preference: boolean | null;
};

function withCollegeScope<T extends { eq: (column: string, value: string) => T }>(
  query: T,
  collegeId: string,
): T {
  return query.eq("college_id", collegeId);
}

// A1.5: New Flow readiness signals (cohort/DG/TA V2) — fail-closed; any schema
// gap degrades to one informational metric instead of breaking the dashboard.
async function fetchNewFlowMetrics(
  collegeId: string,
  scheduleVersionIds: string[],
): Promise<Metric[]> {
  try {
    const [cohorts, deliveryGroups, dgAssignments, sessionIdentity] = await Promise.all([
      supabase.from("academic_cohorts").select("id, active").eq("college_id", collegeId),
      // DELIVERY-GROUP-COVERAGE-FIX-01: obsolete groups are historical, not gaps.
      supabase
        .from("operational_delivery_groups")
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
        .eq("college_id", collegeId)
        .in("schedule_version_id", scheduleVersionIds),
    ]);
    if (cohorts.error || deliveryGroups.error || dgAssignments.error || sessionIdentity.error) {
      return [
        {
          label:
            "مقاييس التدفق الجديد (الدفعات/المجموعات) غير متاحة — بنية V2 غير مكتملة في هذه البيئة",
          total: 0,
          missing: 0,
        },
      ];
    }
    const cohortRows = (cohorts.data ?? []) as { id: string; active?: boolean }[];
    const dgRows = (deliveryGroups.data ?? []) as { id: string; cohort_id: string }[];
    const taRows = (dgAssignments.data ?? []) as {
      delivery_group_id: string | null;
      instructor_id: string | null;
    }[];
    const sessRows = (sessionIdentity.data ?? []) as {
      id: string;
      cohort_id: string | null;
      delivery_group_id: string | null;
    }[];
    const activeCohorts = cohortRows.filter((c) => c.active !== false);
    const cohortsWithGroups = new Set(dgRows.map((d) => d.cohort_id));
    const assignedGroups = new Set(taRows.map((a) => a.delivery_group_id));
    return [
      {
        label: "دفعات دراسية نشطة بدون مجموعات محاضرات/معامل",
        total: activeCohorts.length,
        missing: activeCohorts.filter((c) => !cohortsWithGroups.has(c.id)).length,
      },
      {
        label: "مجموعات محاضرات/معامل بدون إسناد تدريسي (V2)",
        total: dgRows.length,
        missing: dgRows.filter((d) => !assignedGroups.has(d.id)).length,
      },
      {
        label: "إسناد تدريسي (V2) بدون محاضر",
        total: taRows.length,
        missing: taRows.filter((a) => !a.instructor_id).length,
        critical: true,
      },
      {
        label: "محاضرات بدون هوية دفعة/مجموعة (توافقية)",
        total: sessRows.length,
        missing: sessRows.filter((s) => !s.cohort_id && !s.delivery_group_id).length,
      },
    ];
  } catch {
    return [
      {
        label:
          "مقاييس التدفق الجديد (الدفعات/المجموعات) غير متاحة — بنية V2 غير مكتملة في هذه البيئة",
        total: 0,
        missing: 0,
      },
    ];
  }
}

async function fetchReadiness(collegeId: string) {
  const scheduleVersionIds = await fetchActionableScheduleVersionIds(collegeId);
  const scope = <T extends { eq: (column: string, value: string) => T }>(query: T) =>
    withCollegeScope(query, collegeId);

  const [
    courses,
    planCourses,
    instructors,
    rooms,
    offerings,
    assignments,
    sessions,
    roomTypes,
    availability,
  ] = await Promise.all([
    scope(supabase.from("courses").select("id, code, name", { count: "exact" })),
    scope(
      supabase
        .from("plan_courses")
        .select(
          "id, level_id, semester, lectures_per_week, labs_per_week, lecture_session_duration, lab_session_duration, course_id",
          { count: "exact" },
        ),
    ),
    scope(
      supabase
        .from("instructors")
        .select("id, specialization, department_id, instructor_type_id", { count: "exact" }),
    ),
    scope(
      supabase
        .from("rooms")
        .select("id, capacity, room_type_id, room_type, is_active", { count: "exact" }),
    ),
    scope(supabase.from("course_offerings").select("id, expected_students", { count: "exact" })),
    scope(
      supabase
        .from("teaching_assignments")
        .select("id, instructor_id, course_offering_id", { count: "exact" }),
    ),
    scope(
      supabase
        .from("schedule_sessions")
        .select("id, room_id, start_time, end_time, day_of_week", { count: "exact" })
        .in("schedule_version_id", scheduleVersionIds),
    ),
    scope(supabase.from("room_types").select("id, default_capacity, name_ar")),
    scope(
      supabase
        .from("instructor_availability")
        .select("instructor_id, availability_type, is_preference"),
    ),
  ]);

  const coursesRows = (courses.data ?? []) as ReadinessCourseRow[];
  const planRows = (planCourses.data ?? []) as ReadinessPlanCourseRow[];
  const instructorsRows = (instructors.data ?? []) as ReadinessInstructorRow[];
  const instructorTypeIds = [
    ...new Set(
      instructorsRows.map((i) => i.instructor_type_id).filter((id): id is string => Boolean(id)),
    ),
  ];
  const { data: instructorTypeRows } =
    instructorTypeIds.length > 0
      ? await supabase
          .from("instructor_types")
          .select("id, code, is_external")
          .eq("college_id", collegeId)
          .in("id", instructorTypeIds)
      : { data: [] as ReadinessInstructorTypeRow[] };
  const instructorTypeMap = new Map(
    ((instructorTypeRows ?? []) as ReadinessInstructorTypeRow[]).map((t) => [t.id, t]),
  );
  const roomsRows = (rooms.data ?? []) as ReadinessRoomRow[];
  const offeringsRows = (offerings.data ?? []) as ReadinessOfferingRow[];
  const assignmentsRows = (assignments.data ?? []) as ReadinessAssignmentRow[];
  const sessionsRows = (sessions.data ?? []) as ReadinessSessionRow[];
  const instructorsWithAvail = new Set(
    ((availability.data ?? []) as ReadinessAvailabilityRow[])
      .filter((row) => row.is_preference !== true && row.availability_type !== "unavailable")
      .map((row) => row.instructor_id),
  );

  const offeringsWithAssignments = new Set(assignmentsRows.map((a) => a.course_offering_id));

  // Shared with the preparation wizard and report exports.
  if (courses.error || planCourses.error) throw courses.error || planCourses.error;
  const { metrics: sp, missingRoomTypes: planComponentRoomTypeMissing } =
    await fetchStudyPlanReadiness(collegeId, coursesRows, planRows);

  // Resource metrics
  const res: Metric[] = [
    {
      label: "محاضرون بدون تخصص",
      total: instructorsRows.length,
      missing: instructorsRows.filter(isMissingInstructorSpecialization).length,
    },
    {
      label: "محاضرون بدون قسم",
      total: instructorsRows.length,
      missing: instructorsRows.filter(isMissingInstructorDepartment).length,
    },
    ...roomCapacityReadinessMetrics(roomsRows, (roomTypes.data ?? []) as ReadinessRoomTypeRow[]),
  ];

  // Instructor availability — per category (Phase 1.5A)
  const byCategory: Record<InstructorCategory, { total: number; configured: number }> = {
    permanent: { total: 0, configured: 0 },
    external: { total: 0, configured: 0 },
    other_college: { total: 0, configured: 0 },
    unspecified: { total: 0, configured: 0 },
  };
  for (const i of instructorsRows) {
    const cat = categorizeInstructor(
      i.instructor_type_id ? (instructorTypeMap.get(i.instructor_type_id) ?? null) : null,
    );
    byCategory[cat].total += 1;
    if (instructorsWithAvail.has(i.id)) byCategory[cat].configured += 1;
  }
  // Availability readiness rules:
  //   permanent → informational (no penalty, default working week assumed)
  //   external / other_college → critical (mandatory before scheduling)
  const avail: Metric[] = [
    {
      label: `محاضرون دائمون (افتراضي): ${byCategory.permanent.configured} / ${byCategory.permanent.total} مُعرَّف صراحة`,
      total: 0, // informational only — excluded from score
      missing: 0,
    },
    {
      // external + other_college share one display label; the internal
      // categorization and readiness semantics are unchanged (sum-based score).
      label: "محاضرون من كلية أخرى بدون نوافذ توفر صريحة",
      total: byCategory.external.total + byCategory.other_college.total,
      missing:
        byCategory.external.total -
        byCategory.external.configured +
        (byCategory.other_college.total - byCategory.other_college.configured),
      critical: true,
    },
    {
      label: "محاضرون غير محددين يجب استبدالهم قبل اعتماد الجدول",
      total: byCategory.unspecified.total,
      missing: byCategory.unspecified.total,
      critical: true,
    },
  ];

  // Scheduling metrics
  const sch: Metric[] = [
    {
      label: "عروض مقررات بأعداد طلاب ≤ 0",
      total: offeringsRows.length,
      missing: offeringsRows.filter((o) => !o.expected_students || o.expected_students <= 0).length,
    },
    {
      label: "عروض مقررات بدون إسناد تدريسي",
      total: offeringsRows.length,
      missing: offeringsRows.filter((o) => !offeringsWithAssignments.has(o.id)).length,
    },
    {
      label: "إسناد بدون محاضر",
      total: assignmentsRows.length,
      missing: assignmentsRows.filter((a) => !a.instructor_id).length,
      critical: true,
    },
    {
      label: "محاضرات بدون قاعة",
      total: sessionsRows.length,
      missing: sessionsRows.filter((s) => !s.room_id).length,
    },
    {
      label: "محاضرات بدون وقت",
      total: sessionsRows.length,
      missing: sessionsRows.filter((s) => !s.start_time || !s.end_time || s.day_of_week === null)
        .length,
    },
  ];

  // A1.5: New Flow cohort/DG/TA V2 readiness (fail-closed, additive).
  sch.push(...(await fetchNewFlowMetrics(collegeId, scheduleVersionIds)));

  const score = (items: Metric[]): number | null => {
    const denom = items.reduce((s, m) => s + (m.total || 0), 0);
    const miss = items.reduce((s, m) => s + (m.missing || 0), 0);
    if (denom === 0) return null;
    return Math.max(0, Math.min(100, Math.round(100 - (miss * 100) / denom)));
  };

  const studyPlanScore = score(sp);
  const resourcesScore = score([...res, ...avail]);
  const schedulingScore = score(sch);
  const presentScores = [studyPlanScore, resourcesScore, schedulingScore].filter(
    (s): s is number => s !== null,
  );
  const overall =
    presentScores.length === 0
      ? null
      : Math.round(presentScores.reduce((a, b) => a + b, 0) / presentScores.length);

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
    studyPlan: sp,
    resources: res,
    availability: avail,
    availabilityByCategory: byCategory,
    scheduling: sch,
    scores: { studyPlanScore, resourcesScore, schedulingScore, overall },
    planComponentRoomTypeMissing,
  };
}

function statusOf(score: number | null): { label: string; tone: "ok" | "warn" | "bad" | "empty" } {
  if (score === null) return { label: "لا توجد بيانات", tone: "empty" };
  if (score >= 80) return { label: "جاهز", tone: "ok" };
  if (score >= 50) return { label: "يحتاج مراجعة", tone: "warn" };
  return { label: "حرج", tone: "bad" };
}

function ScoreCard({
  title,
  score,
  icon,
}: {
  title: string;
  score: number | null;
  icon: React.ReactNode;
}) {
  const s = statusOf(score);
  const tone =
    s.tone === "ok"
      ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
      : s.tone === "warn"
        ? "bg-amber-500/10 text-amber-600 border-amber-500/20"
        : s.tone === "bad"
          ? "bg-red-500/10 text-red-600 border-red-500/20"
          : "bg-muted text-muted-foreground border-border";
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          {icon}
          {title}
        </div>
        <Badge variant="outline" className={tone}>
          {s.label}
        </Badge>
      </div>
      <p className="text-3xl font-bold">
        {score === null ? <span className="text-muted-foreground">—</span> : score}
        <span className="text-base text-muted-foreground">/100</span>
      </p>
      <Progress value={score ?? 0} className="mt-3" />
    </Card>
  );
}

function MetricRow({ m }: { m: Metric }) {
  const pct = m.total > 0 ? Math.round((m.missing * 100) / m.total) : 0;
  const tone =
    m.missing === 0
      ? "text-emerald-600"
      : pct >= 50
        ? "text-red-600"
        : pct >= 20
          ? "text-amber-600"
          : "text-muted-foreground";
  return (
    <li className="flex items-center justify-between gap-3 border-b border-border/60 py-2.5 last:border-0">
      <div className="flex items-center gap-2">
        {m.missing === 0 ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        ) : m.critical ? (
          <XCircle className="h-4 w-4 text-red-500" />
        ) : (
          <AlertTriangle className="h-4 w-4 text-amber-500" />
        )}
        <span className="text-sm">{m.label}</span>
      </div>
      <div className={`text-sm font-medium ${tone}`}>
        {m.missing} / {m.total} <span className="text-xs">({pct}%)</span>
      </div>
    </li>
  );
}

function Section({
  title,
  icon,
  metrics,
}: {
  title: string;
  icon: React.ReactNode;
  metrics: Metric[];
}) {
  return (
    <Card className="p-5">
      <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
        {icon}
        {title}
      </h2>
      <ul>
        {metrics.map((m, i) => (
          <MetricRow key={i} m={m} />
        ))}
      </ul>
    </Card>
  );
}

function DataReadinessPage() {
  const { active } = useActiveCollege();
  const { data, isLoading, error } = useQuery({
    queryKey: ["data-readiness", active?.id],
    enabled: !!active,
    queryFn: () => fetchReadiness(active!.id),
  });

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-6 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-secondary text-primary">
          <Gauge className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">جاهزية البيانات</h1>
          <p className="text-sm text-muted-foreground">
            تقييم جاهزية البيانات الأكاديمية لتوليد جدول واقعي (للقراءة فقط).
          </p>
        </div>
        <Link
          to="/data-templates"
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          دليل تجهيز البيانات ←
        </Link>
      </header>

      <div className="mb-5">
        <CollegeSwitcher />
      </div>

      {!active ? (
        <Card className="p-6 text-center text-muted-foreground">اختر كلّية للبدء.</Card>
      ) : error ? (
        <Card className="p-6 text-destructive" role="alert">
          تعذّر فحص الجاهزية. أعد المحاولة؛ لم يتم اعتماد البيانات كجاهزة.
        </Card>
      ) : isLoading || !data ? (
        <Card className="p-6 text-center text-muted-foreground">جارٍ حساب الجاهزية…</Card>
      ) : (
        <>
          {(() => {
            const t = data.totals;
            const isEmpty =
              t.courses +
                t.planCourses +
                t.instructors +
                t.rooms +
                t.offerings +
                t.assignments +
                t.sessions ===
              0;
            return isEmpty ? (
              <Card className="mb-5 border-amber-500/30 bg-amber-500/5 p-4 text-sm">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600" />
                  <div>
                    <p className="font-medium text-amber-700">هذه الكلية لا تحتوي على بيانات بعد</p>
                    <p className="mt-1 text-muted-foreground">
                      ابدأ باستيراد البيانات من{" "}
                      <Link
                        to="/data-templates"
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        دليل تجهيز البيانات
                      </Link>
                      .
                    </p>
                  </div>
                </div>
              </Card>
            ) : null;
          })()}
          <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-4">
            <ScoreCard
              title="الجاهزية العامة"
              score={data.scores.overall}
              icon={<Gauge className="h-4 w-4" />}
            />
            <ScoreCard
              title="الخطط الدراسية"
              score={data.scores.studyPlanScore}
              icon={<BookOpen className="h-4 w-4" />}
            />
            <ScoreCard
              title="الموارد"
              score={data.scores.resourcesScore}
              icon={<Users className="h-4 w-4" />}
            />
            <ScoreCard
              title="الجدولة"
              score={data.scores.schedulingScore}
              icon={<CalendarClock className="h-4 w-4" />}
            />
          </div>

          <Card className="mb-5 p-5">
            <h2 className="mb-3 text-base font-semibold">ملخص سريع</h2>
            <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
              <div>
                <p className="text-muted-foreground">المقررات</p>
                <p className="text-lg font-semibold">{data.totals.courses}</p>
              </div>
              <div>
                <p className="text-muted-foreground">صفوف الخطة</p>
                <p className="text-lg font-semibold">{data.totals.planCourses}</p>
              </div>
              <div>
                <p className="text-muted-foreground">المحاضرون</p>
                <p className="text-lg font-semibold">{data.totals.instructors}</p>
              </div>
              <div>
                <p className="text-muted-foreground">القاعات</p>
                <p className="text-lg font-semibold">{data.totals.rooms}</p>
              </div>
              <div>
                <p className="text-muted-foreground">عروض المقررات</p>
                <p className="text-lg font-semibold">{data.totals.offerings}</p>
              </div>
              <div>
                <p className="text-muted-foreground">الإسناد</p>
                <p className="text-lg font-semibold">{data.totals.assignments}</p>
              </div>
              <div>
                <p className="text-muted-foreground">المحاضرات</p>
                <p className="text-lg font-semibold">{data.totals.sessions}</p>
              </div>
            </div>
            {(() => {
              const items = [...data.scheduling, ...data.resources, ...data.studyPlan]
                .filter((m) => m.missing > 0)
                .sort((a, b) => b.missing - a.missing)
                .slice(0, 4);
              if (items.length === 0) return null;
              return (
                <div className="mt-4 space-y-1 text-sm">
                  {items.map((m, i) => (
                    <p key={i} className="text-muted-foreground">
                      • {m.missing} {m.label}
                    </p>
                  ))}
                </div>
              );
            })()}
          </Card>

          <div className="mb-4">
            <Card className="p-5">
              <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
                <CalendarCheck className="h-4 w-4" /> توفّر المحاضرين حسب الفئة
              </h2>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                {/* external + other_college share one display label; show a single merged card */}
                {(["permanent", "external", "unspecified"] as InstructorCategory[]).map((c) => {
                  const byCat = data.availabilityByCategory;
                  const v =
                    c === "external"
                      ? {
                          total: byCat.external.total + byCat.other_college.total,
                          configured: byCat.external.configured + byCat.other_college.configured,
                        }
                      : byCat[c];
                  const isPerm = c === "permanent";
                  const isUnspecified = c === "unspecified";
                  const missing = v.total - v.configured;
                  const tone = isUnspecified
                    ? v.total === 0
                      ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/20"
                      : "bg-amber-500/10 text-amber-800 border-amber-500/20"
                    : isPerm
                      ? "bg-sky-500/10 text-sky-700 border-sky-500/20"
                      : missing === 0
                        ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/20"
                        : "bg-red-500/10 text-red-700 border-red-500/20";
                  return (
                    <div key={c} className={`rounded border p-4 ${tone}`}>
                      <p className="text-sm font-medium">{CATEGORY_LABEL_AR[c]}</p>
                      <p className="mt-1 text-2xl font-bold">
                        {isUnspecified ? v.total : `${v.configured} / ${v.total}`}
                      </p>
                      <p className="mt-1 text-xs">
                        {isUnspecified
                          ? v.total === 0
                            ? "لا توجد سجلات مؤقتة"
                            : "يجب استبدالها بمحاضر فعلي قبل الاعتماد"
                          : isPerm
                            ? "افتراضي: متاح خلال أوقات العمل الرسمية"
                            : missing === 0
                              ? "جميع المحاضرين لديهم أوقات توفّر"
                              : `${missing} بحاجة إلى إدخال أوقات التوفر (إلزامي)`}
                      </p>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Section
              title="جاهزية الخطط الدراسية"
              icon={<BookOpen className="h-4 w-4" />}
              metrics={data.studyPlan}
            />
            <Section
              title="جاهزية الموارد"
              icon={<Users className="h-4 w-4" />}
              metrics={[...data.resources, ...data.availability]}
            />
            <Section
              title="جاهزية الجدولة"
              icon={<CalendarClock className="h-4 w-4" />}
              metrics={data.scheduling}
            />
          </div>

          {data.planComponentRoomTypeMissing.length > 0 ? (
            <Card className="mt-4 p-5" data-testid="plan-component-room-type-blocker">
              <h2 className="mb-3 text-base font-semibold text-destructive">
                {PLAN_COMPONENT_ROOM_TYPE_MISSING_BLOCKER}
              </h2>
              <p className="mb-3 text-sm text-muted-foreground">
                المحاضرات التالية مجدولة (ساعات &gt; 0) لكن نوع القاعة مفقود أو غير صالح.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="px-2 py-2 text-right font-medium">البرنامج</th>
                      <th className="px-2 py-2 text-right font-medium">المستوى</th>
                      <th className="px-2 py-2 text-right font-medium">الفصل</th>
                      <th className="px-2 py-2 text-right font-medium">رمز المقرر</th>
                      <th className="px-2 py-2 text-right font-medium">اسم المقرر</th>
                      <th className="px-2 py-2 text-right font-medium">المحاضرة</th>
                      <th className="px-2 py-2 text-right font-medium">الحالة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.planComponentRoomTypeMissing.map((m) => (
                      <tr key={m.componentId} className="border-t">
                        <td className="px-2 py-2">{m.program}</td>
                        <td className="px-2 py-2">{m.level}</td>
                        <td className="px-2 py-2">{m.term}</td>
                        <td className="px-2 py-2">{m.courseCode}</td>
                        <td className="px-2 py-2">{m.courseName}</td>
                        <td className="px-2 py-2">{m.componentType}</td>
                        <td className="px-2 py-2 font-mono text-xs">{m.referenceState}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
