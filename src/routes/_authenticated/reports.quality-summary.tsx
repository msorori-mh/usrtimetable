import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCollege } from "@/hooks/use-colleges";
import { ReportShell } from "@/components/reports/report-shell";
import { ReportFilterBar, ReportFilterField } from "@/components/reports/report-filter-bar";
import { ReportSection, ReportDataTable } from "@/components/reports/report-section";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { filterRowsBySearch } from "@/lib/reports/search";

export const Route = createFileRoute("/_authenticated/reports/quality-summary")({
  head: () => ({ meta: [{ title: "تقرير ملخّص الجودة" }] }),
  component: Page,
});

function Page() {
  const { active } = useActiveCollege();
  const [versionId, setVersionId] = useState<string>("all");
  const [search, setSearch] = useState("");

  const { data: versions, error: versionsError } = useQuery({
    queryKey: ["qs-vers", active?.id],
    enabled: !!active,
    queryFn: async () =>
      (
        await supabase
          .from("schedule_versions")
          .select("id, name, status")
          .eq("college_id", active!.id)
          .order("created_at", { ascending: false })
      ).data ?? [],
  });

  const {
    data: runs,
    isLoading,
    error: runsError,
    refetch,
  } = useQuery({
    queryKey: ["qs-runs", active?.id, versionId],
    enabled: !!active,
    queryFn: async () => {
      let q = supabase
        .from("schedule_quality_runs")
        .select(
          "id, schedule_version_id, total_score, hard_conflicts_count, soft_conflicts_count, total_deductions, metrics_breakdown, created_at",
        )
        .eq("college_id", active!.id)
        .order("created_at", { ascending: false });
      if (versionId !== "all") q = q.eq("schedule_version_id", versionId);
      return (await q).data ?? [];
    },
  });

  const latestByVersion = useMemo(() => {
    type Run = NonNullable<typeof runs>[number];
    const m = new Map<string, Run>();
    for (const r of runs ?? []) {
      if (!m.has(r.schedule_version_id)) m.set(r.schedule_version_id, r);
    }
    return Array.from(m.values());
  }, [runs]);

  const verName = (id: string) => (versions ?? []).find((v) => v.id === id)?.name ?? "—";

  const allRows = useMemo(
    () =>
      latestByVersion.map((r) => ({
        version: verName(r.schedule_version_id),
        total_score: r.total_score,
        hard: r.hard_conflicts_count,
        soft: r.soft_conflicts_count,
        deductions: r.total_deductions,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        breakdown: Object.entries((r.metrics_breakdown as Record<string, any>) ?? {})
          .map(([k, v]) => `${k}:${v.deduction ?? v}`)
          .join(" | "),
        date: new Date(r.created_at as string).toLocaleString("ar"),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [latestByVersion, versions],
  );

  // Search is presentation-only: same keys, same computed values, fewer visible rows.
  const rows = useMemo(() => filterRowsBySearch(allRows, search), [allRows, search]);

  const headers = [
    { key: "version", label: "النسخة" },
    { key: "total_score", label: "الدرجة /100" },
    { key: "hard", label: "إلزامية" },
    { key: "soft", label: "مرنة" },
    { key: "deductions", label: "إجمالي الخصم" },
    { key: "breakdown", label: "تفصيل المقاييس" },
    { key: "date", label: "التاريخ" },
  ];

  const totalHard = rows.reduce((s, r) => s + Number(r.hard ?? 0), 0);
  const totalSoft = rows.reduce((s, r) => s + Number(r.soft ?? 0), 0);
  const avgScore = rows.length
    ? Math.round(rows.reduce((s, r) => s + Number(r.total_score ?? 0), 0) / rows.length)
    : 0;

  const versionLabel = versionId === "all" ? "الكل" : verName(versionId);

  return (
    <ReportShell
      title="تقرير ملخّص الجودة"
      description="آخر نتيجة جودة لكل نسخة جدول — قراءة فقط دون تشغيل محرك الجودة."
      filename="quality_summary"
      rows={rows}
      headers={headers}
      isLoading={isLoading}
      error={runsError ?? versionsError}
      onRetry={() => void refetch()}
      emptyMessage={search ? "لا نتائج مطابقة للبحث." : "لا توجد نتائج جودة محفوظة لهذه المعايير."}
      kpis={[
        { label: "نسخ مقيَّمة", value: rows.length },
        { label: "متوسط الدرجة", value: `${avgScore}/100`, tone: "accent" },
        {
          label: "تعارضات إلزامية",
          value: totalHard,
          tone: totalHard > 0 ? "danger" : "neutral",
        },
        { label: "تعارضات مرنة", value: totalSoft, tone: totalSoft > 0 ? "warning" : "neutral" },
      ]}
      filters={
        <ReportFilterBar
          search={{
            value: search,
            onChange: setSearch,
            placeholder: "ابحث باسم النسخة أو المقاييس…",
          }}
          activeSummary={[`النسخة: ${versionLabel}`]}
          onClear={() => {
            setVersionId("all");
            setSearch("");
          }}
          basic={
            <ReportFilterField label="النسخة" htmlFor="qs-version">
              <Select value={versionId} onValueChange={setVersionId}>
                <SelectTrigger id="qs-version" aria-label="النسخة">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {(versions ?? []).map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </ReportFilterField>
          }
        />
      }
    >
      <ReportSection
        title="نتائج الجودة لكل نسخة"
        count={rows.length}
        hint="آخر تشغيل محفوظ لكل نسخة — تفصيل المقاييس معروض في العمود الأخير."
        bodyClassName="p-0"
      >
        <ReportDataTable
          columns={[
            { key: "version", label: "النسخة" },
            {
              key: "total_score",
              label: "الدرجة /100",
              numeric: true,
              render: (r) => <Badge>{String(r.total_score)}/100</Badge>,
            },
            {
              key: "hard",
              label: "إلزامية",
              numeric: true,
              render: (r) =>
                Number(r.hard) > 0 ? (
                  <Badge variant="destructive">{String(r.hard)}</Badge>
                ) : (
                  String(r.hard)
                ),
            },
            { key: "soft", label: "مرنة", numeric: true },
            { key: "deductions", label: "إجمالي الخصم", numeric: true, secondary: true },
            {
              key: "breakdown",
              label: "تفصيل المقاييس",
              secondary: true,
              className: "text-xs",
            },
            {
              key: "date",
              label: "التاريخ",
              secondary: true,
              className: "text-xs text-muted-foreground whitespace-nowrap",
            },
          ]}
          rows={rows}
          caption="نتائج الجودة لكل نسخة جدول"
        />
      </ReportSection>
    </ReportShell>
  );
}
