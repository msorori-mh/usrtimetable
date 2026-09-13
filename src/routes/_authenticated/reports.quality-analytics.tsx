import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCollege } from "@/hooks/use-colleges";
import { ReportShell } from "@/components/reports/report-shell";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ReportFilterBar, ReportFilterField } from "@/components/reports/report-filter-bar";
import {
  ReportSection,
  ReportDataTable,
  ReportDisclosure,
} from "@/components/reports/report-section";
import {
  analyzeScheduleQuality,
  type AnalyticsSession,
  type FindingSeverity,
} from "@/lib/schedule-quality-analytics";

export const Route = createFileRoute("/_authenticated/reports/quality-analytics")({
  head: () => ({ meta: [{ title: "مركز تحليل جودة الجدول" }] }),
  component: QualityAnalyticsPage,
});

const SEVERITY_VARIANT: Record<
  FindingSeverity,
  "destructive" | "secondary" | "outline" | "default"
> = {
  CRITICAL: "destructive",
  MAJOR: "secondary",
  MINOR: "outline",
  ACCEPTABLE: "default",
};

function QualityAnalyticsPage() {
  const { active } = useActiveCollege();
  const [versionId, setVersionId] = useState<string>("");

  const { data: versions } = useQuery({
    queryKey: ["qa-versions", active?.id],
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

  const effectiveVersion =
    versionId || versions?.find((v) => v.status === "published")?.id || versions?.[0]?.id || "";

  const { data: sessions, isLoading } = useQuery({
    queryKey: ["qa-sessions", active?.id, effectiveVersion],
    enabled: !!active && !!effectiveVersion,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("schedule_sessions")
        .select(
          "id, college_id, schedule_version_id, instructor_id, room_id, cohort_id, delivery_group_id, study_system, day_of_week, start_time, end_time, expected_students, session_type",
        )
        .eq("college_id", active!.id)
        .eq("schedule_version_id", effectiveVersion)
        .order("id");
      if (error) throw error;
      return (data ?? []) as AnalyticsSession[];
    },
  });

  const { data: rooms } = useQuery({
    queryKey: ["qa-rooms", active?.id],
    enabled: !!active,
    queryFn: async () =>
      (
        await supabase
          .from("rooms")
          .select("id, capacity, room_type_id, name")
          .eq("college_id", active!.id)
      ).data ?? [],
  });

  const { data: latestStored } = useQuery({
    queryKey: ["qa-baseline-run", active?.id, effectiveVersion],
    enabled: !!active && !!effectiveVersion,
    queryFn: async () => {
      const { data } = await supabase
        .from("schedule_quality_runs")
        .select("total_score, hard_conflicts_count, soft_conflicts_count, created_at")
        .eq("college_id", active!.id)
        .eq("schedule_version_id", effectiveVersion)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  const report = useMemo(() => {
    if (!sessions) return null;
    return analyzeScheduleQuality({
      sessions,
      rooms: rooms ?? [],
      collegeId: active?.id,
      baseline: latestStored
        ? {
            total_score: Number(latestStored.total_score),
            hard_conflicts: Number(latestStored.hard_conflicts_count),
            unscheduled_count: 0,
          }
        : null,
    });
  }, [sessions, rooms, active?.id, latestStored]);

  const exportRows = useMemo(() => {
    if (!report) return [];
    return report.findings.map((f) => ({
      code: f.code,
      severity: f.severity,
      title: f.title_ar,
      count: f.count,
      deduction: f.deduction,
      formula: f.formula,
      detail: f.detail_ar,
      link: f.link_hint,
    }));
  }, [report]);

  const headers = [
    { key: "severity", label: "التصنيف" },
    { key: "title", label: "المؤشر" },
    { key: "count", label: "العدد" },
    { key: "deduction", label: "الخصم" },
    { key: "formula", label: "الصيغة" },
    { key: "detail", label: "التفصيل" },
    { key: "link", label: "رابط" },
  ];

  return (
    <div dir="rtl">
      <ReportShell
        title="مركز تحليل جودة الجدول"
        description="تحليل تفسيري للقراءة فقط — لا يشغّل المجدول ولا يكتب جلسات."
        filename="quality_analytics"
        rows={exportRows}
        headers={headers}
        isLoading={isLoading}
        error={undefined}
        emptyMessage="لا توجد جلسات في هذه النسخة لتحليلها."
        kpis={
          report
            ? [
                { label: "الدرجة", value: `${report.total_score}/100` },
                { label: "التصنيف", value: report.classification },
                { label: "جلسات", value: report.session_count },
                {
                  label: "تعارضات",
                  value: report.hard_conflicts,
                  tone: report.hard_conflicts > 0 ? ("danger" as const) : ("success" as const),
                },
                { label: "تغطية ساعات %", value: report.hours_coverage_pct },
              ]
            : undefined
        }
        filters={
          <ReportFilterBar
            activeSummary={[
              `النسخة: ${(versions ?? []).find((v) => v.id === effectiveVersion)?.name ?? "—"}`,
            ]}
            basic={
              <>
                <ReportFilterField label="نسخة الجدول">
                  <Select value={effectiveVersion || undefined} onValueChange={setVersionId}>
                    <SelectTrigger aria-label="نسخة الجدول">
                      <SelectValue placeholder="اختر نسخة" />
                    </SelectTrigger>
                    <SelectContent>
                      {(versions ?? []).map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          {v.name} ({v.status})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </ReportFilterField>
                <div className="report-no-print flex flex-col justify-end gap-1 text-xs text-muted-foreground">
                  <Link className="underline" to="/schedule-quality">
                    تشغيل محرك الجودة (كتابة)
                  </Link>
                  <Link className="underline" to="/reports/conflicts">
                    تقرير التعارضات
                  </Link>
                </div>
              </>
            }
          />
        }
      >
        {report && (
          <div className="space-y-4 print:space-y-2">
            {report.baseline_delta && (
              <Card className="p-3 text-sm">
                مقارنة بآخر quality run مخزّن: درجة{" "}
                {report.baseline_delta.score_delta >= 0 ? "+" : ""}
                {report.baseline_delta.score_delta} · تعارضات{" "}
                {report.baseline_delta.hard_delta >= 0 ? "+" : ""}
                {report.baseline_delta.hard_delta}
              </Card>
            )}

            <ReportSection
              title="ملاحظات الجودة"
              count={report.findings.length}
              hint="كل ملاحظة تعرض الصيغة والخصم ومصدر المعالجة."
              bodyClassName="p-0"
            >
              {report.findings.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">
                  لا توجد ملاحظات — ACCEPTABLE ضمن العتبات المحلية.
                </p>
              ) : (
                <ReportDataTable
                  rows={report.findings}
                  rowKey={(f) => f.code}
                  caption="ملاحظات جودة الجدول"
                  columns={[
                    {
                      key: "severity",
                      label: "التصنيف",
                      render: (f) => (
                        <Badge variant={SEVERITY_VARIANT[f.severity]}>{f.severity}</Badge>
                      ),
                    },
                    { key: "title_ar", label: "المؤشر" },
                    { key: "count", label: "العدد", numeric: true },
                    { key: "deduction", label: "الخصم", numeric: true },
                    {
                      key: "formula",
                      label: "الصيغة",
                      secondary: true,
                      className: "text-xs font-mono",
                    },
                    { key: "detail_ar", label: "التفصيل", secondary: true, className: "text-xs" },
                    { key: "link_hint", label: "رابط", secondary: true, className: "text-xs" },
                  ]}
                />
              )}
            </ReportSection>

            <ReportSection title="مؤشرات تفصيلية" bodyClassName="p-4">
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <Metric label="غير مجدول" value={report.unscheduled_count} />
                <Metric label="فجوات دفعات" value={report.cohort_gaps} />
                <Metric label="فجوات محاضر" value={report.instructor_gaps} />
                <Metric label="حمل يومي زائد" value={report.excessive_daily_load} />
                <Metric label="متتالية طويلة" value={report.long_consecutive} />
                <Metric label="إفراط قاعة" value={report.room_overuse} />
                <Metric label="سعة" value={report.capacity_violations} />
                <Metric label="تباين توازن القاعات" value={report.room_balance_variance} />
              </div>
            </ReportSection>

            <EntityTable title="جودة الدفعات" rows={report.cohort_rows} />
            <EntityTable title="جودة المحاضرين" rows={report.instructor_rows} />
            <EntityTable title="جودة القاعات" rows={report.room_rows} />

            <Card className="p-3 text-xs text-muted-foreground print:block">
              ملخص طباعة مختصر · توزيع الأيام:{" "}
              {Object.entries(report.day_distribution)
                .sort(([a], [b]) => Number(a) - Number(b))
                .map(([d, c]) => `${d}:${c}`)
                .join(" · ") || "—"}
            </Card>
          </div>
        )}
      </ReportShell>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="min-w-0 rounded-md border border-border/60 p-3">
      <div className="truncate text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-base font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function EntityTable({
  title,
  rows,
}: {
  title: string;
  rows: {
    entity_id: string;
    label: string;
    study_system: string;
    session_count: number;
    hours: number;
    findings: string[];
  }[];
}) {
  return (
    <ReportSection title={title} count={rows.length} bodyClassName="p-3">
      <ReportDisclosure label="عرض التفاصيل">
        <ReportDataTable
          rows={rows.slice(0, 40)}
          rowKey={(r) => r.entity_id}
          caption={title}
          columns={[
            { key: "label", label: "الكيان" },
            { key: "study_system", label: "النظام" },
            { key: "session_count", label: "جلسات", numeric: true },
            { key: "hours", label: "ساعات", numeric: true },
            {
              key: "findings",
              label: "ملاحظات",
              secondary: true,
              className: "text-xs",
              render: (r) => r.findings.join(", ") || "—",
            },
          ]}
        />
      </ReportDisclosure>
    </ReportSection>
  );
}
