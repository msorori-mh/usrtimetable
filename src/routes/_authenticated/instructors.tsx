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
import { UserSquare2, Pencil, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/instructors")({
  head: () => ({ meta: [{ title: "المحاضرون" }] }),
  component: InstructorsPage,
});

interface Instructor {
  id: string; college_id: string; department_id: string | null;
  full_name: string; academic_rank: string | null; email: string | null; phone: string | null;
  employment_type: string; max_weekly_hours: number; is_active: boolean;
  employee_number: string | null; full_name_ar: string | null; full_name_en: string | null;
  specialization: string | null; administrative_release_hours: number; notes: string | null;
}

const RANKS = ["معيد", "محاضر", "أستاذ مساعد", "أستاذ مشارك", "أستاذ"];
const EMP = [
  { v: "full_time", l: "متفرّغ" },
  { v: "part_time", l: "غير متفرّغ" },
  { v: "visiting", l: "زائر" },
  { v: "contract", l: "متعاقد" },
];

function emptyForm() {
  return {
    full_name: "", academic_rank: "", email: "", phone: "", department_id: "",
    employment_type: "full_time", max_weekly_hours: 18, is_active: true,
    employee_number: "", full_name_ar: "", full_name_en: "", specialization: "",
    administrative_release_hours: 0, notes: "",
  };
}

function InstructorsPage() {
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Instructor | null>(null);
  const [form, setForm] = useState(emptyForm());

  const { data: depts } = useQuery({
    queryKey: ["dept-min", active?.id], enabled: !!active,
    queryFn: async () => (await supabase.from("departments").select("id, name").eq("college_id", active!.id).order("name")).data ?? [],
  });

  const { data: rows, isLoading } = useQuery({
    queryKey: ["instructors", active?.id], enabled: !!active,
    queryFn: async () => {
      const { data, error } = await supabase.from("instructors")
        .select("id, college_id, department_id, full_name, academic_rank, email, phone, employment_type, max_weekly_hours, is_active, employee_number, full_name_ar, full_name_en, specialization, administrative_release_hours, notes")
        .eq("college_id", active!.id).order("full_name");
      if (error) throw error; return (data ?? []) as Instructor[];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!active) throw new Error("اختر كلّية");
      if (!form.full_name.trim()) throw new Error("الاسم مطلوب");
      const payload = {
        full_name: form.full_name.trim(),
        full_name_ar: form.full_name_ar.trim() || form.full_name.trim(),
        full_name_en: form.full_name_en.trim() || null,
        employee_number: form.employee_number.trim() || null,
        specialization: form.specialization.trim() || null,
        academic_rank: form.academic_rank || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        department_id: form.department_id || null,
        employment_type: form.employment_type,
        max_weekly_hours: Number(form.max_weekly_hours) || 0,
        administrative_release_hours: Number(form.administrative_release_hours) || 0,
        notes: form.notes.trim() || null,
        is_active: form.is_active,
        college_id: active.id,
      };
      if (editing) {
        const { error } = await supabase.from("instructors").update(payload).eq("id", editing.id);
        if (error) throw error;
        await logAudit({ action: "update", entity: "instructors", entityId: editing.id, collegeId: active.id });
      } else {
        const { data, error } = await supabase.from("instructors").insert(payload).select("id").single();
        if (error) throw error;
        await logAudit({ action: "create", entity: "instructors", entityId: data?.id, collegeId: active.id });
      }
    },
    onSuccess: () => {
      toast.success(editing ? "تم التحديث" : "تمت الإضافة");
      qc.invalidateQueries({ queryKey: ["instructors", active?.id] });
      setOpen(false); setEditing(null);
    },
    onError: (e: Error) => toast.error(e.message.includes("duplicate") ? "رقم الموظف مستخدم بالفعل في هذه الكلّية" : e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("instructors").delete().eq("id", id);
      if (error) throw error;
      await logAudit({ action: "delete", entity: "instructors", entityId: id, collegeId: active?.id });
    },
    onSuccess: () => { toast.success("تم الحذف"); qc.invalidateQueries({ queryKey: ["instructors", active?.id] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const startEdit = (i: Instructor) => {
    setEditing(i);
    setForm({
      full_name: i.full_name, academic_rank: i.academic_rank ?? "", email: i.email ?? "",
      phone: i.phone ?? "", department_id: i.department_id ?? "", employment_type: i.employment_type,
      max_weekly_hours: i.max_weekly_hours, is_active: i.is_active,
      employee_number: i.employee_number ?? "", full_name_ar: i.full_name_ar ?? "",
      full_name_en: i.full_name_en ?? "", specialization: i.specialization ?? "",
      administrative_release_hours: i.administrative_release_hours ?? 0, notes: i.notes ?? "",
    });
    setOpen(true);
  };
  const startCreate = () => { setEditing(null); setForm(emptyForm()); setOpen(true); };

  const deptMap = new Map((depts ?? []).map((d) => [d.id, d.name]));

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-6 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-secondary text-primary"><UserSquare2 className="h-5 w-5" /></span>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">المحاضرون</h1>
          <p className="text-sm text-muted-foreground">قائمة أعضاء هيئة التدريس في الكلّية.</p>
        </div>
      </header>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <CollegeSwitcher />
        {canManage && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button onClick={startCreate}>محاضر جديد</Button></DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>{editing ? "تعديل محاضر" : "محاضر جديد"}</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>رقم الموظف</Label><Input value={form.employee_number} onChange={(e) => setForm({ ...form, employee_number: e.target.value })} /></div>
                  <div><Label>التخصص</Label><Input value={form.specialization} onChange={(e) => setForm({ ...form, specialization: e.target.value })} /></div>
                </div>
                <div><Label>الاسم الكامل (افتراضي)</Label><Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>الاسم بالعربية</Label><Input value={form.full_name_ar} onChange={(e) => setForm({ ...form, full_name_ar: e.target.value })} /></div>
                  <div><Label>الاسم بالإنجليزية</Label><Input dir="ltr" value={form.full_name_en} onChange={(e) => setForm({ ...form, full_name_en: e.target.value })} /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>الرتبة العلمية</Label>
                    <Select value={form.academic_rank} onValueChange={(v) => setForm({ ...form, academic_rank: v })}>
                      <SelectTrigger><SelectValue placeholder="اختر الرتبة" /></SelectTrigger>
                      <SelectContent>{RANKS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label>القسم</Label>
                    <Select value={form.department_id} onValueChange={(v) => setForm({ ...form, department_id: v })}>
                      <SelectTrigger><SelectValue placeholder="اختر القسم" /></SelectTrigger>
                      <SelectContent>{(depts ?? []).map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>البريد الإلكتروني</Label><Input dir="ltr" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
                  <div><Label>الجوال</Label><Input dir="ltr" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>نوع التعاقد</Label>
                    <Select value={form.employment_type} onValueChange={(v) => setForm({ ...form, employment_type: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{EMP.map((e) => <SelectItem key={e.v} value={e.v}>{e.l}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label>الحد الأسبوعي للساعات</Label><Input type="number" value={form.max_weekly_hours} onChange={(e) => setForm({ ...form, max_weekly_hours: Number(e.target.value) })} /></div>
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
          : !rows || rows.length === 0 ? <p className="p-6 text-center text-muted-foreground">لا يوجد محاضرون بعد.</p>
          : <ul className="divide-y divide-border">
              {rows.map((i) => (
                <li key={i.id} className="flex items-center justify-between p-4">
                  <div>
                    <p className="font-semibold">{i.full_name} {!i.is_active && <span className="ms-2 rounded bg-muted px-2 py-0.5 text-[10px]">غير نشط</span>}</p>
                    <p className="text-xs text-muted-foreground">
                      {i.academic_rank ?? "—"} · {i.department_id ? deptMap.get(i.department_id) ?? "—" : "بدون قسم"} · {EMP.find((e) => e.v === i.employment_type)?.l} · {i.max_weekly_hours} س/أسبوع
                    </p>
                    {(i.email || i.phone) && <p className="text-xs text-muted-foreground" dir="ltr">{i.email ?? ""} {i.phone ? ` · ${i.phone}` : ""}</p>}
                  </div>
                  {canManage && (
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => startEdit(i)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => { if (confirm("حذف المحاضر؟")) del.mutate(i.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>}
      </Card>
    </div>
  );
}
