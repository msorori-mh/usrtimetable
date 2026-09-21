import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarCheck, Clock3, RefreshCw, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/use-current-user";
import { setActiveCollegeId } from "@/hooks/use-colleges";
import { canViewLeadership } from "@/lib/viewer-roles";
import { UnauthorizedAccess } from "@/components/unauthorized-access";
import { ReportFilterField } from "@/components/reports/report-filters";
import { ReportShell } from "@/components/reports/report-shell";
import {
  ReportSection,
  ReportDataTable,
  ReportDisclosure,
  type ReportColumn,
} from "@/components/reports/report-section";
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
  aggregateLeadership,
  coveragePercent,
  formatLeadershipAmount,
  leadershipNotice,
  leadershipOverviewSchema,
  leadershipPercent,
  orderedLeadershipCounts,
  sortLeadershipColleges,
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
  LEADERSHIP_UNCALCULATED,
  assignmentCoveragePercent,
  type LeadershipMetricKey,
} from "@/lib/reports/leadership-metrics";
import {
  LeadershipMetricDrilldown,
  type LeadershipDrilldownTarget,
} from "@/components/reports/leadership-metric-drilldown";

export const Route = createFileRoute("/_authenticated/reports/leadership")({
  head: () => ({
    meta: [
      { title: "المؤشرات التنفيذية للجامعة | منصة إدارة الجداول الجامعية" },
      {
        name: "description",
        content: "لوحة قراءة تنفيذية لمؤشرات الكليات والجداول المنشورة والأنصبة والقاعات.",
      },
      { property: "og:title", content: "المؤشرات التنفيذية للجامعة" },
      {
        property: "og:description",
        content: "مؤشرات الكليات والجداول المنشورة والأنصبة والقاعات.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

function Page() {
  const { data: me, isLoading } = useCurrentUser();
  if (isLoading) return <Card className="p-6">جارٍ التحقق من الصلاحيات…</Card>;
  if (!canViewLeadership(me)) return <UnauthorizedAccess />;
  return <LeadershipDashboard />;
}

type LeadershipRow = LeadershipCollege & { coverage: string; notice: string; publication: string };

const text = (value: unknown) =>
  value === null || value === undefined || value === "" ? "غير محسوب" : String(value);
const hours = (value: number | null | undefined) => formatLeadershipAmount(value, "ساعة");

function hasIssue(row: LeadershipCollege) {
  return (
    row.term_state !== "ready" ||
    !row.version_id ||
    Number(row.incomplete_faculty ?? 0) > 0 ||
    Number(row.uncovered_hours ?? 0) > 0 ||
    Number(row.pending_groups ?? 0) > 0 ||
    Number(row.overallocated_groups ?? 0) > 0
  );
}

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
        <p className="mt-2 text-[11px] leading-5 text-muted-foreground">{definition}</p>
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

function CountList({ entries }: { entries: Array<[string, number]> }) {
  return (
    <dl className="grid gap-x-5 gap-y-1 sm:grid-cols-2">
      {entries.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-3 text-sm">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="font-semibold tabular-nums">{value.toLocaleString("ar")}</dd>
        </div>
      ))}
    </dl>
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

function CollegeCell({ row }: { row: LeadershipRow }) {
  return (
    <div className="min-w-[210px] space-y-1">
      <div className="font-bold text-primary">{row.college}</div>
      <div className="text-xs text-muted-foreground">
        {text(row.departments)} قسم · {text(row.programs)} برنامج
      </div>
      <div className="text-xs text-muted-foreground">
        {text(row.teaching_contributors)} مساهمًا في التدريس · {text(row.external_contributors)} من
        خارج الكلية
      </div>
    </div>
  );
}

function CoverageCell({ row }: { row: LeadershipRow }) {
  const percent = coveragePercent(row);
  return (
    <div className="min-w-[135px] space-y-1">
      <b className="text-lg tabular-nums">{percent === null ? "غير محسوب" : `${percent}%`}</b>
      <div className="text-xs text-muted-foreground">المسند {hours(row.covered_hours)}</div>
      <div className="text-xs text-muted-foreground">غير المسند {hours(row.uncovered_hours)}</div>
    </div>
  );
}

function QuotaCell({ row }: { row: LeadershipRow }) {
  return (
    <dl className="min-w-[165px] space-y-1 text-xs">
      <div className="flex justify-between gap-3">
        <dt className="text-muted-foreground">الأساسي</dt>
        <dd>غير متاح في الملخص</dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt className="text-muted-foreground">الإعفاء</dt>
        <dd>غير متاح في الملخص</dd>
      </div>
      <div className="flex justify-between gap-3 font-semibold">
        <dt>المطلوب بعد الإعفاء</dt>
        <dd>{hours(row.net_quota)}</dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt className="text-muted-foreground">المسند للمحاضرين</dt>
        <dd>{hours(row.faculty_assigned_hours)}</dd>
      </div>
    </dl>
  );
}

function BalanceCell({ row }: { row: LeadershipRow }) {
  return (
    <dl className="min-w-[145px] space-y-1 text-xs">
      <div className="flex justify-between gap-3">
        <dt>الساعات الزائدة</dt>
        <dd className="font-semibold tabular-nums">{hours(row.overload)}</dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt>نقص الأنصبة</dt>
        <dd className="font-semibold tabular-nums">{hours(row.deficit)}</dd>
      </div>
      <div className="flex justify-between gap-3 text-muted-foreground">
        <dt>بيانات نصاب ناقصة</dt>
        <dd>{text(row.incomplete_faculty)}</dd>
      </div>
    </dl>
  );
}

function RoomCell({ row }: { row: LeadershipRow }) {
  return (
    <div className="min-w-[150px] space-y-1 text-xs">
      <div>
        <b>{text(row.used_rooms)}</b> مستخدمة من <b>{text(row.room_count)}</b>
      </div>
      <div className="text-muted-foreground">
        {text(row.halls)} قاعة · {text(row.labs)} معمل
      </div>
      <div className="text-muted-foreground">الاستغلال الزمني: غير محسوب</div>
    </div>
  );
}

function LeadershipDashboard() {
  const { data: me } = useCurrentUser();
  const [period, setPeriod] = useState<{ year: string; type: string } | null>(null);
  const [drilldown, setDrilldown] = useState<LeadershipDrilldownTarget | null>(null);
  const query = useQuery({
    queryKey: ["university-leadership", me?.id, period],
    staleTime: 60_000,
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
  const colleges = sortLeadershipColleges(
    (!query.error && !query.isFetching ? (data?.colleges ?? []) : []).filter(
      (college) => !college.college.includes("اختبار تبسيط الجداول"),
    ),
  );
  const rows: LeadershipRow[] = colleges.map((college) => ({
    ...college,
    coverage: coveragePercent(college) === null ? "غير محسوب" : `${coveragePercent(college)}%`,
    publication: college.version_id ? "منشور" : "غير منشور",
    notice: leadershipNotice(college),
  }));
  const ready = colleges.filter((college) => college.term_state === "ready").length;
  const published = colleges.filter((college) => !!college.version_id).length;
  const attention = colleges.filter(hasIssue).length;
  const counts = sumLeadershipCounts(colleges, "availability_counts");
  const availableFaculty = counts["متاح"] ?? 0;
  const uniqueFaculty = data?.unique_faculty ?? null;
  const availablePercent = leadershipPercent(availableFaculty, uniqueFaculty);
  const rankCounts = orderedLeadershipCounts(
    sumLeadershipCounts(colleges, "rank_counts"),
    LEADERSHIP_RANK_ORDER,
  );
  const availabilityCounts = orderedLeadershipCounts(counts, LEADERSHIP_AVAILABILITY_ORDER);
  const employmentCounts = orderedLeadershipCounts(
    sumLeadershipCounts(colleges, "employment_counts"),
    ["full_time", "part_time", "contract", "visiting", "unknown"],
  ).map(([key, value]) => [LEADERSHIP_EMPLOYMENT_LABELS[key] ?? key, value] as [string, number]);
  const required = aggregateLeadership(colleges, "required_hours");
  const covered = aggregateLeadership(colleges, "covered_hours");
  const uncovered = aggregateLeadership(colleges, "uncovered_hours");
  const netQuota = aggregateLeadership(colleges, "net_quota");
  const assigned = aggregateLeadership(colleges, "faculty_assigned_hours");
  const scheduled = aggregateLeadership(colleges, "teaching_hours");
  const overload = aggregateLeadership(colleges, "overload");
  const deficit = aggregateLeadership(colleges, "deficit");
  const sessions = aggregateLeadership(colleges, "sessions_count");
  const rooms = aggregateLeadership(colleges, "room_count");
  const usedRooms = aggregateLeadership(colleges, "used_rooms");
  // التغطية تُقاس على الساعات التدريسية المطلوبة فقط، ولا تُعرض نسبة إذا كان
  // المقام أو كليات المصدر غير مكتملة.
  const universityCoverage = assignmentCoveragePercent({
    coveredCourseHours: covered.value,
    requiredCourseHours: required.value,
    sourceComplete: required.complete && covered.complete,
  });
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
  const collegeValue = (
    metric: LeadershipMetricKey,
    college: LeadershipCollege,
  ): number | null => {
    const map: Partial<Record<LeadershipMetricKey, number | null>> = {
      net_quota: college.net_quota,
      faculty_assigned_hours: college.faculty_assigned_hours,
      deficit: college.deficit,
      overload: college.overload,
      required_course_hours: college.required_hours,
      covered_course_hours: college.covered_hours,
      uncovered_course_hours: college.uncovered_hours,
      scheduled_hours: college.teaching_hours,
      sessions_count: college.sessions_count,
    };
    return map[metric] ?? null;
  };
  const openMetric = (metric: LeadershipMetricKey, scope?: LeadershipCollege) =>
    setDrilldown({
      metric,
      cardValue: scope ? collegeValue(metric, scope) : cardValues[metric],
      collegeId: scope?.college_id ?? null,
      collegeName: scope?.college ?? null,
    });
  const periodLabel = data?.year
    ? `${data.year} · ${termTypeLabel(data.term_type ?? "")}`
    : "لم تُحدد فترة أكاديمية";
  const generatedAt = data?.generated_at
    ? new Date(data.generated_at).toLocaleString("ar")
    : "غير متاح";
  const selectedValue = data?.year ? JSON.stringify({ year: data.year, type: data.term_type }) : "";
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
      ].map((header) => [header.key, header]),
    ).values(),
  ];
  const columns: ReportColumn<LeadershipRow>[] = [
    {
      key: "college",
      label: "الكلية",
      className: "w-[22%]",
      render: (row) => <CollegeCell row={row} />,
    },
    { key: "publication", label: "النشر", render: (row) => <StatusBadge row={row} /> },
    { key: "coverage", label: "اكتمال الإسناد", render: (row) => <CoverageCell row={row} /> },
    { key: "net_quota", label: "النصاب والمسند", render: (row) => <QuotaCell row={row} /> },
    { key: "deficit", label: "الزيادة / نقص الأنصبة", render: (row) => <BalanceCell row={row} /> },
    {
      key: "teaching_hours",
      label: "المجدول في المنشور",
      secondary: true,
      render: (row) => (
        <div>
          {hours(row.teaching_hours)}
          <div className="text-xs text-muted-foreground">{text(row.sessions_count)} محاضرة</div>
        </div>
      ),
    },
    {
      key: "theory_hours",
      label: "نظري / عملي",
      secondary: true,
      render: (row) => (
        <div>
          {hours(row.theory_hours)} نظري
          <div className="text-xs text-muted-foreground">{hours(row.practical_hours)} عملي</div>
        </div>
      ),
    },
    {
      key: "room_count",
      label: "القاعات والمعامل",
      secondary: true,
      render: (row) => <RoomCell row={row} />,
    },
    { key: "faculty_count", label: "المحاضرون", numeric: true, secondary: true },
    { key: "notice", label: "أسباب المتابعة", secondary: true },
    {
      key: "college_id",
      label: "تقارير الكلية",
      sortable: false,
      secondary: true,
      render: (row) => (
        <div className="report-no-print flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => openMetric("faculty_count", row)}>
            محاضرو الكلية
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => openMetric("required_course_hours", row)}
          >
            سجلات التدريس
          </Button>
          <Button size="sm" variant="outline" onClick={() => openMetric("sessions_count", row)}>
            جداول الكلية
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link to="/reports" onClick={() => setActiveCollegeId(row.college_id)}>
              فتح التقارير
            </Link>
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
    <ReportShell
      title="المؤشرات التنفيذية للجامعة"
      description={`آخر تحديث: ${generatedAt} · النطاق: النسخ المنشورة فقط. أعداد الطلاب والسعة لا تدخل أي نسبة ما لم تكن مكتملة.`}
      filename={`university_leadership_${data?.year ?? ""}_${data?.term_type ?? ""}`}
      rows={rows}
      headers={exportHeaders}
      isLoading={query.isFetching}
      error={query.error}
      onRetry={() => void query.refetch()}
      filterSummary={periodLabel}
      headerMeta={{
        collegeName: "جميع كليات الجامعة",
        termName: periodLabel,
        note: "قراءة فقط · النسخ المنشورة فقط · القيم غير المكتملة مميزة صراحة",
      }}
      filters={
        <div className="report-no-print flex flex-wrap items-end justify-between gap-3 border-b pb-3">
          <ReportFilterField label="الفترة الأكاديمية" htmlFor="leadership-period">
            <Select
              value={selectedValue}
              onValueChange={(value) => setPeriod(JSON.parse(value))}
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
            <RefreshCw className="ml-1 h-4 w-4" />
            تحديث
          </Button>
        </div>
      }
      summary={
        <div className="space-y-4">
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="حالة الجامعة">
            <MetricCard
              label={LEADERSHIP_METRICS.faculty_count.label}
              definition={LEADERSHIP_METRICS.faculty_count.definition}
              onOpen={() => openMetric("faculty_count")}
              value={
                uniqueFaculty === null
                  ? LEADERSHIP_UNCALCULATED
                  : uniqueFaculty.toLocaleString("ar")
              }
              icon={<Users className="h-4 w-4" />}
              detail={
                <>
                  <span>
                    المتاح: {availableFaculty.toLocaleString("ar")}
                    {availablePercent === null ? "" : ` (${availablePercent}%)`}
                  </span>
                  <ReportDisclosure label="الحالة والرتب">
                    <div className="grid gap-4 pt-2 md:grid-cols-2">
                      <div>
                        <h3 className="mb-2 font-semibold text-foreground">الحالة</h3>
                        <CountList entries={availabilityCounts} />
                      </div>
                      <div>
                        <h3 className="mb-2 font-semibold text-foreground">الرتب</h3>
                        <CountList entries={rankCounts} />
                      </div>
                    </div>
                  </ReportDisclosure>
                </>
              }
            />
            <MetricCard
              label="تغطية الإسناد التدريسي"
              definition="المسند من الساعات التدريسية المطلوبة ÷ إجمالي الساعات التدريسية المطلوبة. ساعات النصاب لا تدخل المقام."
              onOpen={() => openMetric("covered_course_hours")}
              value={
                universityCoverage === null ? LEADERSHIP_UNCALCULATED : `${universityCoverage}%`
              }
              icon={<CalendarCheck className="h-4 w-4" />}
              tone={Number(uncovered.value ?? 0) > 0 ? "critical" : "normal"}
              detail={
                <dl className="space-y-1">
                  <div className="flex justify-between gap-2">
                    <dt>{LEADERSHIP_METRICS.covered_course_hours.label}</dt>
                    <dd>
                      <MetricLink
                        metric="covered_course_hours"
                        value={hours(covered.value)}
                        onOpen={openMetric}
                      />
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>{LEADERSHIP_METRICS.required_course_hours.label}</dt>
                    <dd>
                      <MetricLink
                        metric="required_course_hours"
                        value={hours(required.value)}
                        onOpen={openMetric}
                      />
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>{LEADERSHIP_METRICS.uncovered_course_hours.label}</dt>
                    <dd>
                      <MetricLink
                        metric="uncovered_course_hours"
                        value={hours(uncovered.value)}
                        onOpen={openMetric}
                      />
                    </dd>
                  </div>
                  {!required.complete && (
                    <div className="pt-1">
                      لا تُعرض نسبة: مصادر غير مكتملة في {required.total - required.known} كلية.
                    </div>
                  )}
                </dl>
              }
            />
            <MetricCard
              label="حالة الجداول"
              definition={LEADERSHIP_METRICS.published_colleges.definition}
              onOpen={() => openMetric("published_colleges")}
              value={`${published.toLocaleString("ar")} من ${colleges.length.toLocaleString("ar")}`}
              icon={<Clock3 className="h-4 w-4" />}
              tone={published < colleges.length ? "warning" : "normal"}
              detail={
                <dl className="space-y-1">
                  <div className="flex justify-between gap-2">
                    <dt>تغطية الإسناد التدريسي</dt>
                    <dd>
                      {universityCoverage === null
                        ? LEADERSHIP_UNCALCULATED
                        : `${universityCoverage}%`}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>{LEADERSHIP_METRICS.sessions_count.label}</dt>
                    <dd>
                      <MetricLink
                        metric="sessions_count"
                        value={text(sessions.value)}
                        onOpen={openMetric}
                      />
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>النشر</dt>
                    <dd>
                      {published} / {colleges.length} كلية
                    </dd>
                  </div>
                </dl>
              }
            />
            <MetricCard
              label={LEADERSHIP_METRICS.net_quota.label}
              definition={LEADERSHIP_METRICS.net_quota.definition}
              onOpen={() => openMetric("net_quota")}
              value={hours(netQuota.value)}
              icon={<Users className="h-4 w-4" />}
              detail={
                <dl className="space-y-1">
                  <div className="flex justify-between gap-2">
                    <dt>الأساسي والإعفاء لكل محاضر</dt>
                    <dd>
                      <MetricLink metric="net_quota" value="في التفاصيل" onOpen={openMetric} />
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>{LEADERSHIP_METRICS.faculty_assigned_hours.label}</dt>
                    <dd>
                      <MetricLink
                        metric="faculty_assigned_hours"
                        value={hours(assigned.value)}
                        onOpen={openMetric}
                      />
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>{LEADERSHIP_METRICS.scheduled_hours.label}</dt>
                    <dd>
                      <MetricLink
                        metric="scheduled_hours"
                        value={hours(scheduled.value)}
                        onOpen={openMetric}
                      />
                    </dd>
                  </div>
                  <div className="pt-1">
                    «المسند ضمن الأنصبة» يقيس نصاب المحاضر، و«المسند للمقررات» يقيس ساعات المكوّن؛
                    لا يُدمجان.
                  </div>
                </dl>
              }
            />
            <MetricCard
              label={LEADERSHIP_METRICS.overload.label}
              definition={LEADERSHIP_METRICS.overload.definition}
              onOpen={() => openMetric("overload")}
              value={hours(overload.value)}
              icon={<AlertTriangle className="h-4 w-4" />}
              tone={Number(overload.value ?? 0) > 0 ? "warning" : "normal"}
              detail="افتح الرقم لعرض المحاضرين المكوّنين له بمعادلة كل صف."
            />
            <MetricCard
              label={LEADERSHIP_METRICS.deficit.label}
              definition={LEADERSHIP_METRICS.deficit.definition}
              onOpen={() => openMetric("deficit")}
              value={hours(deficit.value)}
              icon={<AlertTriangle className="h-4 w-4" />}
              tone={Number(deficit.value ?? 0) > 0 ? "warning" : "normal"}
              detail="مستقل عن ساعات التدريس غير المسندة؛ لا يتداخل معها."
            />
          </section>
          <Card className="px-4 py-3" data-testid="leadership-scope">
            <div className="grid gap-3 text-center sm:grid-cols-4">
              <div>
                <div className="text-xs text-muted-foreground">الكليات</div>
                <b>{colleges.length}</b>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">تعريف الفترة جاهز</div>
                <b>
                  {ready} من {colleges.length}
                </b>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">جداول منشورة</div>
                <b>
                  {published} من {colleges.length}
                </b>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">تحتاج متابعة</div>
                <b>{attention}</b>
              </div>
            </div>
            {Number(data?.unresolved_faculty ?? 0) > 0 && (
              <p className="mt-3 border-t pt-2 text-xs text-muted-foreground">
                تبعية تحتاج مراجعة: {data?.unresolved_faculty} محاضرًا لم تُحسم كليتهم الأصلية؛ لا
                يدخلون في نسبة مستقلة.
              </p>
            )}
          </Card>
        </div>
      }
    >
      <div className="space-y-5">
        <ReportSection
          title="مقارنة الكليات"
          count={rows.length}
          hint="تكنولوجيا المعلومات وعلوم الحاسوب أولًا، ثم بقية الكليات. افتح التفاصيل لبقية المؤشرات وأسباب المتابعة."
          bodyClassName="p-0"
        >
          <ReportDataTable
            rows={rows}
            caption="المؤشرات التنفيذية للكليات"
            rowKey={(row) => row.college_id}
            rowClassName={(row) =>
              Number(row.uncovered_hours ?? 0) > 0
                ? "bg-destructive/5"
                : hasIssue(row)
                  ? "bg-muted/40"
                  : ""
            }
            primaryColumnLimit={5}
            minWidthClassName="min-w-[1000px]"
            columns={columns}
          />
        </ReportSection>
        <div className="grid gap-4 xl:grid-cols-3">
          <ReportSection
            title="المحاضرون والأنصبة"
            hint="المحاضر يُحتسب مرة واحدة بهويته الجامعية، وتُجمع مساهماته عبر الكليات."
          >
            <div className="space-y-3 p-4 text-sm">
              <dl className="space-y-2">
                <div className="flex justify-between">
                  <dt>المطلوب بعد الإعفاء</dt>
                  <dd>{hours(netQuota.value)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>المسند</dt>
                  <dd>{hours(assigned.value)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>المجدول في المنشور</dt>
                  <dd>{hours(scheduled.value)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>نقص الأنصبة</dt>
                  <dd>{hours(deficit.value)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>الزيادة</dt>
                  <dd>{hours(overload.value)}</dd>
                </div>
              </dl>
              <ReportDisclosure label="التفرغ والتعاقد">
                <CountList entries={employmentCounts} />
              </ReportDisclosure>
              <Button variant="outline" size="sm" asChild className="report-no-print">
                <Link to="/reports/instructor-workload">تفاصيل المحاضرين</Link>
              </Button>
            </div>
          </ReportSection>
          <ReportSection
            title="القاعات والمعامل"
            hint="الاستخدام أدناه يعني ظهور المورد في نسخة منشورة، وليس نسبة استغلال زمني."
          >
            <div className="space-y-3 p-4 text-sm">
              <dl className="space-y-2">
                <div className="flex justify-between">
                  <dt>إجمالي الموارد</dt>
                  <dd>{text(rooms.value)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>مستخدمة في المنشور</dt>
                  <dd>{text(usedRooms.value)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>ساعات الإشغال / المتاح</dt>
                  <dd>غير محسوب</dd>
                </div>
                <div className="flex justify-between">
                  <dt>القاعات الخالية والفجوات المتصلة</dt>
                  <dd>غير محسوب</dd>
                </div>
                <div className="flex justify-between">
                  <dt>ملاءمة السعة والتجهيز</dt>
                  <dd>غير محسوب</dd>
                </div>
              </dl>
              <p className="border-t pt-2 text-xs text-muted-foreground">
                لا تُعد أي قاعة متاحة هنا؛ مصدر الملخص لا يفحص حجوزاتها الزمنية عبر جميع الكليات.
              </p>
              <ReportDisclosure label="تفاصيل الكليات">
                <div className="space-y-2">
                  {rows.map((row) => (
                    <div key={row.college_id} className="flex justify-between gap-3 border-b py-2">
                      <span>{row.college}</span>
                      <span>
                        {text(row.used_rooms)} / {text(row.room_count)}
                      </span>
                    </div>
                  ))}
                </div>
              </ReportDisclosure>
            </div>
          </ReportSection>
          <ReportSection
            title="حالة البيانات والنشر"
            hint="تعرض القياسات التي يمكن إثباتها من المصدر الحالي فقط."
          >
            <div className="space-y-3 p-4 text-sm">
              <dl className="space-y-2">
                <div className="flex justify-between">
                  <dt>المحاضرات المنشورة</dt>
                  <dd>{text(sessions.value)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>الساعات المنشورة</dt>
                  <dd>{hours(scheduled.value)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>ساعات التدريس غير المسندة</dt>
                  <dd>{hours(uncovered.value)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>كليات تحتاج متابعة</dt>
                  <dd>{attention}</dd>
                </div>
              </dl>
              <ReportDisclosure label="أسباب المتابعة حسب الكلية">
                <div className="space-y-2">
                  {rows.map((row) => (
                    <div key={row.college_id} className="border-b py-2">
                      <div className="flex items-center justify-between gap-3">
                        <b>{row.college}</b>
                        <StatusBadge row={row} />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{row.notice}</p>
                    </div>
                  ))}
                </div>
              </ReportDisclosure>
            </div>
          </ReportSection>
        </div>
      </div>
    </ReportShell>
    <LeadershipMetricDrilldown
      target={drilldown}
      period={period ?? (data ? { year: data.year, type: data.term_type } : null)}
      onClose={() => setDrilldown(null)}
    />
    </>
  );
}
