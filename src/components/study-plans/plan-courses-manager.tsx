/**
 * SOURCE_ONLY_PLAN_COURSE_COMPONENTS_UI_E2E_FIX_01
 * Manage plan_courses + plan_course_components for one study plan (RTL, mobile friendly).
 * Reads/writes only via the authenticated Supabase client (RLS applies).
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Layers, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/lib/audit";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  buildComponentInsert,
  buildComponentUpdate,
  buildLevelInsert,
  buildPlanCourseInsert,
  buildPlanCourseUpdate,
  componentUpdateScope,
  planCourseUpdateScope,

  COMPENSATION_MODES,
  COMPENSATION_MODE_LABEL_AR,
  COMPONENT_TYPE_LABEL_AR,
  deriveComponentInsertsFromCourse,
  PLAN_COMPONENT_TYPES,
  PLAN_COURSE_READINESS_QUERY_KEYS,
  planCourseDeleteSteps,
  validateComponentForm,
  validateLevelForm,
  validatePlanCourseForm,
  type ComponentForm,
  type CourseOption,
  type ExistingPlanCourse,
  type LevelOption,
  type PlanContext,
  type PlanCourseForm,
  type RoomTypeOption,
} from "@/lib/academic-delivery/plan-course-editor";
import type { ComponentType } from "@/lib/academic-delivery/plan-course-components";

interface PlanComponentRow {
  id: string;
  plan_course_id: string;
  component_type: string;
  weekly_contact_hours: number;
  required_room_type_id: string | null;
  is_timetabled: boolean;
  counts_toward_regular_load: boolean;
  counts_toward_overtime: boolean;
  compensation_mode: string;
  explicit_group_size: number | null;
}

const EMPTY_COMPONENT: ComponentForm = {
  component_type: "theory",
  weekly_contact_hours: 2,
  required_room_type_id: null,
  is_timetabled: true,
  counts_toward_regular_load: true,
  counts_toward_overtime: true,
  compensation_mode: "per_hour",
  explicit_group_size: null,
};

const NONE = "__none__";

export function PlanCoursesManager({
  plan,
  programId,
  programDurationYears,
  collegeId,
  canManage,
}: {
  plan: { id: string; name: string };
  programId: string;
  programDurationYears: number;
  collegeId: string;
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const ctx: PlanContext = { collegeId, studyPlanId: plan.id, programId };

  const [form, setForm] = useState<PlanCourseForm>({
    course_id: "",
    level_id: "",
    semester: 1,
    is_required: true,
  });
  const [levelForm, setLevelForm] = useState({ name: "", level_number: 1 });
  const [componentTarget, setComponentTarget] = useState<{
    planCourseId: string;
    componentId: string | null;
  } | null>(null);
  const [componentForm, setComponentForm] = useState<ComponentForm>(EMPTY_COMPONENT);
  const [editRow, setEditRow] = useState<{
    id: string;
    level_id: string;
    semester: number;
    is_required: boolean;
  } | null>(null);


  const { data: courses } = useQuery({
    queryKey: ["plan-editor-courses", collegeId],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("courses")
        .select("id, code, name, college_id, theory_hours, practical_hours, credit_hours")
        .eq("college_id", collegeId)
        .order("code");
      if (error) throw error;
      return (data ?? []) as CourseOption[];
    },
  });

  const { data: levels } = useQuery({
    queryKey: ["plan-editor-levels", collegeId, programId],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("academic_levels")
        .select("id, name, level_number, program_id, college_id")
        .eq("college_id", collegeId)
        .eq("program_id", programId)
        .order("level_number");
      if (error) throw error;
      return (data ?? []) as LevelOption[];
    },
  });

  const { data: roomTypes } = useQuery({
    queryKey: ["plan-editor-room-types", collegeId],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("room_types")
        .select("id, name_ar, college_id, is_active")
        .eq("college_id", collegeId)
        .order("display_order");
      if (error) throw error;
      return (data ?? []) as RoomTypeOption[];
    },
  });

  const { data: planCourses, isLoading } = useQuery({
    queryKey: ["plan-courses", collegeId, plan.id],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plan_courses")
        .select("id, course_id, level_id, semester, is_required, study_plan_id, college_id")
        .eq("college_id", collegeId)
        .eq("study_plan_id", plan.id)
        .order("semester");
      if (error) throw error;
      return (data ?? []) as (ExistingPlanCourse & { is_required: boolean })[];
    },
  });

  const planCourseIds = useMemo(() => (planCourses ?? []).map((p) => p.id), [planCourses]);

  const { data: components } = useQuery({
    queryKey: ["plan-course-components", collegeId, plan.id, planCourseIds.join(",")],
    enabled: open && planCourseIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plan_course_components")
        .select(
          "id, plan_course_id, component_type, weekly_contact_hours, required_room_type_id, is_timetabled, counts_toward_regular_load, counts_toward_overtime, compensation_mode, explicit_group_size",
        )
        .eq("college_id", collegeId)
        .in("plan_course_id", planCourseIds);
      if (error) throw error;
      return (data ?? []) as PlanComponentRow[];
    },
  });

  const invalidate = () => {
    for (const key of PLAN_COURSE_READINESS_QUERY_KEYS) {
      qc.invalidateQueries({ queryKey: [key] });
    }
  };

  const courseMap = useMemo(() => new Map((courses ?? []).map((c) => [c.id, c])), [courses]);
  const levelMap = useMemo(() => new Map((levels ?? []).map((l) => [l.id, l])), [levels]);
  const roomTypeMap = useMemo(() => new Map((roomTypes ?? []).map((r) => [r.id, r])), [roomTypes]);
  const componentsByPlanCourse = useMemo(() => {
    const map = new Map<string, PlanComponentRow[]>();
    for (const c of components ?? []) {
      const list = map.get(c.plan_course_id) ?? [];
      list.push(c);
      map.set(c.plan_course_id, list);
    }
    return map;
  }, [components]);

  const addLevel = useMutation({
    mutationFn: async () => {
      const check = validateLevelForm({
        form: levelForm,
        durationYears: programDurationYears,
        existing: levels ?? [],
      });
      if (!check.ok) throw new Error(check.messageAr);
      const { error } = await supabase
        .from("academic_levels")
        .insert(buildLevelInsert(ctx, levelForm));
      if (error) throw error;
      await logAudit({ action: "create", entity: "academic_levels", collegeId });
    },
    onSuccess: () => {
      toast.success("تمت إضافة المستوى");
      setLevelForm({ name: "", level_number: 1 });
      qc.invalidateQueries({ queryKey: ["plan-editor-levels", collegeId, programId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addPlanCourse = useMutation({
    mutationFn: async () => {
      const check = validatePlanCourseForm({
        ctx,
        form,
        courses: courses ?? [],
        levels: levels ?? [],
        existing: planCourses ?? [],
      });
      if (!check.ok) throw new Error(check.messageAr);
      const { data, error } = await supabase
        .from("plan_courses")
        .insert(buildPlanCourseInsert(ctx, form))
        .select("id")
        .single();
      if (error) throw error;
      await logAudit({ action: "create", entity: "plan_courses", entityId: data?.id, collegeId });
    },
    onSuccess: () => {
      toast.success("تمت إضافة المقرر إلى الخطة");
      setForm({ course_id: "", level_id: "", semester: 1, is_required: true });
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleRequired = useMutation({
    mutationFn: async (row: { id: string; is_required: boolean }) => {
      const { error } = await supabase
        .from("plan_courses")
        .update({ is_required: !row.is_required })
        .eq("id", row.id)
        .eq("college_id", collegeId);
      if (error) throw error;
      await logAudit({ action: "update", entity: "plan_courses", entityId: row.id, collegeId });
    },
    onSuccess: () => {
      toast.success("تم التحديث");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deletePlanCourse = useMutation({
    mutationFn: async (planCourseId: string) => {
      const componentIds = (componentsByPlanCourse.get(planCourseId) ?? []).map((c) => c.id);
      const steps = planCourseDeleteSteps({ collegeId, planCourseId, componentIds });
      for (const step of steps) {
        if (step.table === "plan_course_components") {
          const { error } = await supabase
            .from("plan_course_components")
            .delete()
            .in("id", step.ids)
            .eq("college_id", step.collegeId);
          if (error) throw error;
        } else {
          const { error } = await supabase
            .from("plan_courses")
            .delete()
            .eq("id", step.id)
            .eq("college_id", step.collegeId);
          if (error) throw error;
        }
      }
      await logAudit({
        action: "delete",
        entity: "plan_courses",
        entityId: planCourseId,
        collegeId,
      });
    },
    onSuccess: () => {
      toast.success("تم الحذف");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const generateComponents = useMutation({
    mutationFn: async (planCourseId: string) => {
      const row = (planCourses ?? []).find((p) => p.id === planCourseId);
      const course = row ? courseMap.get(row.course_id) : undefined;
      if (!course) throw new Error("المقرر غير متاح في هذه الكلية.");
      const rows = deriveComponentInsertsFromCourse(ctx, planCourseId, course);
      if (rows.length === 0) {
        throw new Error("لا توجد ساعات نظرية أو عملية معرّفة للمقرر.");
      }
      const existing = new Set(
        (componentsByPlanCourse.get(planCourseId) ?? []).map((c) => c.component_type),
      );
      const toInsert = rows.filter((r) => !existing.has(r.component_type));
      if (toInsert.length === 0) throw new Error("المكوّنات المشتقة موجودة مسبقاً.");
      const { error } = await supabase.from("plan_course_components").insert(toInsert);
      if (error) throw error;
      await logAudit({ action: "create", entity: "plan_course_components", collegeId });
    },
    onSuccess: () => {
      toast.success("تم توليد المكوّنات من ساعات المقرر");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addComponent = useMutation({
    mutationFn: async (planCourseId: string) => {
      const check = validateComponentForm({ ctx, form: componentForm, roomTypes: roomTypes ?? [] });
      if (!check.ok) throw new Error(check.messageAr);
      const { error } = await supabase
        .from("plan_course_components")
        .insert(buildComponentInsert(ctx, planCourseId, componentForm));
      if (error) throw error;
      await logAudit({ action: "create", entity: "plan_course_components", collegeId });
    },
    onSuccess: () => {
      toast.success("تمت إضافة المكوّن");
      setComponentForm(EMPTY_COMPONENT);
      setComponentTarget(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteComponent = useMutation({
    mutationFn: async (componentId: string) => {
      const { error } = await supabase
        .from("plan_course_components")
        .delete()
        .eq("id", componentId)
        .eq("college_id", collegeId);
      if (error) throw error;
      await logAudit({
        action: "delete",
        entity: "plan_course_components",
        entityId: componentId,
        collegeId,
      });
    },
    onSuccess: () => {
      toast.success("تم حذف المكوّن");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const noLevels = (levels ?? []).length === 0;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="sm" variant="outline" data-testid={`plan-courses-manage-${plan.id}`}>
          <Layers className="ms-1 h-3.5 w-3.5" /> إدارة مقررات الخطة
        </Button>
      </SheetTrigger>
      <SheetContent
        side="left"
        className="w-full overflow-y-auto sm:max-w-2xl"
        data-testid="plan-courses-manager"
      >
        <SheetHeader>
          <SheetTitle>إدارة مقررات الخطة — {plan.name}</SheetTitle>
        </SheetHeader>

        {noLevels && (
          <Card className="mt-4 border-amber-500/30 bg-amber-500/5 p-3 text-sm">
            <p className="mb-2 font-medium text-amber-700">
              لا توجد مستويات دراسية لبرنامج هذه الخطة بعد.
            </p>
            {canManage ? (
              <div
                className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_120px_auto]"
                data-testid="plan-level-quick-add"
              >
                <div>
                  <Label className="text-xs">اسم المستوى</Label>
                  <Input
                    value={levelForm.name}
                    onChange={(e) => setLevelForm({ ...levelForm, name: e.target.value })}
                    placeholder="المستوى الأول"
                  />
                </div>
                <div>
                  <Label className="text-xs">رقم المستوى</Label>
                  <Input
                    type="number"
                    min={1}
                    max={programDurationYears}
                    value={levelForm.level_number}
                    onChange={(e) =>
                      setLevelForm({ ...levelForm, level_number: Number(e.target.value) })
                    }
                  />
                </div>
                <Button
                  className="self-end"
                  onClick={() => addLevel.mutate()}
                  disabled={addLevel.isPending}
                >
                  إضافة مستوى
                </Button>
              </div>
            ) : (
              <p className="text-muted-foreground">لا تملك صلاحية الإضافة.</p>
            )}
          </Card>
        )}

        {canManage && (
          <Card className="mt-4 p-3" data-testid="plan-course-add-form">
            <p className="mb-2 text-sm font-semibold">إضافة مقرر إلى الخطة</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label className="text-xs">المقرر</Label>
                <Select
                  value={form.course_id}
                  onValueChange={(v) => setForm({ ...form, course_id: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="اختر المقرر" />
                  </SelectTrigger>
                  <SelectContent>
                    {(courses ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.code} — {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">المستوى</Label>
                <Select
                  value={form.level_id}
                  onValueChange={(v) => setForm({ ...form, level_id: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="اختر المستوى" />
                  </SelectTrigger>
                  <SelectContent>
                    {(levels ?? []).map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">الفصل</Label>
                <Select
                  value={String(form.semester)}
                  onValueChange={(v) => setForm({ ...form, semester: Number(v) })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">الفصل الأول</SelectItem>
                    <SelectItem value="2">الفصل الثاني</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={form.is_required}
                  onCheckedChange={(v) => setForm({ ...form, is_required: !!v })}
                />
                إلزامي
              </label>
              <div className="sm:justify-self-end">
                <Button onClick={() => addPlanCourse.mutate()} disabled={addPlanCourse.isPending}>
                  <Plus className="ms-1 h-4 w-4" /> إضافة
                </Button>
              </div>
            </div>
          </Card>
        )}

        <div className="mt-4 space-y-3">
          {isLoading ? (
            <p className="p-4 text-center text-sm text-muted-foreground">جارٍ التحميل…</p>
          ) : (planCourses ?? []).length === 0 ? (
            <p className="rounded border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
              لا توجد مقررات في هذه الخطة بعد.
            </p>
          ) : (
            (planCourses ?? []).map((row) => {
              const course = courseMap.get(row.course_id);
              const level = row.level_id ? levelMap.get(row.level_id) : null;
              const rowComponents = componentsByPlanCourse.get(row.id) ?? [];
              return (
                <Card key={row.id} className="p-3" data-testid={`plan-course-row-${row.id}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">
                        {course ? `${course.code} — ${course.name}` : "مقرر غير متاح"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {level?.name ?? "بدون مستوى"} · الفصل {row.semester} ·{" "}
                        {row.is_required ? "إلزامي" : "اختياري"}
                      </p>
                    </div>
                    {canManage && (
                      <div className="flex flex-wrap gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => generateComponents.mutate(row.id)}
                        >
                          <Sparkles className="ms-1 h-3.5 w-3.5" /> توليد من ساعات المقرر
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            toggleRequired.mutate({ id: row.id, is_required: row.is_required })
                          }
                        >
                          {row.is_required ? "اجعله اختيارياً" : "اجعله إلزامياً"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            if (
                              confirm(
                                "سيتم حذف مكوّنات هذا المقرر ثم حذفه من الخطة. هل تريد المتابعة؟",
                              )
                            ) {
                              deletePlanCourse.mutate(row.id);
                            }
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>

                  <ul className="mt-2 divide-y divide-border/60 text-xs">
                    {rowComponents.length === 0 ? (
                      <li className="py-2 text-muted-foreground">لا توجد مكوّنات لهذا المقرر.</li>
                    ) : (
                      rowComponents.map((c) => (
                        <li key={c.id} className="flex items-center justify-between gap-2 py-2">
                          <span>
                            {COMPONENT_TYPE_LABEL_AR[c.component_type as ComponentType] ??
                              c.component_type}{" "}
                            · {c.weekly_contact_hours} س/أسبوع ·{" "}
                            {c.is_timetabled ? "مجدول" : "غير مجدول"}
                            {c.required_room_type_id
                              ? ` · ${roomTypeMap.get(c.required_room_type_id)?.name_ar ?? "نوع قاعة"}`
                              : ""}
                            {c.explicit_group_size
                              ? ` · حجم المجموعة ${c.explicit_group_size}`
                              : ""}
                          </span>
                          {canManage && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => deleteComponent.mutate(c.id)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          )}
                        </li>
                      ))
                    )}
                  </ul>

                  {canManage &&
                    (componentTarget === row.id ? (
                      <div className="mt-2 grid grid-cols-1 gap-2 rounded border border-border p-2 sm:grid-cols-2">
                        <div>
                          <Label className="text-xs">نوع المكوّن</Label>
                          <Select
                            value={componentForm.component_type}
                            onValueChange={(v) =>
                              setComponentForm({ ...componentForm, component_type: v })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {PLAN_COMPONENT_TYPES.map((t) => (
                                <SelectItem key={t} value={t}>
                                  {COMPONENT_TYPE_LABEL_AR[t]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-xs">الساعات الأسبوعية</Label>
                          <Input
                            type="number"
                            min={0}
                            value={componentForm.weekly_contact_hours}
                            onChange={(e) =>
                              setComponentForm({
                                ...componentForm,
                                weekly_contact_hours: Number(e.target.value),
                              })
                            }
                          />
                        </div>
                        <div>
                          <Label className="text-xs">نوع القاعة المطلوب</Label>
                          <Select
                            value={componentForm.required_room_type_id ?? NONE}
                            onValueChange={(v) =>
                              setComponentForm({
                                ...componentForm,
                                required_room_type_id: v === NONE ? null : v,
                              })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE}>بدون تحديد</SelectItem>
                              {(roomTypes ?? []).map((r) => (
                                <SelectItem key={r.id} value={r.id}>
                                  {r.name_ar}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-xs">طريقة الاحتساب</Label>
                          <Select
                            value={componentForm.compensation_mode}
                            onValueChange={(v) =>
                              setComponentForm({ ...componentForm, compensation_mode: v })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {COMPENSATION_MODES.map((m) => (
                                <SelectItem key={m} value={m}>
                                  {COMPENSATION_MODE_LABEL_AR[m]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-xs">حجم المجموعة (اختياري)</Label>
                          <Input
                            type="number"
                            min={1}
                            value={componentForm.explicit_group_size ?? ""}
                            onChange={(e) =>
                              setComponentForm({
                                ...componentForm,
                                explicit_group_size: e.target.value ? Number(e.target.value) : null,
                              })
                            }
                          />
                        </div>
                        <div className="flex flex-col gap-1 text-xs">
                          <label className="flex items-center gap-2">
                            <Checkbox
                              checked={componentForm.is_timetabled}
                              onCheckedChange={(v) =>
                                setComponentForm({ ...componentForm, is_timetabled: !!v })
                              }
                            />
                            مجدول في الجدول
                          </label>
                          <label className="flex items-center gap-2">
                            <Checkbox
                              checked={componentForm.counts_toward_regular_load}
                              onCheckedChange={(v) =>
                                setComponentForm({
                                  ...componentForm,
                                  counts_toward_regular_load: !!v,
                                })
                              }
                            />
                            يُحتسب في النصاب
                          </label>
                          <label className="flex items-center gap-2">
                            <Checkbox
                              checked={componentForm.counts_toward_overtime}
                              onCheckedChange={(v) =>
                                setComponentForm({ ...componentForm, counts_toward_overtime: !!v })
                              }
                            />
                            يُحتسب في الساعات الإضافية
                          </label>
                        </div>
                        <div className="flex gap-2 sm:col-span-2 sm:justify-end">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setComponentTarget(null)}
                          >
                            إلغاء
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => addComponent.mutate(row.id)}
                            disabled={addComponent.isPending}
                          >
                            حفظ المكوّن
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        className="mt-2"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setComponentForm(EMPTY_COMPONENT);
                          setComponentTarget(row.id);
                        }}
                      >
                        <Plus className="ms-1 h-3.5 w-3.5" /> إضافة مكوّن
                      </Button>
                    ))}
                </Card>
              );
            })
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
