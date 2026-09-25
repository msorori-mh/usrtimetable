import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/use-current-user";
import { canViewLeadership } from "@/lib/viewer-roles";
import { UnauthorizedAccess } from "@/components/unauthorized-access";
import { ReportShell } from "@/components/reports/report-shell";
import { ReportFilterBar, ReportFilterField } from "@/components/reports/report-filter-bar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { leadershipOverviewSchema, termTypeLabel } from "@/lib/reports/leadership";
import { leadershipViewerKey, LEADERSHIP_QUERY_POLICY } from "@/lib/reports/leadership-decisions";
import { fetchLeadershipRoomCapacity } from "@/lib/reports/fetch-leadership-room-capacity";
import { fetchTeachingDemandDetails } from "@/lib/reports/fetch-teaching-demand-capacity";
import { downloadCSV, downloadXLSX } from "@/lib/reports/export";
import {
  capacityAssessment,
  summarizeDemandCapacity,
  summarizeUniversityCapacity,
} from "@/lib/reports/teaching-demand-capacity";

export const Route = createFileRoute("/_authenticated/reports/teaching-demand-capacity")({
  head: () => ({
    meta: [{ title: "الساعات المطلوبة وسعة القاعات والمعامل | جامعة إقليم سبأ" }],
  }),
  component: Page,
});

const display = (n: number | null | undefined) =>
  n == null ? "غير محسوب" : `${n.toLocaleString("ar", { maximumFractionDigits: 2 })} ساعة`;
const statusText = (status: string) =>
  status === "calculable"
    ? "محسوب من بيانات المنصة"
    : status === "partial"
      ? "قيد استكمال المصدر"
      : "غير محسوب";

function Page() {
  const { data: me, isLoading: roleLoading } = useCurrentUser();
  if (roleLoading) return <Card className="p-6">جارٍ التحقق من الصلاحيات…</Card>;
  if (!me || !canViewLeadership(me)) return <UnauthorizedAccess />;
  return (
    <DemandCapacityReport
      viewerKey={leadershipViewerKey(me)}
      admin={!!me.isSuperAdmin}
      dean={!!me.isCollegeDean && !me.isSuperAdmin && !me.isUniversityLeadership}
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
  const [period, setPeriod] = useState<{ year: string; type: string } | null>(null);
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
  const summaryRows = capacity.data ? summarizeDemandCapacity(colleges, capacity.data) : [];
  const visibleSummary =
    admin && collegeFilter !== "all"
      ? summaryRows.filter((r) => r.collegeId === collegeFilter)
      : summaryRows;
  const university = summarizeUniversityCapacity(visibleSummary);
  const selectedCollege = dean || (admin && collegeFilter !== "all") ? visibleSummary[0] : null;
  const headline = selectedCollege ?? university;
  const breakdown = admin ? (detail.data?.rows ?? []) : [];
  const filtered =
    collegeFilter === "all" ? breakdown : breakdown.filter((r) => r.collegeId === collegeFilter);
  const summaryHeaders = [
    { key: "college", label: "الكلية" },
    { key: "hallRooms", label: "عدد قاعات المحاضرات" },
    { key: "hallAvailableHours", label: "ساعات قاعات المحاضرات المتاحة" },
    { key: "labRooms", label: "عدد المعامل" },
    { key: "labAvailableHours", label: "ساعات المعامل المتاحة" },
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
  const summaryExportRows = visibleSummary.map((r) => ({
    college: r.college,
    hallRooms: r.hallRooms ?? "غير محسوب",
    hallAvailableHours: r.hallAvailableHours ?? "غير محسوب",
    labRooms: r.labRooms ?? "غير محسوب",
    labAvailableHours: r.labAvailableHours ?? "غير محسوب",
    required: r.requiredHours ?? "غير محسوب",
    available: r.availableHours ?? "غير محسوب",
    balance: r.balanceHours ?? "غير محسوب",
    status: statusText(r.status),
    assessment: capacityAssessment(r),
    issues: r.issues.join("؛ "),
  }));
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
      : summaryExportRows;
  const error = !overview.data ? overview.error : (capacity.error ?? (admin ? detail.error : null));
  const loading =
    overview.isPending ||
    (colleges.length > 0 && capacity.isPending) ||
    (admin && colleges.length > 0 && detail.isPending);
  const periodLabel = overview.data?.year
    ? `${overview.data.year} · ${termTypeLabel(overview.data.term_type ?? "")}`
    : "الفصل غير محدد";

  return (
    <ReportShell
      title="الساعات التدريسية المطلوبة وسعة القاعات والمعامل"
      description={
        admin
          ? "تفصيل الكلية والبرنامج والمستوى ومقارنة الطلب المسجل بإتاحة القاعات."
          : dean
            ? "ملخص الكلية المسندة، دون تفاصيل البرامج."
            : "ملخص الجامعة ومقارنة الكليات."
      }
      filename={`teaching_demand_capacity_${overview.data?.year ?? ""}_${overview.data?.term_type ?? ""}`}
      filterSummary={`${periodLabel}${selectedCollege ? ` · الكلية: ${selectedCollege.college}` : ""}`}
      headerMeta={{
        collegeName: selectedCollege?.college ?? "جميع كليات الجامعة",
        termName: periodLabel,
        note: "طلب المجموعات من الإسناد النشط؛ عدد وساعات قاعات المحاضرات والمعامل منفصلان حسب نوع المكان المسجل. الفرق الإجمالي لا يثبت إمكانية التسكين دون فحص النوع والتوقيت والسعة والملكية.",
      }}
      rows={exportRows}
      headers={admin && filtered.length ? detailHeaders : summaryHeaders}
      isLoading={loading}
      notReadyMessage={
        overview.data && colleges.length === 0 ? "لا توجد كلية مصرح بها في هذا الفصل" : undefined
      }
      error={error}
      onRetry={() => {
        void overview.refetch();
        void capacity.refetch();
        if (admin) void detail.refetch();
      }}
      filters={
        <ReportFilterBar
          activeSummary={[
            periodLabel,
            admin && collegeFilter !== "all"
              ? `الكلية: ${colleges.find((c) => c.college_id === collegeFilter)?.college ?? ""}`
              : "",
          ]}
          onClear={() => {
            setPeriod(null);
            setCollegeFilter("all");
          }}
          basic={
            <>
              <ReportFilterField label="الفصل الأكاديمي" htmlFor="demand-capacity-period">
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
                  <SelectTrigger
                    id="demand-capacity-period"
                    aria-label="الفصل الأكاديمي"
                    className="min-w-56"
                  >
                    <SelectValue placeholder="اختر الفصل" />
                  </SelectTrigger>
                  <SelectContent>
                    {overview.data?.periods.map((p) => (
                      <SelectItem key={`${p.year}:${p.type}`} value={JSON.stringify(p)}>
                        {p.year} · {termTypeLabel(p.type)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </ReportFilterField>
              {admin && (
                <ReportFilterField label="كلية التفاصيل" htmlFor="demand-capacity-college">
                  <Select value={collegeFilter} onValueChange={setCollegeFilter}>
                    <SelectTrigger
                      id="demand-capacity-college"
                      aria-label="كلية التفاصيل"
                      className="min-w-56"
                    >
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
                </ReportFilterField>
              )}
              <Button
                className="self-end"
                variant="outline"
                onClick={() => {
                  void overview.refetch();
                  void capacity.refetch();
                  if (admin) void detail.refetch();
                }}
              >
                تحديث
              </Button>
            </>
          }
        />
      }
    >
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Card className="p-4">
            <p className="text-sm text-muted-foreground">الساعات المطلوبة المسجلة</p>
            <strong className="text-xl">{display(headline.requiredHours)}</strong>
          </Card>
          <Card className="p-4">
            <p className="text-sm text-muted-foreground">قاعات المحاضرات النشطة</p>
            <strong className="text-xl">{headline.hallRooms ?? "غير محسوب"}</strong>
            <p className="text-sm">المتاح: {display(headline.hallAvailableHours)} أسبوعيًا</p>
          </Card>
          <Card className="p-4">
            <p className="text-sm text-muted-foreground">المعامل النشطة</p>
            <strong className="text-xl">{headline.labRooms ?? "غير محسوب"}</strong>
            <p className="text-sm">المتاح: {display(headline.labAvailableHours)} أسبوعيًا</p>
          </Card>
          <Card className="p-4">
            <p className="text-sm text-muted-foreground">الساعات المتاحة إجمالًا</p>
            <strong className="text-xl">{display(headline.availableHours)}</strong>
          </Card>
          <Card className="p-4">
            <p className="text-sm text-muted-foreground">الفرق الحسابي</p>
            <strong className="text-xl">{display(headline.balanceHours)}</strong>
            {!selectedCollege && !university.complete && (
              <p className="text-xs text-amber-700">
                اكتمال المقارنة: {university.calculable} من {university.colleges} كليات
              </p>
            )}
          </Card>
        </div>
        <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          الساعات المطلوبة هي ساعات مجموعات التدريس المسجلة، بما فيها غير المسندة وغير المجدولة.
          الإتاحة تحسب للقاعات والمعامل النشطة، كلٌّ حسب نوعه المسجل، والمنسوبة لكل كلية في المنصة.
          إذا كانت المجموعات أو ملكية القاعات أو مواعيد الإتاحة قيد التصحيح، فالفرق مؤشر حسابي
          للمراجعة وليس فائضًا معتمدًا أو قاعة قابلة للتفريغ.
        </p>
        {admin && filtered.length > 0 && (
          <div className="flex flex-wrap gap-2 report-no-print">
            <Button
              variant="outline"
              size="sm"
              disabled={loading || !!error}
              onClick={() =>
                downloadXLSX(summaryExportRows, summaryHeaders, "ملخص_القاعات_والمعامل")
              }
            >
              تصدير ملخص القاعات والمعامل Excel
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={loading || !!error}
              onClick={() =>
                downloadCSV(summaryExportRows, summaryHeaders, "ملخص_القاعات_والمعامل")
              }
            >
              تصدير الملخص CSV
            </Button>
          </div>
        )}
        <div className="overflow-x-auto rounded border">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="p-3 text-start">الكلية</th>
                <th className="p-3 text-start">قاعات المحاضرات</th>
                <th className="p-3 text-start">المعامل</th>
                <th className="p-3 text-start">المطلوب</th>
                <th className="p-3 text-start">المتاح إجمالًا</th>
                <th className="p-3 text-start">الفرق</th>
                <th className="p-3 text-start">التحليل</th>
                <th className="p-3 text-start">البيان</th>
              </tr>
            </thead>
            <tbody>
              {visibleSummary.map((r) => (
                <tr key={r.collegeId} className="border-t align-top">
                  <td className="p-3 font-semibold">{r.college}</td>
                  <td className="p-3">
                    <strong>{r.hallRooms ?? "غير محسوب"}</strong>
                    <div className="text-xs text-muted-foreground">
                      {display(r.hallAvailableHours)} متاحة أسبوعيًا
                    </div>
                  </td>
                  <td className="p-3">
                    <strong>{r.labRooms ?? "غير محسوب"}</strong>
                    <div className="text-xs text-muted-foreground">
                      {display(r.labAvailableHours)} متاحة أسبوعيًا
                    </div>
                  </td>
                  <td className="p-3">{display(r.requiredHours)}</td>
                  <td className="p-3">{display(r.availableHours)}</td>
                  <td className="p-3">{display(r.balanceHours)}</td>
                  <td className="p-3">{capacityAssessment(r)}</td>
                  <td className="p-3">
                    {statusText(r.status)}
                    {r.issues.length > 0 && (
                      <p className="mt-1 text-xs text-amber-800">{r.issues.join("؛ ")}</p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {admin && (
          <section className="space-y-3" aria-label="تفصيل البرامج والمستويات">
            <h2 className="text-lg font-bold">تفصيل الساعات المطلوبة حسب البرنامج والمستوى</h2>
            <p className="text-sm text-muted-foreground">
              المحاضرة المشتركة تظهر في كل برنامج/مستوى يستفيد منها؛ مجموع الجدول التفصيلي قد يزيد
              عن طلب القاعات الفعلي للكلية. إجمالي الكلية أعلاه يحسب مجموعة المحاضرة المشتركة مرة
              واحدة. المستوى الذي به دفعة بلا مجموعات يحتاج استكمال الإدخال قبل اعتماد مجموعه.
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
                    <tr key={`${r.collegeId}:${r.programId}:${r.levelId}`} className="border-t">
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
              <p className="text-sm">لا توجد دفعات أو مجموعات تدريس مطابقة لهذا النطاق.</p>
            )}
          </section>
        )}
      </div>
    </ReportShell>
  );
}
