import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { UsersRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCollege } from "@/hooks/use-colleges";
import { CollegeSwitcher } from "@/components/college-switcher";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AdminExportMenu } from "@/components/admin-export-menu";
import { deliveryGroupsExportDataset } from "@/lib/admin-export/datasets";
import { COMPONENT_TYPE_LABEL_AR } from "@/lib/academic-delivery/plan-course-editor";

export const Route = createFileRoute("/_authenticated/delivery-groups")({
  head: () => ({ meta: [{ title: "مجموعات المحاضرات والمعامل" }] }),
  component: DeliveryGroupsPage,
});

type Row = {
  id: string;
  group_code: string;
  group_number?: number | null;
  expected_students: number;
  capacity_limit: number | null;
  excluded_from_standard_workload?: boolean;
  is_obsolete?: boolean;
  cohort_id: string;
  component_id: string;
  plan_course_components: { component_type: string } | null;
};

function isExcluded(g: Row): boolean {
  if (g.excluded_from_standard_workload != null) return g.excluded_from_standard_workload;
  return g.plan_course_components?.component_type === "project";
}

/** Read-only college-wide delivery groups diagnostic (Phase 9.3). */
function DeliveryGroupsPage() {
  const { active } = useActiveCollege();

  const { data: rows, isLoading } = useQuery({
    queryKey: ["delivery-groups", active?.id, "all"],
    enabled: !!active,
    queryFn: async () => {
      const full = await supabase
        .from("delivery_groups")
        .select(
          "id, group_code, group_number, expected_students, capacity_limit, is_obsolete, excluded_from_standard_workload, cohort_id, component_id, plan_course_components!dg_component_college_fkey(component_type)",
        )
        .eq("college_id", active!.id)
        .order("group_code", { ascending: true });
      if (!full.error) {
        return (full.data ?? []) as unknown as Row[];
      }
      const { data, error } = await supabase
        .from("delivery_groups")
        .select(
          "id, group_code, expected_students, capacity_limit, cohort_id, component_id, plan_course_components!dg_component_college_fkey(component_type)",
        )
        .eq("college_id", active!.id)
        .order("group_code", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  const { data: assignmentRows } = useQuery({
    queryKey: ["delivery-group-assignments-all", active?.id],
    enabled: !!active && (rows?.length ?? 0) > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teaching_assignments")
        .select("delivery_group_id")
        .eq("college_id", active!.id)
        .not("delivery_group_id", "is", null);
      if (error) throw error;
      const set = new Set((data ?? []).map((r) => r.delivery_group_id).filter(Boolean));
      return set;
    },
  });

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-6 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-secondary text-primary">
          <UsersRound className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">مجموعات المحاضرات والمعامل</h1>
          <p className="text-sm text-muted-foreground">
            مجموعات مكوّنات المقررات حسب الدفعة الدراسية؛ تُولّد من مقررات الدفعة ولا تستخدم
            Sections.
          </p>
        </div>
      </header>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <CollegeSwitcher />
        <div className="flex flex-wrap gap-2">
          <AdminExportMenu
            size="sm"
            testId="delivery-groups-export"
            disabled={!active || (rows ?? []).length === 0}
            dataset={() =>
              deliveryGroupsExportDataset({
                rows: (rows ?? []).map((g) => ({
                  group_code: g.group_code,
                  group_number: g.group_number ?? null,
                  component_type: g.plan_course_components?.component_type ?? null,
                  expected_students: g.expected_students,
                  capacity_limit: g.capacity_limit,
                  is_obsolete: g.is_obsolete ?? false,
                  excluded_from_workload: isExcluded(g),
                  assigned: assignmentRows?.has(g.id) ?? false,
                })),
                collegeName: active?.name ?? null,
                componentLabel: (v) =>
                  (v ? COMPONENT_TYPE_LABEL_AR[v as keyof typeof COMPONENT_TYPE_LABEL_AR] : "") ??
                  v ??
                  "",
              })
            }
          />
          <Button asChild variant="outline" size="sm">
            <Link to="/academic-cohorts">الدفعات الدراسية</Link>
          </Button>
        </div>
      </div>

      <Card className="mb-4 border-primary/30 bg-primary/5 p-4 text-sm">
        <p className="font-semibold">الخطوة التالية</p>
        <p className="mt-1 text-muted-foreground">
          راجع المجموعات المولّدة، ثم انتقل إلى الإسناد التدريسي قبل بناء الجدول.
        </p>
        <Button asChild variant="link" className="mt-1 h-auto p-0">
          <Link to="/teaching-assignments">الإسناد التدريسي</Link>
        </Button>
      </Card>

      {!active ? (
        <p className="text-sm text-muted-foreground">اختر كلية.</p>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">جاري التحميل…</p>
      ) : (rows ?? []).length === 0 ? (
        <Card className="border-dashed p-6 text-sm text-muted-foreground">
          لا توجد مجموعات محاضرات ومعامل بعد. استخدم صفحة الدفعات لتوليد المجموعات بعد توفر مقررات
          الدفعة الدراسية.
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-right font-medium">نوع المكوّن</th>
                  <th className="px-3 py-2 text-right font-medium">رقم المجموعة</th>
                  <th className="px-3 py-2 text-right font-medium">طلاب متوقع</th>
                  <th className="px-3 py-2 text-right font-medium">السعة</th>
                  <th className="px-3 py-2 text-right font-medium">الحالة</th>
                  <th className="px-3 py-2 text-right font-medium">حالة الإسناد</th>
                </tr>
              </thead>
              <tbody>
                {(rows ?? []).map((g) => (
                  <tr
                    key={g.id}
                    className={`border-t ${g.is_obsolete ? "bg-muted/30 text-muted-foreground" : ""}`}
                  >
                    <td className="px-3 py-2">
                      {g.plan_course_components?.component_type ?? "—"}
                      {isExcluded(g) ? (
                        <span className="ms-2 text-xs text-muted-foreground">(خارج النصاب)</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2" dir="ltr">
                      {g.group_number ?? g.group_code}
                    </td>
                    <td className="px-3 py-2">{g.expected_students}</td>
                    <td className="px-3 py-2">{g.capacity_limit ?? "—"}</td>
                    <td className="px-3 py-2">
                      {g.is_obsolete ? (
                        <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
                          obsolete
                        </span>
                      ) : (
                        "نشطة"
                      )}
                    </td>
                    <td className="px-3 py-2">{assignmentRows?.has(g.id) ? "مسند" : "غير مسند"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
