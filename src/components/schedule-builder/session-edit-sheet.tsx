/**
 * Schedule Builder session edit sheet — local pending + conflict validate + RPC save.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SESSION_TYPE_LABELS, SESSION_STUDY_SYSTEM_LABELS } from "@/lib/reports/session-mappers";
import { DAY_NAMES_AR } from "@/lib/reports/formatters";
import type { WorkspaceSessionView } from "@/lib/schedule-builder/workspace";
import type { WorkspaceRoomOption } from "@/lib/schedule-builder/queries";
import { SCHEDULE_BUILDER_UNSAVED_BADGE_AR } from "@/lib/schedule-builder/edit-access";
import { conflictMessageAr } from "@/lib/schedule-builder/conflict-code-messages";
import {
  buildBeforeAfterRows,
  formValuesFromSession,
  hasPendingChanges,
  type LocalEditFormValues,
  type PendingScheduleSessionChange,
} from "@/lib/schedule-builder/pending-change";
import {
  canSaveAfterValidation,
  type SessionMoveConflict,
  type ValidateSessionMoveResult,
} from "@/lib/schedule-builder/session-move-rpc";
import { entityDisplayName } from "@/lib/entity-display";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-2 text-sm py-1.5 border-b border-border/50 last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium break-words">{value || "—"}</dd>
    </div>
  );
}

function ConflictList({
  title,
  items,
  variant,
}: {
  title: string;
  items: SessionMoveConflict[];
  variant: "destructive" | "secondary" | "outline";
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{title}</p>
      <ul className="space-y-2">
        {items.map((c, i) => (
          <li key={`${c.code}-${i}`} className="rounded-md border p-2 text-sm space-y-1">
            <div className="flex flex-wrap gap-2 items-center">
              <Badge variant={variant}>{c.code}</Badge>
              {c.approved_exception ? <Badge variant="outline">استثناء معتمد</Badge> : null}
            </div>
            <p>{c.message_ar ?? conflictMessageAr(c.code, c.metadata) ?? c.message_en ?? c.code}</p>
            {c.exception_reason ? (
              <p className="text-xs text-muted-foreground">سبب الاستثناء: {c.exception_reason}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SessionEditSheet({
  open,
  onOpenChange,
  session,
  rooms,
  workingDays,
  versionName,
  pending,
  validation,
  validateLoading,
  saveLoading,
  saveMessage,
  onApplyLocal,
  onCancelChange,
  onValidateConflicts,
  onSaveChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: WorkspaceSessionView | null;
  rooms: WorkspaceRoomOption[];
  workingDays: number[];
  versionName: string | null;
  pending: PendingScheduleSessionChange | null;
  validation: ValidateSessionMoveResult | null;
  validateLoading: boolean;
  saveLoading: boolean;
  saveMessage: string | null;
  onApplyLocal: (form: LocalEditFormValues) => { ok: true } | { ok: false; message: string };
  onCancelChange: () => void;
  onValidateConflicts: () => void;
  onSaveChange: () => void;
}) {
  const [form, setForm] = useState<LocalEditFormValues>(() =>
    session
      ? formValuesFromSession(session)
      : {
          day_of_week: 0,
          start_time: "",
          end_time: "",
          room_id: "",
          changeReason: "",
        },
  );
  const [error, setError] = useState<string | null>(null);
  const [appliedNotice, setAppliedNotice] = useState<string | null>(null);

  const sessionPending =
    session && pending && pending.sessionId === session.id && hasPendingChanges(pending)
      ? pending
      : null;

  useEffect(() => {
    if (!session || !open) return;
    if (sessionPending) {
      setForm({
        day_of_week: sessionPending.proposed.day_of_week,
        start_time: sessionPending.proposed.start_time,
        end_time: sessionPending.proposed.end_time,
        room_id: sessionPending.proposed.room_id ?? "",
        changeReason: sessionPending.changeReason,
      });
    } else {
      setForm(formValuesFromSession(session));
    }
    setError(null);
    setAppliedNotice(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pending snapshot sync only
  }, [
    session?.id,
    open,
    pending?.sessionId,
    pending?.proposed.day_of_week,
    pending?.proposed.start_time,
    pending?.proposed.end_time,
    pending?.proposed.room_id,
    pending?.changeReason,
  ]);

  const dayOptions = useMemo(() => {
    const set = new Set(workingDays.length ? workingDays : [6, 0, 1, 2, 3, 4]);
    if (session) set.add(session.day_of_week);
    if (sessionPending) set.add(sessionPending.proposed.day_of_week);
    return Array.from(set).sort((a, b) => {
      const order = workingDays.length ? workingDays : [6, 0, 1, 2, 3, 4];
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
  }, [workingDays, session, sessionPending]);

  const roomLabel = (id: string | null) => {
    if (!id) return "—";
    const r = rooms.find((x) => x.id === id);
    if (!r) return "قاعة غير متاحة";
    return entityDisplayName(r, "قاعة غير متاحة");
  };

  const beforeAfter = sessionPending
    ? buildBeforeAfterRows(sessionPending, (d) => DAY_NAMES_AR[d] ?? String(d), roomLabel)
    : [];

  const typeLabel = session
    ? (SESSION_TYPE_LABELS[session.session_type] ?? session.session_type)
    : "";
  const sysLabel = session
    ? (SESSION_STUDY_SYSTEM_LABELS[session.study_system] ?? session.study_system)
    : "";

  const saveEnabled =
    !!sessionPending && !validateLoading && !saveLoading && canSaveAfterValidation(validation);
  const editStep = !sessionPending ? 1 : saveEnabled ? 3 : 2;

  const handleApply = () => {
    if (!session) return;
    const result = onApplyLocal(form);
    if (!result.ok) {
      setError(result.message);
      setAppliedNotice(null);
      return;
    }
    setError(null);
    setAppliedNotice("تم تطبيق التغيير محليًا. افحص التعارضات قبل الحفظ.");
  };

  const handleCancelChange = () => {
    onCancelChange();
    if (session) setForm(formValuesFromSession(session));
    setError(null);
    setAppliedNotice(null);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-full sm:max-w-md overflow-y-auto" dir="rtl">
        <SheetHeader>
          <SheetTitle className="flex flex-wrap items-center gap-2">
            تعديل الجلسة
            {sessionPending ? (
              <Badge variant="destructive" aria-label={SCHEDULE_BUILDER_UNSAVED_BADGE_AR}>
                {SCHEDULE_BUILDER_UNSAVED_BADGE_AR}
              </Badge>
            ) : null}
          </SheetTitle>
          <SheetDescription>
            غيّر الموعد أو القاعة، ثم اتبع الخطوات الثلاث للحفظ الآمن.
          </SheetDescription>
        </SheetHeader>

        {session ? (
          <div className="mt-4 space-y-5">
            <div className="rounded-md bg-muted/50 p-3 text-sm">
              <p className="font-medium">
                {entityDisplayName({ name: session.course_name, code: session.course_code })}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {session.instructor_name} · {session.section_number || "بدون مجموعة"}
              </p>
            </div>

            <div
              data-testid="session-edit-safe-steps"
              className="grid grid-cols-3 gap-2"
              aria-label="خطوات حفظ التعديل"
            >
              {[
                { number: 1, label: "طبّق" },
                { number: 2, label: "افحص" },
                { number: 3, label: "احفظ" },
              ].map((step) => (
                <div
                  key={step.number}
                  className={`rounded-md border px-2 py-2 text-center text-xs ${
                    editStep === step.number
                      ? "border-primary bg-primary/5 font-medium text-primary"
                      : editStep > step.number
                        ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"
                        : "text-muted-foreground"
                  }`}
                  aria-current={editStep === step.number ? "step" : undefined}
                >
                  <span className="block font-semibold">{step.number}</span>
                  {step.label}
                </div>
              ))}
            </div>

            <details data-testid="session-static-details" className="rounded-md border px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium">
                تفاصيل المقرر والجلسة (بيانات ثابتة)
              </summary>
              <dl className="mt-2 border-t pt-2">
                <Row
                  label="المقرر"
                  value={entityDisplayName({
                    name: session.course_name,
                    code: session.course_code,
                  })}
                />
                <Row label="مجموعة المحاضرة أو المعمل" value={session.section_number} />
                <Row label="المدرس" value={session.instructor_name} />
                <Row label="نوع الجلسة" value={typeLabel} />
                <Row label="النظام الدراسي" value={sysLabel} />
                <Row label="النسخة" value={versionName ?? "—"} />
                {session.updated_at ? (
                  <Row
                    label="آخر تحديث"
                    value={String(session.updated_at).slice(0, 19).replace("T", " ")}
                  />
                ) : null}
              </dl>
            </details>

            {beforeAfter.length > 0 ? (
              <div>
                <p className="text-sm font-medium mb-2">مقارنة قبل / بعد</p>
                <div className="rounded-md border overflow-hidden text-sm">
                  <div className="grid grid-cols-3 gap-2 bg-muted/50 px-3 py-2 font-medium">
                    <span>الحقل</span>
                    <span>قبل</span>
                    <span>بعد</span>
                  </div>
                  {beforeAfter.map((row) => (
                    <div
                      key={row.field}
                      className="grid grid-cols-3 gap-2 px-3 py-2 border-t border-border/50"
                    >
                      <span className="text-muted-foreground">{row.field}</span>
                      <span>{row.before}</span>
                      <span className="font-medium">{row.after}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="space-y-3">
              <p className="text-sm font-medium">حقول قابلة للتغيير</p>

              <div className="space-y-2">
                <Label htmlFor="edit-day">اليوم</Label>
                <Select
                  value={String(form.day_of_week)}
                  onValueChange={(v) => setForm((f) => ({ ...f, day_of_week: Number(v) }))}
                >
                  <SelectTrigger id="edit-day">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {dayOptions.map((d) => (
                      <SelectItem key={d} value={String(d)}>
                        {DAY_NAMES_AR[d] ?? `يوم ${d}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="edit-start">وقت البداية</Label>
                  <Input
                    id="edit-start"
                    type="time"
                    value={form.start_time}
                    onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-end">وقت النهاية</Label>
                  <Input
                    id="edit-end"
                    type="time"
                    value={form.end_time}
                    onChange={(e) => setForm((f) => ({ ...f, end_time: e.target.value }))}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-room">القاعة</Label>
                <Select
                  value={form.room_id || "__none__"}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, room_id: v === "__none__" ? "" : v }))
                  }
                >
                  <SelectTrigger id="edit-room">
                    <SelectValue placeholder="اختر القاعة" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">بدون قاعة</SelectItem>
                    {rooms.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.code}
                        {r.name ? ` — ${r.name}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-reason">سبب التغيير (اختياري)</Label>
                <Textarea
                  id="edit-reason"
                  rows={2}
                  value={form.changeReason}
                  onChange={(e) => setForm((f) => ({ ...f, changeReason: e.target.value }))}
                  placeholder="اختياري — يُسجَّل في سجل التدقيق عند الحفظ"
                />
              </div>
            </div>

            {validation ? (
              <div className="space-y-3">
                {validation.stale ? (
                  <p className="text-sm text-destructive" role="alert">
                    {validation.message_ar ?? "الجلسة أصبحت قديمة. أعد التحميل."}
                  </p>
                ) : null}
                {validation.code && validation.code !== "OK" && !validation.stale ? (
                  <p className="text-sm text-muted-foreground">رمز النتيجة: {validation.code}</p>
                ) : null}
                <ConflictList
                  title="تعارضات مانعة"
                  items={validation.blocking_conflicts}
                  variant="destructive"
                />
                <ConflictList title="تحذيرات" items={validation.warnings} variant="secondary" />
                <ConflictList
                  title="استثناءات معتمدة"
                  items={validation.approved_exceptions}
                  variant="outline"
                />
                {canSaveAfterValidation(validation) ? (
                  <p className="text-sm text-emerald-700 dark:text-emerald-400" role="status">
                    التحقق ناجح — يمكن حفظ التغيير.
                  </p>
                ) : null}
              </div>
            ) : null}

            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            {appliedNotice ? (
              <p className="text-sm text-amber-700 dark:text-amber-400" role="status">
                {appliedNotice}
              </p>
            ) : null}
            {saveMessage ? (
              <p className="text-sm" role="status">
                {saveMessage}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">لم تُحدد جلسة.</p>
        )}

        <SheetFooter className="mt-6 flex-col gap-2 sm:flex-col">
          <Button type="button" onClick={handleApply} disabled={!session || saveLoading}>
            1. تطبيق محليًا
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={onValidateConflicts}
            disabled={!sessionPending || validateLoading || saveLoading}
          >
            {validateLoading ? "جارٍ الفحص…" : "2. فحص التعارضات"}
          </Button>
          <Button
            type="button"
            onClick={onSaveChange}
            disabled={!saveEnabled}
            aria-disabled={!saveEnabled}
          >
            {saveLoading ? "جارٍ الحفظ…" : "3. حفظ التغيير بأمان"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleCancelChange}
            disabled={!sessionPending || saveLoading}
          >
            إلغاء التغيير
          </Button>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            إغلاق
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
