import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ReportShell } from "@/components/reports/report-shell";
import { ReportFilters } from "@/components/reports/report-filters";
import { ReportSection, ReportDataTable } from "@/components/reports/report-section";
import { Badge } from "@/components/ui/badge";
import { fetchCollegeReadiness, readinessMetricsToRows } from "@/lib/reports/readiness";
import { useReportContext } from "@/hooks/reports/useReportContext";
import { filterRowsBySearch } from "@/lib/reports/search";

export const Route = createFileRoute("/_authenticated/reports/data-readiness")({
  head: () => ({ meta: [{ title: "تقرير جاهزية البيانات" }] }),
  component: Page,
});

const headers = [
  { key: "category", label: "الفئة" },
  { key: "check_name", label: "الفحص" },
  { key: "status", label: "الحالة" },
  { key: "missing_count", label: "الناقص" },
  { key: "total_count", label: "الإجمالي" },
  { key: "pct_missing", label: "نسبة الناقص %" },
  { key: "severity", label: "الخطورة" },
  { key: "message", label: "الرسالة" },
  { key: "suggested_action", label: "الإجراء المقترح" },
];

function Page() {
  const ctx = useReportContext({
    defaultStatusMode: "specific_version",
    defaultStudySystem: "all",
  });
  const [search, setSearch] = useState("");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["rep-readiness", ctx.collegeId],
    enabled: !!ctx.collegeId,
    queryFn: () => fetchCollegeReadiness(ctx.collegeId!),
  });

  const allRows = useMemo(() => (data ? readinessMetricsToRows(data) : []), [data]);
  // Search is presentation-only: identical keys and values, fewer visible rows.
  const rows = useMemo(
    () =>
      filterRowsBySearch(allRows, search).sort(
        (a, b) => Number(b.status === "حرج") - Number(a.status === "حرج"),
      ),
    [allRows, search],
  );

  const criticalCount = allRows.filter((r) => r.status === "حرج").length;
  const readyCount = allRows.filter((r) => r.status === "جاهز").length;

  return (
    <ReportShell
      title="تقرير جاهزية البيانات"
      description="قراءة فقط — تقييم جاهزية البيانات الأكاديمية على مستوى الكلية."

      headerMeta={{
        note: "تقييم على مستوى الكلية — لا يعتمد على نسخة جدول. لا يُشغّل cleanup أو import.",
      }}
      filename="data_readiness_report"
      rows={rows}
      headers={headers}
      isLoading={ctx.isLoading || isLoading}
      error={ctx.error ?? error}
      onRetry={() => void refetch()}
      notReadyMessage={ctx.collegeId ? undefined : "اختر كلّية لعرض فحوص الجاهزية."}
      emptyMessage={search ? "لا فحوص مطابقة للبحث." : "لا توجد فحوص."}
      kpis={
        data
          ? [
              { label: "الجاهزية العامة", value: `${data.scores.overall}/100`, tone: "accent" },
              { label: "الخطط", value: `${data.scores.studyPlanScore}/100` },
              { label: "الموارد", value: `${data.scores.resourcesScore}/100` },
              { label: "الجدولة", value: `${data.scores.schedulingScore}/100` },
              {
                label: "فحوص حرجة",
                value: criticalCount,
                hint: `جاهز: ${readyCount}`,
                tone: criticalCount > 0 ? "danger" : "neutral",
              },
            ]
          : undefined
      }
      filters={
        <ReportFilters
          context={ctx}
          term={false}
          version={false}
          statusMode={false}
          studySystem={false}
          search={{ value: search, onChange: setSearch, placeholder: "ابحث باسم الفحص أو الفئة…" }}
          onClear={() => setSearch("")}
        />
      }
    >
      <ReportSection
        title="فحوص الجاهزية"
        count={rows.length}
        hint="كل فحص يوضح الناقص والإجمالي والإجراء المقترح لمعالجته."
        bodyClassName="p-0"
      >
        <ReportDataTable
          columns={[
            { key: "category", label: "الفئة" },
            { key: "check_name", label: "الفحص" },
            {
              key: "status",
              label: "الحالة",
              render: (r) => (
                <Badge
                  variant={
                    r.status === "جاهز"
                      ? "secondary"
                      : r.status === "حرج"
                        ? "destructive"
                        : "outline"
                  }
                >
                  {String(r.status)}
                </Badge>
              ),
            },
            { key: "missing_count", label: "الناقص", numeric: true },
            { key: "total_count", label: "الإجمالي", numeric: true, secondary: true },
            { key: "pct_missing", label: "نسبة الناقص %", numeric: true, secondary: true },
            { key: "severity", label: "الخطورة", secondary: true },
            { key: "message", label: "الرسالة", className: "text-xs" },
            {
              key: "suggested_action",
              label: "الإجراء المقترح",
              secondary: true,
              className: "text-xs text-muted-foreground",
            },
          ]}
          rows={rows}
          caption="فحوص جاهزية البيانات"
        />
      </ReportSection>
    </ReportShell>
  );
}
