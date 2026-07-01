import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ReportShell } from "@/components/reports/report-shell";
import { ReportFilters } from "@/components/reports/report-filters";
import { ReportTimetableView } from "@/components/reports/report-timetable-view";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  mapRawSessions,
  timetableSessionsToRows,
  TIMETABLE_TABLE_HEADERS,
} from "@/lib/reports/session-mappers";
import { fetchSectionTimetableSessions } from "@/lib/reports/queries/session-queries";
import { useReportContext } from "@/hooks/reports/useReportContext";

export const Route = createFileRoute("/_authenticated/reports/section-timetable")({
  head: () => ({ meta: [{ title: "تقرير جدول الشعبة" }] }),
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
    <ReportShell
      title="تقرير جدول الشعبة"
      description={`المجموع: ${totalHours.toFixed(2)} ساعة/أسبوع.`}
      filterSummary={ctx.filterSummary}
      reportContext={ctx}
      filename="section_timetable"
      rows={rows}
      headers={TIMETABLE_TABLE_HEADERS}
      isLoading={isLoading}
      emptyMessage={!ready ? "اختر نسخة جدول وشعبة." : "لا توجد جلسات."}
      filters={
        <ReportFilters context={ctx}>
          <div>
            <label className="text-xs text-muted-foreground">الشعبة</label>
            <Select value={sectionId} onValueChange={setSectionId}>
              <SelectTrigger>
                <SelectValue placeholder="اختر الشعبة" />
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
  );
}
