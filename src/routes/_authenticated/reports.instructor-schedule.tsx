import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
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
  timetableSessionsToRows,
  NEW_FLOW_TIMETABLE_TABLE_HEADERS,
} from "@/lib/reports/session-mappers";
import { QUOTA_UNDEFINED_AR } from "@/lib/reports/instructor-quota";
import {
  fetchUniversityScheduleDirectory,
  fetchInstructorTeachingCollegeIds,
  fetchUniversityInstructorSchedule,
} from "@/lib/reports/queries/university-instructor-schedule";
import {
  resolveCollegeScheduleScopes,
  instructorTeachingScopes,
  isTestScheduleLabel,
  summarizeUniversitySchedule,
} from "@/lib/reports/university-instructor-schedule";
import { InstructorCollegeHours } from "@/components/reports/instructor-college-hours";
import { STATUS_LABEL_AR, type SVStatus } from "@/lib/schedule-versions/lifecycle";
import { isHourlyContractTypeCode } from "@/lib/instructors/effective-hours";
import { useCurrentUser } from "@/hooks/use-current-user";
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
  const currentUser = useCurrentUser();
  const ctx = useReportContext({
    defaultStatusMode: "specific_version",
    defaultStudySystem: "all",
    fixedStudySystem: "all",
  });
  const [insId, setInsId] = useState("");
  const [instructorSearch, setInstructorSearch] = useState("");
  const [versionSelections, setVersionSelections] = useState<Record<string, string>>({});
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setVersionSelections(
      Object.fromEntries(
        [...params]
          .filter(([key]) => key.startsWith("collegeVersion_"))
          .map(([key, value]) => [key.slice(15), value]),
      ),
    );
  }, [ctx.collegeId, ctx.versionId]);

  useEffect(() => {
    setInsId(new URLSearchParams(window.location.search).get("instructorId") ?? "");
  }, [ctx.collegeId]);

  const directory = useQuery({
    queryKey: [
      "university-instructor-directory",
      ctx.collegeId,
      currentUser.data?.id,
      currentUser.data?.isSuperAdmin,
    ],
    enabled: !!ctx.collegeId && !!currentUser.data,
    queryFn: () => fetchUniversityScheduleDirectory(ctx.collegeId!),
  });
  const canViewAcrossColleges =
    currentUser.data?.isSuperAdmin === true && directory.data?.canViewAcrossColleges === true;
  const instructors = useMemo(
    () =>
      directory.data?.instructors
        .filter((instructor) => {
          const anchor = directory.data.colleges.find((c) => c.id === ctx.collegeId);
          const college = directory.data.colleges.find((c) => c.id === instructor.college_id);
          return (
            !!anchor?.university_id &&
            college?.university_id === anchor.university_id &&
            !isTestScheduleLabel(college.name)
          );
        })
        .slice()
        .sort((a, b) => a.full_name.localeCompare(b.full_name, "ar")),
    [directory.data, ctx.collegeId],
  );
  const selectedInstructor = instructors?.find((i) => i.id === insId);
  const instructorName = selectedInstructor?.full_name;
  const universityNumber = selectedInstructor?.university_number;
  const isHourlyContract =
    isHourlyContractTypeCode(selectedInstructor?.instructor_type_code) ||
    selectedInstructor?.employment_type === "contract";
  const selection = useMemo(() => {
    if (!directory.data || !ctx.versionId) return { scopes: [], error: null };
    try {
      const universityId = directory.data.colleges.find(
        (c) => c.id === ctx.collegeId,
      )?.university_id;
      return {
        scopes: resolveCollegeScheduleScopes({
          ...directory.data,
          colleges: directory.data.colleges.filter(
            (c) => !!universityId && c.university_id === universityId,
          ),
          anchorVersionId: ctx.versionId,
          selections: versionSelections,
        }),
        error: null,
      };
    } catch (error) {
      return { scopes: [], error };
    }
  }, [directory.data, ctx.collegeId, ctx.versionId, versionSelections]);
  const teachingColleges = useQuery({
    queryKey: [
      "instructor-teaching-colleges",
      currentUser.data?.id,
      canViewAcrossColleges,
      ctx.collegeId,
      insId,
      selection.scopes.flatMap((s) => s.options.map((v) => v.id)).join(","),
      instructors?.map((i) => `${i.id}:${i.university_number}`).join(","),
    ],
    enabled:
      canViewAcrossColleges &&
      !!selectedInstructor &&
      selection.scopes.length > 0 &&
      !selection.error,
    queryFn: () =>
      fetchInstructorTeachingCollegeIds({
        selected: selectedInstructor!,
        records: instructors!,
        scopes: selection.scopes,
      }),
  });
  const reportScopes = useMemo(
    () =>
      selectedInstructor
        ? instructorTeachingScopes(
            selection.scopes,
            ctx.collegeId ?? "",
            teachingColleges.data ?? [],
            canViewAcrossColleges,
          )
        : [],
    [
      selectedInstructor,
      selection.scopes,
      ctx.collegeId,
      teachingColleges.data,
      canViewAcrossColleges,
    ],
  );
  const schedule = useQuery({
    queryKey: [
      "university-instructor-schedule",
      currentUser.data?.id,
      canViewAcrossColleges,
      ctx.collegeId,
      insId,
      reportScopes.map((s) => s.version.id).join(","),
      instructors?.map((i) => `${i.id}:${i.university_number}`).join(","),
    ],
    enabled:
      !!selectedInstructor &&
      reportScopes.length > 0 &&
      !selection.error &&
      (!canViewAcrossColleges || teachingColleges.isSuccess),
    queryFn: () =>
      fetchUniversityInstructorSchedule({
        anchorCollegeId: ctx.collegeId!,
        selected: selectedInstructor!,
        records: instructors!,
        scopes: reportScopes,
      }),
  });
  const summary = useMemo(
    () =>
      summarizeUniversitySchedule(schedule.data ?? [], {
        maxWeeklyHours: isHourlyContract ? null : selectedInstructor?.authoritative_quota,
        adminReleaseHours: 0,
      }),
    [schedule.data, isHourlyContract, selectedInstructor],
  );
  const sessions = summary.sessions;
  const rows = useMemo(
    () =>
      timetableSessionsToRows(sessions).map((row, i) => ({
        ...row,
        college: sessions[i].college_name,
      })),
    [sessions],
  );
  const totalHours = summary.totalHours;
  const workloadBalance = summary.balance;
  const actualQuotaLabel =
    workloadBalance.netHours === null ? QUOTA_UNDEFINED_AR : workloadBalance.netHours.toFixed(2);
  const isLoading =
    currentUser.isLoading ||
    ctx.isLoading ||
    directory.isLoading ||
    teachingColleges.isLoading ||
    schedule.isLoading;
  const ready = !!ctx.versionId && !!selectedInstructor;
  const queryError =
    currentUser.error ??
    ctx.error ??
    directory.error ??
    selection.error ??
    teachingColleges.error ??
    schedule.error;
  const refetch = async () => {
    await directory.refetch();
    if (canViewAcrossColleges) await teachingColleges.refetch();
    await schedule.refetch();
  };
  const exportHeaders = [{ key: "college", label: "الكلية" }, ...NEW_FLOW_TIMETABLE_TABLE_HEADERS];
  const versionShare = {
    ...Object.fromEntries(
      Object.keys(versionSelections).map((id) => [`collegeVersion_${id}`, null]),
    ),
    ...Object.fromEntries(reportScopes.map((s) => [`collegeVersion_${s.collegeId}`, s.version.id])),
  };

  const filteredInstructors = useMemo(() => {
    const query = normalizeInstructorSearch(instructorSearch);
    if (!query) return instructors ?? [];
    return (instructors ?? []).filter((instructor) =>
      normalizeInstructorSearch(instructor.full_name).includes(query),
    );
  }, [instructorSearch, instructors]);
  const distinctDays = new Set(sessions.map((s) => s.day_of_week)).size;
  const distinctCourses = new Set(sessions.map((s) => `${s.course_code}:${s.course_name}`)).size;

  return (
    <ReportShell
      title={instructorName ? `جدول المحاضر — ${instructorName}` : "تقرير جدول المحاضر الفردي"}
      description={`${canViewAcrossColleges ? "الجدول الفردي الموحد عبر الكليات المرتبطة بالمحاضر — للأدمن فقط." : "جدول المحاضر داخل الكلية الحالية فقط، بجميع أنظمة الدراسة."} ${universityNumber ? `الرقم الجامعي: ${universityNumber}` : ""}`}
      filterSummary={ctx.filterSummary}
      reportContext={ctx}
      shareParams={{ instructorId: insId, ...versionShare }}
      headerMeta={{
        collegeName: canViewAcrossColleges ? "الجدول الموحد عبر الكليات — للأدمن" : undefined,
        versionName: canViewAcrossColleges
          ? "نسخ الكليات الموضحة في الملخص"
          : ctx.selectedVersion?.name,
        versionStatus: null,
        note: canViewAcrossColleges
          ? "جميع أنظمة الدراسة — الكليات المرتبطة بالمحاضر."
          : "يشمل مواد وساعات المحاضر داخل هذه الكلية فقط.",
      }}
      filename="instructor_schedule"
      rows={rows}
      headers={exportHeaders}
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
                hint: canViewAcrossColleges
                  ? "إجمالي الساعات الأسبوعية في الكليات المرتبطة بالمحاضر"
                  : "إجمالي الساعات الأسبوعية داخل الكلية الحالية",
              },
              {
                label: "النصاب الفعلي",
                value: actualQuotaLabel,
                tone: workloadBalance.status === "overload" ? "warning" : "success",
                hint:
                  workloadBalance.netHours === null
                    ? "النصاب غير محدد في بطاقة المحاضر أو سياسة النصاب"
                    : "النصاب المعتمد من الكلية الأصلية بعد الإعفاء الإداري",
              },
              { label: "أيام الحضور", value: distinctDays },
              { label: "المقررات", value: distinctCourses },
            ]
      }
      filters={
        <ReportFilters
          context={ctx}
          studySystem={false}
          extraSummary={instructorName ? [`المحاضر: ${instructorName}`] : []}
          onClear={() => {
            setInsId("");
            setInstructorSearch("");
            setVersionSelections({});
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
                    {i.full_name} {i.university_number ? `— ${i.university_number}` : ""} —{" "}
                    {directory.data?.colleges.find((c) => c.id === i.college_id)?.name ??
                      "كلية المحاضر"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </ReportFilterField>
          {canViewAcrossColleges && reportScopes.some((s) => s.collegeId !== ctx.collegeId) && (
            <div className="col-span-full border-t pt-3">
              <p className="font-medium">تدريس المحاضر في الكليات الأخرى</p>
              <p className="text-xs text-muted-foreground">
                تظهر فقط الكليات التي للمحاضر محاضرات فيها خلال الفترة الدراسية. يضم الجدول وملخص
                الساعات الكلية الحالية وهذه الكليات.
              </p>
            </div>
          )}
          {reportScopes
            .filter((s) => s.collegeId !== ctx.collegeId)
            .map((scope) => (
              <ReportFilterField
                key={scope.collegeId}
                label={`نسخة ${scope.collegeName}`}
                htmlFor={`version-${scope.collegeId}`}
              >
                <Select
                  value={scope.version.id}
                  onValueChange={(value) =>
                    setVersionSelections((old) => ({ ...old, [scope.collegeId]: value }))
                  }
                >
                  <SelectTrigger id={`version-${scope.collegeId}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {scope.options.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.name} — {STATUS_LABEL_AR[v.status as SVStatus]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </ReportFilterField>
            ))}
          {canViewAcrossColleges && (
            <p className="text-xs text-muted-foreground">
              تُختار أحدث نسخة منشورة لكل كلية في الفترة الدراسية، ثم نسخة التنسيق أو أحدث مسودة عند
              عدم وجود منشور. يمكنك تغييرها أعلاه. تظهر خيارات الكليات المرتبطة بتدريس المحاضر فقط،
              ضمن صلاحياتك.
            </p>
          )}
        </ReportFilters>
      }
    >
      {ready && sessions.length > 0 && (
        <div className="space-y-4">
          <ReportTimetableView
            hideInstructor
            printSummary={
              <InstructorCollegeHours
                summary={summary}
                hourlyContract={isHourlyContract}
                universityScope={canViewAcrossColleges}
              />
            }
            compactDetails
            sessions={sessions}
            collegeId={ctx.collegeId}
            headers={exportHeaders}
          />
          <div className="report-no-print">
            <InstructorCollegeHours
              summary={summary}
              hourlyContract={isHourlyContract}
              universityScope={canViewAcrossColleges}
            />
          </div>
        </div>
      )}
    </ReportShell>
  );
}
