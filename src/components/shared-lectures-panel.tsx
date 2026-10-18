import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useCanManageActiveCollege } from "@/hooks/use-can-manage";
import {
  changeSharedLecture,
  fetchSharedLectureCandidates,
  fetchSharedLectures,
} from "@/lib/academic-delivery/shared-lectures";
import { toast } from "sonner";
import { confirmAction } from "@/components/confirm-dialog";
import { QueryErrorNotice } from "@/components/app-states/query-error-notice";
import { userErrorMessage } from "@/lib/user-error";
import { formatDecimal, formatNumber } from "@/lib/format";

export function SharedLecturesPanel({ collegeId }: { collegeId: string }) {
  const manage = useCanManageActiveCollege();
  const qc = useQueryClient();
  const links = useQuery({
    queryKey: ["shared-lectures", collegeId],
    queryFn: () => fetchSharedLectures(collegeId),
  });
  const candidates = useQuery({
    queryKey: ["shared-lecture-candidates", collegeId],
    queryFn: () => fetchSharedLectureCandidates(collegeId),
    enabled: manage,
  });
  const action = useMutation({
    mutationFn: ({
      anchor,
      member,
      remove,
    }: {
      anchor: string;
      member: string;
      remove?: boolean;
    }) => changeSharedLecture(anchor, member, remove),
    onSuccess: () => {
      qc.invalidateQueries();
      toast.success("تم تحديث المحاضرة المشتركة");
    },
    onError: (error: unknown) =>
      toast.error(
        userErrorMessage(error, "تعذر تغيير الدمج. راجع السعة والإسنادات الحالية، ثم حدّث الصفحة."),
      ),
  });
  return (
    <Card className="mb-4 p-4">
      <h2 className="font-semibold">المحاضرات المشتركة</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        محاضرة نظرية واحدة للعام والموازي، بإسناد واحد واحتساب حضور الدفعتين. تبقى مجموعات العملي
        مستقلة.
      </p>
      {links.isError || candidates.isError ? (
        <QueryErrorNotice
          className="mb-3"
          title="تعذر تحميل بيانات المحاضرات المشتركة."
          error={links.error ?? candidates.error}
          onRetry={() => {
            void links.refetch();
            if (manage) void candidates.refetch();
          }}
        />
      ) : null}
      {(links.data ?? []).map((l) => (
        <div
          key={l.member_group_id}
          className="flex items-center justify-between gap-2 border-t py-2 text-sm"
        >
          <span>
            {l.course_name} — مشترك — {formatNumber(l.total_students)} طالبًا
          </span>
          {manage ? (
            <Button
              size="sm"
              variant="outline"
              disabled={action.isPending}
              aria-label={`فك دمج ${l.course_name}`}
              onClick={async () => {
                const ok = await confirmAction({
                  title: `فك دمج المحاضرة المشتركة «${l.course_name}»؟`,
                  description: "تعود المحاضرة النظرية مجموعتين مستقلتين وتحتاج كل منهما إسنادًا وجدولة.",
                  confirmLabel: "فك الدمج",
                  destructive: true,
                });
                if (ok)
                  action.mutate({
                    anchor: l.anchor_group_id,
                    member: l.member_group_id,
                    remove: true,
                  });
              }}
            >
              فك الدمج
            </Button>
          ) : null}
        </div>
      ))}
      {manage
        ? (candidates.data ?? []).map((c) => (
            <div
              key={`${c.anchor_group_id}:${c.member_group_id}`}
              className="flex items-center justify-between gap-2 border-t py-2 text-sm"
            >
              <div>
                <p>
                  {c.course_name} — {formatNumber(c.total_students)} طالبًا — {formatDecimal(c.weekly_hours)} ساعات
                </p>
                <p className="text-xs text-muted-foreground">
                  {c.anchor_cohort_code} + {c.member_cohort_code}
                </p>
              </div>
              <Button
                size="sm"
                disabled={action.isPending}
                aria-label={`دمج نظري ${c.course_name} (${c.anchor_cohort_code} + ${c.member_cohort_code})`}
                onClick={async () => {
                  const ok = await confirmAction({
                    title: `دمج نظري «${c.course_name}» للدفعتين ${c.anchor_cohort_code} و${c.member_cohort_code}؟`,
                    description: "تصبح المحاضرة النظرية واحدة بإسناد واحد وسعة الدفعتين معًا.",
                    confirmLabel: "دمج",
                  });
                  if (ok) action.mutate({ anchor: c.anchor_group_id, member: c.member_group_id });
                }}
              >
                دمج النظري
              </Button>
            </div>
          ))
        : null}
      {!links.isPending && !links.data?.length && !candidates.data?.length ? (
        <p className="text-sm text-muted-foreground">
          لا توجد محاضرات مشتركة أو مجموعات متوافقة متاحة للدمج.
        </p>
      ) : null}
    </Card>
  );
}
