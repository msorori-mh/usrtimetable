import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { ReportShell } from "@/components/reports/report-shell";
import { ReportFilters } from "@/components/reports/report-filters";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fetchCollegeReadiness, readinessMetricsToRows } from "@/lib/reports/readiness";
import { useReportContext } from "@/hooks/reports/useReportContext";

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

  const { data, isLoading } = useQuery({
    queryKey: ["rep-readiness", ctx.collegeId],
    enabled: !!ctx.collegeId,
    queryFn: () => fetchCollegeReadiness(ctx.collegeId!),
  });

  const rows = useMemo(() => (data ? readinessMetricsToRows(data) : []), [data]);

  const description = data
    ? `قراءة فقط — الجاهزية العامة: ${data.scores.overall}/100 · على مستوى الكلية (لا يعتمد على نسخة جدول).`
    : "قراءة فقط — تقييم جاهزية البيانات الأكاديمية.";

  return (
    <ReportShell
      title="تقرير جاهزية البيانات"
      description={description}
      filterSummary={ctx.filterSummary}
      reportContext={ctx}
      headerMeta={{
        note: "تقييم على مستوى الكلية — لا يعتمد على نسخة جدول. لا يُشغّل cleanup أو import.",
      }}
      filename="data_readiness_report"
      rows={rows}
      headers={headers}
      isLoading={ctx.isLoading || isLoading}
      emptyMessage={!ctx.collegeId ? "اختر كلّية." : "لا توجد فحوص."}
      filters={
        <ReportFilters context={ctx} version={false} statusMode={false} studySystem={false} />
      }
    >
      {data && (
        <div className="mb-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <Card className="p-3">
            <p className="text-muted-foreground">الخطط</p>
            <p className="text-xl font-bold">{data.scores.studyPlanScore}/100</p>
          </Card>
          <Card className="p-3">
            <p className="text-muted-foreground">الموارد</p>
            <p className="text-xl font-bold">{data.scores.resourcesScore}/100</p>
          </Card>
          <Card className="p-3">
            <p className="text-muted-foreground">الجدولة</p>
            <p className="text-xl font-bold">{data.scores.schedulingScore}/100</p>
          </Card>
          <Card className="p-3">
            <p className="text-muted-foreground">العام</p>
            <p className="text-xl font-bold">{data.scores.overall}/100</p>
          </Card>
        </div>
      )}
      {data && data.planComponentRoomTypeIssues.length > 0 ? (
        <Card className="mb-4 border-destructive/40 p-4">
          <p className="font-semibold text-destructive">
            جاهزية الجدولة — PLAN_COMPONENT_ROOM_TYPE_MISSING (
            {data.planComponentRoomTypeIssues.length})
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            القائمة الكاملة للمكوّنات في الخطط النشطة، مرتبة حسب البرنامج/المستوى/الفصل.
          </p>
          <ul className="mt-3 space-y-1 text-xs">
            {data.planComponentRoomTypeIssues
              .slice()
              .sort(
                (a, b) =>
                  a.program_code.localeCompare(b.program_code) ||
                  a.level_number - b.level_number ||
                  a.semester - b.semester ||
                  a.course_code.localeCompare(b.course_code),
              )
              .map((issue) => (
                <li key={`${issue.study_plan_id}:${issue.course_code}:${issue.component_type}`}>
                  {issue.college_code} · {issue.program_code} · المستوى {issue.level_number} · الفصل{" "}
                  {issue.semester} · {issue.course_code} ({issue.course_name}) ·{" "}
                  {issue.component_type}/{issue.component_hours} · room_type_id=
                  {issue.room_type_id ?? "NULL"} · code={issue.room_type_code ?? "NULL"} ·{" "}
                  {issue.issue_code}: {issue.issue_message}
                </li>
              ))}
          </ul>
        </Card>
      ) : null}
      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              {headers.map((h) => (
                <TableHead key={h.key}>{h.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={i}>
                <TableCell>{r.category}</TableCell>
                <TableCell>{r.check_name}</TableCell>
                <TableCell>
                  <Badge
                    variant={
                      r.status === "جاهز"
                        ? "secondary"
                        : r.status === "حرج"
                          ? "destructive"
                          : "outline"
                    }
                  >
                    {r.status}
                  </Badge>
                </TableCell>
                <TableCell>{r.missing_count}</TableCell>
                <TableCell>{r.total_count}</TableCell>
                <TableCell>{r.pct_missing}</TableCell>
                <TableCell>{r.severity}</TableCell>
                <TableCell className="text-xs">{r.message}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {r.suggested_action}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </ReportShell>
  );
}
