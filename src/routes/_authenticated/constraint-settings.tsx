import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Sliders } from "lucide-react";
import { toast } from "sonner";

import { CollegeSwitcher } from "@/components/college-switcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useActiveCollege } from "@/hooks/use-colleges";
import { useCanManageActiveCollege } from "@/hooks/use-can-manage";
import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/lib/audit";

export const Route = createFileRoute("/_authenticated/constraint-settings")({
  head: () => ({ meta: [{ title: "سياسة القيود وجودة الجدول" }] }),
  component: ConstraintSettingsPage,
});

interface HardConstraint {
  id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  description: string | null;
}

interface QualityMetric {
  id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  default_weight: number;
  description: string | null;
}

interface QualitySetting {
  id: string;
  quality_metric_id: string;
  enabled: boolean;
  weight: number;
}

interface RowState {
  enabled: boolean;
  weight: number;
  settingId: string | null;
}

const DISPLAY_OVERRIDES: Record<string, { name_ar?: string; description?: string | null }> = {
  gap_penalty: {
    name_ar: "تقليل الفجوات بين المحاضرات",
    description: "تقليل أوقات الانتظار الفارغة بين محاضرات الدفعات والمحاضرين",
  },
};

function displayFor(metric: QualityMetric) {
  const override = DISPLAY_OVERRIDES[metric.code];
  return {
    name_ar: override?.name_ar ?? metric.name_ar,
    description: override?.description !== undefined ? override.description : metric.description,
  };
}

function ConstraintSettingsPage() {
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();
  const queryClient = useQueryClient();
  const [state, setState] = useState<Record<string, RowState>>({});

  const { data: hardConstraints } = useQuery({
    queryKey: ["hard-constraint-registry"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("constraint_types")
        .select("id, code, name_ar, name_en, description")
        .eq("is_active", true)
        .eq("is_hard", true)
        .order("code");
      if (error) throw error;
      return (data ?? []) as HardConstraint[];
    },
  });

  const { data: metrics } = useQuery({
    queryKey: ["quality-metrics"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quality_metrics")
        .select("id, code, name_ar, name_en, default_weight, description")
        .eq("is_active", true)
        .order("code");
      if (error) throw error;
      return (data ?? []) as QualityMetric[];
    },
  });

  const { data: settings } = useQuery({
    queryKey: ["quality-settings", active?.id],
    enabled: !!active,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("college_quality_settings")
        .select("id, quality_metric_id, enabled, weight")
        .eq("college_id", active!.id);
      if (error) throw error;
      return (data ?? []) as QualitySetting[];
    },
  });

  useEffect(() => {
    if (!metrics) return;
    const saved = new Map((settings ?? []).map((setting) => [setting.quality_metric_id, setting]));
    const next: Record<string, RowState> = {};
    for (const metric of metrics) {
      const setting = saved.get(metric.id);
      next[metric.id] = {
        enabled: setting?.enabled ?? true,
        weight: setting?.weight ?? metric.default_weight,
        settingId: setting?.id ?? null,
      };
    }
    setState(next);
  }, [metrics, settings]);

  const save = useMutation({
    mutationFn: async (metricId: string) => {
      if (!active) throw new Error("لا توجد كلية محددة");
      const row = state[metricId];
      const metric = metrics?.find((item) => item.id === metricId);
      if (!row || !metric) throw new Error("تعذر تحديد معيار الجودة");
      if (!Number.isFinite(row.weight) || row.weight < 0 || row.weight > 1000) {
        throw new Error("وزن معيار الجودة يجب أن يكون بين 0 و1000");
      }

      if (row.settingId) {
        const { error } = await supabase
          .from("college_quality_settings")
          .update({ enabled: row.enabled, weight: row.weight })
          .eq("id", row.settingId)
          .eq("college_id", active.id);
        if (error) throw error;
        await logAudit({
          action: "update",
          entity: "college_quality_settings",
          entityId: row.settingId,
          collegeId: active.id,
          details: { code: metric.code, enabled: row.enabled, weight: row.weight },
        });
        return;
      }

      const { data, error } = await supabase
        .from("college_quality_settings")
        .insert({
          college_id: active.id,
          quality_metric_id: metricId,
          enabled: row.enabled,
          weight: row.weight,
        })
        .select("id")
        .single();
      if (error) throw error;
      await logAudit({
        action: "create",
        entity: "college_quality_settings",
        entityId: data.id,
        collegeId: active.id,
        details: { code: metric.code, enabled: row.enabled, weight: row.weight },
      });
    },
    onSuccess: () => {
      toast.success("تم حفظ وزن تقييم الجودة");
      queryClient.invalidateQueries({ queryKey: ["quality-settings", active?.id] });
    },
    onError: (error: Error) => toast.error(error.message || "فشل الحفظ"),
  });

  const resetToDefault = useMutation({
    mutationFn: async (metricId: string) => {
      if (!active) throw new Error("لا توجد كلية محددة");
      const row = state[metricId];
      const metric = metrics?.find((item) => item.id === metricId);
      if (!row || !metric) throw new Error("تعذر تحديد معيار الجودة");

      if (row.settingId) {
        const { error } = await supabase
          .from("college_quality_settings")
          .update({ enabled: true, weight: metric.default_weight })
          .eq("id", row.settingId)
          .eq("college_id", active.id);
        if (error) throw error;
        await logAudit({
          action: "reset",
          entity: "college_quality_settings",
          entityId: row.settingId,
          collegeId: active.id,
          details: { code: metric.code, weight: metric.default_weight },
        });
      }
      setState((current) => ({
        ...current,
        [metricId]: {
          ...current[metricId],
          enabled: true,
          weight: metric.default_weight,
        },
      }));
    },
    onSuccess: () => {
      toast.success("أُعيد معيار الجودة إلى قيمته الافتراضية");
      queryClient.invalidateQueries({ queryKey: ["quality-settings", active?.id] });
    },
    onError: (error: Error) => toast.error(error.message || "فشل الاستعادة"),
  });

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">سياسة القيود وجودة الجدول</h1>
          <p className="text-sm text-muted-foreground">
            افصل بين القيود الصلبة التي تمنع التعارض، ومعايير الجودة المرنة التي ترتب جودة الحل.
          </p>
        </div>
        <CollegeSwitcher />
      </div>

      {!active ? (
        <Card className="p-6 text-center text-muted-foreground">اختر كلية للبدء</Card>
      ) : (
        <>
          <Card className="space-y-4 border-destructive/30 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <Sliders className="h-4 w-4" />
                القيود الصلبة
              </h2>
              <Badge variant="destructive">إلزامية — لا يمكن تعطيلها أو تخفيف وزنها</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              هذه قائمة تعريفية فقط. يطبقها محرك التعارضات وقواعد قاعدة البيانات مباشرة، ولا تُستخدم
              أوزانها لتجاوز منع التعارض أو أهلية النشر.
            </p>
            <div className="space-y-2">
              {(hardConstraints ?? []).map((constraint) => (
                <div
                  key={constraint.id}
                  className="grid grid-cols-1 items-center gap-3 rounded-md border p-3 md:grid-cols-12"
                >
                  <div className="md:col-span-9">
                    <div className="font-medium">{constraint.name_ar}</div>
                    <div className="text-xs text-muted-foreground">
                      {constraint.code}
                      {constraint.name_en ? ` • ${constraint.name_en}` : ""}
                    </div>
                    {constraint.description && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {constraint.description}
                      </div>
                    )}
                  </div>
                  <div className="flex justify-end md:col-span-3">
                    <Badge variant="outline">مطبّق دائمًا</Badge>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="space-y-4 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <Sliders className="h-4 w-4" />
                معايير تقييم الجودة
              </h2>
              <Badge variant="secondary">مرنة وقابلة للضبط لكل كلية</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              هذه القيم يقرأها محرك تقييم الجودة فعليًا. تؤثر في الدرجة والمفاضلة بين الحلول، ولا
              تعطل القيود الصلبة ولا تسمح بتعارض محاضر أو قاعة.
            </p>
            <div className="space-y-2">
              {(metrics ?? []).map((metric) => {
                const row = state[metric.id];
                if (!row) return null;
                const display = displayFor(metric);
                return (
                  <div
                    key={metric.id}
                    className="grid grid-cols-1 items-center gap-3 rounded-md border p-3 md:grid-cols-12"
                  >
                    <div className="md:col-span-5">
                      <div className="font-medium">{display.name_ar}</div>
                      <div className="text-xs text-muted-foreground">
                        {metric.code}
                        {metric.name_en ? ` • ${metric.name_en}` : ""}
                      </div>
                      {display.description && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {display.description}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 md:col-span-2">
                      <Switch
                        checked={row.enabled}
                        disabled={!canManage}
                        onCheckedChange={(enabled) =>
                          setState((current) => ({
                            ...current,
                            [metric.id]: { ...current[metric.id], enabled },
                          }))
                        }
                      />
                      <span className="text-sm">{row.enabled ? "مفعّل" : "معطّل"}</span>
                    </div>
                    <div className="flex items-center gap-2 md:col-span-3">
                      <span className="text-sm text-muted-foreground">الوزن</span>
                      <Input
                        type="number"
                        min={0}
                        max={1000}
                        value={row.weight}
                        disabled={!canManage}
                        onChange={(event) =>
                          setState((current) => ({
                            ...current,
                            [metric.id]: {
                              ...current[metric.id],
                              weight: Number(event.target.value),
                            },
                          }))
                        }
                        className="w-24"
                      />
                      <span className="text-xs text-muted-foreground">
                        (افتراضي: {metric.default_weight})
                      </span>
                    </div>
                    <div className="flex justify-end gap-2 md:col-span-2">
                      <Button
                        size="sm"
                        onClick={() => save.mutate(metric.id)}
                        disabled={!canManage || save.isPending}
                      >
                        حفظ
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => resetToDefault.mutate(metric.id)}
                        disabled={!canManage || resetToDefault.isPending}
                      >
                        افتراضي
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
