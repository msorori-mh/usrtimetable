import { collegeSupportsParallel } from "@/lib/study-systems";
import { AUTO_SCOPE_LABELS, type AutoScheduleScope } from "@/lib/auto-scheduler/study-system-scope";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCollege } from "@/hooks/use-colleges";
import { useCanManageActiveCollege } from "@/hooks/use-can-manage";
import { CollegeSwitcher } from "@/components/college-switcher";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import type { AutoRunMode } from "@/lib/auto-scheduler/greedy";
import {
  runV2AutoSchedule,
  type AutoScheduleProgress,
  type V2FeasibilityPreview,
} from "@/lib/auto-scheduler/v2";
import { fetchCollegeReadiness } from "@/lib/reports/readiness";
import {
  roomTimeCapacityMessagesAr,
  ROOM_TIME_CAPACITY_POLICY_NOTE_AR,
} from "@/lib/reports/room-time-capacity";
import { CompactSchedulePanel } from "@/components/compact-panel";
import { Sparkles, AlertCircle, CheckCircle2, SearchCheck } from "lucide-react";
import {
  DeliveryCoverageCard,
  useDeliveryCoverage,
} from "@/components/schedule-versions/delivery-coverage-card";
import {
  autoRunOutcomeMessage,
  fetchDeliveryCoverage,
} from "@/lib/schedule-versions/delivery-coverage";

export const Route = createFileRoute("/_authenticated/auto-schedule")({
  head: () => ({ meta: [{ title: "الجدولة التلقائية" }] }),
  component: AutoSchedulePage,
});

function AutoSchedulePage() {
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();
  const qc = useQueryClient();
  const [versionId, setVersionId] = useState<string>("");
  const [studySystemChoice, setStudySystem] = useState<AutoScheduleScope>("all");
  const supportsParallel = collegeSupportsParallel(active);
  // Full-version scope is retained for completeness checks in regular-only colleges.
  const studySystem: AutoScheduleScope = supportsParallel ? studySystemChoice : "all";
  const [searchDurationMs, setSearchDurationMs] = useState("180000");
  const [mode, setMode] = useState<AutoRunMode>("fill_missing");
  const [compactBusy, setCompactBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [previewResult, setPreviewResult] = useState<V2FeasibilityPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [progress, setProgress] = useState<AutoScheduleProgress | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [outcome, setOutcome] = useState<{
    partial: boolean;
    text: string;
  } | null>(null);
  const coverage = useDeliveryCoverage({
    collegeId: active?.id,
    scheduleVersionId: versionId,
  });

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

  const {
    data: readiness,
    isLoading: readinessLoading,
    isError: readinessError,
    error: readinessQueryError,
  } = useQuery({
    queryKey: ["auto-schedule-readiness", active?.id],
    enabled: !!active,
    queryFn: () => fetchCollegeReadiness(active!.id),
  });
  const readinessBlockers = readiness
    ? [...readiness.studyPlan, ...readiness.resources, ...readiness.scheduling].filter(
        (metric) => metric.critical && metric.missing > 0,
      )
    : [];
  const capacityMessages =
    readiness?.roomTimeCapacity &&
    (readiness.roomTimeCapacity.unavailable || readiness.roomTimeCapacity.insufficient.length > 0)
      ? roomTimeCapacityMessagesAr(readiness.roomTimeCapacity)
      : [];
  const fallbackCoveredHours =
    readiness?.roomTimeCapacity?.perType.reduce(
      (total, roomType) => total + roomType.coveredByFallbackHours,
      0,
    ) ?? 0;
  const readinessIncomplete =
    readinessLoading || readinessError || !readiness || readinessBlockers.length > 0;

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

  const preview = useMutation({
    mutationFn: async () => {
      setPreviewResult(null);
      setPreviewError(null);
      if (!canManage) {
        throw new Error("UNAUTHORIZED: لا تملك صلاحية فحص الجدولة لهذه الكلّية");
      }
      if (!active || !versionId) throw new Error("اختر النسخة");
      const freshReadiness = await fetchCollegeReadiness(active.id);
      const freshBlockers = [
        ...freshReadiness.studyPlan,
        ...freshReadiness.resources,
        ...freshReadiness.scheduling,
      ].filter((metric) => metric.critical && metric.missing > 0);
      if (freshBlockers.length > 0) {
        throw new Error(
          `READINESS_BLOCKED: ${freshBlockers.map((metric) => metric.label).join("؛ ")}`,
        );
      }
      return runV2AutoSchedule({
        collegeId: active.id,
        scheduleVersionId: versionId,
        mode,
        studySystem,
        searchDurationMs: Number(searchDurationMs),
        previewOnly: true,
      });
    },
    onSuccess: (result) => setPreviewResult(result),
    onError: (error) => {
      setPreviewError(
        error instanceof Error && error.message
          ? error.message
          : "تعذر إثبات الجدوى دون إجراء أي كتابة.",
      );
    },
  });

  const run = useMutation({
    mutationFn: async () => {
      // Dual gate: UI disables the button; mutation re-checks manage + readiness (fail-closed).
      setRunError(null);
      if (compactBusy) throw new Error("انتظر اكتمال تحسين التوزيع");
      if (!canManage) {
        throw new Error("UNAUTHORIZED: لا تملك صلاحية تشغيل الجدولة التلقائية لهذه الكلّية");
      }
      if (!active || !versionId) throw new Error("اختر النسخة");
      const freshReadiness = await fetchCollegeReadiness(active.id);
      const freshBlockers = [
        ...freshReadiness.studyPlan,
        ...freshReadiness.resources,
        ...freshReadiness.scheduling,
      ].filter((metric) => metric.critical && metric.missing > 0);
      if (freshBlockers.length > 0) {
        throw new Error(
          `READINESS_BLOCKED: ${freshBlockers.map((metric) => metric.label).join("؛ ")}`,
        );
      }
      const controller = new AbortController();
      abortRef.current = controller;
      setProgress(null);
      const result = await runV2AutoSchedule({
        collegeId: active.id,
        scheduleVersionId: versionId,
        mode,
        studySystem,
        searchDurationMs: Number(searchDurationMs),
        signal: controller.signal,
        onProgress: setProgress,
      });
      await logAudit({
        action: "auto_schedule_run",
        entity: "auto_schedule_runs",
        entityId: result.runId,
        collegeId: active.id,
        details: {
          study_system_scope: result.studySystem,
          scope_complete: result.scopeComplete,
          placed: result.placed,
          unplaced: result.unplaced.length,
          score: result.qualityScoreAfter,
          duration_ms: result.durationMs,
        },
      });
      // Read-only coverage snapshot so the outcome message cannot claim success
      // while delivery groups remain unscheduled.
      let coverageAfter = null;
      try {
        coverageAfter = await fetchDeliveryCoverage({
          collegeId: active.id,
          scheduleVersionId: versionId,
        });
      } catch {
        coverageAfter = null;
      }
      return { ...result, coverageAfter };
    },
    onSuccess: (r) => {
      const delta = r.improvementDelta;
      const message =
        r.studySystem !== "all"
          ? {
              partial: !r.scopeComplete,
              text: `${AUTO_SCOPE_LABELS[r.studySystem]}: ${r.scopeComplete ? "اكتمل تسكين النطاق المختار" : "التسكين غير مكتمل"} — لا تعني هذه النتيجة اكتمال جميع الأنظمة.`,
            }
          : autoRunOutcomeMessage({
              placed: r.placed,
              totalRequired: r.totalRequired,
              unplaced: r.unplaced.length,
              coverage: r.coverageAfter,
            });
      const quality = !r.scopeComplete
        ? "الجودة النهائية غير متاحة قبل اكتمال النطاق"
        : `جودة ${r.qualityScoreBefore}→${r.qualityScoreAfter} (${delta >= 0 ? "+" : ""}${delta}) — أُعيد توطين ${r.relocatedSessions}`;
      setOutcome({
        partial: message.partial,
        text: `${message.text} — أُضيفت ${r.placed} جلسة. ${r.unplaced[0]?.reason ?? ""} — ${quality}`,
      });
      if (message.partial) toast.warning(message.text);
      else toast.success(`${message.text} — ${quality}`);
      qc.invalidateQueries({ queryKey: ["auto-runs"] });
      qc.invalidateQueries({
        queryKey: ["sv-delivery-coverage", active?.id, versionId],
      });
    },
    onError: (e) => {
      setOutcome(null);
      const message =
        e instanceof Error && e.message
          ? e.message
          : "تعذر تشغيل الجدولة. لم يتم تأكيد أي نتيجة جديدة؛ راجع المسودة قبل إعادة المحاولة.";
      setRunError(message);
      toast.error(message);
    },
    onSettled: () => {
      abortRef.current = null;
      setProgress(null);
    },
  });

  /** Non-role blockers; the role gate stays the leading `!canManage` on the run button. */
  const runBlocked =
    !versionId ||
    !previewResult ||
    run.isPending ||
    preview.isPending ||
    compactBusy ||
    readinessIncomplete;

  const latest = runs?.[0];

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">الجدولة التلقائية</h1>
          <p className="text-sm text-muted-foreground">
            خطة حضور متدرجة: ثلاثة أيام أولًا، ثم أربعة عند ثبوت التعذر، وخمسة للحالات الحرجة فقط.
            تُحسب الخطة قبل إنشاء المحاضرات، مع الحفاظ على المحاضرات القائمة عند إكمال الناقص.
          </p>
        </div>
        <CollegeSwitcher />
      </div>

      {!canManage && (
        <Card className="border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          أنت بوضع المشاهدة. يمكنك استعراض إعدادات الجدولة ونتائج التشغيل دون تنفيذها.
        </Card>
      )}

      {!active ? (
        <Card className="p-6 text-center text-muted-foreground">اختر كلية للبدء</Card>
      ) : (
        <>
          <Card className="p-4 space-y-3">
            <div className="flex items-end gap-3 flex-wrap">
              <div className="min-w-64">
                <label className="text-xs text-muted-foreground">نسخة الجدول</label>
                <Select
                  disabled={run.isPending || compactBusy}
                  value={versionId}
                  onValueChange={(value) => {
                    setVersionId(value);
                    setPreviewResult(null);
                    setPreviewError(null);
                    setOutcome(null);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="اختر النسخة" />
                  </SelectTrigger>
                  <SelectContent>
                    {(versions ?? []).map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-56">
                <label className="text-xs text-muted-foreground">نطاق التوليد</label>
                <Select
                  value={studySystem}
                  disabled={run.isPending || compactBusy}
                  onValueChange={(value) => {
                    setStudySystem(value as AutoScheduleScope);
                    setPreviewResult(null);
                    setPreviewError(null);
                    setOutcome(null);
                  }}
                >
                  <SelectTrigger aria-label="نطاق التوليد">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(AUTO_SCOPE_LABELS)
                      .filter(([value]) => supportsParallel || value === "all")
                      .map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {supportsParallel ? label : "النظام العام فقط"}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-56">
                <label className="text-xs text-muted-foreground">وضع التشغيل</label>
                <Select
                  disabled={run.isPending || compactBusy}
                  value={mode}
                  onValueChange={(v) => {
                    setMode(v as AutoRunMode);
                    setPreviewResult(null);
                    setPreviewError(null);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fill_missing">إكمال الناقص فقط (آمن)</SelectItem>
                    <SelectItem value="regenerate_auto" disabled>
                      إعادة التوليد — قيد التطوير وغير متاحة حاليًا
                    </SelectItem>
                    <SelectItem value="full_rebuild" disabled>
                      إعادة البناء الكامل — قيد التطوير وغير متاحة حاليًا
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-44">
                <label className="text-xs text-muted-foreground">مدة بحث التوليد</label>
                <Select
                  value={searchDurationMs}
                  onValueChange={(value) => {
                    setSearchDurationMs(value);
                    setPreviewResult(null);
                    setPreviewError(null);
                  }}
                  disabled={run.isPending || compactBusy}
                >
                  <SelectTrigger aria-label="مدة بحث التوليد">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="60000">دقيقة واحدة</SelectItem>
                    <SelectItem value="180000">ثلاث دقائق</SelectItem>
                    <SelectItem value="300000">خمس دقائق</SelectItem>
                    <SelectItem value="600000">عشر دقائق</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                variant="outline"
                disabled={
                  !canManage ||
                  !versionId ||
                  run.isPending ||
                  preview.isPending ||
                  compactBusy ||
                  readinessIncomplete
                }
                onClick={() => preview.mutate()}
                data-testid="auto-schedule-feasibility-preview"
              >
                <SearchCheck className="h-4 w-4 ml-1" />
                {preview.isPending ? "جارٍ فحص الجدوى…" : "فحص الجدوى دون حفظ"}
              </Button>
              <Button
                disabled={!canManage || runBlocked}
                onClick={() => {
                  if (mode === "fill_missing") run.mutate();
                  else setConfirmOpen(true);
                }}
              >
                <Sparkles className="h-4 w-4 ml-1" />
                {run.isPending ? "جارٍ التشغيل..." : "تشغيل الجدولة التلقائية"}
              </Button>
              {run.isPending ? (
                <Button
                  variant="outline"
                  onClick={() => abortRef.current?.abort()}
                  data-testid="auto-schedule-cancel"
                >
                  إيقاف التشغيل
                </Button>
              ) : null}
            </div>
            {previewError ? (
              <div
                role="alert"
                data-testid="auto-schedule-feasibility-failed"
                className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
              >
                فشل فحص الجدوى دون إجراء أي كتابة: {previewError}
              </div>
            ) : null}
            {previewResult ? (
              <div
                role="status"
                data-testid="auto-schedule-feasibility-passed"
                className="rounded-lg border border-emerald-400 bg-emerald-50 p-3 text-sm text-emerald-950 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-100"
              >
                <p className="font-semibold">اجتاز النطاق فحص الجدوى دون حفظ أي جلسة.</p>
                <p className="mt-1">
                  {previewResult.eligibleAssignments} إسناد مؤهل، {previewResult.pendingSessions}{" "}
                  جلسة ناقصة، {previewResult.existingSessions} جلسة قائمة، وخطة حضور من{" "}
                  {previewResult.attendanceDays} أيام.
                </p>
                <p className="mt-1 text-xs">{previewResult.attendanceEvidence}</p>
                <p className="mt-1 text-xs">
                  التشغيل سيعيد الفحص كاملًا قبل الحفظ؛ هذه المعاينة لا تتجاوز القيود ولا تمنح إذنًا
                  لبيانات تغيّرت بعدها.
                </p>
              </div>
            ) : (
              <p
                className="text-xs text-muted-foreground"
                data-testid="auto-schedule-preview-required"
              >
                يلزم اجتياز «فحص الجدوى دون حفظ» قبل إتاحة التشغيل.
              </p>
            )}
            {run.isPending && progress ? (
              <div
                className="rounded-md border bg-muted/40 p-3 text-sm"
                data-testid="auto-schedule-progress"
                aria-live="polite"
              >
                جارٍ المعالجة {progress.processedItems} من {progress.totalItems} — تمت جدولة{" "}
                {progress.placed} جلسة، تعذّرت {progress.unplaced} — الحالي: {progress.label}
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground">
              النطاق: {AUTO_SCOPE_LABELS[studySystem]}. تُحفظ المحاضرات القائمة وتُفحص تعارضاتها.
              إجماليات النسخة تشمل جميع الأنظمة؛ نافذة النواقص تتبع النطاق المختار.
            </p>
            <div
              className="rounded-md border border-blue-300 bg-blue-50 p-3 text-xs text-blue-950 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100"
              data-testid="auto-schedule-resume-policy"
            >
              التشغيل تراكمي وآمن للاستئناف: كل دفعة ناجحة تُحفظ ذريًا. زر الإيقاف يمنع الخطوات
              التالية ولا يتراجع عن الجلسات المحفوظة؛ ويمكن إعادة تشغيل «إكمال الناقص» لاستكمال
              الباقي دون إعادة إنشاء الجلسات الموجودة.
            </div>
            {versionId ? (
              <DeliveryCoverageCard
                collegeId={active.id}
                scheduleVersionId={versionId}
                studySystem={studySystem}
                coverage={coverage.data}
                isLoading={coverage.isLoading}
              />
            ) : null}
            {runError ? (
              <div
                role="alert"
                data-testid="auto-run-error"
                className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
              >
                تعذر إكمال الجدولة: {runError}
              </div>
            ) : null}
            {outcome ? (
              <div
                className={`rounded-md border p-3 text-sm ${
                  outcome.partial
                    ? "border-amber-400 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
                    : "border-emerald-400 bg-emerald-50 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-100"
                }`}
                role="status"
                data-testid={outcome.partial ? "auto-run-partial" : "auto-run-complete"}
              >
                {outcome.text}
              </div>
            ) : null}
            {capacityMessages.length > 0 ? (
              <div
                className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
                role="alert"
                data-testid="auto-schedule-room-time-capacity-blocker"
              >
                <p className="font-medium text-destructive">
                  السعة الزمنية الأسبوعية للقاعات غير كافية — الجدولة مستحيلة فعليًا.
                </p>
                <ul className="mt-1 space-y-1 text-muted-foreground">
                  {capacityMessages.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">
                  {ROOM_TIME_CAPACITY_POLICY_NOTE_AR}
                </p>
              </div>
            ) : null}
            {fallbackCoveredHours > 0 && capacityMessages.length === 0 ? (
              <div
                className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm"
                role="status"
                data-testid="auto-schedule-room-time-capacity-pooled-pass"
              >
                <p className="font-medium text-emerald-700">
                  السعة الأسبوعية كافية بعد مشاركة القاعات.
                </p>
                <p className="mt-1 text-muted-foreground">
                  يمكن تغطية {fallbackCoveredHours} ساعة عملية من فائض قاعات المحاضرات بعد حجز
                  احتياج المحاضرات والتمارين، لذلك لا يمنع هذا الفحص تشغيل الجدولة.
                </p>
              </div>
            ) : null}
            {readinessIncomplete ? (
              <div
                className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm"
                role="alert"
                data-testid="auto-schedule-readiness-blocker"
              >
                <p className="font-medium text-amber-700">
                  لا يمكن تشغيل الجدولة قبل اكتمال جاهزية البيانات.
                </p>
                <p className="mt-1 text-muted-foreground">
                  {readinessLoading
                    ? "جارٍ التحقق من الجاهزية…"
                    : readinessError
                      ? `تعذر التحقق من الجاهزية؛ أُوقف التشغيل احترازيًا: ${
                          readinessQueryError instanceof Error
                            ? readinessQueryError.message
                            : "خطأ استعلام غير معروف"
                        }`
                      : `${readinessBlockers.length} فحوص حرجة تحتاج إلى معالجة.`}
                </p>
                <div className="mt-2 flex flex-wrap gap-3">
                  <Link
                    to="/data-onboarding"
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    معالج إعداد البيانات
                  </Link>
                  <Link
                    to="/data-readiness"
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    فتح شاشة جاهزية البيانات
                  </Link>
                </div>
              </div>
            ) : null}
            <p className="text-[11px] text-muted-foreground">
              {mode === "fill_missing"
                ? "إكمال الناقص: يضيف محاضرات للإسناد غير المجدولة فقط، ويحافظ على جميع المحاضرات القائمة."
                : mode === "regenerate_auto"
                  ? "إعادة توليد التلقائي: يحذف المحاضرات المولّدة تلقائياً غير المقفلة، ويحافظ على المحاضرات اليدوية والمقفلة، ثم يعيد توليد المطلوب."
                  : "إعادة بناء كامل: يحذف جميع المحاضرات غير المقفلة (تلقائية ويدوية)، ويحافظ على المحاضرات المقفلة فقط. غير قابل للتراجع."}
            </p>
          </Card>

          <CompactSchedulePanel
            key={`${active.id}:${versionId}`}
            collegeId={active.id}
            versionId={versionId}
            canManage={canManage}
            disabled={run.isPending}
            onBusy={setCompactBusy}
          />

          <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <AlertDialogContent dir="rtl">
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {mode === "full_rebuild" ? "تأكيد إعادة البناء الكامل" : "تأكيد إعادة التوليد"}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {mode === "full_rebuild"
                    ? "سيتم حذف جميع المحاضرات غير المقفلة (التلقائية واليدوية على حدٍّ سواء) في هذه النسخة. المحاضرات المقفلة فقط ستبقى. لا يمكن التراجع."
                    : "سيتم حذف المحاضرات المولّدة تلقائياً وغير المقفلة فقط. تبقى المحاضرات اليدوية والمقفلة كما هي."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>إلغاء</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    setConfirmOpen(false);
                    run.mutate();
                  }}
                >
                  متابعة
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {latest &&
            (() => {
              const sum = latest.summary as {
                study_system_scope?: AutoScheduleScope;
                scope_complete?: boolean;
                algorithm_version?: string;
                ordering_strategy?: string;
                mode?: AutoRunMode;
                backtracking_attempts?: number;
                max_backtracking_attempts?: number;
                relocated_sessions?: number;
                preserved_existing_sessions?: number;
                deleted_auto_sessions?: number;
                skipped_locked_sessions?: number;
                practical_room_fallbacks?: number;
                regenerated_sessions?: number;
                quality_before?: number;
                quality_after?: number;
                improvement_delta?: number;
                total_required_sessions?: number;
                by_session_type?: Record<
                  string,
                  { required: number; placed: number; unplaced: number }
                >;
                warnings?: string[];
              } | null;
              const delta = sum?.improvement_delta ?? 0;
              return (
                <Card className="p-4 space-y-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    {latest.status === "completed" ? (
                      <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                    ) : (
                      <AlertCircle className="h-5 w-5 text-amber-600" />
                    )}
                    <span className="font-semibold">نتيجة آخر تشغيل</span>
                    <Badge variant="outline">
                      {AUTO_SCOPE_LABELS[sum?.study_system_scope ?? "all"]}
                    </Badge>
                    {sum?.study_system_scope && sum.study_system_scope !== "all" && (
                      <span className="text-xs">
                        {sum.scope_complete
                          ? "اكتمل النطاق المختار؛ اكتمال النسخة يُراجع منفصلًا"
                          : "النطاق المختار غير مكتمل"}
                      </span>
                    )}
                    <Badge variant="secondary">{latest.status}</Badge>
                    {sum?.algorithm_version && (
                      <Badge variant="outline" className="text-[10px]">
                        {sum.algorithm_version}
                      </Badge>
                    )}
                    {sum?.mode && (
                      <Badge variant="outline" className="text-[10px]">
                        {sum.mode === "fill_missing"
                          ? "إكمال"
                          : sum.mode === "regenerate_auto"
                            ? "إعادة توليد"
                            : "إعادة بناء"}
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground mr-auto">
                      {new Date(latest.created_at).toLocaleString("ar")}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
                    <Stat
                      label="مولّدة"
                      value={sum?.regenerated_sessions ?? latest.placed_sessions}
                    />
                    <Stat
                      label="محذوفة تلقائية"
                      value={sum?.deleted_auto_sessions ?? 0}
                      accent={(sum?.deleted_auto_sessions ?? 0) > 0 ? "warn" : undefined}
                    />
                    <Stat label="مقفلة (تم تخطيها)" value={sum?.skipped_locked_sessions ?? 0} />
                    <Stat
                      label="عملي في قاعة (بديل)"
                      value={sum?.practical_room_fallbacks ?? 0}
                      accent={(sum?.practical_room_fallbacks ?? 0) > 0 ? "warn" : undefined}
                    />
                    <Stat label="محفوظة (قائمة)" value={sum?.preserved_existing_sessions ?? 0} />
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
                    <Stat
                      label="مطلوب"
                      value={
                        sum?.total_required_sessions ??
                        latest.placed_sessions + latest.unplaced_sessions
                      }
                    />
                    <Stat label="محاضرات موضوعة" value={latest.placed_sessions} />
                    <Stat
                      label="غير مجدول"
                      value={latest.unplaced_sessions}
                      accent={latest.unplaced_sessions > 0 ? "warn" : undefined}
                    />
                    <Stat label="محفوظة (قائمة)" value={sum?.preserved_existing_sessions ?? 0} />
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
                    <Stat label="جودة قبل" value={sum?.quality_before ?? "—"} />
                    <Stat
                      label="جودة بعد"
                      value={sum?.quality_after ?? latest.quality_score_after ?? "—"}
                    />
                    <Stat
                      label="تحسّن الجودة"
                      value={delta > 0 ? `+${delta}` : String(delta)}
                      accent={delta < 0 ? "danger" : undefined}
                    />
                    <Stat
                      label="تعارضات إلزامية"
                      value={latest.hard_conflicts_after}
                      accent={latest.hard_conflicts_after > 0 ? "danger" : undefined}
                    />
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
                    <Stat label="مخالفات مرنة" value={latest.soft_violations_after} />
                    <Stat
                      label="محاولات تراجع"
                      value={`${sum?.backtracking_attempts ?? 0}/${sum?.max_backtracking_attempts ?? 0}`}
                    />
                    <Stat label="محاضرات أُعيد توطينها" value={sum?.relocated_sessions ?? 0} />
                    <Stat label="المدة (ms)" value={latest.duration_ms ?? 0} />
                  </div>

                  {sum?.ordering_strategy && (
                    <div className="text-[11px] text-muted-foreground">
                      استراتيجية الترتيب: <span className="font-mono">{sum.ordering_strategy}</span>{" "}
                      — إجمالي العروض: {latest.total_offerings}
                    </div>
                  )}

                  {sum?.by_session_type && (
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(sum.by_session_type).map(([type, v]) => (
                        <Badge key={type} variant="outline" className="text-[11px]">
                          {type}: {v.placed}/{v.required}{" "}
                          {v.unplaced > 0 ? `(غير مجدول ${v.unplaced})` : ""}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {(sum?.warnings ?? []).length > 0 && (
                    <div className="border rounded-md p-2 bg-amber-50 dark:bg-amber-950/30 text-[11px] max-h-32 overflow-y-auto">
                      <p className="font-semibold mb-1">تحذيرات ({(sum?.warnings ?? []).length})</p>
                      <ul className="space-y-0.5">
                        {(sum?.warnings ?? []).slice(0, 10).map((m, i) => (
                          <li key={i}>• {m}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {Array.isArray(latest.unplaced) && (latest.unplaced as unknown[]).length > 0 && (
                    <div className="border rounded-md p-3 max-h-80 overflow-y-auto bg-muted/30">
                      <p className="text-sm font-semibold mb-1">قائمة غير المجدول وأسبابها</p>
                      <p className="text-[11px] text-muted-foreground mb-2">
                        السبب يوضح القيد الذي أوقف وضع المحاضرة في خطة هذا التشغيل. رفض موضع
                        المحاضرة لا يعني ثبوت استحالة سيناريو أيام الحضور، ولا يسمح بزيادة الأيام.
                      </p>
                      <ul className="text-xs space-y-1">
                        {(
                          latest.unplaced as Array<{
                            teaching_assignment_id: string;
                            session_type: string;
                            duration_minutes?: number;
                            unit_index?: number;
                            reason: string;
                          }>
                        ).map((u, i) => (
                          <li key={i} className="flex justify-between gap-2 border-b py-1">
                            <span className="text-muted-foreground">
                              {u.session_type}#{u.unit_index ?? 1} ({u.duration_minutes ?? 0}د) —{" "}
                              {u.teaching_assignment_id?.slice(0, 8)}
                            </span>
                            <span className="truncate">{u.reason}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </Card>
              );
            })()}

          {runs && runs.length > 1 && (
            <Card className="p-4">
              <p className="font-semibold mb-2 text-sm">عمليات سابقة</p>
              <div className="space-y-1 text-xs">
                {runs.slice(1).map((r) => (
                  <div key={r.id} className="flex justify-between border-b py-1">
                    <span>{new Date(r.created_at).toLocaleString("ar")}</span>
                    <span>
                      وُضع {r.placed_sessions} / غير مجدول {r.unplaced_sessions} / جودة{" "}
                      {r.quality_score_after ?? "—"}
                    </span>
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

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent?: "warn" | "danger";
}) {
  const color =
    accent === "danger" ? "text-destructive" : accent === "warn" ? "text-amber-600" : "";
  return (
    <div className="rounded-md border p-2">
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}
