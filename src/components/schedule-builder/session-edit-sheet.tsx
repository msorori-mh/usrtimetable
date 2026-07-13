/**
 * Local edit sheet for Schedule Builder — applies pending changes in page state only.
 * No save / mutation / DB write.
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
import {
  SCHEDULE_BUILDER_LOCAL_ONLY_NOTICE_AR,
  SCHEDULE_BUILDER_NO_DB_SAVE_NOTICE_AR,
  SCHEDULE_BUILDER_UNSAVED_BADGE_AR,
} from "@/lib/schedule-builder/edit-access";
import {
  buildBeforeAfterRows,
  formValuesFromSession,
  hasPendingChanges,
  type LocalEditFormValues,
  type PendingScheduleSessionChange,
} from "@/lib/schedule-builder/pending-change";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-2 text-sm py-1.5 border-b border-border/50 last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium break-words">{value || "—"}</dd>
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
  onApplyLocal,
  onCancelChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: WorkspaceSessionView | null;
  rooms: WorkspaceRoomOption[];
  workingDays: number[];
  versionName: string | null;
  pending: PendingScheduleSessionChange | null;
  onApplyLocal: (form: LocalEditFormValues) => { ok: true } | { ok: false; message: string };
  onCancelChange: () => void;
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

  // Sync form when opening a session or when pending is cleared/applied externally.
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
    // Intentionally key off session id + pending identity/dirty, not every form keystroke.
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
    if (!r) return id;
    return `${r.code}${r.name ? ` — ${r.name}` : ""}`;
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

  const handleApply = () => {
    if (!session) return;
    const result = onApplyLocal(form);
    if (!result.ok) {
      setError(result.message);
      setAppliedNotice(null);
      return;
    }
    setError(null);
    setAppliedNotice("تم تطبيق التغيير محليًا.");
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
            تعديل الجلسة (محلي)
            {sessionPending ? (
              <Badge variant="destructive" aria-label={SCHEDULE_BUILDER_UNSAVED_BADGE_AR}>
                {SCHEDULE_BUILDER_UNSAVED_BADGE_AR}
              </Badge>
            ) : null}
          </SheetTitle>
          <SheetDescription>
            اقتراح يوم ووقت وقاعة داخل الصفحة فقط — دون حفظ في النظام.
          </SheetDescription>
        </SheetHeader>

        {session ? (
          <div className="mt-4 space-y-5">
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-muted-foreground space-y-1">
              <p>{SCHEDULE_BUILDER_LOCAL_ONLY_NOTICE_AR}</p>
              <p>{SCHEDULE_BUILDER_NO_DB_SAVE_NOTICE_AR}</p>
            </div>

            <div>
              <p className="text-sm font-medium mb-2">بيانات ثابتة</p>
              <dl>
                <Row label="المقرر" value={`${session.course_code} — ${session.course_name}`} />
                <Row label="رمز المقرر" value={session.course_code} />
                <Row label="الشعبة" value={session.section_number} />
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
            </div>

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
              <p className="text-sm font-medium">حقول قابلة للتغيير محليًا</p>

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
                  placeholder="اختياري — لا يُحفظ في هذه المرحلة"
                />
              </div>
            </div>

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
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">لم تُحدد جلسة.</p>
        )}

        <SheetFooter className="mt-6 flex-col gap-2 sm:flex-col">
          <Button type="button" onClick={handleApply} disabled={!session}>
            تطبيق محليًا
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleCancelChange}
            disabled={!sessionPending}
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
