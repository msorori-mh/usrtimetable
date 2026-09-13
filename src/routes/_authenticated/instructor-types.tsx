import { createFileRoute } from "@tanstack/react-router";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { LookupPage, LookupRow } from "@/components/lookup-page";
import { UserCog } from "lucide-react";
import { OTHER_COLLEGE_INSTRUCTOR_LABEL_AR } from "@/lib/instructor-category";

export const Route = createFileRoute("/_authenticated/instructor-types")({
  head: () => ({ meta: [{ title: "أنواع المحاضرين" }] }),
  component: () => (
    <LookupPage<Row>
      table="instructor_types"
      title="أنواع المحاضرين"
      subtitle={`محاضر دائم / ${OTHER_COLLEGE_INSTRUCTOR_LABEL_AR} / محاضر زائر…`}
      icon={<UserCog className="h-5 w-5" />}
      orderBy="display_order"
      emptyForm={() => ({ code: "", name_ar: "", name_en: "", is_external: false, color: "", display_order: 0, is_active: true })}
      toForm={(r) => ({ code: r.code, name_ar: r.name_ar, name_en: r.name_en ?? "", is_external: r.is_external, color: r.color ?? "", display_order: r.display_order, is_active: r.is_active })}
      validate={(f) => (!String(f.code).trim() || !String(f.name_ar).trim()) ? "الرمز والاسم العربي مطلوبان" : null}
      renderForm={(f, set) => (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>الرمز</Label><Input value={String(f.code ?? "")} onChange={(e) => set({ ...f, code: e.target.value })} /></div>
            <div><Label>الترتيب</Label><Input type="number" value={Number(f.display_order ?? 0)} onChange={(e) => set({ ...f, display_order: Number(e.target.value) })} /></div>
          </div>
          <div><Label>الاسم بالعربية</Label><Input value={String(f.name_ar ?? "")} onChange={(e) => set({ ...f, name_ar: e.target.value })} /></div>
          <div><Label>الاسم بالإنجليزية</Label><Input value={String(f.name_en ?? "")} onChange={(e) => set({ ...f, name_en: e.target.value })} /></div>
          <div><Label>اللون (hex)</Label><Input value={String(f.color ?? "")} onChange={(e) => set({ ...f, color: e.target.value })} placeholder="#3b82f6" /></div>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={Boolean(f.is_external)} onCheckedChange={(v) => set({ ...f, is_external: !!v })} /> يتطلب أوقات توفر خاصة</label>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={Boolean(f.is_active)} onCheckedChange={(v) => set({ ...f, is_active: !!v })} /> نشط</label>
        </>
      )}
      renderRow={(r) => (
        <>
          <p className="font-semibold">{r.name_ar} {r.is_external && <span className="rounded bg-accent/20 px-2 py-0.5 text-[11px]">توفر خاص</span>}</p>
          <p className="text-xs text-muted-foreground"><span dir="ltr">{r.code}</span>{r.name_en && ` · ${r.name_en}`}</p>
        </>
      )}
    />
  ),
});

interface Row extends LookupRow { code: string; name_ar: string; name_en: string | null; is_external: boolean; color: string | null; display_order: number; is_active: boolean }
