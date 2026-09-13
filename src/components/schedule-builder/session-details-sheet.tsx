/**
 * Session details panel for Schedule Builder.
 * Close / enrollment ownership / split proposal — independent of session pending saves.
 */
import { useMemo, useState } from "react";
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
import { SESSION_TYPE_LABELS, SESSION_STUDY_SYSTEM_LABELS } from "@/lib/reports/session-mappers";
import type { WorkspaceSessionView } from "@/lib/schedule-builder/workspace";
import type { WorkspaceRoomOption } from "@/lib/schedule-builder/queries";
import { DAY_NAMES_AR } from "@/lib/reports/formatters";
import {
  ENROLLMENT_STATUS_LABEL_AR,
  ENROLLMENT_TRUST_WARNING_AR,
  capacityFitForConfirmed,
  enrollmentStatusBadgeVariant,
  normalizeEnrollmentCountStatus,
} from "@/lib/schedule-builder/enrollment-trust";
import {
  shouldOfferSplitProposal,
  resolveBestEligibleRoomCapacity,
} from "@/lib/schedule-builder/split-proposal-ui";
import {
  EnrollmentEditDialog,
  type EnrollmentEditTarget,
} from "@/components/schedule-builder/enrollment-edit-dialog";
import {
  SplitProposalDialog,
  type SplitApprovalTarget,
} from "@/components/schedule-builder/split-proposal-dialog";
import { SPLIT_APPROVED_AWAITING_SCHEDULE_AR } from "@/lib/schedule-builder/split-approval";
import { entityDisplayName } from "@/lib/entity-display";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-2 text-sm py-1.5 border-b border-border/50 last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium break-words">{value || "—"}</dd>
    </div>
  );
}

function formatUpdatedAt(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("ar-SA", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 16).replace("T", " ");
  }
}

export function SessionDetailsSheet({
  open,
  onOpenChange,
  session,
  collegeId,
  rooms,
  canEditEnrollment,
  onEnrollmentSaved,
  onSplitApproved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: WorkspaceSessionView | null;
  collegeId: string | null;
  rooms: WorkspaceRoomOption[];
  /** super_admin / college_admin for active college — never read_only. */
  canEditEnrollment: boolean;
  onEnrollmentSaved: (payload: {
    courseOfferingId: string;
    enrollmentCount: number;
    enrollmentCountStatus: ReturnType<typeof normalizeEnrollmentCountStatus>;
    enrollmentCountUpdatedAt: string;
  }) => void;
  onSplitApproved?: (payload: {
    sectionId: string;
    statusAr: string;
    createdSubgroupIds: string[];
  }) => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [splitApprovedStatus, setSplitApprovedStatus] = useState<string | null>(null);

  const typeLabel = session
    ? (SESSION_TYPE_LABELS[session.session_type] ?? session.session_type)
    : "";
  const sysLabel = session
    ? (SESSION_STUDY_SYSTEM_LABELS[session.study_system] ?? session.study_system)
    : "";
  const dayLabel = session
    ? (DAY_NAMES_AR[session.day_of_week] ?? String(session.day_of_week))
    : "";
  const start = session ? String(session.start_time).slice(0, 5) : "";
  const end = session ? String(session.end_time).slice(0, 5) : "";

  const status = session
    ? normalizeEnrollmentCountStatus(session.enrollment_count_status)
    : "unverified";
  const enrollmentCount = session?.enrollment_count ?? null;

  const selectedRoom = useMemo(() => {
    if (!session?.room_id) return null;
    return rooms.find((r) => r.id === session.room_id) ?? null;
  }, [rooms, session?.room_id]);

  const bestEligible = useMemo(() => {
    if (!session) {
      return {
        bestCapacity: null as number | null,
        bestRoomId: null as string | null,
        eligibleCount: 0,
      };
    }
    return resolveBestEligibleRoomCapacity({
      rooms,
      sessionType: session.session_type,
      requiredRoomType: null,
    });
  }, [rooms, session]);

  const approvalRoom = useMemo(() => {
    if (!session) return null;
    const selectedCap = selectedRoom?.capacity ?? null;
    const n = enrollmentCount ?? 0;
    if (selectedRoom && selectedCap != null && selectedCap > 0 && n > selectedCap + 5) {
      return { roomId: selectedRoom.id, roomCapacity: selectedCap };
    }
    if (bestEligible.bestRoomId != null && bestEligible.bestCapacity != null) {
      return {
        roomId: bestEligible.bestRoomId,
        roomCapacity: bestEligible.bestCapacity,
      };
    }
    return null;
  }, [session, selectedRoom, enrollmentCount, bestEligible]);

  const approvalTarget: SplitApprovalTarget | null =
    session && collegeId && session.course_offering_id && session.section_id && approvalRoom
      ? {
          collegeId,
          courseOfferingId: session.course_offering_id,
          sectionId: session.section_id,
          sourceSessionId: session.id,
          enrollmentCountUpdatedAt: session.enrollment_count_updated_at,
          roomId: approvalRoom.roomId,
          roomCapacity: approvalRoom.roomCapacity,
        }
      : null;

  const capacityFit = useMemo(() => {
    if (status !== "confirmed" || enrollmentCount == null) return null;
    return capacityFitForConfirmed({
      enrollmentCount,
      roomCapacity: selectedRoom?.capacity ?? bestEligible.bestCapacity,
    });
  }, [status, enrollmentCount, selectedRoom?.capacity, bestEligible.bestCapacity]);

  const showSplitButton =
    !!session &&
    enrollmentCount != null &&
    shouldOfferSplitProposal({
      enrollmentCount,
      enrollmentStatus: status,
      bestEligibleCapacity: bestEligible.bestCapacity,
      selectedRoomCapacity: selectedRoom?.capacity ?? null,
    });

  const editTarget: EnrollmentEditTarget | null =
    session && collegeId && session.course_offering_id
      ? {
          courseOfferingId: session.course_offering_id,
          collegeId,
          courseLabel: entityDisplayName({ name: session.course_name, code: session.course_code }),
          sectionLabel: session.section_number,
          studySystemLabel: sysLabel,
          enrollmentCount,
          enrollmentCountStatus: status,
          enrollmentCountUpdatedAt: session.enrollment_count_updated_at,
        }
      : null;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="left" className="w-full sm:max-w-md overflow-y-auto" dir="rtl">
          <SheetHeader>
            <SheetTitle>تفاصيل الجلسة</SheetTitle>
            <SheetDescription>
              عرض التفاصيل وملكية عدد الطلاب. حفظ الجلسة منفصل عن حفظ العدد.
            </SheetDescription>
          </SheetHeader>

          {session ? (
            <div className="mt-4 space-y-4">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{typeLabel}</Badge>
                <Badge variant="secondary">{sysLabel}</Badge>
                <Badge variant={enrollmentStatusBadgeVariant(status)}>
                  {ENROLLMENT_STATUS_LABEL_AR[status]}
                </Badge>
              </div>

              <dl>
                <Row
                  label="المقرر"
                  value={entityDisplayName({
                    name: session.course_name,
                    code: session.course_code,
                  })}
                />
                <Row label="مجموعة المحاضرة أو المعمل" value={session.section_number} />
                <Row label="البرنامج" value={session.program_name} />
                <Row label="المستوى" value={session.level_name} />
                <Row label="القسم" value={session.department_name} />
                <Row label="المدرس" value={session.instructor_name} />
                <Row label="القاعة / المعمل" value={session.room_label} />
                <Row label="اليوم" value={dayLabel} />
                <Row label="الوقت" value={`${start} – ${end}`} />
                <Row label="نوع الجلسة" value={typeLabel} />
                <Row label="النظام الدراسي" value={sysLabel} />
              </dl>

              <div className="rounded-md border p-3 space-y-2">
                <p className="text-sm font-medium">عدد الطلاب وموثوقيته</p>
                <dl>
                  <Row
                    label="العدد الحالي"
                    value={enrollmentCount != null ? String(enrollmentCount) : "—"}
                  />
                  <Row label="حالة الموثوقية" value={ENROLLMENT_STATUS_LABEL_AR[status]} />
                  <Row
                    label="آخر تحديث"
                    value={formatUpdatedAt(session.enrollment_count_updated_at)}
                  />
                </dl>
                <p className="text-xs text-muted-foreground">
                  {ENROLLMENT_TRUST_WARNING_AR[status]}
                </p>

                {status === "confirmed" && capacityFit ? (
                  <div className="text-xs space-y-1 pt-1 border-t">
                    <p>
                      العدد المؤكد: {enrollmentCount} · سعة القاعة:{" "}
                      {selectedRoom?.capacity ?? bestEligible.bestCapacity ?? "—"}
                    </p>
                    <p>
                      فرق السعة: {capacityFit.overBy != null ? capacityFit.overBy : "—"} · الحالة:{" "}
                      <Badge variant="outline">{capacityFit.labelAr}</Badge>
                    </p>
                  </div>
                ) : null}

                {splitApprovedStatus ? (
                  <p className="text-sm font-medium text-green-700 dark:text-green-400">
                    {splitApprovedStatus}
                  </p>
                ) : null}

                <div className="flex flex-wrap gap-2 pt-2">
                  {canEditEnrollment && editTarget ? (
                    <Button type="button" size="sm" onClick={() => setEditOpen(true)}>
                      تعديل عدد الطلاب
                    </Button>
                  ) : null}
                  {showSplitButton ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => setSplitOpen(true)}
                    >
                      اقتراح التقسيم
                    </Button>
                  ) : null}
                </div>
                {!canEditEnrollment ? (
                  <p className="text-xs text-muted-foreground">عرض فقط — لا صلاحية لتعديل العدد.</p>
                ) : null}
                {canEditEnrollment && !session.course_offering_id ? (
                  <p className="text-xs text-destructive">
                    لا يمكن تعديل العدد: العرض الدراسي غير مرتبط بهذه الجلسة.
                  </p>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">لم تُحدد جلسة.</p>
          )}

          <SheetFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              إغلاق
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <EnrollmentEditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        target={editTarget}
        onSaved={(next) => {
          if (!session?.course_offering_id) return;
          onEnrollmentSaved({
            courseOfferingId: session.course_offering_id,
            enrollmentCount: next.enrollmentCount,
            enrollmentCountStatus: next.enrollmentCountStatus,
            enrollmentCountUpdatedAt: next.enrollmentCountUpdatedAt,
          });
        }}
      />

      {session && enrollmentCount != null ? (
        <SplitProposalDialog
          open={splitOpen}
          onOpenChange={setSplitOpen}
          enrollmentCount={enrollmentCount}
          enrollmentStatus={status}
          sessionType={session.session_type}
          requiredRoomType={null}
          rooms={rooms}
          selectedRoomCapacity={selectedRoom?.capacity ?? null}
          selectedRoomType={selectedRoom?.room_type ?? null}
          approvalTarget={approvalTarget}
          canApprove={canEditEnrollment}
          onApproved={(payload) => {
            setSplitApprovedStatus(payload.statusAr || SPLIT_APPROVED_AWAITING_SCHEDULE_AR);
            if (session.section_id) {
              onSplitApproved?.({
                sectionId: session.section_id,
                statusAr: payload.statusAr,
                createdSubgroupIds: payload.createdSubgroupIds,
              });
            }
          }}
        />
      ) : null}
    </>
  );
}
