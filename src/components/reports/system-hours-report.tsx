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
  const rows =
    !error && !loading && termId
      ? filterRowsBySearch(buildSystemHoursRows(report.data ?? [], kind, system), search)
      : [];
  const headers = systemHoursHeaders(kind, system);
  const total =
    Math.round(rows.reduce((n, r) => n + (typeof r.total === "number" ? r.total : 0), 0) * 100) /
    100;
  const incomplete = rows.filter((r) => r.status !== "مكتمل").length;
  const title =
    kind === "contractual" ? "الساعات التعاقدية بحسب النظام" : "الساعات الزائدة بحسب النظام";
  const filename = `${title} — ${collegeName} — ${termName} — ${labels[system]}`;
  const scope =
    kind === "contractual"
      ? "ساعات المتعاقدين في الكلية الحالية، بما فيها المحاضرون من كليات أخرى"
      : "أعضاء الكلية الأصلية؛ عبؤهم على مستوى الجامعة في الفصل المناظر";
  const summary = `${collegeName} · ${termName} · النظام: ${labels[system]} · ${scope}${search.trim() ? ` · بحث: ${search.trim()}` : ""}`;
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
      kpis={[
        { label: "المحاضرون", value: rows.length },
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
          activeSummary={[labels[system], termName]}
          onClear={() => {
            setSearch("");
            setSystem("all");
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
          {incomplete > 0 && (
            <p role="status">
              توجد بيانات غير مكتملة؛ العلامة «—» تعني أن الساعات لم تُحسم. لا تدخل القيم غير
              المحسومة في الإجمالي، وتظهر الساعات التي لم يحدد نظامها منفصلة.
            </p>
          )}
        </Card>
      }
    >
      <ReportSection title={title} count={rows.length} bodyClassName="p-0">
        <ReportDataTable
          rows={rows}
          caption={title}
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
