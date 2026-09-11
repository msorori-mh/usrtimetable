import { ACADEMIC_STUDY_SYSTEMS, ACADEMIC_STUDY_SYSTEM_LABELS } from "@/lib/study-systems";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Briefcase } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCollege } from "@/hooks/use-colleges";
import { useCanManageActiveCollege } from "@/hooks/use-can-manage";
import {
  useCreateTeachingAssignmentV2,
  useDeactivateTeachingAssignmentV2,
  useTeachingAssignmentWorkspace,
  useUpdateTeachingAssignmentV2,
  useWorkloadPreview,
} from "@/hooks/use-teaching-assignments-v2";
import type {
  TeachingAssignmentWorkspaceRow,
  WorkspaceFilters,
} from "@/lib/academic-delivery/teaching-assignments-v2";
import { CollegeSwitcher } from "@/components/college-switcher";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

export const Route = createFileRoute("/_authenticated/teaching-assignments")({
  head: () => ({ meta: [{ title: "الإسناد التدريسي" }] }),
  component: TeachingAssignmentsV2Page,
});

const COMPONENT_LABELS: Record<string, string> = {
  theory: "نظري",
  practical: "عملي",
  tutorial: "تمارين",
  project: "مشروع",
};

const ALLOCATION_LABELS: Record<string, string> = {
  unassigned: "غير مسند",
  under_allocated: "توزيع جزئي",
  fully_allocated: "مكتمل",
  over_allocated: "تجاوز الساعات",
};

function TeachingAssignmentsV2Page() {
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();

  const [programId, setProgramId] = useState<string>("");
  const [levelId, setLevelId] = useState<string>("");
  const [termId, setTermId] = useState<string>("");
  const [studySystem, setStudySystem] = useState<string>("");
  const [cohortId, setCohortId] = useState<string>("");
  const [componentType, setComponentType] = useState<string>("");
  const [assignmentStatus, setAssignmentStatus] = useState<string>("");

  const [selected, setSelected] = useState<TeachingAssignmentWorkspaceRow | null>(null);
  const [instructorId, setInstructorId] = useState("");
  const [hours, setHours] = useState<string>("");
  const [editingAssignmentId, setEditingAssignmentId] = useState<string | null>(null);
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<{
    id: string;
    updatedAt: string;
    name: string;
  } | null>(null);

  const filters: WorkspaceFilters | null = useMemo(() => {
    if (!active?.id) return null;
    return {
      collegeId: active.id,
      programId: programId || null,
      levelId: levelId || null,
      termId: termId || null,
      studySystem: studySystem || null,
      cohortId: cohortId || null,
      componentType: componentType || null,
      assignmentStatus: assignmentStatus || null,
    };
  }, [
    active?.id,
    programId,
    levelId,
    termId,
    studySystem,
    cohortId,
    componentType,
    assignmentStatus,
  ]);

  const workspace = useTeachingAssignmentWorkspace(filters);
  const createMut = useCreateTeachingAssignmentV2(filters);
  const updateMut = useUpdateTeachingAssignmentV2(filters);
  const deactivateMut = useDeactivateTeachingAssignmentV2(filters);

  const { data: programs } = useQuery({
    queryKey: ["programs-ta-v2", active?.id],
    enabled: !!active,
    queryFn: async () =>
      (
        await supabase
          .from("academic_programs")
          .select("id, name, code")
          .eq("college_id", active!.id)
      ).data ?? [],
  });
  const { data: levels } = useQuery({
    queryKey: ["levels-ta-v2", active?.id, programId],
    enabled: !!active && !!programId,
    queryFn: async () =>
      (
        await supabase
          .from("academic_levels")
          .select("id, name, level_number")
          .eq("college_id", active!.id)
          .eq("program_id", programId)
          .order("level_number")
      ).data ?? [],
  });
  const { data: terms } = useQuery({
    queryKey: ["terms-ta-v2", active?.id],
    enabled: !!active,
    queryFn: async () =>
      (await supabase.from("academic_terms").select("id, name").eq("college_id", active!.id))
        .data ?? [],
  });
  const { data: cohorts } = useQuery({
    queryKey: ["cohorts-ta-v2", active?.id, programId, levelId, termId, studySystem],
    enabled: !!active,
    queryFn: async () => {
      let q = supabase
        .from("academic_cohorts")
        .select("id, code, program_id, level_id, term_id, study_system")
        .eq("college_id", active!.id);
      if (programId) q = q.eq("program_id", programId);
      if (levelId) q = q.eq("level_id", levelId);
      if (termId) q = q.eq("term_id", termId);
      if (studySystem) q = q.eq("study_system", studySystem);
      return (await q.order("code")).data ?? [];
    },
  });

  const { data: candidates } = useQuery({
    queryKey: ["ta-v2-candidates", selected?.delivery_group_id],
    enabled: !!selected?.delivery_group_id && canManage,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "get_delivery_group_assignment_candidates" as never,
        {
          p_delivery_group_id: selected!.delivery_group_id,
        } as never,
      );
      if (error) throw error;
      const root = (data ?? {}) as { candidates?: Array<Record<string, unknown>> };
      return root.candidates ?? [];
    },
  });

  const hoursNum = hours.trim() === "" ? null : Number(hours);
  const preview = useWorkloadPreview({
    instructorId: instructorId || null,
    deliveryGroupId: selected?.delivery_group_id ?? null,
    assignedComponentHours: hoursNum != null && Number.isFinite(hoursNum) ? hoursNum : null,
    assignmentId: editingAssignmentId,
    enabled: !!selected && !!instructorId && confirmOpen === false,
  });

  const rows = workspace.data?.rows ?? [];
  const readOnly = !canManage || workspace.data?.can_manage === false;

  const openAssign = (row: TeachingAssignmentWorkspaceRow) => {
    if (row.is_obsolete) {
      toast.error("المجموعة ملغاة — لا إسناد جديد");
      return;
    }
    if (row.active === false) {
      toast.error(
        "المجموعة غير نشطة — لا إسناد جديد (DELIVERY_GROUP_INACTIVE_ASSIGNMENT_FORBIDDEN)",
      );
      return;
    }
    setSelected(row);
    setInstructorId("");
    setHours("");
    setEditingAssignmentId(null);
    setExpectedUpdatedAt(null);
  };

  const openEditHours = (row: TeachingAssignmentWorkspaceRow, assignmentId: string) => {
    const a = row.instructors.find((i) => i.assignment_id === assignmentId);
    if (!a) return;
    setSelected(row);
    setInstructorId(a.instructor_id);
    setHours(a.assigned_component_hours == null ? "" : String(a.assigned_component_hours));
    setEditingAssignmentId(a.assignment_id);
    setExpectedUpdatedAt(a.updated_at);
  };

  const runMutation = async () => {
    if (!selected || !instructorId) {
      toast.error("اختر المدرس");
      return;
    }
    if (preview.data?.assignment_conflicts?.length) {
      toast.error(`تعارض يمنع الحفظ: ${preview.data.assignment_conflicts.join(", ")}`);
      return;
    }
    try {
      if (editingAssignmentId && expectedUpdatedAt) {
        const result = await updateMut.mutateAsync({
          assignmentId: editingAssignmentId,
          expectedUpdatedAt,
          assignedComponentHours: hoursNum,
        });
        if (!result.ok) return;
      } else {
        const result = await createMut.mutateAsync({
          deliveryGroupId: selected.delivery_group_id,
          instructorId,
          assignedComponentHours: hoursNum,
        });
        if (!result.ok) return;
      }
      setSelected(null);
      setConfirmOpen(false);
    } catch {
      // toast handled in hook
    }
  };

  return (
    <div className="mx-auto max-w-6xl" data-testid="teaching-assignments-v2-page">
      <header className="mb-6 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-secondary text-primary">
          <Briefcase className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">الإسناد التدريسي</h1>
          <p className="text-sm text-muted-foreground">
            إسناد مجموعات المحاضرات والمعامل إلى أعضاء هيئة التدريس مع الساعات والنصاب والتحققات.
          </p>
        </div>
      </header>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <CollegeSwitcher />
        <Button asChild variant="outline" size="sm">
          <Link to="/delivery-groups">مجموعات المحاضرات والمعامل</Link>
        </Button>
      </div>

      <Card className="mb-4 border-primary/30 bg-primary/5 p-4 text-sm">
        <p className="font-semibold">الخطوة التالية</p>
        <p className="mt-1 text-muted-foreground">
          أكمل الإسناد التدريسي للمجموعات، ثم انتقل إلى بناء الجدول.
        </p>
        <Button asChild variant="link" className="mt-1 h-auto p-0">
          <Link to="/schedule-builder">بناء الجدول</Link>
        </Button>
      </Card>

      {!active ? (
        <p className="text-sm text-muted-foreground">اختر كلية.</p>
      ) : (
        <>
          <Card className="mb-4 grid gap-3 p-4 md:grid-cols-4" data-testid="ta-v2-filters">
            <div>
              <Label>البرنامج</Label>
              <Select
                value={programId || "_all"}
                onValueChange={(v) => {
                  setProgramId(v === "_all" ? "" : v);
                  setLevelId("");
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="الكل" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">الكل</SelectItem>
                  {(programs ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.code} — {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>المستوى</Label>
              <Select
                value={levelId || "_all"}
                onValueChange={(v) => setLevelId(v === "_all" ? "" : v)}
                disabled={!programId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="الكل" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">الكل</SelectItem>
                  {(levels ?? []).map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name ?? `مستوى ${l.level_number}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>الفصل</Label>
              <Select
                value={termId || "_all"}
                onValueChange={(v) => setTermId(v === "_all" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="الكل" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">الكل</SelectItem>
                  {(terms ?? []).map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>نظام الدراسة</Label>
              <Select
                value={studySystem || "_all"}
                onValueChange={(v) => setStudySystem(v === "_all" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="الكل" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">الكل</SelectItem>
                  {ACADEMIC_STUDY_SYSTEMS.map((system) => (
                    <SelectItem key={system} value={system}>
                      {ACADEMIC_STUDY_SYSTEM_LABELS[system]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>الدفعة</Label>
              <Select
                value={cohortId || "_all"}
                onValueChange={(v) => setCohortId(v === "_all" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="الكل" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">الكل</SelectItem>
                  {(cohorts ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.code ?? c.id.slice(0, 8)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>نوع المكوّن</Label>
              <Select
                value={componentType || "_all"}
                onValueChange={(v) => setComponentType(v === "_all" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="الكل" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">الكل</SelectItem>
                  {Object.entries(COMPONENT_LABELS).map(([k, l]) => (
                    <SelectItem key={k} value={k}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>حالة الإسناد</Label>
              <Select
                value={assignmentStatus || "_all"}
                onValueChange={(v) => setAssignmentStatus(v === "_all" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="الكل" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">الكل</SelectItem>
                  <SelectItem value="unassigned">غير مسند</SelectItem>
                  <SelectItem value="assigned">مسند</SelectItem>
                  <SelectItem value="under_allocated">توزيع جزئي</SelectItem>
                  <SelectItem value="fully_allocated">مكتمل</SelectItem>
                  <SelectItem value="obsolete">ملغى (obsolete)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {readOnly && (
              <div className="flex items-end">
                <p className="text-xs text-muted-foreground" data-testid="ta-v2-readonly-banner">
                  وضع قراءة فقط — لا أزرار كتابة.
                </p>
              </div>
            )}
          </Card>

          <Card className="overflow-hidden" data-testid="ta-v2-groups-table">
            {workspace.isLoading ? (
              <p className="p-6 text-center text-muted-foreground">جاري التحميل…</p>
            ) : workspace.isError ? (
              <p className="p-6 text-center text-destructive">
                تعذّر تحميل مساحة العمل. تأكد من صلاحية العرض وأن Migration مطبّقة عند الحاجة.
              </p>
            ) : rows.length === 0 ? (
              <p className="p-6 text-center text-muted-foreground">
                لا توجد مجموعات محاضرات ومعامل أسبوعية مطابقة. ولّد المجموعات من الدفعات الدراسية
                أولاً.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-right font-medium">المقرر</th>
                      <th className="px-3 py-2 text-right font-medium">المكوّن</th>
                      <th className="px-3 py-2 text-right font-medium">المجموعة</th>
                      <th className="px-3 py-2 text-right font-medium">طلاب</th>
                      <th className="px-3 py-2 text-right font-medium">سعة</th>
                      <th className="px-3 py-2 text-right font-medium">الحالة</th>
                      <th className="px-3 py-2 text-right font-medium">المدرسون</th>
                      <th className="px-3 py-2 text-right font-medium">ساعات</th>
                      <th className="px-3 py-2 text-right font-medium">التوزيع</th>
                      <th className="px-3 py-2 text-right font-medium">إجراء</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map((row) => (
                      <tr
                        key={row.delivery_group_id}
                        className={row.is_obsolete ? "opacity-70" : ""}
                      >
                        <td className="px-3 py-2">
                          <div className="font-medium">{row.course_code}</div>
                          <div className="text-xs text-muted-foreground">{row.course_name}</div>
                        </td>
                        <td className="px-3 py-2">
                          {COMPONENT_LABELS[row.component_type] ?? row.component_type}
                        </td>
                        <td className="px-3 py-2">{row.group_number ?? row.group_code}</td>
                        <td className="px-3 py-2">{row.expected_students}</td>
                        <td className="px-3 py-2">{row.capacity_limit ?? "—"}</td>
                        <td className="px-3 py-2">
                          {row.is_obsolete ? (
                            <span className="text-destructive" data-testid="ta-v2-obsolete-badge">
                              obsolete
                            </span>
                          ) : row.active ? (
                            "active"
                          ) : (
                            "inactive"
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {row.instructors.length === 0
                            ? "—"
                            : row.instructors.map((i) => i.instructor_name ?? "—").join("، ")}
                        </td>
                        <td className="px-3 py-2">
                          {row.assigned_hours_total}/{row.component_hours ?? "?"}
                          {row.remaining_hours > 0 ? ` (متبقي ${row.remaining_hours})` : ""}
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
                                onClick={() => openAssign(row)}
                              >
                                إسناد
                              </Button>
                              {row.instructors[0] && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() =>
                                    openEditHours(row, row.instructors[0]!.assignment_id)
                                  }
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
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      <Dialog open={!!selected && !deactivateTarget} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-lg" data-testid="ta-v2-assign-panel">
          <DialogHeader>
            <DialogTitle>
              {editingAssignmentId ? "تحديث ساعات الإسناد" : "إسناد مجموعة محاضرات ومعامل"}
            </DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {selected.course_code} ·{" "}
                {COMPONENT_LABELS[selected.component_type] ?? selected.component_type} · مجموعة{" "}
                {selected.group_number ?? selected.group_code} · ساعات المكوّن{" "}
                {selected.component_hours ?? "—"}
              </p>
              {!editingAssignmentId && (
                <div>
                  <Label>المدرس</Label>
                  <Select value={instructorId || undefined} onValueChange={setInstructorId}>
                    <SelectTrigger data-testid="ta-v2-instructor-select">
                      <SelectValue placeholder="اختر مدرساً" />
                    </SelectTrigger>
                    <SelectContent>
                      {(candidates ?? [])
                        .filter((c) => !c.already_assigned)
                        .map((c) => (
                          <SelectItem key={String(c.instructor_id)} value={String(c.instructor_id)}>
                            {String(c.full_name ?? "")}
                            {c.employee_number ? ` (${String(c.employee_number)})` : ""}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div>
                <Label>ساعات المكوّن المسندة (اختياري لمدرس واحد؛ إلزامي عند المشاركة)</Label>
                <Input
                  type="number"
                  step="0.5"
                  min="0.5"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  data-testid="ta-v2-hours-input"
                  placeholder={
                    selected.is_co_taught || selected.assignment_count > 0
                      ? "مطلوب عند التدريس المشترك"
                      : "اتركه فارغاً لاستخدام ساعات المكوّن"
                  }
                />
              </div>

              {preview.data && (
                <div
                  className="rounded-md border border-border bg-muted/30 p-3 text-xs space-y-1"
                  data-testid="ta-v2-workload-preview"
                >
                  <p>
                    النصاب المطلوب: {preview.data.required_load_hours ?? "—"} · الحالي:{" "}
                    {preview.data.current_standard_assigned_hours} → المتوقع:{" "}
                    {preview.data.projected_standard_assigned_hours}
                  </p>
                  <p>
                    المشروع: {preview.data.current_project_hours} →{" "}
                    {preview.data.projected_project_hours}
                  </p>
                  <p>
                    الحالة: {preview.data.status_before} → {preview.data.status_after}
                  </p>
                  {preview.data.policy_missing && (
                    <p className="text-amber-700" data-testid="ta-v2-policy-missing">
                      تحذير: لا توجد سياسة نصاب للرتبة (policy_missing)
                    </p>
                  )}
                  {preview.data.warnings.map((w) => (
                    <p key={w} className="text-amber-700" data-testid="ta-v2-warning">
                      تحذير: {w}
                    </p>
                  ))}
                  {preview.data.assignment_conflicts.map((c) => (
                    <p key={c} className="text-destructive" data-testid="ta-v2-conflict">
                      مانع: {c}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelected(null)}>
              إلغاء
            </Button>
            {!readOnly && (
              <Button
                data-testid="ta-v2-confirm-open"
                disabled={
                  createMut.isPending ||
                  updateMut.isPending ||
                  !instructorId ||
                  (preview.data?.assignment_conflicts?.length ?? 0) > 0
                }
                onClick={() => setConfirmOpen(true)}
              >
                متابعة للتأكيد
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent data-testid="ta-v2-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد الإسناد</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم حفظ التكليف عبر RPC الآمن دون إنشاء جلسات أو تشغيل مولّد المجموعات. أي تجاوز
              لنصاب يظهر كتحذير ولا يمنع الحفظ تلقائياً؛ تجاوز ساعات المكوّن مانع.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              data-testid="ta-v2-confirm-save"
              onClick={(e) => {
                e.preventDefault();
                void runMutation();
              }}
            >
              تأكيد الحفظ
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deactivateTarget} onOpenChange={(o) => !o && setDeactivateTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>تعطيل الإسناد؟</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم تعطيل إسناد {deactivateTarget?.name || "المدرس"} مع الإبقاء على السجل للتاريخ. لن
              يُحذف التكليف.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              data-testid="ta-v2-confirm-deactivate"
              onClick={(e) => {
                e.preventDefault();
                if (!deactivateTarget) return;
                void deactivateMut
                  .mutateAsync({
                    assignmentId: deactivateTarget.id,
                    expectedUpdatedAt: deactivateTarget.updatedAt,
                    reason: "ui_deactivate",
                  })
                  .then(() => setDeactivateTarget(null));
              }}
            >
              تعطيل
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
