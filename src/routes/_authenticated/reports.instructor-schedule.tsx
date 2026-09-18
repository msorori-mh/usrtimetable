import { withUniversityNumbers } from "@/lib/instructors/university-number";
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
import { attendanceMetrics } from "@/lib/reports/presentation-metrics";
import { useReportContext } from "@/hooks/reports/useReportContext";

export const Route = createFileRoute("/_authenticated/reports/instructor-schedule")({
  head: () => ({ meta: [{ title: "تقرير جدول المحاضر" }] }),
  component: Page,
});

function normalizeInstructorSearch(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("ar")
    .normalize("NFKD")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ");
}

function Page() {
  const ctx = useReportContext({
    defaultStatusMode: "specific_version",
    defaultStudySystem: "all",
  });
  const [insId, setInsId] = useState("");
  const [instructorSearch, setInstructorSearch] = useState("");

  useEffect(() => {
    setInsId(new URLSearchParams(window.location.search).get("instructorId") ?? "");
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
        .order("full_name")
        .throwOnError();
      if (error) throw error;
      return withUniversityNumbers(data ?? []);
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
  const universityNumber = (instructors ?? []).find((i) => i.id === insId)?.university_number;
  const filteredInstructors = useMemo(() => {
    const query = normalizeInstructorSearch(instructorSearch);
    if (!query) return instructors ?? [];
    return (instructors ?? []).filter((instructor) =>
      normalizeInstructorSearch(instructor.full_name).includes(query),
    );
  }, [instructorSearch, instructors]);
  const distinctDays = new Set(rows.map((r) => String(r.day))).size;
  const distinctCourses = new Set(rows.map((r) => String(r.course))).size;

  return (
    <ReportShell
      title={instructorName ? `جدول المحاضر — ${instructorName}` : "تقرير جدول المحاضر الفردي"}
      description={`الجدول الأسبوعي لعضو هيئة تدريس واحد داخل نسخة جدول واحدة. ${universityNumber ? `الرقم الجامعي: ${universityNumber}` : ""}`}
      filterSummary={ctx.filterSummary}
      reportContext={ctx}
      shareParams={{ instructorId: insId }}
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
        {
          label: "فراغات بين المحاضرات (ساعة)",
          value: attendanceMetrics(sessions).gapHours,
          hint: "ضمن أيام الحضور؛ لا تشمل ما قبل أول محاضرة أو بعد آخرها",
        },
      ]}
      filters={
        <ReportFilters
          context={ctx}
          extraSummary={instructorName ? [`المحاضر: ${instructorName}`] : []}
          onClear={() => {
            setInsId("");
            setInstructorSearch("");
          }}
        >
          <ReportFilterField label="المحاضر" htmlFor="is-instructor">
            <div className="space-y-2">
              <input
                type="search"
                value={instructorSearch}
                onChange={(event) => setInstructorSearch(event.target.value)}
                placeholder="ابحث بكتابة أول الاسم أو جزء منه"
                aria-label="البحث عن المحاضر بالاسم"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                autoComplete="off"
              />
              {instructorSearch.trim() && (
                <p className="text-xs text-muted-foreground">
                  {filteredInstructors.length} نتيجة مطابقة
                </p>
              )}
            </div>
            <Select value={insId} onValueChange={setInsId}>
              <SelectTrigger id="is-instructor" aria-label="المحاضر">
                <SelectValue placeholder="اختر المحاضر" />
              </SelectTrigger>
              <SelectContent>
                {filteredInstructors.map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.full_name} {i.university_number ? `— ${i.university_number}` : ""}
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
          hideInstructor
          printDetailOnly
          compactDetails
          sessions={sessions}
          collegeId={ctx.collegeId}
          headers={NEW_FLOW_TIMETABLE_TABLE_HEADERS}
        />
      )}
    </ReportShell>
  );
}
