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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
        filters={
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">نسخة الجدول</label>
              <Select value={effectiveVersion || undefined} onValueChange={setVersionId}>
                <SelectTrigger>
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
            </div>
            <div className="text-xs text-muted-foreground flex flex-col justify-end gap-1">
              <Link className="underline" to="/schedule-quality">
                تشغيل محرك الجودة (كتابة)
              </Link>
              <Link className="underline" to="/reports/conflicts">
                تقرير التعارضات
              </Link>
            </div>
          </div>
        }
      >
        {report && (
          <div className="space-y-4 print:space-y-2">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Kpi label="الدرجة" value={`${report.total_score}/100`} />
              <Kpi
                label="التصنيف"
                value={report.classification}
                badge={SEVERITY_VARIANT[report.classification]}
              />
              <Kpi label="جلسات" value={String(report.session_count)} />
              <Kpi label="تعارضات" value={String(report.hard_conflicts)} />
              <Kpi label="غير مجدول" value={String(report.unscheduled_count)} />
              <Kpi label="فجوات دفعات" value={String(report.cohort_gaps)} />
              <Kpi label="فجوات محاضر" value={String(report.instructor_gaps)} />
              <Kpi label="حمل يومي زائد" value={String(report.excessive_daily_load)} />
              <Kpi label="متتالية طويلة" value={String(report.long_consecutive)} />
              <Kpi label="إفراط قاعة" value={String(report.room_overuse)} />
              <Kpi label="سعة" value={String(report.capacity_violations)} />
              <Kpi label="تغطية ساعات %" value={String(report.hours_coverage_pct)} />
            </div>

            {report.baseline_delta && (
              <Card className="p-3 text-sm">
                مقارنة بآخر quality run مخزّن: درجة{" "}
                {report.baseline_delta.score_delta >= 0 ? "+" : ""}
                {report.baseline_delta.score_delta} · تعارضات{" "}
                {report.baseline_delta.hard_delta >= 0 ? "+" : ""}
                {report.baseline_delta.hard_delta}
              </Card>
            )}

            <Card className="p-0 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    {headers.map((h) => (
                      <TableHead key={h.key}>{h.label}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.findings.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={headers.length}>
                        لا توجد ملاحظات — ACCEPTABLE ضمن العتبات المحلية.
                      </TableCell>
                    </TableRow>
                  ) : (
                    report.findings.map((f) => (
                      <TableRow key={f.code}>
                        <TableCell>
                          <Badge variant={SEVERITY_VARIANT[f.severity]}>{f.severity}</Badge>
                        </TableCell>
                        <TableCell>{f.title_ar}</TableCell>
                        <TableCell>{f.count}</TableCell>
                        <TableCell>{f.deduction}</TableCell>
                        <TableCell className="text-xs font-mono">{f.formula}</TableCell>
                        <TableCell className="text-xs">{f.detail_ar}</TableCell>
                        <TableCell className="text-xs">{f.link_hint}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </Card>

            <EntityTable title="جودة الدفعات" rows={report.cohort_rows} />
            <EntityTable title="جودة المحاضرين" rows={report.instructor_rows} />
            <EntityTable title="جودة القاعات" rows={report.room_rows} />

            <Card className="p-3 text-xs text-muted-foreground print:block">
              ملخص طباعة مختصر · تباين توازن القاعات = {report.room_balance_variance} · توزيع
              الأيام:{" "}
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

function Kpi({
  label,
  value,
  badge,
}: {
  label: string;
  value: string;
  badge?: "destructive" | "secondary" | "outline" | "default";
}) {
  return (
    <Card className="p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">
        {badge ? <Badge variant={badge}>{value}</Badge> : value}
      </div>
    </Card>
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
    <Card className="p-3">
      <div className="mb-2 font-medium">{title}</div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>الكيان</TableHead>
            <TableHead>النظام</TableHead>
            <TableHead>جلسات</TableHead>
            <TableHead>ساعات</TableHead>
            <TableHead>ملاحظات</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.slice(0, 40).map((r) => (
            <TableRow key={r.entity_id}>
              <TableCell>{r.label}</TableCell>
              <TableCell>{r.study_system}</TableCell>
              <TableCell>{r.session_count}</TableCell>
              <TableCell>{r.hours}</TableCell>
              <TableCell className="text-xs">{r.findings.join(", ") || "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
