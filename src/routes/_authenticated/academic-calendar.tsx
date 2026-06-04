import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCollege } from "@/hooks/use-colleges";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LookupPage, LookupRow } from "@/components/lookup-page";
import { CalendarDays } from "lucide-react";

export const Route = createFileRoute("/_authenticated/academic-calendar")({
  head: () => ({ meta: [{ title: "التقويم الأكاديمي" }] }),
  component: CalendarPage,
});

const KINDS = [
  { v: "holiday", l: "عطلة" },
  { v: "exam", l: "امتحان" },
  { v: "event", l: "فعالية" },
  { v: "break", l: "استراحة" },
  { v: "deadline", l: "موعد نهائي" },
];

interface Row extends LookupRow {
  title: string; event_kind: string; term_id: string | null;
  start_date: string; end_date: string | null;
  start_time: string | null; end_time: string | null;
  all_day: boolean; affects_scheduling: boolean; color: string | null; notes: string | null;
}

function CalendarPage() {
  const { active } = useActiveCollege();
  const { data: terms } = useQuery({
    queryKey: ["terms-cal", active?.id], enabled: !!active,
    queryFn: async () => (await supabase.from("academic_terms").select("id, name").eq("college_id", active!.id).order("start_date", { ascending: false })).data ?? [],
  });
  const termLabel = new Map((terms ?? []).map((t) => [t.id, t.name]));
  const kindLabel = new Map(KINDS.map((k) => [k.v, k.l]));

  return (
    <LookupPage<Row>
      table="academic_calendar"
      title="التقويم الأكاديمي"
      subtitle="العطل والامتحانات والمواعيد المؤثرة على الجدولة."
      icon={<CalendarDays className="h-5 w-5" />}
      orderBy="start_date"
      emptyForm={() => ({ title: "", event_kind: "holiday", term_id: null, start_date: "", end_date: "", start_time: "", end_time: "", all_day: true, affects_scheduling: true, color: "", notes: "" })}
      toForm={(r) => ({ title: r.title, event_kind: r.event_kind, term_id: r.term_id, start_date: r.start_date, end_date: r.end_date ?? "", start_time: r.start_time ?? "", end_time: r.end_time ?? "", all_day: r.all_day, affects_scheduling: r.affects_scheduling, color: r.color ?? "", notes: r.notes ?? "" })}
      validate={(f) => (!String(f.title).trim() || !String(f.start_date)) ? "العنوان وتاريخ البداية مطلوبان" : null}
      renderForm={(f, set) => (
        <>
          <div><Label>العنوان</Label><Input value={String(f.title ?? "")} onChange={(e) => set({ ...f, title: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>النوع</Label>
              <Select value={String(f.event_kind ?? "holiday")} onValueChange={(v) => set({ ...f, event_kind: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{KINDS.map((k) => <SelectItem key={k.v} value={k.v}>{k.l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>الفصل (اختياري)</Label>
              <Select value={(f.term_id as string) ?? "_none"} onValueChange={(v) => set({ ...f, term_id: v === "_none" ? null : v })}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">— غير محدد —</SelectItem>
                  {(terms ?? []).map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>تاريخ البداية</Label><Input type="date" value={String(f.start_date ?? "")} onChange={(e) => set({ ...f, start_date: e.target.value })} /></div>
            <div><Label>تاريخ النهاية</Label><Input type="date" value={String(f.end_date ?? "")} onChange={(e) => set({ ...f, end_date: e.target.value || null })} /></div>
          </div>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={Boolean(f.all_day)} onCheckedChange={(v) => set({ ...f, all_day: !!v })} /> طوال اليوم</label>
          {!f.all_day && (
            <div className="grid grid-cols-2 gap-3">
              <div><Label>من</Label><Input type="time" value={String(f.start_time ?? "")} onChange={(e) => set({ ...f, start_time: e.target.value || null })} /></div>
              <div><Label>إلى</Label><Input type="time" value={String(f.end_time ?? "")} onChange={(e) => set({ ...f, end_time: e.target.value || null })} /></div>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={Boolean(f.affects_scheduling)} onCheckedChange={(v) => set({ ...f, affects_scheduling: !!v })} /> يؤثر على الجدولة</label>
          <div><Label>اللون (hex)</Label><Input value={String(f.color ?? "")} onChange={(e) => set({ ...f, color: e.target.value })} placeholder="#ef4444" /></div>
          <div><Label>ملاحظات</Label><Input value={String(f.notes ?? "")} onChange={(e) => set({ ...f, notes: e.target.value })} /></div>
        </>
      )}
      renderRow={(r) => (
        <>
          <p className="font-semibold">{r.title} <span className="rounded bg-secondary px-2 py-0.5 text-[11px]">{kindLabel.get(r.event_kind) ?? r.event_kind}</span></p>
          <p className="text-xs text-muted-foreground">
            {r.start_date}{r.end_date && r.end_date !== r.start_date && ` ← ${r.end_date}`}
            {r.term_id && ` · ${termLabel.get(r.term_id) ?? "—"}`}
            {!r.affects_scheduling && " · لا يؤثر على الجدولة"}
          </p>
        </>
      )}
    />
  );
}
