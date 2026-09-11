import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
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
import { AdminExportMenu } from "@/components/admin-export-menu";
import { activeFilters, studyPlansExportDataset } from "@/lib/admin-export/datasets";
import { BookOpen, Pencil, Trash2, Download } from "lucide-react";
import { PlanCoursesManager } from "@/components/study-plans/plan-courses-manager";

export const Route = createFileRoute("/_authenticated/study-plans")({
  head: () => ({ meta: [{ title: "الخطط الدراسية" }] }),
  component: StudyPlansPage,
});

interface Plan {
  id: string;
  name: string;
  code: string;
  version: string;
  program_id: string;
  effective_year: number | null;
  is_active: boolean;
  college_id: string;
}
interface Program {
  id: string;
  name: string;
  department_id: string | null;
  duration_years: number;
}
interface Department {
  id: string;
  name: string;
}

const ALL = "__all__";

function StudyPlansPage() {
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Plan | null>(null);
  const [form, setForm] = useState({
    name: "",
    code: "",
    version: "1",
    program_id: "",
    effective_year: new Date().getFullYear(),
    is_active: true,
  });

  const [deptFilter, setDeptFilter] = useState<string>(ALL);
  const [progFilter, setProgFilter] = useState<string>(ALL);
  const [statusFilter, setStatusFilter] = useState<string>(ALL);

  const { data: depts } = useQuery({
    queryKey: ["dept-min", active?.id],
    enabled: !!active,
    queryFn: async () =>
      ((
        await supabase
          .from("departments")
          .select("id, name")
          .eq("college_id", active!.id)
          .order("name")
      ).data ?? []) as Department[],
  });

  const { data: progs } = useQuery({
    queryKey: ["prog-min-dep", active?.id],
    enabled: !!active,
    queryFn: async () =>
      ((
        await supabase
          .from("academic_programs")
          .select("id, name, department_id, duration_years")
          .eq("college_id", active!.id)
          .order("name")
      ).data ?? []) as Program[],
  });

  const { data: rows, isLoading } = useQuery({
    queryKey: ["study-plans", active?.id],
    enabled: !!active,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("study_plans")
        .select("id, name, code, version, program_id, effective_year, is_active, college_id")
        .eq("college_id", active!.id)
        .order("name");
      if (error) throw error;
      return (data ?? []) as Plan[];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!active) throw new Error("اختر كلّية");
      if (!form.name.trim() || !form.code.trim() || !form.program_id)
        throw new Error("الحقول الأساسية مطلوبة");
      const payload = {
        ...form,
        name: form.name.trim(),
        code: form.code.trim(),
        college_id: active.id,
      };
      if (editing) {
        const { error } = await supabase.from("study_plans").update(payload).eq("id", editing.id);
        if (error) throw error;
        await logAudit({
          action: "update",
          entity: "study_plans",
          entityId: editing.id,
          collegeId: active.id,
        });
      } else {
        const { data, error } = await supabase
          .from("study_plans")
          .insert(payload)
          .select("id")
          .single();
        if (error) throw error;
        await logAudit({
          action: "create",
          entity: "study_plans",
          entityId: data?.id,
          collegeId: active.id,
        });
      }
    },
    onSuccess: () => {
      toast.success(editing ? "تم التحديث" : "تمت الإضافة");
      qc.invalidateQueries({ queryKey: ["study-plans", active?.id] });
      setOpen(false);
      setEditing(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("study_plans").delete().eq("id", id);
      if (error) throw error;
      await logAudit({
        action: "delete",
        entity: "study_plans",
        entityId: id,
        collegeId: active?.id,
      });
    },
    onSuccess: () => {
      toast.success("تم الحذف");
      qc.invalidateQueries({ queryKey: ["study-plans", active?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const startEdit = (p: Plan) => {
    setEditing(p);
    setForm({
      name: p.name,
      code: p.code,
      version: p.version,
      program_id: p.program_id,
      effective_year: p.effective_year ?? new Date().getFullYear(),
      is_active: p.is_active,
    });
    setOpen(true);
  };
  const startCreate = () => {
    setEditing(null);
    setForm({
      name: "",
      code: "",
      version: "1",
      program_id: "",
      effective_year: new Date().getFullYear(),
      is_active: true,
    });
    setOpen(true);
  };

  const progMap = useMemo(() => new Map((progs ?? []).map((p) => [p.id, p])), [progs]);
  const deptMap = useMemo(() => new Map((depts ?? []).map((d) => [d.id, d.name])), [depts]);

  const filteredProgs = useMemo(
    () => (progs ?? []).filter((p) => deptFilter === ALL || p.department_id === deptFilter),
    [progs, deptFilter],
  );

  const filtered = useMemo(() => {
    return (rows ?? []).filter((p) => {
      const prog = progMap.get(p.program_id);
      if (deptFilter !== ALL && prog?.department_id !== deptFilter) return false;
      if (progFilter !== ALL && p.program_id !== progFilter) return false;
      if (statusFilter === "active" && !p.is_active) return false;
      if (statusFilter === "inactive" && p.is_active) return false;
      return true;
    });
  }, [rows, progMap, deptFilter, progFilter, statusFilter]);

  const plansDataset = () =>
    studyPlansExportDataset({
      rows: filtered,
      collegeName: active?.name ?? null,
      programLabel: (id) => progMap.get(id ?? "")?.name ?? "",
      programDepartmentLabel: (id) => {
        const dep = progMap.get(id ?? "")?.department_id;
        return dep ? (deptMap.get(dep) ?? "") : "";
      },
      filters: activeFilters([
        { label: "القسم", value: deptFilter === ALL ? "" : (deptMap.get(deptFilter) ?? "") },
        { label: "البرنامج", value: progFilter === ALL ? "" : (progMap.get(progFilter)?.name ?? "") },
        {
          label: "حالة السريان",
          value:
            statusFilter === ALL ? "" : statusFilter === "active" ? "سارية فقط" : "غير سارية فقط",
        },
      ]),
    });

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-6 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-secondary text-primary">
          <BookOpen className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">الخطط الدراسية</h1>
          <p className="text-sm text-muted-foreground">إصدارات الخطة لكل برنامج.</p>
        </div>
      </header>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <CollegeSwitcher />
        <div className="flex gap-2">
          <AdminExportMenu
            testId="study-plans-export"
            disabled={filtered.length === 0}
            dataset={plansDataset}
          />
          {canManage && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button onClick={startCreate} disabled={!progs || progs.length === 0}>
                  خطة جديدة
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{editing ? "تعديل الخطة" : "خطة جديدة"}</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label>البرنامج</Label>
                    <Select
                      value={form.program_id}
                      onValueChange={(v) => setForm({ ...form, program_id: v })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="اختر البرنامج" />
                      </SelectTrigger>
                      <SelectContent>
                        {(progs ?? []).map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
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
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>الرمز</Label>
                      <Input
                        value={form.code}
                        onChange={(e) => setForm({ ...form, code: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label>الإصدار</Label>
                      <Input
                        value={form.version}
                        onChange={(e) => setForm({ ...form, version: e.target.value })}
                      />
                    </div>
                  </div>
                  <div>
                    <Label>سنة السريان</Label>
                    <Input
                      type="number"
                      value={form.effective_year}
                      onChange={(e) => setForm({ ...form, effective_year: Number(e.target.value) })}
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={form.is_active}
                      onCheckedChange={(v) => setForm({ ...form, is_active: !!v })}
                    />{" "}
                    سارية
                  </label>
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
      </div>

      <Card className="mb-4 p-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <Label className="text-xs">القسم</Label>
            <Select
              value={deptFilter}
              onValueChange={(v) => {
                setDeptFilter(v);
                setProgFilter(ALL);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>الكل</SelectItem>
                {(depts ?? []).map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">البرنامج</Label>
            <Select value={progFilter} onValueChange={setProgFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>الكل</SelectItem>
                {filteredProgs.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">الحالة</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>الكل</SelectItem>
                <SelectItem value="active">سارية</SelectItem>
                <SelectItem value="inactive">غير سارية</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      {(!progs || progs.length === 0) && (
        <p className="mb-3 rounded border border-dashed border-border bg-muted/30 p-3 text-sm text-muted-foreground">
          أنشئ برنامجًا أولاً.
        </p>
      )}

      <Card className="overflow-hidden">
        {isLoading ? (
          <p className="p-6 text-center text-muted-foreground">جارٍ التحميل...</p>
        ) : !rows || rows.length === 0 ? (
          <p className="p-6 text-center text-muted-foreground">لا توجد خطط بعد.</p>
        ) : filtered.length === 0 ? (
          <p className="p-6 text-center text-muted-foreground">لا توجد نتائج مطابقة للفلاتر.</p>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((p) => {
              const prog = progMap.get(p.program_id);
              const deptName = prog?.department_id ? deptMap.get(prog.department_id) : null;
              return (
                <li
                  key={p.id}
                  className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-semibold">
                      {p.name}{" "}
                      {!p.is_active && (
                        <span className="text-xs text-muted-foreground">(غير سارية)</span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      <span dir="ltr">
                        {p.code}@v{p.version}
                      </span>{" "}
                      · {prog?.name ?? "—"}
                      {deptName ? ` · ${deptName}` : ""} · {p.effective_year ?? "—"}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {active && (
                      <PlanCoursesManager
                        plan={{ id: p.id, name: p.name }}
                        programId={p.program_id}
                        programDurationYears={prog?.duration_years ?? 0}
                        collegeId={active.id}
                        canManage={canManage}
                      />
                    )}
                    {canManage && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => startEdit(p)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            if (confirm("حذف الخطة؟")) del.mutate(p.id);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
