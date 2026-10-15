import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { ReportShell } from "@/components/reports/report-shell";
import { ReportFilterBar, ReportFilterField } from "@/components/reports/report-filter-bar";
import { ReportSection, ReportDataTable } from "@/components/reports/report-section";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchAcademicTerms } from "@/lib/reports/queries/version-queries";
import { filterRowsBySearch } from "@/lib/reports/search";
import {
  buildSystemHoursRows,
  buildSystemHoursRankRows,
  systemHoursRankHeaders,
  systemHoursRankLabel,
  ALL_SYSTEM_HOURS_RANKS,
  parseSystemHours,
  systemHoursHeaders,
  type SystemHoursKind,
  type SystemHoursFilter,
} from "@/lib/reports/system-hours";

type Api = {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
    Functions: {
      get_system_hours_report: {
        Args: { p_college_id: string; p_term_id: string; p_kind: string };
        Returns: unknown;
      };
    };
  };
};
const client = supabase as unknown as SupabaseClient<Api>;
const labels = { all: "العام والموازي", regular: "العام", parallel: "الموازي" };

export function SystemHoursReport({
  collegeId,
  collegeName,
  kind,
  initialTermId,
}: {
  collegeId: string;
  collegeName: string;
  kind: SystemHoursKind;
  initialTermId?: string;
}) {
  const [chosenTerm, setTerm] = useState(initialTermId ?? "");
  const [system, setSystem] = useState<SystemHoursFilter>("all");
  const [search, setSearch] = useState("");
  const [view, setView] = useState("ranks");
  const [rankFilter, setRankFilter] = useState(ALL_SYSTEM_HOURS_RANKS);
  const terms = useQuery({
    queryKey: ["system-hours-terms", collegeId],
    queryFn: () => fetchAcademicTerms(collegeId),
  });
  const termId = terms.data?.some((t) => t.id === chosenTerm)
    ? chosenTerm
    : (terms.data?.[0]?.id ?? "");
  const termName = terms.data?.find((t) => t.id === termId)?.name ?? "";
  const report = useQuery({
    queryKey: ["system-hours", collegeId, termId, kind],
    enabled: !!termId && !terms.error,
    queryFn: async () => {
      const { data, error } = await client.rpc("get_system_hours_report", {
        p_college_id: collegeId,
        p_term_id: termId,
        p_kind: kind,
      });
      if (error) throw new Error(error.message);
      return parseSystemHours(data, { collegeId, termId, kind });
    },
  });
  const error = terms.error ?? report.error;
  const loading = terms.isFetching || report.isFetching;
  const ranks = [...new Set((report.data ?? []).map((row) => systemHoursRankLabel(row.rank)))].sort(
    (a, b) => a.localeCompare(b, "ar"),
  );
  const rank = ranks.includes(rankFilter) ? rankFilter : ALL_SYSTEM_HOURS_RANKS;
  const lecturerRows =
    !error && !loading && termId
      ? filterRowsBySearch(
          buildSystemHoursRows(report.data ?? [], kind, system).filter(
            (row) =>
              kind !== "contractual" ||
              rank === ALL_SYSTEM_HOURS_RANKS ||
              systemHoursRankLabel(row.rank) === rank,
          ),
          search,
        )
      : [];
  const byRank = kind === "contractual" && view === "ranks";
  const rows = byRank ? buildSystemHoursRankRows(lecturerRows) : lecturerRows;
  const headers = byRank ? systemHoursRankHeaders(system) : systemHoursHeaders(kind, system);
  const viewLabel = byRank ? "ملخص بحسب الرتبة العلمية" : "تفصيل المحاضرين";
  const total =
    Math.round(
      lecturerRows.reduce((n, r) => n + (typeof r.total === "number" ? r.total : 0), 0) * 100,
    ) / 100;
  const incomplete = lecturerRows.filter((r) => r.status !== "مكتمل").length;
  const title =
    kind === "contractual" ? "الساعات التعاقدية بحسب النظام" : "الساعات الزائدة بحسب النظام";
  const rankSummary =
    kind === "contractual"
      ? ` · ${viewLabel} · الرتبة العلمية: ${rank === ALL_SYSTEM_HOURS_RANKS ? "الكل" : rank}`
      : "";
  const filename = `${title} — ${collegeName} — ${termName} — ${labels[system]}${rankSummary}`;
  const scope =
    kind === "contractual"
      ? "ساعات المتعاقدين في الكلية الحالية، بما فيها المحاضرون من كليات أخرى"
      : "أعضاء الكلية الأصلية؛ عبؤهم على مستوى الجامعة في الفصل المناظر";
  const summary = `${collegeName} · ${termName} · النظام: ${labels[system]} · ${scope}${rankSummary}${search.trim() ? ` · بحث: ${search.trim()}` : ""}`;
  return (
    <ReportShell
      title={title}
      description="ساعات أسبوعية مستندة إلى الإسناد التدريسي الحالي، مع الطباعة وتصدير Excel وCSV."
      filename={filename}
      printFilename={filename}
      headers={headers}
      rows={rows}
      isLoading={loading}
      error={error}
      onRetry={() => {
        void terms.refetch();
        void report.refetch();
      }}
      filterSummary={summary}
      headerMeta={{ termName, note: summary }}
      emptyMessage={
        !termId ? "لا يوجد فصل دراسي متاح لهذه الكلية." : "لا توجد ساعات بهذه المعايير."
      }
      summary={
        !loading && !error && termId ? (
          <Card className="p-4 text-sm leading-7">
            {`عدد المحاضرين: ${lecturerRows.length} · إجمالي الساعات المؤكدة (${labels[system]}): ${total} ساعة أسبوعيًا · سجلات تحتاج استكمالًا: ${incomplete}.`}
          </Card>
        ) : undefined
      }
      kpis={[
        { label: "المحاضرون", value: lecturerRows.length },
        { label: "إجمالي الساعات المؤكدة أسبوعيًا", value: total },
        { label: "بيانات تحتاج استكمالًا", value: incomplete },
      ]}
      filters={
        <ReportFilterBar
          search={{
            value: search,
            onChange: setSearch,
            placeholder: "ابحث باسم المحاضر أو رقمه الجامعي…",
          }}
          activeSummary={[
            labels[system],
            termName,
            ...(kind === "contractual"
              ? [viewLabel, rank === ALL_SYSTEM_HOURS_RANKS ? "كل الرتب العلمية" : rank]
              : []),
          ]}
          onClear={() => {
            setSearch("");
            setSystem("all");
            setRankFilter(ALL_SYSTEM_HOURS_RANKS);
            setView("ranks");
          }}
          basic={
            <>
              <ReportFilterField label="الفصل الدراسي">
                <Select value={termId} onValueChange={setTerm}>
                  <SelectTrigger aria-label="الفصل الدراسي">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {terms.data?.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </ReportFilterField>
              {kind === "contractual" && (
                <>
                  <ReportFilterField label="طريقة العرض">
                    <Select value={view} onValueChange={setView}>
                      <SelectTrigger aria-label="طريقة العرض">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ranks">ملخص بحسب الرتبة العلمية</SelectItem>
                        <SelectItem value="lecturers">تفصيل المحاضرين</SelectItem>
                      </SelectContent>
                    </Select>
                  </ReportFilterField>
                  <ReportFilterField label="الرتبة العلمية">
                    <Select value={rank} onValueChange={setRankFilter}>
                      <SelectTrigger aria-label="الرتبة العلمية">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALL_SYSTEM_HOURS_RANKS}>الكل</SelectItem>
                        {ranks.map((value) => (
                          <SelectItem key={value} value={value}>
                            {value}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </ReportFilterField>
                </>
              )}
              <ReportFilterField label="النظام">
                <Select value={system} onValueChange={(v) => setSystem(v as SystemHoursFilter)}>
                  <SelectTrigger aria-label="النظام">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(labels).map(([id, label]) => (
                      <SelectItem key={id} value={id}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </ReportFilterField>
            </>
          }
        />
      }
      leading={
        <Card className="p-4 text-sm leading-7">
          {kind === "overload_system"
            ? "يُخصم صافي النصاب مرة واحدة: من العام أولًا، ثم يُستكمل من الموازي، وما تبقى يُعرض زائدًا بحسب النظام. المتعاقدون بالساعات لهم تقرير مستقل."
            : "يعرض ساعات التدريس للمتعاقدين بالساعات دون خصم نصاب، في الكلية والفصل المختارين."}
          <p>
            تُحتسب المحاضرة المدمجة مرة واحدة وفق إسناد المجموعة الأساسية. إشراف المشاريع المستثنى
            من النصاب لا يدخل في هذه الساعات. التقرير أسبوعي للإسناد، وليس كشف مستحقات مالية أو
            ساعات منفذة فعليًا.
          </p>
          <Link
            to="/reports/academic-affairs"
            search={{ report: "coverage", termId }}
            className="report-no-print block underline"
          >
            مصادر تغطية الساعات التدريسية
          </Link>
          {incomplete > 0 && (
            <p role="status">
              توجد بيانات غير مكتملة؛ العلامة «—» تعني أن الساعات لم تُحسم. لا تدخل القيم غير
              المحسومة في الإجمالي، وتظهر الساعات التي لم يحدد نظامها منفصلة.
            </p>
          )}
        </Card>
      }
    >
      <ReportSection
        title={kind === "contractual" ? viewLabel : title}
        count={rows.length}
        bodyClassName="p-0"
      >
        <ReportDataTable
          rows={rows}
          caption={`${title}${kind === "contractual" ? ` — ${viewLabel}` : ""}`}
          columns={headers.map((h) => ({
            ...h,
            numeric: !["instructor", "university_number", "rank", "status"].includes(h.key),
          }))}
          primaryColumnLimit={headers.length}
          minWidthClassName="min-w-[900px]"
        />
      </ReportSection>
    </ReportShell>
  );
}
