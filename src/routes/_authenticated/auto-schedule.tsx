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
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import { runGreedyAutoSchedule } from "@/lib/auto-scheduler/greedy";
import { Sparkles, AlertCircle, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/auto-schedule")({
  head: () => ({ meta: [{ title: "الجدولة التلقائية" }] }),
  component: AutoSchedulePage,
});

function AutoSchedulePage() {
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();
  const qc = useQueryClient();
  const [versionId, setVersionId] = useState<string>("");

  const { data: versions } = useQuery({
    queryKey: ["sv-for-auto", active?.id],
    enabled: !!active,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("schedule_versions")
        .select("id, name, status, academic_term_id")
        .eq("college_id", active!.id)
        .in("status", ["draft", "review"])
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: runs } = useQuery({
    queryKey: ["auto-runs", active?.id, versionId],
    enabled: !!active && !!versionId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("auto_schedule_runs")
        .select("*")
        .eq("college_id", active!.id)
        .eq("schedule_version_id", versionId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });

  const run = useMutation({
    mutationFn: async () => {
      if (!active || !versionId) throw new Error("اختر النسخة");
      const result = await runGreedyAutoSchedule({
        collegeId: active.id,
        scheduleVersionId: versionId,
      });
      await logAudit({
        action: "auto_schedule_run",
        entity: "auto_schedule_runs",
        entityId: result.runId,
        collegeId: active.id,
        details: {
          placed: result.placed,
          unplaced: result.unplaced.length,
          score: result.qualityScoreAfter,
          duration_ms: result.durationMs,
        },
      });
      return result;
    },
    onSuccess: (r) => {
      toast.success(`تم وضع ${r.placed} جلسة. غير مجدول: ${r.unplaced.length}.`);
      qc.invalidateQueries({ queryKey: ["auto-runs"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const latest = runs?.[0];

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">الجدولة التلقائية</h1>
          <p className="text-sm text-muted-foreground">
            خوارزمية شَرِهة (Greedy) — تضع كل تكليف تدريسي في أول فترة مسموحة وقاعة مناسبة دون أي تعارض إلزامي.
          </p>
        </div>
        <CollegeSwitcher />
      </div>

      {!active ? (
        <Card className="p-6 text-center text-muted-foreground">اختر كلية للبدء</Card>
      ) : (
        <>
          <Card className="p-4 space-y-3">
            <div className="flex items-end gap-3 flex-wrap">
              <div className="min-w-64">
                <label className="text-xs text-muted-foreground">نسخة الجدول</label>
                <Select value={versionId} onValueChange={setVersionId}>
                  <SelectTrigger><SelectValue placeholder="اختر النسخة" /></SelectTrigger>
                  <SelectContent>
                    {(versions ?? []).map((v) => (
                      <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                disabled={!canManage || !versionId || run.isPending}
                onClick={() => run.mutate()}
              >
                <Sparkles className="h-4 w-4 ml-1" />
                {run.isPending ? "جارٍ التشغيل..." : "تشغيل الجدولة التلقائية"}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              التشغيل يضيف جلسات جديدة فقط للتكليفات غير المجدولة في هذه النسخة. لا يُعدّل ولا يحذف الجلسات القائمة.
            </p>
          </Card>

          {latest && (
            <Card className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                {latest.status === "completed" ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-amber-600" />
                )}
                <span className="font-semibold">نتيجة آخر تشغيل</span>
                <Badge variant="secondary">{latest.status}</Badge>
                <span className="text-xs text-muted-foreground mr-auto">
                  {new Date(latest.created_at).toLocaleString("ar")}
                </span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-center">
                <Stat label="مطلوب" value={(latest.summary as { total_required_sessions?: number } | null)?.total_required_sessions ?? (latest.placed_sessions + latest.unplaced_sessions)} />
                <Stat label="جلسات موضوعة" value={latest.placed_sessions} />
                <Stat label="غير مجدول" value={latest.unplaced_sessions} accent={latest.unplaced_sessions > 0 ? "warn" : undefined} />
                <Stat label="تعارضات إلزامية" value={latest.hard_conflicts_after} accent={latest.hard_conflicts_after > 0 ? "danger" : undefined} />
                <Stat label="مخالفات مرنة" value={latest.soft_violations_after} />
                <Stat label="درجة الجودة" value={latest.quality_score_after ?? "—"} />
              </div>
              {(() => {
                const sum = latest.summary as { by_session_type?: Record<string, { required: number; placed: number; unplaced: number }>; warnings?: string[] } | null;
                const bt = sum?.by_session_type;
                if (!bt) return null;
                return (
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(bt).map(([type, v]) => (
                      <Badge key={type} variant="outline" className="text-[11px]">
                        {type}: {v.placed}/{v.required} {v.unplaced > 0 ? `(غير مجدول ${v.unplaced})` : ""}
                      </Badge>
                    ))}
                  </div>
                );
              })()}
              <div className="text-[11px] text-muted-foreground">
                المدة: {latest.duration_ms ?? 0} ms — إجمالي العروض: {latest.total_offerings}
              </div>
              {(() => {
                const w = (latest.summary as { warnings?: string[] } | null)?.warnings ?? [];
                if (w.length === 0) return null;
                return (
                  <div className="border rounded-md p-2 bg-amber-50 dark:bg-amber-950/30 text-[11px] max-h-32 overflow-y-auto">
                    <p className="font-semibold mb-1">تحذيرات ({w.length})</p>
                    <ul className="space-y-0.5">
                      {w.slice(0, 10).map((m, i) => <li key={i}>• {m}</li>)}
                    </ul>
                  </div>
                );
              })()}
              {Array.isArray(latest.unplaced) && (latest.unplaced as unknown[]).length > 0 && (
                <div className="border rounded-md p-3 max-h-80 overflow-y-auto bg-muted/30">
                  <p className="text-sm font-semibold mb-2">قائمة غير المجدول</p>
                  <ul className="text-xs space-y-1">
                    {(latest.unplaced as Array<{ teaching_assignment_id: string; session_type: string; duration_minutes?: number; unit_index?: number; reason: string }>).map((u, i) => (
                      <li key={i} className="flex justify-between gap-2 border-b py-1">
                        <span className="text-muted-foreground">
                          {u.session_type}#{u.unit_index ?? 1} ({u.duration_minutes ?? 0}د) — {u.teaching_assignment_id?.slice(0, 8)}
                        </span>
                        <span className="truncate">{u.reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          )}

          {runs && runs.length > 1 && (
            <Card className="p-4">
              <p className="font-semibold mb-2 text-sm">عمليات سابقة</p>
              <div className="space-y-1 text-xs">
                {runs.slice(1).map((r) => (
                  <div key={r.id} className="flex justify-between border-b py-1">
                    <span>{new Date(r.created_at).toLocaleString("ar")}</span>
                    <span>وُضع {r.placed_sessions} / غير مجدول {r.unplaced_sessions} / جودة {r.quality_score_after ?? "—"}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number | string; accent?: "warn" | "danger" }) {
  const color = accent === "danger" ? "text-destructive" : accent === "warn" ? "text-amber-600" : "";
  return (
    <div className="rounded-md border p-2">
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}
