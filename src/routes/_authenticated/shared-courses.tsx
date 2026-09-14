import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCollege } from "@/hooks/use-colleges";
import { useCanManageActiveCollege } from "@/hooks/use-can-manage";
import { CollegeSwitcher } from "@/components/college-switcher";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useCourseProgramPlans, CourseProgramDetails } from "@/components/course-program-details";
import { coursePrograms, programCount } from "@/lib/course-program-plans";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import { Share2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/shared-courses")({
  head: () => ({ meta: [{ title: "المقررات المشتركة" }] }),
  component: SharedPage,
});

const NATURES = [
  { v: "department", l: "متطلب برنامج" },
  { v: "college", l: "متطلب كلية" },
  { v: "university", l: "متطلب جامعة" },
];

interface Course {
  id: string;
  code: string;
  name: string;
  department_id: string;
  course_nature: string;
  is_shared: boolean;
}

function SharedPage() {
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Course | null>(null);
  const [nature, setNature] = useState("department");
  const [department, setDepartment] = useState("");
  const plansQuery = useCourseProgramPlans(active?.id);
  const selectedRows = coursePrograms(plansQuery.data ?? [], editing?.id ?? "");

  const { data: courses, isLoading } = useQuery({
    queryKey: ["courses-shared", active?.id],
    enabled: !!active,
    queryFn: async () =>
      ((
        await supabase
          .from("courses")
          .select("id, code, name, department_id, course_nature, is_shared")
          .eq("college_id", active!.id)
          .order("code")
      ).data ?? []) as Course[],
  });
  const { data: departments } = useQuery({
    queryKey: ["deps-shared", active?.id],
    enabled: !!active,
    queryFn: async () =>
      (
        await supabase
          .from("departments")
          .select("id, name, code")
          .eq("college_id", active!.id)
          .order("name")
      ).data ?? [],
  });
  const start = (c: Course) => {
    setEditing(c);
    setNature(c.course_nature ?? "department");
    setDepartment(c.department_id);
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!editing || !active || !canManage || plansQuery.isPending || plansQuery.isError)
        throw new Error("تعذر الحفظ قبل تحميل البرامج والتحقق من الصلاحية");
      const { error: e1 } = await supabase
        .from("courses")
        .update({
          course_nature: nature,
          department_id: department,
          is_shared: programCount(selectedRows) > 1,
        })
        .eq("id", editing.id)
        .eq("college_id", active.id)
        .select("id")
        .single();
      if (e1) throw e1;
      await logAudit({
        action: "update",
        entity: "courses.shared",
        entityId: editing.id,
        collegeId: active.id,
      });
    },
    onSuccess: () => {
      toast.success("تم الحفظ");
      qc.invalidateQueries({ queryKey: ["courses-shared", active?.id] });
      qc.invalidateQueries({ queryKey: ["courses"] });
      setEditing(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-6 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-secondary text-primary">
          <Share2 className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">المقررات المشتركة</h1>
          <p className="text-sm text-muted-foreground">
            راجع طبيعة المقرر والبرامج التي تدرسه بحسب الخطط النشطة المسجلة.
          </p>
        </div>
      </header>
      <div className="mb-4">
        <CollegeSwitcher />
      </div>

      <Card className="overflow-hidden">
        {isLoading ? (
          <p className="p-6 text-center text-muted-foreground">جارٍ التحميل...</p>
        ) : !courses || courses.length === 0 ? (
          <p className="p-6 text-center text-muted-foreground">لا توجد مقررات.</p>
        ) : (
          <ul className="divide-y divide-border">
            {courses.map((c) => {
              const ds = coursePrograms(plansQuery.data ?? [], c.id);
              return (
                <li key={c.id} className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {c.name}
                      {programCount(ds) > 1 && (
                        <span className="ms-2 rounded bg-accent/20 px-2 py-0.5 text-[11px]">
                          مشترك
                        </span>
                      )}
                      <span className="ms-2 rounded bg-secondary px-2 py-0.5 text-[11px]">
                        {NATURES.find((n) => n.v === c.course_nature)?.l ?? "—"}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {ds.length > 0
                        ? `البرامج: ${[...new Set(ds.map((d) => d.study_plans?.academic_programs?.name ?? "برنامج غير متاح"))].join("، ")}`
                        : plansQuery.isPending
                          ? "جارٍ تحميل البرامج..."
                          : plansQuery.isError
                            ? "تعذر تحميل البرامج"
                            : "لا يظهر في خطة نشطة"}
                    </p>
                  </div>
                  {canManage && (
                    <Button size="sm" variant="outline" onClick={() => start(c)}>
                      تعديل
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>طبيعة المقرر</Label>
              <Select value={nature} onValueChange={setNature}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NATURES.map((n) => (
                    <SelectItem key={n.v} value={n.v}>
                      {n.l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>القسم المسؤول عن المقرر</Label>
              <Select value={department} onValueChange={setDepartment}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(departments ?? []).map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                المسؤولية الأكاديمية والإسناد، مستقلة عن البرامج التي تدرس المقرر.
              </p>
            </div>
            <CourseProgramDetails
              rows={selectedRows}
              loading={plansQuery.isPending}
              error={plansQuery.isError}
              retry={() => void plansQuery.refetch()}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              إلغاء
            </Button>
            <Button
              onClick={() => save.mutate()}
              disabled={
                save.isPending ||
                plansQuery.isPending ||
                plansQuery.isError ||
                !canManage ||
                !department
              }
            >
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
