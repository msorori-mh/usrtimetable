import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCollege } from "@/hooks/use-colleges";
import { useCanManageActiveCollege } from "@/hooks/use-can-manage";
import { CollegeSwitcher } from "@/components/college-switcher";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import { validateScheduleVersion } from "@/lib/conflict-engine/validator";
import { ShieldAlert, PlayCircle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/conflict-checks")({
  head: () => ({ meta: [{ title: "فحص التعارضات (الجدولة)" }] }),
  component: ConflictChecksPage,
});

interface SV { id: string; name: string; status: string; academic_term_id: string }
interface ChkRow {
  id: string; status: string; total_conflicts: number;
  created_at: string; completed_at: string | null; check_type: string;
}
interface CR {
  id: string; conflict_code: string; severity: string;
  message_ar: string; message_en: string;
  schedule_session_id: string | null; related_session_id: string | null;
}

function ConflictChecksPage() {
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();
  const qc = useQueryClient();
  const [versionId, setVersionId] = useState<string>("");
  const [selectedCheck, setSelectedCheck] = useState<string | null>(null);

  const { data: versions } = useQuery({
    queryKey: ["schedule_versions", active?.id],
    enabled: !!active,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("schedule_versions")
        .select("id, name, status, academic_term_id")
        .eq("college_id", active!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as SV[];
    },
  });

  const { data: checks } = useQuery({
    queryKey: ["conflict_checks", active?.id, versionId],
    enabled: !!active && !!versionId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conflict_checks")
        .select("id, status, total_conflicts, created_at, completed_at, check_type")
        .eq("college_id", active!.id)
        .eq("schedule_version_id", versionId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as ChkRow[];
    },
  });

  const { data: results } = useQuery({
    queryKey: ["conflict_results", selectedCheck],
    enabled: !!selectedCheck && !!active,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conflict_results")
        .select("id, conflict_code, severity, message_ar, message_en, schedule_session_id, related_session_id")
        .eq("college_id", active!.id)
        .eq("conflict_check_id", selectedCheck!)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as CR[];
    },
  });

  const run = useMutation({
    mutationFn: async () => {
      if (!active || !versionId) throw new Error("اختر إصداراً");
      const { checkId, result } = await validateScheduleVersion({
        collegeId: active.id,
        scheduleVersionId: versionId,
      });
      await logAudit({
        action: "validate",
        entity: "schedule_versions",
        entityId: versionId,
        collegeId: active.id,
        details: { check_id: checkId, total: result.totalHardConflicts },
      });
      return { checkId, count: result.totalHardConflicts };
    },
    onSuccess: ({ checkId, count }) => {
      toast.success(count === 0 ? "لا توجد تعارضات" : `تم العثور على ${count} تعارض`);
      setSelectedCheck(checkId);
      qc.invalidateQueries({ queryKey: ["conflict_checks", active?.id, versionId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mx-auto max-w-5xl" dir="rtl">
      <header className="mb-6 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-secondary text-primary">
          <ShieldAlert className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">فحص التعارضات الإلزامية</h1>
          <p className="text-sm text-muted-foreground">
            اختر إصداراً للجدول وقم بتشغيل فحص القيود الإلزامية. لن يتم تعديل المحاضرات.
          </p>
        </div>
        <CollegeSwitcher />
      </header>

      {!active ? (
        <Card className="p-6 text-center text-muted-foreground">اختر كلّية أولاً.</Card>
      ) : (
        <>
          <Card className="mb-4 p-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="md:col-span-2">
                <Label>إصدار الجدول</Label>
                <Select value={versionId} onValueChange={(v) => { setVersionId(v); setSelectedCheck(null); }}>
                  <SelectTrigger><SelectValue placeholder="اختر إصداراً" /></SelectTrigger>
                  <SelectContent>
                    {(versions ?? []).map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.name} <span className="text-muted-foreground">· {v.status}</span>
                      </SelectItem>
                    ))}
                    {(versions ?? []).length === 0 && (
                      <div className="px-2 py-1.5 text-xs text-muted-foreground">لا توجد إصدارات بعد</div>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Button
                  className="w-full gap-2"
                  disabled={!canManage || !versionId || run.isPending}
                  onClick={() => run.mutate()}
                >
                  <PlayCircle className="h-4 w-4" />
                  {run.isPending ? "جارٍ الفحص..." : "تشغيل الفحص"}
                </Button>
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card className="p-4">
              <h2 className="mb-3 text-sm font-semibold">عمليات الفحص الأخيرة</h2>
              {!checks || checks.length === 0 ? (
                <p className="text-sm text-muted-foreground">لا توجد عمليات فحص بعد لهذا الإصدار.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {checks.map((c) => (
                    <li key={c.id}>
                      <button
                        onClick={() => setSelectedCheck(c.id)}
                        className={`w-full p-2 text-right hover:bg-muted ${selectedCheck === c.id ? "bg-muted" : ""}`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm">
                            {new Date(c.created_at).toLocaleString("ar-EG")}
                          </span>
                          <Badge variant={c.total_conflicts === 0 ? "secondary" : "destructive"}>
                            {c.total_conflicts} تعارض
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground">{c.check_type} · {c.status}</div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card className="p-4">
              <h2 className="mb-3 text-sm font-semibold">نتائج الفحص</h2>
              {!selectedCheck ? (
                <p className="text-sm text-muted-foreground">اختر عملية فحص لعرض التفاصيل.</p>
              ) : !results || results.length === 0 ? (
                <p className="text-sm text-emerald-600">لا توجد تعارضات إلزامية.</p>
              ) : (
                <ul className="space-y-2">
                  {results.map((r) => (
                    <li key={r.id} className="rounded border border-destructive/30 bg-destructive/5 p-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono text-muted-foreground">{r.conflict_code}</span>
                        <Badge variant="destructive">{r.severity}</Badge>
                      </div>
                      <p className="mt-1 text-sm">{r.message_ar}</p>
                      <p className="text-xs text-muted-foreground" dir="ltr">{r.message_en}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
