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
import { CalendarRange, Pencil, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/terms")({
  head: () => ({ meta: [{ title: "الفصول الدراسية" }] }),
  component: TermsPage,
});

interface Term { id: string; name: string; code: string; start_date: string | null; end_date: string | null; is_active: boolean; college_id: string; academic_year: string | null; term_type: string | null; teaching_weeks_count: number | null }

function TermsPage() {
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Term | null>(null);
  const [form, setForm] = useState({ name: "", code: "", start_date: "", end_date: "", is_active: false, academic_year: "", term_type: "", teaching_weeks_count: "" });

  const { data: rows, isLoading } = useQuery({
    queryKey: ["terms", active?.id], enabled: !!active,
    queryFn: async () => {
      const { data, error } = await supabase.from("academic_terms")
        .select("id, name, code, start_date, end_date, is_active, college_id")
        .eq("college_id", active!.id).order("start_date", { ascending: false });
      if (error) throw error; return (data ?? []) as Term[];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!active) throw new Error("اختر كلّية");
      if (!form.name.trim() || !form.code.trim()) throw new Error("الاسم والرمز مطلوبان");
      const payload = {
        name: form.name.trim(), code: form.code.trim(),
        start_date: form.start_date || null, end_date: form.end_date || null,
        is_active: form.is_active, college_id: active.id,
        academic_year: form.academic_year.trim() || null,
        term_type: form.term_type || null,
        teaching_weeks_count: form.teaching_weeks_count ? parseInt(form.teaching_weeks_count, 10) : null,
      };
      if (editing) {
        const { error } = await supabase.from("academic_terms").update(payload).eq("id", editing.id);
        if (error) throw error;
        await logAudit({ action: "update", entity: "academic_terms", entityId: editing.id, collegeId: active.id });
      } else {
        const { data, error } = await supabase.from("academic_terms").insert(payload).select("id").single();
        if (error) throw error;
        await logAudit({ action: "create", entity: "academic_terms", entityId: data?.id, collegeId: active.id });
      }
    },
    onSuccess: () => {
      toast.success(editing ? "تم التحديث" : "تمت الإضافة");
      qc.invalidateQueries({ queryKey: ["terms", active?.id] });
      setOpen(false); setEditing(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("academic_terms").delete().eq("id", id);
      if (error) throw error;
      await logAudit({ action: "delete", entity: "academic_terms", entityId: id, collegeId: active?.id });
    },
    onSuccess: () => { toast.success("تم الحذف"); qc.invalidateQueries({ queryKey: ["terms", active?.id] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const startEdit = (t: Term) => { setEditing(t); setForm({ name: t.name, code: t.code, start_date: t.start_date ?? "", end_date: t.end_date ?? "", is_active: t.is_active }); setOpen(true); };
  const startCreate = () => { setEditing(null); setForm({ name: "", code: "", start_date: "", end_date: "", is_active: false }); setOpen(true); };

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-6 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-secondary text-primary"><CalendarRange className="h-5 w-5" /></span>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">الفصول الدراسية</h1>
          <p className="text-sm text-muted-foreground">الفصول/الفترات الأكاديمية للكلّية.</p>
        </div>
      </header>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <CollegeSwitcher />
        {canManage && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button onClick={startCreate}>فصل جديد</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{editing ? "تعديل الفصل" : "فصل جديد"}</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>الاسم</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                <div><Label>الرمز</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>تاريخ البداية</Label><Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></div>
                  <div><Label>تاريخ النهاية</Label><Input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></div>
                </div>
                <label className="flex items-center gap-2 text-sm"><Checkbox checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: !!v })} /> الفصل الحالي</label>
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
          : !rows || rows.length === 0 ? <p className="p-6 text-center text-muted-foreground">لا توجد فصول بعد.</p>
          : <ul className="divide-y divide-border">
              {rows.map((t) => (
                <li key={t.id} className="flex items-center justify-between p-4">
                  <div>
                    <p className="font-semibold">{t.name} {t.is_active && <span className="rounded bg-accent/20 px-2 py-0.5 text-[11px] text-accent-foreground">حالي</span>}</p>
                    <p className="text-xs text-muted-foreground"><span dir="ltr">{t.code}</span> · {t.start_date ?? "—"} ← {t.end_date ?? "—"}</p>
                  </div>
                  {canManage && (
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => startEdit(t)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => { if (confirm("حذف الفصل؟")) del.mutate(t.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>}
      </Card>
    </div>
  );
}
