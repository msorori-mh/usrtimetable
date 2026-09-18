import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
  type ReportColumn,
} from "@/components/reports/report-section";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  leadershipOverviewSchema,
  sumLeadership,
  coveragePercent,
  leadershipNotice,
  termTypeLabel,
  LEADERSHIP_WORKLOAD_HEADERS,
  LEADERSHIP_ASSIGNMENT_HEADERS,
  LEADERSHIP_TEACHING_HEADERS,
  LEADERSHIP_ROOM_HEADERS,
  LEADERSHIP_RANK_ORDER,
  LEADERSHIP_AVAILABILITY_ORDER,
  LEADERSHIP_EMPLOYMENT_LABELS,
  orderedLeadershipCounts,
  sumLeadershipCounts,
  type LeadershipCollege,
} from "@/lib/reports/leadership";

export const Route = createFileRoute("/_authenticated/reports/leadership")({
  head: () => ({ meta: [{ title: "المؤشرات التنفيذية للجامعة" }] }),
  component: Page,
});

function Page() {
  const { data: me, isLoading } = useCurrentUser();
  if (isLoading) return <Card className="p-6">جارٍ التحقق من الصلاحيات…</Card>;
  if (!canViewLeadership(me)) return <UnauthorizedAccess />;
  return <LeadershipDashboard />;
}

type LeadershipRow = LeadershipCollege & {
  coverage: string;
  notice: string;
};

const leadershipText = (value: unknown) =>
  value === null || value === undefined || value === "" ? "—" : String(value);

function hasLeadershipIssue(row: LeadershipCollege) {
  return (
    row.term_state !== "ready" ||
    !row.version_id ||
    Number(row.incomplete_faculty ?? 0) > 0 ||
    Number(row.uncovered_hours ?? 0) > 0 ||
    Number(row.pending_groups ?? 0) > 0 ||
    Number(row.overallocated_groups ?? 0) > 0
  );
}

function CountSummaryCard({
  title,
  entries,
}: {
  title: string;
  entries: Array<[string, number]>;
}) {
  return (
    <Card className="p-3">
      <div className="mb-2 text-sm font-bold text-primary">{title}</div>
      <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
        {entries.length ? (
          entries.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">{label}</span>
              <b className="tabular-nums">{value}</b>
            </div>
          ))
        ) : (
          <div className="text-sm text-muted-foreground">—</div>
        )}
      </div>
    </Card>
  );
}

function CollegeExecutiveCell({ row }: { row: LeadershipRow }) {
  return (
    <div className="min-w-[210px] space-y-1 leading-5">
      <div className="font-bold text-primary">{row.college}</div>
      <div className="text-[11px] text-muted-foreground">
        {leadershipText(row.departments)} قسم · {leadershipText(row.programs)} برنامج ·{" "}
        {leadershipText(
          Number(row.faculty_directory_count ?? 0) > 0
            ? row.faculty_directory_count
            : row.faculty_count,
        )} عضو هيئة تدريس
      </div>
    </div>
  );
}

function ReadinessCell({ row }: { row: LeadershipRow }) {
  if (row.term_state !== "ready") {
    return (
      <div className="min-w-[145px] font-semibold text-[color:var(--usr-gold-dark)]">
        {row.term_state === "ambiguous" ? "الفصل يحتاج اعتماد" : "الفصل غير محدد"}
      </div>
    );
  }
  const issues: string[] = [];
  if (!row.version_id) issues.push("لا يوجد جدول منشور");
  if (Number(row.incomplete_faculty ?? 0) > 0)
    issues.push("نصاب غير مكتمل: " + leadershipText(row.incomplete_faculty));
  if (Number(row.pending_groups ?? 0) > 0)
    issues.push("تدريس مشترك: " + leadershipText(row.pending_groups));
  if (Number(row.overallocated_groups ?? 0) > 0)
    issues.push("تجاوز إسناد: " + leadershipText(row.overallocated_groups));
  return (
    <div className="min-w-[145px] space-y-0.5 leading-5">
      <div className="font-semibold">{row.version_id ? "جاهز · منشور" : "جاهز · غير منشور"}</div>
      {issues.slice(0, 2).map((issue) => (
        <div key={issue} className="text-[10px] text-muted-foreground">
          {issue}
        </div>
      ))}
    </div>
  );
}

function AssignmentCoverageCell({ row }: { row: LeadershipRow }) {
  const coverage = coveragePercent(row);
  if (coverage === null)
    return <div className="min-w-[125px] text-muted-foreground">غير محسوبة</div>;
  return (
    <div className="min-w-[125px] space-y-0.5 leading-5">
      <div className="text-lg font-bold tabular-nums">{coverage}%</div>
      <div className="text-[10px] text-muted-foreground">
        {leadershipText(row.covered_hours)} / {leadershipText(row.required_hours)} ساعة
      </div>
      {Number(row.uncovered_hours ?? 0) > 0 && (
        <div className="text-[10px] font-semibold text-destructive">
          عجز {leadershipText(row.uncovered_hours)} ساعة
        </div>
      )}
    </div>
  );
}

function WorkloadCell({ row }: { row: LeadershipRow }) {
  return (
    <div className="min-w-[130px] space-y-0.5 leading-5">
      <div>
        <span className="text-[10px] text-muted-foreground">النصاب </span>
        <b className="tabular-nums">{leadershipText(row.net_quota)} س</b>
      </div>
      <div>
        <span className="text-[10px] text-muted-foreground">المسند </span>
        <span className="tabular-nums">{leadershipText(row.faculty_assigned_hours)} س</span>
      </div>
    </div>
  );
}

function BalanceCell({ row }: { row: LeadershipRow }) {
  return (
    <div className="min-w-[115px] space-y-0.5 leading-5">
      <div>
        <span className="text-[10px] text-muted-foreground">زائد </span>
        <b className="tabular-nums">{leadershipText(row.overload)} س</b>
      </div>
      <div>
        <span className="text-[10px] text-muted-foreground">نقص </span>
        <b className="tabular-nums">{leadershipText(row.deficit)} س</b>
      </div>
    </div>
  );
}

function PublishedResourcesCell({ row }: { row: LeadershipRow }) {
  const publishedLabel = row.version_id
    ? leadershipText(row.teaching_hours) + " س · " + leadershipText(row.sessions_count) + " محاضرة"
    : "لا يوجد جدول منشور";
  return (
    <div className="min-w-[155px] space-y-0.5 leading-5">
      <div className="font-semibold">{publishedLabel}</div>
      <div className="text-[10px] text-muted-foreground">
        {leadershipText(row.halls)} قاعة · {leadershipText(row.labs)} معمل ·{" "}
        {leadershipText(row.seats)} مقعد
      </div>
    </div>
  );
}
function LeadershipDashboard() {
  const { data: me } = useCurrentUser();
  const [period, setPeriod] = useState<{ year: string; type: string } | null>(null);
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
  const colleges = (!query.error && !query.isFetching ? (data?.colleges ?? []) : [])
    .filter((college) => college.college_id !== "7e570000-0000-4000-8000-000000000001")
    .sort((a, b) => {
      const priority = (name: string) =>
        name.includes("تكنولوجيا المعلومات وعلوم الحاسوب") ? 0 : 1;
      return priority(a.college) - priority(b.college) || a.college.localeCompare(b.college, "ar");
    });
  const ready = colleges.filter((c) => c.term_state === "ready").length;
  const published = colleges.filter((c) => !!c.version_id).length;
  const rows: LeadershipRow[] = colleges.map((c) => ({
    ...c,
    coverage: coveragePercent(c) === null ? "غير محسوبة" : String(coveragePercent(c)) + "%",
    notice: leadershipNotice(c),
  }));
  const directoryFaculty = sumLeadership(colleges, "faculty_directory_count");
  const totalFaculty =
    directoryFaculty > 0 ? directoryFaculty : sumLeadership(colleges, "faculty_count");
  const rankCounts = orderedLeadershipCounts(
    sumLeadershipCounts(colleges, "rank_counts"),
    LEADERSHIP_RANK_ORDER,
  );
  const availabilityCounts = orderedLeadershipCounts(
    sumLeadershipCounts(colleges, "availability_counts"),
    LEADERSHIP_AVAILABILITY_ORDER,
  );
  const employmentCounts = orderedLeadershipCounts(
    sumLeadershipCounts(colleges, "employment_counts"),
    ["full_time", "part_time", "contract", "visiting", "unknown"],
  ).map(([key, value]) => [LEADERSHIP_EMPLOYMENT_LABELS[key] ?? key, value] as [string, number]);
  const totalRequired = sumLeadership(colleges, "required_hours");
  const totalCovered = sumLeadership(colleges, "covered_hours");
  const universityCoverage =
    totalRequired > 0 ? Math.round((1000 * totalCovered) / totalRequired) / 10 : null;
  const attentionCount = colleges.filter(hasLeadershipIssue).length;
  const exportHeaders = [
    ...new Map(
      [
        ...LEADERSHIP_WORKLOAD_HEADERS,
        ...LEADERSHIP_ASSIGNMENT_HEADERS,
        ...LEADERSHIP_TEACHING_HEADERS,
        ...LEADERSHIP_ROOM_HEADERS,
        { key: "faculty_directory_count", label: "إجمالي أعضاء هيئة التدريس" },
        { key: "term", label: "الفصل" },
        { key: "version", label: "مصدر الجدول المنشور" },
        { key: "version_updated_at", label: "آخر تعديل للنسخة" },
        { key: "notice", label: "ملاحظات اكتمال البيانات" },
      ].map((h) => [h.key, h]),
    ).values(),
  ];
  const periodLabel = data?.year
    ? `${data.year} · ${termTypeLabel(data.term_type ?? "")}`
    : "لم تُحدد فترة أكاديمية";
  const selectedValue = data?.year ? JSON.stringify({ year: data.year, type: data.term_type }) : "";
  const executiveColumns: ReportColumn<LeadershipRow>[] = [
    {
      key: "college",
      label: "الكلية",
      className: "w-[25%]",
      render: (row) => <CollegeExecutiveCell row={row} />,
    },
    {
      key: "term_state",
      label: "الجاهزية",
      className: "w-[16%]",
      render: (row) => <ReadinessCell row={row} />,
    },
    {
      key: "coverage",
      label: "تغطية الإسناد",
      className: "w-[14%]",
      render: (row) => <AssignmentCoverageCell row={row} />,
    },
    {
      key: "net_quota",
      label: "النصاب",
      className: "w-[13%]",
      render: (row) => <WorkloadCell row={row} />,
    },
    {
      key: "overload",
      label: "الزيادة / النقص",
      className: "w-[12%]",
      render: (row) => <BalanceCell row={row} />,
    },
    {
      key: "version",
      label: "الجدول والموارد",
      className: "w-[17%]",
      render: (row) => <PublishedResourcesCell row={row} />,
    },
    {
      key: "college_id",
      label: "التفاصيل",
      sortable: false,
      className: "w-[8%]",
      render: (row) => (
        <Button size="sm" variant="outline" asChild className="report-no-print">
          <Link to="/reports" onClick={() => setActiveCollegeId(row.college_id)}>
            عرض
          </Link>
        </Button>
      ),
    },
  ];
  return (
    <ReportShell
      title="المؤشرات التنفيذية للجامعة"
      filename={`university_leadership_${data?.year ?? ""}_${data?.term_type ?? ""}`}
      rows={rows}
      headers={exportHeaders}
      isLoading={query.isFetching}
      error={query.error}
      onRetry={() => void query.refetch()}
      printOrientation="landscape"
      filterSummary={periodLabel}
      headerMeta={{
        collegeName: "جميع كليات الجامعة",
        termName: periodLabel,
      }}
      filters={
        <div className="report-no-print flex flex-wrap items-end gap-3">
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
                {data?.periods.map((p) => (
                  <SelectItem key={`${p.year}:${p.type}`} value={JSON.stringify(p)}>
                    {p.year} · {termTypeLabel(p.type)}
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
            تحديث
          </Button>
        </div>
      }
      kpis={[
        { label: "أعضاء هيئة التدريس", value: totalFaculty },
        {
          label: "تغطية الإسناد",
          value: universityCoverage === null ? "—" : String(universityCoverage) + "%",
          tone: "accent",
        },
        {
          label: "الساعات الزائدة",
          value: sumLeadership(colleges, "overload"),
          tone: sumLeadership(colleges, "overload") > 0 ? "warning" : "neutral",
        },
        {
          label: "نقص النصاب",
          value: sumLeadership(colleges, "deficit"),
          tone: sumLeadership(colleges, "deficit") > 0 ? "warning" : "neutral",
        },
        {
          label: "الجداول المنشورة",
          value: String(published) + "/" + String(colleges.length),
          tone: published === colleges.length ? "success" : "warning",
        },
      ]}
      summary={
        <div className="space-y-3">
          <Card
            className="border-primary/20 bg-primary/5 px-4 py-3"
            data-testid="leadership-scope"
          >
            <div className="grid gap-2 text-center sm:grid-cols-3">
              <div>
                <div className="text-[11px] text-muted-foreground">الكليات</div>
                <div className="font-semibold tabular-nums">{colleges.length}</div>
              </div>
              <div>
                <div className="text-[11px] text-muted-foreground">بيانات أكاديمية جاهزة</div>
                <div className="font-semibold tabular-nums">
                  {ready}/{colleges.length}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-muted-foreground">تحتاج متابعة</div>
                <div className="font-semibold tabular-nums">{attentionCount}</div>
              </div>
            </div>
          </Card>
          <div className="grid gap-3 lg:grid-cols-3">
            <CountSummaryCard title="الرتب العلمية" entries={rankCounts} />
            <CountSummaryCard title="الحالة والتوافر" entries={availabilityCounts} />
            <CountSummaryCard title="التفرغ / التعاقد" entries={employmentCounts} />
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        <ReportSection title="مقارنة الكليات" count={rows.length} bodyClassName="p-0">
          <ReportDataTable
            rows={rows}
            caption="المؤشرات التنفيذية للكليات"
            rowKey={(row) => row.college_id}
            rowClassName={(row) =>
              Number(row.uncovered_hours ?? 0) > 0
                ? "bg-destructive/5"
                : hasLeadershipIssue(row)
                  ? "bg-amber-500/5"
                  : ""
            }
            primaryColumnLimit={8}
            minWidthClassName="min-w-[980px]"
            columns={executiveColumns}
          />
        </ReportSection>
      </div>
    </ReportShell>
  );
}
