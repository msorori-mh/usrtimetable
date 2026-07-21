import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ReportShell } from "@/components/reports/report-shell";
import { ReportFilters } from "@/components/reports/report-filters";
import { ReportTimetableView } from "@/components/reports/report-timetable-view";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Archive } from "lucide-react";
import {
  mapRawSessions,
  timetableSessionsToRows,
  TIMETABLE_TABLE_HEADERS,
} from "@/lib/reports/session-mappers";
import { fetchSectionTimetableSessions } from "@/lib/reports/queries/session-queries";
import { useReportContext } from "@/hooks/reports/useReportContext";

export const Route = createFileRoute("/_authenticated/reports/section-timetable")({
  head: () => ({ meta: [{ title: "Legacy — تقرير جدول المجموعة (تاريخي)" }] }),
  component: Page,
});

function Page() {
  const ctx = useReportContext({ defaultStatusMode: "specific_version", defaultStudySystem: "all" });
  const [sectionId, setSectionId] = useState("");

  const { data: sections } = useQuery({
    queryKey: ["st-sections", ctx.collegeId, ctx.termId],
    enabled: !!ctx.collegeId && !!ctx.termId,
    queryFn: async () =>
      (
        await supabase
          .from("sections")
          .select("id, section_number, course_id, courses(code, name)")
          .eq("college_id", ctx.collegeId!)
          .eq("term_id", ctx.termId!)
          .order("section_number")
      ).data ?? [],
  });

  const { data: rawSessions, isLoading: sessionsLoading } = useQuery({
    queryKey: ["st-sess", ctx.collegeId, ctx.versionId, ctx.studySystem, sectionId],
    enabled: !!ctx.collegeId && !!ctx.versionId && !!sectionId,
    queryFn: () =>
      fetchSectionTimetableSessions({
        collegeId: ctx.collegeId!,
        versionId: ctx.versionId,
        sectionId,
        studySystem: ctx.studySystem,
      }),
  });

  const sessions = useMemo(() => mapRawSessions(rawSessions ?? []), [rawSessions]);
  const rows = useMemo(() => timetableSessionsToRows(sessions), [sessions]);
  const totalHours = rows.reduce((sum, r) => sum + Number(r.hours ?? 0), 0);

  const isLoading = ctx.isLoading || sessionsLoading;
  const ready = !!ctx.versionId && !!sectionId;

  return (
    <div className="space-y-4">
      <Card className="report-no-print flex gap-3 border-amber-500/30 bg-amber-500/5 p-4">
        <Archive className="h-5 w-5 shrink-0 text-amber-600 mt-0.5" />
        <div className="text-sm space-y-1">
          <p className="font-medium text-amber-700">تقرير Legacy — للعرض التاريخي فقط (A1.5)</p>
          <p className="text-xs text-muted-foreground">
            مصدره جداول <code className="text-[11px]">sections</code> المحفوظة للتوافق — قراءة فقط
            ولا تعتمد عليه تدفقات العمل الجديدة. للجداول الحديثة استخدم{" "}
            <Link to="/reports/program-level-timetable" className="text-primary underline-offset-4 hover:underline">
              جدول البرنامج/المستوى
            </Link>{" "}
            بفلاتر الدفعة الدراسية ومجموعة المحاضرات/المعامل.
          </p>
        </div>
      </Card>
      <ReportShell
        title="تقرير جدول المجموعة (Legacy)"
        description={`المجموع: ${totalHours.toFixed(2)} ساعة/أسبوع.`}
        filterSummary={ctx.filterSummary}
        reportContext={ctx}
        filename="section_timetable"
        rows={rows}
        headers={TIMETABLE_TABLE_HEADERS}
        isLoading={isLoading}
        emptyMessage={!ready ? "اختر نسخة جدول ومجموعة." : "لا توجد محاضرات."}
        filters={
          <ReportFilters context={ctx}>
            <div>
              <label className="text-xs text-muted-foreground">المجموعة</label>
              <Select value={sectionId} onValueChange={setSectionId}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر المجموعة" />
                </SelectTrigger>
                <SelectContent>
                  {(sections ?? []).map((s) => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const c = (s as any).courses;
                    const label = c
                      ? `${s.section_number} — ${c.code ?? ""} ${c.name ?? ""}`
                      : s.section_number;
                    return (
                      <SelectItem key={s.id} value={s.id}>
                        {label}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          </ReportFilters>
        }
      >
        {ready && sessions.length > 0 && <ReportTimetableView sessions={sessions} />}
      </ReportShell>
    </div>
  );
}
