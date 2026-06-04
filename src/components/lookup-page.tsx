import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ReactNode, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCollege } from "@/hooks/use-colleges";
import { useCanManageActiveCollege } from "@/hooks/use-can-manage";
import { CollegeSwitcher } from "@/components/college-switcher";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import { Pencil, Trash2 } from "lucide-react";

export interface LookupRow { id: string; college_id: string; [k: string]: unknown }

export interface LookupPageProps<T extends LookupRow> {
  table: string;
  title: string;
  subtitle?: string;
  icon: ReactNode;
  orderBy?: string;
  emptyForm: () => Record<string, unknown>;
  toForm: (row: T) => Record<string, unknown>;
  renderForm: (form: Record<string, unknown>, set: (f: Record<string, unknown>) => void) => ReactNode;
  renderRow: (row: T) => ReactNode;
  validate?: (form: Record<string, unknown>) => string | null;
  dialogClassName?: string;
}

export function LookupPage<T extends LookupRow>({ table, title, subtitle, icon, orderBy = "created_at", emptyForm, toForm, renderForm, renderRow, validate, dialogClassName }: LookupPageProps<T>) {
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<T | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>(emptyForm());

  const { data: rows, isLoading } = useQuery({
    queryKey: [table, active?.id], enabled: !!active,
    queryFn: async () => {
      const { data, error } = await supabase.from(table as never).select("*").eq("college_id", active!.id).order(orderBy, { ascending: false });
      if (error) throw error; return (data ?? []) as T[];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!active) throw new Error("اختر كلّية");
      const err = validate?.(form); if (err) throw new Error(err);
      const payload = { ...form, college_id: active.id };
      if (editing) {
        const { error } = await supabase.from(table as never).update(payload as never).eq("id", editing.id);
        if (error) throw error;
        await logAudit({ action: "update", entity: table, entityId: editing.id, collegeId: active.id });
      } else {
        const { data, error } = await supabase.from(table as never).insert(payload as never).select("id").single();
        if (error) throw error;
        const inserted = data as { id: string } | null;
        await logAudit({ action: "create", entity: table, entityId: inserted?.id, collegeId: active.id });
      }
    },
    onSuccess: () => {
      toast.success(editing ? "تم التحديث" : "تمت الإضافة");
      qc.invalidateQueries({ queryKey: [table, active?.id] });
      setOpen(false); setEditing(null);
    },
    onError: (e: Error) => toast.error(e.message.includes("duplicate") ? "هذا السجل موجود مسبقاً" : e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from(table as never).delete().eq("id", id);
      if (error) throw error;
      await logAudit({ action: "delete", entity: table, entityId: id, collegeId: active?.id });
    },
    onSuccess: () => { toast.success("تم الحذف"); qc.invalidateQueries({ queryKey: [table, active?.id] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const startEdit = (r: T) => { setEditing(r); setForm(toForm(r)); setOpen(true); };
  const startCreate = () => { setEditing(null); setForm(emptyForm()); setOpen(true); };

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-6 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-secondary text-primary">{icon}</span>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{title}</h1>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      </header>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <CollegeSwitcher />
        {canManage && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button onClick={startCreate}>إضافة</Button></DialogTrigger>
            <DialogContent className={dialogClassName}>
              <DialogHeader><DialogTitle>{editing ? "تعديل" : "إضافة"}</DialogTitle></DialogHeader>
              <div className="space-y-3">{renderForm(form, setForm)}</div>
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
          : !rows || rows.length === 0 ? <p className="p-6 text-center text-muted-foreground">لا توجد سجلات بعد.</p>
          : <ul className="divide-y divide-border">
              {rows.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0 flex-1">{renderRow(r)}</div>
                  {canManage && (
                    <div className="flex shrink-0 gap-1">
                      <Button size="sm" variant="ghost" onClick={() => startEdit(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => { if (confirm("حذف؟")) del.mutate(r.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>}
      </Card>
    </div>
  );
}
