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

export const Route = createFileRoute("/_authenticated/reports/unscheduled")({
  head: () => ({ meta: [{ title: "تقرير الجلسات غير المجدوَلة" }] }),
  component: Page,
});

function Page() {
  const { active } = useActiveCollege();
  const [versionId, setVersionId] = useState("");

  const { data: versions } = useQuery({
    queryKey: ["un-vers", active?.id], enabled: !!active,
    queryFn: async () => (await supabase.from("schedule_versions").select("id, name, status, academic_term_id").eq("college_id", active!.id).order("created_at", { ascending: false })).data ?? [],
  });

  const version = useMemo(() => (versions ?? []).find((v) => v.id === versionId), [versions, versionId]);

  const { data: offerings, isLoading: oLoad } = useQuery({
    queryKey: ["un-off", active?.id, version?.academic_term_id], enabled: !!active && !!version,
    queryFn: async () => {
      const { data } = await supabase.from("course_offerings")
        .select(`id, plan_course_id, courses(name, code),
          plan_courses(lectures_per_week, labs_per_week, lecture_session_duration, lab_session_duration)`)
        .eq("college_id", active!.id).eq("term_id", version!.academic_term_id);
      return data ?? [];
    },
  });

  const { data: sessions } = useQuery({
    queryKey: ["un-sess", active?.id, versionId], enabled: !!active && !!versionId,
    queryFn: async () => (await supabase.from("schedule_sessions")
      .select("course_offering_id, session_type").eq("college_id", active!.id).eq("schedule_version_id", versionId)).data ?? [],
  });

  const { data: latestRun } = useQuery({
    queryKey: ["un-run", versionId], enabled: !!versionId,
    queryFn: async () => (await supabase.from("auto_schedule_runs")
      .select("unplaced").eq("schedule_version_id", versionId).order("created_at", { ascending: false }).limit(1).maybeSingle()).data,
  });

  const reasonsMap = useMemo(() => {
    const m = new Map<string, string>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arr = (latestRun?.unplaced as any[]) ?? [];
    for (const u of arr) {
      const key = `${u.course_offering_id ?? u.offering_id ?? ""}|${u.session_type ?? ""}`;
      if (key && !m.has(key)) m.set(key, u.reason_ar ?? u.reason ?? "");
    }
    return m;
  }, [latestRun]);

  const rows = useMemo(() => {
    const counts = new Map<string, { lec: number; lab: number }>();
    for (const s of sessions ?? []) {
      const c = counts.get(s.course_offering_id) ?? { lec: 0, lab: 0 };
      if (s.session_type === "lab") c.lab += 1; else c.lec += 1;
      counts.set(s.course_offering_id, c);
    }
    const out: Array<Record<string, unknown>> = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const o of (offerings ?? []) as any[]) {
      const pc = o.plan_courses;
      const reqLec = Number(pc?.lectures_per_week ?? 0);
      const reqLab = Number(pc?.labs_per_week ?? 0);
      const c = counts.get(o.id) ?? { lec: 0, lab: 0 };
      const missLec = Math.max(0, reqLec - c.lec);
      const missLab = Math.max(0, reqLab - c.lab);
      if (missLec + missLab === 0) continue;
      const course = `${o.courses?.code ?? ""} ${o.courses?.name ?? ""}`;
      if (missLec > 0) out.push({
        course, session_type: "نظري", required: reqLec, scheduled: c.lec, missing: missLec,
        reason: reasonsMap.get(`${o.id}|lecture`) ?? "",
      });
      if (missLab > 0) out.push({
        course, session_type: "عملي", required: reqLab, scheduled: c.lab, missing: missLab,
        reason: reasonsMap.get(`${o.id}|lab`) ?? "",
      });
    }
    return out;
  }, [offerings, sessions, reasonsMap]);

  const headers = [
    { key: "course", label: "المقرر" },
    { key: "session_type", label: "النوع" },
    { key: "required", label: "المطلوب" },
    { key: "scheduled", label: "المجدوَل" },
    { key: "missing", label: "الناقص" },
    { key: "reason", label: "السبب" },
  ];

  return (
    <ReportShell title="تقرير الجلسات غير المجدوَلة" description="الجلسات المطلوبة وفق الخطط مقابل المجدوَلة."
      filename="unscheduled_sessions" rows={rows} headers={headers} isLoading={oLoad}
      emptyMessage={!versionId ? "اختر نسخة جدول." : "كل الجلسات مجدوَلة."}
      filters={
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">نسخة الجدول</label>
            <Select value={versionId} onValueChange={setVersionId}>
              <SelectTrigger><SelectValue placeholder="اختر نسخة" /></SelectTrigger>
              <SelectContent>{(versions ?? []).map((v) => <SelectItem key={v.id} value={v.id}>{v.name} — {v.status}</SelectItem>)}</SelectContent>
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
                <TableCell>{String(r.course)}</TableCell>
                <TableCell>{String(r.session_type)}</TableCell>
                <TableCell>{String(r.required)}</TableCell>
                <TableCell>{String(r.scheduled)}</TableCell>
                <TableCell><Badge variant="destructive">{String(r.missing)}</Badge></TableCell>
                <TableCell className="text-xs text-muted-foreground">{String(r.reason)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </ReportShell>
  );
}
