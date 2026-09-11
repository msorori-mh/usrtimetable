import { generationErrorMessage } from "@/lib/academic-delivery/generation-messages";
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Layers3,
  Users,
  Search,
  ChevronRight,
  ChevronLeft,
  ArrowDownLeft,
  BookOpen,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCollege } from "@/hooks/use-colleges";
import { useCanManageActiveCollege } from "@/hooks/use-can-manage";
import { useGenerateDeliveryGroups } from "@/hooks/use-generate-delivery-groups";
import { useGenerateCohortCurriculum } from "@/hooks/use-generate-cohort-curriculum";
import { checkCohortDeliveryGroupRoomTypes } from "@/lib/academic-delivery/cohort-delivery-group-room-type-gate";
import type { CohortCurriculumSummary } from "@/lib/academic-delivery/cohort-curriculum";
import type { DeliveryGroupGeneratorSummary } from "@/lib/academic-delivery/delivery-group-generator-summary";
import { CollegeSwitcher } from "@/components/college-switcher";
import { AdminExportMenu } from "@/components/admin-export-menu";
import { activeFilters, cohortsExportDataset } from "@/lib/admin-export/datasets";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  COHORT_SYSTEM_LABELS,
  COHORT_COUNT_LABELS,
  EMPTY_COHORT_FILTERS,
  filterCohortDirectory,
  cohortLevelOptions,
  cohortDirectoryPage,
  visibleCohortSelection,
  type CohortFilters,
  type CohortListRow,
} from "@/lib/academic-delivery/cohort-directory";
import { COMPONENT_TYPE_LABEL_AR } from "@/lib/academic-delivery/plan-course-editor";
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
  plan_courses: { courses: { code: string; name: string } | null } | null;
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
  return <AcademicCohortsWorkspace key={active?.id ?? "no-college"} />;
}

function AcademicCohortsWorkspace() {
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();
  const generate = useGenerateDeliveryGroups();
  const generateCurriculum = useGenerateCohortCurriculum();
  const [selectedCohortId, setSelectedCohortId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [filters, setFilters] = useState<CohortFilters>(EMPTY_COHORT_FILTERS);
  const [page, setPage] = useState(1);
  const [lastSummary, setLastSummary] = useState<
    (DeliveryGroupGeneratorSummary & { cohortId: string }) | null
  >(null);
  const [lastCurriculumSummary, setLastCurriculumSummary] = useState<
    (CohortCurriculumSummary & { cohortId: string }) | null
  >(null);

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
    queryKey: ["cohort-directory-levels", active?.id],
    enabled: !!active,
    queryFn: async () =>
      (
        await supabase
          .from("academic_levels")
          .select("id, name, level_number, program_id")
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

  const {
    data: cohorts,
    isLoading,
    error: cohortsError,
  } = useQuery({
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

  const directoryRows = useMemo<CohortListRow[]>(() => {
    const p = new Map((programs ?? []).map((row) => [row.id, row.name]));
    const l = new Map((levels ?? []).map((row) => [row.id, row]));
    const t = new Map((terms ?? []).map((row) => [row.id, row.name]));
    return (cohorts ?? []).map((row) => ({
      ...row,
      programName: p.get(row.program_id) ?? "برنامج غير محدد",
      levelName: l.get(row.level_id)?.name ?? "مستوى غير محدد",
      levelNumber: l.get(row.level_id)?.level_number ?? null,
      termName: t.get(row.term_id) ?? "فصل غير محدد",
    }));
  }, [cohorts, programs, levels, terms]);
  const filteredCohorts = useMemo(
    () => filterCohortDirectory(directoryRows, filters),
    [directoryRows, filters],
  );
  const directoryPage = cohortDirectoryPage(filteredCohorts, page);
  const effectiveCohortId = visibleCohortSelection(directoryPage.rows, selectedCohortId);
  const availableLevels = cohortLevelOptions(directoryRows, filters.program);
  const hasFilters = Object.entries(filters).some(
    ([key, value]) => value !== EMPTY_COHORT_FILTERS[key as keyof CohortFilters],
  );
  const changeFilters = (patch: Partial<CohortFilters>) => {
    setFilters((current) => ({
      ...current,
      ...patch,
      ...(patch.program !== undefined ? { level: "all" } : {}),
    }));
    setPage(1);
    setSelectedCohortId(null);
    setConfirmOpen(false);
  };
  const selectCohort = (id: string) => {
    setSelectedCohortId(id);
    setConfirmOpen(false);
    document
      .getElementById("cohort-details")
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const {
    data: groups,
    isLoading: groupsLoading,
    error: groupsError,
  } = useQuery({
    queryKey: ["delivery-groups", active?.id, effectiveCohortId],
    enabled: !!active && !!effectiveCohortId,
    queryFn: async () => {
      // Prefer 9.3 columns when present; fall back to 9.1 base if migration not applied yet.
      const full = await supabase
        .from("delivery_groups")
        .select(
          "id, cohort_id, component_id, group_code, group_number, expected_students, capacity_limit, active, excluded_from_standard_workload, is_obsolete, plan_course_components!dg_component_college_fkey(component_type, weekly_contact_hours), plan_courses!dg_plan_course_college_fkey(courses(code, name))",
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
          "id, cohort_id, component_id, group_code, expected_students, capacity_limit, active, plan_course_components!dg_component_college_fkey(component_type, weekly_contact_hours), plan_courses!dg_plan_course_college_fkey(courses(code, name))",
        )
        .eq("college_id", active!.id)
        .eq("cohort_id", effectiveCohortId!)
        .order("group_code", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as DeliveryGroupRow[];
    },
  });

  const { data: roomTypeGate, error: roomTypeGateError } = useQuery({
    queryKey: ["cohort-dg-room-type-gate", active?.id, effectiveCohortId],
    enabled: !!effectiveCohortId,
    queryFn: () => checkCohortDeliveryGroupRoomTypes(effectiveCohortId!),
  });

  const roomTypeBlocker = roomTypeGate && !roomTypeGate.ok ? roomTypeGate.components : [];

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

  const selected = directoryPage.rows.find((c) => c.id === effectiveCohortId) ?? null;

  return (
    <div className="w-full min-w-0 space-y-5" data-testid="cohort-directory-page">
      <header className="mb-6 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-secondary text-primary">
          <Layers3 className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">الدفعات الدراسية</h1>
          <p className="text-sm text-muted-foreground">
            ابحث عن الدفعة، راجع عدد طلابها، ثم اعرض مقرراتها ومجموعات المحاضرات والمعامل.
          </p>
        </div>
      </header>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <CollegeSwitcher />
        <div className="flex flex-wrap gap-2">
          <AdminExportMenu
            size="sm"
            testId="cohorts-export"
            disabled={filteredCohorts.length === 0}
            dataset={() =>
              cohortsExportDataset({
                rows: filteredCohorts,
                collegeName: active?.name ?? null,
                systemLabel: (v) => COHORT_SYSTEM_LABELS[v ?? ""] ?? v ?? "",
                countStatusLabel: (v) => COHORT_COUNT_LABELS[v ?? ""] ?? v ?? "",
                filters: activeFilters([
                  { label: "البحث", value: filters.search },
                  {
                    label: "البرنامج",
                    value:
                      filters.program === "all"
                        ? ""
                        : ((programs ?? []).find((p) => p.id === filters.program)?.name ?? ""),
                  },
                  { label: "المستوى", value: filters.level === "all" ? "" : filters.level },
                  {
                    label: "نظام الدراسة",
                    value:
                      filters.system === "all"
                        ? ""
                        : (COHORT_SYSTEM_LABELS[filters.system] ?? filters.system),
                  },
                  {
                    label: "الفصل",
                    value:
                      filters.term === "all"
                        ? ""
                        : ((terms ?? []).find((t) => t.id === filters.term)?.name ?? ""),
                  },
                  {
                    label: "الحالة",
                    value:
                      filters.activity === "all"
                        ? ""
                        : filters.activity === "active"
                          ? "نشطة فقط"
                          : "غير نشطة فقط",
                  },
                ]),
              })
            }
          />
          <Button asChild variant="outline" size="sm">
            <Link to="/delivery-groups">عرض مجموعات المحاضرات والمعامل</Link>
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/15 bg-primary/5 p-4 text-sm">
        <p className="text-muted-foreground">
          اختر دفعة لعرض تفاصيلها. توليد المقررات والمجموعات يتم من لوحة الدفعة المختارة.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link to="/data-onboarding" search={{ step: "cohorts" }}>
            إعداد الدفعات واستيراد Excel
          </Link>
        </Button>
      </div>

      {!active ? (
        <p className="text-sm text-muted-foreground">اختر كلية لعرض الدفعات.</p>
      ) : cohortsError ? (
        <Card className="p-5 text-destructive" role="alert">
          تعذّر تحميل الدفعات. أعد تحميل الصفحة للمحاولة مجددًا.
        </Card>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">جاري التحميل…</p>
      ) : (cohorts ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">لا توجد دفعات مسجّلة لهذه الكلية.</p>
      ) : (
        <>
          <section aria-label="تصفية الدفعات" className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                { label: "الدفعات في النتائج", value: filteredCohorts.length },
                {
                  label: "أعداد الطلاب في النتائج",
                  value: filteredCohorts.reduce((sum, c) => sum + c.expected_students, 0),
                },
                {
                  label: "البرامج في النتائج",
                  value: new Set(filteredCohorts.map((c) => c.program_id)).size,
                },
                { label: "الدفعات النشطة", value: filteredCohorts.filter((c) => c.active).length },
              ].map((stat) => (
                <Card
                  key={stat.label}
                  className="flex items-center justify-between gap-3 px-4 py-3 shadow-none"
                >
                  <span className="text-sm text-muted-foreground">{stat.label}</span>
                  <strong className="text-2xl tabular-nums text-primary">
                    {stat.value.toLocaleString("ar")}
                  </strong>
                </Card>
              ))}
            </div>
            <Card className="space-y-4 p-4 shadow-none">
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative min-w-0 flex-1 basis-64">
                  <Search className="pointer-events-none absolute start-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={filters.search}
                    onChange={(e) => changeFilters({ search: e.target.value })}
                    placeholder="ابحث باسم البرنامج أو رمز الدفعة…"
                    aria-label="البحث في الدفعات"
                    className="h-10 ps-9"
                  />
                </div>
                <span className="text-sm text-muted-foreground" role="status">
                  {filteredCohorts.length} من {directoryRows.length} دفعة
                </span>
                {hasFilters && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setFilters(EMPTY_COHORT_FILTERS);
                      setPage(1);
                      setSelectedCohortId(null);
                      setConfirmOpen(false);
                    }}
                  >
                    مسح الفلاتر
                  </Button>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <DirectoryFilter
                  label="البرنامج"
                  value={filters.program}
                  onChange={(value) => changeFilters({ program: value })}
                >
                  <option value="all">جميع البرامج</option>
                  {(programs ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </DirectoryFilter>
                <DirectoryFilter
                  label="المستوى"
                  value={filters.level}
                  onChange={(value) => changeFilters({ level: value })}
                >
                  <option value="all">جميع المستويات</option>
                  {availableLevels.map((n) => (
                    <option key={n} value={String(n)}>
                      المستوى {n}
                    </option>
                  ))}
                </DirectoryFilter>
                <DirectoryFilter
                  label="النظام الدراسي"
                  value={filters.system}
                  onChange={(value) => changeFilters({ system: value })}
                >
                  <option value="all">جميع الأنظمة</option>
                  {[...new Set(directoryRows.map((r) => r.study_system))].map((system) => (
                    <option key={system} value={system}>
                      {COHORT_SYSTEM_LABELS[system] ?? system}
                    </option>
                  ))}
                </DirectoryFilter>
                <DirectoryFilter
                  label="الفصل الدراسي"
                  value={filters.term}
                  onChange={(value) => changeFilters({ term: value })}
                >
                  <option value="all">جميع الفصول</option>
                  {(terms ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </DirectoryFilter>
                <DirectoryFilter
                  label="حالة الدفعة"
                  value={filters.activity}
                  onChange={(value) => changeFilters({ activity: value })}
                >
                  <option value="all">جميع الدفعات</option>
                  <option value="active">نشطة</option>
                  <option value="inactive">غير نشطة</option>
                </DirectoryFilter>
              </div>
            </Card>
          </section>
          <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_420px]">
            <Card className="min-w-0 overflow-hidden" aria-label="قائمة الدفعات">
              <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
                <h2 className="font-semibold">الدفعات الدراسية</h2>
                <span className="text-xs text-muted-foreground">مرتبة حسب البرنامج والمستوى</span>
              </div>
              {directoryPage.rows.length === 0 ? (
                <div className="space-y-2 p-8 text-center">
                  <Search className="mx-auto h-7 w-7 text-muted-foreground" />
                  <p className="font-medium">لا توجد دفعات تطابق البحث</p>
                  <p className="text-sm text-muted-foreground">
                    غيّر البحث أو امسح الفلاتر لعرض الدفعات.
                  </p>
                </div>
              ) : (
                <div className="max-h-[min(36rem,65vh)] divide-y overflow-y-auto">
                  <div
                    className="sticky top-0 z-10 hidden grid-cols-[minmax(0,1fr)_95px_75px_60px] gap-3 bg-muted/40 px-4 py-2 text-xs text-muted-foreground sm:grid"
                    aria-hidden="true"
                  >
                    <span>البرنامج والدفعة</span>
                    <span>النظام</span>
                    <span>الطلاب</span>
                    <span>التفاصيل</span>
                  </div>
                  {directoryPage.rows.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      aria-pressed={c.id === effectiveCohortId}
                      aria-controls="cohort-details"
                      aria-label={`عرض دفعة ${c.programName}، ${c.levelName}، ${COHORT_SYSTEM_LABELS[c.study_system] ?? c.study_system}، ${c.termName}، دخول ${c.entry_year}`}
                      className={`grid w-full grid-cols-[minmax(0,1fr)_80px] gap-3 border-s-4 px-4 py-4 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary sm:grid-cols-[minmax(0,1fr)_95px_75px_60px] sm:items-center ${c.id === effectiveCohortId ? "border-s-primary bg-primary/5" : "border-s-transparent hover:bg-muted/40"}`}
                      onClick={() => selectCohort(c.id)}
                    >
                      <div className="min-w-0 space-y-1">
                        <p className="font-semibold leading-relaxed">{c.programName}</p>
                        <p className="text-sm">
                          {c.levelName}{" "}
                          <span className="text-muted-foreground">· دخول {c.entry_year}</span>
                        </p>
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          {c.termName}
                        </p>
                        {c.code && (
                          <p
                            dir="ltr"
                            className="break-all text-start text-[11px] text-muted-foreground"
                          >
                            {c.code}
                          </p>
                        )}
                        {!c.active && <Badge variant="outline">غير نشطة</Badge>}
                      </div>
                      <span
                        className={`w-fit rounded-md px-2 py-1 text-xs font-medium ${c.study_system === "parallel" ? "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200" : "bg-secondary text-primary"}`}
                      >
                        {COHORT_SYSTEM_LABELS[c.study_system] ?? c.study_system}
                      </span>
                      <span className="col-start-2 row-start-1 row-span-2 sm:col-auto sm:row-auto sm:row-span-1">
                        <span className="text-lg font-bold tabular-nums">
                          {c.expected_students.toLocaleString("ar")}
                        </span>
                        <span className="ms-1 text-xs sm:hidden">طالب</span>
                        <span className="block text-xs text-muted-foreground">
                          {COHORT_COUNT_LABELS[c.count_status] ?? "غير محدد"}
                        </span>
                      </span>
                      <span className="hidden items-center gap-1 text-xs font-medium text-primary sm:flex">
                        {c.id === effectiveCohortId ? "محددة" : "عرض"}
                        <ArrowDownLeft className="h-3.5 w-3.5" />
                      </span>
                    </button>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/20 px-4 py-3">
                <span className="text-xs text-muted-foreground">
                  صفحة {directoryPage.page} من {directoryPage.totalPages}
                </span>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={directoryPage.page === 1}
                    onClick={() => {
                      setPage(directoryPage.page - 1);
                      setSelectedCohortId(null);
                      setConfirmOpen(false);
                    }}
                  >
                    <ChevronRight className="h-4 w-4" />
                    السابق
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={directoryPage.page === directoryPage.totalPages}
                    onClick={() => {
                      setPage(directoryPage.page + 1);
                      setSelectedCohortId(null);
                      setConfirmOpen(false);
                    }}
                  >
                    التالي
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </Card>

            <div
              id="cohort-details"
              className="min-w-0 scroll-mt-5 space-y-4 xl:sticky xl:top-5"
              role="region"
              aria-label="تفاصيل الدفعة المختارة"
            >
              {!selected && (
                <Card className="p-8 text-center text-sm text-muted-foreground">
                  اختر دفعة من النتائج لعرض تفاصيلها.
                </Card>
              )}

              {selected && (
                <Card className="overflow-hidden border-primary/20">
                  <div className="space-y-3 border-b bg-primary/5 p-5">
                    <p className="text-xs font-semibold text-primary">الدفعة المختارة</p>
                    <h2 className="text-xl font-bold leading-relaxed">{selected.programName}</h2>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">{selected.levelName}</Badge>
                      <Badge variant="secondary">
                        {COHORT_SYSTEM_LABELS[selected.study_system] ?? selected.study_system}
                      </Badge>
                      <Badge variant="outline">{selected.active ? "نشطة" : "غير نشطة"}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{selected.termName}</p>
                  </div>
                  <dl className="grid grid-cols-2 gap-4 p-5 text-sm">
                    <div>
                      <dt className="text-muted-foreground">عدد الطلاب المسجل</dt>
                      <dd className="mt-1 flex items-center gap-2 text-2xl font-bold text-primary">
                        <Users className="h-5 w-5" />
                        {selected.expected_students.toLocaleString("ar")}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">حالة العدد</dt>
                      <dd className="mt-2 font-semibold">
                        {COHORT_COUNT_LABELS[selected.count_status] ?? "غير محدد"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">سنة الدخول</dt>
                      <dd className="mt-1 font-medium">{selected.entry_year}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-muted-foreground">رمز الدفعة</dt>
                      <dd dir="ltr" className="mt-1 break-all text-start text-xs">
                        {selected.code ?? "—"}
                      </dd>
                    </div>
                  </dl>
                  {canManage ? (
                    <div className="grid gap-2 border-t p-4">
                      <p className="text-xs leading-6 text-muted-foreground">
                        زر توليد المجموعات يجهّز المقررات تلقائيًا من خطة المستوى والفصل. زر
                        المقررات متاح لتجهيزها منفصلة.
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          generateCurriculum.isPending || generate.isPending || !selected.active
                        }
                        onClick={() => {
                          if (!effectiveCohortId) return;
                          generateCurriculum.mutate(effectiveCohortId, {
                            onSuccess: (summary) =>
                              setLastCurriculumSummary({ ...summary, cohortId: effectiveCohortId }),
                          });
                        }}
                      >
                        توليد مقررات الدفعة
                      </Button>
                      <Button
                        size="sm"
                        disabled={
                          generate.isPending ||
                          generateCurriculum.isPending ||
                          roomTypeBlocker.length > 0 ||
                          !selected.active
                        }
                        onClick={() => setConfirmOpen(true)}
                      >
                        توليد مجموعات المحاضرات والمعامل
                      </Button>
                    </div>
                  ) : (
                    <p className="border-t p-4 text-xs text-muted-foreground">
                      عرض البيانات فقط. التوليد متاح لمديري الكلية.
                    </p>
                  )}
                </Card>
              )}

              {selected &&
              (roomTypeGateError ||
                (generate.isError && generate.variables === effectiveCohortId) ||
                (generateCurriculum.isError &&
                  generateCurriculum.variables === effectiveCohortId)) ? (
                <Card
                  className="border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
                  role="alert"
                >
                  {generationErrorMessage(
                    roomTypeGateError ||
                      (generate.variables === effectiveCohortId && generate.error) ||
                      (generateCurriculum.variables === effectiveCohortId &&
                        generateCurriculum.error),
                  )}
                </Card>
              ) : null}
              {selected && roomTypeBlocker.length > 0 ? (
                <Card
                  className="border-destructive/40 bg-destructive/5 p-4 text-sm"
                  data-testid="cohort-room-type-blocker"
                >
                  <p className="font-semibold text-destructive">
                    لا يمكن توليد مجموعات المحاضرات والمعامل — أنواع قاعات مفقودة أو غير صالحة
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    أكمل رموز أنواع القاعات في استيراد الخطة الدراسية للمكوّنات المجدولة أدناه، ثم
                    أعد الاستيراد.
                  </p>
                  <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto text-xs">
                    {roomTypeBlocker.map((m) => (
                      <li key={m.componentId}>
                        {m.courseCode} ({m.courseName}) · {m.componentType} · {m.referenceState}
                      </li>
                    ))}
                  </ul>
                </Card>
              ) : null}

              {selected && (
                <Card className="overflow-hidden">
                  <div className="flex items-center justify-between border-b px-4 py-3">
                    <h3 className="text-sm font-semibold">مجموعات المحاضرات والمعامل</h3>
                    <Badge variant="secondary">{groups?.length ?? 0}</Badge>
                  </div>
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
                            <th className="px-3 py-2 text-right font-medium">المقرر</th>
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
                                <td className="px-3 py-2">{g.expected_students}</td>
                                <td className="px-3 py-2">{g.capacity_limit ?? "—"}</td>
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
              )}

              {lastCurriculumSummary?.cohortId === effectiveCohortId ? (
                <Card className="space-y-2 p-4 text-sm" data-testid="cohort-curriculum-summary">
                  <p className="font-medium">
                    تم تجهيز مقررات الدفعة من الخطة:{" "}
                    <span dir="ltr">
                      {lastCurriculumSummary.study_plan_code ?? lastCurriculumSummary.study_plan_id}
                    </span>
                  </p>
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
                    لم يُنشأ تسجيل فردي قديم أو مجموعة تشغيلية أو مجموعة محاضرات ومعامل أو جلسة.
                  </p>
                </Card>
              ) : null}

              {lastSummary?.cohortId === effectiveCohortId ? (
                <Card className="space-y-2 p-4 text-sm" data-testid="generator-summary-panel">
                  {lastSummary.curriculum && (
                    <p>
                      الخطة المستخدمة:{" "}
                      <strong dir="ltr">
                        {lastSummary.curriculum.study_plan_code ??
                          lastSummary.curriculum.study_plan_id}
                      </strong>{" "}
                      · المقررات:{" "}
                      {lastSummary.curriculum.inserted_offerings +
                        lastSummary.curriculum.skipped_existing}
                    </p>
                  )}
                  <p className="font-medium">
                    نتيجة التوليد:{" "}
                    {
                      {
                        SUCCESS: "اكتمل",
                        NO_CHANGES: "لا توجد تغييرات",
                        VALIDATION_FAILED: "يلزم تصحيح البيانات",
                        PARTIAL: "اكتمل جزئيًا",
                      }[lastSummary.status]
                    }
                  </p>
                  <p className="text-muted-foreground">
                    إنشاء {lastSummary.groups_created} · تحديث {lastSummary.groups_updated} · دون
                    تغيير {lastSummary.groups_unchanged} · متوقفة عن الاستخدام{" "}
                    {lastSummary.groups_obsolete}
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
        </>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد توليد مجموعات المحاضرات والمعامل</AlertDialogTitle>
            <AlertDialogDescription>
              سيجهّز النظام مقررات المستوى والفصل من الخطة المطابقة، ثم يولّد أو يحدّث مجموعات{" "}
              {selected?.programName}، {selected?.levelName}،{" "}
              {selected ? COHORT_SYSTEM_LABELS[selected.study_system] : ""} لهذه الدفعة فقط بشكل غير
              مدمّر (بدون حذف المجموعات المرتبطة بتكليفات أو جلسات). لن يُشغَّل المولّد على دفعات
              أخرى.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!effectiveCohortId) return;
                setConfirmOpen(false);
                generate.mutate(effectiveCohortId, {
                  onSuccess: (summary) =>
                    setLastSummary({ ...summary, cohortId: effectiveCohortId }),
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

function DirectoryFilter({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="min-w-0 space-y-1.5 text-xs font-medium text-muted-foreground">
      <span>{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
      >
        {children}
      </select>
    </label>
  );
}
