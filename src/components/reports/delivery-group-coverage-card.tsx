import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import {
  componentTypeLabel,
  UNSCHEDULED_BADGE_AR,
  type CoverageSummary,
  type DeliveryGroupCoverageRow,
} from "@/lib/reports/program-timetable-coverage";

/**
 * Completeness summary + the honest list of delivery groups the selected
 * schedule version never placed. Read-only presentation, printed with the report.
 */
export function DeliveryGroupCoverageCard({
  summary,
  unscheduled,
}: {
  summary: CoverageSummary;
  unscheduled: readonly DeliveryGroupCoverageRow[];
}) {
  if (summary.totalGroups === 0) return null;
  const complete = summary.unscheduledHours === 0;
  return (
    <div className="space-y-3">
      <Card className="min-w-0 p-4" data-testid="coverage-summary">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {complete ? (
            <CheckCircle2 className="h-4 w-4 text-primary" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-destructive" />
          )}
          <span className="font-semibold">
            المجموعات المجدولة {summary.scheduledGroups}/{summary.totalGroups}
          </span>
          <span className="text-muted-foreground">
            الساعات المجدولة {summary.scheduledHours} / المطلوبة {summary.requiredHours}
          </span>
          {complete ? (
            <Badge variant="secondary">الجدول مكتمل لهذه المعايير</Badge>
          ) : (
            <Badge variant="destructive">
              غير المجدول: {summary.unscheduledGroups + (summary.partialGroups ?? 0)} مجموعة /{" "}
              {summary.unscheduledHours} ساعة
            </Badge>
          )}
        </div>
      </Card>

      {unscheduled.length > 0 && (
        <Card className="min-w-0 overflow-x-auto p-4" data-testid="unscheduled-groups">
          <h2 className="mb-2 text-sm font-semibold">مجموعات لم تكتمل تغطيتها</h2>
          <table className="w-full min-w-[640px] text-right text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="p-2">المقرر</th>
                <th className="p-2">المكوّن</th>
                <th className="p-2">المجموعة</th>
                <th className="p-2">الدفعة</th>
                <th className="p-2">الطلاب</th>
                <th className="p-2">الساعات المطلوبة</th>
                <th className="p-2">المحاضر</th>
                <th className="p-2">الحالة</th>
              </tr>
            </thead>
            <tbody>
              {unscheduled.map((g) => (
                <tr key={g.id} className="border-t border-border">
                  <td className="p-2">{[g.courseCode, g.courseName].filter(Boolean).join(" ")}</td>
                  <td className="p-2">{componentTypeLabel(g.componentType)}</td>
                  <td className="p-2">
                    {g.groupCode ?? (g.groupNumber ? `G${g.groupNumber}` : "—")}
                  </td>
                  <td className="p-2">{g.cohortLabel ?? "—"}</td>
                  <td className="p-2">{g.expectedStudents ?? "—"}</td>
                  <td className="p-2">
                    {g.requiredHours} (مجدول: {g.scheduledHours})
                  </td>
                  <td className="p-2">{g.instructorName ?? "غير مسند"}</td>
                  <td className="p-2 font-medium text-destructive">
                    {g.scheduled ? "تغطية جزئية" : UNSCHEDULED_BADGE_AR}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
