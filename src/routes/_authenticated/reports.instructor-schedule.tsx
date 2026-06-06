import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCollege } from "@/hooks/use-colleges";
import { ReportShell } from "@/components/reports/report-shell";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { DAY_NAMES_AR, fmtTime, hoursBetween } from "@/lib/reports/export";

export const Route = createFileRoute("/_authenticated/reports/instructor-schedule")({
  head: () => ({ meta: [{ title: "تقرير جدول المحاضر" }] }),
  component: Page,
});

function Page() {
  const { active } = useActiveCollege();
  const [versionId, setVersionId] = useState("");
  const [insId, setInsId] = useState("");

  const { data: versions } = useQuery({
    queryKey: ["is-vers", active?.id], enabled: !!active,
    queryFn: async () => (await supabase.from("schedule_versions").select("id, name, status").eq("college_id", active!.id).order("created_at", { ascending: false })).data ?? [],
  });
  const { data: instructors } = useQuery({
    queryKey: ["is-ins", active?.id], enabled: !!active,
    queryFn: async () => (await supabase.from("instructors").select("id, full_name").eq("college_id", active!.id).order("full_name")).data ?? [],
  });

  const { data: sessions, isLoading } = useQuery({
    queryKey: ["is-sess", active?.id, versionId, insId], enabled: !!active && !!versionId && !!insId,
    queryFn: async () => {
      const { data } = await supabase.from("schedule_sessions")
        .select(`id, day_of_week, start_time, end_time, session_type,
          course_offerings(courses(name, code), academic_programs(name)),
          sections(section_number),
          rooms(code, name)`)
        .eq("college_id", active!.id).eq("schedule_version_id", versionId).eq("instructor_id", insId)
        .order("day_of_week").order("start_time");
      return data ?? [];
    },
  });

  const rows = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((sessions ?? []) as any[]).map((s) => ({
      course: `${s.course_offerings?.courses?.code ?? ""} ${s.course_offerings?.courses?.name ?? ""}`,
      room: s.rooms ? `${s.rooms.code ?? ""} ${s.rooms.name ?? ""}` : "",
      day: DAY_NAMES_AR[s.day_of_week] ?? "",
      time: `${fmtTime(s.start_time)} - ${fmtTime(s.end_time)}`,
      section_program: `${s.sections?.section_number ?? ""} ${s.course_offerings?.academic_programs?.name ?? ""}`,
      hours: Number(hoursBetween(s.start_time, s.end_time).toFixed(2)),
      session_type: s.session_type === "lab" ? "عملي" : "نظري",
    }));
  }, [sessions]);

  const totalHours = rows.reduce((sum, r) => sum + r.hours, 0);

  const headers = [
    { key: "course", label: "المقرر" },
    { key: "room", label: "القاعة" },
    { key: "day", label: "اليوم" },
    { key: "time", label: "الوقت" },
    { key: "section_program", label: "الشعبة/البرنامج" },
    { key: "session_type", label: "النوع" },
    { key: "hours", label: "الساعات" },
  ];

  return (
    <ReportShell title="تقرير جدول المحاضر الفردي" description={`المجموع: ${totalHours.toFixed(2)} ساعة/أسبوع.`}
      filename="instructor_schedule" rows={rows} headers={headers} isLoading={isLoading}
      emptyMessage={!versionId || !insId ? "اختر نسخة جدول ومحاضرًا." : "لا توجد جلسات."}
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
            <label className="text-xs text-muted-foreground">المحاضر</label>
            <Select value={insId} onValueChange={setInsId}>
              <SelectTrigger><SelectValue placeholder="اختر المحاضر" /></SelectTrigger>
              <SelectContent>{(instructors ?? []).map((i) => <SelectItem key={i.id} value={i.id}>{i.full_name}</SelectItem>)}</SelectContent>
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
