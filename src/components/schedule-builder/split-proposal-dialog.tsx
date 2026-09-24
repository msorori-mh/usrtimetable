/**
 * Capacity split proposal dialog.
 * Explicit approve creates section_subgroups via RPC only (when migration applied).
 * Never creates schedule_sessions; never modifies the source session.
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
import {
  approveCapacitySplitProposal,
  SPLIT_APPROVED_AWAITING_SCHEDULE_AR,
  validateSplitApprovalDraft,
} from "@/lib/schedule-builder/split-approval";

export type SplitApprovalTarget = {
  collegeId: string;
  courseOfferingId: string;
  sectionId: string;
  sourceSessionId: string;
  enrollmentCountUpdatedAt: string | null;
  roomId: string;
  roomCapacity: number;
};

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
  /** Required for approve; null for read_only / incomplete context. */
  approvalTarget: SplitApprovalTarget | null;
  canApprove: boolean;
  onApproved?: (payload: { statusAr: string; createdSubgroupIds: string[] }) => void;
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
  approvalTarget,
  canApprove,
  onApproved,
}: SplitProposalDialogProps) {
  const [localDraftSaved, setLocalDraftSaved] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successStatus, setSuccessStatus] = useState<string | null>(null);

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

  const roomCapacityForApprove =
    approvalTarget?.roomCapacity ?? built.roomCapacityUsed ?? selectedRoomCapacity ?? null;

  const clientValidation = validateSplitApprovalDraft({
    enrollmentCount,
    enrollmentStatus,
    enrollmentCountUpdatedAt: approvalTarget?.enrollmentCountUpdatedAt ?? null,
    roomId: approvalTarget?.roomId ?? null,
    roomCapacity: roomCapacityForApprove,
    groups: proposal?.proposedDistribution ?? null,
  });

  const approveEnabled =
    canApprove &&
    !!approvalTarget &&
    !!proposal &&
    clientValidation.ok &&
    !approving &&
    !successStatus;

  async function performApprove() {
    if (!approvalTarget || !proposal || !clientValidation.ok) return;
    setApproving(true);
    setError(null);
    const result = await approveCapacitySplitProposal({
      collegeId: approvalTarget.collegeId,
      courseOfferingId: approvalTarget.courseOfferingId,
      sectionId: approvalTarget.sectionId,
      sourceSessionId: approvalTarget.sourceSessionId,
      enrollmentCount,
      enrollmentStatus,
      enrollmentCountUpdatedAt: approvalTarget.enrollmentCountUpdatedAt,
      roomId: approvalTarget.roomId,
      roomCapacity: clientValidation.roomCapacity,
      groups: clientValidation.groups,
    });
    setApproving(false);
    if (!result.ok) {
      setError(result.reasonAr);
      return;
    }
    setSuccessStatus(result.statusAr || SPLIT_APPROVED_AWAITING_SCHEDULE_AR);
    setConfirmOpen(false);
    onApproved?.({
      statusAr: result.statusAr,
      createdSubgroupIds: result.createdSubgroupIds,
    });
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (approving) return;
          if (!next) {
            setLocalDraftSaved(false);
            setConfirmOpen(false);
            setError(null);
            // keep successStatus visible until parent closes after overlay update
          }
          onOpenChange(next);
        }}
      >
        <DialogContent className="sm:max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle>اقتراح التقسيم</DialogTitle>
            <DialogDescription>
              الاعتماد الصريح يُنشئ المجموعات الفرعية فقط. لا يُنشئ جلسات ولا يعدّل الجلسة الأصلية
              أو الوقت أو القاعة أو المدرس.
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
                  كل مجموعة ستحتاج لاحقًا جلسة مستقلة ووقتًا وقاعة — الجدولة ليست جزءًا من الاعتماد.
                </p>
              </div>
            )}

            {successStatus ? (
              <p className="rounded-md border border-green-600/30 bg-green-500/10 p-2 text-green-800 dark:text-green-300 font-medium">
                {successStatus}
              </p>
            ) : null}

            {localDraftSaved && !successStatus ? (
              <p className="text-sm text-green-700 dark:text-green-400">
                حُفظ الاقتراح كمسودة محلية في الواجهة فقط (بدون كتابة في قاعدة البيانات).
              </p>
            ) : null}

            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            {!canApprove ? (
              <p className="text-xs text-muted-foreground">عرض فقط — لا صلاحية لاعتماد التقسيم.</p>
            ) : null}
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={approving}
              onClick={() => onOpenChange(false)}
            >
              إغلاق
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!proposal || approving || !!successStatus}
              onClick={() => setLocalDraftSaved(true)}
            >
              حفظ الاقتراح كمسودة محلية
            </Button>
            <Button
              type="button"
              disabled={!approveEnabled}
              onClick={() => {
                setError(null);
                setConfirmOpen(true);
              }}
            >
              {approving ? "جاري الاعتماد…" : "اعتماد الاقتراح"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-sm" dir="rtl">
          <DialogHeader>
            <DialogTitle>تأكيد اعتماد التقسيم</DialogTitle>
            <DialogDescription>
              سيتم إنشاء المجموعات الفرعية المعتمدة فقط. لن تُنشأ جلسات ولن تُعدَّل الجلسة الأصلية.
              الحالة بعد النجاح: «{SPLIT_APPROVED_AWAITING_SCHEDULE_AR}». هل تريد المتابعة؟
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={approving}
              onClick={() => setConfirmOpen(false)}
            >
              رجوع
            </Button>
            <Button type="button" disabled={approving} onClick={() => void performApprove()}>
              {approving ? "جاري الاعتماد…" : "تأكيد الاعتماد"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
