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
import { Library, Pencil, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/courses")({
  head: () => ({ meta: [{ title: "المقررات" }] }),
  component: CoursesPage,
});

interface Course { id: string; name: string; code: string; department_id: string; credit_hours: number; theory_hours: number; practical_hours: number; college_id: string }

function CoursesPage() {
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Course | null>(null);
  const [form, setForm] = useState({ name: "", code: "", department_id: "", credit_hours: 3, theory_hours: 3, practical_hours: 0 });

  const { data: depts } = useQuery({
    queryKey: ["dept-min", active?.id], enabled: !!active,
    queryFn: async () => (await supabase.from("departments").select("id, name").eq("college_id", active!.id).order("name")).data ?? [],
  });

  const { data: rows, isLoading } = useQuery({
    queryKey: ["courses", active?.id], enabled: !!active,
    queryFn: async () => {
      const { data, error } = await supabase.from("courses")
        .select("id, name, code, department_id, credit_hours, theory_hours, practical_hours, college_id")
        .eq("college_id", active!.id).order("code");
      if (error) throw error; return (data ?? []) as Course[];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!active) throw new Error("اختر كلّية");
      if (!form.name.trim() || !form.code.trim() || !form.department_id) throw new Error("الحقول الأساسية مطلوبة");
      const payload = { ...form, name: form.name.trim(), code: form.code.trim(), college_id: active.id };
      if (editing) {
        const { error } = await supabase.from("courses").update(payload).eq("id", editing.id);
        if (error) throw error;
        await logAudit({ action: "update", entity: "courses", entityId: editing.id, collegeId: active.id });
      } else {
        const { data, error } = await supabase.from("courses").insert(payload).select("id").single();
        if (error) throw error;
        await logAudit({ action: "create", entity: "courses", entityId: data?.id, collegeId: active.id });
      }
    },
    onSuccess: () => {
      toast.success(editing ? "تم التحديث" : "تمت الإضافة");
      qc.invalidateQueries({ queryKey: ["courses", active?.id] });
      setOpen(false); setEditing(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("courses").delete().eq("id", id);
      if (error) throw error;
      await logAudit({ action: "delete", entity: "courses", entityId: id, collegeId: active?.id });
    },
    onSuccess: () => { toast.success("تم الحذف"); qc.invalidateQueries({ queryKey: ["courses", active?.id] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const startEdit = (c: Course) => { setEditing(c); setForm({ name: c.name, code: c.code, department_id: c.department_id, credit_hours: c.credit_hours, theory_hours: c.theory_hours, practical_hours: c.practical_hours }); setOpen(true); };
  const startCreate = () => { setEditing(null); setForm({ name: "", code: "", department_id: "", credit_hours: 3, theory_hours: 3, practical_hours: 0 }); setOpen(true); };

  const deptMap = new Map((depts ?? []).map((d) => [d.id, d.name]));

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-6 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-secondary text-primary"><Library className="h-5 w-5" /></span>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">المقررات</h1>
          <p className="text-sm text-muted-foreground">كتالوج المقررات الدراسية.</p>
        </div>
      </header>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <CollegeSwitcher />
        {canManage && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button onClick={startCreate} disabled={!depts || depts.length === 0}>مقرر جديد</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{editing ? "تعديل المقرر" : "مقرر جديد"}</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>القسم</Label>
                  <Select value={form.department_id} onValueChange={(v) => setForm({ ...form, department_id: v })}>
                    <SelectTrigger><SelectValue placeholder="اختر القسم" /></SelectTrigger>
                    <SelectContent>{(depts ?? []).map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>الرمز</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
                  <div><Label>الاسم</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div><Label>الساعات المعتمدة</Label><Input type="number" step="0.5" value={form.credit_hours} onChange={(e) => setForm({ ...form, credit_hours: Number(e.target.value) })} /></div>
                  <div><Label>نظري</Label><Input type="number" value={form.theory_hours} onChange={(e) => setForm({ ...form, theory_hours: Number(e.target.value) })} /></div>
                  <div><Label>عملي</Label><Input type="number" value={form.practical_hours} onChange={(e) => setForm({ ...form, practical_hours: Number(e.target.value) })} /></div>
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

      {(!depts || depts.length === 0) && <p className="mb-3 rounded border border-dashed border-border bg-muted/30 p-3 text-sm text-muted-foreground">أنشئ قسمًا أولاً.</p>}

      <Card className="overflow-hidden">
        {isLoading ? <p className="p-6 text-center text-muted-foreground">جارٍ التحميل...</p>
          : !rows || rows.length === 0 ? <p className="p-6 text-center text-muted-foreground">لا توجد مقررات بعد.</p>
          : <ul className="divide-y divide-border">
              {rows.map((c) => (
                <li key={c.id} className="flex items-center justify-between p-4">
                  <div>
                    <p className="font-semibold"><span dir="ltr">{c.code}</span> — {c.name}</p>
                    <p className="text-xs text-muted-foreground">{deptMap.get(c.department_id) ?? "—"} · {c.credit_hours} س.م · نظري {c.theory_hours} / عملي {c.practical_hours}</p>
                  </div>
                  {canManage && (
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => startEdit(c)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => { if (confirm("حذف المقرر؟")) del.mutate(c.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>}
      </Card>
    </div>
  );
}
