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
import { GraduationCap, Pencil, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/programs")({
  head: () => ({ meta: [{ title: "البرامج الأكاديمية" }] }),
  component: ProgramsPage,
});

const DEGREES: Record<string, string> = {
  bachelor: "بكالوريوس",
  master: "ماجستير",
  doctorate: "دكتوراه",
  diploma: "دبلوم",
};

interface Prog {
  id: string;
  name: string;
  code: string;
  department_id: string;
  degree_type: string;
  duration_years: number;
  college_id: string;
}

function ProgramsPage() {
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Prog | null>(null);
  const [form, setForm] = useState({
    name: "",
    code: "",
    department_id: "",
    degree_type: "bachelor",
    duration_years: 4,
  });

  const { data: depts } = useQuery({
    queryKey: ["dept-min", active?.id],
    enabled: !!active,
    queryFn: async () =>
      (
        await supabase
          .from("departments")
          .select("id, name")
          .eq("college_id", active!.id)
          .order("name")
      ).data ?? [],
  });

  const { data: rows, isLoading } = useQuery({
    queryKey: ["programs", active?.id],
    enabled: !!active,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("academic_programs")
        .select("id, name, code, department_id, degree_type, duration_years, college_id")
        .eq("college_id", active!.id)
        .order("name");
      if (error) throw error;
      return (data ?? []) as Prog[];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!active) throw new Error("اختر كلّية");
      if (!form.name.trim() || !form.code.trim() || !form.department_id)
        throw new Error("جميع الحقول مطلوبة");
      if (!(depts ?? []).some((department) => department.id === form.department_id)) {
        throw new Error("يجب اختيار قسم من الكلية النشطة");
      }
      const payload = {
        ...form,
        name: form.name.trim(),
        code: form.code.trim(),
        college_id: active.id,
      };
      if (editing) {
        const { error } = await supabase
          .from("academic_programs")
          .update(payload)
          .eq("id", editing.id)
          .eq("college_id", active.id);
        if (error) throw error;
        await logAudit({
          action: "update",
          entity: "academic_programs",
          entityId: editing.id,
          collegeId: active.id,
        });
      } else {
        const { data, error } = await supabase
          .from("academic_programs")
          .insert(payload)
          .select("id")
          .single();
        if (error) throw error;
        await logAudit({
          action: "create",
          entity: "academic_programs",
          entityId: data?.id,
          collegeId: active.id,
        });
      }
    },
    onSuccess: () => {
      toast.success(editing ? "تم التحديث" : "تمت الإضافة");
      qc.invalidateQueries({ queryKey: ["programs", active?.id] });
      setOpen(false);
      setEditing(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      if (!active) throw new Error("اختر كلّية");
      const { error } = await supabase
        .from("academic_programs")
        .delete()
        .eq("id", id)
        .eq("college_id", active.id);
      if (error) throw error;
      await logAudit({
        action: "delete",
        entity: "academic_programs",
        entityId: id,
        collegeId: active?.id,
      });
    },
    onSuccess: () => {
      toast.success("تم الحذف");
      qc.invalidateQueries({ queryKey: ["programs", active?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const startEdit = (p: Prog) => {
    setEditing(p);
    setForm({
      name: p.name,
      code: p.code,
      department_id: p.department_id,
      degree_type: p.degree_type,
      duration_years: p.duration_years,
    });
    setOpen(true);
  };
  const startCreate = () => {
    setEditing(null);
    setForm({ name: "", code: "", department_id: "", degree_type: "bachelor", duration_years: 4 });
    setOpen(true);
  };

  const deptMap = new Map((depts ?? []).map((d) => [d.id, d.name]));

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-6 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-secondary text-primary">
          <GraduationCap className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">البرامج الأكاديمية</h1>
          <p className="text-sm text-muted-foreground">البرامج التي تطرحها أقسام الكلّية.</p>
        </div>
      </header>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <CollegeSwitcher />
        {canManage && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button onClick={startCreate} disabled={!depts || depts.length === 0}>
                برنامج جديد
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editing ? "تعديل البرنامج" : "برنامج جديد"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>القسم</Label>
                  <Select
                    value={form.department_id}
                    onValueChange={(v) => setForm({ ...form, department_id: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="اختر القسم" />
                    </SelectTrigger>
                    <SelectContent>
                      {(depts ?? []).map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>الاسم</Label>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </div>
                <div>
                  <Label>الرمز</Label>
                  <Input
                    value={form.code}
                    onChange={(e) => setForm({ ...form, code: e.target.value })}
                  />
                </div>
                <div>
                  <Label>نوع الدرجة</Label>
                  <Select
                    value={form.degree_type}
                    onValueChange={(v) => setForm({ ...form, degree_type: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(DEGREES).map(([k, v]) => (
                        <SelectItem key={k} value={k}>
                          {v}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>عدد السنوات</Label>
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    value={form.duration_years}
                    onChange={(e) => setForm({ ...form, duration_years: Number(e.target.value) })}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  إلغاء
                </Button>
                <Button
                  onClick={() => save.mutate()}
                  disabled={save.isPending || !form.department_id}
                >
                  حفظ
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {(!depts || depts.length === 0) && (
        <p className="mb-3 rounded border border-dashed border-border bg-muted/30 p-3 text-sm text-muted-foreground">
          أنشئ قسمًا أولاً قبل إضافة البرامج.
        </p>
      )}

      <Card className="overflow-hidden">
        {isLoading ? (
          <p className="p-6 text-center text-muted-foreground">جارٍ التحميل...</p>
        ) : !rows || rows.length === 0 ? (
          <p className="p-6 text-center text-muted-foreground">لا توجد برامج بعد.</p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((p) => (
              <li key={p.id} className="flex items-center justify-between p-4">
                <div>
                  <p className="font-semibold">{p.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {deptMap.get(p.department_id) ?? "—"} ·{" "}
                    {DEGREES[p.degree_type] ?? p.degree_type} · {p.duration_years} سنوات
                  </p>
                </div>
                {canManage && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => startEdit(p)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (confirm("حذف البرنامج؟")) del.mutate(p.id);
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
