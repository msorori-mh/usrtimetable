import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ReportShell } from "@/components/reports/report-shell";
import { ReportFilters, ReportFilterField } from "@/components/reports/report-filters";
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
    refetch,
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

  const instructorName = (instructors ?? []).find((i) => i.id === insId)?.full_name;
  const distinctDays = new Set(rows.map((r) => String(r.day))).size;
  const distinctCourses = new Set(rows.map((r) => String(r.course))).size;

  return (
    <ReportShell
      title="تقرير جدول المحاضر الفردي"
      description="الجدول الأسبوعي لعضو هيئة تدريس واحد داخل نسخة جدول واحدة."
      filterSummary={ctx.filterSummary}
      reportContext={ctx}
      filename="instructor_schedule"
      rows={rows}
      headers={NEW_FLOW_TIMETABLE_TABLE_HEADERS}
      isLoading={isLoading}
      error={queryError}
      onRetry={() => void refetch()}
      notReadyMessage={ready ? undefined : "اختر نسخة جدول ومحاضرًا لعرض الجدول."}
      emptyMessage="لا توجد محاضرات مسندة لهذا المحاضر في النسخة المحددة."
      kpis={[
        { label: "المحاضرات", value: rows.length },
        { label: "ساعات/أسبوع", value: totalHours.toFixed(2), tone: "accent" },
        { label: "أيام الحضور", value: distinctDays },
        { label: "المقررات", value: distinctCourses },
      ]}
      filters={
        <ReportFilters
          context={ctx}
          extraSummary={instructorName ? [`المحاضر: ${instructorName}`] : []}
          onClear={() => setInsId("")}
        >
          <ReportFilterField label="المحاضر" htmlFor="is-instructor">
            <Select value={insId} onValueChange={setInsId}>
              <SelectTrigger id="is-instructor" aria-label="المحاضر">
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
          </ReportFilterField>
        </ReportFilters>
      }
    >
      {ready && sessions.length > 0 && (
        <ReportTimetableView
          sessions={sessions}
          collegeId={ctx.collegeId}
          headers={NEW_FLOW_TIMETABLE_TABLE_HEADERS}
        />
      )}
    </ReportShell>
  );
}
