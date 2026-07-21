import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ReportShell } from "@/components/reports/report-shell";
import { ReportFilters } from "@/components/reports/report-filters";
import { ReportTimetableView } from "@/components/reports/report-timetable-view";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  mapRawSessions,
  timetableSessionsToRows,
  NEW_FLOW_TIMETABLE_TABLE_HEADERS,
} from "@/lib/reports/session-mappers";
import {
  fetchCohortDeliveryGroupLabels,
  fetchInstructorScheduleSessions,
} from "@/lib/reports/queries/session-queries";
import { useReportContext } from "@/hooks/reports/useReportContext";

export const Route = createFileRoute("/_authenticated/reports/instructor-schedule")({
  head: () => ({ meta: [{ title: "تقرير جدول المحاضر" }] }),
  component: Page,
});

function Page() {
  const ctx = useReportContext({
    defaultStatusMode: "specific_version",
    defaultStudySystem: "all",
  });
  const [insId, setInsId] = useState("");

  useEffect(() => {
    setInsId("");
  }, [ctx.collegeId]);

  const {
    data: instructors,
    isLoading: instructorsLoading,
    error: instructorsError,
  } = useQuery({
    queryKey: ["is-ins", ctx.collegeId],
    enabled: !!ctx.collegeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("instructors")
        .select("id, full_name")
        .eq("college_id", ctx.collegeId!)
        .order("full_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const {
    data: sessionsBundle,
    isLoading: sessionsLoading,
    error: sessionsError,
  } = useQuery({
    queryKey: ["is-sess", ctx.collegeId, ctx.versionId, ctx.studySystem, insId],
    enabled: !!ctx.collegeId && !!ctx.versionId && !!insId,
    queryFn: async () => {
      const raw = await fetchInstructorScheduleSessions({
        collegeId: ctx.collegeId!,
        versionId: ctx.versionId,
        instructorId: insId,
        studySystem: ctx.studySystem,
      });
      // A1.5: resolve New Flow cohort/DG labels for display + export.
      const labels = await fetchCohortDeliveryGroupLabels(ctx.collegeId!, raw);
      return { raw, labels };
    },
  });

  const sessions = useMemo(
    () => mapRawSessions(sessionsBundle?.raw ?? [], sessionsBundle?.labels),
    [sessionsBundle],
  );
  const rows = useMemo(() => timetableSessionsToRows(sessions), [sessions]);
  const totalHours = rows.reduce((sum, r) => sum + Number(r.hours ?? 0), 0);
  const isLoading = ctx.isLoading || instructorsLoading || sessionsLoading;
  const ready = !!ctx.versionId && !!insId;
  const queryError = ctx.error ?? instructorsError ?? sessionsError;

  return (
    <ReportShell
      title="تقرير جدول المحاضر الفردي"
      description={`المجموع: ${totalHours.toFixed(2)} ساعة/أسبوع.`}
      filterSummary={ctx.filterSummary}
      reportContext={ctx}
      filename="instructor_schedule"
      rows={rows}
      headers={NEW_FLOW_TIMETABLE_TABLE_HEADERS}
      isLoading={isLoading}
      emptyMessage={
        queryError
          ? "تعذر تحميل بيانات التقرير. حاول مرة أخرى."
          : !ready
            ? "اختر نسخة جدول ومحاضرًا."
            : "لا توجد محاضرات."
      }
      filters={
        <ReportFilters context={ctx}>
          <div>
            <label className="text-xs text-muted-foreground">المحاضر</label>
            <Select value={insId} onValueChange={setInsId}>
              <SelectTrigger>
                <SelectValue placeholder="اختر المحاضر" />
              </SelectTrigger>
              <SelectContent>
                {(instructors ?? []).map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </ReportFilters>
      }
    >
      {ready && sessions.length > 0 && (
        <ReportTimetableView sessions={sessions} headers={NEW_FLOW_TIMETABLE_TABLE_HEADERS} />
      )}
    </ReportShell>
  );
}
