import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCollege } from "@/hooks/use-colleges";
import { useCanManageActiveCollege } from "@/hooks/use-can-manage";
import { CollegeSwitcher } from "@/components/college-switcher";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import { Settings2 } from "lucide-react";
import {
  fetchInstructorAvailabilityReadiness,
  setInstructorAvailabilityEnforcement,
} from "@/lib/availability/policy-api";

export const Route = createFileRoute("/_authenticated/scheduling-settings")({
  head: () => ({ meta: [{ title: "إعدادات الجدولة" }] }),
  component: SettingsPage,
});

const DAYS = [
  { v: 6, l: "السبت" },
  { v: 0, l: "الأحد" },
  { v: 1, l: "الإثنين" },
  { v: 2, l: "الثلاثاء" },
  { v: 3, l: "الأربعاء" },
  { v: 4, l: "الخميس" },
  { v: 5, l: "الجمعة" },
];

const timeMinutes = (value: string) => {
  const [hours = "0", minutes = "0"] = value.split(":");
  return Number(hours) * 60 + Number(minutes);
};

interface S {
  id?: string;
  week_start_day: number;
  working_days: number[];
  day_start_time: string;
  day_end_time: string;
  slot_minutes: number;
  min_session_hours: number;
  max_session_hours: number;
  allow_3h_sessions: boolean;
  max_daily_hours_per_instructor: number;
  max_daily_hours_per_section: number;
  max_daily_theory_hours_per_section: number;
  max_daily_practical_hours_per_section: number;
  extended_day_policy_enabled: boolean;
  standard_day_end_time: string;
  max_extended_days_per_partition: number;
  break_between_sessions_min: number;
  allow_back_to_back: boolean;
  enforce_instructor_availability: boolean;
  notes: string;
}

const DEFAULTS: S = {
  week_start_day: 6,
  working_days: [6, 0, 1, 2, 3, 4],
  day_start_time: "08:00",
  day_end_time: "14:00",
  slot_minutes: 60,
  min_session_hours: 1,
  max_session_hours: 3,
  allow_3h_sessions: true,
  max_daily_hours_per_instructor: 8,
  max_daily_hours_per_section: 8,
  max_daily_theory_hours_per_section: 6,
  max_daily_practical_hours_per_section: 8,
  extended_day_policy_enabled: false,
  standard_day_end_time: "14:00",
  max_extended_days_per_partition: 2,
  break_between_sessions_min: 0,
  allow_back_to_back: true,
  enforce_instructor_availability: false,
  notes: "",
};

function SettingsPage() {
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();
  const qc = useQueryClient();
  const [form, setForm] = useState<S>(DEFAULTS);

  const readinessQuery = useQuery({
    queryKey: ["instructor-availability-readiness", active?.id],
    enabled: !!active,
    queryFn: () => fetchInstructorAvailabilityReadiness(active!.id),
  });

  const { data, isLoading } = useQuery({
    queryKey: ["scheduling_settings", active?.id],
    enabled: !!active,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("scheduling_settings")
        .select("*")
        .eq("college_id", active!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (data)
      setForm({
        ...DEFAULTS,
        ...data,
        working_days: (data.working_days ?? DEFAULTS.working_days).map(Number),
        notes: data.notes ?? "",
      });
    else setForm(DEFAULTS);
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!active) throw new Error("اختر كلّية");
      if (form.working_days.length === 0) {
        throw new Error("اختر يوم دوام واحدًا على الأقل.");
      }
      if (timeMinutes(form.day_end_time) <= timeMinutes(form.day_start_time)) {
        throw new Error("نهاية اليوم يجب أن تكون بعد بدايته.");
      }
      if (
        form.extended_day_policy_enabled &&
        (timeMinutes(form.standard_day_end_time) <= timeMinutes(form.day_start_time) ||
          timeMinutes(form.standard_day_end_time) >= timeMinutes(form.day_end_time))
      ) {
        throw new Error("نهاية اليوم القياسي يجب أن تقع بين بداية اليوم ونهايته الممتدة.");
      }
      if (
        form.max_daily_hours_per_instructor < 1 ||
        form.max_daily_hours_per_instructor > 12 ||
        form.max_daily_hours_per_section < 1 ||
        form.max_daily_hours_per_section > 12 ||
        form.max_daily_theory_hours_per_section < 1 ||
        form.max_daily_theory_hours_per_section > form.max_daily_hours_per_section ||
        form.max_daily_practical_hours_per_section < 1 ||
        form.max_daily_practical_hours_per_section > form.max_daily_hours_per_section
      ) {
        throw new Error(
          "حدود العبء اليومي يجب أن تكون موجبة، وألا يتجاوز النظري أو العملي الحد الكلي.",
        );
      }
      if (
        form.max_extended_days_per_partition < 0 ||
        form.max_extended_days_per_partition > form.working_days.length
      ) {
        throw new Error("أيام التمديد يجب أن تقع بين صفر وعدد أيام الدوام.");
      }
      const { enforce_instructor_availability: requestedEnforcement, ...settings } = form;
      const payload = { ...settings, college_id: active.id };
      if (data?.id) {
        const { error } = await supabase
          .from("scheduling_settings")
          .update(payload)
          .eq("id", data.id);
        if (error) throw error;
        await logAudit({
          action: "update",
          entity: "scheduling_settings",
          entityId: data.id,
          collegeId: active.id,
        });
      } else {
        const { data: ins, error } = await supabase
          .from("scheduling_settings")
          .insert({ ...payload, enforce_instructor_availability: false })
          .select("id")
          .single();
        if (error) throw error;
        await logAudit({
          action: "create",
          entity: "scheduling_settings",
          entityId: ins?.id,
          collegeId: active.id,
        });
      }
      if (requestedEnforcement !== (data?.enforce_instructor_availability ?? false)) {
        await setInstructorAvailabilityEnforcement(active.id, requestedEnforcement);
      }
    },
    onSuccess: () => {
      toast.success("تم الحفظ");
      qc.invalidateQueries({ queryKey: ["scheduling_settings", active?.id] });
      qc.invalidateQueries({ queryKey: ["scheduling-policy", active?.id] });
      qc.invalidateQueries({ queryKey: ["availability-enforcement", active?.id] });
      qc.invalidateQueries({ queryKey: ["instructor-availability-readiness", active?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleDay = (d: number) => {
    const ds = form.working_days.includes(d)
      ? form.working_days.filter((x) => x !== d)
      : [...form.working_days, d].sort();
    setForm({ ...form, working_days: ds });
  };

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-6 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-secondary text-primary">
          <Settings2 className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">إعدادات الجدولة</h1>
          <p className="text-sm text-muted-foreground">
            القواعد العامة للأسبوع الدراسي والمحاضرات.
          </p>
        </div>
      </header>
      <div className="mb-4">
        <CollegeSwitcher />
      </div>

      {isLoading ? (
        <p className="text-center text-muted-foreground">جارٍ التحميل...</p>
      ) : (
        <Card className="space-y-4 p-6">
          <div>
            <Label>أيام العمل الأسبوعية</Label>
            <div className="mt-2 flex flex-wrap gap-2">
              {DAYS.map((d) => (
                <button
                  key={d.v}
                  type="button"
                  disabled={!canManage}
                  onClick={() => toggleDay(d.v)}
                  className={`rounded-md border px-3 py-1.5 text-sm ${form.working_days.includes(d.v) ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}
                >
                  {d.l}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>بداية اليوم</Label>
              <Input
                type="time"
                value={form.day_start_time}
                onChange={(e) => setForm({ ...form, day_start_time: e.target.value })}
                disabled={!canManage}
              />
            </div>
            <div>
              <Label>نهاية اليوم</Label>
              <Input
                type="time"
                value={form.day_end_time}
                onChange={(e) => setForm({ ...form, day_end_time: e.target.value })}
                disabled={!canManage}
              />
            </div>
          </div>

          <div className="rounded-lg border p-4">
            <label className="flex items-start gap-3 text-sm">
              <Checkbox
                checked={form.extended_day_policy_enabled}
                onCheckedChange={(v) => setForm({ ...form, extended_day_policy_enabled: !!v })}
                disabled={!canManage}
              />
              <span>
                <span className="block font-semibold">السماح بأيام تدريس ممتدة للطلاب</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  عند التفعيل يُسمح بالتجاوز بعد نهاية اليوم القياسي ضمن العدد المحدد فقط، مع بقاء
                  قيد كلية الحاسوب للنظري حتى 14:00 مطبقًا من الخادم.
                </span>
              </span>
            </label>
            {form.extended_day_policy_enabled ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>نهاية اليوم القياسي</Label>
                  <Input
                    type="time"
                    value={form.standard_day_end_time}
                    onChange={(e) => setForm({ ...form, standard_day_end_time: e.target.value })}
                    disabled={!canManage}
                  />
                </div>
                <div>
                  <Label>أقصى أيام تمديد لكل مجموعة طلاب</Label>
                  <Input
                    type="number"
                    min={0}
                    max={form.working_days.length}
                    value={form.max_extended_days_per_partition}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        max_extended_days_per_partition: Number(e.target.value),
                      })
                    }
                    disabled={!canManage}
                  />
                </div>
              </div>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label>حجم الفترة (دقائق)</Label>
              <Input
                type="number"
                value={form.slot_minutes}
                onChange={(e) => setForm({ ...form, slot_minutes: Number(e.target.value) })}
                disabled={!canManage}
              />
            </div>
            <div>
              <Label>أقل مدة محاضرة (س)</Label>
              <Input
                type="number"
                step="0.5"
                value={form.min_session_hours}
                onChange={(e) => setForm({ ...form, min_session_hours: Number(e.target.value) })}
                disabled={!canManage}
              />
            </div>
            <div>
              <Label>أقصى مدة محاضرة (س)</Label>
              <Input
                type="number"
                step="0.5"
                value={form.max_session_hours}
                onChange={(e) => setForm({ ...form, max_session_hours: Number(e.target.value) })}
                disabled={!canManage}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <Label>سقف ساعات المحاضر/يوم</Label>
              <Input
                type="number"
                value={form.max_daily_hours_per_instructor}
                onChange={(e) =>
                  setForm({ ...form, max_daily_hours_per_instructor: Number(e.target.value) })
                }
                disabled={!canManage}
              />
            </div>
            <div>
              <Label>سقف ساعات المجموعة/يوم</Label>
              <Input
                type="number"
                value={form.max_daily_hours_per_section}
                onChange={(e) =>
                  setForm({ ...form, max_daily_hours_per_section: Number(e.target.value) })
                }
                disabled={!canManage}
              />
            </div>
            <div>
              <Label>سقف الساعات النظرية للمجموعة/يوم</Label>
              <Input
                type="number"
                value={form.max_daily_theory_hours_per_section}
                onChange={(e) =>
                  setForm({ ...form, max_daily_theory_hours_per_section: Number(e.target.value) })
                }
                disabled={!canManage}
              />
            </div>
            <div>
              <Label>سقف الساعات العملية للمجموعة/يوم</Label>
              <Input
                type="number"
                value={form.max_daily_practical_hours_per_section}
                onChange={(e) =>
                  setForm({
                    ...form,
                    max_daily_practical_hours_per_section: Number(e.target.value),
                  })
                }
                disabled={!canManage}
              />
            </div>
            <div>
              <Label>الفاصل بين المحاضرات (دقائق)</Label>
              <Input
                type="number"
                value={form.break_between_sessions_min}
                onChange={(e) =>
                  setForm({ ...form, break_between_sessions_min: Number(e.target.value) })
                }
                disabled={!canManage}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div
              className={`rounded-lg border p-4 ${
                form.enforce_instructor_availability
                  ? "border-emerald-300 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/20"
                  : "border-amber-300 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/20"
              }`}
            >
              <label className="flex items-start gap-3 text-sm">
                <Checkbox
                  checked={form.enforce_instructor_availability}
                  onCheckedChange={(v) =>
                    setForm({ ...form, enforce_instructor_availability: !!v })
                  }
                  disabled={!canManage}
                />
                <span>
                  <span className="block font-semibold">تطبيق إتاحة المحاضرين كقيد إلزامي</span>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                    {form.enforce_instructor_availability
                      ? "مفعّل: يطبق نوافذ التوفر والمنع في المولّد والتحقق والحفظ، ويلزم تعريف توفر المحاضرين الخارجيين."
                      : "غير مفعّل: تُحفظ نوافذ التوفر والمنع للتهيئة فقط ولا تؤثر في الجدولة حتى يتم تفعيل هذا الخيار."}
                  </span>
                  {!form.enforce_instructor_availability &&
                  readinessQuery.data &&
                  !readinessQuery.data.can_activate ? (
                    <span className="mt-2 block text-xs font-medium text-amber-800 dark:text-amber-200">
                      غير جاهز للتفعيل: {readinessQuery.data.missing_required_instructors} محاضرًا
                      خارجيًا بلا نافذة توفر صريحة.
                    </span>
                  ) : null}
                </span>
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={form.allow_3h_sessions}
                onCheckedChange={(v) => setForm({ ...form, allow_3h_sessions: !!v })}
                disabled={!canManage}
              />{" "}
              السماح بمحاضرات ٣ ساعات
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={form.allow_back_to_back}
                onCheckedChange={(v) => setForm({ ...form, allow_back_to_back: !!v })}
                disabled={!canManage}
              />{" "}
              السماح بمحاضرات متتالية
            </label>
          </div>

          <div>
            <Label>ملاحظات</Label>
            <Input
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              disabled={!canManage}
            />
          </div>

          {canManage && (
            <div className="flex justify-end">
              <Button onClick={() => save.mutate()} disabled={save.isPending}>
                حفظ الإعدادات
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
