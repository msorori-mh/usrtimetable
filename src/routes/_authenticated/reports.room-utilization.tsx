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
import { filterRowsBySearch } from "@/lib/reports/search";
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
  const [search, setSearch] = useState("");

  const { data: terms } = useQuery({
    queryKey: ["ru-terms", active?.id],
    enabled: !!active,
    queryFn: async () =>
      (
        await supabase
          .from("academic_terms")
          .select("id, name")
          .eq("college_id", active!.id)
          .order("start_date", { ascending: false })
      ).data ?? [],
  });
  const { data: rts } = useQuery({
    queryKey: ["ru-rt", active?.id],
    enabled: !!active,
    queryFn: async () =>
      (await supabase.from("room_types").select("id, name_ar").eq("college_id", active!.id)).data ??
      [],
  });
  const { data: bldgs } = useQuery({
    queryKey: ["ru-b", active?.id],
    enabled: !!active,
    queryFn: async () =>
      (await supabase.from("academic_buildings").select("id, name").eq("college_id", active!.id))
        .data ?? [],
  });

  const {
    data: rooms,
    isLoading: rLoad,
    error: roomsError,
    refetch,
  } = useQuery({
    queryKey: ["ru-rooms", active?.id, rtId, bId],
    enabled: !!active,
    queryFn: async () => {
      let q = supabase
        .from("rooms")
        .select(
          "id, code, name, capacity, room_type_id, building_id, room_types(name_ar), academic_buildings(name)",
        )
        .eq("college_id", active!.id);
      if (rtId !== "all") q = q.eq("room_type_id", rtId);
      if (bId !== "all") q = q.eq("building_id", bId);
      const { data } = await q;
      return data ?? [];
    },
  });

  const {
    data: sessions,
    isLoading: sLoad,
    error: sessionsError,
  } = useQuery({
    queryKey: ["ru-sess", active?.id, termId],
    enabled: !!active,
    queryFn: async () => {
      let q = supabase
        .from("schedule_sessions")
        .select("room_id, start_time, end_time, schedule_versions!inner(academic_term_id)")
        .eq("college_id", active!.id)
        .not("room_id", "is", null);
      if (termId !== "all") q = q.eq("schedule_versions.academic_term_id", termId);
      const { data } = await q;
      return data ?? [];
    },
  });

  const allRows = useMemo(() => {
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

  // Search is presentation-only: identical keys and values, fewer visible rows.
  const rows = useMemo(() => filterRowsBySearch(allRows, search), [allRows, search]);

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

  const usedHours = rows.reduce((s, r) => s + Number(r.scheduled_hours ?? 0), 0);
  const avgUtil = rows.length
    ? Number(
        (rows.reduce((s, r) => s + Number(r.utilization_pct ?? 0), 0) / rows.length).toFixed(1),
      )
    : 0;
  const unusedRooms = rows.filter((r) => Number(r.scheduled_hours) === 0).length;

  const label = (items: { id: string; name: string }[] | undefined, id: string, allText: string) =>
    id === "all" ? allText : ((items ?? []).find((i) => i.id === id)?.name ?? "—");

  return (
    <ReportShell
      title="تقرير استخدام القاعات"
      description="ساعات الاستخدام ونسبة الاستغلال (مرجعية: 40 ساعة/أسبوع)."
      filename="room_utilization"
      rows={rows}
      headers={headers}
      isLoading={rLoad || sLoad}
      error={roomsError ?? sessionsError}
      onRetry={() => void refetch()}
      notReadyMessage={active ? undefined : "اختر كلّية لعرض استخدام القاعات."}
      emptyMessage={search ? "لا قاعة مطابقة للبحث." : "لا توجد قاعات بهذه المعايير."}
      kpis={[
        { label: "القاعات", value: rows.length },
        { label: "متوسط الاستخدام", value: `${avgUtil}%`, tone: "accent" },
        { label: "ساعات مستخدمة", value: usedHours.toFixed(2) },
        {
          label: "قاعات غير مستخدمة",
          value: unusedRooms,
          tone: unusedRooms > 0 ? "warning" : "neutral",
        },
      ]}
      filters={
        <ReportFilterBar
          search={{ value: search, onChange: setSearch, placeholder: "ابحث بالقاعة أو المبنى…" }}
          activeSummary={[
            `الفصل: ${label(terms, termId, "الكل")}`,
            `نوع القاعة: ${label(
              (rts ?? []).map((t) => ({ id: t.id, name: t.name_ar })),
              rtId,
              "الكل",
            )}`,
            `المبنى: ${label(bldgs, bId, "الكل")}`,
          ]}
          onClear={() => {
            setTermId("all");
            setRtId("all");
            setBId("all");
            setSearch("");
          }}
          basic={
            <Sel
              label="الفصل"
              value={termId}
              onChange={setTermId}
              items={[
                { id: "all", name: "الكل" },
                ...(terms ?? []).map((t) => ({ id: t.id, name: t.name })),
              ]}
            />
          }
          advanced={
            <>
              <Sel
                label="نوع القاعة"
                value={rtId}
                onChange={setRtId}
                items={[
                  { id: "all", name: "الكل" },
                  ...(rts ?? []).map((t) => ({ id: t.id, name: t.name_ar })),
                ]}
              />
              <Sel
                label="المبنى"
                value={bId}
                onChange={setBId}
                items={[
                  { id: "all", name: "الكل" },
                  ...(bldgs ?? []).map((b) => ({ id: b.id, name: b.name })),
                ]}
              />
            </>
          }
        />
      }
    >
      <ReportSection
        title="استخدام القاعات"
        count={rows.length}
        hint="النسبة محسوبة على مرجع 40 ساعة أسبوعيًا لكل قاعة."
        bodyClassName="p-0"
      >
        <ReportDataTable
          rows={rows}
          caption="ساعات استخدام القاعات ونسب الاستغلال"
          columns={[
            { key: "room", label: "القاعة" },
            { key: "room_type", label: "النوع", secondary: true },
            { key: "capacity", label: "السعة", numeric: true, secondary: true },
            { key: "building", label: "المبنى", secondary: true },
            { key: "scheduled_hours", label: "ساعات مستخدمة", numeric: true },
            { key: "utilization_pct", label: "نسبة الاستخدام %", numeric: true },
            { key: "usage_count", label: "عدد المحاضرات", numeric: true },
            { key: "idle_hours", label: "ساعات فارغة", numeric: true, secondary: true },
          ]}
        />
      </ReportSection>
    </ReportShell>
  );
}

function Sel({
  label,
  value,
  onChange,
  items,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  items: { id: string; name: string }[];
}) {
  return (
    <ReportFilterField label={label}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((i) => (
            <SelectItem key={i.id} value={i.id}>
              {i.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </ReportFilterField>
  );
}
