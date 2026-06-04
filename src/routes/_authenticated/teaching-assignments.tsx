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
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import { ROOM_TYPES } from "./rooms";
import { Briefcase, Pencil, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/teaching-assignments")({
  head: () => ({ meta: [{ title: "التكليفات التدريسية" }] }),
  component: AssignmentsPage,
});

interface TA {
  id: string; college_id: string; course_offering_id: string; instructor_id: string;
  section_number: string | null; session_type: string; weekly_hours: number;
  required_room_type: string | null; notes: string | null;
}

const SESSION_TYPES = [
  { v: "lecture", l: "محاضرة" },
  { v: "lab", l: "عملي" },
  { v: "tutorial", l: "تمارين" },
  { v: "seminar", l: "حلقة بحث" },
];

function emptyForm() { return { course_offering_id: "", instructor_id: "", section_number: "", session_type: "lecture", weekly_hours: 3, required_room_type: "", notes: "" }; }

function AssignmentsPage() {
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<TA | null>(null);
  const [form, setForm] = useState(emptyForm());

  const { data: offerings } = useQuery({
    queryKey: ["offerings-min", active?.id], enabled: !!active,
    queryFn: async () => {
      const { data } = await supabase.from("course_offerings")
        .select("id, course_id, term_id")
        .eq("college_id", active!.id);
      return data ?? [];
    },
  });
  const { data: courses } = useQuery({
    queryKey: ["courses-min2", active?.id], enabled: !!active,
    queryFn: async () => (await supabase.from("courses").select("id, code, name").eq("college_id", active!.id)).data ?? [],
  });
  const { data: terms } = useQuery({
    queryKey: ["terms-min2", active?.id], enabled: !!active,
    queryFn: async () => (await supabase.from("academic_terms").select("id, name").eq("college_id", active!.id)).data ?? [],
  });
  const { data: instructors } = useQuery({
    queryKey: ["instr-min", active?.id], enabled: !!active,
    queryFn: async () => (await supabase.from("instructors").select("id, full_name").eq("college_id", active!.id).eq("is_active", true).order("full_name")).data ?? [],
  });


  const { data: rows, isLoading } = useQuery({
    queryKey: ["assignments", active?.id], enabled: !!active,
    queryFn: async () => {
      const { data, error } = await supabase.from("teaching_assignments").select("*").eq("college_id", active!.id).order("created_at", { ascending: false });
      if (error) throw error; return (data ?? []) as TA[];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!active) throw new Error("اختر كلّية");
      if (!form.course_offering_id || !form.instructor_id) throw new Error("المقرر المطروح والمحاضر مطلوبان");
      const payload = {
        college_id: active.id,
        course_offering_id: form.course_offering_id,
        instructor_id: form.instructor_id,
        section_number: form.section_number.trim() || null,
        session_type: form.session_type,
        weekly_hours: Number(form.weekly_hours) || 0,
        required_room_type: form.required_room_type || null,
        notes: form.notes.trim() || null,
      };
      if (editing) {
        const { error } = await supabase.from("teaching_assignments").update(payload).eq("id", editing.id);
        if (error) throw error;
        await logAudit({ action: "update", entity: "teaching_assignments", entityId: editing.id, collegeId: active.id });
      } else {
        const { data, error } = await supabase.from("teaching_assignments").insert(payload).select("id").single();
        if (error) throw error;
        await logAudit({ action: "create", entity: "teaching_assignments", entityId: data?.id, collegeId: active.id });
      }
    },
    onSuccess: () => {
      toast.success(editing ? "تم التحديث" : "تمت الإضافة");
      qc.invalidateQueries({ queryKey: ["assignments", active?.id] });
      setOpen(false); setEditing(null);
    },
    onError: (e: Error) => toast.error(e.message.includes("duplicate") ? "هذا التكليف موجود مسبقاً" : e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("teaching_assignments").delete().eq("id", id);
      if (error) throw error;
      await logAudit({ action: "delete", entity: "teaching_assignments", entityId: id, collegeId: active?.id });
    },
    onSuccess: () => { toast.success("تم الحذف"); qc.invalidateQueries({ queryKey: ["assignments", active?.id] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const startEdit = (a: TA) => {
    setEditing(a);
    setForm({
      course_offering_id: a.course_offering_id, instructor_id: a.instructor_id,
      section_number: a.section_number ?? "", session_type: a.session_type,
      weekly_hours: a.weekly_hours, required_room_type: a.required_room_type ?? "", notes: a.notes ?? "",
    });
    setOpen(true);
  };
  const startCreate = () => { setEditing(null); setForm(emptyForm()); setOpen(true); };

  type OfferingRow = { id: string; courses: { code: string; name: string } | null; academic_terms: { name: string } | null };
  const offMap = new Map(((offerings ?? []) as OfferingRow[]).map((o) => {
    const label = `${o.courses?.code ?? ""} — ${o.courses?.name ?? ""} (${o.academic_terms?.name ?? ""})`;
    return [o.id, label];
  }));
  const insMap = new Map((instructors ?? []).map((i) => [i.id, i.full_name]));

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-6 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-secondary text-primary"><Briefcase className="h-5 w-5" /></span>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">التكليفات التدريسية</h1>
          <p className="text-sm text-muted-foreground">ربط المحاضرين بالمقررات المطروحة.</p>
        </div>
      </header>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <CollegeSwitcher />
        {canManage && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button onClick={startCreate} disabled={!offerings?.length || !instructors?.length}>تكليف جديد</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>{editing ? "تعديل تكليف" : "تكليف جديد"}</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>المقرر المطروح</Label>
                  <Select value={form.course_offering_id} onValueChange={(v) => setForm({ ...form, course_offering_id: v })}>
                    <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
                    <SelectContent>
                      {((offerings ?? []) as OfferingRow[]).map((o) => (
                        <SelectItem key={o.id} value={o.id}>{offMap.get(o.id)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>المحاضر</Label>
                  <Select value={form.instructor_id} onValueChange={(v) => setForm({ ...form, instructor_id: v })}>
                    <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
                    <SelectContent>{(instructors ?? []).map((i) => <SelectItem key={i.id} value={i.id}>{i.full_name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div><Label>نوع الجلسة</Label>
                    <Select value={form.session_type} onValueChange={(v) => setForm({ ...form, session_type: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{SESSION_TYPES.map((s) => <SelectItem key={s.v} value={s.v}>{s.l}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label>الشُّعبة</Label><Input value={form.section_number} onChange={(e) => setForm({ ...form, section_number: e.target.value })} placeholder="A" /></div>
                  <div><Label>ساعات/أسبوع</Label><Input type="number" step="0.5" value={form.weekly_hours} onChange={(e) => setForm({ ...form, weekly_hours: Number(e.target.value) })} /></div>
                </div>
                <div><Label>نوع القاعة المطلوبة (اختياري)</Label>
                  <Select value={form.required_room_type || "_any"} onValueChange={(v) => setForm({ ...form, required_room_type: v === "_any" ? "" : v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_any">— غير محدد —</SelectItem>
                      {ROOM_TYPES.map((t) => <SelectItem key={t.v} value={t.v}>{t.l}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>ملاحظات</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
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
          : !rows || rows.length === 0 ? <p className="p-6 text-center text-muted-foreground">لا توجد تكليفات بعد.</p>
          : <ul className="divide-y divide-border">
              {rows.map((a) => (
                <li key={a.id} className="flex items-center justify-between p-4">
                  <div>
                    <p className="font-semibold">{insMap.get(a.instructor_id) ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">
                      {offMap.get(a.course_offering_id) ?? "—"} · {SESSION_TYPES.find((s) => s.v === a.session_type)?.l}
                      {a.section_number && ` · شُعبة ${a.section_number}`} · {a.weekly_hours} س/أ
                      {a.required_room_type && ` · ${ROOM_TYPES.find((t) => t.v === a.required_room_type)?.l}`}
                    </p>
                  </div>
                  {canManage && (
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => startEdit(a)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => { if (confirm("حذف التكليف؟")) del.mutate(a.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>}
      </Card>
    </div>
  );
}
