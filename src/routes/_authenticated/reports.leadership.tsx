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
  type LeadershipCollege,
} from "@/lib/reports/leadership";

export const Route = createFileRoute("/_authenticated/reports/leadership")({
  head: () => ({ meta: [{ title: "لوحة الإدارة العليا للجامعة" }] }),
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

function CollegeExecutiveCell({ row }: { row: LeadershipRow }) {
  return (
    <div className="min-w-[210px] space-y-1 leading-5">
      <div className="font-bold text-primary">{row.college}</div>
      <div className="text-[11px] text-muted-foreground">
        {leadershipText(row.departments)} قسم · {leadershipText(row.programs)} برنامج ·{" "}
        {leadershipText(row.faculty_count)} عضو هيئة تدريس
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
        <div key={issue} className="text-[10px] text-muted-foreground">{issue}</div>
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
      <div><span className="text-[10px] text-muted-foreground">النصاب </span><b className="tabular-nums">{leadershipText(row.net_quota)} س</b></div>
      <div><span className="text-[10px] text-muted-foreground">المسند </span><span className="tabular-nums">{leadershipText(row.faculty_assigned_hours)} س</span></div>
    </div>
  );
}

function BalanceCell({ row }: { row: LeadershipRow }) {
  return (
    <div className="min-w-[115px] space-y-0.5 leading-5">
      <div><span className="text-[10px] text-muted-foreground">زائد </span><b className="tabular-nums">{leadershipText(row.overload)} س</b></div>
      <div><span className="text-[10px] text-muted-foreground">نقص </span><b className="tabular-nums">{leadershipText(row.deficit)} س</b></div>
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
  const colleges = !query.error && !query.isFetching ? (data?.colleges ?? []) : [];
  const ready = colleges.filter((c) => c.term_state === "ready").length;
  const published = colleges.filter((c) => !!c.version_id).length;
  const rows: LeadershipRow[] = colleges.map((c) => ({
    ...c,
    coverage: coveragePercent(c) === null ? "غير محسوبة" : String(coveragePercent(c)) + "%",
    notice: leadershipNotice(c),
  }));
  const totalFaculty = sumLeadership(colleges, "faculty_count");
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
    { key: "college", label: "الكلية", className: "w-[25%]", render: (row) => <CollegeExecutiveCell row={row} /> },
    { key: "term_state", label: "الجاهزية", className: "w-[16%]", render: (row) => <ReadinessCell row={row} /> },
    { key: "coverage", label: "تغطية الإسناد", className: "w-[14%]", render: (row) => <AssignmentCoverageCell row={row} /> },
    { key: "net_quota", label: "النصاب", className: "w-[13%]", render: (row) => <WorkloadCell row={row} /> },
    { key: "overload", label: "الزيادة / النقص", className: "w-[12%]", render: (row) => <BalanceCell row={row} /> },
    { key: "version", label: "الجدول والموارد", className: "w-[17%]", render: (row) => <PublishedResourcesCell row={row} /> },
    {
      key: "college_id",
      label: "التفاصيل",
      sortable: false,
      className: "w-[8%]",
      render: (row) => (
        <Button size="sm" variant="outline" asChild className="report-no-print">
          <Link to="/reports" onClick={() => setActiveCollegeId(row.college_id)}>عرض</Link>
        </Button>
      ),
    },
  ];
  return (
    <ReportShell
      title="لوحة الإدارة العليا للجامعة"
      description={`مرحبًا${me?.fullName ? `، ${me.fullName}` : " بك"}. ملخص الجامعة ومقارنة الكليات في صفحة واحدة.`}
      filename={`university_leadership_${data?.year ?? ""}_${data?.term_type ?? ""}`}
      rows={rows}
      headers={exportHeaders}
      isLoading={query.isFetching}
      error={query.error}
      onRetry={() => void query.refetch()}
      headerMeta={{
        collegeName: "جميع كليات الجامعة",
        termName: periodLabel,
        note: "الساعات أسبوعية · الإسناد الحالي · ساعات الجدول من أحدث نسخة منشورة لكل كلية",
      }}
      filters={
        <div className="report-no-print flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
          <ReportFilterField label="الفترة الأكاديمية للمقارنة" htmlFor="leadership-period">
            <Select
              value={selectedValue}
              onValueChange={(value) => setPeriod(JSON.parse(value))}
              disabled={query.isFetching}
            >
              <SelectTrigger id="leadership-period" aria-label="الفترة الأكاديمية للمقارنة">
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
            تحديث المؤشرات
          </Button>
          {data && (
            <p className="text-xs text-muted-foreground">
              وقت القراءة:{" "}
              {new Date(data.generated_at).toLocaleString("ar-YE", { timeZone: "Asia/Aden" })}
            </p>
          )}
        </div>
      }
      kpis={[
        { label: "كليات الجامعة", value: colleges.length },
        { label: "النصاب المتاح المعتمد (ساعة)", value: sumLeadership(colleges, "net_quota") },
        { label: "الساعات الزائدة", value: sumLeadership(colleges, "overload") },
        { label: "نقص النصاب", value: sumLeadership(colleges, "deficit") },
        { label: "عجز تغطية الإسناد", value: sumLeadership(colleges, "uncovered_hours") },
      ]}
      summary={
        <div className="space-y-3">
          <Card
            className="border-primary/20 bg-primary/5 p-4 text-sm leading-7"
            data-testid="leadership-scope"
          >
            الفترة: {periodLabel} · كليات لها فصل محدد: {ready}/{colleges.length} · كليات لها جدول
            منشور: {published}/{colleges.length}.
            <p>
              المجاميع تشمل البيانات القابلة للحساب فقط. علامة «—» تعني أن البيان غير متاح؛ لا تعني
              صفرًا.
            </p>
            <p>
              النصاب المتاح هو صافي النصاب بعد الإعفاء الإداري. نقص النصاب هو رصيد غير مستكمل لدى
              المحاضرين، أما عجز الإسناد فهو ساعات مقررات لم تُغطَّ.
            </p>
            <p>
              يُحسب عضو هيئة التدريس مرة واحدة وفق الرقم الجامعي الموحّد، وتُنسب أعباؤه إلى كلية
              إصدار رقمه مع جمع إسناداته عبر كليات الفترة المختارة. تُستبعد الحالات المتعارضة أو غير
              المكتملة من الزيادة والنقص.
            </p>
          </Card>
          <div className="report-no-print grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {colleges.map((c) => (
              <Card key={c.college_id} className="p-4">
                <h2 className="font-bold text-primary">{c.college}</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {c.departments} أقسام · {c.programs} برامج · {c.faculty_count} عضو هيئة تدريس
                </p>
                <div className="my-3 flex items-center justify-between text-sm">
                  <span>تغطية الإسناد</span>
                  <b>{coveragePercent(c) === null ? "غير محسوبة" : `${coveragePercent(c)}%`}</b>
                </div>
                <div
                  className="h-2 overflow-hidden rounded-full bg-muted"
                  role="img"
                  aria-label={`تغطية الإسناد: ${coveragePercent(c) ?? "غير محسوبة"}`}
                >
                  <div
                    className="h-full bg-primary"
                    style={{ width: `${coveragePercent(c) ?? 0}%` }}
                  />
                </div>
                <p className="mt-3 text-xs leading-6 text-muted-foreground">
                  {leadershipNotice(c)}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" asChild>
                    <Link to="/reports" onClick={() => setActiveCollegeId(c.college_id)}>
                      تقارير الكلية
                    </Link>
                  </Button>
                  {c.term_id && (
                    <Button size="sm" variant="outline" asChild>
                      <Link
                        to="/reports/academic-affairs"
                        search={{ report: "workload", termId: c.term_id }}
                        onClick={() => setActiveCollegeId(c.college_id)}
                      >
                        النصاب والإسناد
                      </Link>
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        {table("مقارنة النصاب والساعات الزائدة والنقص", LEADERSHIP_WORKLOAD_HEADERS)}
        {table("تغطية الإسناد التدريسي", LEADERSHIP_ASSIGNMENT_HEADERS)}
        {table("الساعات التدريسية في الجداول المنشورة", LEADERSHIP_TEACHING_HEADERS)}
        {table("القاعات والمعامل المتاحة والمستخدمة", LEADERSHIP_ROOM_HEADERS)}
        <ReportSection title="مصادر الأرقام وحالة البيانات" bodyClassName="p-0">
          <ReportDataTable
            rows={rows}
            columns={[
              { key: "college", label: "الكلية" },
              { key: "term", label: "الفصل" },
              { key: "version", label: "أحدث جدول منشور" },
              { key: "notice", label: "ملاحظات" },
            ]}
          />
        </ReportSection>
        <p className="text-xs leading-6 text-muted-foreground">
          الإسناد يعكس مجموعات التدريس النشطة الحالية؛ لا تُحتسب المجموعات القديمة أو الملغاة. ساعات
          النظري والعملي تعكس جلسات نسخة منشورة واحدة لكل كلية، دون جمع المسودات أو تكرار النسخ.
          القاعات والمعامل والمقاعد تشمل الموارد النشطة، وقد توجد أنواع أخرى ضمن إجمالي الموارد.
          الربط بالرقم الجامعي يمنع ازدواج الأعضاء المرتبطين به؛ السجلات غير المرتبطة تبقى مستقلة.
        </p>
      </div>
    </ReportShell>
  );
}
