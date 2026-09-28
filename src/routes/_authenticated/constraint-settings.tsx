import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { BarChart3, ShieldCheck, Sliders } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCollege } from "@/hooks/use-colleges";
import { useCanManageActiveCollege } from "@/hooks/use-can-manage";
import { CollegeSwitcher } from "@/components/college-switcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { logAudit } from "@/lib/audit";
import {
  fetchInstructorAvailabilityReadiness,
  setInstructorAvailabilityEnforcement,
} from "@/lib/availability/policy-api";

export const Route = createFileRoute("/_authenticated/constraint-settings")({
  head: () => ({ meta: [{ title: "سياسات الجدولة والجودة" }] }),
  component: ConstraintSettingsPage,
});

interface HardConstraintType {
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
  description: string | null;
  default_weight: number;
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
    description: "تقليل أوقات الانتظار الفارغة بين محاضرات الدفعات والمحاضرين.",
  },
  instructor_availability: {
    name_ar: "إتاحة المحاضرين",
    description:
      "عند تفعيلها تطبّق نوافذ التوفر والمنع، ويلزم تعريف توفر صريح للمحاضرين الخارجيين.",
  },
};

function displayFor(item: { code: string; name_ar: string; description: string | null }) {
  const override = DISPLAY_OVERRIDES[item.code];
  return {
    name_ar: override?.name_ar ?? item.name_ar,
    description: override?.description !== undefined ? override.description : item.description,
  };
}

function ConstraintSettingsPage() {
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();
  const qc = useQueryClient();
  const [qualityState, setQualityState] = useState<Record<string, RowState>>({});

  const { data: hardTypes } = useQuery({
    queryKey: ["hard-constraint-types"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("constraint_types")
        .select("id, code, name_ar, name_en, description")
        .eq("is_active", true)
        .eq("is_hard", true)
        .order("code");
      if (error) throw error;
      return (data ?? []) as HardConstraintType[];
    },
  });

  const { data: qualityMetrics } = useQuery({
    queryKey: ["quality-metrics"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quality_metrics")
        .select("id, code, name_ar, name_en, description, default_weight")
        .eq("is_active", true)
        .order("code");
      if (error) throw error;
      return (data ?? []) as QualityMetric[];
    },
  });

  const { data: qualitySettings } = useQuery({
    queryKey: ["college-quality-settings", active?.id],
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

  const {
    data: schedulingPolicy,
    isLoading: policyLoading,
    isError: policyError,
  } = useQuery({
    queryKey: ["scheduling-policy", active?.id],
    enabled: !!active,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("scheduling_settings")
        .select("id, enforce_instructor_availability")
        .eq("college_id", active!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const availabilityReadiness = useQuery({
    queryKey: ["instructor-availability-readiness", active?.id],
    enabled: !!active,
    queryFn: () => fetchInstructorAvailabilityReadiness(active!.id),
  });

  useEffect(() => {
    if (!qualityMetrics) return;
    const settingsByMetric = new Map(
      (qualitySettings ?? []).map((setting) => [setting.quality_metric_id, setting]),
    );
    setQualityState(
      Object.fromEntries(
        qualityMetrics.map((metric) => {
          const setting = settingsByMetric.get(metric.id);
          return [
            metric.id,
            {
              enabled: setting?.enabled ?? true,
              weight: setting?.weight ?? metric.default_weight,
              settingId: setting?.id ?? null,
            },
          ];
        }),
      ),
    );
  }, [qualityMetrics, qualitySettings]);

  const saveQuality = useMutation({
    mutationFn: async (metricId: string) => {
      if (!active) throw new Error("لا توجد كلية محددة");
      const row = qualityState[metricId];
      const metric = qualityMetrics?.find((item) => item.id === metricId);
      if (!row || !metric) throw new Error("تعذر قراءة إعداد المؤشر");

      let entityId = row.settingId;
      if (entityId) {
        const { error } = await supabase
          .from("college_quality_settings")
          .update({ enabled: row.enabled, weight: row.weight })
          .eq("id", entityId)
          .eq("college_id", active.id);
        if (error) throw error;
      } else {
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
        entityId = data.id;
      }

      await logAudit({
        action: row.settingId ? "update" : "create",
        entity: "college_quality_settings",
        entityId,
        collegeId: active.id,
        details: { code: metric.code, enabled: row.enabled, weight: row.weight },
      });
    },
    onSuccess: () => {
      toast.success("تم حفظ إعداد تقييم الجودة");
      qc.invalidateQueries({ queryKey: ["college-quality-settings", active?.id] });
    },
    onError: (error: Error) => toast.error(error.message || "فشل الحفظ"),
  });

  const resetQuality = useMutation({
    mutationFn: async (metricId: string) => {
      if (!active) throw new Error("لا توجد كلية محددة");
      const metric = qualityMetrics?.find((item) => item.id === metricId);
      const row = qualityState[metricId];
      if (!metric || !row) throw new Error("تعذر قراءة إعداد المؤشر");
      if (row.settingId) {
        const { error } = await supabase
          .from("college_quality_settings")
          .delete()
          .eq("id", row.settingId)
          .eq("college_id", active.id);
        if (error) throw error;
        await logAudit({
          action: "delete",
          entity: "college_quality_settings",
          entityId: row.settingId,
          collegeId: active.id,
          details: { code: metric.code, reset_to_default: true },
        });
      }
    },
    onSuccess: () => {
      toast.success("أُعيد المؤشر إلى القيمة الافتراضية");
      qc.invalidateQueries({ queryKey: ["college-quality-settings", active?.id] });
    },
    onError: (error: Error) => toast.error(error.message || "تعذر إعادة الضبط"),
  });

  const setAvailabilityEnforcement = useMutation({
    mutationFn: async (enabled: boolean) => {
      if (!active) throw new Error("لا توجد كلية محددة");
      await setInstructorAvailabilityEnforcement(active.id, enabled);
    },
    onSuccess: () => {
      toast.success("تم تحديث تطبيق إتاحة المحاضرين");
      qc.invalidateQueries({ queryKey: ["scheduling-policy", active?.id] });
      qc.invalidateQueries({ queryKey: ["scheduling_settings", active?.id] });
      qc.invalidateQueries({ queryKey: ["availability-enforcement", active?.id] });
      qc.invalidateQueries({ queryKey: ["instructor-availability-readiness", active?.id] });
    },
    onError: (error: Error) => toast.error(error.message || "فشل تحديث القيد"),
  });

  const availabilityEnabled = schedulingPolicy?.enforce_instructor_availability ?? false;

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">سياسات الجدولة والجودة</h1>
          <p className="text-sm text-muted-foreground">
            حالة القيود الإلزامية الفعلية، ثم مؤشرات الجودة التي يستخدمها التقييم بعد الجدولة.
          </p>
        </div>
        <CollegeSwitcher />
      </div>

      {!active ? (
        <Card className="p-6 text-center text-muted-foreground">اختر كلية للبدء</Card>
      ) : (
        <>
          <Card className="space-y-4 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-semibold">
                  <ShieldCheck className="h-4 w-4" />
                  القيود الإلزامية
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  لا تغيّر الأوزان هذه القيود؛ كل مخالفة غير معتمدة كاستثناء تمنع الحفظ أو الاعتماد.
                  المفتاح التشغيلي الوحيد المعروض هنا هو تطبيق إتاحة المحاضرين من مصدره الفعلي.
                </p>
              </div>
              <Badge variant="destructive">Hard · إنفاذ إلزامي</Badge>
            </div>

            <div className="space-y-2">
              {(hardTypes ?? []).map((type) => {
                const display = displayFor(type);
                const isAvailability = type.code === "instructor_availability";
                const enabled = isAvailability ? availabilityEnabled : true;
                const statusUnknown = isAvailability && policyError;
                return (
                  <div
                    key={type.id}
                    className="grid grid-cols-1 gap-3 rounded-md border p-3 md:grid-cols-12 md:items-center"
                  >
                    <div className="md:col-span-8">
                      <div className="font-medium">{display.name_ar}</div>
                      <div className="text-xs text-muted-foreground">
                        {type.code}
                        {type.name_en ? ` · ${type.name_en}` : ""}
                      </div>
                      {display.description && (
                        <div className="mt-1 text-xs leading-5 text-muted-foreground">
                          {display.description}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 md:col-span-4 md:justify-end">
                      <Switch
                        checked={enabled}
                        disabled={
                          !isAvailability ||
                          !canManage ||
                          policyLoading ||
                          policyError ||
                          (!availabilityEnabled &&
                            (availabilityReadiness.isLoading || availabilityReadiness.isError)) ||
                          setAvailabilityEnforcement.isPending
                        }
                        onCheckedChange={(value) => setAvailabilityEnforcement.mutate(value)}
                      />
                      <Badge
                        variant={!statusUnknown && enabled ? "secondary" : "outline"}
                        className={
                          statusUnknown
                            ? "border-red-400 text-red-800 dark:text-red-200"
                            : enabled
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
                              : "border-amber-400 text-amber-800 dark:text-amber-200"
                        }
                      >
                        {statusUnknown ? "تعذر التحقق" : enabled ? "مطبّق" : "غير مطبّق"}
                      </Badge>
                    </div>
                    {isAvailability &&
                    !availabilityEnabled &&
                    availabilityReadiness.data &&
                    !availabilityReadiness.data.can_activate ? (
                      <p className="text-xs font-medium text-amber-800 md:col-span-12 dark:text-amber-200">
                        لا يمكن التفعيل بعد:{" "}
                        {availabilityReadiness.data.missing_required_instructors} محاضرًا خارجيًا
                        بلا نافذة توفر صريحة.
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </Card>

          <Card className="space-y-4 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-semibold">
                  <BarChart3 className="h-4 w-4" />
                  مؤشرات جودة الجدول
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  هذه المفاتيح والأوزان يقرأها محرك تقييم الجودة فعليًا. لا تحوّل المؤشر المرن إلى
                  قيد إلزامي ولا تغيّر قرار المولّد في هذه المرحلة.
                </p>
              </div>
              <Badge variant="secondary">Soft · تقييم وترتيب</Badge>
            </div>

            <div className="space-y-2">
              {(qualityMetrics ?? []).map((metric) => {
                const row = qualityState[metric.id];
                if (!row) return null;
                const display = displayFor(metric);
                return (
                  <div
                    key={metric.id}
                    className="grid grid-cols-1 gap-3 rounded-md border p-3 md:grid-cols-12 md:items-center"
                  >
                    <div className="md:col-span-5">
                      <div className="font-medium">{display.name_ar}</div>
                      <div className="text-xs text-muted-foreground">
                        {metric.code}
                        {metric.name_en ? ` · ${metric.name_en}` : ""}
                      </div>
                      {display.description && (
                        <div className="mt-1 text-xs leading-5 text-muted-foreground">
                          {display.description}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 md:col-span-2">
                      <Switch
                        checked={row.enabled}
                        disabled={!canManage}
                        onCheckedChange={(value) =>
                          setQualityState((current) => ({
                            ...current,
                            [metric.id]: { ...current[metric.id], enabled: value },
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
                          setQualityState((current) => ({
                            ...current,
                            [metric.id]: {
                              ...current[metric.id],
                              weight: Math.max(0, Number(event.target.value) || 0),
                            },
                          }))
                        }
                        className="w-24"
                      />
                      <span className="text-xs text-muted-foreground">
                        الافتراضي: {metric.default_weight}
                      </span>
                    </div>
                    <div className="flex justify-end gap-2 md:col-span-2">
                      <Button
                        size="sm"
                        onClick={() => saveQuality.mutate(metric.id)}
                        disabled={!canManage || saveQuality.isPending}
                      >
                        حفظ
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => resetQuality.mutate(metric.id)}
                        disabled={!canManage || resetQuality.isPending}
                      >
                        افتراضي
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card className="border-dashed p-4 text-sm text-muted-foreground">
            <div className="flex items-start gap-2">
              <Sliders className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                إضافة سجل جديد إلى دليل القيود لا تنشئ قاعدة عاملة تلقائيًا. أي قاعدة جديدة يجب أن
                ترتبط بقالب معتمد ومعالج في المولّد وفاحص التعارضات وبوابة الحفظ؛ وهذا هو نطاق
                المرحلة التالية «مركز سياسات الجدولة».
              </p>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
