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
import { Checkbox } from "@/components/ui/checkbox";
import { useCourseProgramLinks, courseProgramClient } from "@/hooks/use-course-program-links";
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
  updated_at: string;
}

function SharedPage() {
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Course | null>(null);
  const [nature, setNature] = useState("department");
  const [shared, setShared] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [editingCollege, setEditingCollege] = useState<string>();
  const linksQuery = useCourseProgramLinks(active?.id);
  const programs = linksQuery.data?.programs ?? [];
  const links = linksQuery.data?.links ?? [];

  const { data: courses, isLoading } = useQuery({
    queryKey: ["courses-shared", active?.id],
    enabled: !!active,
    queryFn: async () =>
      ((
        await supabase
          .from("courses")
          .select("id, code, name, department_id, course_nature, is_shared, updated_at")
          .eq("college_id", active!.id)
          .order("code")
      ).data ?? []) as Course[],
  });
  const start = (c: Course) => {
    setEditing(c);
    setNature(c.course_nature ?? "department");
    setShared(c.is_shared);
    setEditingCollege(active?.id);
    setPicked(links.filter((l) => l.course_id === c.id).map((l) => l.program_id));
  };

  const save = useMutation({
    mutationFn: async () => {
      if (
        !editing ||
        !active ||
        !canManage ||
        linksQuery.isPending ||
        linksQuery.isError ||
        editingCollege !== active.id
      )
        throw new Error("تعذر الحفظ قبل تحميل البرامج والتحقق من الصلاحية");
      const { error: e1 } = await courseProgramClient.rpc("save_course_programs", {
        p_college_id: active.id,
        p_course_id: editing.id,
        p_nature: nature,
        p_program_ids: picked,
        p_is_shared: shared,
        p_expected_updated_at: editing.updated_at,
      });
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
      qc.invalidateQueries({ queryKey: ["course-program-links", active?.id] });
      qc.invalidateQueries({ queryKey: ["course-programs", active?.id] });
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
            حدّد طبيعة المقرر واختر البرامج التي تدرسه.
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
              const ds = links.filter((l) => l.course_id === c.id);
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
                        ? `البرامج: ${[...new Set(ds.map((d) => programs.find((p) => p.id === d.program_id)?.name ?? "برنامج غير متاح"))].join("، ")}`
                        : linksQuery.isPending
                          ? "جارٍ تحميل البرامج..."
                          : linksQuery.isError
                            ? "تعذر تحميل البرامج"
                            : "لم تُحدد البرامج بعد"}
                    </p>
                  </div>
                  {canManage && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => start(c)}
                      disabled={linksQuery.isPending || linksQuery.isError}
                    >
                      تعديل
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Dialog
        open={!!editing && editingCollege === active?.id}
        onOpenChange={(o) => !o && setEditing(null)}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>طبيعة المقرر</Label>
              <Select disabled={save.isPending} value={nature} onValueChange={setNature}>
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
              <Checkbox
                checked={shared}
                disabled={save.isPending}
                onCheckedChange={(v) => setShared(v === true)}
              />
              مقرر مشترك (يُدرَّس لبرامج متعددة)
            </label>
            <div>
              <Label>البرامج المرتبطة</Label>
              <div className="mt-2 max-h-60 space-y-1 overflow-y-auto rounded border p-2">
                {programs.map((p) => (
                  <label
                    key={p.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm hover:bg-secondary/50"
                  >
                    <Checkbox
                      disabled={save.isPending}
                      checked={picked.includes(p.id)}
                      onCheckedChange={(checked) =>
                        setPicked((previous) =>
                          checked === true
                            ? [...new Set([...previous, p.id])]
                            : previous.filter((id) => id !== p.id),
                        )
                      }
                    />
                    {p.name}
                  </label>
                ))}
                {!programs.length && (
                  <p className="text-sm text-muted-foreground">لا توجد برامج في هذه الكلية.</p>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              إلغاء
            </Button>
            <Button
              onClick={() => save.mutate()}
              disabled={
                save.isPending ||
                linksQuery.isPending ||
                linksQuery.isError ||
                !canManage ||
                editingCollege !== active?.id
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
