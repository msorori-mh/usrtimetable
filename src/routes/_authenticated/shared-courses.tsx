import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCollege } from "@/hooks/use-colleges";
import { useCanManageActiveCollege } from "@/hooks/use-can-manage";
import { CollegeSwitcher } from "@/components/college-switcher";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
  { v: "department", l: "قسم" },
  { v: "college", l: "كلية (مشترك)" },
  { v: "university", l: "جامعة (مشترك)" },
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
  const [shared, setShared] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());

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
  const { data: links } = useQuery({
    queryKey: ["cd-links", active?.id],
    enabled: !!active,
    queryFn: async () =>
      (
        await supabase
          .from("course_departments")
          .select("course_id, department_id")
          .eq("college_id", active!.id)
      ).data ?? [],
  });

  const linksByCourse = useMemo(() => {
    const m = new Map<string, string[]>();
    (links ?? []).forEach((l) => {
      const arr = m.get(l.course_id) ?? [];
      arr.push(l.department_id);
      m.set(l.course_id, arr);
    });
    return m;
  }, [links]);
  const depName = new Map((departments ?? []).map((d) => [d.id, d.name]));

  const start = (c: Course) => {
    setEditing(c);
    setNature(c.course_nature ?? "department");
    setShared(c.is_shared ?? false);
    setPicked(new Set(linksByCourse.get(c.id) ?? []));
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!editing || !active) throw new Error("اختر مقرراً");
      const { error: e1 } = await supabase
        .from("courses")
        .update({ course_nature: nature, is_shared: shared })
        .eq("id", editing.id);
      if (e1) throw e1;
      const current = new Set(linksByCourse.get(editing.id) ?? []);
      const toAdd = [...picked].filter((d) => !current.has(d));
      const toRemove = [...current].filter((d) => !picked.has(d));
      if (toAdd.length) {
        const { error } = await supabase
          .from("course_departments")
          .insert(
            toAdd.map((d) => ({ college_id: active.id, course_id: editing.id, department_id: d })),
          );
        if (error) throw error;
      }
      if (toRemove.length) {
        const { error } = await supabase
          .from("course_departments")
          .delete()
          .eq("course_id", editing.id)
          .in("department_id", toRemove);
        if (error) throw error;
      }
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
      qc.invalidateQueries({ queryKey: ["cd-links", active?.id] });
      setEditing(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const togglePick = (id: string) => {
    const n = new Set(picked);
    n.has(id) ? n.delete(id) : n.add(id);
    setPicked(n);
  };

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-6 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-secondary text-primary">
          <Share2 className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">المقررات المشتركة</h1>
          <p className="text-sm text-muted-foreground">حدّد طبيعة المقرر وربطه بأقسام متعددة.</p>
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
              const ds = linksByCourse.get(c.id) ?? [];
              return (
                <li key={c.id} className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {c.name}
                      {c.is_shared && (
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
                        ? `أقسام: ${ds.map((d) => depName.get(d) ?? "—").join("، ")}`
                        : "غير مرتبط بأقسام إضافية"}
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
        <DialogContent>
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
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={shared} onCheckedChange={(v) => setShared(!!v)} /> مقرر مشترك
              (يُدرَّس لأقسام متعددة)
            </label>
            <div>
              <Label>الأقسام المرتبطة</Label>
              <div className="mt-2 max-h-60 space-y-1 overflow-y-auto rounded border p-2">
                {(departments ?? []).map((d) => (
                  <label
                    key={d.id}
                    className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-secondary/50"
                  >
                    <Checkbox checked={picked.has(d.id)} onCheckedChange={() => togglePick(d.id)} />
                    {d.name}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              إلغاء
            </Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
