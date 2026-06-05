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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import { Building2, Pencil, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/departments")({
  head: () => ({ meta: [{ title: "الأقسام" }] }),
  component: DepartmentsPage,
});

interface Dept { id: string; name: string; code: string; college_id: string; study_system: "regular" | "parallel" | "both" }

const STUDY_SYSTEM_LABELS: Record<string, string> = {
  regular: "النظام العام / الصباحي",
  parallel: "النظام الموازي / المسائي",
  both: "عام وموازي",
};

function DepartmentsPage() {
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Dept | null>(null);
  const [form, setForm] = useState<{ name: string; code: string; study_system: "regular" | "parallel" | "both" }>({ name: "", code: "", study_system: "regular" });

  const { data: rows, isLoading } = useQuery({
    queryKey: ["departments", active?.id],
    enabled: !!active,
    queryFn: async () => {
      const { data, error } = await supabase.from("departments")
        .select("id, name, code, college_id").eq("college_id", active!.id).order("name");
      if (error) throw error; return (data ?? []) as Dept[];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!active) throw new Error("اختر كلّية");
      const payload = { name: form.name.trim(), code: form.code.trim(), college_id: active.id };
      if (!payload.name || !payload.code) throw new Error("الاسم والرمز مطلوبان");
      if (editing) {
        const { error } = await supabase.from("departments").update(payload).eq("id", editing.id);
        if (error) throw error;
        await logAudit({ action: "update", entity: "departments", entityId: editing.id, collegeId: active.id });
      } else {
        const { data, error } = await supabase.from("departments").insert(payload).select("id").single();
        if (error) throw error;
        await logAudit({ action: "create", entity: "departments", entityId: data?.id, collegeId: active.id });
      }
    },
    onSuccess: () => {
      toast.success(editing ? "تم التحديث" : "تمت الإضافة");
      qc.invalidateQueries({ queryKey: ["departments", active?.id] });
      setOpen(false); setEditing(null); setForm({ name: "", code: "" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("departments").delete().eq("id", id);
      if (error) throw error;
      await logAudit({ action: "delete", entity: "departments", entityId: id, collegeId: active?.id });
    },
    onSuccess: () => { toast.success("تم الحذف"); qc.invalidateQueries({ queryKey: ["departments", active?.id] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const startEdit = (d: Dept) => { setEditing(d); setForm({ name: d.name, code: d.code }); setOpen(true); };
  const startCreate = () => { setEditing(null); setForm({ name: "", code: "" }); setOpen(true); };

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-6 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-secondary text-primary"><Building2 className="h-5 w-5" /></span>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">الأقسام الأكاديمية</h1>
          <p className="text-sm text-muted-foreground">إدارة الأقسام داخل الكلّية المحددة.</p>
        </div>
      </header>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <CollegeSwitcher />
        {canManage && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button onClick={startCreate}>قسم جديد</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{editing ? "تعديل القسم" : "قسم جديد"}</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>الاسم</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                <div><Label>الرمز</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
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
          : !rows || rows.length === 0 ? <p className="p-6 text-center text-muted-foreground">لا توجد أقسام بعد.</p>
          : <ul className="divide-y divide-border">
              {rows.map((d) => (
                <li key={d.id} className="flex items-center justify-between p-4">
                  <div>
                    <p className="font-semibold">{d.name}</p>
                    <p className="text-xs text-muted-foreground" dir="ltr">{d.code}</p>
                  </div>
                  {canManage && (
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => startEdit(d)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => { if (confirm("حذف القسم؟")) del.mutate(d.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>}
      </Card>
    </div>
  );
}
