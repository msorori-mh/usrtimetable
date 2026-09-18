import { qualitySearchMessage } from "@/lib/auto-scheduler/quality-search";
import { extendedDayLimit } from "@/lib/scheduling/student-daily-policy";
import { importJointPlan } from "@/lib/auto-scheduler/joint-import";
import { attendanceSearchMessage } from "@/lib/auto-scheduler/attendance-search";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { type Proposal, type Metrics } from "@/lib/auto-scheduler/compact";
import { previewCompaction } from "@/lib/auto-scheduler/compact-worker-client";
import {
  loadCompactSnapshot,
  applyCompactProposal,
  retryCompactApplication,
  type Applied,
} from "@/lib/auto-scheduler/compact-service";

export function CompactSchedulePanel({
  collegeId,
  versionId,
  canManage,
  disabled,
  onBusy,
}: {
  collegeId: string;
  versionId: string;
  canManage: boolean;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
}) {
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [result, setResult] = useState<Applied | null>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [searchDuration, setSearchDuration] = useState(180000);
  const [extendedPolicy, setExtendedPolicy] = useState(false);
  const [extendedDays, setExtendedDays] = useState(1);
  const [importText, setImportText] = useState("");
  const [saving, setSaving] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const qc = useQueryClient();
  useEffect(() => {
    setProposal(null);
    setResult(null);
    return () => abort.current?.abort();
  }, [collegeId, versionId]);
  const execute = async (mode: "preview" | "apply" | "verify" | "import") => {
    if (!canManage || !versionId || busy || disabled) return;
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setSaving(mode === "apply" || mode === "verify");
    onBusy(true);
    setMessage("جارٍ قراءة الجدول والتحقق…");
    setResult(null);
    try {
      if (mode === "verify" && result) {
        const verified = await retryCompactApplication(collegeId, versionId, result);
        setResult(verified);
        setMessage(verified.stopped || "تأكد حفظ الخطة كاملة.");
        await qc.invalidateQueries();
      } else if (mode === "apply" && proposal) {
        setMessage("جارٍ التحقق وحفظ الخطة كاملة…");
        const saved = await applyCompactProposal(collegeId, versionId, proposal, {
          signal: controller.signal,
          onProgress: (n, total) => setMessage(`تم حفظ ${n} من ${total} نقلاً`),
        });
        setResult(saved);
        setProposal(null);
        setMessage(saved.stopped || "اكتمل حفظ التنقلات المقترحة والتحقق من النتيجة.");
        await qc.invalidateQueries();
      } else {
        setProposal(null);
        const snapshot = await loadCompactSnapshot(collegeId, versionId);
        setExtendedPolicy(!!snapshot.settings.extended_day_policy_enabled);
        setExtendedDays(extendedDayLimit(snapshot.settings));
        const p =
          mode === "import"
            ? importJointPlan(snapshot, versionId, importText)
            : await previewCompaction(snapshot, {
                signal: controller.signal,
                maxDurationMs: searchDuration,
                onProgress: (n) => setMessage(`جارٍ البحث — ${n} نقلاً محسّناً حتى الآن`),
              });
        setProposal(p);
        setMessage(
          p.qualitySearch
            ? qualitySearchMessage(p)
            : p.attendanceSearch
              ? attendanceSearchMessage(p.attendanceSearch) +
                (p.executionBlocked ? ` ${p.executionBlocked}` : " لم تُحفظ تغييرات بعد.")
              : p.outcome === "empty"
                ? "لا توجد محاضرات مجدولة لتحسينها. استكمل بيانات الإسناد وولّد المسودة أولًا."
                : p.outcome === "time_limit" || p.outcome === "candidate_limit"
                  ? "وصل البحث إلى حدّه المحدد. تظهر أفضل نتيجة عُثر عليها؛ يمكن توسيع البحث. لم تُحفظ تغييرات بعد."
                  : p.stopped
                    ? "توقفت المعاينة؛ لم يُحفظ أي نقل."
                    : p.moves.length
                      ? "اكتملت المعاينة؛ لم تُحفظ تغييرات بعد."
                      : "لم يُعثر على تحسين إضافي ضمن نطاق البحث الحالي.",
        );
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "تعذر التحقق. أعد المعاينة قبل المتابعة.",
      );
      setProposal(null);
    } finally {
      abort.current = null;
      setBusy(false);
      setSaving(false);
      onBusy(false);
    }
  };
  const before = result?.before || proposal?.before,
    after = result?.after || proposal?.after;
  const fields: Array<[keyof Metrics, string]> = [
    ...(extendedPolicy
      ? ([
          ["extendedDayViolations", "أيام تمديد إضافية فوق الحد المسموح للمجموعات"],
          ["extendedGroups", "مجموعات لها حضور بعد الثانية"],
        ] as Array<[keyof Metrics, string]>)
      : []),
    ["practicalHallSessions", "جلسات عملية في قاعات بدل المعامل"],
    ["instructorExcessTargetDays", "أيام حضور المدرسين الزائدة عن أهداف ساعاتهم"],
    ["instructorSingleLectureDays", "أيام حضور المدرسين لمحاضرة واحدة"],
    ["levelsOverFive", "مستويات تتجاوز خمسة أيام"],
    ["excessDaysOverThree", "أيام إضافية فوق هدف ثلاثة أيام"],
    ["excessDaysOverFour", "أيام إضافية فوق أربعة أيام"],
    ["studentAverageGapMinutes", "متوسط فراغ الطالب أسبوعيًا — دقيقة"],
    ["instructorAverageGapMinutes", "متوسط فراغ المدرس أسبوعيًا — دقيقة"],
    ["worstStudentGapMinutes", "أكبر فراغ أسبوعي لمجموعة طلاب — دقيقة"],
    ["worstInstructorGapMinutes", "أكبر فراغ أسبوعي لمدرس — دقيقة"],
    ["studentGapMinutes", "دقائق فراغ الطلاب المجمّعة"],
    ["instructorGapMinutes", "دقائق فراغ المدرسين المجمّعة"],
    ["shortStudentDays", "حالات حضور طالب لساعتين أو أقل"],
    ["shortInstructorDays", "حالات حضور مدرس لساعتين أو أقل"],
    ["studentAttendanceDays", "مجموع أيام حضور الطلاب"],
    ["instructorAttendanceDays", "مجموع أيام حضور المدرسين"],
    ["sessions", "عدد المحاضرات"],
    ["teachingMinutes", "دقائق التدريس"],
  ];
  const display = (value: Metrics[keyof Metrics]) =>
    typeof value === "number" ? Number(value.toFixed(1)).toLocaleString("ar") : String(value);
  return (
    <Card className="p-4 space-y-3" dir="rtl">
      <h2 className="font-bold">تحسين توزيع الجدول</h2>
      {extendedPolicy && (
        <p className="text-sm">
          الحد المحفوظ لأيام التمديد بعد الثانية لكل مجموعة طلاب: {extendedDays}. يشمل النظري
          والعملي معًا. يمكن أن يختلف يوم التمديد بين مجموعات المستوى نفسه.
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        الحد الأقصى ثلاث محاضرات للمحاضر في اليوم، شاملًا العام والموازي وبصرف النظر عن مدة
        المحاضرة. يستمر البحث في تقليل الفراغات وتجميع محاضرات المدرس وتفضيل المعامل للعملي، دون
        زيادة عدد أيام حضور أي مدرس أو مجموعة طلاب عن الجدول الحالي. أهداف المدرس حسب الساعات: حتى 6
        ساعات يوم، حتى 10 يومان، حتى 16 ثلاثة أيام، وما فوقها أربعة؛ مع مراعاة القيود المحفوظة.
        تُفحص التنقلات والتبادلات معًا، وتبقى الإسنادات والمدد والأقفال محفوظة.
      </p>
      <p className="text-sm">
        تُحفظ الخطة كاملة أو تُلغى كاملة إذا رُفض أحد تنقلاتها. بعد إرسالها، انتظر تأكيد النتيجة؛
        انقطاع الاتصال لا يعني فشل الحفظ. هذا التحسين يعيد توزيع المحاضرات الموجودة فقط؛ المحاضرات
        غير المجدولة تبقى بحاجة إلى الإكمال. تحقق النتيجة الجزئية لا يعني اكتمال الجدول النهائي.
      </p>
      <div className="flex flex-wrap gap-2">
        <label className="text-sm flex items-center gap-2">
          مدة البحث
          <select
            className="border rounded p-2 bg-background"
            value={searchDuration}
            disabled={busy}
            onChange={(event) => setSearchDuration(Number(event.target.value))}
          >
            <option value={15000}>متوازن — 15 ثانية</option>
            <option value={60000}>موسّع — دقيقة</option>
            <option value={180000}>شامل — ثلاث دقائق</option>
          </select>
        </label>
        <Button
          disabled={!canManage || !versionId || busy || disabled || result?.status === "unknown"}
          onClick={() => void execute("preview")}
        >
          معاينة تحسين التوزيع
        </Button>
        <Button
          disabled={!canManage || busy || disabled || !proposal?.moves.length || proposal.stopped}
          onClick={() => void execute("apply")}
        >
          تطبيق التحسين على المسودة
        </Button>
        {result?.status === "unknown" && (
          <Button
            disabled={!canManage || busy || disabled}
            variant="outline"
            onClick={() => void execute("verify")}
          >
            تحقق واستكمل الحفظ
          </Button>
        )}
        {busy && !saving && (
          <Button variant="outline" onClick={() => abort.current?.abort()}>
            إيقاف التحسين
          </Button>
        )}
      </div>
      {canManage && (
        <details className="text-sm">
          <summary>استيراد خطة توزيع محسوبة</summary>
          <p>
            تُفحص الخطة على النسخة الحالية قبل إتاحة تطبيقها، مع التحقق من عدد الأيام وقيود الطلاب
            والقاعات والمدرسين.
          </p>
          <textarea
            aria-label="خطة التوزيع المحسوبة"
            className="w-full border rounded p-2"
            rows={3}
            value={importText}
            disabled={busy}
            onChange={(e) => setImportText(e.target.value)}
          />
          <Button
            variant="outline"
            disabled={busy || disabled || !importText || result?.status === "unknown"}
            onClick={() => void execute("import")}
          >
            فحص خطة التوزيع
          </Button>
        </details>
      )}
      <p role="status" aria-live="polite" className="text-sm">
        {message}
      </p>
      {before && after && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="text-right p-2">المقياس</th>
                <th>قبل</th>
                <th>{result ? "المحفوظ فعلياً" : "المقترح"}</th>
              </tr>
            </thead>
            <tbody>
              {fields.map(([key, label]) => (
                <tr key={key} className="border-t">
                  <td className="p-2">{label}</td>
                  <td className="text-center">{display(before[key])}</td>
                  <td className="text-center">{display(after[key])}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-muted-foreground">
            تُحسب الفراغات بين أول محاضرة وآخرها دون خصم استراحة، لكل شعبة فعلية ولكل مدرس. المجاميع
            الطلابية موزونة بعدد الطلاب.
          </p>
        </div>
      )}
      {after && after.levelsOverFive > 0 && (
        <p role="alert" className="text-amber-700">
          لم يتحقق حد خمسة أيام بعد في {after.levelsOverFive} مستوى. النتيجة تحسين جزئي وليست جاهزة
          للاعتماد النهائي؛ يلزم حل القيود المتبقية وإعادة التحسين.
        </p>
      )}
      {proposal && <p className="text-xs">التنقلات المقترحة: {proposal.moves.length}.</p>}
    </Card>
  );
}
