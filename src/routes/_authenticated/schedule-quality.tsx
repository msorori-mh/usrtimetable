import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCollege } from "@/hooks/use-colleges";
import { useCanManageActiveCollege } from "@/hooks/use-can-manage";
import { CollegeSwitcher } from "@/components/college-switcher";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Gauge, AlertTriangle, Activity } from "lucide-react";
import { scoreScheduleVersion, type QualityResult } from "@/lib/conflict-engine/scorer";
import { logAudit } from "@/lib/audit";

export const Route = createFileRoute("/_authenticated/schedule-quality")({
  head: () => ({ meta: [{ title: "جودة الجدول الزمني" }] }),
  component: ScheduleQualityPage,
});

function ScheduleQualityPage() {
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();
  const [versionId, setVersionId] = useState<string>("");
  const [result, setResult] = useState<QualityResult | null>(null);
  const [running, setRunning] = useState(false);

  const { data: versions } = useQuery({
    queryKey: ["schedule-versions", active?.id],
    enabled: !!active,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("schedule_versions")
        .select("id, name, status")
        .eq("college_id", active!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: recent } = useQuery({
    queryKey: ["quality-runs", active?.id, versionId],
    enabled: !!active && !!versionId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("schedule_quality_runs")
        .select("*")
        .eq("college_id", active!.id)
        .eq("schedule_version_id", versionId)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data ?? [];
    },
  });

  const runScoring = async () => {
    if (!active || !versionId) return;
    setRunning(true);
    try {
      const { runId, result } = await scoreScheduleVersion({
        collegeId: active.id,
        scheduleVersionId: versionId,
      });
      setResult(result);
      await logAudit({
        action: "create",
        entity: "schedule_quality_runs",
        entityId: runId,
        collegeId: active.id,
        details: { total_score: result.total_score, soft: result.soft_conflicts_count, hard: result.hard_conflicts_count },
      });
      toast.success(`النتيجة: ${result.total_score}/100`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">جودة الجدول الزمني</h1>
          <p className="text-sm text-muted-foreground">احتساب درجة الجدول من 100 بناءً على القيود المرنة.</p>
        </div>
        <CollegeSwitcher />
      </div>

      {!active ? (
        <Card className="p-6 text-center text-muted-foreground">اختر كلية للبدء</Card>
      ) : (
        <>
          <Card className="p-4 flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-64">
              <label className="text-sm text-muted-foreground">نسخة الجدول</label>
              <Select value={versionId} onValueChange={setVersionId}>
                <SelectTrigger><SelectValue placeholder="اختر نسخة الجدول" /></SelectTrigger>
                <SelectContent>
                  {(versions ?? []).map((v) => (
                    <SelectItem key={v.id} value={v.id}>{v.name} — {v.status}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={runScoring} disabled={!canManage || !versionId || running}>
              {running ? "جاري الاحتساب..." : "احتساب الجودة"}
            </Button>
          </Card>

          {result && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Gauge className="h-4 w-4" /> الدرجة الكلية
                </div>
                <div className="text-4xl font-bold mt-2">{result.total_score}<span className="text-base text-muted-foreground">/100</span></div>
                <div className="text-xs text-muted-foreground mt-1">إجمالي الخصم: {result.total_deductions}</div>
              </Card>
              <Card className="p-4">
                <div className="flex items-center gap-2 text-destructive text-sm">
                  <AlertTriangle className="h-4 w-4" /> تعارضات إلزامية
                </div>
                <div className="text-4xl font-bold mt-2">{result.hard_conflicts_count}</div>
              </Card>
              <Card className="p-4">
                <div className="flex items-center gap-2 text-amber-600 text-sm">
                  <Activity className="h-4 w-4" /> مخالفات مرنة
                </div>
                <div className="text-4xl font-bold mt-2">{result.soft_conflicts_count}</div>
              </Card>
            </div>
          )}

          {result && (
            <Card className="p-4">
              <h2 className="text-lg font-semibold mb-3">تفصيل المقاييس</h2>
              <div className="space-y-2">
                {Object.entries(result.metrics_breakdown).length === 0 && (
                  <div className="text-sm text-muted-foreground">لا توجد خصومات.</div>
                )}
                {Object.entries(result.metrics_breakdown).map(([code, info]) => (
                  <div key={code} className="flex items-center justify-between border rounded-md p-3">
                    <div>
                      <div className="font-medium">{code}</div>
                      <div className="text-xs text-muted-foreground">عدد المخالفات: {info.count} • الوزن: {info.weight}</div>
                    </div>
                    <Badge variant="secondary">-{info.deduction}</Badge>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {result && result.soft_violations.length > 0 && (
            <Card className="p-4">
              <h2 className="text-lg font-semibold mb-3">المخالفات المرنة</h2>
              <div className="space-y-2 max-h-96 overflow-auto">
                {result.soft_violations.map((v, i) => (
                  <div key={i} className="border rounded-md p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{v.message_ar}</span>
                      <Badge variant="outline">-{v.score_impact}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">{v.code} • {v.message_en}</div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {result && result.hard_conflicts.length > 0 && (
            <Card className="p-4">
              <h2 className="text-lg font-semibold mb-3 text-destructive">التعارضات الإلزامية</h2>
              <div className="space-y-2 max-h-96 overflow-auto">
                {result.hard_conflicts.map((c, i) => (
                  <div key={i} className="border rounded-md p-3 text-sm">
                    <div className="font-medium">{c.message_ar}</div>
                    <div className="text-xs text-muted-foreground">{c.code} • {c.message_en}</div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {recent && recent.length > 0 && (
            <Card className="p-4">
              <h2 className="text-lg font-semibold mb-3">آخر عمليات الاحتساب</h2>
              <div className="space-y-2">
                {recent.map((r) => (
                  <div key={r.id} className="flex items-center justify-between border rounded-md p-2 text-sm">
                    <span>{new Date(r.created_at).toLocaleString("ar")}</span>
                    <div className="flex gap-2">
                      <Badge>{r.total_score}/100</Badge>
                      <Badge variant="destructive">إلزامية: {r.hard_conflicts_count}</Badge>
                      <Badge variant="secondary">مرنة: {r.soft_conflicts_count}</Badge>
                    </div>
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
