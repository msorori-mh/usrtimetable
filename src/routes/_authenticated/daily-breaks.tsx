import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCollege } from "@/hooks/use-colleges";
import { useCanManageActiveCollege } from "@/hooks/use-can-manage";
import { CollegeSwitcher } from "@/components/college-switcher";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import { Coffee, Pencil, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/daily-breaks")({
  head: () => ({ meta: [{ title: "الاستراحات اليومية" }] }),
  component: DailyBreaksPage,
});

interface Brk { id: string; name: string; days: number[]; start_time: string; end_time: string; affects_scheduling: boolean; college_id: string }
const DAY_LABELS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

function DailyBreaksPage() {
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Brk | null>(null);
  const [form, setForm] = useState({ name: "", days: [] as number[], start_time: "12:00", end_time: "12:30", affects_scheduling: true });

  const { data: rows, isLoading } = useQuery({
    queryKey: ["daily-breaks", active?.id], enabled: !!active,
    queryFn: async () => {
      const { data, error } = await supabase.from("daily_breaks")
        .select("id, name, days, start_time, end_time, affects_scheduling, college_id")
        .eq("college_id", active!.id).order("start_time");
      if (error) throw error; return (data ?? []) as Brk[];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!active) throw new Error("اختر كلّية");
      if (!form.name.trim()) throw new Error("الاسم مطلوب");
      const payload = { name: form.name.trim(), days: form.days, start_time: form.start_time, end_time: form.end_time, affects_scheduling: form.affects_scheduling, college_id: active.id };
      if (editing) {
        const { error } = await supabase.from("daily_breaks").update(payload).eq("id", editing.id);
        if (error) throw error;
        await logAudit({ action: "update", entity: "daily_breaks", entityId: editing.id, collegeId: active.id });
      } else {
        const { data, error } = await supabase.from("daily_breaks").insert(payload).select("id").single();
        if (error) throw error;
        await logAudit({ action: "create", entity: "daily_breaks", entityId: data?.id, collegeId: active.id });
      }
    },
    onSuccess: () => { toast.success(editing ? "تم التحديث" : "تمت الإضافة"); qc.invalidateQueries({ queryKey: ["daily-breaks", active?.id] }); setOpen(false); setEditing(null); },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("daily_breaks").delete().eq("id", id);
      if (error) throw error;
      await logAudit({ action: "delete", entity: "daily_breaks", entityId: id, collegeId: active?.id });
    },
    onSuccess: () => { toast.success("تم الحذف"); qc.invalidateQueries({ queryKey: ["daily-breaks", active?.id] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const startEdit = (b: Brk) => { setEditing(b); setForm({ name: b.name, days: b.days ?? [], start_time: b.start_time, end_time: b.end_time, affects_scheduling: b.affects_scheduling }); setOpen(true); };
  const startCreate = () => { setEditing(null); setForm({ name: "", days: [], start_time: "12:00", end_time: "12:30", affects_scheduling: true }); setOpen(true); };
  const toggleDay = (d: number) => setForm((f) => ({ ...f, days: f.days.includes(d) ? f.days.filter((x) => x !== d) : [...f.days, d].sort() }));

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-6 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-secondary text-primary"><Coffee className="h-5 w-5" /></span>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">الاستراحات اليومية</h1>
          <p className="text-sm text-muted-foreground">فترات ثابتة (مثل صلاة الظهر) تُستثنى من الجدولة.</p>
        </div>
      </header>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <CollegeSwitcher />
        {canManage && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button onClick={startCreate}>استراحة جديدة</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{editing ? "تعديل" : "استراحة جديدة"}</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>الاسم</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>من</Label><Input type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} /></div>
                  <div><Label>إلى</Label><Input type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} /></div>
                </div>
                <div>
                  <Label>الأيام</Label>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {DAY_LABELS.map((lbl, i) => (
                      <label key={i} className="flex items-center gap-1 rounded border px-2 py-1 text-xs">
                        <Checkbox checked={form.days.includes(i)} onCheckedChange={() => toggleDay(i)} />{lbl}
                      </label>
                    ))}
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm"><Checkbox checked={form.affects_scheduling} onCheckedChange={(v) => setForm({ ...form, affects_scheduling: !!v })} /> يؤثّر على الجدولة</label>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
                <Button onClick={() => save.mutate()} disabled={save.isPending}>حفظ</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Card className="overflow-hidden">
        {isLoading ? <p className="p-6 text-center text-muted-foreground">جارٍ التحميل...</p>
          : !rows || rows.length === 0 ? <p className="p-6 text-center text-muted-foreground">لا توجد استراحات بعد.</p>
          : <ul className="divide-y divide-border">
              {rows.map((b) => (
                <li key={b.id} className="flex items-center justify-between p-4">
                  <div>
                    <p className="font-semibold">{b.name}</p>
                    <p className="text-xs text-muted-foreground"><span dir="ltr">{b.start_time} → {b.end_time}</span> · {(b.days ?? []).map((d) => DAY_LABELS[d]).join("، ") || "كل الأيام"}</p>
                  </div>
                  {canManage && (
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => startEdit(b)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => { if (confirm("حذف؟")) del.mutate(b.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>}
      </Card>
    </div>
  );
}
