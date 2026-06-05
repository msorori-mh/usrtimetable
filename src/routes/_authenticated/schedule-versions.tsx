import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
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
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import { CalendarClock, Plus, ExternalLink } from "lucide-react";

export const Route = createFileRoute("/_authenticated/schedule-versions")({
  head: () => ({ meta: [{ title: "نسخ الجدول الزمني" }] }),
  component: SchedVersionsPage,
});

const STATUS_LABEL: Record<string, string> = {
  draft: "مسودة", review: "قيد المراجعة", approved: "معتمد",
  published: "منشور", archived: "مؤرشف",
};

function SchedVersionsPage() {
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [termId, setTermId] = useState<string>("");
  const [notes, setNotes] = useState("");

  const { data: terms } = useQuery({
    queryKey: ["terms-for-sv", active?.id],
    enabled: !!active,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("academic_terms").select("id, name, code, academic_year")
        .eq("college_id", active!.id).order("start_date", { ascending: false });
      if (error) throw error; return data ?? [];
    },
  });

  const { data: versions } = useQuery({
    queryKey: ["schedule_versions_list", active?.id],
    enabled: !!active,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("schedule_versions")
        .select("id, name, status, academic_term_id, notes, created_at")
        .eq("college_id", active!.id).order("created_at", { ascending: false });
      if (error) throw error; return data ?? [];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!active || !termId || !name.trim()) throw new Error("الرجاء استكمال البيانات");
      const { data, error } = await supabase.from("schedule_versions").insert({
        college_id: active.id, academic_term_id: termId, name: name.trim(),
        notes: notes.trim() || null, status: "draft",
      }).select("id").single();
      if (error) throw error;
      await logAudit({ action: "create", entity: "schedule_versions", entityId: data.id, collegeId: active.id, details: { name, term_id: termId } });
      return data.id;
    },
    onSuccess: (id) => {
      toast.success("تم إنشاء نسخة الجدول");
      qc.invalidateQueries({ queryKey: ["schedule_versions_list"] });
      setOpen(false); setName(""); setNotes(""); setTermId("");
      navigate({ to: "/timetable/$versionId", params: { versionId: id } });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const termName = (id: string) => terms?.find((t) => t.id === id)?.name ?? "—";

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">نسخ الجدول الزمني</h1>
          <p className="text-sm text-muted-foreground">إنشاء وإدارة نسخ الجدول لكل فصل دراسي.</p>
        </div>
        <div className="flex items-center gap-2">
          <CollegeSwitcher />
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button disabled={!canManage}><Plus className="h-4 w-4 ml-1" /> نسخة جديدة</Button>
            </DialogTrigger>
            <DialogContent dir="rtl">
              <DialogHeader><DialogTitle>إنشاء نسخة جدول</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>الفصل الدراسي</Label>
                  <Select value={termId} onValueChange={setTermId}>
                    <SelectTrigger><SelectValue placeholder="اختر الفصل" /></SelectTrigger>
                    <SelectContent>
                      {(terms ?? []).map((t) => (
                        <SelectItem key={t.id} value={t.id}>{t.name} {t.academic_year ? `— ${t.academic_year}` : ""}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>الاسم</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: المسودة الأولى" />
                </div>
                <div>
                  <Label>ملاحظات</Label>
                  <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
                <Button onClick={() => create.mutate()} disabled={create.isPending}>إنشاء</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {!active ? (
        <Card className="p-6 text-center text-muted-foreground">اختر كلية للبدء</Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {(versions ?? []).map((v) => (
            <Card key={v.id} className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CalendarClock className="h-4 w-4 text-muted-foreground" />
                  <span className="font-semibold">{v.name}</span>
                </div>
                <Badge variant={v.status === "draft" ? "secondary" : "default"}>{STATUS_LABEL[v.status] ?? v.status}</Badge>
              </div>
              <div className="text-xs text-muted-foreground">الفصل: {termName(v.academic_term_id)}</div>
              {v.notes && <div className="text-xs">{v.notes}</div>}
              <div className="text-[10px] text-muted-foreground">{new Date(v.created_at).toLocaleString("ar")}</div>
              <Button variant="outline" size="sm" asChild className="w-full">
                <Link to="/timetable/$versionId" params={{ versionId: v.id }}>
                  <ExternalLink className="h-4 w-4 ml-1" /> فتح الجدول
                </Link>
              </Button>
            </Card>
          ))}
          {versions && versions.length === 0 && (
            <Card className="p-6 text-center text-muted-foreground col-span-full">
              لا توجد نسخ. أنشئ نسخة جديدة للبدء.
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
