import type { TeachingAssignmentWorkspaceRow } from "@/lib/academic-delivery/teaching-assignments-v2";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { entityDisplayName } from "@/lib/entity-display";
import { fetchSharedLectures } from "@/lib/academic-delivery/shared-lectures";
import { assignmentRowAcademicContext } from "@/lib/teaching-assignments/assignment-row-context";
import { assignmentRowPlacementLabel } from "@/lib/teaching-assignments/assignment-placement-context";
import { loadAssignmentSchedule } from "@/lib/teaching-assignments/assignment-schedule";
import { formatDecimal, formatNumber } from "@/lib/format";
import { QueryErrorNotice } from "@/components/app-states/query-error-notice";
import { ShowMoreRows } from "@/components/app-states/show-more-rows";
import { useRowWindow } from "@/hooks/use-row-window";

/** Delivery-group rows of the teaching-assignment workspace (split from teaching-assignments.tsx, L-14). */
export const COMPONENT_LABELS: Record<string, string> = {
  theory: "نظري",
  practical: "عملي",
  tutorial: "تمارين",
  project: "مشروع",
};

export const ALLOCATION_LABELS: Record<string, string> = {
  unassigned: "غير مسند",
  under_allocated: "توزيع جزئي",
  fully_allocated: "الإسناد مكتمل",
  over_allocated: "تجاوز الساعات",
};

type RowWindow = ReturnType<typeof useRowWindow<TeachingAssignmentWorkspaceRow>>;

export function TeachingAssignmentGroupsTable({
  workspace,
  rows,
  rowWindow,
  courseSearchActive,
  instructorSearchActive,
  academicContext,
  programs,
  scheduleQuery,
  readOnly,
  openAssign,
  openEditHours,
  setDeactivateTarget,
}: {
  workspace: { isLoading: boolean; isError: boolean; error: unknown; refetch: () => unknown };
  rows: TeachingAssignmentWorkspaceRow[];
  rowWindow: RowWindow;
  courseSearchActive: boolean;
  instructorSearchActive: boolean;
  academicContext:
    | {
        cohorts: { id: string; program_id: string; study_system: string }[];
        sharedLectures: Awaited<ReturnType<typeof fetchSharedLectures>>;
      }
    | undefined;
  programs: { id: string; name: string; code: string | null }[] | undefined;
  scheduleQuery: {
    isPending: boolean;
    isError: boolean;
    data?: Awaited<ReturnType<typeof loadAssignmentSchedule>>;
  };
  readOnly: boolean;
  openAssign: (row: TeachingAssignmentWorkspaceRow) => void;
  openEditHours: (row: TeachingAssignmentWorkspaceRow, assignmentId: string) => void;
  setDeactivateTarget: (target: { id: string; updatedAt: string; name: string } | null) => void;
}) {
  return (
    <Card className="overflow-hidden" data-testid="ta-v2-groups-table">
      {workspace.isLoading ? (
        <p className="p-6 text-center text-muted-foreground">جاري التحميل…</p>
      ) : workspace.isError ? (
        <div className="p-4">
          <QueryErrorNotice
            title="تعذّر تحميل مساحة العمل. تأكد من صلاحية العرض وأن Migration مطبّقة عند الحاجة."
            error={workspace.error}
            onRetry={() => void workspace.refetch()}
          />
        </div>
      ) : rows.length === 0 ? (
        <p className="p-6 text-center text-muted-foreground">
          {courseSearchActive || instructorSearchActive
            ? "لا توجد مجموعات مطابقة لبحث المقرر أو المحاضر."
            : "لا توجد مجموعات محاضرات ومعامل أسبوعية مطابقة. ولّد المجموعات من الدفعات الدراسية أولاً."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-start font-medium">المقرر</th>
                <th className="px-3 py-2 text-start font-medium">البرنامج</th>
                <th className="px-3 py-2 text-start font-medium">نظام الدراسة</th>
                <th className="px-3 py-2 text-start font-medium">اليوم</th>
                <th className="px-3 py-2 text-start font-medium">المحاضرة</th>
                <th className="px-3 py-2 text-start font-medium">المجموعة</th>
                <th className="px-3 py-2 text-start font-medium">طلاب</th>
                <th className="px-3 py-2 text-start font-medium">سعة</th>
                <th className="px-3 py-2 text-start font-medium">الحالة</th>
                <th className="px-3 py-2 text-start font-medium">المدرسون</th>
                <th className="px-3 py-2 text-start font-medium">ساعات</th>
                <th className="px-3 py-2 text-start font-medium">التوزيع</th>
                <th className="px-3 py-2 text-start font-medium">إجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rowWindow.visible.map((row) => {
                const context = assignmentRowAcademicContext({
                  row,
                  cohorts: academicContext?.cohorts ?? [],
                  programs: programs ?? [],
                  sharedLectures: academicContext?.sharedLectures ?? [],
                });
                return (
                  <tr key={row.delivery_group_id} className={row.is_obsolete ? "opacity-70" : ""}>
                    <td className="px-3 py-2">
                      <div className="font-medium">
                        {entityDisplayName({
                          name: row.course_name,
                          code: row.course_code,
                        })}
                      </div>
                    </td>
                    <td className="px-3 py-2" data-testid="ta-v2-row-program">
                      {context.programLabel}
                    </td>
                    <td className="px-3 py-2" data-testid="ta-v2-row-study-system">
                      {context.studySystemLabel}
                    </td>
                    <td className="px-3 py-2" data-testid="ta-v2-row-day">
                      {scheduleQuery.isPending
                        ? "جارٍ التحميل…"
                        : scheduleQuery.isError
                          ? "تعذر التحميل"
                          : assignmentRowPlacementLabel(
                              scheduleQuery.data?.placements.get(row.delivery_group_id),
                              !!scheduleQuery.data?.version,
                            )}
                    </td>
                    <td className="px-3 py-2">
                      {COMPONENT_LABELS[row.component_type] ?? row.component_type}
                    </td>
                    <td className="px-3 py-2">{row.group_number ?? row.group_code}</td>
                    <td className="px-3 py-2">{formatNumber(row.expected_students)}</td>
                    <td className="px-3 py-2">{formatNumber(row.capacity_limit)}</td>
                    <td className="px-3 py-2">
                      {row.is_obsolete ? (
                        <span className="text-destructive" data-testid="ta-v2-obsolete-badge">
                          ملغاة
                        </span>
                      ) : row.active ? (
                        "نشطة"
                      ) : (
                        "غير نشطة"
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {row.instructors.length === 0
                        ? "—"
                        : row.instructors.map((i, index) => (
                            <span key={i.assignment_id}>
                              {index > 0 ? "، " : ""}
                              {i.instructor_name ?? "—"}
                              {i.version_scoped ? (
                                <span
                                  className="ms-1 rounded bg-amber-100 px-1 text-[10px] text-amber-900 dark:bg-amber-900/40 dark:text-amber-200"
                                  data-testid="ta-v2-version-scoped-badge"
                                  title="إسناد خاص بهذه النسخة ولا يُحتسب تشغيليًا قبل نشرها"
                                >
                                  خاص بالنسخة
                                </span>
                              ) : null}
                            </span>
                          ))}
                    </td>
                    <td className="px-3 py-2">
                      {formatDecimal(row.assigned_hours_total)}/
                      {row.component_hours == null ? "?" : formatDecimal(row.component_hours)}
                      {row.remaining_hours > 0
                        ? ` (متبقي ${formatDecimal(row.remaining_hours)})`
                        : ""}
                    </td>
                    <td className="px-3 py-2">
                      {ALLOCATION_LABELS[row.allocation_status] ?? row.allocation_status}
                    </td>
                    <td className="px-3 py-2">
                      {!readOnly && !row.is_obsolete && row.active !== false ? (
                        <div className="flex flex-wrap gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            data-testid="ta-v2-assign-btn"
                            aria-label={`إسناد ${row.course_name ?? ""} — مجموعة ${row.group_number ?? row.group_code}`}
                            onClick={() => openAssign(row)}
                          >
                            إسناد
                          </Button>
                          {row.instructors[0] && (
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label={`تعديل ساعات ${row.instructors[0].instructor_name ?? "المدرس"}`}
                              onClick={() => openEditHours(row, row.instructors[0]!.assignment_id)}
                            >
                              ساعات
                            </Button>
                          )}
                          {row.instructors.map((i) => (
                            <Button
                              key={i.assignment_id}
                              size="sm"
                              variant="ghost"
                              data-testid="ta-v2-deactivate-btn"
                              aria-label={`تعطيل إسناد ${i.instructor_name ?? "المدرس"}`}
                              onClick={() =>
                                setDeactivateTarget({
                                  id: i.assignment_id,
                                  updatedAt: i.updated_at,
                                  name: i.instructor_name ?? "",
                                })
                              }
                            >
                              تعطيل
                            </Button>
                          ))}
                        </div>
                      ) : row.is_obsolete || row.active === false ? (
                        <span
                          className="text-xs text-muted-foreground"
                          data-testid="ta-v2-inactive-or-obsolete-no-assign"
                        >
                          لا إسناد
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <ShowMoreRows
            shown={rowWindow.shown}
            total={rowWindow.total}
            hasMore={rowWindow.hasMore}
            onShowMore={rowWindow.showMore}
            onShowAll={rowWindow.showAll}
          />
        </div>
      )}
    </Card>
  );
}
