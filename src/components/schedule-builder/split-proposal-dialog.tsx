/**
 * Capacity split proposal dialog — display only.
 * Never creates section_subgroups or schedule_sessions.
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
import { Badge } from "@/components/ui/badge";
import { SESSION_TYPE_LABELS } from "@/lib/reports/session-mappers";
import {
  buildSplitProposalForUi,
  type LiveRoomCapacity,
} from "@/lib/schedule-builder/split-proposal-ui";
import {
  preferredRoomTypesForSessionType,
  sessionTypeRequiredRoomTypeConflict,
} from "@/lib/schedule-builder/room-type-policy";
import type { EnrollmentCountStatus } from "@/lib/schedule-builder/enrollment-trust";

export type SplitProposalDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  enrollmentCount: number;
  enrollmentStatus: EnrollmentCountStatus;
  sessionType: string;
  requiredRoomType?: string | null;
  rooms: LiveRoomCapacity[];
  selectedRoomCapacity?: number | null;
  selectedRoomType?: string | null;
};

export function SplitProposalDialog({
  open,
  onOpenChange,
  enrollmentCount,
  enrollmentStatus,
  sessionType,
  requiredRoomType,
  rooms,
  selectedRoomCapacity,
  selectedRoomType,
}: SplitProposalDialogProps) {
  const [localDraftSaved, setLocalDraftSaved] = useState(false);

  const built = useMemo(
    () =>
      buildSplitProposalForUi({
        enrollmentCount,
        enrollmentStatus,
        sessionType,
        requiredRoomType,
        rooms,
        selectedRoomCapacity,
        selectedRoomType,
      }),
    [
      enrollmentCount,
      enrollmentStatus,
      sessionType,
      requiredRoomType,
      rooms,
      selectedRoomCapacity,
      selectedRoomType,
    ],
  );

  const dq = sessionTypeRequiredRoomTypeConflict({ sessionType, requiredRoomType });
  const preferred = preferredRoomTypesForSessionType(sessionType);
  const typeLabel = SESSION_TYPE_LABELS[sessionType] ?? sessionType;
  const proposal = built.proposal;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setLocalDraftSaved(false);
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg" dir="rtl">
        <DialogHeader>
          <DialogTitle>اقتراح التقسيم</DialogTitle>
          <DialogDescription>
            اقتراح حسابي فقط — لا يُنشئ مجموعات فرعية ولا جلسات في قاعدة البيانات.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          {built.dataQualityWarning || dq.conflict ? (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-amber-900 dark:text-amber-100">
              تحذير جودة بيانات: نوع الجلسة ({typeLabel}) لا يتوافق مع نوع القاعة المطلوب (
              {requiredRoomType}). يُعتمد required_room_type عند التصفية.
            </p>
          ) : null}

          <div className="rounded-md border p-3 space-y-1 bg-muted/30">
            <p>
              <span className="text-muted-foreground">العدد المؤكد: </span>
              {enrollmentCount}
            </p>
            <p>
              <span className="text-muted-foreground">نوع الجلسة: </span>
              {typeLabel}
            </p>
            <p>
              <span className="text-muted-foreground">نوع القاعة المطلوب: </span>
              {requiredRoomType?.trim() || preferred.join(" / ") || "—"}
            </p>
            <p>
              <span className="text-muted-foreground">سعة القاعة المستخدمة في الحساب: </span>
              {built.roomCapacityUsed ?? "—"}
              {built.roomCapacitySource === "selected"
                ? " (القاعة المختارة)"
                : built.roomCapacitySource === "best_eligible"
                  ? " (أكبر قاعة مناسبة من المخزون الحي)"
                  : ""}
            </p>
            <p>
              <span className="text-muted-foreground">قاعات مناسبة في المخزون: </span>
              {built.eligibleCount}
            </p>
          </div>

          {!proposal ? (
            <p className="text-muted-foreground">لا يوجد اقتراح تقسيم للحالة الحالية.</p>
          ) : (
            <div className="space-y-2">
              <p>
                <span className="text-muted-foreground">عدد المجموعات المقترح: </span>
                <Badge variant="secondary">{proposal.minimumGroups}</Badge>
              </p>
              <ul className="rounded-md border divide-y">
                {proposal.proposedDistribution.map((row) => (
                  <li key={row.subgroup_code} className="flex justify-between px-3 py-2">
                    <span>المجموعة {row.subgroup_code}</span>
                    <span className="tabular-nums font-medium">{row.expected_students} طالب</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                كل مجموعة تحتاج جلسة مستقلة ووقتًا وقاعة مناسبة. لا يُنفَّذ الإنشاء في هذه المرحلة.
              </p>
              {proposal.autoCreateForbidden ? (
                <p className="text-xs text-muted-foreground">autoCreateForbidden: true</p>
              ) : null}
            </div>
          )}

          {localDraftSaved ? (
            <p className="text-sm text-green-700 dark:text-green-400">
              حُفظ الاقتراح كمسودة محلية في الواجهة فقط (بدون كتابة في قاعدة البيانات).
            </p>
          ) : null}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            إغلاق
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={!proposal}
            onClick={() => setLocalDraftSaved(true)}
          >
            حفظ الاقتراح كمسودة محلية
          </Button>
          <Button
            type="button"
            disabled
            title="سيتم تفعيل الاعتماد في المرحلة التالية بعد إقرار عقد الإنشاء الآمن."
          >
            اعتماد الاقتراح
          </Button>
        </DialogFooter>
        <p className="text-xs text-muted-foreground -mt-2">
          سيتم تفعيل الاعتماد في المرحلة التالية بعد إقرار عقد الإنشاء الآمن.
        </p>
      </DialogContent>
    </Dialog>
  );
}
