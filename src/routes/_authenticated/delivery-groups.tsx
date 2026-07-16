import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { UsersRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCollege } from "@/hooks/use-colleges";
import { CollegeSwitcher } from "@/components/college-switcher";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/delivery-groups")({
  head: () => ({ meta: [{ title: "مجموعات التدريس" }] }),
  component: DeliveryGroupsPage,
});

type Row = {
  id: string;
  group_code: string;
  group_number?: number | null;
  expected_students: number;
  capacity_limit: number | null;
  excluded_from_standard_workload?: boolean;
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
      const { data, error } = await supabase
        .from("delivery_groups")
        .select(
          "id, group_code, expected_students, capacity_limit, cohort_id, component_id, plan_course_components(component_type)",
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
          <h1 className="text-2xl font-bold">مجموعات التدريس</h1>
          <p className="text-sm text-muted-foreground">
            عرض قراءة فقط لمجموعات مكوّنات المقررات حسب الدفعة. التوليد من صفحة الدفعات الأكاديمية.
          </p>
        </div>
      </header>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <CollegeSwitcher />
        <Button asChild variant="outline" size="sm">
          <Link to="/academic-cohorts">الدفعات الأكاديمية</Link>
        </Button>
      </div>

      {!active ? (
        <p className="text-sm text-muted-foreground">اختر كلية.</p>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">جاري التحميل…</p>
      ) : (rows ?? []).length === 0 ? (
        <Card className="border-dashed p-6 text-sm text-muted-foreground">
          لا توجد مجموعات تدريس بعد. استخدم صفحة الدفعات لتوليد المجموعات بعد توفر الطروحات
          التوافقية.
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
                  <th className="px-3 py-2 text-right font-medium">حالة الإسناد</th>
                </tr>
              </thead>
              <tbody>
                {(rows ?? []).map((g) => (
                  <tr key={g.id} className="border-t">
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
