/**
 * Phase 9.5 — dialog to create one draft session from a V2 work item.
 */
import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertCircle } from "lucide-react";
import { DAY_NAMES_AR } from "@/lib/reports/formatters";
import type { WorkspaceRoomOption } from "@/lib/schedule-builder/queries";
import {
  COMPONENT_TYPE_LABEL_AR,
  mapCreateSessionError,
  wallClockHours,
  type CreateSessionFromAssignmentResult,
  type ScheduleBuilderV2WorkItem,
} from "@/lib/schedule-builder/v2-assignment-integration";
import { createScheduleSessionFromAssignmentV2 } from "@/lib/schedule-builder/v2-assignment-service";

const DAYS = [6, 0, 1, 2, 3, 4];

export function V2AddSessionDialog({
  open,
  onOpenChange,
  workItem,
  scheduleVersionId,
  expectedVersionUpdatedAt,
  rooms,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workItem: ScheduleBuilderV2WorkItem | null;
  scheduleVersionId: string;
  expectedVersionUpdatedAt: string;
  rooms: WorkspaceRoomOption[];
  onCreated: (result: CreateSessionFromAssignmentResult) => void;
}) {
  const [dayOfWeek, setDayOfWeek] = useState(6);
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("10:00");
  const [roomId, setRoomId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<string[]>([]);

  const proposedHours = useMemo(() => wallClockHours(startTime, endTime), [startTime, endTime]);

  const remainingAfter = workItem
    ? Math.max(0, workItem.remaining_schedule_hours - proposedHours)
    : 0;
  const wouldOver = !!workItem && proposedHours > workItem.remaining_schedule_hours + 1e-9;
  const blockedReason = workItem?.can_create_session
    ? null
    : workItem?.blocking_reason || "هذا التكليف غير متاح للجدولة.";

  async function onConfirm() {
    if (!workItem) return;
    setError(null);
    setConflicts([]);
    if (!workItem.can_create_session) {
      setError(blockedReason);
      return;
    }
    if (!roomId) {
      setError("اختر قاعة.");
      return;
    }
    if (wouldOver) {
      setError("المدة المقترحة تتجاوز المتبقي للتكليف.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await createScheduleSessionFromAssignmentV2({
        scheduleVersionId,
        teachingAssignmentId: workItem.teaching_assignment_id,
        dayOfWeek,
        startTime,
        endTime,
        roomId,
        expectedVersionUpdatedAt,
      });
      if (!result.ok) {
        setError(result.message_ar || mapCreateSessionError(result.code));
        setConflicts(result.blocking_conflicts.map((c) => c.message_ar || c.code));
        return;
      }
      onCreated(result);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "فشل إنشاء الجلسة.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>إضافة إلى الجدول</DialogTitle>
          <DialogDescription>
            إنشاء جلسة يدوية واحدة من تكليف V2 داخل نسخة المسودة فقط.
          </DialogDescription>
        </DialogHeader>

        {workItem ? (
          <div className="space-y-3 text-sm">
            <div className="rounded-md border p-3 space-y-1">
              <p className="font-medium">
                {workItem.course_code} — {workItem.course_name}
              </p>
              <p className="text-muted-foreground">
                {COMPONENT_TYPE_LABEL_AR[workItem.component_type] ?? workItem.component_type} ·
                مجموعة {workItem.group_code || workItem.group_number || "—"} ·{" "}
                {workItem.instructor_name}
              </p>
              <p className="text-muted-foreground">
                مكلّف: {workItem.assigned_component_hours} · مجدول:{" "}
                {workItem.currently_scheduled_hours} · متبقي: {workItem.remaining_schedule_hours}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>اليوم</Label>
                <Select value={String(dayOfWeek)} onValueChange={(v) => setDayOfWeek(Number(v))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DAYS.map((d) => (
                      <SelectItem key={d} value={String(d)}>
                        {DAY_NAMES_AR[d] ?? d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>القاعة</Label>
                <Select value={roomId || undefined} onValueChange={setRoomId}>
                  <SelectTrigger>
                    <SelectValue placeholder="اختر قاعة" />
                  </SelectTrigger>
                  <SelectContent>
                    {rooms.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.code ? `${r.code} — ` : ""}
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>من</Label>
                <Input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>إلى</Label>
                <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              مدة الجلسة (ساعة ساعة حائطية): {proposedHours}
              {wouldOver ? " — تتجاوز المتبقي" : ` · المتبقي بعد الإضافة ≈ ${remainingAfter}`}
            </p>

            {error ? (
              <div className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p>{error}</p>
                  {conflicts.map((c) => (
                    <p key={c} className="text-xs">
                      {c}
                    </p>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button
            type="button"
            disabled={!workItem || !workItem.can_create_session || submitting || wouldOver}
            onClick={() => void onConfirm()}
          >
            {submitting ? "جارٍ الإنشاء…" : "تأكيد الإضافة"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
