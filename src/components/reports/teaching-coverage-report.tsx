import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ReportShell } from "@/components/reports/report-shell";
import { ReportDataTable, ReportSection } from "@/components/reports/report-section";
import { ReportFilterBar } from "@/components/reports/report-filter-bar";
import { fetchAcademicTerms } from "@/lib/reports/queries/version-queries";
import { fetchTeachingCoverage } from "@/lib/reports/fetch-teaching-coverage";
import {
  COVERAGE_LABELS,
  COVERAGE_HEADERS,
  SYSTEM_LABELS,
  coverageDisplayRows,
  summarizeCoverage,
} from "@/lib/reports/teaching-coverage";
import { normalizeSearchText } from "@/lib/reports/search";
export function TeachingCoverageReport({
  collegeId,
  collegeName,
  initialTermId,
}: {
  collegeId: string;
  collegeName: string;
  initialTermId?: string;
}) {
  const [chosenTerm, setTerm] = useState(initialTermId ?? "");
  const [department, setDepartment] = useState("all"),
    [program, setProgram] = useState("all"),
    [system, setSystem] = useState("all"),
    [category, setCategory] = useState("all"),
    [search, setSearch] = useState("");
  const terms = useQuery({
    queryKey: ["system-hours-terms", collegeId],
    queryFn: () => fetchAcademicTerms(collegeId),
  });
  const termId = terms.data?.some((t) => t.id === chosenTerm)
    ? chosenTerm
    : (terms.data?.[0]?.id ?? "");
  const termName = terms.data?.find((t) => t.id === termId)?.name ?? "";
  const report = useQuery({
    queryKey: ["teaching-coverage", collegeId, termId],
    enabled: !!termId && !terms.error,
    queryFn: () => fetchTeachingCoverage(collegeId, termId),
  });
  const loading = terms.isFetching || report.isFetching,
    error = terms.error ?? report.error;
  const facts = !loading && !error ? (report.data ?? []) : [];
  const departments = [
    ...new Map(
      facts.map((r) => [r.department_id ?? "unknown", r.department ?? "غير محدد"]),
    ).entries(),
  ];
  const programs = [
    ...new Map(
      facts
        .filter((r) => department === "all" || (r.department_id ?? "unknown") === department)
        .map((r) => [r.program_id ?? "unknown", r.program ?? "غير محدد"]),
    ).entries(),
  ];
  const filtered = facts.filter(
    (r) =>
      (department === "all" || (r.department_id ?? "unknown") === department) &&
      (program === "all" || (r.program_id ?? "unknown") === program) &&
      (system === "all" || r.study_system === system) &&
      (category === "all" || r.category === category) &&
      normalizeSearchText(`${r.instructor} ${r.university_number ?? ""}`).includes(
        normalizeSearchText(search),
      ),
  );
  const sums = summarizeCoverage(filtered),
    rows = coverageDisplayRows(filtered);
  const summary = [
    collegeName,
    termName,
    SYSTEM_LABELS[system as keyof typeof SYSTEM_LABELS],
    category === "all"
      ? "جميع مصادر التغطية"
      : COVERAGE_LABELS[category as keyof typeof COVERAGE_LABELS],
    departments.find((d) => d[0] === department)?.[1] ?? "كل الأقسام",
    programs.find((p) => p[0] === program)?.[1] ?? "كل البرامج",
    search,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <ReportShell
      title="مصادر تغطية الساعات التدريسية"
      description="توزيع ساعات الإسناد الأسبوعية على المثبتين في الكلية، ومن كليات أخرى، والتعاقد الخارجي."
      filename={`تغطية الساعات — ${summary}`}
      printFilename={`تغطية الساعات — ${collegeName} — ${termName}`}
      rows={rows}
      headers={COVERAGE_HEADERS}
      isLoading={loading}
      error={error}
      onRetry={() => {
        void terms.refetch();
        void report.refetch();
      }}
      filterSummary={summary}
      headerMeta={{ termName, note: summary }}
      emptyMessage={!termId ? "لا يوجد فصل متاح." : "لا توجد ساعات مطابقة للفلاتر."}
      kpis={[
        { label: "من داخل الكلية", value: sums.internal },
        { label: "من كليات أخرى", value: sums.other_college },
        { label: "بتعاقد خارجي", value: sums.contractual },
        { label: "ساعات لم يحسم تصنيفها", value: sums.unknown },
        { label: "إجمالي الساعات المؤكدة", value: sums.total },
        { label: "محاضرون بانتظار توزيع الساعات", value: sums.pendingMembers },
      ]}
      filters={
        <ReportFilterBar
          search={{
            value: search,
            onChange: setSearch,
            placeholder: "اسم المحاضر أو رقمه الجامعي…",
          }}
          onClear={() => {
            setDepartment("all");
            setProgram("all");
            setSystem("all");
            setCategory("all");
            setSearch("");
          }}
          basic={
            <>
              <CoverageSelect
                label="الفصل الدراسي"
                value={termId}
                onChange={(v) => {
                  setTerm(v);
                  setDepartment("all");
                  setProgram("all");
                }}
                items={terms.data?.map((t) => [t.id, t.name]) ?? []}
              />
              <CoverageSelect
                label="مصدر التغطية"
                value={category}
                onChange={setCategory}
                items={[["all", "جميع المصادر"], ...Object.entries(COVERAGE_LABELS)]}
              />
              <CoverageSelect
                label="النظام"
                value={system}
                onChange={setSystem}
                items={Object.entries(SYSTEM_LABELS)}
              />
              <CoverageSelect
                label="القسم"
                value={department}
                onChange={(v) => {
                  setDepartment(v);
                  setProgram("all");
                }}
                items={[["all", "كل الأقسام"], ...departments]}
              />
              <CoverageSelect
                label="البرنامج"
                value={program}
                onChange={setProgram}
                items={[["all", "كل البرامج"], ...programs]}
              />
            </>
          }
        />
      }
      leading={
        <div className="rounded-lg border p-3 text-sm leading-7">
          <p>
            المصدر هو الإسناد التدريسي الحالي. تُحتسب المحاضرة المدمجة مرة واحدة ضمن البرنامج
            الأساسي. التصنيفات متنافية؛ المتعاقد بالساعات يُحسب في التعاقد الخارجي. إشراف المشاريع
            المستثنى من النصاب منفصل. الساعات التي لم يكتمل توزيعها لا تدخل في الإجمالي المؤكد. هذا
            التقرير ليس كشف صرف.
          </p>
          <div className="report-no-print flex flex-wrap gap-4">
            <Link
              to="/reports/academic-affairs"
              search={{ report: "overload_system", termId }}
              className="underline"
            >
              الساعات الزائدة بحسب النظام
            </Link>
            <Link
              to="/reports/academic-affairs"
              search={{ report: "contractual", termId }}
              className="underline"
            >
              الساعات التعاقدية بحسب النظام
            </Link>
            <Link to="/reports/instructors" className="underline">
              دليل المحاضرين وبياناتهم
            </Link>
          </div>
        </div>
      }
    >
      <ReportSection title="تفاصيل التغطية" count={rows.length} bodyClassName="p-0">
        <ReportDataTable
          rows={rows}
          columns={COVERAGE_HEADERS}
          caption="تفاصيل مصادر التغطية"
          primaryColumnLimit={10}
          minWidthClassName="min-w-[1000px]"
        />
      </ReportSection>
    </ReportShell>
  );
}
export function CoverageSelect({
  label,
  value,
  onChange,
  items,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  items: string[][];
}) {
  return (
    <label className="flex min-w-40 flex-col gap-1 text-sm">
      {label}
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 rounded-md border bg-background px-3"
      >
        {items.map(([id, name]) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}
