import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/use-current-user";
import { canViewLeadership } from "@/lib/viewer-roles";
import { UnauthorizedAccess } from "@/components/unauthorized-access";
import { ReportShell } from "@/components/reports/report-shell";
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
  termTypeLabel,
} from "@/lib/reports/leadership";
import {
  leadershipViewerKey,
  LEADERSHIP_QUERY_POLICY,
} from "@/lib/reports/leadership-decisions";
import { fetchLeadershipRoomCapacity } from "@/lib/reports/fetch-leadership-room-capacity";
import { fetchTeachingDemandDetails } from "@/lib/reports/fetch-teaching-demand-capacity";
import {
  capacityAssessment,
  summarizeDemandCapacity,
  summarizeUniversityCapacity,
} from "@/lib/reports/teaching-demand-capacity";

export const Route = createFileRoute(
  "/_authenticated/reports/teaching-demand-capacity",
)({
  head: () => ({
    meta: [{ title: "الساعات المطلوبة وسعة القاعات | جامعة إقليم سبأ" }],
  }),
  component: Page,
});

const display = (n: number | null | undefined) =>
  n == null
    ? "غير محسوب"
    : `${n.toLocaleString("ar", { maximumFractionDigits: 2 })} ساعة`;
const statusText = (status: string) =>
  status === "calculable"
    ? "محسوب من بيانات المنصة"
    : status === "partial"
      ? "قيد استكمال المصدر"
      : "غير محسوب";

function Page() {
  const { data: me, isLoading: roleLoading } = useCurrentUser();
  if (roleLoading)
    return <Card className="p-6">جارٍ التحقق من الصلاحيات…</Card>;
  if (!me || !canViewLeadership(me)) return <UnauthorizedAccess />;
  return (
    <DemandCapacityReport
      viewerKey={leadershipViewerKey(me)}
      admin={!!me.isSuperAdmin}
      dean={
        !!me.isCollegeDean && !me.isSuperAdmin && !me.isUniversityLeadership
      }
    />
  );
}

function DemandCapacityReport({
  viewerKey,
  admin,
  dean,
}: {
  viewerKey: string;
  admin: boolean;
  dean: boolean;
}) {
  const [period, setPeriod] = useState<{ year: string; type: string } | null>(
    null,
  );
  const [collegeFilter, setCollegeFilter] = useState("all");
  const overview = useQuery({
    queryKey: ["university-leadership", viewerKey, period],
    ...LEADERSHIP_QUERY_POLICY,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("leadership_overview", {
        p_academic_year: period?.year ?? undefined,
        p_term_type: period?.type ?? undefined,
      });
      if (error) throw new Error("تعذر تحميل بيانات الفصل والكليات");
      return leadershipOverviewSchema.parse(data);
    },
  });
  // Scope comes solely from the authorized RPC, never from the active college or a URL parameter.
  const colleges = (overview.data?.colleges ?? []).filter(
    (c) => !c.college.includes("اختبار تبسيط الجداول"),
  );
  const capacity = useQuery({
    queryKey: [
      "leadership-room-capacity",
      viewerKey,
      overview.data?.year,
      overview.data?.term_type,
      overview.data?.generated_at,
    ],
    enabled: colleges.length > 0,
    ...LEADERSHIP_QUERY_POLICY,
    retry: false,
    queryFn: () => fetchLeadershipRoomCapacity(colleges),
  });
  const detail = useQuery({
    queryKey: [
      "teaching-demand-program-level",
      viewerKey,
      overview.data?.year,
      overview.data?.term_type,
      overview.data?.generated_at,
    ],
    enabled: admin && colleges.length > 0,
    ...LEADERSHIP_QUERY_POLICY,
    retry: false,
    queryFn: () => fetchTeachingDemandDetails(colleges),
  });
  const summaryRows = capacity.data
    ? summarizeDemandCapacity(colleges, capacity.data)
    : [];
  const visibleSummary = admin && collegeFilter !== "all"
    ? summaryRows.filter((r) => r.collegeId === collegeFilter)
    : summaryRows;
  const university = summarizeUniversityCapacity(summaryRows);
  const breakdown = admin ? (detail.data?.rows ?? []) : [];
  const filtered =
    collegeFilter === "all"
      ? breakdown
      : breakdown.filter((r) => r.collegeId === collegeFilter);
  const summaryHeaders = [
    { key: "college", label: "الكلية" },
    { key: "rooms", label: "القاعات النشطة المسجلة" },
    { key: "required", label: "الساعات المطلوبة المسجلة" },
    { key: "available", label: "الساعات المتاحة في القاعات المسجلة" },
    { key: "balance", label: "الفرق الحسابي" },
    { key: "status", label: "حالة البيانات" },
    { key: "assessment", label: "تحليل أولي" },
    { key: "issues", label: "ملاحظات" },
  ];
  const detailHeaders = [
    { key: "college", label: "الكلية" },
    { key: "program", label: "البرنامج" },
    { key: "level", label: "المستوى" },
    { key: "groups", label: "مجموعات التدريس" },
    { key: "missingCohorts", label: "دفعات بلا مجموعات" },
    { key: "theory", label: "نظري" },
    { key: "practical", label: "عملي ومعامل" },
    { key: "other", label: "مكونات أخرى" },
    { key: "required", label: "المطلوب للمستوى" },
    { key: "shared", label: "منه محاضرات مشتركة" },
  ];
  const exportRows =
    admin && filtered.length
      ? filtered.map((r) => ({
          college: r.college,
          program: r.program,
          level: r.level,
          groups: r.groups,
          missingCohorts: r.cohortsWithoutGroups,
          theory: r.theoryHours,
          practical: r.practicalHours,
          other: r.otherHours,
          required: r.cohortsWithoutGroups ? "قيد الاستكمال" : r.requiredHours,
          shared: r.sharedHours,
        }))
      : visibleSummary.map((r) => ({
          college: r.college,
          rooms: r.rooms ?? "غير محسوب",
          required: r.requiredHours ?? "غير محسوب",
          available: r.availableHours ?? "غير محسوب",
          balance: r.balanceHours ?? "غير محسوب",
          status: statusText(r.status),
          assessment: capacityAssessment(r),
          issues: r.issues.join("؛ "),
        }));
  const error = !overview.data
    ? overview.error
    : (capacity.error ?? (admin ? detail.error : null));
  const loading =
    overview.isPending || (colleges.length > 0 && capacity.isPending) ||
    (admin && colleges.length > 0 && detail.isPending);
  const periodLabel = overview.data?.year
    ? `${overview.data.year} · ${termTypeLabel(overview.data.term_type ?? "")}`
    : "الفصل غير محدد";

  return (
    <ReportShell
      title="الساعات التدريسية المطلوبة وسعة القاعات"
      description={
        admin
          ? "تفصيل الكلية والبرنامج والمستوى ومقارنة الطلب المسجل بإتاحة القاعات."
          : dean
            ? "ملخص الكلية المسندة، دون تفاصيل البرامج."
            : "ملخص الجامعة ومقارنة الكليات."
      }
      filename={`teaching_demand_capacity_${overview.data?.year ?? ""}_${overview.data?.term_type ?? ""}`}
      filterSummary={periodLabel}
      headerMeta={{
        collegeName: dean
          ? (colleges[0]?.college ?? "الكلية المسندة")
          : "جميع كليات الجامعة",
        termName: periodLabel,
        note: "طلب المجموعات من الإسناد النشط؛ الإتاحة من قاعات الكلية المسجلة وأوقات توفرها. الفرق الحسابي لا يثبت إمكانية التسكين دون فحص النوع والتوقيت والسعة والملكية.",
      }}
      rows={exportRows}
      headers={admin && filtered.length ? detailHeaders : summaryHeaders}
      isLoading={loading}
      notReadyMessage={overview.data && colleges.length === 0 ? "لا توجد كلية مصرح بها في هذا الفصل" : undefined}
      error={error}
      onRetry={() => {
        void overview.refetch();
        void capacity.refetch();
        if (admin) void detail.refetch();
      }}
      filters={
        <div className="report-no-print flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-sm">
            الفصل الأكاديمي
            <Select
              value={
                overview.data?.year
                  ? JSON.stringify({
                      year: overview.data.year,
                      type: overview.data.term_type,
                    })
                  : ""
              }
              onValueChange={(value) => {
                setCollegeFilter("all");
                setPeriod(JSON.parse(value));
              }}
            >
              <SelectTrigger aria-label="الفصل الأكاديمي" className="min-w-56">
                <SelectValue placeholder="اختر الفصل" />
              </SelectTrigger>
              <SelectContent>
                {overview.data?.periods.map((p) => (
                  <SelectItem
                    key={`${p.year}:${p.type}`}
                    value={JSON.stringify(p)}
                  >
                    {p.year} · {termTypeLabel(p.type)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          {admin && (
            <label className="grid gap-1 text-sm">
              كلية التفاصيل
              <Select value={collegeFilter} onValueChange={setCollegeFilter}>
                <SelectTrigger aria-label="كلية التفاصيل" className="min-w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الكليات</SelectItem>
                  {colleges.map((c) => (
                    <SelectItem key={c.college_id} value={c.college_id}>
                      {c.college}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          )}
          <Button variant="outline" onClick={() => void overview.refetch()}>
            تحديث
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <Card className="p-4">
            <p className="text-sm text-muted-foreground">
              الساعات المطلوبة المسجلة
            </p>
            <strong className="text-xl">
              {dean
                ? display(summaryRows[0]?.requiredHours)
                : display(university.requiredHours)}
            </strong>
          </Card>
          <Card className="p-4">
            <p className="text-sm text-muted-foreground">
              ساعات القاعات المتاحة أسبوعيًا
            </p>
            <strong className="text-xl">
              {dean
                ? display(summaryRows[0]?.availableHours)
                : display(university.availableHours)}
            </strong>
          </Card>
          <Card className="p-4">
            <p className="text-sm text-muted-foreground">الفرق الحسابي</p>
            <strong className="text-xl">
              {dean
                ? display(summaryRows[0]?.balanceHours)
                : display(university.balanceHours)}
            </strong>
            {!dean && !university.complete && (
              <p className="text-xs text-amber-700">
                اكتمال المقارنة: {university.calculable} من{" "}
                {university.colleges} كليات
              </p>
            )}
          </Card>
        </div>
        <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          الساعات المطلوبة هي ساعات مجموعات التدريس المسجلة، بما فيها غير
          المسندة وغير المجدولة. الإتاحة تحسب من القاعات النشطة المنسوبة لكل
          كلية في المنصة. إذا كانت المجموعات أو ملكية القاعات أو مواعيد الإتاحة
          قيد التصحيح، فالفرق مؤشر حسابي للمراجعة وليس فائضًا معتمدًا أو قاعة
          قابلة للتفريغ.
        </p>
        <div className="overflow-x-auto rounded border">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="p-3 text-start">الكلية</th>
                <th className="p-3 text-start">عدد القاعات</th>
                <th className="p-3 text-start">المطلوب</th>
                <th className="p-3 text-start">المتاح</th>
                <th className="p-3 text-start">الفرق</th>
                <th className="p-3 text-start">التحليل</th>
                <th className="p-3 text-start">البيان</th>
              </tr>
            </thead>
            <tbody>
              {visibleSummary.map((r) => (
                <tr key={r.collegeId} className="border-t align-top">
                  <td className="p-3 font-semibold">{r.college}</td>
                  <td className="p-3">{r.rooms ?? "غير محسوب"}</td>
                  <td className="p-3">{display(r.requiredHours)}</td>
                  <td className="p-3">{display(r.availableHours)}</td>
                  <td className="p-3">{display(r.balanceHours)}</td>
                  <td className="p-3">{capacityAssessment(r)}</td>
                  <td className="p-3">
                    {statusText(r.status)}
                    {r.issues.length > 0 && (
                      <p className="mt-1 text-xs text-amber-800">
                        {r.issues.join("؛ ")}
                      </p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {admin && (
          <section className="space-y-3" aria-label="تفصيل البرامج والمستويات">
            <h2 className="text-lg font-bold">
              تفصيل الساعات المطلوبة حسب البرنامج والمستوى
            </h2>
            <p className="text-sm text-muted-foreground">
              المحاضرة المشتركة تظهر في كل برنامج/مستوى يستفيد منها؛ مجموع
              الجدول التفصيلي قد يزيد عن طلب القاعات الفعلي للكلية. إجمالي
              الكلية أعلاه يحسب مجموعة المحاضرة المشتركة مرة واحدة. المستوى
              الذي به دفعة بلا مجموعات يحتاج استكمال الإدخال قبل اعتماد مجموعه.
            </p>
            <div className="overflow-x-auto rounded border">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    {detailHeaders.map((h) => (
                      <th key={h.key} className="p-3 text-start">
                        {h.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr
                      key={`${r.collegeId}:${r.programId}:${r.levelId}`}
                      className="border-t"
                    >
                      <td className="p-3">{r.college}</td>
                      <td className="p-3">{r.program}</td>
                      <td className="p-3">{r.level}</td>
                      <td className="p-3">{r.groups}</td>
                      <td className="p-3">{r.cohortsWithoutGroups || "—"}</td>
                      <td className="p-3">{display(r.theoryHours)}</td>
                      <td className="p-3">{display(r.practicalHours)}</td>
                      <td className="p-3">{display(r.otherHours)}</td>
                      <td className="p-3 font-semibold">
                        {r.cohortsWithoutGroups ? "قيد الاستكمال" : display(r.requiredHours)}
                      </td>
                      <td className="p-3">{display(r.sharedHours)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!filtered.length && (
              <p className="text-sm">
                لا توجد دفعات أو مجموعات تدريس مطابقة لهذا النطاق.
              </p>
            )}
          </section>
        )}
      </div>
    </ReportShell>
  );
}
