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

export const Route = createFileRoute("/_authenticated/reports/department-schedule")({
  head: () => ({ meta: [{ title: "تقرير جدول الأقسام" }] }),
  component: Page,
});

function Page() {
  const { active } = useActiveCollege();
  const [versionId, setVersionId] = useState("");
  const [deptId, setDeptId] = useState("all");

  const { data: versions } = useQuery({
    queryKey: ["ds-vers", active?.id], enabled: !!active,
    queryFn: async () => (await supabase.from("schedule_versions").select("id, name, status").eq("college_id", active!.id).order("created_at", { ascending: false })).data ?? [],
  });
  const { data: depts } = useQuery({
    queryKey: ["ds-depts", active?.id], enabled: !!active,
    queryFn: async () => (await supabase.from("departments").select("id, name").eq("college_id", active!.id)).data ?? [],
  });

  const { data: sessions, isLoading } = useQuery({
    queryKey: ["ds-sess", active?.id, versionId, deptId], enabled: !!active && !!versionId,
    queryFn: async () => {
      const { data } = await supabase.from("schedule_sessions")
        .select(`id, day_of_week, start_time, end_time, session_type,
          course_offerings!inner(courses!inner(name, code, department_id, departments(name)), academic_programs(name), academic_levels(name, level_number)),
          sections(section_number),
          instructors(full_name),
          rooms(code, name)`)
        .eq("college_id", active!.id).eq("schedule_version_id", versionId)
        .order("day_of_week").order("start_time");
      return data ?? [];
    },
  });

  const rows = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((sessions ?? []) as any[])
      .filter((s) => deptId === "all" || s.course_offerings?.courses?.department_id === deptId)
      .map((s) => ({
        department: s.course_offerings?.courses?.departments?.name ?? "",
        program: s.course_offerings?.academic_programs?.name ?? "",
        level: s.course_offerings?.academic_levels?.name ?? "",
        section: s.sections?.section_number ?? "",
        course: `${s.course_offerings?.courses?.code ?? ""} ${s.course_offerings?.courses?.name ?? ""}`,
        day: DAY_NAMES_AR[s.day_of_week] ?? "",
        time: `${fmtTime(s.start_time)} - ${fmtTime(s.end_time)}`,
        session_type: s.session_type === "lab" ? "عملي" : "نظري",
        instructor: s.instructors?.full_name ?? "",
        room: s.rooms ? `${s.rooms.code ?? ""} ${s.rooms.name ?? ""}` : "",
      }));
  }, [sessions, deptId]);

  const headers = [
    { key: "department", label: "القسم" },
    { key: "program", label: "البرنامج" },
    { key: "level", label: "المستوى" },
    { key: "section", label: "المجموعة" },
    { key: "course", label: "المقرر" },
    { key: "day", label: "اليوم" },
    { key: "time", label: "الوقت" },
    { key: "session_type", label: "النوع" },
    { key: "instructor", label: "المحاضر" },
    { key: "room", label: "القاعة" },
  ];

  return (
    <ReportShell title="تقرير جدول الأقسام" description="الجدول مجمّعًا حسب القسم/البرنامج/المستوى/المجموعة."
      filename="department_schedule" rows={rows} headers={headers} isLoading={isLoading}
      emptyMessage={!versionId ? "اختر نسخة جدول للبدء." : "لا توجد جلسات."}
      filters={
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">نسخة الجدول</label>
            <Select value={versionId} onValueChange={setVersionId}>
              <SelectTrigger><SelectValue placeholder="اختر نسخة" /></SelectTrigger>
              <SelectContent>{(versions ?? []).map((v) => <SelectItem key={v.id} value={v.id}>{v.name} — {v.status}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">القسم</label>
            <Select value={deptId} onValueChange={setDeptId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                {(depts ?? []).map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
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
              <TableRow key={i}>{headers.map((h) => <TableCell key={h.key}>{String(r[h.key as keyof typeof r])}</TableCell>)}</TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </ReportShell>
  );
}
