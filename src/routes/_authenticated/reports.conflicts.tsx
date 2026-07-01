import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { ReportShell } from "@/components/reports/report-shell";
import { ReportFilters } from "@/components/reports/report-filters";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Info, ShieldAlert } from "lucide-react";
import { fetchConflictReportRows } from "@/lib/reports/queries/operational-queries";
import { useReportContext } from "@/hooks/reports/useReportContext";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/reports/conflicts")({
  head: () => ({ meta: [{ title: "تقرير التعارضات" }] }),
  component: Page,
});

const headers = [
  { key: "conflict_code", label: "رمز التعارض" },
  { key: "severity", label: "الخطورة" },
  { key: "message", label: "الرسالة" },
  { key: "course", label: "المقرر" },
  { key: "instructor", label: "المحاضر" },
  { key: "room", label: "القاعة" },
  { key: "section", label: "المجموعة" },
  { key: "day_time", label: "اليوم/الوقت" },
  { key: "study_system", label: "نظام الدراسة" },
  { key: "check_status", label: "حالة الفحص" },
  { key: "resolution", label: "المعالجة" },
];

const SEVERITY_META: Record<string, { label: string; variant: "destructive" | "secondary" | "outline"; rowClass: string }> = {
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

function Page() {
  const ctx = useReportContext({ defaultStatusMode: "specific_version", defaultStudySystem: "all" });

  const { data, isLoading } = useQuery({
    queryKey: ["rep-conflicts", ctx.collegeId, ctx.versionId, ctx.studySystem],
    enabled: !!ctx.collegeId && !!ctx.versionId,
    queryFn: () =>
      fetchConflictReportRows({
        collegeId: ctx.collegeId!,
        versionId: ctx.versionId,
        studySystem: ctx.studySystem,
      }),
  });

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const check = data?.check;

  const hardCount = useMemo(
    () => rows.filter((r) => String(r.severity).toLowerCase() === "hard").length,
    [rows],
  );
  const softCount = useMemo(
    () => rows.filter((r) => String(r.severity).toLowerCase() === "soft").length,
    [rows],
  );

  const description = check
    ? `آخر فحص: ${new Date(check.created_at).toLocaleString("ar")} · ${check.total_conflicts} تعارض · ${check.check_type}`
    : "يعرض نتائج آخر فحص تعارضات محفوظ — دون تشغيل المحرك.";

  return (
    <ReportShell
      title="تقرير التعارضات"
      description={description}
      filterSummary={ctx.filterSummary}
      reportContext={ctx}
      headerMeta={{
        note: "قراءة فقط — لا يُشغّل Conflict Engine من هذا التقرير. شغّل الفحص من صفحة فحص التعارضات.",
      }}
      filename="conflict_report"
      rows={rows}
      headers={headers}
      isLoading={ctx.isLoading || isLoading}
      emptyMessage={
        !ctx.versionId
          ? "اختر نسخة جدول."
          : !check
            ? "لا يوجد فحص تعارضات لهذه النسخة — شغّل الفحص من صفحة فحص التعارضات."
            : "لا توجد تعارضات في آخر فحص (أو لا تطابق فلتر نظام الدراسة)."
      }
      filters={<ReportFilters context={ctx} />}
    >
      <Card className="report-no-print mb-4 flex gap-3 border-primary/20 bg-primary/5 p-4">
        <Info className="h-5 w-5 shrink-0 text-primary mt-0.5" />
        <div className="text-sm space-y-1">
          <p className="font-medium">تقرير للقراءة فقط</p>
          <p className="text-muted-foreground text-xs">
            يقرأ من <code className="text-[11px]">conflict_checks</code> و{" "}
            <code className="text-[11px]">conflict_results</code> — لا يُعيد تشغيل فحص التعارضات.
            حقل «المعالجة» placeholder حتى يتوفر في قاعدة البيانات.
          </p>
        </div>
      </Card>

      {check && rows.length > 0 && (
        <div className="report-no-print mb-4 flex flex-wrap gap-3">
          <Card className="px-4 py-2 flex items-center gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <span>إلزامي: <strong>{hardCount}</strong></span>
          </Card>
          <Card className="px-4 py-2 flex items-center gap-2 text-sm">
            <ShieldAlert className="h-4 w-4 text-amber-600" />
            <span>مرن: <strong>{softCount}</strong></span>
          </Card>
          <Card className="px-4 py-2 text-sm text-muted-foreground">
            إجمالي المعروض: <strong>{rows.length}</strong>
          </Card>
        </div>
      )}

      {rows.length > 0 && (
        <Card className="p-0 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>{headers.map((h) => <TableHead key={h.key}>{h.label}</TableHead>)}</TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => {
                const meta = severityMeta(r.severity);
                return (
                  <TableRow key={i} className={cn(meta.rowClass)}>
                    <TableCell className="font-mono text-xs">{String(r.conflict_code)}</TableCell>
                    <TableCell><ConflictSeverityBadge severity={r.severity} /></TableCell>
                    <TableCell>{String(r.message)}</TableCell>
                    <TableCell>{String(r.course)}</TableCell>
                    <TableCell>{String(r.instructor)}</TableCell>
                    <TableCell>{String(r.room)}</TableCell>
                    <TableCell>{String(r.section)}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{String(r.day_time)}</TableCell>
                    <TableCell>{String(r.study_system)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{String(r.check_status)}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground italic">{String(r.resolution)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </ReportShell>
  );
}
