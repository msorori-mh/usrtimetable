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
import {
  computeQuotaBalance,
  QUOTA_STATUS_LABEL_AR,
  QUOTA_UNDEFINED_AR,
} from "@/lib/reports/instructor-quota";
import { isHourlyContractTypeCode } from "@/lib/instructors/effective-hours";
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
        .select(
          "id, full_name, max_weekly_hours, administrative_release_hours, instructor_type_id, employment_type",
        )
        .eq("college_id", ctx.collegeId!)
        .order("full_name")
        .throwOnError();
      if (error) throw error;

      const { data: instructorTypes, error: instructorTypesError } = await supabase
        .from("instructor_types")
        .select("id, code")
        .eq("college_id", ctx.collegeId!)
        .throwOnError();
      if (instructorTypesError) throw instructorTypesError;

      const typeCodeById = new Map(
        (instructorTypes ?? []).map((type) => [type.id, type.code]),
      );

      return withUniversityNumbers(
        (data ?? []).map((instructor) => ({
          ...instructor,
          instructor_type_code: instructor.instructor_type_id
            ? typeCodeById.get(instructor.instructor_type_id) ?? null
            : null,
        })),
      );
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

  const selectedInstructor = (instructors ?? []).find((i) => i.id === insId);
  const instructorName = selectedInstructor?.full_name;
  const universityNumber = selectedInstructor?.university_number;
  const isHourlyContract =
    isHourlyContractTypeCode(selectedInstructor?.instructor_type_code) ||
    selectedInstructor?.employment_type === "contract";

  const workloadBalance = computeQuotaBalance({
    maxWeeklyHours: isHourlyContract ? null : selectedInstructor?.max_weekly_hours,
    adminReleaseHours: isHourlyContract ? 0 : selectedInstructor?.administrative_release_hours,
    assignedHours: totalHours,
  });
  const actualQuotaLabel =
    workloadBalance.netHours === null ? QUOTA_UNDEFINED_AR : workloadBalance.netHours.toFixed(2);
  const workloadStatusLabel = QUOTA_STATUS_LABEL_AR[workloadBalance.status];
  const workloadDifferenceLabel =
    workloadBalance.status === "overload"
      ? `ساعات زائدة: ${(workloadBalance.overloadHours ?? 0).toFixed(2)}`
      : workloadBalance.status === "deficit"
        ? `المتبقي من النصاب: ${(workloadBalance.deficitHours ?? 0).toFixed(2)}`
        : workloadBalance.status === "balanced"
          ? "لا يوجد فرق بين النصاب والساعات التدريسية"
          : "لا يمكن حساب الفرق قبل تحديد النصاب";

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
      kpis={
        isHourlyContract
          ? [
              { label: "المحاضرات", value: rows.length },
              {
                label: "الساعات التدريسية",
                value: totalHours.toFixed(2),
                tone: "accent",
                hint: "إجمالي الساعات الأسبوعية المجدولة للمحاضر المتعاقد",
              },
              { label: "أيام الحضور", value: distinctDays },
              { label: "المقررات", value: distinctCourses },
            ]
          : [
              { label: "المحاضرات", value: rows.length },
              {
                label: "الساعات التدريسية",
                value: totalHours.toFixed(2),
                tone: "accent",
                hint: "إجمالي الساعات الأسبوعية المجدولة في النسخة المحددة",
              },
              {
                label: "النصاب الفعلي",
                value: actualQuotaLabel,
                tone: workloadBalance.status === "overload" ? "warning" : "success",
                hint:
                  workloadBalance.netHours === null
                    ? "النصاب غير محدد في بطاقة المحاضر أو سياسة النصاب"
                    : `الأساسي ${workloadBalance.baseHours?.toFixed(2) ?? "0.00"} − الإعفاء الإداري ${workloadBalance.releaseHours.toFixed(2)}`,
              },
              { label: "أيام الحضور", value: distinctDays },
              { label: "المقررات", value: distinctCourses },
            ]
      }
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
        <div className="space-y-4">
          <ReportTimetableView
            hideInstructor
            printDetailOnly
            compactDetails
            sessions={sessions}
            collegeId={ctx.collegeId}
            headers={NEW_FLOW_TIMETABLE_TABLE_HEADERS}
          />
          {isHourlyContract ? (
            <section
              className="break-inside-avoid rounded-lg border bg-muted/20 p-4"
              aria-label="إجمالي الساعات التدريسية للمحاضر المتعاقد"
            >
              <h2 className="text-base font-bold text-primary">إجمالي الساعات التدريسية</h2>
              <div className="mt-3 rounded-md border bg-background p-4">
                <p className="text-xs text-muted-foreground">الساعات التدريسية الأسبوعية</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-primary">
                  {totalHours.toFixed(2)}
                </p>
              </div>
            </section>
          ) : (
            <section
              className="break-inside-avoid rounded-lg border bg-muted/20 p-4"
              aria-label="ملخص العبء التدريسي للمحاضر"
            >
              <h2 className="text-base font-bold text-primary">ملخص العبء التدريسي</h2>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-md border bg-background p-3">
                  <p className="text-xs text-muted-foreground">النصاب الأساسي</p>
                  <p className="mt-1 text-lg font-bold tabular-nums">
                    {workloadBalance.baseHours === null
                      ? QUOTA_UNDEFINED_AR
                      : workloadBalance.baseHours.toFixed(2)}
                  </p>
                </div>
                <div className="rounded-md border bg-background p-3">
                  <p className="text-xs text-muted-foreground">الإعفاء الإداري</p>
                  <p className="mt-1 text-lg font-bold tabular-nums">
                    {workloadBalance.releaseHours.toFixed(2)}
                  </p>
                </div>
                <div className="rounded-md border bg-background p-3">
                  <p className="text-xs text-muted-foreground">النصاب الفعلي</p>
                  <p className="mt-1 text-lg font-bold tabular-nums text-primary">
                    {actualQuotaLabel}
                  </p>
                </div>
                <div className="rounded-md border bg-background p-3">
                  <p className="text-xs text-muted-foreground">الساعات التدريسية</p>
                  <p className="mt-1 text-lg font-bold tabular-nums text-primary">
                    {totalHours.toFixed(2)}
                  </p>
                </div>
              </div>
              <div className="mt-3 rounded-md border bg-background px-3 py-2 text-sm">
                <span className="font-semibold">حالة النصاب: </span>
                <span>{workloadStatusLabel}</span>
                <span className="mx-2 text-muted-foreground">—</span>
                <span>{workloadDifferenceLabel}</span>
              </div>
            </section>
          )}
        </div>
      )}
    </ReportShell>
  );
}
