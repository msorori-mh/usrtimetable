import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Layers3 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCollege } from "@/hooks/use-colleges";
import { useCanManageActiveCollege } from "@/hooks/use-can-manage";
import { useGenerateDeliveryGroups } from "@/hooks/use-generate-delivery-groups";
import { useGenerateCohortCurriculum } from "@/hooks/use-generate-cohort-curriculum";
import type { CohortCurriculumSummary } from "@/lib/academic-delivery/cohort-curriculum";
import type { DeliveryGroupGeneratorSummary } from "@/lib/academic-delivery/delivery-group-generator-summary";
import { CollegeSwitcher } from "@/components/college-switcher";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/academic-cohorts")({
  head: () => ({ meta: [{ title: "الدفعات الدراسية" }] }),
  component: AcademicCohortsPage,
});

type CohortRow = {
  id: string;
  code: string | null;
  study_system: string;
  entry_year: number;
  expected_students: number;
  count_status: string;
  program_id: string;
  level_id: string;
  term_id: string;
  active: boolean;
};

type DeliveryGroupRow = {
  id: string;
  cohort_id: string;
  component_id: string;
  group_code: string;
  group_number?: number | null;
  expected_students: number;
  capacity_limit: number | null;
  excluded_from_standard_workload?: boolean;
  is_obsolete?: boolean;
  active: boolean;
  plan_course_components: {
    component_type: string;
    weekly_contact_hours: number;
  } | null;
};

function isExcludedFromWorkload(g: DeliveryGroupRow): boolean {
  if (g.excluded_from_standard_workload != null) return g.excluded_from_standard_workload;
  return g.plan_course_components?.component_type === "project";
}

/**
 * Phase 9.3 foundation — read-only cohort + delivery-group diagnostics.
 * Generate is explicit + confirmed; never auto-run after import.
 */
function AcademicCohortsPage() {
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();
  const generate = useGenerateDeliveryGroups();
  const generateCurriculum = useGenerateCohortCurriculum();
  const [selectedCohortId, setSelectedCohortId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lastSummary, setLastSummary] = useState<DeliveryGroupGeneratorSummary | null>(null);
  const [lastCurriculumSummary, setLastCurriculumSummary] =
    useState<CohortCurriculumSummary | null>(null);

  const { data: programs } = useQuery({
    queryKey: ["programs-min", active?.id],
    enabled: !!active,
    queryFn: async () =>
      (
        await supabase
          .from("academic_programs")
          .select("id, name")
          .eq("college_id", active!.id)
          .order("name")
      ).data ?? [],
  });
  const { data: levels } = useQuery({
    queryKey: ["levels-min-ro", active?.id],
    enabled: !!active,
    queryFn: async () =>
      (
        await supabase
          .from("academic_levels")
          .select("id, name")
          .eq("college_id", active!.id)
          .order("level_number")
      ).data ?? [],
  });
  const { data: terms } = useQuery({
    queryKey: ["terms-min", active?.id],
    enabled: !!active,
    queryFn: async () =>
      (
        await supabase
          .from("academic_terms")
          .select("id, name")
          .eq("college_id", active!.id)
          .order("start_date", { ascending: false })
      ).data ?? [],
  });

  const { data: cohorts, isLoading } = useQuery({
    queryKey: ["academic-cohorts", active?.id],
    enabled: !!active,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("academic_cohorts")
        .select(
          "id, code, study_system, entry_year, expected_students, count_status, program_id, level_id, term_id, active",
        )
        .eq("college_id", active!.id)
        .order("entry_year", { ascending: false });
      if (error) throw error;
      return (data ?? []) as CohortRow[];
    },
  });

  const effectiveCohortId = selectedCohortId ?? cohorts?.[0]?.id ?? null;

  const { data: groups, isLoading: groupsLoading } = useQuery({
    queryKey: ["delivery-groups", active?.id, effectiveCohortId],
    enabled: !!active && !!effectiveCohortId,
    queryFn: async () => {
      // Prefer 9.3 columns when present; fall back to 9.1 base if migration not applied yet.
      const full = await supabase
        .from("delivery_groups")
        .select(
          "id, cohort_id, component_id, group_code, group_number, expected_students, capacity_limit, active, excluded_from_standard_workload, is_obsolete, plan_course_components(component_type, weekly_contact_hours)",
        )
        .eq("college_id", active!.id)
        .eq("cohort_id", effectiveCohortId!)
        .order("group_code", { ascending: true });
      if (!full.error) {
        return (full.data ?? []) as unknown as DeliveryGroupRow[];
      }
      const { data, error } = await supabase
        .from("delivery_groups")
        .select(
          "id, cohort_id, component_id, group_code, expected_students, capacity_limit, active, plan_course_components(component_type, weekly_contact_hours)",
        )
        .eq("college_id", active!.id)
        .eq("cohort_id", effectiveCohortId!)
        .order("group_code", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as DeliveryGroupRow[];
    },
  });

  const { data: assignmentCounts } = useQuery({
    queryKey: ["delivery-group-assignments", active?.id, effectiveCohortId],
    enabled: !!active && !!effectiveCohortId && (groups?.length ?? 0) > 0,
    queryFn: async () => {
      const ids = (groups ?? []).map((g) => g.id);
      const { data, error } = await supabase
        .from("teaching_assignments")
        .select("delivery_group_id")
        .eq("college_id", active!.id)
        .in("delivery_group_id", ids);
      if (error) throw error;
      const map = new Map<string, number>();
      for (const row of data ?? []) {
        if (!row.delivery_group_id) continue;
        map.set(row.delivery_group_id, (map.get(row.delivery_group_id) ?? 0) + 1);
      }
      return map;
    },
  });

  const progMap = useMemo(() => new Map((programs ?? []).map((p) => [p.id, p.name])), [programs]);
  const levelMap = useMemo(() => new Map((levels ?? []).map((l) => [l.id, l.name])), [levels]);
  const termMap = useMemo(() => new Map((terms ?? []).map((t) => [t.id, t.name])), [terms]);
  const selected = (cohorts ?? []).find((c) => c.id === effectiveCohortId) ?? null;

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-6 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-secondary text-primary">
          <Layers3 className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">الدفعات الدراسية</h1>
          <p className="text-sm text-muted-foreground">
            الدفعة الدراسية تربط الخطة الدراسية بالمقررات الاختيارية المعتمدة ومقررات الدفعة.
          </p>
        </div>
      </header>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <CollegeSwitcher />
        <Button asChild variant="outline" size="sm">
          <Link to="/delivery-groups">عرض مجموعات المحاضرات والمعامل</Link>
        </Button>
      </div>

      <Card className="mb-4 border-dashed p-4 text-sm text-muted-foreground">
        لا يوجد CRUD موسّع في هذه المرحلة. استيراد الدفعات يتم عبر قوالب Excel؛ توليد مجموعات
        التدريس لا يعمل تلقائيًا بعد الاستيراد.
      </Card>
      <Card className="mb-4 border-primary/30 bg-primary/5 p-4 text-sm">
        <p className="font-semibold">الخطوة التالية</p>
        <p className="mt-1 text-muted-foreground">
          اعتمد المقررات الاختيارية، ثم ولّد مقررات الدفعة ومجموعات المحاضرات والمعامل، وبعدها انتقل
          إلى الإسناد التدريسي.
        </p>
      </Card>

      {!active ? (
        <p className="text-sm text-muted-foreground">اختر كلية لعرض الدفعات.</p>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">جاري التحميل…</p>
      ) : (cohorts ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">لا توجد دفعات مسجّلة لهذه الكلية.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-[280px_1fr]">
          <Card className="divide-y overflow-hidden">
            {(cohorts ?? []).map((c) => (
              <button
                key={c.id}
                type="button"
                className={`block w-full px-3 py-3 text-right text-sm transition-colors ${
                  c.id === effectiveCohortId ? "bg-secondary" : "hover:bg-muted/50"
                }`}
                onClick={() => setSelectedCohortId(c.id)}
              >
                <p className="font-semibold">
                  {progMap.get(c.program_id) ?? "برنامج"} · {levelMap.get(c.level_id) ?? "مستوى"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {termMap.get(c.term_id) ?? "فصل"} · {c.study_system} · {c.expected_students} طالب
                </p>
              </button>
            ))}
          </Card>

          <div className="space-y-3">
            {selected && (
              <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-semibold">
                    {progMap.get(selected.program_id)} / {levelMap.get(selected.level_id)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {termMap.get(selected.term_id)} · حالة العدد: {selected.count_status}
                  </p>
                </div>
                {canManage ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={generateCurriculum.isPending}
                      onClick={() => {
                        if (!effectiveCohortId) return;
                        generateCurriculum.mutate(effectiveCohortId, {
                          onSuccess: setLastCurriculumSummary,
                        });
                      }}
                    >
                      توليد منهج الدفعة
                    </Button>
                    <Button
                      size="sm"
                      disabled={generate.isPending}
                      onClick={() => setConfirmOpen(true)}
                    >
                      توليد مجموعات التدريس
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">التوليد متاح لمديري الكلية فقط.</p>
                )}
              </Card>
            )}

            <Card className="overflow-hidden">
              <div className="border-b px-4 py-3 text-sm font-medium">مجموعات المكوّنات</div>
              {groupsLoading ? (
                <p className="p-4 text-sm text-muted-foreground">جاري التحميل…</p>
              ) : (groups ?? []).length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">
                  لا توجد مجموعات بعد. ولّد المجموعات بعد وجود طروحات توافقية ومكوّنات خطة.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-right font-medium">المكوّن</th>
                        <th className="px-3 py-2 text-right font-medium">رقم المجموعة</th>
                        <th className="px-3 py-2 text-right font-medium">طلاب متوقع</th>
                        <th className="px-3 py-2 text-right font-medium">السعة</th>
                        <th className="px-3 py-2 text-right font-medium">الحالة</th>
                        <th className="px-3 py-2 text-right font-medium">الإسناد</th>
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
                              {g.plan_course_components?.component_type ?? "—"}
                              {isExcludedFromWorkload(g) ? (
                                <span className="ms-2 text-xs text-muted-foreground">
                                  (خارج النصاب)
                                </span>
                              ) : null}
                            </td>
                            <td className="px-3 py-2" dir="ltr">
                              {g.group_number ?? g.group_code}
                            </td>
                            <td className="px-3 py-2">{g.expected_students}</td>
                            <td className="px-3 py-2">{g.capacity_limit ?? "—"}</td>
                            <td className="px-3 py-2">
                              {obsolete ? (
                                <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
                                  obsolete — لا تكليفات/جلسات جديدة
                                </span>
                              ) : (
                                "نشطة"
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {assigned > 0 ? `مسند (${assigned})` : "غير مسند"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            {lastCurriculumSummary ? (
              <Card className="space-y-2 p-4 text-sm" data-testid="cohort-curriculum-summary">
                <p className="font-medium">تم توليد منهج الدفعة من الخطة الدراسية المعتمدة.</p>
                <p className="text-muted-foreground">
                  أضيف {lastCurriculumSummary.inserted_offerings} · موجود مسبقاً{" "}
                  {lastCurriculumSummary.skipped_existing} · مقررات اختيارية معتمدة{" "}
                  {lastCurriculumSummary.elective_candidates}
                </p>
                {lastCurriculumSummary.skipped_unselected_elective > 0 ? (
                  <p className="text-amber-700 dark:text-amber-400">
                    لم تُنشأ مقررات {lastCurriculumSummary.skipped_unselected_elective} من الخانات
                    الاختيارية لعدم وجود اختيار معتمد للدفعة.
                  </p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  لم يُنشأ تسجيل فردي Legacy أو شعبة تشغيلية أو مجموعة تدريس أو جلسة.
                </p>
              </Card>
            ) : null}

            {lastSummary ? (
              <Card className="space-y-2 p-4 text-sm" data-testid="generator-summary-panel">
                <p className="font-medium">
                  نتيجة التوليد: <span dir="ltr">{lastSummary.status}</span>
                </p>
                <p className="text-muted-foreground">
                  إنشاء {lastSummary.groups_created} · تحديث {lastSummary.groups_updated} · دون
                  تغيير {lastSummary.groups_unchanged} · obsolete {lastSummary.groups_obsolete}
                </p>
                {(lastSummary.validation_errors?.length ?? 0) > 0 ? (
                  <ul className="list-disc ps-5 text-destructive">
                    {lastSummary.validation_errors.map((e, i) => (
                      <li key={`${e.code}-${i}`}>
                        {e.code}
                        {e.message ? `: ${e.message}` : ""}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {(lastSummary.warnings?.length ?? 0) > 0 ? (
                  <ul className="list-disc ps-5 text-amber-700 dark:text-amber-400">
                    {lastSummary.warnings.map((w, i) => (
                      <li key={`${w.code}-${i}`}>
                        {w.code}
                        {w.message ? `: ${w.message}` : ""}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </Card>
            ) : null}
          </div>
        </div>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد توليد مجموعات التدريس</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم توليد أو تحديث مجموعات المكوّنات لهذه الدفعة فقط بشكل غير مدمّر (بدون حذف
              المجموعات المرتبطة بتكليفات أو جلسات). لن يُشغَّل المولّد على دفعات أخرى.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!effectiveCohortId) return;
                setConfirmOpen(false);
                generate.mutate(effectiveCohortId, {
                  onSuccess: (summary) => setLastSummary(summary),
                });
              }}
            >
              تأكيد التوليد
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
