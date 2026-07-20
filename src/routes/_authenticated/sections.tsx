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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import { Users, Pencil, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/sections")({
  head: () => ({ meta: [{ title: "Legacy — للعرض التاريخي" }] }),
  component: SectionsPage,
});

/**
 * A1.3a — Legacy write blocking.
 * جدول sections هو Legacy فقط: حُجب إنشاء/تعديل/حذف الصفوف من هذه الصفحة ضمن A1.3a.
 * يبقى الكود التاريخي أدناه للمرجعية دون حذف، لكنه غير قابل للوصول من الواجهة،
 * وأي استدعاء مباشر للطفرات (mutations) يُرفض برسالة واضحة.
 * حجب الكتابة على مستوى قاعدة البيانات يأتي في A1.3c بعد معالجة البيانات اليتيمة
 * وفق خطة A1.3b وبوابة APPROVE_LEGACY_DATA_REMEDIATION.
 */
const LEGACY_SECTIONS_WRITE_BLOCKED = true;
const LEGACY_SECTION_WRITE_BLOCKED_MESSAGE =
  "LEGACY_SECTION_WRITE_BLOCKED: جدول sections أصبح Legacy للعرض التاريخي فقط ضمن A1.3a؛ استخدم الدفعات الدراسية ومجموعات المحاضرات والمعامل.";

interface Section {
  id: string;
  course_id: string;
  term_id: string;
  section_number: string;
  capacity: number;
  college_id: string;
}

function SectionsPage() {
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Section | null>(null);
  const [form, setForm] = useState({
    course_id: "",
    term_id: "",
    section_number: "1",
    capacity: 30,
  });
  const [termFilter, setTermFilter] = useState<string>("all");

  const { data: courses } = useQuery({
    queryKey: ["courses-min", active?.id],
    enabled: !!active,
    queryFn: async () =>
      (
        await supabase
          .from("courses")
          .select("id, code, name")
          .eq("college_id", active!.id)
          .order("code")
      ).data ?? [],
  });
  const { data: terms } = useQuery({
    queryKey: ["terms-min", active?.id],
    enabled: !!active,
    queryFn: async () =>
      (
        await supabase
          .from("academic_terms")
          .select("id, name, is_active")
          .eq("college_id", active!.id)
          .order("name")
      ).data ?? [],
  });

  const { data: rows, isLoading } = useQuery({
    queryKey: ["sections", active?.id, termFilter],
    enabled: !!active,
    queryFn: async () => {
      let q = supabase
        .from("sections")
        .select("id, course_id, term_id, section_number, capacity, college_id")
        .eq("college_id", active!.id);
      if (termFilter !== "all") q = q.eq("term_id", termFilter);
      const { data, error } = await q.order("section_number");
      if (error) throw error;
      return (data ?? []) as Section[];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (LEGACY_SECTIONS_WRITE_BLOCKED) throw new Error(LEGACY_SECTION_WRITE_BLOCKED_MESSAGE);
      if (!active) throw new Error("اختر كلّية");
      if (!form.course_id || !form.term_id || !form.section_number.trim())
        throw new Error("الحقول مطلوبة");
      const payload = {
        ...form,
        section_number: form.section_number.trim(),
        capacity: Number(form.capacity),
        college_id: active.id,
      };
      if (editing) {
        const { error } = await supabase.from("sections").update(payload).eq("id", editing.id);
        if (error) throw error;
        await logAudit({
          action: "update",
          entity: "sections",
          entityId: editing.id,
          collegeId: active.id,
        });
      } else {
        const { data, error } = await supabase
          .from("sections")
          .insert(payload)
          .select("id")
          .single();
        if (error) throw error;
        await logAudit({
          action: "create",
          entity: "sections",
          entityId: data?.id,
          collegeId: active.id,
        });
      }
    },
    onSuccess: () => {
      toast.success(editing ? "تم التحديث" : "تمت الإضافة");
      qc.invalidateQueries({ queryKey: ["sections", active?.id] });
      setOpen(false);
      setEditing(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      if (LEGACY_SECTIONS_WRITE_BLOCKED) throw new Error(LEGACY_SECTION_WRITE_BLOCKED_MESSAGE);
      const { error } = await supabase.from("sections").delete().eq("id", id);
      if (error) throw error;
      await logAudit({ action: "delete", entity: "sections", entityId: id, collegeId: active?.id });
    },
    onSuccess: () => {
      toast.success("تم الحذف");
      qc.invalidateQueries({ queryKey: ["sections", active?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const startEdit = (s: Section) => {
    setEditing(s);
    setForm({
      course_id: s.course_id,
      term_id: s.term_id,
      section_number: s.section_number,
      capacity: s.capacity,
    });
    setOpen(true);
  };
  const startCreate = () => {
    const defTerm = terms?.find((t) => t.is_active)?.id ?? terms?.[0]?.id ?? "";
    setEditing(null);
    setForm({ course_id: "", term_id: defTerm, section_number: "1", capacity: 30 });
    setOpen(true);
  };

  const courseMap = new Map((courses ?? []).map((c) => [c.id, `${c.code} — ${c.name}`]));
  const termMap = new Map((terms ?? []).map((t) => [t.id, t.name]));
  const ready = courses && courses.length > 0 && terms && terms.length > 0;

  return (
    <div className="mx-auto max-w-5xl">
      <Card className="mb-5 border-amber-500/40 bg-amber-500/10 p-4 text-sm">
        <h1 className="font-semibold">Legacy — للعرض التاريخي</h1>
        <p className="mt-1 text-muted-foreground">
          هذه الصفحة خارج مسار التشغيل الجديد. الدفعات الدراسية ومجموعات المحاضرات والمعامل هي
          المسار المعتمد. ضمن A1.3a حُجبت الكتابة هنا (إنشاء/تعديل/حذف) وأصبح العرض للقراءة
          فقط؛ ويُستكمل حجب الكتابة على مستوى قاعدة البيانات في A1.3c بعد معالجة البيانات
          اليتيمة وفق خطة A1.3b.
        </p>
      </Card>
      <header className="mb-6 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-secondary text-primary">
          <Users className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">تقسيم المجموعات الدراسية</h1>
          <p className="text-sm text-muted-foreground">
            سجلات Legacy تاريخية لتقسيم مجموعات الطلاب — للعرض فقط.
          </p>
        </div>
      </header>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <CollegeSwitcher />
          <div className="min-w-[12rem]">
            <Select value={termFilter} onValueChange={setTermFilter}>
              <SelectTrigger>
                <SelectValue placeholder="فلترة بالفصل" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الفصول الأكاديمية</SelectItem>
                {(terms ?? []).map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {canManage && !LEGACY_SECTIONS_WRITE_BLOCKED && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button onClick={startCreate} disabled={!ready}>
                مجموعة جديدة
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editing ? "تعديل المجموعة" : "مجموعة جديدة"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>المقرر</Label>
                  <Select
                    value={form.course_id}
                    onValueChange={(v) => setForm({ ...form, course_id: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="اختر المقرر" />
                    </SelectTrigger>
                    <SelectContent>
                      {(courses ?? []).map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.code} — {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>الفصل</Label>
                  <Select
                    value={form.term_id}
                    onValueChange={(v) => setForm({ ...form, term_id: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="اختر الفصل" />
                    </SelectTrigger>
                    <SelectContent>
                      {(terms ?? []).map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>رقم المجموعة</Label>
                    <Input
                      value={form.section_number}
                      onChange={(e) => setForm({ ...form, section_number: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>السعة</Label>
                    <Input
                      type="number"
                      min={1}
                      value={form.capacity}
                      onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })}
                    />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  إلغاء
                </Button>
                <Button onClick={() => save.mutate()} disabled={save.isPending}>
                  حفظ
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {!ready && (
        <p className="mb-3 rounded border border-dashed border-border bg-muted/30 p-3 text-sm text-muted-foreground">
          لا تتوفر بيانات مقررات أو فصول دراسية لعرض سياق هذه السجلات التاريخية.
        </p>
      )}

      <Card className="overflow-hidden">
        {isLoading ? (
          <p className="p-6 text-center text-muted-foreground">جارٍ التحميل...</p>
        ) : !rows || rows.length === 0 ? (
          <p className="p-6 text-center text-muted-foreground">لا توجد مجموعات بعد.</p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((s) => (
              <li key={s.id} className="flex items-center justify-between p-4">
                <div>
                  <p className="font-semibold">
                    {courseMap.get(s.course_id) ?? "—"} · مجموعة {s.section_number}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {termMap.get(s.term_id) ?? "—"} · السعة {s.capacity}
                  </p>
                </div>
                {canManage && !LEGACY_SECTIONS_WRITE_BLOCKED && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => startEdit(s)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (confirm("حذف المجموعة؟")) del.mutate(s.id);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
