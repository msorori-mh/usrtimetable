import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCollege } from "@/hooks/use-colleges";
import { ReportShell } from "@/components/reports/report-shell";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/reports/quality-summary")({
  head: () => ({ meta: [{ title: "تقرير ملخّص الجودة" }] }),
  component: Page,
});

function Page() {
  const { active } = useActiveCollege();
  const [versionId, setVersionId] = useState<string>("all");

  const { data: versions } = useQuery({
    queryKey: ["qs-vers", active?.id], enabled: !!active,
    queryFn: async () => (await supabase.from("schedule_versions").select("id, name, status").eq("college_id", active!.id).order("created_at", { ascending: false })).data ?? [],
  });

  const { data: runs, isLoading } = useQuery({
    queryKey: ["qs-runs", active?.id, versionId], enabled: !!active,
    queryFn: async () => {
      let q = supabase.from("schedule_quality_runs")
        .select("id, schedule_version_id, total_score, hard_conflicts_count, soft_conflicts_count, total_deductions, metrics_breakdown, created_at")
        .eq("college_id", active!.id).order("created_at", { ascending: false });
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

  const rows = useMemo(() =>
    latestByVersion.map((r) => ({
      version: verName(r.schedule_version_id),
      total_score: r.total_score,
      hard: r.hard_conflicts_count,
      soft: r.soft_conflicts_count,
      deductions: r.total_deductions,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      breakdown: Object.entries((r.metrics_breakdown as Record<string, any>) ?? {})
        .map(([k, v]) => `${k}:${v.deduction ?? v}`).join(" | "),
      date: new Date(r.created_at as string).toLocaleString("ar"),
    })),
  [latestByVersion, versions]);

  const headers = [
    { key: "version", label: "النسخة" },
    { key: "total_score", label: "الدرجة /100" },
    { key: "hard", label: "إلزامية" },
    { key: "soft", label: "مرنة" },
    { key: "deductions", label: "إجمالي الخصم" },
    { key: "breakdown", label: "تفصيل المقاييس" },
    { key: "date", label: "التاريخ" },
  ];

  return (
    <ReportShell title="تقرير ملخّص الجودة" description="آخر نتيجة جودة لكل نسخة جدول."
      filename="quality_summary" rows={rows} headers={headers} isLoading={isLoading}
      filters={
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">النسخة</label>
            <Select value={versionId} onValueChange={setVersionId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                {(versions ?? []).map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      }>
      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader><TableRow>{headers.map((h) => <TableHead key={h.key}>{h.label}</TableHead>)}</TableRow></TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={i}>
                <TableCell>{r.version}</TableCell>
                <TableCell><Badge>{r.total_score}/100</Badge></TableCell>
                <TableCell>{r.hard > 0 ? <Badge variant="destructive">{r.hard}</Badge> : r.hard}</TableCell>
                <TableCell>{r.soft}</TableCell>
                <TableCell>{r.deductions}</TableCell>
                <TableCell className="text-xs">{r.breakdown}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.date}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </ReportShell>
  );
}
