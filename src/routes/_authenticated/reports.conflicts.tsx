import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ReportShell } from "@/components/reports/report-shell";
import { ReportFilters } from "@/components/reports/report-filters";
import {
  ReportSection,
  ReportDataTable,
  type ReportColumn,
} from "@/components/reports/report-section";
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
  { key: "classification_label", label: "التصنيف" },
  { key: "evidence_label", label: "حالة الدليل" },
  { key: "cohort", label: "الدفعة" },
  { key: "delivery_group", label: "مجموعة التدريس" },
  { key: "legacy_section", label: "مجموعة أرشيفية" },
  { key: "resolution_detail", label: "الاستثناء / المعالجة" },
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
  hard_blocker: { label: "مانع إلزامي", variant: "destructive", rowClass: "bg-destructive/5" },
  soft: { label: "مرن", variant: "secondary", rowClass: "bg-amber-500/5" },
  warning: { label: "تحذير", variant: "secondary", rowClass: "bg-amber-500/5" },
  approved_exception: { label: "استثناء معتمد", variant: "outline", rowClass: "bg-primary/5" },
  unknown: { label: "دليل غير مكتمل", variant: "outline", rowClass: "bg-muted/40" },
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
  return classification === "hard_blocker"
    ? "hard"
    : classification === "warning"
      ? "soft"
      : "warning";
}

type ConflictDisplayRow = Record<string, unknown>;

const conflictText = (value: unknown) =>
  value === null || value === undefined || value === "" ? "—" : String(value);

function ConflictContextCell({ row }: { row: ConflictDisplayRow }) {
  return (
    <div className="min-w-[170px] space-y-0.5 leading-5">
      <div className="font-semibold">{conflictText(row.course)}</div>
      <div className="text-[11px] text-muted-foreground">
        {conflictText(row.cohort)} · {conflictText(row.delivery_group)}
      </div>
      <div className="text-[10px] text-muted-foreground">{conflictText(row.study_system)}</div>
    </div>
  );
}

function ConflictResourceCell({ row }: { row: ConflictDisplayRow }) {
  return (
    <div className="min-w-[140px] space-y-0.5 leading-5">
      <div>{conflictText(row.instructor)}</div>
      <div className="text-[11px] text-muted-foreground">القاعة: {conflictText(row.room)}</div>
      {conflictText(row.legacy_section) !== "—" && (
        <div className="text-[10px] text-muted-foreground">
          مجموعة أرشيفية: {conflictText(row.legacy_section)}
        </div>
      )}
    </div>
  );
}

function ConflictIssueCell({ row }: { row: ConflictDisplayRow }) {
  return (
    <div className="min-w-[210px] space-y-1 leading-5">
      <div className="font-medium">{conflictText(row.message)}</div>
      <div className="font-mono text-[10px] text-muted-foreground">
        {conflictText(row.conflict_code)}
      </div>
    </div>
  );
}

function ConflictEvidenceCell({ row }: { row: ConflictDisplayRow }) {
  return (
    <div className="min-w-[165px] space-y-0.5 leading-5">
      <div className="font-medium">{conflictText(row.day_time)}</div>
      <div className="text-[11px] text-muted-foreground">
        الدليل: {conflictText(row.evidence_label ?? row.evidence_status)}
      </div>
      {conflictText(row.resolution_detail) !== "—" && (
        <div className="text-[10px] text-muted-foreground">
          {conflictText(row.resolution_detail)}
        </div>
      )}
    </div>
  );
}

function compactConflictColumns(): ReportColumn<ConflictDisplayRow>[] {
  return [
    {
      key: "classification",
      label: "الأولوية",
      className: "w-[12%]",
      render: (r) => <ConflictSeverityBadge severity={r.classification} />,
    },
    {
      key: "message",
      label: "التعارض",
      className: "w-[30%]",
      render: (r) => <ConflictIssueCell row={r} />,
    },
    {
      key: "course",
      label: "السياق الأكاديمي",
      className: "w-[24%]",
      render: (r) => <ConflictContextCell row={r} />,
    },
    {
      key: "instructor",
      label: "المورد المتأثر",
      className: "w-[16%]",
      render: (r) => <ConflictResourceCell row={r} />,
    },
    {
      key: "day_time",
      label: "الوقت والدليل",
      className: "w-[18%]",
      render: (r) => <ConflictEvidenceCell row={r} />,
    },
  ];
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
  const softCount = useMemo(
    () => rows.filter((r) => r.classification === "warning").length,
    [rows],
  );

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
        { label: "موانع", value: hardCount, tone: hardCount > 0 ? "danger" : "neutral" },
        { label: "تحذيرات", value: softCount, tone: softCount > 0 ? "warning" : "neutral" },
        { label: "إجمالي المعروض", value: rows.length },
        ...(check ? [{ label: "إجمالي آخر فحص", value: check.total_conflicts }] : []),
      ]}
      leading={
        <Card className="report-no-print flex gap-3 border-primary/20 bg-primary/5 p-4">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0 space-y-1 text-sm">
            <p className="font-medium">تقرير للقراءة فقط</p>
            <p className="text-xs text-muted-foreground">
              النتائج تخص آخر فحص محفوظ. أعد الفحص من صفحة فحص التعارضات بعد تعديل الجدول.
            </p>
          </div>
        </Card>
      }
      filters={
        <ReportFilters
          context={ctx}
          search={{
            value: search,
            onChange: setSearch,
            placeholder: "ابحث بالمقرر أو المحاضر أو الرمز…",
          }}
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
          minWidthClassName="min-w-[640px]"
          rows={rows}
          rowClassName={(r) => severityMeta(severityKeyFor(r.classification)).rowClass}
          caption="تفاصيل تعارضات آخر فحص محفوظ"
          columns={compactConflictColumns() as unknown as ReportColumn<(typeof rows)[number]>[]}
          primaryColumnLimit={6}
        />
      </ReportSection>
    </ReportShell>
  );
}
