import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  buildCollegeScopedSavePayload,
  collegeScopedQueryKey,
  useActiveCollege,
} from "@/hooks/use-colleges";
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
import { Clock, ChevronDown } from "lucide-react";
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

import { TemplateDirectory } from "@/components/time-templates/template-directory";
import {
  TEMPLATE_SYSTEM_LABELS as SYSTEM_LABELS,
  type TimeTemplateRow,
} from "@/lib/time-templates/template-directory";

export const Route = createFileRoute("/_authenticated/time-slot-templates")({
  head: () => ({ meta: [{ title: "قوالب أوقات المحاضرات" }] }),
  component: TimeSlotTemplatesPage,
});

type TST = TimeTemplateRow;

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
  return <TimeSlotTemplatesWorkspace key={active?.id ?? "no-college"} />;
}

function TimeSlotTemplatesWorkspace() {
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();
  const qc = useQueryClient();
  const collegeId = active?.id ?? null;

  const [weeklyOpen, setWeeklyOpen] = useState(false);
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

  // Edits invalidate the preview so saved templates match the reviewed settings.
  useEffect(() => {
    setPreview(null);
    setPreviewMeta(null);
  }, [collegeId, studySystem, dayStart, dayEnd, gridMinutes, durations, dayOverrides]);

  const { data: breaks } = useQuery({
    queryKey: collegeScopedQueryKey("daily-breaks", collegeId),
    enabled: !!collegeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_breaks")
        .select("id, name, start_time, end_time, days, affects_scheduling")
        .eq("college_id", collegeId!);
      if (error) throw error;
      return data ?? [];
    },
  });

  const {
    data: rows,
    isLoading,
    error: rowsError,
    refetch: refetchRows,
  } = useQuery({
    queryKey: collegeScopedQueryKey("tst", collegeId, "all-records"),
    enabled: !!collegeId,
    queryFn: async () => {
      const q = supabase.from("time_slot_templates").select("*").eq("college_id", collegeId!);
      const { data, error } = await q
        .order("study_system")
        .order("day_of_week")
        .order("start_time");
      if (error) throw error;
      return (data ?? []) as TST[];
    },
  });

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
    if (isLoading || rowsError || !rows) {
      toast.error("انتظر اكتمال تحميل القوالب قبل المعاينة.");
      return;
    }
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
      if (!collegeId || !canManage) throw new Error("لا تملك صلاحية إدارة قوالب هذه الكلية");
      if (!preview || !previewMeta) throw new Error("عاين القوالب أولاً");

      // Re-load latest rows immediately before save (application-level idempotency).
      const { data: freshRows, error: freshErr } = await supabase
        .from("time_slot_templates")
        .select("*")
        .eq("college_id", collegeId)
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
      const payload = diff.toInsert.map((t) =>
        buildCollegeScopedSavePayload(collegeId, {
          study_system: t.study_system,
          day_of_week: t.day_of_week,
          start_time: t.start_time,
          end_time: t.end_time,
          slot_duration_minutes: t.slot_duration_minutes,
          is_active: true,
        }),
      );
      const { error, data } = await supabase
        .from("time_slot_templates")
        .insert(payload)
        .select("id");
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
        collegeId,
      });
      return inserted;
    },
    onSuccess: (n) => {
      toast.success(`تم حفظ ${n} قالبًا`);
      setPreview(null);
      setPreviewMeta(null);
      qc.invalidateQueries({ queryKey: collegeScopedQueryKey("tst", collegeId) });
    },
    onError: (e: Error) => {
      if (e.message !== "تم إلغاء الحفظ") toast.error(e.message);
    },
  });

  const addSingle = useMutation({
    mutationFn: async () => {
      if (!collegeId || !canManage) throw new Error("لا تملك صلاحية إدارة قوالب هذه الكلية");
      if (isLoading || rowsError || !rows) throw new Error("انتظر اكتمال تحميل القوالب أولاً");
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
      const payload = buildCollegeScopedSavePayload(collegeId, {
        ...singleForm,
        is_active: true,
      });
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
        collegeId,
      });
    },
    onSuccess: () => {
      toast.success("تمت إضافة القالب المفرد");
      qc.invalidateQueries({ queryKey: collegeScopedQueryKey("tst", collegeId) });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: async (r: TST) => {
      if (!collegeId || !canManage) throw new Error("لا تملك صلاحية إدارة قوالب هذه الكلية");
      const { error } = await supabase
        .from("time_slot_templates")
        .update({ is_active: !r.is_active })
        .eq("id", r.id)
        .eq("college_id", collegeId);
      if (error) throw error;
      await logAudit({
        action: "update",
        entity: "time_slot_templates",
        entityId: r.id,
        collegeId: collegeId ?? undefined,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: collegeScopedQueryKey("tst", collegeId) }),
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      if (!collegeId || !canManage) throw new Error("لا تملك صلاحية إدارة قوالب هذه الكلية");
      const { error } = await supabase
        .from("time_slot_templates")
        .delete()
        .eq("id", id)
        .eq("college_id", collegeId);
      if (error) throw error;
      await logAudit({
        action: "delete",
        entity: "time_slot_templates",
        entityId: id,
        collegeId: collegeId ?? undefined,
      });
    },
    onSuccess: () => {
      toast.success("تم الحذف");
      qc.invalidateQueries({ queryKey: collegeScopedQueryKey("tst", collegeId) });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="w-full min-w-0 space-y-6">
      <header className="flex flex-wrap items-center gap-3">
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
          <TemplateDirectory
            rows={rows ?? []}
            isLoading={isLoading}
            error={rowsError}
            onRetry={() => {
              void refetchRows();
            }}
            canManage={canManage}
            pending={toggleActive.isPending || del.isPending}
            onToggle={(row) => toggleActive.mutate(row)}
            onDelete={(row) => {
              if (
                confirm(
                  "حذف قالب " +
                    DAY_LABELS_AR[row.day_of_week] +
                    " " +
                    row.start_time.slice(0, 5) +
                    " إلى " +
                    row.end_time.slice(0, 5) +
                    " (" +
                    SYSTEM_LABELS[row.study_system] +
                    ")؟",
                )
              )
                del.mutate(row.id);
            }}
          />
          <p className="text-xs text-muted-foreground">
            القوالب تخص الكلية وتُستخدم عبر فصولها الدراسية؛ إعداد قوالب الأيام لا يلزم الطلاب
            بالحضور في جميع هذه الأيام.
          </p>
          {canManage && (
            <Collapsible open={weeklyOpen} onOpenChange={setWeeklyOpen}>
              <Card className="p-4">
                <CollapsibleTrigger asChild>
                  <Button type="button" variant="outline" className="w-full justify-between">
                    إعداد قوالب أسبوعية جديدة
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </CollapsibleTrigger>
                <p className="mt-2 text-xs text-muted-foreground">
                  افتح الإعداد لتحديد الأيام والفترات ومعاينة القوالب قبل حفظها.
                </p>
              </Card>
              <CollapsibleContent className="mt-4 space-y-4">
                <Card className="p-4 space-y-4">
                  <p className="text-sm font-semibold">1) تصنيف القوالب الجديدة</p>
                  <div className="grid gap-3 md:grid-cols-3">
                    <div>
                      <Label htmlFor="new-template-system">استخدام القوالب الجديدة</Label>
                      <Select
                        value={studySystem}
                        onValueChange={(v) => setStudySystem(v as StudySystem)}
                      >
                        <SelectTrigger id="new-template-system">
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
                      <Label>الكلية</Label>
                      <Input value={active.name} disabled />
                    </div>
                    <div>
                      <Label>حالة القوالب الجديدة</Label>
                      <Input value="مفعّل عند الحفظ" disabled />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    اختر «مشترك للعام والموازي» إذا كانت الفترات نفسها متاحة للنظامين.
                  </p>
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
                                          [customizingDay]: {
                                            ...prev[customizingDay],
                                            durations: next,
                                          },
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
                        تُحدد مدة الجلسة الفعلية من الخطة الدراسية أو إسناد المقرر. المعامل: 120
                        دقيقة فقط (لا تُعامل كـ 180).
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
                        <Button
                          type="button"
                          variant="outline"
                          onClick={runPreview}
                          disabled={isLoading || !!rowsError}
                        >
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
                            قوالب جديدة: {previewMeta.toInsert} · موجودة مسبقًا:{" "}
                            {previewMeta.duplicates}
                          </p>
                          <p>
                            متعارضة: {previewMeta.conflicts} · مكررة داخل المعاينة:{" "}
                            {previewMeta.duplicatesInGeneratedBatch}
                          </p>
                          <p>متجاوز بسبب استراحة: {previewMeta.skippedBreakConflicts}</p>
                          <p className="text-xs text-muted-foreground md:col-span-2">
                            تُراجع القوالب الموجودة قبل الحفظ، ويُضاف الجديد فقط.
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
                        لا يتم استبدال القوالب الموجودة تلقائيًا. الحفظ يُدرج السجلات الجديدة فقط
                        بعد المعاينة والتأكيد.
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
                                disabled={addSingle.isPending || isLoading || !!rowsError}
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
              </CollapsibleContent>
            </Collapsible>
          )}
        </>
      )}
    </div>
  );
}
