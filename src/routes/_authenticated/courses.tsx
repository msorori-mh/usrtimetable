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
import { activeFilters, coursesExportDataset } from "@/lib/admin-export/datasets";
import { Library, Pencil, Search, Trash2 } from "lucide-react";
import {
  ALL_FILTER,
  COURSE_COMPOSITION_LABELS_AR,
  courseResultsLabelAr,
  creditHourOptions,
  filterCourses,
  hasActiveCourseFilters,
  programsForDepartment,
  type CourseComposition,
} from "@/lib/courses/course-filters";

export const Route = createFileRoute("/_authenticated/courses")({
  head: () => ({ meta: [{ title: "المقررات" }] }),
  component: CoursesPage,
});

interface Course {
  id: string;
  name: string;
  code: string;
  department_id: string;
  credit_hours: number;
  theory_hours: number;
  practical_hours: number;
  college_id: string;
  course_nature?: string | null;
  is_shared?: boolean | null;
}
interface Program {
  id: string;
  name: string;
  department_id: string | null;
}
interface Department {
  id: string;
  name: string;
}
interface StudyPlan {
  id: string;
  name: string;
  program_id: string;
  version: string;
}

const ALL = ALL_FILTER;

function CoursesPage() {
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Course | null>(null);
  const [form, setForm] = useState({
    name: "",
    code: "",
    department_id: "",
    credit_hours: 3,
    theory_hours: 3,
    practical_hours: 0,
  });

  const [deptFilter, setDeptFilter] = useState<string>(ALL);
  const [progFilter, setProgFilter] = useState<string>(ALL);
  const [planFilter, setPlanFilter] = useState<string>(ALL);
  const [search, setSearch] = useState("");
  const [compFilter, setCompFilter] = useState<string>(ALL);
  const [creditFilter, setCreditFilter] = useState<string>(ALL);

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
          .select("id, name, department_id")
          .eq("college_id", active!.id)
          .order("name")
      ).data ?? []) as Program[],
  });

  const { data: plans } = useQuery({
    queryKey: ["study-plans-min", active?.id],
    enabled: !!active,
    queryFn: async () =>
      ((
        await supabase
          .from("study_plans")
          .select("id, name, program_id, version")
          .eq("college_id", active!.id)
          .order("name")
      ).data ?? []) as StudyPlan[],
  });

  const { data: coursePrograms } = useQuery({
    queryKey: ["course-programs", active?.id],
    enabled: !!active,
    queryFn: async () =>
      ((
        await supabase
          .from("course_programs")
          .select("course_id, program_id")
          .eq("college_id", active!.id)
      ).data ?? []) as { course_id: string; program_id: string }[],
  });

  const { data: planCourses } = useQuery({
    queryKey: ["plan-courses-min", active?.id],
    enabled: !!active,
    queryFn: async () =>
      ((
        await supabase
          .from("plan_courses")
          .select("study_plan_id, course_id")
          .eq("college_id", active!.id)
      ).data ?? []) as { study_plan_id: string; course_id: string }[],
  });

  const { data: rows, isLoading } = useQuery({
    queryKey: ["courses", active?.id],
    enabled: !!active,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("courses")
        .select(
          "id, name, code, department_id, credit_hours, theory_hours, practical_hours, college_id, course_nature, is_shared",
        )
        .eq("college_id", active!.id)
        .order("code");
      if (error) throw error;
      return (data ?? []) as Course[];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!active) throw new Error("اختر كلّية");
      if (!form.name.trim() || !form.code.trim() || !form.department_id)
        throw new Error("الحقول الأساسية مطلوبة");
      const payload = {
        ...form,
        name: form.name.trim(),
        code: form.code.trim(),
        college_id: active.id,
      };
      if (editing) {
        const { error } = await supabase.from("courses").update(payload).eq("id", editing.id);
        if (error) throw error;
        await logAudit({
          action: "update",
          entity: "courses",
          entityId: editing.id,
          collegeId: active.id,
        });
      } else {
        const { data, error } = await supabase
          .from("courses")
          .insert(payload)
          .select("id")
          .single();
        if (error) throw error;
        await logAudit({
          action: "create",
          entity: "courses",
          entityId: data?.id,
          collegeId: active.id,
        });
      }
    },
    onSuccess: () => {
      toast.success(editing ? "تم التحديث" : "تمت الإضافة");
      qc.invalidateQueries({ queryKey: ["courses", active?.id] });
      setOpen(false);
      setEditing(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("courses").delete().eq("id", id);
      if (error) throw error;
      await logAudit({ action: "delete", entity: "courses", entityId: id, collegeId: active?.id });
    },
    onSuccess: () => {
      toast.success("تم الحذف");
      qc.invalidateQueries({ queryKey: ["courses", active?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const startEdit = (c: Course) => {
    setEditing(c);
    setForm({
      name: c.name,
      code: c.code,
      department_id: c.department_id,
      credit_hours: c.credit_hours,
      theory_hours: c.theory_hours,
      practical_hours: c.practical_hours,
    });
    setOpen(true);
  };
  const startCreate = () => {
    setEditing(null);
    setForm({
      name: "",
      code: "",
      department_id: "",
      credit_hours: 3,
      theory_hours: 3,
      practical_hours: 0,
    });
    setOpen(true);
  };

  const deptMap = useMemo(() => new Map((depts ?? []).map((d) => [d.id, d.name])), [depts]);
  const progMap = useMemo(() => new Map((progs ?? []).map((p) => [p.id, p])), [progs]);

  const filteredProgs = useMemo(
    () => programsForDepartment(progs ?? [], deptFilter),
    [progs, deptFilter],
  );

  const plansForProgram = useMemo(
    () => (progFilter === ALL ? [] : (plans ?? []).filter((pl) => pl.program_id === progFilter)),
    [plans, progFilter],
  );
  const showPlanFilter = plansForProgram.length > 1;

  const programCourseIds = useMemo(() => {
    if (progFilter === ALL) return null;
    return new Set(
      (coursePrograms ?? []).filter((r) => r.program_id === progFilter).map((r) => r.course_id),
    );
  }, [coursePrograms, progFilter]);

  const planCourseIds = useMemo(() => {
    if (planFilter === ALL) return null;
    return new Set(
      (planCourses ?? []).filter((r) => r.study_plan_id === planFilter).map((r) => r.course_id),
    );
  }, [planCourses, planFilter]);

  const filterState = {
    search,
    deptFilter,
    progFilter,
    planFilter,
    composition: compFilter,
    creditHours: creditFilter,
  };

  const filtered = useMemo(
    () => filterCourses(rows ?? [], filterState, { programCourseIds, planCourseIds }),
    [
      rows,
      search,
      deptFilter,
      progFilter,
      planFilter,
      compFilter,
      creditFilter,
      programCourseIds,
      planCourseIds,
    ],
  );

  const creditOptions = useMemo(() => creditHourOptions(rows ?? []), [rows]);
  const filtersActive = hasActiveCourseFilters(filterState);
  const clearFilters = () => {
    setSearch("");
    setDeptFilter(ALL);
    setProgFilter(ALL);
    setPlanFilter(ALL);
    setCompFilter(ALL);
    setCreditFilter(ALL);
  };

  const coursesDataset = () =>
    coursesExportDataset({
      rows: filtered,
      collegeName: active?.name ?? null,
      departmentLabel: (id) => (id ? (deptMap.get(id) ?? "") : ""),
      fileBase: "courses",
      filters: activeFilters([
        { label: "البحث", value: search.trim() },
        {
          label: "تكوين المقرر",
          value:
            compFilter === ALL ? "" : COURSE_COMPOSITION_LABELS_AR[compFilter as CourseComposition],
        },
        { label: "الساعات المعتمدة", value: creditFilter === ALL ? "" : creditFilter },
        {
          label: "القسم",
          value: deptFilter === ALL ? "" : (deptMap.get(deptFilter) ?? ""),
        },
        {
          label: "البرنامج",
          value: progFilter === ALL ? "" : (progMap.get(progFilter)?.name ?? ""),
        },
        {
          label: "الخطة الدراسية",
          value:
            planFilter === ALL ? "" : ((plans ?? []).find((p) => p.id === planFilter)?.name ?? ""),
        },
      ]),
    });

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-6 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-secondary text-primary">
          <Library className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">المقررات</h1>
          <p className="text-sm text-muted-foreground">كتالوج المقررات الدراسية.</p>
        </div>
      </header>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <CollegeSwitcher />
        <div className="flex gap-2">
          <AdminExportMenu
            testId="courses-export"
            disabled={filtered.length === 0}
            dataset={coursesDataset}
          />
          {canManage && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button onClick={startCreate} disabled={!depts || depts.length === 0}>
                  مقرر جديد
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{editing ? "تعديل المقرر" : "مقرر جديد"}</DialogTitle>
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
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>الرمز</Label>
                      <Input
                        value={form.code}
                        onChange={(e) => setForm({ ...form, code: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label>الاسم</Label>
                      <Input
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label>الساعات المعتمدة</Label>
                      <Input
                        type="number"
                        step="0.5"
                        value={form.credit_hours}
                        onChange={(e) => setForm({ ...form, credit_hours: Number(e.target.value) })}
                      />
                    </div>
                    <div>
                      <Label>نظري</Label>
                      <Input
                        type="number"
                        value={form.theory_hours}
                        onChange={(e) => setForm({ ...form, theory_hours: Number(e.target.value) })}
                      />
                    </div>
                    <div>
                      <Label>عملي</Label>
                      <Input
                        type="number"
                        value={form.practical_hours}
                        onChange={(e) =>
                          setForm({ ...form, practical_hours: Number(e.target.value) })
                        }
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
      </div>

      <Card className="mb-4 space-y-3 p-3">
        <div>
          <Label className="text-xs" htmlFor="courses-search">
            البحث في المقررات
          </Label>
          <div className="relative">
            <Search className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="courses-search"
              data-testid="courses-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث برمز المقرر أو الاسم"
              aria-label="البحث في المقررات برمز المقرر أو الاسم"
              className="pe-9"
            />
          </div>
        </div>
        <div
          className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${showPlanFilter ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}
        >
          <div>
            <Label className="text-xs">القسم</Label>
            <Select
              value={deptFilter}
              onValueChange={(v) => {
                setDeptFilter(v);
                setProgFilter(ALL);
                setPlanFilter(ALL);
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
            <Select
              value={progFilter}
              onValueChange={(v) => {
                setProgFilter(v);
                setPlanFilter(ALL);
              }}
            >
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
          {showPlanFilter && (
            <div>
              <Label className="text-xs">الخطة</Label>
              <Select value={planFilter} onValueChange={setPlanFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>الكل</SelectItem>
                  {plansForProgram.map((pl) => (
                    <SelectItem key={pl.id} value={pl.id}>
                      {pl.name} (v{pl.version})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </Card>

      {(!depts || depts.length === 0) && (
        <p className="mb-3 rounded border border-dashed border-border bg-muted/30 p-3 text-sm text-muted-foreground">
          أنشئ قسمًا أولاً.
        </p>
      )}

      <Card className="overflow-hidden">
        {isLoading ? (
          <p className="p-6 text-center text-muted-foreground">جارٍ التحميل...</p>
        ) : !rows || rows.length === 0 ? (
          <p className="p-6 text-center text-muted-foreground">لا توجد مقررات بعد.</p>
        ) : filtered.length === 0 ? (
          <p className="p-6 text-center text-muted-foreground">لا توجد نتائج مطابقة للفلاتر.</p>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((c) => (
              <li key={c.id} className="flex items-center justify-between p-4">
                <div>
                  <p className="font-semibold">
                    <span dir="ltr">{c.code}</span> — {c.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {deptMap.get(c.department_id) ?? "—"} · {c.credit_hours} س.م · نظري{" "}
                    {c.theory_hours} / عملي {c.practical_hours}
                  </p>
                </div>
                {canManage && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => startEdit(c)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (confirm("حذف المقرر؟")) del.mutate(c.id);
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
