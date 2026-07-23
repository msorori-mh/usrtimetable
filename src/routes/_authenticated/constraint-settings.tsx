import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCollege } from "@/hooks/use-colleges";
import { useCanManageActiveCollege } from "@/hooks/use-can-manage";
import { CollegeSwitcher } from "@/components/college-switcher";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import { useState, useEffect } from "react";
import { Sliders } from "lucide-react";

export const Route = createFileRoute("/_authenticated/constraint-settings")({
  head: () => ({ meta: [{ title: "إعدادات القيود (الجدولة)" }] }),
  component: ConstraintSettingsPage,
});

interface CType {
  id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  constraint_category: "hard" | "soft";
  is_hard: boolean;
  default_weight: number;
  is_active: boolean;
  description: string | null;
}

interface CSetting {
  id: string;
  constraint_type_id: string;
  enabled: boolean;
  weight: number;
}

interface RowState { enabled: boolean; weight: number; settingId: string | null }

// UI-only display overrides. Keep the technical `code` and DB values unchanged.
const DISPLAY_OVERRIDES: Record<
  string,
  { name_ar?: string; description?: string | null }
> = {
  gap_penalty: {
    name_ar: "تقليل الفجوات بين المحاضرات",
    description:
      "تقليل أوقات الانتظار الفارغة بين محاضرات الدفعات والمحاضرين",
  },
};

function displayFor(type: CType) {
  const override = DISPLAY_OVERRIDES[type.code];
  return {
    name_ar: override?.name_ar ?? type.name_ar,
    description:
      override?.description !== undefined
        ? override.description
        : type.description,
  };
}

function ConstraintSettingsPage() {
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();
  const qc = useQueryClient();
  const [state, setState] = useState<Record<string, RowState>>({});

  const { data: types } = useQuery({
    queryKey: ["constraint-types"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("constraint_types")
        .select("*")
        .eq("is_active", true)
        .order("constraint_category", { ascending: true })
        .order("code");
      if (error) throw error;
      return (data ?? []) as CType[];
    },
  });

  const { data: settings } = useQuery({
    queryKey: ["constraint-settings", active?.id],
    enabled: !!active,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("college_constraint_settings")
        .select("id, constraint_type_id, enabled, weight")
        .eq("college_id", active!.id);
      if (error) throw error;
      return (data ?? []) as CSetting[];
    },
  });

  useEffect(() => {
    if (!types) return;
    const map = new Map((settings ?? []).map((s) => [s.constraint_type_id, s]));
    const next: Record<string, RowState> = {};
    for (const t of types) {
      const s = map.get(t.id);
      next[t.id] = {
        enabled: s ? s.enabled : true,
        weight: s ? s.weight : t.default_weight,
        settingId: s?.id ?? null,
      };
    }
    setState(next);
  }, [types, settings]);

  const save = useMutation({
    mutationFn: async (typeId: string) => {
      if (!active) throw new Error("لا توجد كلية محددة");
      const row = state[typeId];
      const t = types?.find((x) => x.id === typeId);
      if (!row || !t) return;
      if (row.settingId) {
        const { error } = await supabase
          .from("college_constraint_settings")
          .update({ enabled: row.enabled, weight: row.weight })
          .eq("id", row.settingId);
        if (error) throw error;
        await logAudit({
          action: "update",
          entity: "college_constraint_settings",
          entityId: row.settingId,
          collegeId: active.id,
          details: { code: t.code, enabled: row.enabled, weight: row.weight },
        });
      } else {
        const { data, error } = await supabase
          .from("college_constraint_settings")
          .insert({
            college_id: active.id,
            constraint_type_id: typeId,
            enabled: row.enabled,
            weight: row.weight,
          })
          .select("id")
          .single();
        if (error) throw error;
        await logAudit({
          action: "create",
          entity: "college_constraint_settings",
          entityId: data.id,
          collegeId: active.id,
          details: { code: t.code, enabled: row.enabled, weight: row.weight },
        });
      }
    },
    onSuccess: () => {
      toast.success("تم الحفظ");
      qc.invalidateQueries({ queryKey: ["constraint-settings", active?.id] });
    },
    onError: (e: Error) => toast.error(e.message || "فشل الحفظ"),
  });

  const resetToDefault = useMutation({
    mutationFn: async (typeId: string) => {
      const row = state[typeId];
      const t = types?.find((x) => x.id === typeId);
      if (!t) return;
      setState((s) => ({ ...s, [typeId]: { ...s[typeId], enabled: true, weight: t.default_weight } }));
      if (row?.settingId && active) {
        const { error } = await supabase
          .from("college_constraint_settings")
          .update({ enabled: true, weight: t.default_weight })
          .eq("id", row.settingId);
        if (error) throw error;
        await logAudit({
          action: "reset",
          entity: "college_constraint_settings",
          entityId: row.settingId,
          collegeId: active.id,
          details: { code: t.code, weight: t.default_weight },
        });
      }
    },
    onSuccess: () => {
      toast.success("أُعيدت القيمة الافتراضية");
      qc.invalidateQueries({ queryKey: ["constraint-settings", active?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const hard = (types ?? []).filter((t) => t.is_hard);
  const soft = (types ?? []).filter((t) => !t.is_hard);

  const renderGroup = (label: string, items: CType[], lock: boolean) => (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Sliders className="h-4 w-4" />
          {label}
        </h2>
        {lock && <Badge variant="destructive">قيود إلزامية — لا يمكن تعطيلها</Badge>}
      </div>
      <div className="space-y-2">
          {items.map((t) => {
          const row = state[t.id];
          if (!row) return null;
          const display = displayFor(t);
          return (
            <div key={t.id} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center border rounded-md p-3">
              <div className="md:col-span-5">
                <div className="font-medium">{display.name_ar}</div>
                <div className="text-xs text-muted-foreground">{t.code} {t.name_en ? `• ${t.name_en}` : ""}</div>
                {display.description && <div className="text-xs text-muted-foreground mt-1">{display.description}</div>}
              </div>
              <div className="md:col-span-2 flex items-center gap-2">
                <Switch
                  checked={lock ? true : row.enabled}
                  disabled={lock || !canManage}
                  onCheckedChange={(v) => setState((s) => ({ ...s, [t.id]: { ...s[t.id], enabled: v } }))}
                />
                <span className="text-sm">{row.enabled ? "مفعّل" : "معطّل"}</span>
              </div>
              <div className="md:col-span-3 flex items-center gap-2">
                <span className="text-sm text-muted-foreground">الوزن</span>
                <Input
                  type="number"
                  min={0}
                  max={1000}
                  value={row.weight}
                  disabled={!canManage}
                  onChange={(e) =>
                    setState((s) => ({ ...s, [t.id]: { ...s[t.id], weight: Number(e.target.value) || 0 } }))
                  }
                  className="w-24"
                />
                <span className="text-xs text-muted-foreground">(افتراضي: {t.default_weight})</span>
              </div>
              <div className="md:col-span-2 flex gap-2 justify-end">
                <Button size="sm" onClick={() => save.mutate(t.id)} disabled={!canManage || save.isPending}>
                  حفظ
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => resetToDefault.mutate(t.id)}
                  disabled={!canManage}
                >
                  افتراضي
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">إعدادات القيود (الجدولة)</h1>
          <p className="text-sm text-muted-foreground">
            خصّص الأوزان وفعّل/عطّل القيود المرنة لكلّيتك. القيود الإلزامية مفعّلة دائماً.
          </p>
        </div>
        <CollegeSwitcher />
      </div>

      {!active ? (
        <Card className="p-6 text-center text-muted-foreground">اختر كلية للبدء</Card>
      ) : (
        <>
          {renderGroup("القيود الإلزامية (Hard)", hard, true)}
          {renderGroup("القيود المرنة (Soft)", soft, false)}
        </>
      )}
    </div>
  );
}
