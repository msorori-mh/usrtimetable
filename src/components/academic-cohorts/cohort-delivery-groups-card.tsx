import { BookOpen } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { type CohortListRow } from "@/lib/academic-delivery/cohort-directory";
import { COMPONENT_TYPE_LABEL_AR } from "@/lib/academic-delivery/plan-course-editor";
import { formatNumber } from "@/lib/format";

/** Delivery groups of the selected cohort (split from academic-cohorts.tsx, L-14). */
export type DeliveryGroupRow = {
  id: string;
  cohort_id: string;
  component_id: string;
  group_code: string;
  group_number?: number | null;
  expected_students: number | null;
  capacity_limit: number | null;
  excluded_from_standard_workload?: boolean;
  is_obsolete?: boolean;
  active: boolean;
  plan_courses: { courses: { code: string; name: string } | null } | null;
  plan_course_components: {
    component_type: string;
    weekly_contact_hours: number;
  } | null;
};

export function isExcludedFromWorkload(g: DeliveryGroupRow): boolean {
  if (g.excluded_from_standard_workload != null) return g.excluded_from_standard_workload;
  return g.plan_course_components?.component_type === "project";
}

export function CohortDeliveryGroupsCard({
  selected,
  versionFacts,
  groups,
  groupsLoading,
  groupsError,
  assignmentCounts,
  assignmentCountsError,
}: {
  selected: CohortListRow;
  versionFacts: Map<string, number> | undefined;
  groups: DeliveryGroupRow[] | undefined;
  groupsLoading: boolean;
  groupsError: unknown;
  assignmentCounts: Map<string, number> | undefined;
  assignmentCountsError: unknown;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="text-sm font-semibold">مجموعات المحاضرات والمعامل</h3>
        <Badge variant="secondary">{formatNumber(groups?.length ?? 0)}</Badge>
      </div>
      {versionFacts?.has(selected.id) && (
        <p className="border-b bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
          هذه قائمة المجموعات في السجل العام. راجع جدول النسخة المختارة لأعداد مجموعاتها
          وتوزيع محاضراتها المعتمد.
        </p>
      )}
      {groupsError ? (
        <p className="p-4 text-sm text-destructive" role="alert">
          تعذّر تحميل مجموعات هذه الدفعة.
        </p>
      ) : groupsLoading ? (
        <p className="p-4 text-sm text-muted-foreground">جاري التحميل…</p>
      ) : (groups ?? []).length === 0 ? (
        <div className="space-y-3 px-5 py-8 text-center">
          <BookOpen className="mx-auto h-8 w-8 text-muted-foreground/60" />
          <p className="font-medium">لم تُجهّز مجموعات هذه الدفعة بعد</p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            اضغط «توليد مجموعات المحاضرات والمعامل» أعلاه. سيجهّز النظام مقررات الدفعة
            تلقائيًا، ثم يوزّع الطلاب على المجموعات حسب السعات.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-start font-medium">المقرر</th>
                <th className="px-3 py-2 text-start font-medium">المحاضرة</th>
                <th className="px-3 py-2 text-start font-medium">رقم المجموعة</th>
                <th className="px-3 py-2 text-start font-medium">طلاب متوقع</th>
                <th className="px-3 py-2 text-start font-medium">السعة</th>
                <th className="px-3 py-2 text-start font-medium">الحالة</th>
                <th className="px-3 py-2 text-start font-medium">الإسناد</th>
              </tr>
            </thead>
            <tbody>
              {(groups ?? []).map((g) => {
                const assigned = assignmentCounts?.get(g.id) ?? 0;
                const obsolete = Boolean(g.is_obsolete);
                return (
                  <tr
                    key={g.id}
                    className={`border-t ${obsolete ? "bg-muted/30 text-muted-foreground" : ""}`}
                  >
                    <td className="px-3 py-2">
                      <span className="block font-medium">
                        {g.plan_courses?.courses?.name ?? "—"}
                      </span>
                      <span dir="ltr" className="text-xs text-muted-foreground">
                        {g.plan_courses?.courses?.code}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {COMPONENT_TYPE_LABEL_AR[
                        g.plan_course_components
                          ?.component_type as keyof typeof COMPONENT_TYPE_LABEL_AR
                      ] ?? "—"}
                      {isExcludedFromWorkload(g) ? (
                        <span className="ms-2 text-xs text-muted-foreground">
                          (خارج النصاب)
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2" dir="ltr">
                      {g.group_number ?? g.group_code}
                    </td>
                    <td className="px-3 py-2">{formatNumber(g.expected_students)}</td>
                    <td className="px-3 py-2">{formatNumber(g.capacity_limit)}</td>
                    <td className="px-3 py-2">
                      {obsolete ? (
                        <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
                          متوقفة عن الاستخدام
                        </span>
                      ) : g.active ? (
                        "نشطة"
                      ) : (
                        "غير نشطة"
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {assignmentCountsError
                        ? "—"
                        : assigned > 0
                          ? `مسند (${formatNumber(assigned)})`
                          : "غير مسند"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
