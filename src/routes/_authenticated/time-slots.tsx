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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import { Clock, Pencil, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/time-slots")({
  head: () => ({ meta: [{ title: "الفترات الزمنية" }] }),
  component: TimeSlotsPage,
});

interface TS { id: string; college_id: string; day_of_week: number; start_time: string; end_time: string; slot_order: number; is_active: boolean }

export const DAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

function emptyForm() { return { day_of_week: 0, start_time: "08:00", end_time: "09:00", slot_order: 1, is_active: true }; }

function TimeSlotsPage() {
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<TS | null>(null);
  const [form, setForm] = useState(emptyForm());

  const { data: rows, isLoading } = useQuery({
    queryKey: ["time-slots", active?.id], enabled: !!active,
    queryFn: async () => {
      const { data, error } = await supabase.from("time_slots").select("*")
        .eq("college_id", active!.id).order("day_of_week").order("slot_order");
      if (error) throw error; return (data ?? []) as TS[];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!active) throw new Error("اختر كلّية");
      if (form.end_time <= form.start_time) throw new Error("وقت النهاية يجب أن يكون بعد البداية");
      const payload = { ...form, college_id: active.id, slot_order: Number(form.slot_order), day_of_week: Number(form.day_of_week) };
      if (editing) {
        const { error } = await supabase.from("time_slots").update(payload).eq("id", editing.id);
        if (error) throw error;
        await logAudit({ action: "update", entity: "time_slots", entityId: editing.id, collegeId: active.id });
      } else {
        const { data, error } = await supabase.from("time_slots").insert(payload).select("id").single();
        if (error) throw error;
        await logAudit({ action: "create", entity: "time_slots", entityId: data?.id, collegeId: active.id });
      }
    },
    onSuccess: () => {
      toast.success(editing ? "تم التحديث" : "تمت الإضافة");
      qc.invalidateQueries({ queryKey: ["time-slots", active?.id] });
      setOpen(false); setEditing(null);
    },
    onError: (e: Error) => toast.error(e.message.includes("duplicate") ? "هناك فترة بنفس اليوم/الترتيب أو وقت البداية" : e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("time_slots").delete().eq("id", id);
      if (error) throw error;
      await logAudit({ action: "delete", entity: "time_slots", entityId: id, collegeId: active?.id });
    },
    onSuccess: () => { toast.success("تم الحذف"); qc.invalidateQueries({ queryKey: ["time-slots", active?.id] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const startEdit = (t: TS) => {
    setEditing(t);
    setForm({ day_of_week: t.day_of_week, start_time: t.start_time.slice(0, 5), end_time: t.end_time.slice(0, 5), slot_order: t.slot_order, is_active: t.is_active });
    setOpen(true);
  };
  const startCreate = () => { setEditing(null); setForm(emptyForm()); setOpen(true); };

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-6 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-secondary text-primary"><Clock className="h-5 w-5" /></span>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">الفترات الزمنية</h1>
          <p className="text-sm text-muted-foreground">الخانات الزمنية المعتمدة لجدولة المحاضرات.</p>
        </div>
      </header>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <CollegeSwitcher />
        {canManage && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button onClick={startCreate}>فترة جديدة</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{editing ? "تعديل فترة" : "فترة جديدة"}</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>اليوم</Label>
                  <Select value={String(form.day_of_week)} onValueChange={(v) => setForm({ ...form, day_of_week: Number(v) })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{DAYS.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div><Label>البداية</Label><Input dir="ltr" type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} /></div>
                  <div><Label>النهاية</Label><Input dir="ltr" type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} /></div>
                  <div><Label>الترتيب</Label><Input type="number" value={form.slot_order} onChange={(e) => setForm({ ...form, slot_order: Number(e.target.value) })} /></div>
                </div>
                <div className="flex items-center justify-between rounded border border-border p-3">
                  <Label>نشط</Label>
                  <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
                </div>
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
          : !rows || rows.length === 0 ? <p className="p-6 text-center text-muted-foreground">لا توجد فترات بعد.</p>
          : <ul className="divide-y divide-border">
              {rows.map((t) => (
                <li key={t.id} className="flex items-center justify-between p-4">
                  <div>
                    <p className="font-semibold">{DAYS[t.day_of_week]} — فترة {t.slot_order} {!t.is_active && <span className="ms-2 rounded bg-muted px-2 py-0.5 text-[10px]">غير نشط</span>}</p>
                    <p className="text-xs text-muted-foreground" dir="ltr">{t.start_time.slice(0, 5)} → {t.end_time.slice(0, 5)}</p>
                  </div>
                  {canManage && (
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => startEdit(t)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => { if (confirm("حذف الفترة؟")) del.mutate(t.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>}
      </Card>
    </div>
  );
}
