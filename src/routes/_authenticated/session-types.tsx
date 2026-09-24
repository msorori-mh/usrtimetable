import { createFileRoute } from "@tanstack/react-router";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { LookupPage, LookupRow } from "@/components/lookup-page";
import { Presentation } from "lucide-react";

export const Route = createFileRoute("/_authenticated/session-types")({
  head: () => ({ meta: [{ title: "أنواع المحاضرات" }] }),
  component: () => (
    <LookupPage<Row>
      table="session_types"
      title="أنواع المحاضرات"
      subtitle="محاضرة / عملي / تمارين / حلقة بحث…"
      icon={<Presentation className="h-5 w-5" />}
      orderBy="display_order"
      emptyForm={() => ({ code: "", name_ar: "", name_en: "", default_duration_hours: 2, color: "", requires_lab: false, display_order: 0, is_active: true })}
      toForm={(r) => ({ code: r.code, name_ar: r.name_ar, name_en: r.name_en ?? "", default_duration_hours: r.default_duration_hours, color: r.color ?? "", requires_lab: r.requires_lab, display_order: r.display_order, is_active: r.is_active })}
      validate={(f) => (!String(f.code).trim() || !String(f.name_ar).trim()) ? "الرمز والاسم العربي مطلوبان" : null}
      renderForm={(f, set) => (
        <>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>الرمز</Label><Input value={String(f.code ?? "")} onChange={(e) => set({ ...f, code: e.target.value })} /></div>
            <div><Label>المدة (ساعات)</Label><Input type="number" step="0.5" value={Number(f.default_duration_hours ?? 2)} onChange={(e) => set({ ...f, default_duration_hours: Number(e.target.value) })} /></div>
            <div><Label>الترتيب</Label><Input type="number" value={Number(f.display_order ?? 0)} onChange={(e) => set({ ...f, display_order: Number(e.target.value) })} /></div>
          </div>
          <div><Label>الاسم بالعربية</Label><Input value={String(f.name_ar ?? "")} onChange={(e) => set({ ...f, name_ar: e.target.value })} /></div>
          <div><Label>الاسم بالإنجليزية</Label><Input value={String(f.name_en ?? "")} onChange={(e) => set({ ...f, name_en: e.target.value })} /></div>
          <div><Label>اللون (hex)</Label><Input value={String(f.color ?? "")} onChange={(e) => set({ ...f, color: e.target.value })} placeholder="#f59e0b" /></div>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={Boolean(f.requires_lab)} onCheckedChange={(v) => set({ ...f, requires_lab: !!v })} /> يتطلب معملاً</label>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={Boolean(f.is_active)} onCheckedChange={(v) => set({ ...f, is_active: !!v })} /> نشط</label>
        </>
      )}
      renderRow={(r) => (
        <>
          <p className="font-semibold">{r.name_ar} {r.requires_lab && <span className="rounded bg-accent/20 px-2 py-0.5 text-[11px]">معمل</span>}</p>
          <p className="text-xs text-muted-foreground"><span dir="ltr">{r.code}</span> · {Number(r.default_duration_hours)} ساعة افتراضي</p>
        </>
      )}
    />
  ),
});

interface Row extends LookupRow { code: string; name_ar: string; name_en: string | null; default_duration_hours: number; color: string | null; requires_lab: boolean; display_order: number; is_active: boolean }
