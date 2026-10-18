import { useCurrentUser } from "@/hooks/use-current-user";
import { canManageTeachingPay } from "@/lib/viewer-roles";
import { TeachingCoverageReport } from "@/components/reports/teaching-coverage-report";
import { TeachingPayReport } from "@/components/reports/teaching-pay-report";
import { SystemHoursReport } from "@/components/reports/system-hours-report";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCollege } from "@/hooks/use-colleges";
import { ReportShell } from "@/components/reports/report-shell";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ReportFilterBar, ReportFilterField } from "@/components/reports/report-filter-bar";
import { ReportSection, ReportDataTable } from "@/components/reports/report-section";
import { filterRowsBySearch, normalizeSearchText } from "@/lib/reports/search";
import { listTeachingAssignmentWorkspace } from "@/lib/academic-delivery/teaching-assignments-v2-service";
import { academicTableColumns } from "@/components/reports/academic-affairs-columns";
import { facultyWorkflow } from "@/lib/instructors/faculty-workflow";
import { fetchAcademicTerms } from "@/lib/reports/queries/version-queries";
import {
  ACADEMIC_REPORT_HEADERS,
  ACADEMIC_REPORT_TITLES,
  buildAcademicReport,
  homeRosterInstructors,
  isWorkloadReport,
  parseAcademicReportKind,
  selectWorkloadReportRows,
  isMissingQuotaRow,
  parseAcademicWorkload,
  summarizeCourseAssignmentStatusRows,
  summarizeWorkloadRows,
  type AcademicInstructor,
  type AcademicProgram,
  type AcademicReportRow,
  type AcademicReportKind,
  type AcademicWorkload,
} from "@/lib/reports/academic-affairs";

export const Route = createFileRoute("/_authenticated/reports/academic-affairs")({
  head: () => ({ meta: [{ title: "تقارير الشؤون الأكاديمية" }] }),
  validateSearch: (
    search: Record<string, unknown>,
  ): { report?: AcademicReportKind; termId?: string } => ({
    report: parseAcademicReportKind(search.report),
    termId:
      typeof search.termId === "string" && /^[0-9a-f-]{36}$/i.test(search.termId)
        ? search.termId
        : undefined,
  }),
  component: Page,
});

/** Page every reference list, so colleges with more than 1,000 staff are not silently truncated. */
async function readAll<T>(
  query: (
    from: number,
    to: number,
  ) => PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    const result = await query(from, from + 499);
    if (result.error) throw new Error(result.error.message);
    rows.push(...(result.data ?? []));
    if ((result.data ?? []).length < 500) return rows;
  }
}

function Page() {
  const { report, termId } = Route.useSearch();
  const { active, isLoading } = useActiveCollege();
  if (isLoading) return <Card className="p-6">جارٍ تحميل الكليات…</Card>;
  if (!active) return <Card className="p-6">لا توجد كلية متاحة لهذا الحساب.</Card>;
  if (report === "coverage")
    return (
      <TeachingCoverageReport
        key={active.id}
        collegeId={active.id}
        collegeName={active.name}
        initialTermId={termId}
      />
    );
  if (report === "teaching_pay")
    return (
      <TeachingPayReport
        key={active.id}
        collegeId={active.id}
        collegeName={active.name}
        initialTermId={termId}
      />
    );
  if (report === "overload_system" || report === "contractual")
    return (
      <SystemHoursReport
        key={`${active.id}:${report}`}
        collegeId={active.id}
        collegeName={active.name}
        kind={report}
        initialTermId={termId}
      />
    );
  // Remount resets every dependent filter immediately when switching colleges.
  return <AcademicReports key={active.id} collegeId={active.id} collegeName={active.name} />;
}

function AcademicReports({ collegeId, collegeName }: { collegeId: string; collegeName: string }) {
  const { data: me } = useCurrentUser();
  const kind = Route.useSearch().report ?? "workload";
  const navigate = Route.useNavigate();
  const setKind = (value: AcademicReportKind) => {
    setLoadStatus("all");
    setAssignmentCoverage("all");
    setInstructorId("all");
    void navigate({ search: { report: value, termId: chosenTerm || undefined } });
  };
  const workloadReport = isWorkloadReport(kind);
  const separateBalance = kind === "overload" || kind === "deficit";
  const [chosenTerm, setChosenTerm] = useState(Route.useSearch().termId ?? "");
  const [departmentId, setDepartmentId] = useState("all");
  const [programId, setProgramId] = useState("all");
  const [instructorId, setInstructorId] = useState("all");
  const [loadStatus, setLoadStatus] = useState("all");
  const [assignmentCoverage, setAssignmentCoverage] = useState("all");
  const [search, setSearch] = useState("");

  const references = useQuery({
    queryKey: ["academic-affairs-references", collegeId],
    queryFn: async () => {
      const [terms, departments, programs, operationalInstructors, homeRoster, pendingRoster] =
        await Promise.all([
          fetchAcademicTerms(collegeId),
          readAll<{ id: string; name: string }>((from, to) =>
            supabase
              .from("departments")
              .select("id, name")
              .eq("college_id", collegeId)
              .order("id")
              .range(from, to),
          ),
          readAll<AcademicProgram>((from, to) =>
            supabase
              .from("academic_programs")
              .select("id, name, department_id")
              .eq("college_id", collegeId)
              .order("id")
              .range(from, to),
          ),
          readAll<AcademicInstructor>((from, to) =>
            supabase
              .from("instructors")
              .select(
                "id, full_name, employee_number, academic_rank, administrative_position, department_id, max_weekly_hours, administrative_release_hours",
              )
              .eq("college_id", collegeId)
              .order("id")
              .range(from, to),
          ),
          facultyWorkflow
            .rpc("get_college_faculty_roster", {
              p_college_id: collegeId,
              p_scope: "home",
            })
            .then(({ data, error }) => {
              if (error) throw new Error(error.message);
              if (!Array.isArray(data)) throw new Error("تعذر قراءة أعضاء الكلية الأصلية");
              return data;
            }),
          facultyWorkflow
            .rpc("get_college_faculty_roster", {
              p_college_id: collegeId,
              p_scope: "pending",
            })
            .then(({ data, error }) => {
              if (error) throw new Error(error.message);
              if (!Array.isArray(data)) throw new Error("تعذر قراءة التبعيات المعلقة");
              return data;
            }),
        ]);
      return {
        terms,
        departments,
        programs,
        operationalInstructors,
        homeInstructors: homeRosterInstructors(homeRoster, collegeId),
        pendingAffiliationCount: pendingRoster.length,
      };
    },
  });
  const refs = references.data;
  const reportInstructors = workloadReport ? refs?.homeInstructors : refs?.operationalInstructors;
  const termId = refs?.terms.some((t) => t.id === chosenTerm)
    ? chosenTerm
    : (refs?.terms[0]?.id ?? "");
  const term = refs?.terms.find((t) => t.id === termId);
  const report = useQuery({
    queryKey: ["academic-affairs-data", collegeId, termId, workloadReport, reportInstructors],
    enabled: !!refs && !!termId,
    queryFn: async () => {
      const workspace = await listTeachingAssignmentWorkspace({
        collegeId,
        termId,
      });
      if (!workspace.ok || workspace.college_id !== collegeId)
        throw new Error("تعذر تحميل الإسناد التدريسي");
      const workloads: AcademicWorkload[] = [];
      if (workloadReport) {
        const instructors = reportInstructors ?? [];
        for (let offset = 0; offset < instructors.length; offset += 6) {
          workloads.push(
            ...(await Promise.all(
              instructors.slice(offset, offset + 6).map(async (i) => {
                const { data, error } = await supabase.rpc("compute_instructor_standard_workload", {
                  p_instructor_id: i.id,
                  p_term_id: termId,
                });
                if (error) throw new Error(error.message);
                return parseAcademicWorkload(data, i.id);
              }),
            )),
          );
        }
      }
      return { groups: workspace.rows, workloads };
    },
  });

  const error = references.error ?? report.error;
  const loading = references.isFetching || report.isFetching;
  const input =
    refs && report.data && termId && !error && !loading
      ? {
          scope: { collegeId, termId, departmentId, programId, instructorId },
          ...refs,
          ...report.data,
          instructors: reportInstructors ?? [],
        }
      : null;
  const sourceRows = input ? buildAcademicReport(input, workloadReport ? "workload" : kind) : [];
  const allRows = selectWorkloadReportRows(sourceRows, kind);
  const courseStatusReport = kind === "course_status";
  const incompleteMembers = summarizeWorkloadRows(
    filterRowsBySearch(workloadReport ? sourceRows : [], search),
  ).incompleteMembers;
  const statusRows = courseStatusReport
    ? assignmentCoverage === "all"
      ? allRows
      : allRows.filter((row) => row.allocation_status_code === assignmentCoverage)
    : kind === "workload" && loadStatus !== "all"
      ? allRows.filter((r) =>
          loadStatus === "missing"
            ? isMissingQuotaRow(r)
            : loadStatus === "overload"
              ? Number(r.overload) > 0
              : Number(r.deficit) > 0,
        )
      : allRows;

  // Search only hides rows in the view; exported keys and values stay identical.
  const courseNeedle = normalizeSearchText(search);
  const rows = courseStatusReport
    ? statusRows.filter((row) =>
        normalizeSearchText(`${row.course_code ?? ""} ${row.course_name ?? ""}`).includes(
          courseNeedle,
        ),
      )
    : filterRowsBySearch(statusRows, search);
  // Totals are recomputed from the visible rows, so KPIs always match the table and the export.
  const workloadTotals = summarizeWorkloadRows(workloadReport ? rows : []);
  const courseStatusTotals = summarizeCourseAssignmentStatusRows(courseStatusReport ? rows : []);
  const headers = ACADEMIC_REPORT_HEADERS[kind];

  const programs =
    refs?.programs.filter((p) => departmentId === "all" || p.department_id === departmentId) ?? [];
  const filterSummary = [
    `الكلية: ${collegeName}`,
    `الفصل: ${term?.name ?? "غير محدد"}`,
    `القسم: ${refs?.departments.find((d) => d.id === departmentId)?.name ?? "الكل"}`,
    `البرنامج: ${refs?.programs.find((p) => p.id === programId)?.name ?? "الكل"}`,
    `عضو هيئة التدريس: ${reportInstructors?.find((i) => i.id === instructorId)?.full_name ?? "الكل"}`,
    workloadReport ? "التبعية: الكلية الأصلية" : "",
    search.trim() ? `${courseStatusReport ? "المقرر" : "بحث"}: ${search.trim()}` : "",
    kind === "workload"
      ? `الحالة: ${loadStatus === "overload" ? "ساعات زائدة" : loadStatus === "deficit" ? "نقص النصاب" : loadStatus === "missing" ? "بلا نصاب معتمد" : "الكل"}`
      : "",
    courseStatusReport
      ? `حالة الإسناد: ${assignmentCoverage === "unassigned" ? "غير مسند" : assignmentCoverage === "under_allocated" ? "تغطية جزئية" : assignmentCoverage === "fully_allocated" ? "مكتمل" : assignmentCoverage === "over_allocated" ? "تجاوز الساعات" : assignmentCoverage === "pending_split" ? "بانتظار توزيع الساعات" : "الكل"}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <ReportShell
      title={ACADEMIC_REPORT_TITLES[kind]}
      description={
        courseStatusReport
          ? "حالة إسناد كل مقرر ومجموعة تدريس، مع الساعات المطلوبة والمسندة والمتبقية والمحاضرين وتفاصيل التحقق."
          : "تقارير الشؤون الأكاديمية بحسب الكلية والقسم والبرنامج وعضو هيئة التدريس."
      }
      filename={`academic_affairs_${kind}_${collegeName}_${term?.name ?? ""}`}
      printFilename={`${ACADEMIC_REPORT_TITLES[kind]} — ${collegeName} — ${term?.name ?? ""}`}
      headers={headers}
      rows={rows}
      isLoading={loading}
      error={error}
      onRetry={() => {
        void references.refetch();
        void report.refetch();
      }}
      filterSummary={filterSummary}
      headerMeta={{ termName: term?.name, note: filterSummary }}
      emptyMessage={
        !termId
          ? "لم تُسجّل فصول دراسية لهذه الكلية بعد. تظهر التقارير عند إدخال بياناتها."
          : error
            ? "تعذر إعداد التقرير؛ حدّث الصفحة للمحاولة مجدداً."
            : separateBalance
              ? `${kind === "overload" ? "لا توجد ساعات زائدة محسوبة" : "لا يوجد عجز نصاب محسوب"} بهذه المعايير.${incompleteMembers ? " توجد بيانات نصاب أو توزيع ساعات غير مكتملة؛ راجع التنبيه." : ""}`
              : "لا توجد بيانات بهذه المعايير."
      }
      summary={
        courseStatusReport && !loading && !error && termId ? (
          <Card className="p-4 text-sm leading-7" data-testid="course-assignment-status-summary">
            {`يعرض التقرير ${courseStatusTotals.groups} مجموعة تدريس: ${courseStatusTotals.completeGroups} مكتملة، ${courseStatusTotals.partialGroups} جزئية، ${courseStatusTotals.unassignedGroups} غير مسندة، ${courseStatusTotals.overAllocatedGroups} متجاوزة للساعات، و${courseStatusTotals.pendingSplitGroups} بانتظار توزيع ساعات التدريس المشترك. الساعات المطلوبة ${courseStatusTotals.requiredHours}، والمسندة المؤكدة ${courseStatusTotals.assignedHours}، والمتبقية المؤكدة ${courseStatusTotals.remainingHours}.`}
          </Card>
        ) : separateBalance && !loading && !error && termId ? (
          <Card className="p-4 text-sm leading-7" data-testid="balance-report-summary">
            {`عدد أعضاء هيئة التدريس: ${rows.length} · ${kind === "overload" ? "إجمالي الساعات الزائدة" : "إجمالي ساعات العجز"}: ${kind === "overload" ? workloadTotals.overloadHours : workloadTotals.deficitHours} ساعة أسبوعيًا · صافي النصاب: ${workloadTotals.netQuotaHours} ساعة · الساعات المسندة: ${workloadTotals.assignedHours} ساعة.`}
          </Card>
        ) : undefined
      }
      kpis={
        courseStatusReport
          ? [
              { label: "مجموعات التدريس", value: courseStatusTotals.groups },
              { label: "مكتملة", value: courseStatusTotals.completeGroups, tone: "accent" },
              { label: "غير مسندة", value: courseStatusTotals.unassignedGroups },
              { label: "تغطية جزئية", value: courseStatusTotals.partialGroups },
              { label: "تجاوز الساعات", value: courseStatusTotals.overAllocatedGroups },
              { label: "الساعات المتبقية المؤكدة", value: courseStatusTotals.remainingHours },
            ]
          : separateBalance
            ? [
                { label: "أعضاء هيئة التدريس", value: rows.length },
                {
                  label: kind === "overload" ? "إجمالي الساعات الزائدة" : "إجمالي ساعات العجز",
                  value:
                    kind === "overload"
                      ? workloadTotals.overloadHours
                      : workloadTotals.deficitHours,
                },
                { label: "صافي النصاب (ساعة)", value: workloadTotals.netQuotaHours },
                { label: "الساعات المسندة", value: workloadTotals.assignedHours },
              ]
            : [
                { label: "عدد السجلات", value: rows.length },
                ...(kind === "workload"
                  ? [
                      {
                        label: "ساعات زائدة",
                        value: workloadTotals.overloadedMembers,
                      },
                      {
                        label: "نقص نصاب",
                        value: workloadTotals.deficitMembers,
                      },
                      {
                        label: "بلا نصاب معتمد",
                        value: workloadTotals.missingMembers,
                      },
                      {
                        label: "بانتظار توزيع الساعات",
                        value: workloadTotals.pendingSplitMembers,
                      },
                      {
                        label: "إجمالي صافي النصاب (ساعة)",
                        value: workloadTotals.netQuotaHours,
                      },
                    ]
                  : []),
              ]
      }
      filters={
        <ReportFilterBar
          search={{
            value: search,
            onChange: setSearch,
            placeholder: courseStatusReport
              ? "ابحث باسم المقرر أو رمزه…"
              : "ابحث في نتائج التقرير…",
          }}
          activeSummary={filterSummary.split(" · ")}
          onClear={() => {
            setDepartmentId("all");
            setProgramId("all");
            setInstructorId("all");
            setLoadStatus("all");
            setAssignmentCoverage("all");
            setSearch("");
          }}
          basic={
            <>
              <Filter
                label="نوع التقرير"
                value={kind}
                onChange={(v) => setKind(v as AcademicReportKind)}
                items={Object.entries(ACADEMIC_REPORT_TITLES)
                  .filter(([id]) => id !== "teaching_pay" || canManageTeachingPay(me))
                  .map(([id, name]) => ({
                    id,
                    name,
                  }))}
              />
              <Filter
                label="الفصل الدراسي"
                value={termId}
                onChange={setChosenTerm}
                items={refs?.terms ?? []}
              />
              <Filter
                label="القسم"
                value={departmentId}
                onChange={(v) => {
                  setDepartmentId(v);
                  setProgramId("all");
                  setInstructorId("all");
                }}
                items={[{ id: "all", name: "كل الأقسام" }, ...(refs?.departments ?? [])]}
              />
            </>
          }
          advanced={
            <>
              <Filter
                label="البرنامج"
                value={programId}
                onChange={(v) => {
                  setProgramId(v);
                  setInstructorId("all");
                }}
                items={[{ id: "all", name: "كل البرامج" }, ...programs]}
              />
              <Filter
                label="عضو هيئة التدريس"
                value={instructorId}
                onChange={setInstructorId}
                items={[
                  { id: "all", name: "كل أعضاء هيئة التدريس" },
                  ...(reportInstructors?.map((i) => ({
                    id: i.id,
                    name: i.full_name,
                  })) ?? []),
                ]}
              />
              {kind === "workload" && (
                <Filter
                  label="حالة النصاب"
                  value={loadStatus}
                  onChange={setLoadStatus}
                  items={[
                    { id: "all", name: "الكل" },
                    { id: "overload", name: "الساعات الزائدة" },
                    { id: "deficit", name: "نقص النصاب" },
                    { id: "missing", name: "بلا نصاب معتمد" },
                  ]}
                />
              )}
              {courseStatusReport && (
                <Filter
                  label="حالة الإسناد"
                  value={assignmentCoverage}
                  onChange={setAssignmentCoverage}
                  items={[
                    { id: "all", name: "الكل" },
                    { id: "unassigned", name: "غير مسند" },
                    { id: "under_allocated", name: "تغطية جزئية" },
                    { id: "fully_allocated", name: "مكتمل" },
                    { id: "over_allocated", name: "تجاوز الساعات" },
                    { id: "pending_split", name: "بانتظار توزيع الساعات" },
                  ]}
                />
              )}
            </>
          }
        />
      }
      leading={
        <>
          {error && (
            <Card role="alert" className="border-destructive p-4 text-destructive">
              تعذر تحميل بيانات التقرير. لا تُعتمد أرقام جزئية.
            </Card>
          )}
          {workloadReport && (
            <Card className="p-3 text-sm">
              يضم الكشف أعضاء هيئة التدريس الذين اعتُمدت تبعيتهم الأصلية لهذه الكلية. يُعتمد نصاب
              الكلية الأصلية بعد خصم الإعفاء الإداري؛ وعند غياب اعتماده تظهر «غير محدد». تُسمح
              بساعات زائدة لا تتجاوز 12 ساعة أسبوعيًا، وتُقارَن به ساعات التدريس المسندة للعضو على
              مستوى الجامعة خلال الفصل المناظر في الكليات، مع إظهار إشراف المشاريع منفصلاً. عند عدم
              وجود نصاب معتمد تظهر «غير محدد» في النصاب والزيادة والنقص، ولا تُعامل كصفر ولا تدخل في
              المجاميع.
              {(refs?.pendingAffiliationCount ?? 0) > 0 && (
                <span className="mt-2 block">
                  {`${refs?.pendingAffiliationCount} عضواً تبعيتهم الأصلية غير محسومة؛ لا يُصنّفون ضمن نصاب أي كلية حتى تسوية التبعية.`}{" "}
                  <Link to="/instructors" className="underline">
                    مراجعة التبعية في صفحة المحاضرين
                  </Link>
                </span>
              )}
              {incompleteMembers > 0 && (
                <span className="mt-2 block">
                  {`${incompleteMembers} عضواً بانتظار استكمال النصاب أو توزيع التدريس المشترك؛ استُبعدوا من مجاميع الزيادة والنقص.`}{" "}
                  <Link to="/instructors" className="underline">
                    تصحيح النصاب في صفحة المحاضرين
                  </Link>
                </span>
              )}
            </Card>
          )}
          {separateBalance && (
            <Card className="p-3 text-sm">
              {kind === "overload"
                ? "يعرض هذا الكشف أصحاب الساعات الزائدة فقط، مرتبين من الأعلى إلى الأقل."
                : "يعرض هذا الكشف نقص نصاب أعضاء هيئة التدريس فقط، ويشمل من لم تُسند لهم ساعات. لا يمثل عجز تغطية المقررات."}{" "}
              الحساب أسبوعي لأعضاء الكلية الأصلية خلال الفصل المناظر على مستوى الجامعة؛ تصفية
              البرنامج تختار الأعضاء وتحافظ على كامل عبئهم التدريسي.
            </Card>
          )}
          {kind === "shortages" && (
            <Card className="p-3 text-sm">
              عجز الإسناد هو ساعات مجموعات التدريس النشطة التي لم تُستكمل تغطيتها؛ وهو مستقل عن نقص
              نصاب عضو هيئة التدريس.
            </Card>
          )}
          {courseStatusReport && (
            <Card className="p-3 text-sm">
              كل صف يمثل مجموعة تدريس فعلية نشطة لمقرر واحد. «غير مسند» يعني عدم وجود محاضر نشط،
              و«تغطية جزئية» تعني أن بعض ساعات المجموعة ما زالت دون إسناد. الساعات غير الموزعة في
              التدريس المشترك لا تُحوّل إلى أرقام تقديرية.
            </Card>
          )}
        </>
      }
    >
      <ReportSection title={ACADEMIC_REPORT_TITLES[kind]} count={rows.length} bodyClassName="p-0">
        <ReportDataTable
          rows={rows}
          caption={ACADEMIC_REPORT_TITLES[kind]}
          columns={academicTableColumns(kind)}
          primaryColumnLimit={8}
          minWidthClassName="min-w-[760px]"
        />
      </ReportSection>
    </ReportShell>
  );
}

function Filter({
  label,
  value,
  onChange,
  items,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  items: { id: string; name: string }[];
}) {
  return (
    <ReportFilterField label={label}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label={label}>
          <SelectValue placeholder="اختر" />
        </SelectTrigger>
        <SelectContent>
          {items.map((i) => (
            <SelectItem key={i.id} value={i.id}>
              {i.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </ReportFilterField>
  );
}
