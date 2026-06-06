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
import { hoursBetween } from "@/lib/reports/export";

export const Route = createFileRoute("/_authenticated/reports/instructor-workload")({
  head: () => ({ meta: [{ title: "تقرير أعباء المحاضرين" }] }),
  component: Page,
});

function Page() {
  const { active } = useActiveCollege();
  const [termId, setTermId] = useState<string>("all");
  const [deptId, setDeptId] = useState<string>("all");
  const [typeId, setTypeId] = useState<string>("all");

  const { data: terms } = useQuery({
    queryKey: ["rep-terms", active?.id], enabled: !!active,
    queryFn: async () => (await supabase.from("academic_terms").select("id, name").eq("college_id", active!.id).order("start_date", { ascending: false })).data ?? [],
  });
  const { data: depts } = useQuery({
    queryKey: ["rep-depts", active?.id], enabled: !!active,
    queryFn: async () => (await supabase.from("departments").select("id, name").eq("college_id", active!.id)).data ?? [],
  });
  const { data: types } = useQuery({
    queryKey: ["rep-itypes", active?.id], enabled: !!active,
    queryFn: async () => (await supabase.from("instructor_types").select("id, name_ar").eq("college_id", active!.id)).data ?? [],
  });

  const { data: instructors, isLoading: ilLoad } = useQuery({
    queryKey: ["rep-iw-ins", active?.id, deptId, typeId], enabled: !!active,
    queryFn: async () => {
      let q = supabase.from("instructors")
        .select("id, full_name, academic_rank, max_weekly_hours, administrative_release_hours, department_id, instructor_type_id, departments(name), instructor_types(name_ar)")
        .eq("college_id", active!.id);
      if (deptId !== "all") q = q.eq("department_id", deptId);
      if (typeId !== "all") q = q.eq("instructor_type_id", typeId);
      const { data } = await q;
      return data ?? [];
    },
  });

  const { data: sessions, isLoading: sLoad } = useQuery({
    queryKey: ["rep-iw-sess", active?.id, termId], enabled: !!active,
    queryFn: async () => {
      let q = supabase.from("schedule_sessions")
        .select("instructor_id, start_time, end_time, course_offering_id, source_type, schedule_versions!inner(academic_term_id, status)")
        .eq("college_id", active!.id);
      if (termId !== "all") q = q.eq("schedule_versions.academic_term_id", termId);
      const { data } = await q;
      return data ?? [];
    },
  });

  const rows = useMemo(() => {
    const byIns = new Map<string, { hours: number; offerings: Set<string>; sources: Record<string, number> }>();
    for (const s of sessions ?? []) {
      const m = byIns.get(s.instructor_id) ?? { hours: 0, offerings: new Set(), sources: {} };
      m.hours += hoursBetween(s.start_time as string, s.end_time as string);
      m.offerings.add(s.course_offering_id as string);
      const st = (s.source_type as string) ?? "manual";
      m.sources[st] = (m.sources[st] ?? 0) + 1;
      byIns.set(s.instructor_id, m);
    }
    return (instructors ?? []).map((i) => {
      const agg = byIns.get(i.id) ?? { hours: 0, offerings: new Set(), sources: {} };
      const max = i.max_weekly_hours ?? 0;
      const released = i.administrative_release_hours ?? 0;
      const effective = Math.max(0, max - released);
      const overload = Math.max(0, agg.hours - effective);
      const underload = Math.max(0, effective - agg.hours);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dep = (i as any).departments?.name ?? "";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const typ = (i as any).instructor_types?.name_ar ?? "";
      const srcStr = Object.entries(agg.sources).map(([k, v]) => `${k}:${v}`).join(" | ");
      return {
        instructor: i.full_name,
        department: dep,
        rank: i.academic_rank ?? "",
        type: typ,
        max_weekly_hours: max,
        admin_release: released,
        scheduled_hours: Number(agg.hours.toFixed(2)),
        overload: Number(overload.toFixed(2)),
        underload: Number(underload.toFixed(2)),
        courses_count: agg.offerings.size,
        source_breakdown: srcStr,
      };
    });
  }, [instructors, sessions]);

  const headers = [
    { key: "instructor", label: "المحاضر" },
    { key: "department", label: "القسم" },
    { key: "rank", label: "الرتبة" },
    { key: "type", label: "النوع" },
    { key: "max_weekly_hours", label: "الحد الأسبوعي" },
    { key: "admin_release", label: "خصم إداري" },
    { key: "scheduled_hours", label: "ساعات مجدوَلة" },
    { key: "overload", label: "زيادة" },
    { key: "underload", label: "نقص" },
    { key: "courses_count", label: "عدد المقررات" },
    { key: "source_breakdown", label: "تفصيل المصدر" },
  ];

  return (
    <ReportShell
      title="تقرير أعباء المحاضرين"
      description="ساعات التدريس المجدولة والتحميل الزائد/الناقص لكل محاضر."
      filename="instructor_workload"
      rows={rows} headers={headers}
      isLoading={ilLoad || sLoad}
      filters={
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <FilterSelect label="الفصل" value={termId} onChange={setTermId}
            items={[{ id: "all", name: "الكل" }, ...((terms ?? []).map((t) => ({ id: t.id, name: t.name })))]} />
          <FilterSelect label="القسم" value={deptId} onChange={setDeptId}
            items={[{ id: "all", name: "الكل" }, ...((depts ?? []).map((d) => ({ id: d.id, name: d.name })))]} />
          <FilterSelect label="نوع المحاضر" value={typeId} onChange={setTypeId}
            items={[{ id: "all", name: "الكل" }, ...((types ?? []).map((t) => ({ id: t.id, name: t.name_ar })))]} />
        </div>
      }
    >
      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>{headers.map((h) => <TableHead key={h.key}>{h.label}</TableHead>)}</TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={i}>
                <TableCell>{r.instructor}</TableCell>
                <TableCell>{r.department}</TableCell>
                <TableCell>{r.rank}</TableCell>
                <TableCell>{r.type}</TableCell>
                <TableCell>{r.max_weekly_hours}</TableCell>
                <TableCell>{r.admin_release}</TableCell>
                <TableCell>{r.scheduled_hours}</TableCell>
                <TableCell>{r.overload > 0 ? <Badge variant="destructive">{r.overload}</Badge> : r.overload}</TableCell>
                <TableCell>{r.underload > 0 ? <Badge variant="secondary">{r.underload}</Badge> : r.underload}</TableCell>
                <TableCell>{r.courses_count}</TableCell>
                <TableCell className="text-xs">{r.source_breakdown}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </ReportShell>
  );
}

function FilterSelect({ label, value, onChange, items }: { label: string; value: string; onChange: (v: string) => void; items: { id: string; name: string }[] }) {
  return (
    <div>
      <label className="text-xs text-muted-foreground">{label}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>{items.map((i) => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}
