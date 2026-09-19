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
import {
  ReportSection,
  ReportDataTable,
  type ReportColumn,
} from "@/components/reports/report-section";
import { filterRowsBySearch } from "@/lib/reports/search";
import { listTeachingAssignmentWorkspace } from "@/lib/academic-delivery/teaching-assignments-v2-service";
import { fetchAcademicTerms } from "@/lib/reports/queries/version-queries";
import {
  ACADEMIC_REPORT_HEADERS,
  ACADEMIC_REPORT_TITLES,
  buildAcademicReport,
  isWorkloadReport,
  parseAcademicReportKind,
  selectWorkloadReportRows,
  isMissingQuotaRow,
  parseAcademicWorkload,
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
  const { active, isLoading } = useActiveCollege();
  if (isLoading) return <Card className="p-6">جارٍ تحميل الكليات…</Card>;
  if (!active) return <Card className="p-6">لا توجد كلية متاحة لهذا الحساب.</Card>;
  // Remount resets every dependent filter immediately when switching colleges.
  return <AcademicReports key={active.id} collegeId={active.id} collegeName={active.name} />;
}

const valueText = (value: string | number | null | undefined) =>
  value === null || value === undefined || value === "" ? "—" : String(value);

const hourText = (value: string | number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? `${value} س` : valueText(value);

const numericValue = (value: string | number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function DataLine({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string | number | null | undefined;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 leading-5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className={strong ? "font-semibold tabular-nums" : "tabular-nums"}>
        {valueText(value)}
      </span>
    </div>
  );
}

function MemberCell({ row }: { row: AcademicReportRow }) {
  const meta = [row.rank, row.department].filter((value) => value && value !== "غير محدد");
  return (
    <div className="min-w-[170px] space-y-0.5 leading-5">
      <div className="font-semibold">{valueText(row.instructor)}</div>
      {row.employee_number && row.employee_number !== "—" && (
        <div className="text-[11px] tabular-nums text-muted-foreground">
          الرقم الوظيفي: {valueText(row.employee_number)}
        </div>
      )}
      {meta.length > 0 && (
        <div className="text-[11px] text-muted-foreground">{meta.map(valueText).join(" · ")}</div>
      )}
      {row.administrative_position && row.administrative_position !== "—" && (
        <div className="text-[11px] text-muted-foreground">
          {valueText(row.administrative_position)}
        </div>
      )}
    </div>
  );
}

function QuotaCell({ row }: { row: AcademicReportRow }) {
  return (
    <div className="min-w-[125px] space-y-0.5">
      <DataLine label="الأساسي" value={hourText(row.base_required)} />
      <DataLine label="الإعفاء" value={hourText(row.release)} />
      <DataLine label="الصافي" value={hourText(row.required)} strong />
      {row.quota_source && (
        <div className="pt-0.5 text-[10px] text-muted-foreground">
          المصدر: {valueText(row.quota_source)}
        </div>
      )}
    </div>
  );
}

function AssignedLoadCell({ row }: { row: AcademicReportRow }) {
  const assigned = numericValue(row.assigned);
  const required = numericValue(row.required);
  const ratio =
    assigned !== null && required !== null && required > 0
      ? Math.round((assigned / required) * 100)
      : null;
  return (
    <div className="min-w-[120px] space-y-0.5">
      <DataLine label="التدريس" value={hourText(row.assigned)} strong />
      {numericValue(row.project) !== null && Number(row.project) > 0 && (
        <DataLine label="إشراف مشاريع" value={hourText(row.project)} />
      )}
      {ratio !== null && (
        <div className="pt-0.5 text-[10px] text-muted-foreground">تحقيق النصاب: {ratio}%</div>
      )}
    </div>
  );
}

function BalanceCell({ row, kind }: { row: AcademicReportRow; kind: AcademicReportKind }) {
  const overload = numericValue(row.overload);
  const deficit = numericValue(row.deficit);
  const pending = numericValue(row.shared_hours_pending);
  const focus =
    kind === "overload"
      ? `زائد ${hourText(row.overload)}`
      : kind === "deficit"
        ? `عجز ${hourText(row.deficit)}`
        : pending !== null && pending > 0
          ? `تدريس مشترك بانتظار التوزيع: ${hourText(pending)}`
          : overload !== null && overload > 0
            ? `زائد ${hourText(overload)}`
            : deficit !== null && deficit > 0
              ? `عجز ${hourText(deficit)}`
              : overload !== null && deficit !== null
                ? "متوازن"
                : "غير محدد";
  return (
    <div className="min-w-[145px] space-y-1 leading-5">
      <div className="font-semibold">{focus}</div>
      <div className="inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium">
        {valueText(row.status)}
      </div>
    </div>
  );
}

function ContextCell({ row }: { row: AcademicReportRow }) {
  return (
    <div className="min-w-[165px] space-y-0.5 leading-5">
      <div className="font-semibold">{valueText(row.program)}</div>
      <div className="text-[11px] text-muted-foreground">{valueText(row.department)}</div>
      <div className="text-[11px] text-muted-foreground">
        {valueText(row.cohort)} · {valueText(row.study_system)}
      </div>
    </div>
  );
}

function GroupCell({ row }: { row: AcademicReportRow }) {
  return (
    <div className="min-w-[105px] space-y-0.5 leading-5">
      <div className="font-semibold">{valueText(row.group)}</div>
      <div className="text-[11px] text-muted-foreground">{valueText(row.component)}</div>
      {row.students !== undefined && (
        <div className="text-[10px] text-muted-foreground">
          {valueText(row.students)} طالب · السعة {valueText(row.capacity)}
        </div>
      )}
    </div>
  );
}

function AssignmentHoursCell({ row }: { row: AcademicReportRow }) {
  return (
    <div className="min-w-[105px] space-y-0.5">
      <DataLine label="المطلوب" value={hourText(row.required)} />
      <DataLine label="المسند" value={hourText(row.assigned)} strong />
    </div>
  );
}

function CoverageCell({ row }: { row: AcademicReportRow }) {
  const required = numericValue(row.required);
  const assigned = numericValue(row.assigned);
  const pending = numericValue(row.shared_hours_pending);
  const coverage =
    required !== null && required > 0 && assigned !== null
      ? Math.round((assigned / required) * 100)
      : null;
  return (
    <div className="min-w-[125px] space-y-0.5">
      <DataLine label="المطلوب" value={hourText(row.required)} />
      {pending !== null && pending > 0 ? (
        <>
          <DataLine label="مشترك غير موزع" value={hourText(pending)} strong />
          <div className="pt-0.5 text-[10px] font-medium">بانتظار توزيع ساعات التدريس المشترك</div>
        </>
      ) : (
        <>
          <DataLine label="المسند" value={hourText(row.assigned)} />
          <DataLine label="العجز" value={hourText(row.shortage)} strong />
          {coverage !== null && (
            <div className="pt-0.5 text-[10px] text-muted-foreground">
              نسبة التغطية: {coverage}%
            </div>
          )}
        </>
      )}
      {row.allocation_status && (
        <div className="text-[10px] text-muted-foreground">{valueText(row.allocation_status)}</div>
      )}
    </div>
  );
}

function academicTableColumns(kind: AcademicReportKind): ReportColumn<AcademicReportRow>[] {
  const index: ReportColumn<AcademicReportRow> = {
    key: "__row",
    label: "م",
    numeric: true,
    sortable: false,
    className: "w-10",
    render: (_row, index) => index + 1,
  };

  if (kind === "workload" || kind === "overload" || kind === "deficit") {
    return [
      index,
      {
        key: "instructor",
        label: "عضو هيئة التدريس",
        className: "w-[28%]",
        render: (row) => <MemberCell row={row} />,
      },
      {
        key: "required",
        label: "النصاب الأسبوعي",
        className: "w-[21%]",
        render: (row) => <QuotaCell row={row} />,
      },
      {
        key: "assigned",
        label: "العبء المسند",
        className: "w-[20%]",
        render: (row) => <AssignedLoadCell row={row} />,
      },
      {
        key: kind === "deficit" ? "deficit" : kind === "overload" ? "overload" : "status",
        label:
          kind === "overload"
            ? "الساعات الزائدة والحالة"
            : kind === "deficit"
              ? "العجز والحالة"
              : "الرصيد والحالة",
        className: "w-[25%]",
        render: (row) => <BalanceCell row={row} kind={kind} />,
      },
    ];
  }

  if (kind === "assignments") {
    return [
      index,
      {
        key: "program",
        label: "البرنامج والدفعة",
        className: "w-[22%]",
        render: (row) => <ContextCell row={row} />,
      },
      { key: "course", label: "المقرر", className: "w-[22%]" },
      {
        key: "group",
        label: "المجموعة / النوع",
        className: "w-[15%]",
        render: (row) => <GroupCell row={row} />,
      },
      {
        key: "instructor",
        label: "عضو هيئة التدريس",
        className: "w-[18%]",
        render: (row) => (
          <div className="min-w-[130px] leading-5">
            <div className="font-semibold">{valueText(row.instructor)}</div>
            {row.employee_number && row.employee_number !== "—" && (
              <div className="text-[10px] tabular-nums text-muted-foreground">
                {valueText(row.employee_number)}
              </div>
            )}
          </div>
        ),
      },
      {
        key: "assigned",
        label: "الساعات",
        className: "w-[13%]",
        render: (row) => <AssignmentHoursCell row={row} />,
      },
      { key: "note", label: "ملاحظة", className: "w-[15%]" },
    ];
  }

  return [
    index,
    {
      key: "program",
      label: "البرنامج والدفعة",
      className: "w-[22%]",
      render: (row) => <ContextCell row={row} />,
    },
    { key: "course", label: "المقرر", className: "w-[22%]" },
    {
      key: "group",
      label: "المجموعة / النوع",
      className: "w-[16%]",
      render: (row) => <GroupCell row={row} />,
    },
    {
      key: "shortage",
      label: "تغطية الإسناد",
      className: "w-[18%]",
      render: (row) => <CoverageCell row={row} />,
    },
    {
      key: "instructors",
      label: "المكلفون حاليًا",
      className: "w-[20%]",
      render: (row) => (
        <div className="leading-5">
          <div>{valueText(row.instructors)}</div>
          {row.note && (
            <div className="mt-1 text-[10px] text-muted-foreground">{valueText(row.note)}</div>
          )}
        </div>
      ),
    },
  ];
}

function AcademicReports({ collegeId, collegeName }: { collegeId: string; collegeName: string }) {
  const kind = Route.useSearch().report ?? "workload";
  const navigate = Route.useNavigate();
  const setKind = (value: AcademicReportKind) => {
    setLoadStatus("all");
    void navigate({ search: { report: value, termId: chosenTerm || undefined } });
  };
  const workloadReport = isWorkloadReport(kind);
  const separateBalance = kind === "overload" || kind === "deficit";
  const [chosenTerm, setChosenTerm] = useState(Route.useSearch().termId ?? "");
  const [departmentId, setDepartmentId] = useState("all");
  const [programId, setProgramId] = useState("all");
  const [instructorId, setInstructorId] = useState("all");
  const [loadStatus, setLoadStatus] = useState("all");
  const [search, setSearch] = useState("");

  const references = useQuery({
    queryKey: ["academic-affairs-references", collegeId],
    queryFn: async () => {
      const [terms, departments, programs, instructors] = await Promise.all([
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
      ]);
      return { terms, departments, programs, instructors };
    },
  });
  const refs = references.data;
  const termId = refs?.terms.some((t) => t.id === chosenTerm)
    ? chosenTerm
    : (refs?.terms[0]?.id ?? "");
  const term = refs?.terms.find((t) => t.id === termId);
  const report = useQuery({
    queryKey: ["academic-affairs-data", collegeId, termId, workloadReport, refs?.instructors],
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
        const instructors = refs!.instructors;
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
        }
      : null;
  const sourceRows = input ? buildAcademicReport(input, workloadReport ? "workload" : kind) : [];
  const allRows = selectWorkloadReportRows(sourceRows, kind);
  const incompleteMembers = summarizeWorkloadRows(
    filterRowsBySearch(workloadReport ? sourceRows : [], search),
  ).incompleteMembers;
  const statusRows =
    kind === "workload" && loadStatus !== "all"
      ? allRows.filter((r) =>
          loadStatus === "missing"
            ? isMissingQuotaRow(r)
            : loadStatus === "overload"
              ? Number(r.overload) > 0
              : Number(r.deficit) > 0,
        )
      : allRows;

  // Search only hides rows in the view; exported keys and values stay identical.
  const rows = filterRowsBySearch(statusRows, search);
  // Totals are recomputed from the visible rows, so KPIs always match the table and the export.
  const workloadTotals = summarizeWorkloadRows(workloadReport ? rows : []);
  const headers = ACADEMIC_REPORT_HEADERS[kind];

  const programs =
    refs?.programs.filter((p) => departmentId === "all" || p.department_id === departmentId) ?? [];
  const filterSummary = [
    `الكلية: ${collegeName}`,
    `الفصل: ${term?.name ?? "غير محدد"}`,
    `القسم: ${refs?.departments.find((d) => d.id === departmentId)?.name ?? "الكل"}`,
    `البرنامج: ${refs?.programs.find((p) => p.id === programId)?.name ?? "الكل"}`,
    `عضو هيئة التدريس: ${refs?.instructors.find((i) => i.id === instructorId)?.full_name ?? "الكل"}`,
    search.trim() ? `بحث: ${search.trim()}` : "",
    kind === "workload"
      ? `الحالة: ${loadStatus === "overload" ? "ساعات زائدة" : loadStatus === "deficit" ? "نقص النصاب" : loadStatus === "missing" ? "بلا نصاب معتمد" : "الكل"}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <ReportShell
      title={ACADEMIC_REPORT_TITLES[kind]}
      description="تقارير الشؤون الأكاديمية بحسب الكلية والقسم والبرنامج وعضو هيئة التدريس."
      filename={`academic_affairs_${kind}_${collegeName}_${term?.name ?? ""}`}
      printOrientation="landscape"
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
        separateBalance && !loading && !error && termId ? (
          <Card className="p-4 text-sm leading-7" data-testid="balance-report-summary">
            {`عدد أعضاء هيئة التدريس: ${rows.length} · ${kind === "overload" ? "إجمالي الساعات الزائدة" : "إجمالي ساعات العجز"}: ${kind === "overload" ? workloadTotals.overloadHours : workloadTotals.deficitHours} ساعة أسبوعيًا · صافي النصاب: ${workloadTotals.netQuotaHours} ساعة · الساعات المسندة: ${workloadTotals.assignedHours} ساعة.`}
          </Card>
        ) : undefined
      }
      kpis={
        separateBalance
          ? [
              { label: "أعضاء هيئة التدريس", value: rows.length },
              {
                label: kind === "overload" ? "إجمالي الساعات الزائدة" : "إجمالي ساعات العجز",
                value:
                  kind === "overload" ? workloadTotals.overloadHours : workloadTotals.deficitHours,
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
            placeholder: "ابحث في نتائج التقرير…",
          }}
          activeSummary={filterSummary.split(" · ")}
          onClear={() => {
            setDepartmentId("all");
            setProgramId("all");
            setInstructorId("all");
            setLoadStatus("all");
            setSearch("");
          }}
          basic={
            <>
              <Filter
                label="نوع التقرير"
                value={kind}
                onChange={(v) => setKind(v as AcademicReportKind)}
                items={Object.entries(ACADEMIC_REPORT_TITLES).map(([id, name]) => ({
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
                  ...(refs?.instructors.map((i) => ({
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
              يُعتمد النصاب المسجَّل في بطاقة عضو هيئة التدريس، وتُستخدم سياسة الرتبة عند غيابه. النصاب
              الفعلي = النصاب الأساسي − ساعات الإعفاء الإداري. تُسمح بساعات زائدة لا تتجاوز 12 ساعة
              أسبوعيًا، وتُقارَن به الساعات المسندة في الكلية خلال الفصل، مع إظهار إشراف المشاريع
              منفصلاً. عند عدم وجود نصاب معتمد تظهر «غير محدد» في النصاب والزيادة والنقص، ولا تُعامل
              كصفر ولا تدخل في المجاميع.
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
              الحساب أسبوعي ضمن الكلية والفصل المختارين؛ تصفية البرنامج تختار الأعضاء وتحافظ على
              كامل عبئهم في الكلية.
            </Card>
          )}
          {kind === "shortages" && (
            <Card className="p-3 text-sm">
              عجز الإسناد هو ساعات مجموعات التدريس النشطة التي لم تُستكمل تغطيتها؛ وهو مستقل عن نقص
              نصاب عضو هيئة التدريس.
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
