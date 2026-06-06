import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCollege } from "@/hooks/use-colleges";
import { ReportShell } from "@/components/reports/report-shell";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { DAY_NAMES_AR, fmtTime } from "@/lib/reports/export";

export const Route = createFileRoute("/_authenticated/reports/published-timetable")({
  head: () => ({ meta: [{ title: "تقرير الجدول المنشور" }] }),
  component: Page,
});

function Page() {
  const { active } = useActiveCollege();
  const [termId, setTermId] = useState("all");
  const [versionId, setVersionId] = useState("all");
  const [deptId, setDeptId] = useState("all");
  const [progId, setProgId] = useState("all");
  const [lvlId, setLvlId] = useState("all");
  const [secId, setSecId] = useState("all");
  const [insId, setInsId] = useState("all");
  const [roomId, setRoomId] = useState("all");

  const { data: terms } = useQuery({
    queryKey: ["pt-terms", active?.id], enabled: !!active,
    queryFn: async () => (await supabase.from("academic_terms").select("id, name").eq("college_id", active!.id)).data ?? [],
  });
  const { data: versions } = useQuery({
    queryKey: ["pt-vers", active?.id, termId], enabled: !!active,
    queryFn: async () => {
      let q = supabase.from("schedule_versions").select("id, name, academic_term_id").eq("college_id", active!.id).eq("status", "published");
      if (termId !== "all") q = q.eq("academic_term_id", termId);
      return (await q).data ?? [];
    },
  });
  const { data: depts } = useQuery({ queryKey: ["pt-d", active?.id], enabled: !!active, queryFn: async () => (await supabase.from("departments").select("id, name").eq("college_id", active!.id)).data ?? [] });
  const { data: progs } = useQuery({ queryKey: ["pt-p", active?.id], enabled: !!active, queryFn: async () => (await supabase.from("academic_programs").select("id, name").eq("college_id", active!.id)).data ?? [] });
  const { data: levels } = useQuery({ queryKey: ["pt-l", active?.id], enabled: !!active, queryFn: async () => (await supabase.from("academic_levels").select("id, name").eq("college_id", active!.id)).data ?? [] });
  const { data: secs } = useQuery({ queryKey: ["pt-s", active?.id], enabled: !!active, queryFn: async () => (await supabase.from("sections").select("id, name").eq("college_id", active!.id)).data ?? [] });
  const { data: ins } = useQuery({ queryKey: ["pt-i", active?.id], enabled: !!active, queryFn: async () => (await supabase.from("instructors").select("id, full_name").eq("college_id", active!.id)).data ?? [] });
  const { data: rooms } = useQuery({ queryKey: ["pt-r", active?.id], enabled: !!active, queryFn: async () => (await supabase.from("rooms").select("id, code, name").eq("college_id", active!.id)).data ?? [] });

  const versionIds = useMemo(() => {
    if (versionId !== "all") return [versionId];
    return (versions ?? []).map((v) => v.id);
  }, [versions, versionId]);

  const { data: sessions, isLoading } = useQuery({
    queryKey: ["pt-sess", active?.id, versionIds.join(","), deptId, progId, lvlId, secId, insId, roomId],
    enabled: !!active && versionIds.length > 0,
    queryFn: async () => {
      let q = supabase.from("schedule_sessions")
        .select(`id, day_of_week, start_time, end_time, session_type,
          course_offerings!inner(program_id, level_id, courses!inner(name, code, department_id, departments(name)), academic_programs(name), academic_levels(name)),
          sections(id, name), instructors(id, full_name), rooms(id, code, name),
          schedule_versions!inner(name)`)
        .eq("college_id", active!.id).in("schedule_version_id", versionIds)
        .order("day_of_week").order("start_time");
      if (progId !== "all") q = q.eq("course_offerings.program_id", progId);
      if (lvlId !== "all") q = q.eq("course_offerings.level_id", lvlId);
      if (secId !== "all") q = q.eq("section_id", secId);
      if (insId !== "all") q = q.eq("instructor_id", insId);
      if (roomId !== "all") q = q.eq("room_id", roomId);
      const { data } = await q;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return ((data ?? []) as any[]).filter((s) => deptId === "all" || s.course_offerings?.courses?.department_id === deptId);
    },
  });

  const rows = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((sessions ?? []) as any[]).map((s) => ({
      version: s.schedule_versions?.name ?? "",
      department: s.course_offerings?.courses?.departments?.name ?? "",
      program: s.course_offerings?.academic_programs?.name ?? "",
      level: s.course_offerings?.academic_levels?.name ?? "",
      section: s.sections?.name ?? "",
      course: `${s.course_offerings?.courses?.code ?? ""} ${s.course_offerings?.courses?.name ?? ""}`,
      day: DAY_NAMES_AR[s.day_of_week] ?? "",
      time: `${fmtTime(s.start_time)} - ${fmtTime(s.end_time)}`,
      session_type: s.session_type === "lab" ? "عملي" : "نظري",
      instructor: s.instructors?.full_name ?? "",
      room: s.rooms ? `${s.rooms.code ?? ""} ${s.rooms.name ?? ""}` : "",
    }));
  }, [sessions]);

  const headers = [
    { key: "version", label: "النسخة" },
    { key: "department", label: "القسم" },
    { key: "program", label: "البرنامج" },
    { key: "level", label: "المستوى" },
    { key: "section", label: "الشعبة" },
    { key: "course", label: "المقرر" },
    { key: "day", label: "اليوم" },
    { key: "time", label: "الوقت" },
    { key: "session_type", label: "النوع" },
    { key: "instructor", label: "المحاضر" },
    { key: "room", label: "القاعة" },
  ];

  return (
    <ReportShell title="تقرير الجدول المنشور" description="النسخ ذات حالة (منشور) فقط." filename="published_timetable"
      rows={rows} headers={headers} isLoading={isLoading}
      filters={
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Sel label="الفصل" value={termId} onChange={(v) => { setTermId(v); setVersionId("all"); }} items={[{ id: "all", name: "الكل" }, ...(terms ?? []).map((t) => ({ id: t.id, name: t.name }))]} />
          <Sel label="النسخة" value={versionId} onChange={setVersionId} items={[{ id: "all", name: "الكل" }, ...(versions ?? []).map((v) => ({ id: v.id, name: v.name }))]} />
          <Sel label="القسم" value={deptId} onChange={setDeptId} items={[{ id: "all", name: "الكل" }, ...(depts ?? []).map((d) => ({ id: d.id, name: d.name }))]} />
          <Sel label="البرنامج" value={progId} onChange={setProgId} items={[{ id: "all", name: "الكل" }, ...(progs ?? []).map((p) => ({ id: p.id, name: p.name }))]} />
          <Sel label="المستوى" value={lvlId} onChange={setLvlId} items={[{ id: "all", name: "الكل" }, ...(levels ?? []).map((l) => ({ id: l.id, name: l.name }))]} />
          <Sel label="الشعبة" value={secId} onChange={setSecId} items={[{ id: "all", name: "الكل" }, ...(secs ?? []).map((s) => ({ id: s.id, name: s.name }))]} />
          <Sel label="المحاضر" value={insId} onChange={setInsId} items={[{ id: "all", name: "الكل" }, ...(ins ?? []).map((i) => ({ id: i.id, name: i.full_name }))]} />
          <Sel label="القاعة" value={roomId} onChange={setRoomId} items={[{ id: "all", name: "الكل" }, ...(rooms ?? []).map((r) => ({ id: r.id, name: `${r.code ?? ""} ${r.name ?? ""}` }))]} />
        </div>
      }>
      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader><TableRow>{headers.map((h) => <TableHead key={h.key}>{h.label}</TableHead>)}</TableRow></TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={i}>{headers.map((h) => <TableCell key={h.key}>{String(r[h.key as keyof typeof r])}</TableCell>)}</TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </ReportShell>
  );
}

function Sel({ label, value, onChange, items }: { label: string; value: string; onChange: (v: string) => void; items: { id: string; name: string }[] }) {
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
