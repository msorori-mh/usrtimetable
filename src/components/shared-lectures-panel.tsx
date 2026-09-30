import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useCanManageActiveCollege } from "@/hooks/use-can-manage";
import {
  changeSharedLecture,
  fetchSharedLectureCandidates,
  fetchSharedLectures,
  mergeSharedLectures,
  type SharedLectureCandidate,
} from "@/lib/academic-delivery/shared-lectures";
import { toast } from "sonner";

export function SharedLecturesPanel({ collegeId }: { collegeId: string }) {
  const [selected, setSelected] = useState<Record<string, string[]>>({});
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
    onError: () => toast.error("تعذر تغيير الدمج. راجع السعة والإسنادات الحالية، ثم حدّث الصفحة."),
  });
  const merge = useMutation({
    mutationFn: ({ anchor, members }: { anchor: string; members: string[] }) =>
      mergeSharedLectures(anchor, members),
    onSuccess: (_data, variables) => {
      setSelected((previous) => ({ ...previous, [variables.anchor]: [] }));
      qc.invalidateQueries();
      toast.success("تم دمج الدفعات في محاضرة واحدة");
    },
    onError: (error) => toast.error(`تعذر دمج الدفعات: ${error.message}`),
  });
  const byAnchor = (candidates.data ?? []).reduce<Record<string, SharedLectureCandidate[]>>(
    (groups, candidate) => {
      (groups[candidate.anchor_group_id] ??= []).push(candidate);
      return groups;
    },
    {},
  );
  const systemName = (system: string) =>
    system === "regular" ? "عام" : system === "parallel" ? "موازي" : system;
  return (
    <Card className="mb-4 p-4">
      <h2 className="font-semibold">المحاضرات المشتركة</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        اختر دفعتين أو أكثر في المقرر النظري نفسه، سواء من النظام نفسه أو من العام والموازي. تُجمع
        أعداد الطلاب في محاضرة وإسناد واحد، وتبقى مجموعات العملي مستقلة. يتم الدمج قبل الإسناد
        والجدولة؛ المحاضرات الموجودة في جدول معتمد تحتاج مراجعة وقتها وقاعتها أولًا.
      </p>
      {links.isError || candidates.isError ? (
        <p role="alert">تعذر تحميل بيانات المحاضرات المشتركة.</p>
      ) : null}
      {(links.data ?? []).map((l) => (
        <div
          key={l.member_group_id}
          className="flex items-center justify-between gap-2 border-t py-2 text-sm"
        >
          <span>
            {l.course_name} — مشترك — {l.total_students} طالبًا
          </span>
          {manage ? (
            <Button
              size="sm"
              variant="outline"
              disabled={action.isPending}
              onClick={() =>
                action.mutate({
                  anchor: l.anchor_group_id,
                  member: l.member_group_id,
                  remove: true,
                })
              }
            >
              فك الدمج
            </Button>
          ) : null}
        </div>
      ))}
      {manage
        ? Object.entries(byAnchor).map(([anchor, options]) => {
            if (!options?.length) return null;
            const first = options[0];
            const chosen = options.filter((c) =>
              (selected[anchor] ?? []).includes(c.member_group_id),
            );
            const total =
              first.total_students -
              first.member_students +
              chosen.reduce((sum, c) => sum + c.member_students, 0);
            const capacity = Math.min(
              ...chosen.map((c) => c.capacity_limit),
              ...(!chosen.length ? [first.capacity_limit] : []),
            );
            return (
              <div key={anchor} className="border-t py-3 text-sm">
                <p className="font-medium">
                  {first.course_name} — {first.anchor_cohort_code} (
                  {systemName(first.anchor_study_system)}) — {first.weekly_hours} ساعات
                </p>
                <div className="mt-2 flex flex-wrap gap-3">
                  {options.map((c) => (
                    <label
                      key={c.member_group_id}
                      className="flex cursor-pointer items-center gap-2"
                    >
                      <input
                        type="checkbox"
                        checked={(selected[anchor] ?? []).includes(c.member_group_id)}
                        disabled={merge.isPending || action.isPending}
                        onChange={(e) =>
                          setSelected((previous) => ({
                            ...previous,
                            [anchor]: e.target.checked
                              ? [...(previous[anchor] ?? []), c.member_group_id]
                              : (previous[anchor] ?? []).filter((id) => id !== c.member_group_id),
                          }))
                        }
                      />
                      {c.member_cohort_code} ({systemName(c.member_study_system)}) — {c.member_students}{" "}
                      طالبًا
                    </label>
                  ))}
                </div>
                <p className="my-2 text-xs text-muted-foreground">
                  العدد بعد الدمج: {total} / السعة: {capacity}
                </p>
                <Button
                  size="sm"
                  disabled={!chosen.length || total > capacity || merge.isPending || action.isPending}
                  onClick={() =>
                    merge.mutate({ anchor, members: chosen.map((c) => c.member_group_id) })
                  }
                >
                  دمج الدفعات المحددة
                </Button>
              </div>
            );
          })
        : null}
      {!links.isPending && !links.data?.length && !candidates.data?.length ? (
        <p className="text-sm text-muted-foreground">
          لا توجد محاضرات مشتركة أو مجموعات متوافقة متاحة للدمج.
        </p>
      ) : null}
    </Card>
  );
}
