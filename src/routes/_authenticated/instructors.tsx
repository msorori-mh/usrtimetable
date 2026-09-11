import { createFileRoute, Link } from "@tanstack/react-router";
import { instructorStatusLabel } from "@/lib/excel-import/instructor-sheet";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCollege } from "@/hooks/use-colleges";
import { useCanManageActiveCollege } from "@/hooks/use-can-manage";
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
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import { UserSquare2, Pencil, Trash2, Info, AlertTriangle } from "lucide-react";
import {
  categorizeInstructor,
  INSTRUCTOR_FORM_HINT_AR,
  CATEGORY_LABEL_AR,
} from "@/lib/instructor-category";
import {
  ACADEMIC_RANKS,
  EMPLOYMENT_TYPE_OPTIONS,
  UNKNOWN_EMPLOYMENT_TYPE,
  employmentTypeLabelAr,
} from "@/lib/instructor-metadata";
import {
  INSTRUCTOR_REVIEW_LABELS,
  instructorNeedsReview,
  isMissingInstructorSpecialization,
  parseInstructorReviewSearch,
  type InstructorReview,
} from "@/lib/data-onboarding/instructor-review";
import { AdminExportMenu } from "@/components/admin-export-menu";
import { activeFilters, instructorsExportDataset } from "@/lib/admin-export/datasets";

export const Route = createFileRoute("/_authenticated/instructors")({
  head: () => ({ meta: [{ title: "المحاضرون" }] }),
  validateSearch: parseInstructorReviewSearch,
  component: InstructorsPage,
});

interface Instructor {
  id: string;
  college_id: string;
  department_id: string | null;
  full_name: string;
  academic_rank: string | null;
  email: string | null;
  phone: string | null;
  employment_type: string;
  max_weekly_hours: number;
  is_active: boolean;
  employee_number: string | null;
  full_name_ar: string | null;
  full_name_en: string | null;
  specialization: string | null;
  administrative_release_hours: number;
  notes: string | null;
  admin_tasks: string | null;
  instructor_type_id: string | null;
}

interface InstructorTypeRow {
  id: string;
  code: string | null;
  name_ar: string;
  is_external: boolean | null;
}

const RANKS = ACADEMIC_RANKS;

function emptyForm() {
  return {
    full_name: "",
    academic_rank: "",
    email: "",
    phone: "",
    department_id: "",
    employment_type: UNKNOWN_EMPLOYMENT_TYPE,
    max_weekly_hours: 18,
    is_active: true,
    employee_number: "",
    full_name_ar: "",
    full_name_en: "",
    specialization: "",
    administrative_release_hours: 0,
    notes: "",
    admin_tasks: "",
    instructor_type_id: "",
  };
}

function InstructorsPage() {
  const { active } = useActiveCollege();
  // A college switch must not retain an edit form belonging to the previous college.
  return <InstructorDirectory key={active?.id ?? "no-college"} />;
}

function InstructorDirectory() {
  const { active } = useActiveCollege();
  const { review } = Route.useSearch();
  const navigate = Route.useNavigate();
  const canManage = useCanManageActiveCollege();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Instructor | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [repairField, setRepairField] = useState<InstructorReview | null>(null);
  const specializationRef = useRef<HTMLInputElement>(null);
  const departmentRef = useRef<HTMLButtonElement>(null);

  const { data: depts } = useQuery({
    queryKey: ["dept-min", active?.id],
    enabled: !!active,
    queryFn: async () =>
      (
        await supabase
          .from("departments")
          .select("id, name")
          .eq("college_id", active!.id)
          .order("name")
      ).data ?? [],
  });

  const { data: types } = useQuery({
    queryKey: ["instructor-types", active?.id],
    enabled: !!active,
    queryFn: async () =>
      (
        await supabase
          .from("instructor_types")
          .select("id, code, name_ar, is_external")
          .eq("college_id", active!.id)
          .eq("is_active", true)
          .order("display_order")
      ).data ?? [],
  });

  const {
    data: rows,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["instructors", active?.id],
    enabled: !!active,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("instructors")
        .select(
          "id, college_id, department_id, full_name, academic_rank, email, phone, employment_type, max_weekly_hours, is_active, employee_number, full_name_ar, full_name_en, specialization, administrative_release_hours, notes, admin_tasks, instructor_type_id",
        )
        .eq("college_id", active!.id)
        .order("full_name");
      if (error) throw error;
      return (data ?? []) as Instructor[];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!active) throw new Error("اختر كلّية");
      if (!canManage) throw new Error("صلاحيتك للقراءة فقط");
      if (!form.full_name.trim()) throw new Error("الاسم مطلوب");
      const payload = {
        full_name: form.full_name.trim(),
        full_name_ar: form.full_name_ar.trim() || form.full_name.trim(),
        full_name_en: form.full_name_en.trim() || null,
        employee_number: form.employee_number.trim() || null,
        specialization: form.specialization.trim() || null,
        academic_rank: form.academic_rank || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        department_id: form.department_id || null,
        employment_type: form.employment_type || UNKNOWN_EMPLOYMENT_TYPE,
        max_weekly_hours: Number(form.max_weekly_hours) || 0,
        administrative_release_hours: Number(form.administrative_release_hours) || 0,
        notes: form.notes.trim() || null,
        admin_tasks: form.admin_tasks.trim() || null,
        is_active: form.is_active,
        instructor_type_id: form.instructor_type_id || null,
        college_id: active.id,
      };
      if (editing) {
        const { error } = await supabase
          .from("instructors")
          .update(payload)
          .eq("id", editing.id)
          .eq("college_id", active.id);
        if (error) throw error;
        await logAudit({
          action: "update",
          entity: "instructors",
          entityId: editing.id,
          collegeId: active.id,
        });
      } else {
        const { data, error } = await supabase
          .from("instructors")
          .insert(payload)
          .select("id")
          .single();
        if (error) throw error;
        await logAudit({
          action: "create",
          entity: "instructors",
          entityId: data?.id,
          collegeId: active.id,
        });
      }
    },
    onSuccess: () => {
      toast.success(editing ? "تم التحديث" : "تمت الإضافة");
      for (const key of [
        "instructors",
        "data-onboarding-readiness",
        "data-readiness",
        "rep-readiness",
      ])
        void qc.invalidateQueries({ queryKey: [key, active?.id] });
      setOpen(false);
      setEditing(null);
    },
    onError: (e: Error) =>
      toast.error(
        e.message.includes("duplicate") ? "رقم الموظف مستخدم بالفعل في هذه الكلّية" : e.message,
      ),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("instructors").delete().eq("id", id);
      if (error) throw error;
      await logAudit({
        action: "delete",
        entity: "instructors",
        entityId: id,
        collegeId: active?.id,
      });
    },
    onSuccess: () => {
      toast.success("تم الحذف");
      qc.invalidateQueries({ queryKey: ["instructors", active?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const startEdit = (i: Instructor, field: InstructorReview | null = review ?? null) => {
    setRepairField(field);
    setEditing(i);
    setForm({
      full_name: i.full_name,
      academic_rank: i.academic_rank ?? "",
      email: i.email ?? "",
      phone: i.phone ?? "",
      department_id: i.department_id ?? "",
      employment_type: i.employment_type,
      max_weekly_hours: i.max_weekly_hours,
      is_active: i.is_active,
      employee_number: i.employee_number ?? "",
      full_name_ar: i.full_name_ar ?? "",
      full_name_en: i.full_name_en ?? "",
      specialization: i.specialization ?? "",
      administrative_release_hours: i.administrative_release_hours ?? 0,
      notes: i.notes ?? "",
      admin_tasks: i.admin_tasks ?? "",
      instructor_type_id: i.instructor_type_id ?? "",
    });
    setOpen(true);
  };
  const startCreate = () => {
    setRepairField(null);
    setEditing(null);
    setForm(emptyForm());
    setOpen(true);
  };

  const deptMap = new Map((depts ?? []).map((d) => [d.id, d.name]));
  const typeRows = (types ?? []) as InstructorTypeRow[];
  const typeMap = new Map(typeRows.map((t) => [t.id, t]));
  const visibleRows = review ? rows?.filter((i) => instructorNeedsReview(i, review)) : rows;

  return (
    <div className="mx-auto max-w-5xl" dir="rtl">
      <header className="mb-6 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-secondary text-primary">
          <UserSquare2 className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">المحاضرون</h1>
          <p className="text-sm text-muted-foreground">قائمة أعضاء هيئة التدريس في الكلّية.</p>
        </div>
      </header>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <CollegeSwitcher />
        <div className="flex flex-wrap gap-2">
          <AdminExportMenu
            testId="instructors-export"
            disabled={!active || (visibleRows ?? []).length === 0}
            dataset={() =>
              instructorsExportDataset({
                rows: (visibleRows ?? []).map((i) => ({
                  ...i,
                  needs_review: instructorNeedsReview(i, "missing_department")
                    ? true
                    : isMissingInstructorSpecialization(i),
                })),
                collegeName: active?.name ?? null,
                departmentLabel: (id) => (id ? (deptMap.get(id) ?? "") : "بدون قسم"),
                categoryLabel: (id) =>
                  CATEGORY_LABEL_AR[categorizeInstructor(typeMap.get(id ?? "") ?? null)] ?? "",
                employmentLabel: (v) => employmentTypeLabelAr(v ?? UNKNOWN_EMPLOYMENT_TYPE),
                filters: activeFilters([
                  { label: "مرشّح المراجعة", value: review ? INSTRUCTOR_REVIEW_LABELS[review] : "" },
                ]),
              })
            }
          />
        </div>
        {canManage && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button onClick={startCreate}>محاضر جديد</Button>
            </DialogTrigger>
            <DialogContent
              className="max-h-[90dvh] max-w-lg overflow-y-auto"
              onOpenAutoFocus={(event) => {
                if (!editing || !repairField) return;
                event.preventDefault();
                if (repairField === "missing_specialization") specializationRef.current?.focus();
                else departmentRef.current?.focus();
              }}
            >
              <DialogHeader>
                <DialogTitle>
                  {editing ? `تعديل بيانات ${editing.full_name}` : "محاضر جديد"}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>رقم الموظف</Label>
                    <Input
                      value={form.employee_number}
                      onChange={(e) => setForm({ ...form, employee_number: e.target.value })}
                    />
                  </div>
                  <div
                    className={
                      repairField === "missing_specialization"
                        ? "rounded-md border border-amber-500 bg-amber-50/40 p-2"
                        : undefined
                    }
                  >
                    <Label htmlFor="instructor-specialization">التخصص</Label>
                    <Input
                      id="instructor-specialization"
                      ref={specializationRef}
                      aria-describedby={
                        repairField === "missing_specialization"
                          ? "specialization-review-help"
                          : undefined
                      }
                      value={form.specialization}
                      onChange={(e) => setForm({ ...form, specialization: e.target.value })}
                    />
                    {repairField === "missing_specialization" && (
                      <p id="specialization-review-help" className="mt-2 text-xs text-amber-800">
                        هذا هو الحقل الناقص في المراجعة. أدخل التخصص العلمي للمدرس ثم احفظ.
                      </p>
                    )}
                  </div>
                </div>
                <div>
                  <Label>الاسم الكامل (افتراضي)</Label>
                  <Input
                    value={form.full_name}
                    onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>الاسم بالعربية</Label>
                    <Input
                      value={form.full_name_ar}
                      onChange={(e) => setForm({ ...form, full_name_ar: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>الاسم بالإنجليزية</Label>
                    <Input
                      dir="ltr"
                      value={form.full_name_en}
                      onChange={(e) => setForm({ ...form, full_name_en: e.target.value })}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>الرتبة العلمية</Label>
                    <Select
                      value={form.academic_rank}
                      onValueChange={(v) => setForm({ ...form, academic_rank: v })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="اختر الرتبة" />
                      </SelectTrigger>
                      <SelectContent>
                        {RANKS.map((r) => (
                          <SelectItem key={r} value={r}>
                            {r}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div
                    className={
                      repairField === "missing_department"
                        ? "rounded-md border border-amber-500 bg-amber-50/40 p-2"
                        : undefined
                    }
                  >
                    <Label htmlFor="instructor-department">القسم</Label>
                    <Select
                      value={form.department_id}
                      onValueChange={(v) => setForm({ ...form, department_id: v })}
                    >
                      <SelectTrigger
                        id="instructor-department"
                        ref={departmentRef}
                        aria-describedby={
                          repairField === "missing_department"
                            ? "department-review-help"
                            : undefined
                        }
                      >
                        <SelectValue placeholder="اختر القسم" />
                      </SelectTrigger>
                      <SelectContent>
                        {(depts ?? []).map((d) => (
                          <SelectItem key={d.id} value={d.id}>
                            {d.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {repairField === "missing_department" && (
                      <p id="department-review-help" className="mt-2 text-xs text-amber-800">
                        هذا هو الحقل الناقص في المراجعة. حدّد القسم الذي يتبع له المدرس ثم احفظ.
                      </p>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>البريد الإلكتروني</Label>
                    <Input
                      dir="ltr"
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>الجوال</Label>
                    <Input
                      dir="ltr"
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>حالة التفرغ/التعاقد</Label>
                    <Select
                      value={form.employment_type || UNKNOWN_EMPLOYMENT_TYPE}
                      onValueChange={(v) => setForm({ ...form, employment_type: v })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {EMPLOYMENT_TYPE_OPTIONS.map((e) => (
                          <SelectItem key={e.value} value={e.value}>
                            {e.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      اترك «غير محدد» إذا لم يتم إثبات حالة التفرغ رسمياً.
                    </p>
                  </div>
                  <div>
                    <Label>النصاب الأسبوعي (ساعة)</Label>
                    <Input
                      type="number"
                      value={form.max_weekly_hours}
                      onChange={(e) =>
                        setForm({ ...form, max_weekly_hours: Number(e.target.value) })
                      }
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>ساعات الإعفاء الإداري</Label>
                    <Input
                      type="number"
                      value={form.administrative_release_hours}
                      onChange={(e) =>
                        setForm({ ...form, administrative_release_hours: Number(e.target.value) })
                      }
                    />
                  </div>
                  <div>
                    <Label>ملاحظات</Label>
                    <Input
                      value={form.notes}
                      onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="instructor-role">الصفة / المهام الإدارية</Label>
                  <Input
                    id="instructor-role"
                    value={form.admin_tasks}
                    onChange={(e) => setForm({ ...form, admin_tasks: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <Label>فئة المحاضر</Label>
                    <Select
                      value={form.instructor_type_id || "_none"}
                      onValueChange={(v) =>
                        setForm({ ...form, instructor_type_id: v === "_none" ? "" : v })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="اختر الفئة" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none">— غير محدد —</SelectItem>
                        {typeRows.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.name_ar}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {(() => {
                    const selected = typeRows.find((t) => t.id === form.instructor_type_id);
                    const cat = categorizeInstructor(selected ?? null);
                    const isPerm = cat === "permanent";
                    const tone = isPerm
                      ? "bg-sky-500/10 text-sky-700 border-sky-500/20"
                      : "bg-amber-500/10 text-amber-700 border-amber-500/20";
                    const Icon = isPerm ? Info : AlertTriangle;
                    return (
                      <div className={`flex items-start gap-2 rounded border p-3 text-xs ${tone}`}>
                        <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                        <div>
                          <p className="font-semibold">{CATEGORY_LABEL_AR[cat]}</p>
                          <p className="mt-0.5">{INSTRUCTOR_FORM_HINT_AR[cat]}</p>
                        </div>
                      </div>
                    );
                  })()}
                </div>
                <div className="flex items-center justify-between rounded border border-border p-3">
                  <Label>نشط</Label>
                  <Switch
                    checked={form.is_active}
                    onCheckedChange={(v) => setForm({ ...form, is_active: v })}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  إلغاء
                </Button>
                <Button onClick={() => save.mutate()} disabled={save.isPending}>
                  حفظ
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="min-w-64">
          <Label htmlFor="instructor-review-filter">عرض البيانات</Label>
          <Select
            value={review ?? "all"}
            onValueChange={(value) =>
              void navigate({
                search: parseInstructorReviewSearch({ review: value }),
                replace: true,
              })
            }
          >
            <SelectTrigger id="instructor-review-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل المدرسين</SelectItem>
              {Object.entries(INSTRUCTOR_REVIEW_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button asChild variant="outline">
          <Link to="/data-onboarding" search={{ step: "readiness_check" }}>
            العودة إلى المراجعة النهائية
          </Link>
        </Button>
      </div>
      {review && active && !isLoading && !isError && (
        <Card className="mb-4 space-y-2 border-amber-500/40 p-4" role="status">
          <p className="font-semibold">{INSTRUCTOR_REVIEW_LABELS[review]}</p>
          <p className="text-sm">
            السجلات التي تحتاج استكمالًا: {visibleRows?.length ?? 0} من إجمالي {rows?.length ?? 0}{" "}
            مدرسًا في {active.name}.
          </p>
          <p className="text-sm text-muted-foreground">
            {canManage
              ? "اضغط زر الاستكمال بجانب الاسم لفتح الحقل الناقص. تتحدث القائمة ونتيجة المراجعة بعد الحفظ."
              : "صلاحيتك للقراءة فقط. يظهر النقص بجانب كل اسم؛ يستكمل الأدمن أو مدير الكلية البيانات."}
          </p>
        </Card>
      )}
      <Card className="overflow-hidden">
        {!active ? (
          <p className="p-6 text-center text-muted-foreground">اختر كلية لعرض المدرسين.</p>
        ) : isError ? (
          <div className="space-y-2 p-6 text-center" role="alert">
            <p>تعذر تحميل بيانات المدرسين. لا يمكن تأكيد اكتمال المراجعة.</p>
            <Button variant="outline" onClick={() => void refetch()}>
              إعادة المحاولة
            </Button>
          </div>
        ) : isLoading ? (
          <p className="p-6 text-center text-muted-foreground">جارٍ التحميل...</p>
        ) : !visibleRows || visibleRows.length === 0 ? (
          <p className="p-6 text-center text-muted-foreground">
            {review
              ? "لا توجد سجلات ناقصة بهذا المعيار في الكلية الحالية."
              : "لا يوجد محاضرون بعد."}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {visibleRows.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="font-semibold">
                    {i.full_name}{" "}
                    {!i.is_active && (
                      <span className="ms-2 rounded bg-muted px-2 py-0.5 text-[10px]">
                        {instructorStatusLabel(i.is_active, i.notes)}
                      </span>
                    )}
                  </p>
                  <p
                    className={`mt-1 text-sm ${isMissingInstructorSpecialization(i) ? "font-medium text-amber-800" : "text-muted-foreground"}`}
                  >
                    التخصص:{" "}
                    {isMissingInstructorSpecialization(i)
                      ? "غير محدد — يحتاج استكمالًا"
                      : i.specialization}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {i.academic_rank ?? "—"} ·{" "}
                    {i.department_id ? (deptMap.get(i.department_id) ?? "—") : "بدون قسم"} ·{" "}
                    {employmentTypeLabelAr(i.employment_type)} · {i.max_weekly_hours} س/أسبوع
                  </p>
                  <p className="text-xs text-muted-foreground">
                    فئة المحاضر:{" "}
                    {
                      CATEGORY_LABEL_AR[
                        categorizeInstructor(typeMap.get(i.instructor_type_id ?? "") ?? null)
                      ]
                    }
                  </p>
                  {(i.email || i.phone) && (
                    <p className="text-xs text-muted-foreground" dir="ltr">
                      {i.email ?? ""} {i.phone ? ` · ${i.phone}` : ""}
                    </p>
                  )}
                  {i.admin_tasks && (
                    <p className="text-xs text-muted-foreground">الصفة: {i.admin_tasks}</p>
                  )}
                </div>
                {canManage && (
                  <div className="flex flex-wrap gap-1">
                    {(review || isMissingInstructorSpecialization(i)) && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => startEdit(i, review ?? "missing_specialization")}
                      >
                        {review === "missing_department" ? "استكمال القسم" : "استكمال التخصص"}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`تعديل ${i.full_name}`}
                      onClick={() => startEdit(i)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`حذف ${i.full_name}`}
                      onClick={() => {
                        if (confirm("حذف المحاضر؟")) del.mutate(i.id);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
