import { createFileRoute } from "@tanstack/react-router";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { LookupPage, LookupRow } from "@/components/lookup-page";
import { Building } from "lucide-react";

export const Route = createFileRoute("/_authenticated/buildings")({
  head: () => ({ meta: [{ title: "المباني الأكاديمية" }] }),
  component: () => (
    <LookupPage<Row>
      table="academic_buildings"
      title="المباني الأكاديمية"
      subtitle="مباني الكلية وعناوينها."
      icon={<Building className="h-5 w-5" />}
      emptyForm={() => ({ code: "", name: "", address: "", floors_count: null, notes: "", is_active: true })}
      toForm={(r) => ({ code: r.code, name: r.name, address: r.address ?? "", floors_count: r.floors_count, notes: r.notes ?? "", is_active: r.is_active })}
      validate={(f) => (!String(f.code).trim() || !String(f.name).trim()) ? "الرمز والاسم مطلوبان" : null}
      renderForm={(f, set) => (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>الرمز</Label><Input value={String(f.code ?? "")} onChange={(e) => set({ ...f, code: e.target.value })} /></div>
            <div><Label>عدد الطوابق</Label><Input type="number" value={f.floors_count == null ? "" : Number(f.floors_count)} onChange={(e) => set({ ...f, floors_count: e.target.value === "" ? null : Number(e.target.value) })} /></div>
          </div>
          <div><Label>الاسم</Label><Input value={String(f.name ?? "")} onChange={(e) => set({ ...f, name: e.target.value })} /></div>
          <div><Label>العنوان</Label><Input value={String(f.address ?? "")} onChange={(e) => set({ ...f, address: e.target.value })} /></div>
          <div><Label>ملاحظات</Label><Input value={String(f.notes ?? "")} onChange={(e) => set({ ...f, notes: e.target.value })} /></div>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={Boolean(f.is_active)} onCheckedChange={(v) => set({ ...f, is_active: !!v })} /> نشط</label>
        </>
      )}
      renderRow={(r) => (
        <>
          <p className="font-semibold">{r.name}</p>
          <p className="text-xs text-muted-foreground"><span dir="ltr">{r.code}</span>{r.address && ` · ${r.address}`}{r.floors_count != null && ` · ${r.floors_count} طوابق`}</p>
        </>
      )}
    />
  ),
});

interface Row extends LookupRow { code: string; name: string; address: string | null; floors_count: number | null; notes: string | null; is_active: boolean }
