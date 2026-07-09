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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import { FileSpreadsheet, Pencil, Trash2, Plus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/import-templates")({
  head: () => ({ meta: [{ title: "قوالب الاستيراد" }] }),
  component: TemplatesPage,
});

const ENTITIES = [
  { v: "study_plan_full", l: "خطة دراسية كاملة" },
  { v: "teaching_assignments", l: "إسناد تدريسي" },
  { v: "instructors", l: "محاضرون" },
  { v: "rooms", l: "قاعات" },
  { v: "courses", l: "مقررات" },
  { v: "course_offerings", l: "مقررات الفصل" },
];

const DTYPES = [
  { v: "text", l: "نص" },
  { v: "number", l: "رقم عشري" },
  { v: "integer", l: "عدد صحيح" },
  { v: "boolean", l: "نعم/لا" },
  { v: "date", l: "تاريخ" },
  { v: "enum", l: "قائمة" },
  { v: "uuid", l: "معرّف" },
];

interface Tpl { id: string; college_id: string; template_key: string; name_ar: string; description: string | null; version: number; target_entity: string; sheet_name: string | null; sample_file_url: string | null; is_active: boolean }
interface Col { id: string; template_id: string; column_order: number; header_ar: string; field_key: string; data_type: string; is_required: boolean; enum_values: unknown; example: string | null; notes: string | null }

function TemplatesPage() {
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Tpl | null>(null);
  const [form, setForm] = useState<Partial<Tpl>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [colOpen, setColOpen] = useState(false);
  const [colEdit, setColEdit] = useState<Col | null>(null);
  const [colForm, setColForm] = useState<Partial<Col> & { template_id?: string }>({});

  const { data: tpls } = useQuery({
    queryKey: ["import_tpls", active?.id], enabled: !!active,
    queryFn: async () => ((await supabase.from("import_templates").select("*").eq("college_id", active!.id).order("created_at", { ascending: false })).data ?? []) as Tpl[],
  });
  const { data: cols } = useQuery({
    queryKey: ["import_cols", active?.id], enabled: !!active,
    queryFn: async () => ((await supabase.from("import_template_columns").select("*").eq("college_id", active!.id).order("column_order")).data ?? []) as Col[],
  });

  const saveTpl = useMutation({
    mutationFn: async () => {
      if (!active) throw new Error("اختر كلّية");
      if (!form.template_key || !form.name_ar || !form.target_entity) throw new Error("الرمز والاسم والكيان المستهدف مطلوبة");
      const payload = {
        college_id: active.id,
        template_key: form.template_key,
        name_ar: form.name_ar,
        target_entity: form.target_entity,
        version: form.version ?? 1,
        is_active: form.is_active ?? true,
        description: form.description ?? null,
        sheet_name: form.sheet_name ?? null,
        sample_file_url: form.sample_file_url ?? null,
      };
      if (editing) {
        const { error } = await supabase.from("import_templates").update(payload).eq("id", editing.id);
        if (error) throw error;
        await logAudit({ action: "update", entity: "import_templates", entityId: editing.id, collegeId: active.id });
      } else {
        const { data, error } = await supabase.from("import_templates").insert(payload).select("id").single();
        if (error) throw error;
        await logAudit({ action: "create", entity: "import_templates", entityId: data?.id, collegeId: active.id });
      }
    },
    onSuccess: () => { toast.success("تم الحفظ"); qc.invalidateQueries({ queryKey: ["import_tpls", active?.id] }); setOpen(false); setEditing(null); },
    onError: (e: Error) => toast.error(e.message),
  });

  const delTpl = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("import_templates").delete().eq("id", id); if (error) throw error; await logAudit({ action: "delete", entity: "import_templates", entityId: id, collegeId: active?.id }); },
    onSuccess: () => { toast.success("تم الحذف"); qc.invalidateQueries({ queryKey: ["import_tpls", active?.id] }); qc.invalidateQueries({ queryKey: ["import_cols", active?.id] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveCol = useMutation({
    mutationFn: async () => {
      if (!active || !colForm.template_id) throw new Error("القالب مطلوب");
      if (!colForm.header_ar || !colForm.field_key) throw new Error("الترويسة العربية ومفتاح الحقل مطلوبان");
      const payload = {
        college_id: active.id, template_id: colForm.template_id,
        column_order: colForm.column_order ?? 0,
        header_ar: colForm.header_ar, field_key: colForm.field_key,
        data_type: colForm.data_type ?? "text",
        is_required: colForm.is_required ?? false,
        enum_values: (colForm.enum_values ?? null) as never,
        example: colForm.example ?? null, notes: colForm.notes ?? null,
      };
      if (colEdit) {
        const { error } = await supabase.from("import_template_columns").update(payload).eq("id", colEdit.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("import_template_columns").insert(payload);
        if (error) throw error;
      }
      await logAudit({ action: colEdit ? "update" : "create", entity: "import_template_columns", entityId: colEdit?.id, collegeId: active.id });
    },
    onSuccess: () => { toast.success("تم الحفظ"); qc.invalidateQueries({ queryKey: ["import_cols", active?.id] }); setColOpen(false); setColEdit(null); },
    onError: (e: Error) => toast.error(e.message),
  });

  const delCol = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("import_template_columns").delete().eq("id", id); if (error) throw error; await logAudit({ action: "delete", entity: "import_template_columns", entityId: id, collegeId: active?.id }); },
    onSuccess: () => { toast.success("تم الحذف"); qc.invalidateQueries({ queryKey: ["import_cols", active?.id] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const startTpl = (t?: Tpl) => {
    setEditing(t ?? null);
    setForm(t ?? { template_key: "", name_ar: "", target_entity: "study_plan_full", version: 1, is_active: true });
    setOpen(true);
  };
  const startCol = (templateId: string, c?: Col) => {
    setColEdit(c ?? null);
    setColForm(c ? { ...c, template_id: c.template_id } : { template_id: templateId, column_order: 0, data_type: "text", is_required: false });
    setColOpen(true);
  };

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-6 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-secondary text-primary"><FileSpreadsheet className="h-5 w-5" /></span>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">قوالب الاستيراد</h1>
          <p className="text-sm text-muted-foreground">تعريف الأعمدة المتوقعة في ملفات Excel للاستيراد المستقبلي.</p>
        </div>
      </header>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <CollegeSwitcher />
        {canManage && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button onClick={() => startTpl()}>قالب جديد</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{editing ? "تعديل قالب" : "قالب جديد"}</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>الرمز</Label><Input value={form.template_key ?? ""} onChange={(e) => setForm({ ...form, template_key: e.target.value })} /></div>
                  <div><Label>الإصدار</Label><Input type="number" value={form.version ?? 1} onChange={(e) => setForm({ ...form, version: Number(e.target.value) })} /></div>
                </div>
                <div><Label>الاسم بالعربية</Label><Input value={form.name_ar ?? ""} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} /></div>
                <div><Label>الكيان المستهدف</Label>
                  <Select value={form.target_entity ?? "study_plan_full"} onValueChange={(v) => setForm({ ...form, target_entity: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{ENTITIES.map((e) => <SelectItem key={e.v} value={e.v}>{e.l}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>اسم ورقة Excel</Label><Input value={form.sheet_name ?? ""} onChange={(e) => setForm({ ...form, sheet_name: e.target.value })} /></div>
                <div><Label>رابط ملف نموذج</Label><Input value={form.sample_file_url ?? ""} onChange={(e) => setForm({ ...form, sample_file_url: e.target.value })} /></div>
                <div><Label>وصف</Label><Input value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
                <label className="flex items-center gap-2 text-sm"><Checkbox checked={form.is_active ?? true} onCheckedChange={(v) => setForm({ ...form, is_active: !!v })} /> نشط</label>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
                <Button onClick={() => saveTpl.mutate()} disabled={saveTpl.isPending}>حفظ</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Card className="overflow-hidden">
        {!tpls || tpls.length === 0 ? <p className="p-6 text-center text-muted-foreground">لا توجد قوالب بعد.</p>
          : <ul className="divide-y divide-border">
              {tpls.map((t) => {
                const tcols = (cols ?? []).filter((c) => c.template_id === t.id);
                const open = expanded === t.id;
                return (
                  <li key={t.id} className="p-4">
                    <div className="flex items-center justify-between gap-3">
                      <button onClick={() => setExpanded(open ? null : t.id)} className="min-w-0 flex-1 text-right">
                        <p className="font-semibold">{t.name_ar} <span className="rounded bg-secondary px-2 py-0.5 text-[11px]">v{t.version}</span> {!t.is_active && <span className="rounded bg-destructive/20 px-2 py-0.5 text-[11px]">معطّل</span>}</p>
                        <p className="text-xs text-muted-foreground"><span dir="ltr">{t.template_key}</span> · {ENTITIES.find((e) => e.v === t.target_entity)?.l ?? t.target_entity} · {tcols.length} عمود</p>
                      </button>
                      {canManage && (
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => startTpl(t)}><Pencil className="h-3.5 w-3.5" /></Button>
                          <Button size="sm" variant="ghost" onClick={() => { if (confirm("حذف القالب وأعمدته؟")) delTpl.mutate(t.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </div>
                      )}
                    </div>
                    {open && (
                      <div className="mt-3 rounded border bg-secondary/30 p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <p className="text-sm font-medium">أعمدة القالب</p>
                          {canManage && <Button size="sm" variant="outline" onClick={() => startCol(t.id)}><Plus className="me-1 h-3.5 w-3.5" />عمود</Button>}
                        </div>
                        {tcols.length === 0 ? <p className="text-xs text-muted-foreground">لا توجد أعمدة بعد.</p>
                          : <ul className="divide-y divide-border">
                              {tcols.map((c) => (
                                <li key={c.id} className="flex items-center justify-between py-2 text-sm">
                                  <div>
                                    <p>{c.column_order}. {c.header_ar} {c.is_required && <span className="text-destructive">*</span>}</p>
                                    <p className="text-xs text-muted-foreground"><span dir="ltr">{c.field_key}</span> · {DTYPES.find((d) => d.v === c.data_type)?.l}</p>
                                  </div>
                                  {canManage && (
                                    <div className="flex gap-1">
                                      <Button size="sm" variant="ghost" onClick={() => startCol(t.id, c)}><Pencil className="h-3.5 w-3.5" /></Button>
                                      <Button size="sm" variant="ghost" onClick={() => { if (confirm("حذف العمود؟")) delCol.mutate(c.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                                    </div>
                                  )}
                                </li>
                              ))}
                            </ul>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>}
      </Card>

      <Dialog open={colOpen} onOpenChange={setColOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{colEdit ? "تعديل عمود" : "عمود جديد"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div><Label>الترتيب</Label><Input type="number" value={colForm.column_order ?? 0} onChange={(e) => setColForm({ ...colForm, column_order: Number(e.target.value) })} /></div>
              <div className="col-span-2"><Label>الترويسة (عربي)</Label><Input value={colForm.header_ar ?? ""} onChange={(e) => setColForm({ ...colForm, header_ar: e.target.value })} /></div>
            </div>
            <div><Label>مفتاح الحقل</Label><Input value={colForm.field_key ?? ""} onChange={(e) => setColForm({ ...colForm, field_key: e.target.value })} placeholder="course_name" /></div>
            <div><Label>نوع البيانات</Label>
              <Select value={colForm.data_type ?? "text"} onValueChange={(v) => setColForm({ ...colForm, data_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{DTYPES.map((d) => <SelectItem key={d.v} value={d.v}>{d.l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>مثال</Label><Input value={colForm.example ?? ""} onChange={(e) => setColForm({ ...colForm, example: e.target.value })} /></div>
            <div><Label>ملاحظات</Label><Input value={colForm.notes ?? ""} onChange={(e) => setColForm({ ...colForm, notes: e.target.value })} /></div>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={colForm.is_required ?? false} onCheckedChange={(v) => setColForm({ ...colForm, is_required: !!v })} /> إلزامي</label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setColOpen(false)}>إلغاء</Button>
            <Button onClick={() => saveCol.mutate()} disabled={saveCol.isPending}>حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
