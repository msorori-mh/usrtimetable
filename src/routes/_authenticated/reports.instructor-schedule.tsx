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
  timetableSessionToRow,
  NEW_FLOW_TIMETABLE_TABLE_HEADERS,
} from "@/lib/reports/session-mappers";
import { USR_UNIVERSITY_NAME_AR } from "@/lib/branding/usr";
import { QUOTA_UNDEFINED_AR } from "@/lib/reports/instructor-quota";
import { buildScheduleReportFilename } from "@/lib/reports/schedule-filename";
import {
  fetchUniversityScheduleDirectory,
  fetchInstructorTeachingCollegeIds,
  fetchUniversityInstructorSchedule,
} from "@/lib/reports/queries/university-instructor-schedule";
import {
  resolveCollegeScheduleScopes,
  instructorTeachingScopes,
  summarizeUniversitySchedule,
  instructorScheduleForScope,
  parseInstructorScheduleScope,
  instructorsForCurrentCollege,
  type InstructorScheduleScope,
} from "@/lib/reports/university-instructor-schedule";
import { InstructorCollegeHours } from "@/components/reports/instructor-college-hours";
import {
  InstructorBatchPrint,
  type InstructorBatchSheet,
} from "@/components/reports/instructor-batch-print";
import {
  InstructorPdfArchive,
  type InstructorPdfEntry,
} from "@/components/reports/instructor-pdf-archive";
import { RepeatingPrintHeader } from "@/components/reports/repeating-print-header";
import { ReportOfficialHeader } from "@/components/reports/report-official-header";
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
    // The individual schedule handed to a lecturer is the official one: only
    // published versions may be chosen, so a draft is never printed by mistake.
    fixedStatusMode: "published_only",
    defaultStudySystem: "all",
    fixedStudySystem: "all",
  });
  const [insId, setInsId] = useState("");
  const [instructorSearch, setInstructorSearch] = useState("");
  const [scheduleScope, setScheduleScope] = useState<InstructorScheduleScope>("all");
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
    const params = new URLSearchParams(window.location.search);
    setInsId(params.get("instructorId") ?? "");
    setScheduleScope(parseInstructorScheduleScope(params.get("instructorScheduleScope")));
  }, [ctx.collegeId]);

  const directory = useQuery({
    queryKey: [
      "university-instructor-schedule-directory",
      ctx.collegeId,
      currentUser.data?.id,
      currentUser.data?.isSuperAdmin,
    ],
    enabled: !!ctx.collegeId && !!currentUser.data,
    queryFn: () => fetchUniversityScheduleDirectory(ctx.collegeId!),
  });
  const canViewAcrossColleges =
    currentUser.data?.isSuperAdmin === true &&
    directory.data?.collegeId === ctx.collegeId &&
    directory.data?.canViewAcrossColleges === true;
  const allInstructors = useMemo(
    () =>
      (directory.data?.collegeId === ctx.collegeId ? directory.data.instructors : [])
        .slice()
        .sort((a, b) => a.full_name.localeCompare(b.full_name, "ar")),
    [directory.data, ctx.collegeId],
  );
  const instructors = useMemo(
    () =>
      instructorsForCurrentCollege(
        allInstructors,
        directory.data?.collegeId === ctx.collegeId
          ? directory.data.currentInstructorIdentityIds
          : [],
      ),
    [allInstructors, directory.data, ctx.collegeId],
  );
  const selectedInstructor = instructors?.find(
    (i) => i.id === insId || i.record_ids.includes(insId),
  );
  useEffect(() => {
    if (directory.data?.collegeId === ctx.collegeId && insId && !selectedInstructor) {
      setInsId("");
    }
  }, [directory.data, ctx.collegeId, insId, selectedInstructor]);
  const effectiveScope = canViewAcrossColleges ? scheduleScope : "current";
  const instructorName = selectedInstructor?.full_name;
  const universityNumber = selectedInstructor?.university_number;
  const isHourlyContract =
    isHourlyContractTypeCode(selectedInstructor?.instructor_type_code) ||
    selectedInstructor?.employment_type === "contract";
  const selection = useMemo(() => {
    if (!directory.data || directory.data.collegeId !== ctx.collegeId || !ctx.versionId)
      return { scopes: [], error: null };
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
      allInstructors
        .map((i) => `${i.id}:${i.university_number}:${i.record_ids.join("|")}`)
        .join(","),
    ],
    enabled:
      canViewAcrossColleges &&
      !!selectedInstructor &&
      selection.scopes.length > 0 &&
      !selection.error,
    queryFn: () =>
      fetchInstructorTeachingCollegeIds({
        selected: selectedInstructor!,
        records: allInstructors,
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
      allInstructors
        .map((i) => `${i.id}:${i.university_number}:${i.record_ids.join("|")}`)
        .join(","),
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
        records: allInstructors,
        scopes: reportScopes,
      }),
  });
  const scopeLabel =
    effectiveScope === "all"
      ? "جميع الكليات"
      : `الكلية الحالية: ${directory.data?.colleges.find((c) => c.id === ctx.collegeId)?.name ?? ""}`;
  const scopedSessions = useMemo(
    () =>
      !selectedInstructor
        ? []
        : canViewAcrossColleges
          ? instructorScheduleForScope(schedule.data ?? [], effectiveScope, ctx.collegeId ?? "")
          : (schedule.data ?? []),
    [schedule.data, selectedInstructor, canViewAcrossColleges, effectiveScope, ctx.collegeId],
  );
  const summary = useMemo(() => {
    const baseQuota = isHourlyContract
      ? null
      : (selectedInstructor?.recorded_quota ?? selectedInstructor?.authoritative_quota ?? null);
    const release = isHourlyContract ? 0 : (selectedInstructor?.recorded_release ?? 0);
    return summarizeUniversitySchedule(scopedSessions, {
      maxWeeklyHours: baseQuota,
      adminReleaseHours: release,
    });
  }, [scopedSessions, isHourlyContract, selectedInstructor]);
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
    if (selectedInstructor && !selection.error) {
      if (canViewAcrossColleges) await teachingColleges.refetch();
      await schedule.refetch();
    }
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
  const reportFilename = buildScheduleReportFilename([instructorName], "الجدول الفردي");

  /** One lecturer's schedule and hours in the report's scope; null when nothing is in scope. */
  const loadLecturer = async (instructor: (typeof instructors)[number]) => {
    const collegeId = ctx.collegeId ?? "";
    const teaching =
      canViewAcrossColleges && effectiveScope === "all"
        ? await fetchInstructorTeachingCollegeIds({
            selected: instructor,
            records: allInstructors,
            scopes: selection.scopes,
          })
        : [];
    const loaded = await fetchUniversityInstructorSchedule({
      anchorCollegeId: collegeId,
      selected: instructor,
      records: allInstructors,
      scopes: instructorTeachingScopes(
        selection.scopes,
        collegeId,
        teaching,
        canViewAcrossColleges,
      ),
    });
    const scoped = canViewAcrossColleges
      ? instructorScheduleForScope(loaded, effectiveScope, collegeId)
      : loaded;
    if (!scoped.length) return null;
    const hourly =
      isHourlyContractTypeCode(instructor.instructor_type_code) ||
      instructor.employment_type === "contract";
    const sheetSummary = summarizeUniversitySchedule(scoped, {
      maxWeeklyHours: hourly
        ? null
        : (instructor.recorded_quota ?? instructor.authoritative_quota ?? null),
      adminReleaseHours: hourly ? 0 : (instructor.recorded_release ?? 0),
    });
    return { hourly, sheetSummary };
  };

  /** One lecturer's printable sheet, built exactly like the single-lecturer report. */
  const loadBatchSheet = async (
    instructor: (typeof instructors)[number],
  ): Promise<InstructorBatchSheet | null> => {
    const lecturer = await loadLecturer(instructor);
    if (!lecturer) return null;
    const { hourly, sheetSummary } = lecturer;
    return {
      key: instructor.id,
      content: (
        <RepeatingPrintHeader
          header={
            <ReportOfficialHeader
              reportTitle={`جدول المحاضر — ${instructor.full_name}`}
              description={`${scopeLabel} — جميع أنظمة الدراسة. ${instructor.university_number ? `الرقم الجامعي: ${instructor.university_number}` : ""}`}
              filterSummary={`${ctx.filterSummary} • نطاق الجدول: ${scopeLabel}`}
              termName={ctx.terms.find((term) => term.id === ctx.termId)?.name}
              collegeName={
                canViewAcrossColleges
                  ? scopeLabel
                  : directory.data?.colleges.find((c) => c.id === ctx.collegeId)?.name
              }
              versionName={
                canViewAcrossColleges ? "نسخ الكليات الموضحة في الملخص" : ctx.selectedVersion?.name
              }
              versionStatus={null}
              note={`نطاق الجدول: ${scopeLabel} — العام والموازي معًا.`}
            />
          }
        >
          <div className="report-print-body min-w-0">
            <ReportTimetableView
              hideInstructor
              printSummary={
                <InstructorCollegeHours
                  summary={sheetSummary}
                  hourlyContract={hourly}
                  universityScope={canViewAcrossColleges && effectiveScope === "all"}
                  scopeLabel={scopeLabel}
                />
              }
              compactDetails
              sessions={sheetSummary.sessions}
              collegeId={ctx.collegeId}
              headers={exportHeaders}
            />
          </div>
        </RepeatingPrintHeader>
      ),
    };
  };
  /** The same lecturer data as a standalone PDF sheet for the per-lecturer archive. */
  const loadPdfEntry = async (
    instructor: (typeof instructors)[number],
  ): Promise<InstructorPdfEntry | null> => {
    const lecturer = await loadLecturer(instructor);
    if (!lecturer) return null;
    const { hourly, sheetSummary } = lecturer;
    const universityScope = canViewAcrossColleges && effectiveScope === "all";
    const hours = (n: number | null) => (n === null ? "غير محدد" : n.toFixed(2));
    const text = (value: unknown) =>
      value === null || value === undefined || value === "" ? "" : String(value);
    // Saturday opens the teaching week.
    const ordered = [...sheetSummary.sessions].sort(
      (a, b) =>
        ((a.day_of_week + 1) % 7) - ((b.day_of_week + 1) % 7) ||
        a.start_time.localeCompare(b.start_time),
    );
    return {
      fileName: instructor.full_name,
      sheet: {
        universityName: USR_UNIVERSITY_NAME_AR,
        scopeLabel: `${scopeLabel} — جميع أنظمة الدراسة`,
        instructorName: instructor.full_name,
        universityNumber: instructor.university_number,
        termName: ctx.terms.find((term) => term.id === ctx.termId)?.name ?? null,
        versionLabel: universityScope
          ? "نسخ الكليات الموضحة في الملخص"
          : (ctx.selectedVersion?.name ?? null),
        generatedAt: new Intl.DateTimeFormat("ar-u-nu-latn", { dateStyle: "medium" }).format(
          new Date(),
        ),
        rows: ordered.map((session) => {
          const row = timetableSessionToRow(session);
          return {
            day: text(row.day),
            time: text(row.time),
            course: text(row.course),
            type: text(row.session_type),
            room: text(row.room),
            audience: [
              [text(row.program), text(row.level), text(row.study_system)]
                .filter(Boolean)
                .join(" — "),
              text(row.delivery_group),
            ]
              .filter(Boolean)
              .join(" · "),
            college: session.college_name,
          };
        }),
        colleges: sheetSummary.colleges.map((college) => ({
          name: college.collegeName,
          version: college.versionName,
          hours: hours(college.hours),
        })),
        totals: [
          {
            label: universityScope
              ? "إجمالي الجامعة — الكليات المشمولة"
              : `إجمالي الساعات — ${scopeLabel}`,
            value: hours(sheetSummary.totalHours),
          },
          ...(hourly
            ? []
            : [
                { label: "النصاب الأساسي", value: hours(sheetSummary.balance.baseHours) },
                { label: "الإعفاء الإداري", value: hours(sheetSummary.balance.releaseHours) },
                {
                  label: "النصاب الفعلي بعد الإعفاء",
                  value: hours(sheetSummary.balance.netHours),
                },
              ]),
          {
            label: "الساعات الزائدة",
            value: hourly
              ? "لا ينطبق — تعاقد بالساعات"
              : !universityScope
                ? "يُحدد عند اختيار جميع الكليات"
                : sheetSummary.pending
                  ? "بانتظار توزيع التدريس المشترك"
                  : hours(sheetSummary.balance.overloadHours),
          },
        ],
        note: universityScope
          ? "يشمل جميع أنظمة الدراسة في نسخ الكليات المبينة أعلاه. يُحتسب النصاب مرة واحدة للمحاضر."
          : `هذا الملخص خاص بـ${scopeLabel}؛ الإجمالي الجامعي والساعات الزائدة متاحان عند اختيار جميع الكليات.`,
      },
    };
  };
  const batchReady =
    !!ctx.versionId &&
    !directory.isLoading &&
    !directory.error &&
    !selection.error &&
    selection.scopes.length > 0;

  return (
    <ReportShell
      title={instructorName ? `جدول المحاضر — ${instructorName}` : "تقرير جدول المحاضر الفردي"}
      description={`${scopeLabel} — جميع أنظمة الدراسة. ${universityNumber ? `الرقم الجامعي: ${universityNumber}` : ""}`}
      filterSummary={`${ctx.filterSummary} • نطاق الجدول: ${scopeLabel}`}
      reportContext={ctx}
      shareParams={{
        instructorId: insId,
        instructorHomeCollegeId: null,
        instructorScheduleScope: effectiveScope,
        ...versionShare,
      }}
      headerMeta={{
        collegeName: canViewAcrossColleges ? scopeLabel : undefined,
        versionName: canViewAcrossColleges
          ? "نسخ الكليات الموضحة في الملخص"
          : ctx.selectedVersion?.name,
        versionStatus: null,
        note: `نطاق الجدول: ${scopeLabel} — العام والموازي معًا.`,
      }}
      filename={reportFilename}
      printFilename={reportFilename}
      rows={rows}
      headers={exportHeaders}
      isLoading={isLoading}
      error={queryError}
      onRetry={() => void refetch()}
      notReadyMessage={ready ? undefined : "اختر نسخة جدول ومحاضرًا لعرض الجدول."}
      emptyMessage={`لا توجد محاضرات مسندة لهذا المحاضر ضمن ${scopeLabel} في النسخ المحددة.`}
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
                hint: `إجمالي الساعات الأسبوعية ضمن ${scopeLabel}`,
              },
              {
                label: "النصاب الفعلي",
                value: actualQuotaLabel,
                tone:
                  effectiveScope === "all" && workloadBalance.status === "overload"
                    ? "warning"
                    : "success",
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
          extraSummary={[
            `نطاق الجدول: ${scopeLabel}`,
            ...(instructorName ? [`المحاضر: ${instructorName}`] : []),
          ]}
          onClear={() => {
            setInsId("");
            setInstructorSearch("");
            setVersionSelections({});
            setScheduleScope("all");
          }}
        >
          {canViewAcrossColleges && (
            <ReportFilterField label="نطاق جدول المحاضر" htmlFor="is-schedule-scope">
              <Select
                value={scheduleScope}
                onValueChange={(value) => setScheduleScope(parseInstructorScheduleScope(value))}
              >
                <SelectTrigger id="is-schedule-scope" aria-label="نطاق جدول المحاضر">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">جميع الكليات</SelectItem>
                  <SelectItem value="current">الكلية الحالية فقط</SelectItem>
                </SelectContent>
              </Select>
            </ReportFilterField>
          )}
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
            <Select value={selectedInstructor?.id ?? ""} onValueChange={setInsId}>
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
          <div className="col-span-full flex flex-wrap items-center gap-3 border-t pt-3">
            <InstructorBatchPrint
              items={instructors}
              disabled={!batchReady}
              documentTitle={buildScheduleReportFilename(
                [directory.data?.colleges.find((c) => c.id === ctx.collegeId)?.name],
                "الجداول الفردية للمحاضرين",
              )}
              loadSheet={loadBatchSheet}
            />
            <InstructorPdfArchive
              items={instructors}
              disabled={!batchReady}
              archiveName={buildScheduleReportFilename(
                [directory.data?.colleges.find((c) => c.id === ctx.collegeId)?.name],
                "الجداول الفردية للمحاضرين",
              )}
              loadEntry={loadPdfEntry}
            />
            <p className="basis-full text-xs text-muted-foreground">
              الطباعة تجمع الجداول الفردية الكاملة في ملف واحد، كل محاضر في صفحة جديدة. التنزيل ينشئ
              ملف PDF مستقلًا باسم كل محاضر داخل ملف مضغوط واحد. كلاهما ضمن {scopeLabel}، والمحاضر
              الذي لا محاضرات له في هذا النطاق لا يُنشأ له شيء.
            </p>
          </div>
          {canViewAcrossColleges && reportScopes.some((s) => s.collegeId !== ctx.collegeId) && (
            <div className="col-span-full border-t pt-3">
              <p className="font-medium">تدريس المحاضر في الكليات الأخرى</p>
              <p className="text-xs text-muted-foreground">
                تظهر فقط الكليات التي للمحاضر محاضرات فيها خلال الفترة الدراسية. يضم الجدول وملخص
                الساعات المحاضرات الواقعة ضمن نطاق الجدول المختار.
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
                universityScope={canViewAcrossColleges && effectiveScope === "all"}
                scopeLabel={scopeLabel}
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
              universityScope={canViewAcrossColleges && effectiveScope === "all"}
              scopeLabel={scopeLabel}
            />
          </div>
        </div>
      )}
    </ReportShell>
  );
}
