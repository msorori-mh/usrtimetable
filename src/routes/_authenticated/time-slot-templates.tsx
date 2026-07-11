import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCollege } from "@/hooks/use-colleges";
import { useCanManageActiveCollege } from "@/hooks/use-can-manage";
import { CollegeSwitcher } from "@/components/college-switcher";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import { Clock, ChevronDown, Trash2 } from "lucide-react";
import {
  ALL_WEEK_DAYS,
  DAY_LABELS_AR,
  DEFAULT_DAY_END,
  DEFAULT_DAY_START,
  DEFAULT_GRID_MINUTES,
  DEFAULT_WORKING_DAYS,
  ALLOWED_DURATIONS,
  diffAgainstExisting,
  generateWeeklyTemplates,
  type DayOverride,
  type GeneratedTemplate,
  type StudySystem,
} from "@/lib/time-templates/weekly-generator";

export const Route = createFileRoute("/_authenticated/time-slot-templates")({
  head: () => ({ meta: [{ title: "قوالب أوقات المحاضرات" }] }),
  component: TimeSlotTemplatesPage,
});

interface TST {
  id: string;
  study_system: StudySystem;
  day_of_week: number;
  start_time: string;
  end_time: string;
  slot_duration_minutes: number;
  is_active: boolean;
}

const SYSTEM_LABELS: Record<StudySystem, string> = {
  regular: "عام",
  parallel: "موازي",
  both: "عام وموازي",
};

function emptyOverride(day: number): DayOverride {
  return {
    enabled: DEFAULT_WORKING_DAYS.includes(day as (typeof DEFAULT_WORKING_DAYS)[number]),
    startTime: DEFAULT_DAY_START,
    endTime: DEFAULT_DAY_END,
    durations: [...ALLOWED_DURATIONS],
    blockedWindows: [],
  };
}

function TimeSlotTemplatesPage() {
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();
  const qc = useQueryClient();

  const [filterSystem, setFilterSystem] = useState<StudySystem | "all">("all");
  const [termFilter, setTermFilter] = useState<string>("all");
  const [studySystem, setStudySystem] = useState<StudySystem>("regular");
  const [dayStart, setDayStart] = useState(DEFAULT_DAY_START);
  const [dayEnd, setDayEnd] = useState(DEFAULT_DAY_END);
  const [gridMinutes, setGridMinutes] = useState(DEFAULT_GRID_MINUTES);
  const [durations, setDurations] = useState<number[]>([...ALLOWED_DURATIONS]);
  const [dayOverrides, setDayOverrides] = useState<Record<number, DayOverride>>(() => {
    const init: Record<number, DayOverride> = {};
    for (const d of ALL_WEEK_DAYS) init[d] = emptyOverride(d);
    return init;
  });
  /** Single source of truth: enabled flags on dayOverrides. */
  const selectedDays = useMemo(
    () => ALL_WEEK_DAYS.filter((d) => dayOverrides[d]?.enabled === true),
    [dayOverrides],
  );
  const [customizingDay, setCustomizingDay] = useState<number | null>(null);
  const [preview, setPreview] = useState<GeneratedTemplate[] | null>(null);
  const [previewMeta, setPreviewMeta] = useState<{
    selectedDays: number;
    slots120PerDay: number;
    slots180PerDay: number;
    total: number;
    skippedBreakConflicts: number;
    toInsert: number;
    duplicates: number;
    conflicts: number;
    duplicatesInGeneratedBatch: number;
    conflictDetails: Array<GeneratedTemplate & { reason: string }>;
  } | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [singleForm, setSingleForm] = useState({
    study_system: "regular" as StudySystem,
    day_of_week: 6,
    start_time: "08:00",
    end_time: "10:00",
    slot_duration_minutes: 120,
  });

  const { data: terms } = useQuery({
    queryKey: ["terms-min", active?.id],
    enabled: !!active,
    queryFn: async () =>
      (
        await supabase
          .from("academic_terms")
          .select("id, name, is_active")
          .eq("college_id", active!.id)
          .order("name")
      ).data ?? [],
  });

  const { data: breaks } = useQuery({
    queryKey: ["daily-breaks", active?.id],
    enabled: !!active,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_breaks")
        .select("id, name, start_time, end_time, days, affects_scheduling")
        .eq("college_id", active!.id);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: rows, isLoading } = useQuery({
    queryKey: ["tst", active?.id, filterSystem],
    enabled: !!active,
    queryFn: async () => {
      let q = supabase.from("time_slot_templates").select("*").eq("college_id", active!.id);
      if (filterSystem !== "all") q = q.eq("study_system", filterSystem);
      const { data, error } = await q
        .order("study_system")
        .order("day_of_week")
        .order("start_time");
      if (error) throw error;
      return (data ?? []) as TST[];
    },
  });

  const weeklyGrid = useMemo(() => {
    const byDay: Record<number, TST[]> = {};
    for (const d of ALL_WEEK_DAYS) byDay[d] = [];
    for (const r of rows ?? []) {
      if (!byDay[r.day_of_week]) byDay[r.day_of_week] = [];
      byDay[r.day_of_week].push(r);
    }
    return byDay;
  }, [rows]);

  const setDayEnabled = (day: number, checked: boolean) => {
    setDayOverrides((prev) => ({
      ...prev,
      [day]: { ...(prev[day] ?? emptyOverride(day)), enabled: checked },
    }));
  };

  const toggleDay = (day: number, checked: boolean) => {
    setDayEnabled(day, checked);
  };

  const toggleDuration = (d: number, checked: boolean) => {
    setDurations((prev) => (checked ? [...new Set([...prev, d])] : prev.filter((x) => x !== d)));
  };

  const applyGeneralToSelected = () => {
    setDayOverrides((prev) => {
      const next = { ...prev };
      const enabled = ALL_WEEK_DAYS.filter((d) => prev[d]?.enabled);
      for (const day of enabled) {
        next[day] = {
          enabled: true,
          startTime: dayStart,
          endTime: dayEnd,
          durations: [...durations],
          blockedWindows: next[day]?.blockedWindows ?? [],
        };
      }
      for (const day of ALL_WEEK_DAYS) {
        if (!enabled.includes(day)) {
          next[day] = { ...(next[day] ?? emptyOverride(day)), enabled: false };
        }
      }
      return next;
    });
    toast.success("تم تطبيق الإعداد على الأيام المحددة");
  };

  const runPreview = () => {
    const result = generateWeeklyTemplates({
      studySystem,
      days: selectedDays,
      dayStart,
      dayEnd,
      gridMinutes,
      durations,
      breaks: (breaks ?? []).map((b) => ({
        start_time: b.start_time,
        end_time: b.end_time,
        days: b.days,
        affects_scheduling: b.affects_scheduling,
      })),
      dayOverrides,
    });
    if (result.errors.length > 0) {
      toast.error(result.errors[0]);
      setPreview(null);
      setPreviewMeta(null);
      return;
    }
    const diff = diffAgainstExisting(result.templates, rows ?? []);
    setPreview(result.templates);
    setPreviewMeta({
      selectedDays: result.selectedDays,
      slots120PerDay: result.slots120PerDay,
      slots180PerDay: result.slots180PerDay,
      total: result.total,
      skippedBreakConflicts: result.skippedBreakConflicts,
      toInsert: diff.toInsert.length,
      duplicates: diff.duplicates.length,
      conflicts: diff.conflicts.length,
      duplicatesInGeneratedBatch: diff.duplicatesInGeneratedBatch.length,
      conflictDetails: diff.conflicts,
    });
    toast.success(
      `معاينة: ${result.total} قالبًا (جديد ${diff.toInsert.length} · موجود ${diff.duplicates.length} · متعارض ${diff.conflicts.length})`,
    );
  };

  const saveWeekly = useMutation({
    mutationFn: async () => {
      if (!active) throw new Error("اختر كلّية");
      if (!preview || !previewMeta) throw new Error("عاين القوالب أولاً");

      // Re-load latest rows immediately before save (application-level idempotency).
      const { data: freshRows, error: freshErr } = await supabase
        .from("time_slot_templates")
        .select("*")
        .eq("college_id", active.id)
        .eq("study_system", studySystem);
      if (freshErr) throw freshErr;

      const diff = diffAgainstExisting(preview, freshRows ?? []);
      if (diff.conflicts.length > 0) {
        throw new Error(
          `يوجد ${diff.conflicts.length} قالبًا متعارضًا — أصلح التعارضات قبل الحفظ. مثال: ${diff.conflicts[0].reason}`,
        );
      }
      if (diff.toInsert.length === 0)
        throw new Error("يوجد قالب مطابق مسبقًا لهذا اليوم والنظام — لا سجلات جديدة للحفظ.");
      if (
        !confirm(
          `سيتم إدراج ${diff.toInsert.length} قالبًا جديدًا دون استبدال الموجود (${diff.duplicates.length} مطابق، ${diff.conflicts.length} متعارض، ${diff.duplicatesInGeneratedBatch.length} مكرر داخل المعاينة). المتابعة؟`,
        )
      ) {
        throw new Error("تم إلغاء الحفظ");
      }
      const payload = diff.toInsert.map((t) => ({
        college_id: active.id,
        study_system: t.study_system,
        day_of_week: t.day_of_week,
        start_time: t.start_time,
        end_time: t.end_time,
        slot_duration_minutes: t.slot_duration_minutes,
        is_active: true,
      }));
      const { error, data } = await supabase.from("time_slot_templates").insert(payload).select("id");
      if (error) throw error;
      const inserted = data?.length ?? 0;
      if (inserted !== payload.length) {
        throw new Error(
          `حُفظ ${inserted} من ${payload.length} قالبًا فقط — لم يكتمل الإدراج بالكامل.`,
        );
      }
      await logAudit({
        action: "create",
        entity: "time_slot_templates",
        entityId: null,
        collegeId: active.id,
      });
      return inserted;
    },
    onSuccess: (n) => {
      toast.success(`تم حفظ ${n} قالبًا`);
      setPreview(null);
      setPreviewMeta(null);
      qc.invalidateQueries({ queryKey: ["tst", active?.id] });
    },
    onError: (e: Error) => {
      if (e.message !== "تم إلغاء الحفظ") toast.error(e.message);
    },
  });

  const addSingle = useMutation({
    mutationFn: async () => {
      if (!active) throw new Error("اختر كلّية");
      if (singleForm.end_time <= singleForm.start_time)
        throw new Error("يجب أن يكون وقت نهاية الدوام بعد وقت البداية.");
      if (singleForm.slot_duration_minutes < 15 || singleForm.slot_duration_minutes > 480)
        throw new Error("مدة الفترة يجب أن تكون بين 15 و 480 دقيقة");
      const dup = (rows ?? []).some(
        (r) =>
          r.study_system === singleForm.study_system &&
          r.day_of_week === singleForm.day_of_week &&
          r.start_time.slice(0, 5) === singleForm.start_time.slice(0, 5) &&
          r.end_time.slice(0, 5) === singleForm.end_time.slice(0, 5) &&
          r.slot_duration_minutes === singleForm.slot_duration_minutes,
      );
      if (dup) throw new Error("يوجد قالب مطابق مسبقًا لهذا اليوم والنظام.");
      const payload = { ...singleForm, college_id: active.id, is_active: true };
      const { data, error } = await supabase
        .from("time_slot_templates")
        .insert(payload)
        .select("id")
        .single();
      if (error) throw error;
      await logAudit({
        action: "create",
        entity: "time_slot_templates",
        entityId: data?.id,
        collegeId: active.id,
      });
    },
    onSuccess: () => {
      toast.success("تمت إضافة القالب المفرد");
      qc.invalidateQueries({ queryKey: ["tst", active?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: async (r: TST) => {
      const { error } = await supabase
        .from("time_slot_templates")
        .update({ is_active: !r.is_active })
        .eq("id", r.id);
      if (error) throw error;
      await logAudit({
        action: "update",
        entity: "time_slot_templates",
        entityId: r.id,
        collegeId: active?.id,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tst", active?.id] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("time_slot_templates").delete().eq("id", id);
      if (error) throw error;
      await logAudit({
        action: "delete",
        entity: "time_slot_templates",
        entityId: id,
        collegeId: active?.id,
      });
    },
    onSuccess: () => {
      toast.success("تم الحذف");
      qc.invalidateQueries({ queryKey: ["tst", active?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-secondary text-primary">
          <Clock className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">قوالب أوقات المحاضرات</h1>
          <p className="text-sm text-muted-foreground">
            تحديد أيام وساعات التدريس والمدد المسموح بها، ثم توليد القوالب الزمنية تلقائيًا.
          </p>
        </div>
        <CollegeSwitcher />
      </header>

      {!active ? (
        <p className="rounded border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground">
          اختر كلّية أولاً.
        </p>
      ) : (
        <>
          <Card className="p-4 space-y-4">
            <p className="text-sm font-semibold">1) السياق</p>
            <div className="grid gap-3 md:grid-cols-4">
              <div>
                <Label>الفصل الأكاديمي (للتصفية/العرض)</Label>
                <Select value={termFilter} onValueChange={setTermFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="اختياري" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل الفصول الأكاديمية</SelectItem>
                    {(terms ?? []).map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>نظام الدراسة</Label>
                <Select value={studySystem} onValueChange={(v) => setStudySystem(v as StudySystem)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="regular">{SYSTEM_LABELS.regular}</SelectItem>
                    <SelectItem value="parallel">{SYSTEM_LABELS.parallel}</SelectItem>
                    <SelectItem value="both">{SYSTEM_LABELS.both}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>الكلّية</Label>
                <Input value={active.name} disabled />
              </div>
              <div>
                <Label>حالة القوالب الجديدة</Label>
                <Input value="مفعّل عند الحفظ" disabled />
              </div>
            </div>
          </Card>

          {canManage && (
            <>
              <Card className="p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">2) أيام الدراسة</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={applyGeneralToSelected}
                  >
                    تطبيق الإعداد على الأيام المحددة
                  </Button>
                </div>
                <div className="flex flex-wrap gap-4">
                  {ALL_WEEK_DAYS.map((day) => (
                    <label key={day} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={selectedDays.includes(day)}
                        onCheckedChange={(c) => toggleDay(day, !!c)}
                      />
                      {DAY_LABELS_AR[day]}
                    </label>
                  ))}
                </div>
                <div className="space-y-2 border-t border-border pt-3">
                  <p className="text-xs text-muted-foreground">تخصيص يومي (اختياري)</p>
                  <div className="flex flex-wrap gap-2">
                    {ALL_WEEK_DAYS.map((day) => (
                      <Button
                        key={day}
                        type="button"
                        size="sm"
                        variant={customizingDay === day ? "default" : "outline"}
                        onClick={() => setCustomizingDay(customizingDay === day ? null : day)}
                      >
                        تخصيص {DAY_LABELS_AR[day]}
                      </Button>
                    ))}
                  </div>
                  {customizingDay !== null && dayOverrides[customizingDay] && (
                    <div className="grid gap-3 rounded-md border border-border p-3 md:grid-cols-4">
                      <label className="flex items-center gap-2 text-sm md:col-span-4">
                        <Checkbox
                          checked={dayOverrides[customizingDay].enabled}
                          onCheckedChange={(c) => setDayEnabled(customizingDay, !!c)}
                        />
                        تفعيل {DAY_LABELS_AR[customizingDay]}
                      </label>
                      <div>
                        <Label>بداية الدوام</Label>
                        <Input
                          dir="ltr"
                          type="time"
                          value={dayOverrides[customizingDay].startTime}
                          onChange={(e) =>
                            setDayOverrides((prev) => ({
                              ...prev,
                              [customizingDay]: {
                                ...prev[customizingDay],
                                startTime: e.target.value,
                              },
                            }))
                          }
                        />
                      </div>
                      <div>
                        <Label>نهاية الدوام</Label>
                        <Input
                          dir="ltr"
                          type="time"
                          value={dayOverrides[customizingDay].endTime}
                          onChange={(e) =>
                            setDayOverrides((prev) => ({
                              ...prev,
                              [customizingDay]: {
                                ...prev[customizingDay],
                                endTime: e.target.value,
                              },
                            }))
                          }
                        />
                      </div>
                      <div className="md:col-span-2 flex flex-wrap items-end gap-3">
                        {[120, 180].map((d) => (
                          <label key={d} className="flex items-center gap-2 text-sm">
                            <Checkbox
                              checked={dayOverrides[customizingDay].durations.includes(d)}
                              onCheckedChange={(c) =>
                                setDayOverrides((prev) => {
                                  const cur = prev[customizingDay].durations;
                                  const next = c
                                    ? [...new Set([...cur, d])]
                                    : cur.filter((x) => x !== d);
                                  return {
                                    ...prev,
                                    [customizingDay]: { ...prev[customizingDay], durations: next },
                                  };
                                })
                              }
                            />
                            {d === 120 ? "ساعتان" : "ثلاث ساعات"}
                          </label>
                        ))}
                      </div>
                      <div className="md:col-span-4">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setDayOverrides((prev) => ({
                              ...prev,
                              [customizingDay]: {
                                // Reset times/durations only — keep current enabled state
                                enabled: prev[customizingDay]?.enabled ?? false,
                                startTime: dayStart,
                                endTime: dayEnd,
                                durations: [...durations],
                                blockedWindows: [],
                              },
                            }))
                          }
                        >
                          إعادة تطبيق الإعداد العام
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </Card>

              <Card className="p-4 space-y-4">
                <p className="text-sm font-semibold">3) ساعات التدريس</p>
                <div className="grid gap-3 md:grid-cols-3">
                  <div>
                    <Label>بداية الدوام</Label>
                    <Input
                      dir="ltr"
                      type="time"
                      value={dayStart}
                      onChange={(e) => setDayStart(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label>نهاية الدوام</Label>
                    <Input
                      dir="ltr"
                      type="time"
                      value={dayEnd}
                      onChange={(e) => setDayEnd(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label>دقة الشبكة (دقيقة)</Label>
                    <Input
                      dir="ltr"
                      type="number"
                      min={15}
                      value={gridMinutes}
                      onChange={(e) => setGridMinutes(Number(e.target.value))}
                    />
                  </div>
                </div>
              </Card>

              <Card className="p-4 space-y-3">
                <p className="text-sm font-semibold">4) مدد الجلسات</p>
                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={durations.includes(120)}
                      onCheckedChange={(c) => toggleDuration(120, !!c)}
                    />
                    ساعتان — 120 دقيقة
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={durations.includes(180)}
                      onCheckedChange={(c) => toggleDuration(180, !!c)}
                    />
                    ثلاث ساعات — 180 دقيقة
                  </label>
                </div>
                <p className="text-xs text-muted-foreground">
                  تُحدد مدة الجلسة الفعلية من الخطة الدراسية أو إسناد المقرر. المعامل: 120 دقيقة فقط
                  (لا تُعامل كـ 180).
                </p>
              </Card>

              <Card className="p-4 space-y-3">
                <p className="text-sm font-semibold">5) الاستراحات اليومية</p>
                {!breaks || breaks.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    لا توجد استراحات معرفة. لن تُنسخ الاستراحات إلى القوالب.
                  </p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {breaks.map((b) => (
                      <li key={b.id} className="rounded border border-border px-3 py-2">
                        <span className="font-medium">{b.name}</span>{" "}
                        <span dir="ltr" className="text-muted-foreground">
                          {b.start_time.slice(0, 5)} → {b.end_time.slice(0, 5)}
                        </span>
                        {b.affects_scheduling !== false && (
                          <span className="mr-2 text-xs text-amber-700">
                            · يمنع التقاطع عند التوليد
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card className="p-4 space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="flex-1 text-sm font-semibold">6) المعاينة والحفظ</p>
                  <Button type="button" variant="outline" onClick={runPreview}>
                    معاينة القوالب
                  </Button>
                  <Button
                    type="button"
                    onClick={() => saveWeekly.mutate()}
                    disabled={
                      !previewMeta ||
                      previewMeta.toInsert === 0 ||
                      previewMeta.conflicts > 0 ||
                      saveWeekly.isPending
                    }
                  >
                    حفظ الجديد فقط ({previewMeta?.toInsert ?? 0})
                  </Button>
                </div>
                {previewMeta && (
                  <div className="grid gap-2 text-sm md:grid-cols-2">
                    <p>الأيام المحددة: {previewMeta.selectedDays}</p>
                    <p>قوالب الساعتين لكل يوم: {previewMeta.slots120PerDay}</p>
                    <p>قوالب الثلاث ساعات لكل يوم: {previewMeta.slots180PerDay}</p>
                    <p>الإجمالي: {previewMeta.total}</p>
                    <p>
                      قوالب جديدة: {previewMeta.toInsert} · موجودة مسبقًا: {previewMeta.duplicates}
                    </p>
                    <p>
                      متعارضة: {previewMeta.conflicts} · مكررة داخل المعاينة:{" "}
                      {previewMeta.duplicatesInGeneratedBatch}
                    </p>
                    <p>متجاوز بسبب استراحة: {previewMeta.skippedBreakConflicts}</p>
                    <p className="text-xs text-muted-foreground md:col-span-2">
                      الحماية من التكرار على مستوى التطبيق فقط — لا يوجد قيد uniqueness في قاعدة
                      البيانات حاليًا.
                    </p>
                  </div>
                )}
                {previewMeta && previewMeta.conflictDetails.length > 0 && (
                  <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                    <p className="font-semibold">تعارضات تمنع الحفظ:</p>
                    <ul className="mt-1 list-disc pr-5">
                      {previewMeta.conflictDetails.slice(0, 5).map((c, i) => (
                        <li key={i}>
                          {DAY_LABELS_AR[c.day_of_week]} {c.start_time}–{c.end_time} (
                          {c.slot_duration_minutes}د): {c.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {preview && preview.length > 0 && (
                  <div className="max-h-64 overflow-auto rounded border border-border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted text-xs">
                        <tr>
                          <th className="p-2 text-right">اليوم</th>
                          <th className="p-2 text-right">من</th>
                          <th className="p-2 text-right">إلى</th>
                          <th className="p-2 text-right">المدة</th>
                          <th className="p-2 text-right">النظام</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.slice(0, 60).map((t, i) => (
                          <tr key={i} className="border-t border-border">
                            <td className="p-2">{DAY_LABELS_AR[t.day_of_week]}</td>
                            <td className="p-2" dir="ltr">
                              {t.start_time}
                            </td>
                            <td className="p-2" dir="ltr">
                              {t.end_time}
                            </td>
                            <td className="p-2">{t.slot_duration_minutes}</td>
                            <td className="p-2">{SYSTEM_LABELS[t.study_system]}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {preview.length > 60 && (
                      <p className="p-2 text-xs text-muted-foreground">
                        عرض أول 60 من {preview.length}
                      </p>
                    )}
                  </div>
                )}
                <p className="text-xs text-amber-700">
                  لا يتم استبدال القوالب الموجودة تلقائيًا. الحفظ يُدرج السجلات الجديدة فقط بعد
                  المعاينة والتأكيد.
                </p>
              </Card>

              <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                <Card className="p-4">
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" className="w-full justify-between">
                      خيار متقدم: إضافة قالب مفرد
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-3 space-y-3">
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
                      <div>
                        <Label>النظام</Label>
                        <Select
                          value={singleForm.study_system}
                          onValueChange={(v) =>
                            setSingleForm({ ...singleForm, study_system: v as StudySystem })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="regular">{SYSTEM_LABELS.regular}</SelectItem>
                            <SelectItem value="parallel">{SYSTEM_LABELS.parallel}</SelectItem>
                            <SelectItem value="both">{SYSTEM_LABELS.both}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>اليوم</Label>
                        <Select
                          value={String(singleForm.day_of_week)}
                          onValueChange={(v) =>
                            setSingleForm({ ...singleForm, day_of_week: Number(v) })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ALL_WEEK_DAYS.map((d) => (
                              <SelectItem key={d} value={String(d)}>
                                {DAY_LABELS_AR[d]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>من</Label>
                        <Input
                          dir="ltr"
                          type="time"
                          value={singleForm.start_time}
                          onChange={(e) =>
                            setSingleForm({ ...singleForm, start_time: e.target.value })
                          }
                        />
                      </div>
                      <div>
                        <Label>إلى</Label>
                        <Input
                          dir="ltr"
                          type="time"
                          value={singleForm.end_time}
                          onChange={(e) =>
                            setSingleForm({ ...singleForm, end_time: e.target.value })
                          }
                        />
                      </div>
                      <div>
                        <Label>المدة (دقيقة)</Label>
                        <Input
                          dir="ltr"
                          type="number"
                          min={15}
                          max={480}
                          value={singleForm.slot_duration_minutes}
                          onChange={(e) =>
                            setSingleForm({
                              ...singleForm,
                              slot_duration_minutes: Number(e.target.value),
                            })
                          }
                        />
                      </div>
                      <div className="flex items-end">
                        <Button
                          className="w-full"
                          onClick={() => addSingle.mutate()}
                          disabled={addSingle.isPending}
                        >
                          إضافة
                        </Button>
                      </div>
                    </div>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            </>
          )}

          <Card className="p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <p className="flex-1 text-sm font-semibold">القوالب المحفوظة</p>
              <div className="w-48">
                <Select
                  value={filterSystem}
                  onValueChange={(v) => setFilterSystem(v as StudySystem | "all")}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="نظام الدراسة" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل الأنظمة</SelectItem>
                    <SelectItem value="regular">{SYSTEM_LABELS.regular}</SelectItem>
                    <SelectItem value="parallel">{SYSTEM_LABELS.parallel}</SelectItem>
                    <SelectItem value="both">{SYSTEM_LABELS.both}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-2 md:grid-cols-5">
              {ALL_WEEK_DAYS.filter((d) => d !== 4 || (weeklyGrid[4]?.length ?? 0) > 0).map(
                (day) => (
                  <div key={day} className="rounded border border-border p-2">
                    <p className="mb-1 text-xs font-semibold">{DAY_LABELS_AR[day]}</p>
                    <p className="text-lg font-bold">{(weeklyGrid[day] ?? []).length}</p>
                    <p className="text-[10px] text-muted-foreground">قالب</p>
                  </div>
                ),
              )}
            </div>

            {isLoading ? (
              <p className="p-4 text-center text-muted-foreground">جارٍ التحميل...</p>
            ) : !rows || rows.length === 0 ? (
              <p className="p-4 text-center text-muted-foreground">
                لا توجد قوالب بعد. استخدم الإعداد الأسبوعي أعلاه.
              </p>
            ) : (
              <ul className="divide-y divide-border rounded border border-border">
                {rows.map((r) => (
                  <li key={r.id} className="flex items-center justify-between p-3">
                    <div>
                      <p className="text-sm font-medium">
                        {SYSTEM_LABELS[r.study_system]} · {DAY_LABELS_AR[r.day_of_week]}{" "}
                        <span dir="ltr">
                          {r.start_time.slice(0, 5)} → {r.end_time.slice(0, 5)}
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        مدة: {r.slot_duration_minutes} دقيقة · {r.is_active ? "مفعّل" : "معطّل"}
                      </p>
                    </div>
                    {canManage && (
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => toggleActive.mutate(r)}>
                          {r.is_active ? "تعطيل" : "تفعيل"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            if (confirm("حذف القالب؟")) del.mutate(r.id);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
