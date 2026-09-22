import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Clock3, FlaskConical, RefreshCw, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/use-current-user";
import { setActiveCollegeId } from "@/hooks/use-colleges";
import { canViewLeadership } from "@/lib/viewer-roles";
import { UnauthorizedAccess } from "@/components/unauthorized-access";
import { ReportFilterField } from "@/components/reports/report-filters";
import { ReportShell } from "@/components/reports/report-shell";
import { ReportSection, ReportDisclosure } from "@/components/reports/report-section";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  aggregateLeadership,
  coveragePercent,
  formatLeadershipAmount,
  leadershipNotice,
  leadershipOverviewSchema,
  orderedLeadershipCounts,
  sumLeadershipCounts,
  termTypeLabel,
  LEADERSHIP_ASSIGNMENT_HEADERS,
  LEADERSHIP_AVAILABILITY_ORDER,
  LEADERSHIP_EMPLOYMENT_LABELS,
  LEADERSHIP_RANK_ORDER,
  LEADERSHIP_ROOM_HEADERS,
  LEADERSHIP_TEACHING_HEADERS,
  LEADERSHIP_WORKLOAD_HEADERS,
  type LeadershipCollege,
} from "@/lib/reports/leadership";
import {
  LEADERSHIP_METRICS,
  assignmentCoveragePercent,
  type LeadershipMetricKey,
} from "@/lib/reports/leadership-metrics";
import {
  LeadershipMetricDrilldown,
  type LeadershipDrilldownTarget,
} from "@/components/reports/leadership-metric-drilldown";
import { LeadershipRoomCapacitySummary } from "@/components/reports/leadership-room-capacity-summary";
import { LeadershipDecisionSummary } from "@/components/reports/leadership-decision-summary";
import {
  leadershipPriorities,
  leadershipViewerKey,
  LEADERSHIP_QUERY_POLICY,
  type LeadershipDetailTab,
} from "@/lib/reports/leadership-decisions";
import { fetchLeadershipRoomCapacity } from "@/lib/reports/fetch-leadership-room-capacity";
import "@/components/reports/leadership-dashboard.css";

export const Route = createFileRoute("/_authenticated/reports/leadership")({
  head: () => ({
    meta: [
      { title: "المؤشرات التنفيذية للجامعة | منصة إدارة الجداول الجامعية" },
      {
        name: "description",
        content: "ملخص الجامعة وأولويات المتابعة ومقارنة الكليات، مع التفاصيل عند الطلب.",
      },
      { property: "og:title", content: "المؤشرات التنفيذية للجامعة" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

function Page() {
  const { data: me, isLoading } = useCurrentUser();
  if (isLoading) return <Card className="p-6">جارٍ التحقق من الصلاحيات…</Card>;
  if (!me || !canViewLeadership(me)) return <UnauthorizedAccess />;
  const viewerKey = leadershipViewerKey(me);
  return <LeadershipDashboard key={viewerKey} viewerKey={viewerKey} />;
}
const text = (value: unknown) =>
  value === null || value === undefined || value === "" ? "غير محسوب" : String(value);
const hours = (value: number | null | undefined) => formatLeadershipAmount(value, "ساعة");
const ALL_COLLEGES = "all";
function MetricCard({
  label,
  value,
  detail,
  icon,
  tone = "normal",
  definition,
  onOpen,
}: {
  label: string;
  value: ReactNode;
  detail: ReactNode;
  icon: ReactNode;
  tone?: "normal" | "warning" | "critical";
  definition?: string;
  onOpen?: () => void;
}) {
  const valueClass =
    tone === "critical"
      ? "mt-1 text-xl font-bold text-destructive"
      : tone === "warning"
        ? "mt-1 text-xl font-bold text-[color:var(--usr-gold-dark)]"
        : "mt-1 text-xl font-bold text-foreground";
  return (
    <Card className="min-w-0 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          {onOpen ? (
            <button
              type="button"
              onClick={onOpen}
              className={`${valueClass} cursor-pointer text-start underline decoration-dotted underline-offset-4`}
              aria-label={`فتح سجلات ${label}`}
            >
              {value}
            </button>
          ) : (
            <div className={valueClass}>{value}</div>
          )}
        </div>
        <span className="rounded border bg-muted p-2 text-muted-foreground" aria-hidden>
          {icon}
        </span>
      </div>
      {definition && (
        <details className="mt-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer">كيف حُسب؟</summary>
          <p className="mt-2 leading-6">{definition}</p>
        </details>
      )}
      <div className="mt-3 border-t pt-2 text-xs leading-6 text-muted-foreground">{detail}</div>
    </Card>
  );
}

/** رقم فرعي قابل للفتح إلى سجلاته مع تعريفه المركزي. */
function MetricLink({
  metric,
  value,
  onOpen,
}: {
  metric: LeadershipMetricKey;
  value: ReactNode;
  onOpen: (metric: LeadershipMetricKey) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(metric)}
      title={LEADERSHIP_METRICS[metric].definition}
      className="cursor-pointer underline decoration-dotted underline-offset-4"
      aria-label={`فتح سجلات ${LEADERSHIP_METRICS[metric].label}`}
    >
      {value}
    </button>
  );
}

type FacultyBreakdownTone = "availability" | "rank";

const FACULTY_BREAKDOWN_STYLES: Record<
  FacultyBreakdownTone,
  { panel: string; heading: string; item: string; value: string; total: string }
> = {
  availability: {
    panel: "border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/25",
    heading: "border-emerald-200/80 dark:border-emerald-900",
    item: "border-emerald-100 bg-white/90 dark:border-emerald-900/70 dark:bg-background/75",
    value: "bg-emerald-600 text-white shadow-sm dark:bg-emerald-500 dark:text-emerald-950",
    total: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100",
  },
  rank: {
    panel: "border-indigo-200 bg-indigo-50/70 dark:border-indigo-900 dark:bg-indigo-950/25",
    heading: "border-indigo-200/80 dark:border-indigo-900",
    item: "border-indigo-100 bg-white/90 dark:border-indigo-900/70 dark:bg-background/75",
    value: "bg-indigo-600 text-white shadow-sm dark:bg-indigo-500 dark:text-indigo-950",
    total: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-100",
  },
};

function CountList({
  entries,
  tone,
}: {
  entries: Array<[string, number]>;
  tone: FacultyBreakdownTone;
}) {
  const styles = FACULTY_BREAKDOWN_STYLES[tone];
  return (
    <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
      {entries.map(([label, value]) => (
        <div
          key={label}
          className={`grid min-h-12 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border px-3 py-2 ${styles.item}`}
        >
          <dt className="min-w-0 text-sm font-medium leading-5 text-foreground">{label}</dt>
          <dd
            className={`min-w-12 rounded-md px-2.5 py-1 text-center text-base font-extrabold tabular-nums ${styles.value}`}
          >
            {value.toLocaleString("ar")}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function FacultyBreakdownPanel({
  title,
  entries,
  testId,
  tone,
}: {
  title: string;
  entries: Array<[string, number]>;
  testId: string;
  tone: FacultyBreakdownTone;
}) {
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  const styles = FACULTY_BREAKDOWN_STYLES[tone];
  return (
    <section
      className={`rounded-xl border p-3.5 shadow-sm ${styles.panel}`}
      aria-label={title}
      data-testid={testId}
    >
      <div
        className={`mb-3 flex items-center justify-between gap-3 border-b pb-2.5 ${styles.heading}`}
      >
        <h3 className="text-sm font-bold text-foreground">{title}</h3>
        <span className={`rounded-full px-2.5 py-1 text-xs font-bold tabular-nums ${styles.total}`}>
          المجموع {total.toLocaleString("ar")}
        </span>
      </div>
      <CountList entries={entries} tone={tone} />
    </section>
  );
}

function StatusBadge({ row }: { row: LeadershipCollege }) {
  if (row.term_state !== "ready") return <Badge variant="outline">الفترة غير مكتملة</Badge>;
  return row.version_id ? (
    <Badge variant="default">منشور</Badge>
  ) : (
    <Badge variant="secondary">غير منشور</Badge>
  );
}

function LeadershipDashboard({ viewerKey }: { viewerKey: string }) {
  const { data: me } = useCurrentUser();
  const collegeDean = !!me?.isCollegeDean && !me.isSuperAdmin && !me.isUniversityLeadership;
  const [period, setPeriod] = useState<{ year: string; type: string } | null>(null);
  const [drilldown, setDrilldown] = useState<LeadershipDrilldownTarget | null>(null);
  const [detail, setDetail] = useState<{
    tab: LeadershipDetailTab;
    collegeId: string | null;
  } | null>(null);
  const query = useQuery({
    queryKey: ["university-leadership", viewerKey, period],
    ...LEADERSHIP_QUERY_POLICY,
    queryFn: async () => {
      const client = supabase as unknown as {
        rpc: (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: unknown; error: { message: string } | null }>;
      };
      const { data, error } = await client.rpc("leadership_overview", {
        p_academic_year: period?.year ?? null,
        p_term_type: period?.type ?? null,
      });
      if (error) throw new Error("تعذر تحميل ملخص الجامعة. أعد المحاولة.");
      return leadershipOverviewSchema.parse(data);
    },
  });
  const data = query.data;
  // Same-scope background updates retain the last successful snapshot and its timestamp.
  // Period/identity changes use a different query key and never reuse placeholder data.
  const colleges = (data?.colleges ?? []).filter(
    (college) => !college.college.includes("اختبار تبسيط الجداول"),
  );
  const roomCapacityQuery = useQuery({
    queryKey: [
      "leadership-room-capacity",
      viewerKey,
      data?.year,
      data?.term_type,
      data?.generated_at,
    ],
    enabled: !collegeDean && colleges.length > 0,
    ...LEADERSHIP_QUERY_POLICY,
    queryFn: () => fetchLeadershipRoomCapacity(colleges),
  });
  const capacityState = collegeDean
    ? "restricted"
    : roomCapacityQuery.isError
      ? "error"
      : roomCapacityQuery.isPending
        ? "loading"
        : "ready";
  const capacity = capacityState === "ready" ? (roomCapacityQuery.data ?? []) : [];
  const selectedCollege = colleges.find((college) => college.college_id === detail?.collegeId);
  const scoped = detail?.collegeId
    ? colleges.filter((college) => college.college_id === detail.collegeId)
    : colleges;
  const selectedCapacity = detail?.collegeId
    ? capacity.filter((college) => college.id === detail.collegeId)
    : capacity;
  const total = (key: Parameters<typeof aggregateLeadership>[1]) =>
    aggregateLeadership(scoped, key);
  const required = total("required_hours"),
    covered = total("covered_hours"),
    uncovered = total("uncovered_hours");
  const netQuota = total("net_quota"),
    assigned = total("faculty_assigned_hours"),
    scheduled = total("teaching_hours");
  const theory = total("theory_hours"),
    practical = total("practical_hours"),
    unclassified = total("other_hours");
  const sessions = total("sessions_count"),
    overload = total("overload"),
    deficit = total("deficit");
  const published = scoped.filter((college) => !!college.version_id).length;
  const averageSessionsPerPublishedCollege =
    sessions.value === null || published === 0
      ? null
      : Math.round((sessions.value / published) * 10) / 10;
  const sourceComplete =
    required.complete &&
    covered.complete &&
    scoped.every((college) => college.term_state === "ready" && !!college.groups_count);
  const universityCoverage = assignmentCoveragePercent({
    coveredCourseHours: covered.value,
    requiredCourseHours: required.value,
    sourceComplete,
  });
  const uniqueFaculty = selectedCollege
    ? selectedCollege.faculty_directory_count
    : (data?.unique_faculty ?? null);
  const cardValues: Record<LeadershipMetricKey, number | null> = {
    faculty_count: uniqueFaculty,
    net_quota: netQuota.value,
    faculty_assigned_hours: assigned.value,
    deficit: deficit.value,
    overload: overload.value,
    required_course_hours: required.value,
    covered_course_hours: covered.value,
    uncovered_course_hours: uncovered.value,
    scheduled_hours: scheduled.value,
    sessions_count: sessions.value,
    published_colleges: published,
  };
  const openMetric = (metric: LeadershipMetricKey, scope?: LeadershipCollege) => {
    const row = scope ?? selectedCollege;
    const keys = {
      net_quota: "net_quota",
      faculty_assigned_hours: "faculty_assigned_hours",
      deficit: "deficit",
      overload: "overload",
      required_course_hours: "required_hours",
      covered_course_hours: "covered_hours",
      uncovered_course_hours: "uncovered_hours",
      scheduled_hours: "teaching_hours",
      sessions_count: "sessions_count",
      faculty_count: "faculty_directory_count",
    } as const;
    const scopedValue =
      row && metric !== "published_colleges"
        ? row[keys[metric]]
        : row
          ? row.version_id
            ? 1
            : 0
          : null;
    setDrilldown({
      metric,
      cardValue: row ? scopedValue : cardValues[metric],
      collegeId: row?.college_id ?? null,
      collegeName: row?.college ?? null,
    });
  };
  const openDetail = (tab: LeadershipDetailTab, collegeId?: string) => {
    if (collegeId && !colleges.some((college) => college.college_id === collegeId)) return;
    setDetail({ tab, collegeId: collegeId ?? null });
  };
  const rankCounts = orderedLeadershipCounts(
    sumLeadershipCounts(scoped, "rank_counts"),
    LEADERSHIP_RANK_ORDER,
  );
  const availabilityCounts = orderedLeadershipCounts(
    sumLeadershipCounts(scoped, "availability_counts"),
    LEADERSHIP_AVAILABILITY_ORDER,
  );
  const employmentCounts = orderedLeadershipCounts(
    sumLeadershipCounts(scoped, "employment_counts"),
    ["full_time", "part_time", "contract", "visiting", "unknown"],
  ).map(([key, value]) => [LEADERSHIP_EMPLOYMENT_LABELS[key] ?? key, value] as [string, number]);
  const periodLabel = data?.year
    ? `${data.year} · ${termTypeLabel(data.term_type ?? "")}`
    : "لم تُحدد فترة أكاديمية";
  const generatedAt = data?.generated_at
    ? new Date(data.generated_at).toLocaleString("ar")
    : "غير متاح";
  const selectedValue = data?.year ? JSON.stringify({ year: data.year, type: data.term_type }) : "";
  const rows = colleges.map((college) => ({
    ...college,
    coverage: coveragePercent(college) === null ? "غير محسوب" : `${coveragePercent(college)}%`,
    publication: college.version_id ? "منشور" : "غير منشور",
    notice: leadershipNotice(college),
    room_available_hours:
      capacity.find((item) => item.id === college.college_id)?.availableHours ?? null,
    room_balance_hours:
      capacity.find((item) => item.id === college.college_id)?.balanceHours ?? null,
  }));
  const exportHeaders = [
    ...new Map(
      [
        ...LEADERSHIP_WORKLOAD_HEADERS,
        ...LEADERSHIP_ASSIGNMENT_HEADERS,
        ...LEADERSHIP_TEACHING_HEADERS,
        ...LEADERSHIP_ROOM_HEADERS,
        { key: "publication", label: "حالة النشر" },
        { key: "version", label: "النسخة المنشورة" },
        { key: "notice", label: "أسباب المتابعة" },
        { key: "room_available_hours", label: "ساعات القاعات المتاحة" },
        { key: "room_balance_hours", label: "فائض أو عجز ساعات القاعات" },
      ].map((header) => [header.key, header]),
    ).values(),
  ];
  const scopeQuality = leadershipPriorities(scoped, selectedCapacity);

  return (
    <div className="leadership-dashboard">
      <ReportShell
        title={collegeDean ? "المؤشرات التنفيذية للكلية" : "المؤشرات التنفيذية للجامعة"}
        description={`آخر قراءة ناجحة: ${generatedAt} · ${collegeDean ? "بيانات الكلية المُسندة فقط" : "ملخص جميع الكليات"}`}
        filename={`university_leadership_${data?.year ?? ""}_${data?.term_type ?? ""}`}
        rows={rows}
        headers={exportHeaders}
        isLoading={query.isPending}
        error={!data ? query.error : null}
        onRetry={() => void query.refetch()}
        filterSummary={periodLabel}
        headerMeta={{
          collegeName: collegeDean
            ? (colleges[0]?.college ?? "الكلية المُسندة")
            : "جميع كليات الجامعة",
          termName: periodLabel,
          note: "الإسناد من بيانات التدريس · الجداول من النسخ المنشورة · اكتمال كل مؤشر موضح",
        }}
        leading={
          data && (query.isFetching || query.isError) ? (
            <p
              role={query.isError ? "alert" : "status"}
              className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"
            >
              {query.isError
                ? "تعذر التحديث؛ المعروض آخر قراءة ناجحة في الوقت المبين أعلاه. أعد المحاولة بزر تحديث."
                : "جارٍ تحديث البيانات؛ تبقى آخر قراءة ناجحة معروضة حتى اكتمال التحديث."}
            </p>
          ) : null
        }
        filters={
          <div className="leadership-filters report-no-print flex flex-wrap items-end justify-between gap-3">
            <ReportFilterField label="الفترة الأكاديمية" htmlFor="leadership-period">
              <Select
                value={selectedValue}
                onValueChange={(value) => {
                  setDrilldown(null);
                  setDetail(null);
                  setPeriod(JSON.parse(value));
                }}
                disabled={query.isFetching}
              >
                <SelectTrigger id="leadership-period" aria-label="الفترة الأكاديمية">
                  <SelectValue placeholder="اختر الفترة" />
                </SelectTrigger>
                <SelectContent>
                  {data?.periods.map((item) => (
                    <SelectItem key={`${item.year}:${item.type}`} value={JSON.stringify(item)}>
                      {item.year} · {termTypeLabel(item.type)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </ReportFilterField>
            <Button
              variant="outline"
              onClick={() => void query.refetch()}
              disabled={query.isFetching}
            >
              <RefreshCw className={`ml-1 h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />
              {query.isFetching ? "جارٍ التحديث" : "تحديث"}
            </Button>
          </div>
        }
      >
        <LeadershipDecisionSummary
          colleges={colleges}
          uniqueFaculty={data?.unique_faculty ?? null}
          capacity={capacity}
          capacityState={capacityState}
          onOpen={openDetail}
        />
      </ReportShell>

      <Sheet
        open={!!detail}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
      >
        <SheetContent
          side="left"
          className="leadership-details flex w-full flex-col gap-3 overflow-y-auto sm:max-w-[min(1100px,95vw)]"
          data-testid="leadership-detail-panel"
          dir="rtl"
        >
          <SheetHeader className="leadership-detail-heading ps-8 text-start">
            <SheetTitle>
              {selectedCollege?.college ?? (collegeDean ? "تفاصيل الكلية" : "تفاصيل الجامعة")}
            </SheetTitle>
            <SheetDescription>
              {periodLabel} · آخر قراءة ناجحة: {generatedAt}
            </SheetDescription>
          </SheetHeader>
          {detail && (
            <>
              {query.isError && (
                <p role="alert" className="rounded border border-amber-200 p-3 text-sm">
                  تعذر تحديث الملخص؛ هذه آخر قراءة ناجحة.
                </p>
              )}
              <Select
                value={detail.collegeId ?? ALL_COLLEGES}
                onValueChange={(collegeId) => {
                  if (
                    collegeId === ALL_COLLEGES ||
                    colleges.some((college) => college.college_id === collegeId)
                  )
                    setDetail({
                      ...detail,
                      collegeId: collegeId === ALL_COLLEGES ? null : collegeId,
                    });
                }}
              >
                <SelectTrigger aria-label="نطاق التفاصيل">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_COLLEGES}>
                    {collegeDean ? "الكلية المُسندة" : "جميع الكليات"}
                  </SelectItem>
                  {colleges.map((college) => (
                    <SelectItem key={college.college_id} value={college.college_id}>
                      {college.college}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Tabs
                value={detail.tab}
                onValueChange={(tab) => setDetail({ ...detail, tab: tab as LeadershipDetailTab })}
                dir="rtl"
                className="min-w-0"
              >
                <TabsList className="leadership-detail-tabs" aria-label="تفاصيل المؤشرات">
                  <TabsTrigger value="teaching">التدريس والجداول</TabsTrigger>
                  <TabsTrigger value="faculty">المحاضرون والأنصبة</TabsTrigger>
                  <TabsTrigger value="rooms">القاعات</TabsTrigger>
                  <TabsTrigger value="quality">جودة البيانات</TabsTrigger>
                </TabsList>
                <TabsContent value="teaching" className="space-y-4">
                  <ReportSection
                    title="الإسناد التدريسي"
                    testId="leadership-assignment-section"
                    hint="الإسناد من مجموعات التدريس؛ نشر الجدول لا يؤكد وحده اجتياز الفحص."
                  >
                    <div className="space-y-3 p-4">
                      <p className="text-sm font-semibold">
                        تغطية الإسناد:{" "}
                        {universityCoverage === null ? "غير محسوب" : `${universityCoverage}%`}
                        {!sourceComplete && " · بيانات غير مكتملة"}
                      </p>
                      <dl className="grid gap-3 sm:grid-cols-3">
                        {(
                          [
                            "required_course_hours",
                            "covered_course_hours",
                            "uncovered_course_hours",
                          ] as const
                        ).map((metric) => (
                          <div className="rounded border p-3" key={metric}>
                            <dt className="text-xs text-muted-foreground">
                              {LEADERSHIP_METRICS[metric].label}
                            </dt>
                            <dd className="mt-2 text-lg font-bold">
                              <MetricLink
                                metric={metric}
                                value={hours(cardValues[metric])}
                                onOpen={openMetric}
                              />
                            </dd>
                          </div>
                        ))}
                      </dl>
                      {!sourceComplete && (
                        <p className="text-xs text-amber-800 dark:text-amber-200">
                          هذه الساعات تخص السجلات المتاحة؛ اكتمال الحساب موضح في جودة البيانات.
                        </p>
                      )}
                    </div>
                  </ReportSection>
                  <ReportSection
                    title="الحمل التدريسي الأسبوعي"
                    testId="leadership-weekly-teaching"
                    hint="الساعات والمحاضرات أدناه من النسخ المنشورة فقط."
                  >
                    <div className="grid gap-3 p-4 sm:grid-cols-2">
                      <MetricCard
                        label="المحاضرات أسبوعيًا"
                        value={text(sessions.value)}
                        icon={<BookOpen className="h-4 w-4" />}
                        onOpen={() => openMetric("sessions_count")}
                        detail={
                          <>المتوسط لكل كلية منشورة: {text(averageSessionsPerPublishedCollege)}</>
                        }
                      />
                      <MetricCard
                        label="الساعات الأسبوعية"
                        value={hours(scheduled.value)}
                        icon={<Clock3 className="h-4 w-4" />}
                        onOpen={() => openMetric("scheduled_hours")}
                        detail={`المصدر متاح في ${scheduled.known} من ${scheduled.total} كليات`}
                      />
                      <MetricCard
                        label="الساعات النظرية أسبوعيًا"
                        value={hours(theory.value)}
                        icon={<BookOpen className="h-4 w-4" />}
                        detail="مكونات مصنفة نظريًا"
                      />
                      <MetricCard
                        label="الساعات العملية أسبوعيًا"
                        value={hours(practical.value)}
                        icon={<FlaskConical className="h-4 w-4" />}
                        detail={`ساعات مكونات أخرى: ${hours(unclassified.value)}`}
                      />
                    </div>
                  </ReportSection>
                  <ReportSection
                    title="حالة النشر"
                    testId="leadership-publishing-section"
                    hint="المؤشرات تصف النسخ المنشورة المختارة لهذا الفصل."
                  >
                    <div className="space-y-3 p-4">
                      <Button variant="outline" onClick={() => openMetric("published_colleges")}>
                        سجلات النشر: {published} من {scoped.length}
                      </Button>
                      {scoped.map((row) => (
                        <div
                          key={row.college_id}
                          className="flex flex-wrap items-center justify-between gap-3 border-t pt-3"
                        >
                          <div>
                            <b className="text-sm">{row.college}</b>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {row.version ?? "لا توجد نسخة منشورة"}
                            </p>
                          </div>
                          <StatusBadge row={row} />
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openMetric("sessions_count", row)}
                          >
                            جلسات الكلية
                          </Button>
                        </div>
                      ))}
                    </div>
                  </ReportSection>
                </TabsContent>
                <TabsContent value="faculty" className="space-y-4">
                  <ReportSection
                    title="المحاضرون والأنصبة"
                    testId="leadership-instructors-section"
                    hint="النقص في الأنصبة مستقل عن ساعات التدريس غير المسندة."
                  >
                    <div className="grid gap-3 p-4 sm:grid-cols-2">
                      {(
                        [
                          "faculty_count",
                          "net_quota",
                          "faculty_assigned_hours",
                          "overload",
                          "deficit",
                        ] as const
                      ).map((metric) => (
                        <MetricCard
                          key={metric}
                          label={LEADERSHIP_METRICS[metric].label}
                          value={
                            metric === "faculty_count"
                              ? text(uniqueFaculty)
                              : hours(cardValues[metric])
                          }
                          icon={<Users className="h-4 w-4" />}
                          onOpen={() => openMetric(metric)}
                          definition={LEADERSHIP_METRICS[metric].definition}
                          detail={
                            metric === "faculty_count"
                              ? "الهويات الجامعية ضمن نطاق العرض"
                              : `${text(total("incomplete_faculty").value)} نصابًا غير مكتمل · قد تتغير النتائج بعد الاستكمال`
                          }
                        />
                      ))}
                    </div>
                  </ReportSection>
                  <div className="grid gap-4 lg:grid-cols-2" data-testid="faculty-breakdown-groups">
                    <FacultyBreakdownPanel
                      title="الحالة الوظيفية"
                      entries={availabilityCounts}
                      testId="faculty-availability-panel"
                      tone="availability"
                    />
                    <FacultyBreakdownPanel
                      title="الرتب الأكاديمية"
                      entries={rankCounts}
                      testId="faculty-ranks-panel"
                      tone="rank"
                    />
                  </div>
                  <ReportDisclosure label="التفرغ والتعاقد">
                    <CountList entries={employmentCounts} tone="rank" />
                  </ReportDisclosure>
                  {scoped.map((row) => (
                    <Button
                      key={row.college_id}
                      variant="outline"
                      size="sm"
                      onClick={() => openMetric("faculty_count", row)}
                    >
                      محاضرو {row.college}
                    </Button>
                  ))}
                </TabsContent>
                <TabsContent value="rooms">
                  <div data-testid="leadership-rooms-section">
                    {!collegeDean ? (
                      <LeadershipRoomCapacitySummary
                        rows={selectedCapacity}
                        summaryLabel={selectedCollege ? "ملخص الكلية" : "ملخص الجامعة"}
                        loading={roomCapacityQuery.isPending}
                        error={roomCapacityQuery.isError}
                        onRetry={() => void roomCapacityQuery.refetch()}
                      />
                    ) : (
                      <div className="space-y-3 rounded border p-4">
                        <p>ساعات إتاحة القاعات غير محسوبة في هذا النطاق.</p>
                        {scoped.map((row) => (
                          <p key={row.college_id}>
                            {row.college}: {text(row.room_count)} قاعة ومعمل، منها{" "}
                            {text(row.used_rooms)} مستخدمة في المنشور.
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                </TabsContent>
                <TabsContent
                  value="quality"
                  className="space-y-3"
                  data-testid="leadership-quality-section"
                >
                  <p className="rounded-lg bg-muted/40 p-3 text-sm">
                    الملاحظات التالية تحدد ما يحتاج مراجعة؛ لا تمثل حكمًا شاملًا على جاهزية الكلية.
                  </p>
                  {!selectedCollege && Number(data?.unresolved_faculty ?? 0) > 0 && (
                    <p className="rounded border border-amber-200 p-3 text-sm">
                      تبعية تحتاج مراجعة: {data?.unresolved_faculty} محاضرًا لم تُحسم كليتهم
                      الأصلية.
                    </p>
                  )}
                  {scoped.map((row) => (
                    <article key={row.college_id} className="space-y-2 rounded-lg border p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="font-bold">{row.college}</h3>
                        <StatusBadge row={row} />
                      </div>
                      <p className="text-sm">{leadershipNotice(row)}</p>
                      <p className="text-sm">
                        إتاحة القاعات:{" "}
                        {capacity.find((item) => item.id === row.college_id)?.issues.join(" · ") ||
                          (capacityState === "ready" ? "مكتملة الحساب" : "غير محسوبة")}
                      </p>
                      {scopeQuality.find((item) => item.collegeId === row.college_id) && (
                        <p className="text-xs text-muted-foreground">
                          الجهة المعنية:{" "}
                          {scopeQuality.find((item) => item.collegeId === row.college_id)?.team}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openMetric("required_course_hours", row)}
                        >
                          سجلات التدريس
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openMetric("faculty_count", row)}
                        >
                          سجلات المحاضرين
                        </Button>
                        <Button size="sm" variant="outline" asChild>
                          <Link to="/reports" onClick={() => setActiveCollegeId(row.college_id)}>
                            تقارير الكلية
                          </Link>
                        </Button>
                      </div>
                    </article>
                  ))}
                </TabsContent>
              </Tabs>
            </>
          )}
        </SheetContent>
      </Sheet>
      <LeadershipMetricDrilldown
        key={`${viewerKey}:${data?.year}:${data?.term_type}:${drilldown?.collegeId ?? "all"}:${drilldown?.metric ?? "none"}`}
        target={drilldown}
        period={period ?? (data ? { year: data.year, type: data.term_type } : null)}
        onClose={() => setDrilldown(null)}
      />
    </div>
  );
}
