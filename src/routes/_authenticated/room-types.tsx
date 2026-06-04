import { createFileRoute } from "@tanstack/react-router";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { LookupPage, LookupRow } from "@/components/lookup-page";
import { Boxes } from "lucide-react";

export const Route = createFileRoute("/_authenticated/room-types")({
  head: () => ({ meta: [{ title: "أنواع القاعات" }] }),
  component: () => (
    <LookupPage<Row>
      table="room_types"
      title="أنواع القاعات"
      subtitle="محاضرات / مختبرات / قاعات عرض…"
      icon={<Boxes className="h-5 w-5" />}
      orderBy="display_order"
      emptyForm={() => ({ code: "", name_ar: "", name_en: "", default_capacity: 30, color: "", display_order: 0, is_active: true, features: [] })}
      toForm={(r) => ({ code: r.code, name_ar: r.name_ar, name_en: r.name_en ?? "", default_capacity: r.default_capacity, color: r.color ?? "", display_order: r.display_order, is_active: r.is_active, features: r.features ?? [] })}
      validate={(f) => (!String(f.code).trim() || !String(f.name_ar).trim()) ? "الرمز والاسم العربي مطلوبان" : null}
      renderForm={(f, set) => (
        <>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>الرمز</Label><Input value={String(f.code ?? "")} onChange={(e) => set({ ...f, code: e.target.value })} /></div>
            <div><Label>السعة الافتراضية</Label><Input type="number" value={Number(f.default_capacity ?? 30)} onChange={(e) => set({ ...f, default_capacity: Number(e.target.value) })} /></div>
            <div><Label>الترتيب</Label><Input type="number" value={Number(f.display_order ?? 0)} onChange={(e) => set({ ...f, display_order: Number(e.target.value) })} /></div>
          </div>
          <div><Label>الاسم بالعربية</Label><Input value={String(f.name_ar ?? "")} onChange={(e) => set({ ...f, name_ar: e.target.value })} /></div>
          <div><Label>الاسم بالإنجليزية</Label><Input value={String(f.name_en ?? "")} onChange={(e) => set({ ...f, name_en: e.target.value })} /></div>
          <div><Label>اللون (hex)</Label><Input value={String(f.color ?? "")} onChange={(e) => set({ ...f, color: e.target.value })} placeholder="#10b981" /></div>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={Boolean(f.is_active)} onCheckedChange={(v) => set({ ...f, is_active: !!v })} /> نشط</label>
        </>
      )}
      renderRow={(r) => (
        <>
          <p className="font-semibold">{r.name_ar}</p>
          <p className="text-xs text-muted-foreground"><span dir="ltr">{r.code}</span> · سعة افتراضية {r.default_capacity}</p>
        </>
      )}
    />
  ),
});

interface Row extends LookupRow { code: string; name_ar: string; name_en: string | null; default_capacity: number; color: string | null; display_order: number; is_active: boolean; features: unknown }
