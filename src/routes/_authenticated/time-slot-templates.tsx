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
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import { DAYS } from "./time-slots";
import { Clock, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/time-slot-templates")({
  head: () => ({ meta: [{ title: "قوالب الفترات (نظام الدراسة)" }] }),
  component: TimeSlotTemplatesPage,
});

type StudySystem = "regular" | "parallel" | "both";
interface TST {
  id: string;
  study_system: StudySystem;
  day_of_week: number;
  start_time: string;
  end_time: string;
  slot_duration_minutes: number;
  is_active: boolean;
}

const SYSTEM_LABELS: Record<StudySystem, string> = {
  regular: "النظام العام / الصباحي",
  parallel: "النظام الموازي / المسائي",
  both: "عام وموازي",
};

function TimeSlotTemplatesPage() {
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<StudySystem | "all">("all");
  const [form, setForm] = useState<{
    study_system: StudySystem;
    day_of_week: number;
    start_time: string;
    end_time: string;
    slot_duration_minutes: number;
  }>({ study_system: "regular", day_of_week: 0, start_time: "08:00", end_time: "14:00", slot_duration_minutes: 60 });

  const { data: rows, isLoading } = useQuery({
    queryKey: ["tst", active?.id, filter],
    enabled: !!active,
    queryFn: async () => {
      let q = supabase.from("time_slot_templates").select("*").eq("college_id", active!.id);
      if (filter !== "all") q = q.eq("study_system", filter);
      const { data, error } = await q.order("study_system").order("day_of_week").order("start_time");
      if (error) throw error;
      return (data ?? []) as TST[];
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      if (!active) throw new Error("اختر كلّية");
      if (form.end_time <= form.start_time) throw new Error("وقت النهاية يجب أن يكون بعد البداية");
      if (form.slot_duration_minutes < 15 || form.slot_duration_minutes > 480)
        throw new Error("مدة الفترة يجب أن تكون بين 15 و 480 دقيقة");
      const payload = { ...form, college_id: active.id, is_active: true };
      const { data, error } = await supabase.from("time_slot_templates").insert(payload).select("id").single();
      if (error) throw error;
      await logAudit({ action: "create", entity: "time_slot_templates", entityId: data?.id, collegeId: active.id });
    },
    onSuccess: () => { toast.success("تمت الإضافة"); qc.invalidateQueries({ queryKey: ["tst", active?.id] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: async (r: TST) => {
      const { error } = await supabase.from("time_slot_templates").update({ is_active: !r.is_active }).eq("id", r.id);
      if (error) throw error;
      await logAudit({ action: "update", entity: "time_slot_templates", entityId: r.id, collegeId: active?.id });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tst", active?.id] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("time_slot_templates").delete().eq("id", id);
      if (error) throw error;
      await logAudit({ action: "delete", entity: "time_slot_templates", entityId: id, collegeId: active?.id });
    },
    onSuccess: () => { toast.success("تم الحذف"); qc.invalidateQueries({ queryKey: ["tst", active?.id] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-6 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-secondary text-primary"><Clock className="h-5 w-5" /></span>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">قوالب الفترات حسب نظام الدراسة</h1>
          <p className="text-sm text-muted-foreground">تعريف نوافذ زمنية مختلفة للنظام الصباحي والمسائي. لا تُولّد فترات فعلية بعد.</p>
        </div>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-3"><CollegeSwitcher />
        <div className="w-56">
          <Label>تصفية حسب النظام</Label>
          <Select value={filter} onValueChange={(v) => setFilter(v as StudySystem | "all")}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">الكل</SelectItem>
              <SelectItem value="regular">{SYSTEM_LABELS.regular}</SelectItem>
              <SelectItem value="parallel">{SYSTEM_LABELS.parallel}</SelectItem>
              <SelectItem value="both">{SYSTEM_LABELS.both}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {!active ? (
        <p className="rounded border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground">اختر كلّية أولاً.</p>
      ) : (
        <>
          {canManage && (
            <Card className="mb-4 p-4">
              <p className="mb-3 text-sm font-semibold">إضافة قالب فترة</p>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
                <div>
                  <Label>النظام</Label>
                  <Select value={form.study_system} onValueChange={(v) => setForm({ ...form, study_system: v as StudySystem })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="regular">{SYSTEM_LABELS.regular}</SelectItem>
                      <SelectItem value="parallel">{SYSTEM_LABELS.parallel}</SelectItem>
                      <SelectItem value="both">{SYSTEM_LABELS.both}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>اليوم</Label>
                  <Select value={String(form.day_of_week)} onValueChange={(v) => setForm({ ...form, day_of_week: Number(v) })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{DAYS.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>من</Label><Input dir="ltr" type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} /></div>
                <div><Label>إلى</Label><Input dir="ltr" type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} /></div>
                <div><Label>مدة الفترة (دقيقة)</Label><Input dir="ltr" type="number" min={15} max={480} value={form.slot_duration_minutes} onChange={(e) => setForm({ ...form, slot_duration_minutes: Number(e.target.value) })} /></div>
                <div className="flex items-end"><Button onClick={() => add.mutate()} disabled={add.isPending} className="w-full">إضافة</Button></div>
              </div>
            </Card>
          )}

          <Card className="overflow-hidden">
            {isLoading ? <p className="p-6 text-center text-muted-foreground">جارٍ التحميل...</p>
              : !rows || rows.length === 0 ? <p className="p-6 text-center text-muted-foreground">لا توجد قوالب فترات بعد.</p>
              : <ul className="divide-y divide-border">
                  {rows.map((r) => (
                    <li key={r.id} className="flex items-center justify-between p-3">
                      <div>
                        <p className="text-sm font-medium">
                          {SYSTEM_LABELS[r.study_system]} · {DAYS[r.day_of_week]}{" "}
                          <span dir="ltr">{r.start_time.slice(0, 5)} → {r.end_time.slice(0, 5)}</span>
                        </p>
                        <p className="text-xs text-muted-foreground">مدة الفترة: {r.slot_duration_minutes} دقيقة · {r.is_active ? "نشط" : "موقوف"}</p>
                      </div>
                      {canManage && (
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => toggleActive.mutate(r)}>{r.is_active ? "إيقاف" : "تفعيل"}</Button>
                          <Button size="sm" variant="ghost" onClick={() => { if (confirm("حذف القالب؟")) del.mutate(r.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>}
          </Card>
        </>
      )}
    </div>
  );
}
