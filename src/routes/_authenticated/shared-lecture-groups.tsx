import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UsersRound } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCollege } from "@/hooks/use-colleges";
import { useCanManageActiveCollege } from "@/hooks/use-can-manage";
import { useCurrentUser } from "@/hooks/use-current-user";
import { CollegeSwitcher } from "@/components/college-switcher";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  addCohortToSharedLectureGroup,
  addComponentToSharedLectureGroup,
  addCrossCollegeCohortToSharedLectureGroup,
  createSharedLectureGroup,
  listSharedLectureGroupRevisions,
  removeCohortFromSharedLectureGroup,
  removeComponentFromSharedLectureGroup,
  removeCrossCollegeCohortFromSharedLectureGroup,
  resolveSharedLectureGroupCapacity,
  transitionSharedLectureGroupStatus,
} from "@/lib/shared-lecture-groups/api";
import {
  SHARED_GROUP_ALLOWED_TRANSITIONS,
  SHARED_GROUP_REVISION_KIND_LABELS,
  SHARED_GROUP_STATUS_LABELS,
  SHARED_GROUP_TRANSITION_ACTION_LABELS,
  sharedGroupErrorMessage,
} from "@/lib/shared-lecture-groups/rules";
import type {
  SharedGroupCapacityBreakdownRow,
  SharedGroupCohortMembership,
  SharedGroupComponentLink,
  SharedGroupCrossCollegeMembership,
  SharedGroupRevision,
  SharedGroupRpcResult,
  SharedLectureGroup,
} from "@/lib/shared-lecture-groups/types";

export const Route = createFileRoute("/_authenticated/shared-lecture-groups")({
  head: () => ({ meta: [{ title: "المجموعات المشتركة للمحاضرات" }] }),
  component: SharedLectureGroupsPage,
});

type Term = { id: string; name: string };
type Cohort = {
  id: string;
  code: string | null;
  term_id: string;
  study_system: string;
  college_id: string;
};
type PlanCourseComponent = {
  id: string;
  plan_course_id: string;
  component_type: string;
  weekly_contact_hours: number | null;
};
type PlanCourse = { id: string; course_id: string };
type Course = { id: string; code: string; name: string };

const STUDY_SYSTEM_LABELS: Record<string, string> = {
  regular: "منتظم",
  parallel: "موازي",
  evening: "مسائي",
  distance: "عن بعد",
};

const COMPONENT_TYPE_LABELS: Record<string, string> = {
  theory: "نظري",
  practical: "عملي",
  tutorial: "تمارين",
  project: "مشروع",
  summer_training: "تدريب صيفي",
};

interface SourceOnlyResult {
  data: unknown;
  error: { message: string } | null;
}

/**
 * The shared_lecture_group* tables are SOURCE ONLY — NOT APPLIED and therefore
 * absent from the generated Database types (which this change must not
 * hand-edit). Reads go through this narrow SELECT-only facade; every write is
 * RPC-only via @/lib/shared-lecture-groups/api (direct DML is revoked by the
 * A2.1/A2.2 migrations anyway).
 */
interface SourceOnlySelectBuilder extends PromiseLike<SourceOnlyResult> {
  select(columns: string): SourceOnlySelectBuilder;
  eq(column: string, value: string): SourceOnlySelectBuilder;
  order(column: string, options?: { ascending?: boolean }): SourceOnlySelectBuilder;
  in(column: string, values: readonly string[]): SourceOnlySelectBuilder;
}

const fromSourceOnly = supabase.from.bind(supabase) as unknown as (
  table: string,
) => SourceOnlySelectBuilder;

function SharedLectureGroupsPage() {
  const { active, colleges } = useActiveCollege();
  const canManage = useCanManageActiveCollege();
  const { data: me } = useCurrentUser();
  const isSuperAdmin = Boolean(me?.isSuperAdmin);
  const queryClient = useQueryClient();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [componentPick, setComponentPick] = useState("");
  const [cohortPick, setCohortPick] = useState("");
  const [crossCohortPick, setCrossCohortPick] = useState("");
  const [capacityResult, setCapacityResult] = useState<SharedGroupRpcResult<{
    capacity: number;
    breakdown: SharedGroupCapacityBreakdownRow[];
  }> | null>(null);
  const [capacityError, setCapacityError] = useState<string | null>(null);
  const [showRevisions, setShowRevisions] = useState(false);

  const { data: terms = [] } = useQuery({
    queryKey: ["shared-group-terms", active?.id],
    enabled: Boolean(active),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("academic_terms")
        .select("id, name")
        .eq("college_id", active!.id);
      if (error) throw error;
      return data as Term[];
    },
  });

  const {
    data: groups = [],
    isLoading: groupsLoading,
    isError: groupsError,
  } = useQuery({
    queryKey: ["shared-lecture-groups", active?.id],
    enabled: Boolean(active),
    queryFn: async () => {
      const { data, error } = await fromSourceOnly("shared_lecture_groups")
        .select("id, college_id, term_id, name, status, notes, created_at, updated_at")
        .eq("college_id", active!.id)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as SharedLectureGroup[];
    },
  });

  const { data: cohorts = [] } = useQuery({
    queryKey: ["shared-group-cohorts", active?.id],
    enabled: Boolean(active),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("academic_cohorts")
        .select("id, code, term_id, study_system, college_id")
        .eq("college_id", active!.id);
      if (error) throw error;
      return data as Cohort[];
    },
  });

  // Component picker data: 3-step client-side join (no PostgREST embeds, so no
  // dependency on unverified FK metadata).
  const { data: planComponents = [] } = useQuery({
    queryKey: ["shared-group-plan-components", active?.id],
    enabled: Boolean(active),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plan_course_components")
        .select("id, plan_course_id, component_type, weekly_contact_hours")
        .eq("college_id", active!.id);
      if (error) throw error;
      return data as PlanCourseComponent[];
    },
  });
  const { data: planCourses = [] } = useQuery({
    queryKey: ["shared-group-plan-courses", active?.id],
    enabled: Boolean(active) && planComponents.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plan_courses")
        .select("id, course_id")
        .eq("college_id", active!.id);
      if (error) throw error;
      return data as PlanCourse[];
    },
  });
  const { data: courses = [] } = useQuery({
    queryKey: ["shared-group-courses", active?.id],
    enabled: Boolean(active) && planCourses.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("courses")
        .select("id, code, name")
        .eq("college_id", active!.id);
      if (error) throw error;
      return data as Course[];
    },
  });

  const selected = groups.find((group) => group.id === selectedId) ?? null;

  const { data: componentLinks = [], isError: componentLinksError } = useQuery({
    queryKey: ["shared-group-components", selectedId],
    enabled: Boolean(selectedId),
    queryFn: async () => {
      const { data, error } = await fromSourceOnly("shared_lecture_group_components")
        .select("id, college_id, group_id, plan_course_component_id, created_at")
        .eq("group_id", selectedId!);
      if (error) throw new Error(error.message);
      return (data ?? []) as SharedGroupComponentLink[];
    },
  });

  const { data: memberships = [] } = useQuery({
    queryKey: ["shared-group-cohort-members", selectedId],
    enabled: Boolean(selectedId),
    queryFn: async () => {
      const { data, error } = await fromSourceOnly("shared_lecture_group_cohorts")
        .select("id, college_id, group_id, cohort_id, created_at")
        .eq("group_id", selectedId!);
      if (error) throw new Error(error.message);
      return (data ?? []) as SharedGroupCohortMembership[];
    },
  });

  const { data: crossMemberships = [] } = useQuery({
    queryKey: ["shared-group-cross-cohort-members", selectedId],
    enabled: Boolean(selectedId),
    queryFn: async () => {
      const { data, error } = await fromSourceOnly("shared_lecture_group_cross_college_cohorts")
        .select("id, college_id, group_id, cohort_id, cohort_college_id, created_at")
        .eq("group_id", selectedId!);
      if (error) throw new Error(error.message);
      return (data ?? []) as SharedGroupCrossCollegeMembership[];
    },
  });

  // super_admin-only cross-college candidate list: cohorts from OTHER colleges
  // that still reference the group's term (A2.2 COHORT_TERM_MISMATCH applies).
  const { data: allCohorts = [] } = useQuery({
    queryKey: ["shared-group-all-cohorts"],
    enabled: isSuperAdmin && Boolean(selectedId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("academic_cohorts")
        .select("id, code, term_id, study_system, college_id");
      if (error) throw error;
      return data as Cohort[];
    },
  });

  const { data: revisionsData } = useQuery({
    queryKey: ["shared-group-revisions", selectedId],
    enabled: Boolean(selectedId) && showRevisions,
    queryFn: async () => listSharedLectureGroupRevisions(selectedId!),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["shared-lecture-groups", active?.id] });
    void queryClient.invalidateQueries({ queryKey: ["shared-group-components", selectedId] });
    void queryClient.invalidateQueries({ queryKey: ["shared-group-cohort-members", selectedId] });
    void queryClient.invalidateQueries({
      queryKey: ["shared-group-cross-cohort-members", selectedId],
    });
    void queryClient.invalidateQueries({ queryKey: ["shared-group-revisions", selectedId] });
    setCapacityResult(null);
    setCapacityError(null);
  };

  const rpcTransportError = (error: Error) =>
    toast.error(`تعذر التنفيذ — طبقة RPCs غير مطبقة بعد (NOT APPLIED) أو خطأ آخر: ${error.message}`);

  const handleRpcResult = (
    result: SharedGroupRpcResult,
    successMessage: string,
  ): boolean => {
    if (!result.ok) {
      toast.error(sharedGroupErrorMessage(result));
      return false;
    }
    toast.success(successMessage);
    refresh();
    return true;
  };

  const createMutation = useMutation({
    mutationFn: createSharedLectureGroup,
    onSuccess: (result) => {
      if (handleRpcResult(result, "تم إنشاء المجموعة المشتركة كمسودة.")) setCreating(false);
    },
    onError: rpcTransportError,
  });
  const addComponentMutation = useMutation({
    mutationFn: addComponentToSharedLectureGroup,
    onSuccess: (result) => {
      if (handleRpcResult(result, "تم ربط المكوّن بالمجموعة.")) setComponentPick("");
    },
    onError: rpcTransportError,
  });
  const removeComponentMutation = useMutation({
    mutationFn: removeComponentFromSharedLectureGroup,
    onSuccess: (result) => handleRpcResult(result, "تمت إزالة ربط المكوّن."),
    onError: rpcTransportError,
  });
  const addCohortMutation = useMutation({
    mutationFn: addCohortToSharedLectureGroup,
    onSuccess: (result) => {
      if (handleRpcResult(result, "تمت إضافة الدفعة إلى المجموعة.")) setCohortPick("");
    },
    onError: rpcTransportError,
  });
  const removeCohortMutation = useMutation({
    mutationFn: removeCohortFromSharedLectureGroup,
    onSuccess: (result) => handleRpcResult(result, "تمت إزالة الدفعة من المجموعة."),
    onError: rpcTransportError,
  });
  const addCrossCohortMutation = useMutation({
    mutationFn: addCrossCollegeCohortToSharedLectureGroup,
    onSuccess: (result) => {
      if (handleRpcResult(result, "تمت إضافة الدفعة عبر الكليات.")) setCrossCohortPick("");
    },
    onError: rpcTransportError,
  });
  const removeCrossCohortMutation = useMutation({
    mutationFn: removeCrossCollegeCohortFromSharedLectureGroup,
    onSuccess: (result) => handleRpcResult(result, "تمت إزالة الدفعة عبر الكليات."),
    onError: rpcTransportError,
  });
  const transitionMutation = useMutation({
    mutationFn: transitionSharedLectureGroupStatus,
    onSuccess: (result) => {
      if (result.ok && result.code === "NOOP") return;
      handleRpcResult(result, "تم تحديث حالة المجموعة.");
    },
    onError: rpcTransportError,
  });

  const runCapacity = async () => {
    if (!selected) return;
    setCapacityError(null);
    setCapacityResult(null);
    try {
      const result = await resolveSharedLectureGroupCapacity(selected.id);
      setCapacityResult(result);
    } catch (error) {
      setCapacityError(
        `تعذر حساب السعة — طبقة RPCs غير مطبقة بعد (NOT APPLIED) أو خطأ آخر: ${(error as Error).message}`,
      );
    }
  };

  const termName = new Map(terms.map((term) => [term.id, term.name]));
  const collegeName = new Map(colleges.map((college) => [college.id, college.name]));
  const cohortLabel = new Map(
    cohorts.map((cohort) => [cohort.id, cohort.code ?? cohort.id.slice(0, 8)]),
  );
  const allCohortLabel = new Map(
    allCohorts.map((cohort) => [cohort.id, cohort.code ?? cohort.id.slice(0, 8)]),
  );
  const planCourseById = new Map(planCourses.map((row) => [row.id, row.course_id]));
  const courseById = new Map(courses.map((course) => [course.id, course]));
  const componentLabel = (componentId: string): string => {
    const component = planComponents.find((row) => row.id === componentId);
    if (!component) return componentId.slice(0, 8);
    const course = courseById.get(planCourseById.get(component.plan_course_id) ?? "");
    const type = COMPONENT_TYPE_LABELS[component.component_type] ?? component.component_type;
    return course ? `${course.code} — ${course.name} (${type})` : `${type} · ${componentId.slice(0, 8)}`;
  };

  const linkedComponentIds = new Set(componentLinks.map((link) => link.plan_course_component_id));
  const memberCohortIds = new Set(memberships.map((member) => member.cohort_id));
  const crossMemberCohortIds = new Set(crossMemberships.map((member) => member.cohort_id));
  const membershipCohorts = memberships
    .map((member) => cohorts.find((cohort) => cohort.id === member.cohort_id))
    .filter((cohort): cohort is Cohort => Boolean(cohort));
  const groupStudySystem = membershipCohorts[0]?.study_system ?? null;
  const cohortCandidates = selected
    ? cohorts.filter(
        (cohort) =>
          cohort.term_id === selected.term_id &&
          !memberCohortIds.has(cohort.id) &&
          !crossMemberCohortIds.has(cohort.id),
      )
    : [];
  const crossCohortCandidates = selected
    ? allCohorts.filter(
        (cohort) =>
          cohort.college_id !== selected.college_id &&
          cohort.term_id === selected.term_id &&
          !crossMemberCohortIds.has(cohort.id) &&
          !memberCohortIds.has(cohort.id),
      )
    : [];

  const busy =
    createMutation.isPending ||
    addComponentMutation.isPending ||
    removeComponentMutation.isPending ||
    addCohortMutation.isPending ||
    removeCohortMutation.isPending ||
    addCrossCohortMutation.isPending ||
    removeCrossCohortMutation.isPending ||
    transitionMutation.isPending;

  const membershipEditable = selected?.status === "draft" || selected?.status === "active";

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-secondary text-primary">
          <UsersRound className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-bold">المجموعات المشتركة للمحاضرات</h1>
          <p className="text-sm text-muted-foreground">
            ربط عدة دفعات دراسية بمكوّن مقرر واحد لخدمتها بمحاضرة مشتركة، مع بقاء مقرر كل دفعة
            مستقلًا (لا دمج أكاديمي).
          </p>
        </div>
      </header>

      <Card className="border-amber-500/40 bg-amber-50 p-4 text-sm dark:bg-amber-950/20">
        طبقة الجداول وRPCs الخاصة بالمجموعات المشتركة للمحاضرات (A2.1/A2.2) مصدرية فقط (SOURCE
        ONLY — NOT APPLIED) ولن تعمل القراءة أو الكتابة حتى اعتماد الترحيلات وتطبيقها
        (APPROVE_DB_MIGRATION_APPLY) — مانع جاهزية موثق. السعة تُحسب فشلًا مغلقًا من أعداد
        الدفعات المعتمدة للجدولة فقط ولا تُخمَّن أبدًا.
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <CollegeSwitcher />
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/delivery-groups">مجموعات المحاضرات والمعامل</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/scheduling-headcounts">أعداد الدفعات المعتمدة للجدولة</Link>
          </Button>
          {canManage && <Button onClick={() => setCreating(true)}>إنشاء مجموعة مشتركة</Button>}
        </div>
      </div>

      {!canManage && (
        <p className="text-xs text-muted-foreground">
          وضع قراءة فقط — تظهر أدوات الكتابة لمدير الكلية فقط، والإنفاذ في RPC/RLS.
        </p>
      )}

      {creating && active && (
        <CreateGroupForm
          terms={terms}
          busy={createMutation.isPending}
          onCancel={() => setCreating(false)}
          onSave={(input) =>
            createMutation.mutate({ collegeId: active.id, termId: input.termId, name: input.name, notes: input.notes })
          }
        />
      )}

      {!active ? (
        <p className="text-sm text-muted-foreground">اختر كلية.</p>
      ) : groupsLoading ? (
        <p className="text-sm text-muted-foreground">جاري التحميل…</p>
      ) : groupsError ? (
        <Card className="border-amber-500/40 bg-amber-50 p-4 text-sm dark:bg-amber-950/20">
          تعذر جلب المجموعات — الجداول غير مطبقة بعد (NOT APPLIED) بانتظار
          APPROVE_DB_MIGRATION_APPLY.
        </Card>
      ) : groups.length === 0 ? (
        <Card className="border-dashed p-6 text-sm text-muted-foreground">
          لا توجد مجموعات مشتركة للمحاضرات في هذه الكلية بعد.
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-right">الاسم</th>
                <th className="px-3 py-2 text-right">الفصل</th>
                <th className="px-3 py-2 text-right">الحالة</th>
                <th className="px-3 py-2 text-right">ملاحظات</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr key={group.id} className="border-t">
                  <td className="px-3 py-2 font-medium">{group.name}</td>
                  <td className="px-3 py-2">{termName.get(group.term_id) ?? "—"}</td>
                  <td className="px-3 py-2">{SHARED_GROUP_STATUS_LABELS[group.status]}</td>
                  <td className="px-3 py-2">{group.notes ?? "—"}</td>
                  <td className="px-3 py-2">
                    <Button
                      size="sm"
                      variant={selectedId === group.id ? "default" : "outline"}
                      onClick={() => {
                        setSelectedId(selectedId === group.id ? null : group.id);
                        setCapacityResult(null);
                        setCapacityError(null);
                        setShowRevisions(false);
                      }}
                    >
                      التفاصيل
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {selected && (
        <div className="space-y-4">
          <Card className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">
                {selected.name} — {SHARED_GROUP_STATUS_LABELS[selected.status]}
              </h2>
              {canManage &&
                SHARED_GROUP_ALLOWED_TRANSITIONS[selected.status].map((target) => (
                  <Button
                    key={target}
                    size="sm"
                    variant={target === "archived" ? "outline" : "default"}
                    disabled={busy}
                    onClick={() =>
                      transitionMutation.mutate({ groupId: selected.id, targetStatus: target })
                    }
                  >
                    {SHARED_GROUP_TRANSITION_ACTION_LABELS[target]}
                  </Button>
                ))}
            </div>
            {selected.status === "draft" && (
              <p className="text-xs text-muted-foreground">
                التفعيل فشل مغلق: يلزم مكوّن واحد على الأقل ودفعة مشاركة واحدة على الأقل وعدد
                معتمد ضمن أعداد الدفعات المعتمدة للجدولة لكل دفعة مشاركة.
              </p>
            )}
            {(selected.status === "locked" || selected.status === "archived") && (
              <p className="text-xs text-muted-foreground">
                المجموعة {SHARED_GROUP_STATUS_LABELS[selected.status]} — كل تعديلات المكوّنات
                والدفعات مرفوضة (GROUP_LOCKED / GROUP_ARCHIVED).
              </p>
            )}
          </Card>

          <Card className="space-y-3 p-4">
            <h2 className="font-semibold">مكوّنات المقرر المرتبطة</h2>
            <p className="text-xs text-muted-foreground">
              الربط على مستوى مكوّن المقرر (plan_course_components): تُدمج المكوّنات النظرية بين
              الدفعات وتبقى مكوّنات المعامل منفصلة.
            </p>
            {componentLinksError ? (
              <p className="text-sm text-muted-foreground">
                تعذر جلب المكوّنات — الجداول غير مطبقة بعد (NOT APPLIED).
              </p>
            ) : componentLinks.length === 0 ? (
              <p className="text-sm text-muted-foreground">لا توجد مكوّنات مرتبطة بعد.</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {componentLinks.map((link) => (
                  <li key={link.id} className="flex items-center justify-between py-2">
                    <span>{componentLabel(link.plan_course_component_id)}</span>
                    {canManage && selected.status === "draft" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() =>
                          removeComponentMutation.mutate({
                            groupId: selected.id,
                            planCourseComponentId: link.plan_course_component_id,
                          })
                        }
                      >
                        إزالة
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {selected.status !== "draft" && componentLinks.length > 0 && (
              <p className="text-xs text-muted-foreground">
                إزالة المكوّنات متاحة في المسودة فقط؛ وأي جلسة مجدولة تشير إلى المكوّن تمنع
                الإزالة في كل الحالات (SHARED_GROUP_COMPONENT_IN_USE).
              </p>
            )}
            {canManage && membershipEditable && (
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="min-w-72 rounded border p-2"
                  value={componentPick}
                  onChange={(event) => setComponentPick(event.target.value)}
                  aria-label="مكوّن المقرر"
                >
                  <option value="">اختر مكوّن مقرر…</option>
                  {planComponents
                    .filter((component) => !linkedComponentIds.has(component.id))
                    .map((component) => (
                      <option key={component.id} value={component.id}>
                        {componentLabel(component.id)}
                      </option>
                    ))}
                </select>
                <Button
                  size="sm"
                  disabled={busy || !componentPick}
                  onClick={() =>
                    addComponentMutation.mutate({
                      groupId: selected.id,
                      planCourseComponentId: componentPick,
                    })
                  }
                >
                  ربط المكوّن
                </Button>
              </div>
            )}
          </Card>

          <Card className="space-y-3 p-4">
            <h2 className="font-semibold">الدفعات الدراسية المشاركة</h2>
            {groupStudySystem && (
              <p className="text-xs text-muted-foreground">
                نظام الدراسة للمجموعة: {STUDY_SYSTEM_LABELS[groupStudySystem] ?? groupStudySystem}{" "}
                — لا تُدمج الدفعات ذات الأنظمة المختلفة (منتظم/موازي) افتراضيًا
                (STUDY_SYSTEM_MIX_REJECTED).
              </p>
            )}
            {memberships.length === 0 ? (
              <p className="text-sm text-muted-foreground">لا توجد دفعات مشاركة بعد.</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {memberships.map((member) => {
                  const cohort = cohorts.find((row) => row.id === member.cohort_id);
                  return (
                    <li key={member.id} className="flex items-center justify-between py-2">
                      <span>
                        {cohortLabel.get(member.cohort_id) ?? member.cohort_id.slice(0, 8)}
                        {cohort
                          ? ` · ${STUDY_SYSTEM_LABELS[cohort.study_system] ?? cohort.study_system}`
                          : ""}
                      </span>
                      {canManage && membershipEditable && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            removeCohortMutation.mutate({
                              groupId: selected.id,
                              cohortId: member.cohort_id,
                            })
                          }
                        >
                          إزالة
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {canManage && membershipEditable && (
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="min-w-72 rounded border p-2"
                  value={cohortPick}
                  onChange={(event) => setCohortPick(event.target.value)}
                  aria-label="الدفعة الدراسية"
                >
                  <option value="">اختر دفعة من نفس الفصل…</option>
                  {cohortCandidates.map((cohort) => (
                    <option key={cohort.id} value={cohort.id}>
                      {cohort.code ?? cohort.id.slice(0, 8)} ·{" "}
                      {STUDY_SYSTEM_LABELS[cohort.study_system] ?? cohort.study_system}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  disabled={busy || !cohortPick}
                  onClick={() =>
                    addCohortMutation.mutate({ groupId: selected.id, cohortId: cohortPick })
                  }
                >
                  إضافة الدفعة
                </Button>
              </div>
            )}
          </Card>

          {isSuperAdmin && (
            <Card className="space-y-3 p-4">
              <h2 className="font-semibold">دفعات عبر الكليات (مدير المؤسسة فقط)</h2>
              <p className="text-xs text-muted-foreground">
                مسار super_admin الحصري (A2.2) — قرار مؤسسي مدقق في سجل الكليتين، ولا يظهر لغير
                مدير المؤسسة.
              </p>
              {crossMemberships.length === 0 ? (
                <p className="text-sm text-muted-foreground">لا توجد دفعات عبر الكليات.</p>
              ) : (
                <ul className="divide-y divide-border text-sm">
                  {crossMemberships.map((member) => (
                    <li key={member.id} className="flex items-center justify-between py-2">
                      <span>
                        {allCohortLabel.get(member.cohort_id) ?? member.cohort_id.slice(0, 8)} ·
                        كلية: {collegeName.get(member.cohort_college_id) ?? member.cohort_college_id.slice(0, 8)}
                      </span>
                      {membershipEditable && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            removeCrossCohortMutation.mutate({
                              groupId: selected.id,
                              cohortId: member.cohort_id,
                            })
                          }
                        >
                          إزالة
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {membershipEditable && (
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    className="min-w-72 rounded border p-2"
                    value={crossCohortPick}
                    onChange={(event) => setCrossCohortPick(event.target.value)}
                    aria-label="دفعة من كلية أخرى"
                  >
                    <option value="">اختر دفعة من كلية أخرى (نفس الفصل)…</option>
                    {crossCohortCandidates.map((cohort) => (
                      <option key={cohort.id} value={cohort.id}>
                        {cohort.code ?? cohort.id.slice(0, 8)} ·{" "}
                        {collegeName.get(cohort.college_id) ?? cohort.college_id.slice(0, 8)} ·{" "}
                        {STUDY_SYSTEM_LABELS[cohort.study_system] ?? cohort.study_system}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    disabled={busy || !crossCohortPick}
                    onClick={() =>
                      addCrossCohortMutation.mutate({
                        groupId: selected.id,
                        cohortId: crossCohortPick,
                      })
                    }
                  >
                    إضافة عبر الكليات
                  </Button>
                </div>
              )}
            </Card>
          )}

          <Card className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">سعة المجموعة</h2>
              <Button size="sm" variant="outline" onClick={() => void runCapacity()}>
                حساب السعة
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              السعة = مجموع أعداد الدفعات المعتمدة للجدولة للدفعات المشاركة فقط (فشل مغلق)؛ غياب
              أي عدد معتمد يجعل الحالة blocked ولا يُعرض أي رقم مُخمَّن.
            </p>
            {capacityError && (
              <p className="rounded border border-amber-500/40 bg-amber-50 p-2 text-sm dark:bg-amber-950/20">
                {capacityError}
              </p>
            )}
            {capacityResult &&
              (capacityResult.ok ? (
                <div className="space-y-2 text-sm">
                  <p>
                    السعة المحسوبة: <strong>{capacityResult.capacity}</strong>
                  </p>
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-right">الدفعة</th>
                        <th className="px-3 py-2 text-right">نوع العضوية</th>
                        <th className="px-3 py-2 text-right">العدد المعتمد للجدولة</th>
                        <th className="px-3 py-2 text-right">هامش الاحتياط</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(capacityResult.breakdown ?? []).map((row) => (
                        <tr key={`${row.cohort_id}-${row.headcount_id}`} className="border-t">
                          <td className="px-3 py-2">
                            {cohortLabel.get(row.cohort_id) ??
                              allCohortLabel.get(row.cohort_id) ??
                              row.cohort_id.slice(0, 8)}
                          </td>
                          <td className="px-3 py-2">
                            {row.membership_kind === "cross_college" ? "عبر الكليات" : "نفس الكلية"}
                          </td>
                          <td className="px-3 py-2">{row.scheduling_headcount}</td>
                          <td className="px-3 py-2">{row.reserve_margin ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="rounded border border-amber-500/40 bg-amber-50 p-2 text-sm dark:bg-amber-950/20">
                  حالة blocked: {sharedGroupErrorMessage(capacityResult)}
                  {capacityResult.missing_cohorts
                    ? ` — دفعات بلا عدد معتمد: ${capacityResult.missing_cohorts.length}`
                    : ""}
                </p>
              ))}
          </Card>

          <Card className="space-y-2 p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">المراجعات</h2>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowRevisions((value) => !value)}
              >
                {showRevisions ? "إخفاء" : "عرض المراجعات"}
              </Button>
            </div>
            {showRevisions &&
              (revisionsData?.ok ? (
                (revisionsData.revisions ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">لا توجد مراجعات بعد.</p>
                ) : (
                  (revisionsData.revisions ?? []).map((revision: SharedGroupRevision) => (
                    <p key={revision.id} className="text-sm">
                      {SHARED_GROUP_REVISION_KIND_LABELS[revision.revision_kind] ??
                        revision.revision_kind}{" "}
                      · {new Date(revision.changed_at).toLocaleString()} · {revision.notes ?? "—"}
                    </p>
                  ))
                )
              ) : (
                <p className="text-sm text-muted-foreground">
                  {revisionsData && !revisionsData.ok
                    ? sharedGroupErrorMessage(revisionsData)
                    : "جاري التحميل… أو طبقة RPCs غير مطبقة بعد."}
                </p>
              ))}
          </Card>
        </div>
      )}
    </div>
  );
}

function CreateGroupForm({
  terms,
  busy,
  onCancel,
  onSave,
}: {
  terms: Term[];
  busy: boolean;
  onCancel: () => void;
  onSave: (input: { termId: string; name: string; notes: string | null }) => void;
}) {
  const [termId, setTermId] = useState("");
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  return (
    <Card className="space-y-3 p-4">
      <h2 className="font-semibold">إنشاء مجموعة مشتركة للمحاضرات</h2>
      <div className="grid gap-2 md:grid-cols-2">
        <select
          className="rounded border p-2"
          value={termId}
          onChange={(event) => setTermId(event.target.value)}
          aria-label="الفصل الدراسي"
        >
          <option value="">اختر الفصل الدراسي…</option>
          {terms.map((term) => (
            <option key={term.id} value={term.id}>
              {term.name}
            </option>
          ))}
        </select>
        <input
          className="rounded border p-2"
          placeholder="اسم المجموعة"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <textarea
        className="w-full rounded border p-2"
        placeholder="ملاحظات (اختياري)"
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
      />
      <div className="flex gap-2">
        <Button
          disabled={busy || !termId || !name.trim()}
          onClick={() => onSave({ termId, name: name.trim(), notes: notes.trim() || null })}
        >
          إنشاء
        </Button>
        <Button variant="outline" onClick={onCancel}>
          إلغاء
        </Button>
      </div>
    </Card>
  );
}
