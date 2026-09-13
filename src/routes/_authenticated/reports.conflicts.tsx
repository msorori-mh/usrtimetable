import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ReportShell } from "@/components/reports/report-shell";
import { ReportFilters } from "@/components/reports/report-filters";
import { ReportSection, ReportDataTable } from "@/components/reports/report-section";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Info, ShieldAlert } from "lucide-react";
import { fetchConflictReportRows } from "@/lib/reports/queries/operational-queries";
import { useReportContext } from "@/hooks/reports/useReportContext";
import { filterRowsBySearch } from "@/lib/reports/search";

export const Route = createFileRoute("/_authenticated/reports/conflicts")({
  head: () => ({ meta: [{ title: "تقرير التعارضات" }] }),
  component: Page,
});

const headers = [
  { key: "classification", label: "Classification" },
  { key: "evidence_status", label: "Evidence" },
  { key: "cohort", label: "Cohort" },
  { key: "delivery_group", label: "Delivery group" },
  { key: "legacy_section", label: "Legacy section" },
  { key: "resolution_detail", label: "Exception / resolution" },
  { key: "conflict_code", label: "رمز التعارض" },
  { key: "message", label: "الرسالة" },
  { key: "course", label: "المقرر" },
  { key: "instructor", label: "المحاضر" },
  { key: "room", label: "القاعة" },
  { key: "day_time", label: "اليوم/الوقت" },
  { key: "study_system", label: "نظام الدراسة" },
  { key: "check_status", label: "حالة الفحص" },
];

const SEVERITY_META: Record<
  string,
  { label: string; variant: "destructive" | "secondary" | "outline"; rowClass: string }
> = {
  hard: { label: "إلزامي", variant: "destructive", rowClass: "bg-destructive/5" },
  soft: { label: "مرن", variant: "secondary", rowClass: "bg-amber-500/5" },
  warning: { label: "تحذير", variant: "outline", rowClass: "bg-muted/40" },
};

function severityMeta(raw: unknown) {
  const key = String(raw ?? "").toLowerCase();
  return SEVERITY_META[key] ?? { label: String(raw), variant: "outline" as const, rowClass: "" };
}

function ConflictSeverityBadge({ severity }: { severity: unknown }) {
  const meta = severityMeta(severity);
  return (
    <Badge variant={meta.variant} className="gap-1 font-medium">
      <ShieldAlert className="h-3 w-3" />
      {meta.label}
    </Badge>
  );
}

/** Maps a stored classification onto the shared severity palette. */
function severityKeyFor(classification: unknown) {
  return classification === "hard_blocker" ? "hard" : classification === "warning" ? "soft" : "warning";
}

function Page() {
  const ctx = useReportContext({
    defaultStatusMode: "specific_version",
    defaultStudySystem: "all",
  });
  const [search, setSearch] = useState("");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["rep-conflicts", ctx.collegeId, ctx.versionId, ctx.studySystem],
    enabled: !!ctx.collegeId && !!ctx.versionId,
    queryFn: () =>
      fetchConflictReportRows({
        collegeId: ctx.collegeId!,
        versionId: ctx.versionId,
        studySystem: ctx.studySystem,
      }),
  });

  const allRows = useMemo(() => data?.rows ?? [], [data]);
  // Search is presentation-only: identical keys and values, fewer visible rows.
  const rows = useMemo(() => filterRowsBySearch(allRows, search), [allRows, search]);
  const check = data?.check;

  const hardCount = useMemo(
    () => rows.filter((r) => r.classification === "hard_blocker").length,
    [rows],
  );
  const softCount = useMemo(() => rows.filter((r) => r.classification === "warning").length, [rows]);

  return (
    <ReportShell
      title="تقرير التعارضات"
      description={
        check
          ? `آخر فحص: ${new Date(check.created_at).toLocaleString("ar")} · ${check.total_conflicts} تعارض · ${check.check_type}`
          : "يعرض نتائج آخر فحص تعارضات محفوظ — دون تشغيل المحرك."
      }
      filterSummary={ctx.filterSummary}
      reportContext={ctx}
      headerMeta={{
        note: "قراءة فقط — لا يُشغّل Conflict Engine من هذا التقرير. شغّل الفحص من صفحة فحص التعارضات.",
      }}
      filename="conflict_report"
      rows={rows}
      headers={headers}
      isLoading={ctx.isLoading || isLoading}
      error={ctx.error ?? error}
      onRetry={() => void refetch()}
      notReadyMessage={ctx.versionId ? undefined : "اختر نسخة جدول لعرض التعارضات."}
      emptyMessage={
        !check
          ? "لا يوجد فحص تعارضات لهذه النسخة — شغّل الفحص من صفحة فحص التعارضات."
          : search
            ? "لا تعارضات مطابقة للبحث."
            : "لا توجد تعارضات في آخر فحص (أو لا تطابق فلتر نظام الدراسة)."
      }
      kpis={[
        { label: "إلزامي", value: hardCount, tone: hardCount > 0 ? "danger" : "neutral" },
        { label: "مرن", value: softCount, tone: softCount > 0 ? "warning" : "neutral" },
        { label: "إجمالي المعروض", value: rows.length },
        ...(check ? [{ label: "إجمالي آخر فحص", value: check.total_conflicts }] : []),
      ]}
      leading={
        <Card className="report-no-print flex gap-3 border-primary/20 bg-primary/5 p-4">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0 space-y-1 text-sm">
            <p className="font-medium">تقرير للقراءة فقط</p>
            <p className="text-xs text-muted-foreground">
              يقرأ من <code className="text-[11px]">conflict_checks</code> و{" "}
              <code className="text-[11px]">conflict_results</code> — لا يُعيد تشغيل فحص التعارضات.
              حقل «المعالجة» placeholder حتى يتوفر في قاعدة البيانات.
            </p>
          </div>
        </Card>
      }
      filters={
        <ReportFilters
          context={ctx}
          search={{ value: search, onChange: setSearch, placeholder: "ابحث بالمقرر أو المحاضر أو الرمز…" }}
          onClear={() => setSearch("")}
        />
      }
    >
      <ReportSection
        title="تفاصيل التعارضات"
        count={rows.length}
        hint="الأعمدة الثانوية تظهر على الشاشات الأوسع وفي الطباعة."
        bodyClassName="p-0"
      >
        <ReportDataTable
          minWidthClassName="min-w-[1100px]"
          rows={rows}
          rowClassName={(r) => severityMeta(severityKeyFor(r.classification)).rowClass}
          caption="تفاصيل تعارضات آخر فحص محفوظ"
          columns={[
            {
              key: "classification",
              label: "Classification",
              render: (r) => <ConflictSeverityBadge severity={r.classification} />,
            },
            {
              key: "evidence_status",
              label: "Evidence",
              secondary: true,
              render: (r) => <Badge variant="outline">{String(r.evidence_status)}</Badge>,
            },
            { key: "cohort", label: "Cohort", secondary: true },
            { key: "delivery_group", label: "Delivery group", secondary: true },
            { key: "legacy_section", label: "Legacy section", secondary: true },
            {
              key: "resolution_detail",
              label: "Exception / resolution",
              secondary: true,
              className: "text-xs italic text-muted-foreground",
            },
            { key: "conflict_code", label: "رمز التعارض", className: "font-mono text-xs" },
            { key: "message", label: "الرسالة" },
            { key: "course", label: "المقرر" },
            { key: "instructor", label: "المحاضر", secondary: true },
            { key: "room", label: "القاعة", secondary: true },
            {
              key: "day_time",
              label: "اليوم/الوقت",
              className: "whitespace-nowrap text-xs",
            },
            { key: "study_system", label: "نظام الدراسة", secondary: true },
            {
              key: "check_status",
              label: "حالة الفحص",
              secondary: true,
              render: (r) => <Badge variant="outline">{String(r.check_status)}</Badge>,
            },
          ]}
        />
      </ReportSection>
    </ReportShell>
  );
}
