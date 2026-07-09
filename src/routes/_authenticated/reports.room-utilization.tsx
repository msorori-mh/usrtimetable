import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCollege } from "@/hooks/use-colleges";
import { ReportShell } from "@/components/reports/report-shell";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { hoursBetween } from "@/lib/reports/export";

export const Route = createFileRoute("/_authenticated/reports/room-utilization")({
  head: () => ({ meta: [{ title: "تقرير استخدام القاعات" }] }),
  component: Page,
});

// Assume 5 working days × 8 hours = 40 hr/week as capacity baseline.
const WEEKLY_CAPACITY_HOURS = 40;

function Page() {
  const { active } = useActiveCollege();
  const [termId, setTermId] = useState("all");
  const [rtId, setRtId] = useState("all");
  const [bId, setBId] = useState("all");

  const { data: terms } = useQuery({
    queryKey: ["ru-terms", active?.id], enabled: !!active,
    queryFn: async () => (await supabase.from("academic_terms").select("id, name").eq("college_id", active!.id).order("start_date", { ascending: false })).data ?? [],
  });
  const { data: rts } = useQuery({
    queryKey: ["ru-rt", active?.id], enabled: !!active,
    queryFn: async () => (await supabase.from("room_types").select("id, name_ar").eq("college_id", active!.id)).data ?? [],
  });
  const { data: bldgs } = useQuery({
    queryKey: ["ru-b", active?.id], enabled: !!active,
    queryFn: async () => (await supabase.from("academic_buildings").select("id, name").eq("college_id", active!.id)).data ?? [],
  });

  const { data: rooms, isLoading: rLoad } = useQuery({
    queryKey: ["ru-rooms", active?.id, rtId, bId], enabled: !!active,
    queryFn: async () => {
      let q = supabase.from("rooms")
        .select("id, code, name, capacity, room_type_id, building_id, room_types(name_ar), academic_buildings(name)")
        .eq("college_id", active!.id);
      if (rtId !== "all") q = q.eq("room_type_id", rtId);
      if (bId !== "all") q = q.eq("building_id", bId);
      const { data } = await q;
      return data ?? [];
    },
  });

  const { data: sessions, isLoading: sLoad } = useQuery({
    queryKey: ["ru-sess", active?.id, termId], enabled: !!active,
    queryFn: async () => {
      let q = supabase.from("schedule_sessions")
        .select("room_id, start_time, end_time, schedule_versions!inner(academic_term_id)")
        .eq("college_id", active!.id).not("room_id", "is", null);
      if (termId !== "all") q = q.eq("schedule_versions.academic_term_id", termId);
      const { data } = await q;
      return data ?? [];
    },
  });

  const rows = useMemo(() => {
    const byRoom = new Map<string, { hours: number; count: number }>();
    for (const s of sessions ?? []) {
      const m = byRoom.get(s.room_id as string) ?? { hours: 0, count: 0 };
      m.hours += hoursBetween(s.start_time as string, s.end_time as string);
      m.count += 1;
      byRoom.set(s.room_id as string, m);
    }
    return (rooms ?? []).map((r) => {
      const agg = byRoom.get(r.id) ?? { hours: 0, count: 0 };
      const util = Math.min(100, (agg.hours / WEEKLY_CAPACITY_HOURS) * 100);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rt = (r as any).room_types?.name_ar ?? "";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bn = (r as any).academic_buildings?.name ?? "";
      return {
        room: r.code ? `${r.code} - ${r.name}` : r.name,
        room_type: rt,
        capacity: r.capacity ?? 0,
        building: bn,
        scheduled_hours: Number(agg.hours.toFixed(2)),
        utilization_pct: Number(util.toFixed(1)),
        usage_count: agg.count,
        idle_hours: Number(Math.max(0, WEEKLY_CAPACITY_HOURS - agg.hours).toFixed(2)),
      };
    });
  }, [rooms, sessions]);

  const headers = [
    { key: "room", label: "القاعة" },
    { key: "room_type", label: "النوع" },
    { key: "capacity", label: "السعة" },
    { key: "building", label: "المبنى" },
    { key: "scheduled_hours", label: "ساعات مستخدمة" },
    { key: "utilization_pct", label: "نسبة الاستخدام %" },
    { key: "usage_count", label: "عدد المحاضرات" },
    { key: "idle_hours", label: "ساعات فارغة" },
  ];

  return (
    <ReportShell title="تقرير استخدام القاعات" description="ساعات الاستخدام ونسبة الاستغلال (مرجعية: 40 ساعة/أسبوع)."
      filename="room_utilization" rows={rows} headers={headers} isLoading={rLoad || sLoad}
      filters={
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Sel label="الفصل" value={termId} onChange={setTermId} items={[{ id: "all", name: "الكل" }, ...(terms ?? []).map((t) => ({ id: t.id, name: t.name }))]} />
          <Sel label="نوع القاعة" value={rtId} onChange={setRtId} items={[{ id: "all", name: "الكل" }, ...(rts ?? []).map((t) => ({ id: t.id, name: t.name_ar }))]} />
          <Sel label="المبنى" value={bId} onChange={setBId} items={[{ id: "all", name: "الكل" }, ...(bldgs ?? []).map((b) => ({ id: b.id, name: b.name }))]} />
        </div>
      }>
      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader><TableRow>{headers.map((h) => <TableHead key={h.key}>{h.label}</TableHead>)}</TableRow></TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={i}>
                {headers.map((h) => <TableCell key={h.key}>{String(r[h.key as keyof typeof r])}</TableCell>)}
              </TableRow>
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
