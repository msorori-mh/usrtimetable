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
import { ClipboardList, Pencil, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/course-offerings")({
  head: () => ({ meta: [{ title: "مقررات الفصل" }] }),
  component: OfferingsPage,
});

interface Offering {
  id: string; college_id: string; term_id: string; course_id: string;
  program_id: string | null; level_id: string | null;
  expected_students: number; sections_count: number; notes: string | null; is_active: boolean;
  status: string;
}

function emptyForm() { return { term_id: "", course_id: "", program_id: "", level_id: "", expected_students: 0, sections_count: 1, notes: "", is_active: true, status: "draft" }; }

function OfferingsPage() {
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Offering | null>(null);
  const [form, setForm] = useState(emptyForm());

  const { data: terms } = useQuery({
    queryKey: ["terms-min", active?.id], enabled: !!active,
    queryFn: async () => (await supabase.from("academic_terms").select("id, name").eq("college_id", active!.id).order("start_date", { ascending: false })).data ?? [],
  });
  const { data: courses } = useQuery({
    queryKey: ["courses-min", active?.id], enabled: !!active,
    queryFn: async () => (await supabase.from("courses").select("id, code, name").eq("college_id", active!.id).order("code")).data ?? [],
  });
  const { data: programs } = useQuery({
    queryKey: ["programs-min", active?.id], enabled: !!active,
    queryFn: async () => (await supabase.from("academic_programs").select("id, name").eq("college_id", active!.id).order("name")).data ?? [],
  });
  const { data: levels } = useQuery({
    queryKey: ["levels-min", active?.id, form.program_id], enabled: !!active,
    queryFn: async () => {
      const q = supabase.from("academic_levels").select("id, name, program_id").eq("college_id", active!.id).order("level_number");
      const { data } = form.program_id ? await q.eq("program_id", form.program_id) : await q;
      return data ?? [];
    },
  });

  const { data: rows, isLoading } = useQuery({
    queryKey: ["offerings", active?.id], enabled: !!active,
    queryFn: async () => {
      const { data, error } = await supabase.from("course_offerings").select("*").eq("college_id", active!.id).order("created_at", { ascending: false });
      if (error) throw error; return (data ?? []) as Offering[];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!active) throw new Error("اختر كلّية");
      if (!form.term_id || !form.course_id) throw new Error("الفصل والمقرر مطلوبان");
      const payload = {
        college_id: active.id, term_id: form.term_id, course_id: form.course_id,
        program_id: form.program_id || null, level_id: form.level_id || null,
        expected_students: Number(form.expected_students) || 0,
        sections_count: Number(form.sections_count) || 1,
        notes: form.notes.trim() || null, is_active: form.is_active,
        status: form.status || "draft",
      };
      if (editing) {
        const { error } = await supabase.from("course_offerings").update(payload).eq("id", editing.id);
        if (error) throw error;
        await logAudit({ action: "update", entity: "course_offerings", entityId: editing.id, collegeId: active.id });
      } else {
        const { data, error } = await supabase.from("course_offerings").insert(payload).select("id").single();
        if (error) throw error;
        await logAudit({ action: "create", entity: "course_offerings", entityId: data?.id, collegeId: active.id });
      }
    },
    onSuccess: () => {
      toast.success(editing ? "تم التحديث" : "تمت الإضافة");
      qc.invalidateQueries({ queryKey: ["offerings", active?.id] });
      setOpen(false); setEditing(null);
    },
    onError: (e: Error) => toast.error(e.message.includes("duplicate") ? "هذا المقرر مطروح مسبقاً لنفس الفصل/البرنامج/المستوى" : e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("course_offerings").delete().eq("id", id);
      if (error) throw error;
      await logAudit({ action: "delete", entity: "course_offerings", entityId: id, collegeId: active?.id });
    },
    onSuccess: () => { toast.success("تم الحذف"); qc.invalidateQueries({ queryKey: ["offerings", active?.id] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const startEdit = (o: Offering) => {
    setEditing(o);
    setForm({
      term_id: o.term_id, course_id: o.course_id, program_id: o.program_id ?? "", level_id: o.level_id ?? "",
      expected_students: o.expected_students, sections_count: o.sections_count, notes: o.notes ?? "", is_active: o.is_active,
    });
    setOpen(true);
  };
  const startCreate = () => { setEditing(null); setForm(emptyForm()); setOpen(true); };

  const termMap = new Map((terms ?? []).map((t) => [t.id, t.name]));
  const courseMap = new Map((courses ?? []).map((c) => [c.id, `${c.code} — ${c.name}`]));
  const progMap = new Map((programs ?? []).map((p) => [p.id, p.name]));
  const levelMap = new Map((levels ?? []).map((l) => [l.id, l.name]));

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-6 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-secondary text-primary"><ClipboardList className="h-5 w-5" /></span>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">مقررات الفصل</h1>
          <p className="text-sm text-muted-foreground">طرح المقررات في الفصول الدراسية.</p>
        </div>
      </header>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <CollegeSwitcher />
        {canManage && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button onClick={startCreate} disabled={!terms?.length || !courses?.length}>طرح مقرر</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>{editing ? "تعديل طرح" : "طرح جديد"}</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>الفصل</Label>
                    <Select value={form.term_id} onValueChange={(v) => setForm({ ...form, term_id: v })}>
                      <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
                      <SelectContent>{(terms ?? []).map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label>المقرر</Label>
                    <Select value={form.course_id} onValueChange={(v) => setForm({ ...form, course_id: v })}>
                      <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
                      <SelectContent>{(courses ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.code} — {c.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>البرنامج (اختياري)</Label>
                    <Select value={form.program_id || "_none"} onValueChange={(v) => setForm({ ...form, program_id: v === "_none" ? "" : v, level_id: "" })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none">— الكل —</SelectItem>
                        {(programs ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>المستوى (اختياري)</Label>
                    <Select value={form.level_id || "_none"} onValueChange={(v) => setForm({ ...form, level_id: v === "_none" ? "" : v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none">— الكل —</SelectItem>
                        {(levels ?? []).map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>عدد الطلاب المتوقع</Label><Input type="number" value={form.expected_students} onChange={(e) => setForm({ ...form, expected_students: Number(e.target.value) })} /></div>
                  <div><Label>عدد الشُّعب</Label><Input type="number" value={form.sections_count} onChange={(e) => setForm({ ...form, sections_count: Number(e.target.value) })} /></div>
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
          : !rows || rows.length === 0 ? <p className="p-6 text-center text-muted-foreground">لا توجد طروحات بعد.</p>
          : <ul className="divide-y divide-border">
              {rows.map((o) => (
                <li key={o.id} className="flex items-center justify-between p-4">
                  <div>
                    <p className="font-semibold">{courseMap.get(o.course_id) ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">
                      {termMap.get(o.term_id) ?? "—"}
                      {o.program_id && ` · ${progMap.get(o.program_id) ?? ""}`}
                      {o.level_id && ` · ${levelMap.get(o.level_id) ?? ""}`}
                      {` · ${o.sections_count} شُعبة · ${o.expected_students} طالب`}
                    </p>
                  </div>
                  {canManage && (
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => startEdit(o)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => { if (confirm("حذف الطرح؟")) del.mutate(o.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>}
      </Card>
    </div>
  );
}
