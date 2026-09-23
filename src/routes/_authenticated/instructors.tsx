import { facultyWorkflow, type FacultyRosterRecord } from "@/lib/instructors/faculty-workflow";
import { FacultyHomeReview } from "@/components/faculty-workflow";
import { InstructorHomeAffiliation } from "@/components/instructor-home-affiliation";
import { FacultyIdentityLink } from "@/components/faculty-identity-link";
import { createFileRoute, Link } from "@tanstack/react-router";
import { instructorStatusLabel } from "@/lib/excel-import/instructor-sheet";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAccessibleColleges, useActiveCollege } from "@/hooks/use-colleges";
import {
  useCanEditInstructorsActiveCollege,
  useCanManageActiveCollege,
} from "@/hooks/use-can-manage";
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
import { UserSquare2, Pencil, Trash2, Info, AlertTriangle, Printer } from "lucide-react";
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
  INSTRUCTOR_AVAILABILITY_OPTIONS,
  DEFAULT_AVAILABILITY_STATUS,
  availabilityStatusLabelAr,
} from "@/lib/instructor-metadata";
import {
  effectiveInstructorWeeklyHours,
  EFFECTIVE_QUOTA_FORMULA_AR,
  isHourlyContractTypeCode,
} from "@/lib/instructors/effective-hours";
import {
  ADMINISTRATIVE_POSITION_OPTIONS,
  requiresAdministrativeDepartment,
} from "@/lib/instructors/administrative-positions";
import {
  INSTRUCTOR_REVIEW_LABELS,
  instructorNeedsReview,
  isMissingInstructorDepartment,
  isMissingInstructorSpecialization,
  parseInstructorReviewSearch,
  type InstructorReview,
} from "@/lib/data-onboarding/instructor-review";
import { AdminExportMenu } from "@/components/admin-export-menu";
import { activeFilters, instructorsExportDataset } from "@/lib/admin-export/datasets";
import {
  DEFAULT_DIRECTORY_FILTERS,
  INSTRUCTOR_SORT_LABEL_AR,
  filterAndSortInstructors,
  hasActiveDirectoryFilters,
  type DirectoryFilters,
  type InstructorSortKey,
} from "@/lib/instructors/directory-filters";

export const Route = createFileRoute("/_authenticated/instructors")({
  head: () => ({ meta: [{ title: "المحاضرون" }] }),
  validateSearch: parseInstructorReviewSearch,
  component: InstructorsPage,
});

type Instructor = FacultyRosterRecord;

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
    availability_status: DEFAULT_AVAILABILITY_STATUS as string,
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
    affiliation_college_id: "",
    affiliation_department_id: "",
    administrative_position: "",
    administrative_department_id: "",
    administrative_support_department_id: "",
    administrative_department_kind: "academic",
  };
}

function InstructorsPage() {
  const { active } = useActiveCollege();
  // A college switch must not retain an edit form belonging to the previous college.
  return <InstructorDirectory key={active?.id ?? "no-college"} />;
}

function InstructorDirectory() {
  const { active } = useActiveCollege();
  const { data: accessibleColleges } = useAccessibleColleges();
  const { review } = parseInstructorReviewSearch(Route.useSearch());
  const navigate = Route.useNavigate();
  const canManage = useCanManageActiveCollege();
  const canEdit = useCanEditInstructorsActiveCollege();
  const qc = useQueryClient();
  const [scope, setScope] = useState<"home" | "visiting" | "pending">("home");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Instructor | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [repairField, setRepairField] = useState<InstructorReview | null>(null);
  const [directory, setDirectory] = useState<DirectoryFilters>(DEFAULT_DIRECTORY_FILTERS);
  const setDirectoryField = <K extends keyof DirectoryFilters>(
    key: K,
    value: DirectoryFilters[K],
  ) => setDirectory((prev) => ({ ...prev, [key]: value }));

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

  const {
    data: types,
    isLoading: typesLoading,
    isError: typesError,
  } = useQuery({
    queryKey: ["instructor-types", active?.id],
    enabled: !!active,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("instructor_types")
        .select("id, code, name_ar, is_external")
        .eq("college_id", active!.id)
        .eq("is_active", true)
        .order("display_order");
      if (error) throw error;
      return data ?? [];
    },
  });

  const [supportName, setSupportName] = useState("");
  const affiliationCollegeId = form.affiliation_college_id || active?.id || "";
  const registrationMatches = useQuery({
    queryKey: ["faculty-registration-matches", active?.id, form.full_name, form.employee_number],
    enabled:
      !!active &&
      canManage &&
      !editing &&
      (form.full_name.trim().length >= 3 || !!form.employee_number.trim()),
    queryFn: async () => {
      const { data, error } = await facultyWorkflow.rpc("find_faculty_for_registration", {
        p_college_id: active!.id,
        p_name: form.full_name,
        p_employee_number: form.employee_number || null,
      });
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: affiliationDepts } = useQuery({
    queryKey: ["instructor-affiliation-depts", affiliationCollegeId],
    enabled: !!affiliationCollegeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("departments")
        .select("id, name, code, college_id")
        .eq("college_id", affiliationCollegeId)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const supportQuery = useQuery({
    queryKey: ["support-departments", affiliationCollegeId],
    enabled: !!affiliationCollegeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_departments")
        .select("id, name, college_id")
        .eq("college_id", affiliationCollegeId)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const addSupport = useMutation({
    mutationFn: async () => {
      if (!canManage || !affiliationCollegeId || !supportName.trim())
        throw new Error("أدخل اسم القسم المساند");
      const collegeId = affiliationCollegeId;
      const { data, error } = await supabase
        .from("support_departments")
        .insert({ college_id: collegeId, name: supportName.trim() })
        .select("id")
        .single();
      if (error) throw error;
      await logAudit({
        action: "create",
        entity: "support_departments",
        entityId: data.id,
        collegeId,
      });
      return { id: data.id, collegeId };
    },
    onSuccess: ({ id, collegeId }) => {
      void qc.invalidateQueries({
        queryKey: ["support-departments", collegeId],
      });
      setForm((prev) =>
        prev.affiliation_college_id === collegeId &&
        prev.administrative_position === "department_head" &&
        prev.administrative_department_kind === "support"
          ? { ...prev, administrative_support_department_id: id }
          : prev,
      );
      setSupportName("");
      toast.success("تمت إضافة القسم المساند");
    },
    onError: (e: Error) =>
      toast.error(e.message.includes("duplicate") ? "القسم المساند موجود بالفعل" : e.message),
  });

  const {
    data: rows,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["instructors", active?.id, "home-roster", scope],
    enabled: !!active,
    queryFn: async () => {
      const { data, error } = await facultyWorkflow.rpc("get_college_faculty_roster", {
        p_college_id: active!.id,
        p_scope: scope,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!active) throw new Error("اختر كلّية");
      if (!canEdit || (editing && !editing.can_edit)) throw new Error("صلاحيتك للقراءة فقط");
      if (!editing && form.affiliation_college_id && form.affiliation_college_id !== active?.id)
        throw new Error("أضف المحاضر في كليته الأصلية، ثم اطلب تكليفه من صفحة الإسناد التدريسي");
      if (!editing && !canManage) throw new Error("صلاحيتك تسمح بتعديل المحاضرين الحاليين فقط");
      if (!form.full_name.trim()) throw new Error("الاسم مطلوب");
      const selectedType = ((types ?? []) as InstructorTypeRow[]).find(
        (t) => t.id === form.instructor_type_id,
      );
      const hourlyContract = isHourlyContractTypeCode(selectedType?.code);
      if (
        !editing &&
        !["permanent", "annual_contract", "con"].includes(selectedType?.code?.toLowerCase() ?? "")
      )
        throw new Error("اختر مثبت أو متعاقد سنوي أو متعاقد بالساعات لإصدار الرقم تلقائياً");
      if (!form.affiliation_college_id) throw new Error("اختر الكلية التابع لها المحاضر");
      if (!form.affiliation_department_id) throw new Error("اختر القسم التابع له المحاضر");
      const affiliationDepartment = (affiliationDepts ?? []).find(
        (d) => d.id === form.affiliation_department_id,
      );
      if (
        !affiliationDepartment ||
        affiliationDepartment.college_id !== form.affiliation_college_id
      )
        throw new Error("القسم المحدد لا يتبع كلية التبعية المختارة");
      if (
        !hourlyContract &&
        requiresAdministrativeDepartment(form.administrative_position) &&
        !(form.administrative_department_kind === "support"
          ? form.administrative_support_department_id
          : form.administrative_department_id)
      )
        throw new Error("اختر القسم الذي يرأسه المحاضر");
      if (
        form.administrative_department_kind === "academic" &&
        form.administrative_department_id &&
        !(affiliationDepts ?? []).some((d) => d.id === form.administrative_department_id)
      )
        throw new Error("قسم الرئاسة يجب أن يتبع كلية التبعية المختارة");

      if (
        !hourlyContract &&
        requiresAdministrativeDepartment(form.administrative_position) &&
        form.administrative_department_kind === "support" &&
        (supportQuery.isPending ||
          supportQuery.isError ||
          !supportQuery.data?.some((d) => d.id === form.administrative_support_department_id))
      )
        throw new Error("اختر قسماً مسانداً من كلية التبعية بعد تحميل القائمة");

      const operationalDepartmentId =
        form.affiliation_college_id === active.id
          ? form.affiliation_department_id || null
          : (editing?.department_id ?? null);
      const releaseHours = hourlyContract ? 0 : Number(form.administrative_release_hours) || 0;
      const payload = {
        full_name: form.full_name.trim(),
        full_name_ar: form.full_name_ar.trim() || form.full_name.trim(),
        // Hidden legacy fields are preserved on edit rather than erased from DB.
        full_name_en: form.full_name_en.trim() || editing?.full_name_en || null,
        employee_number: hourlyContract
          ? (editing?.employee_number ?? null)
          : form.employee_number.trim() || null,
        specialization: form.specialization.trim() || null,
        academic_rank: form.academic_rank || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        department_id: operationalDepartmentId,
        // Hidden: preserved on edit, safe legacy default on create.
        employment_type: form.employment_type || UNKNOWN_EMPLOYMENT_TYPE,
        availability_status: form.availability_status || DEFAULT_AVAILABILITY_STATUS,
        max_weekly_hours: Number(form.max_weekly_hours) || 0,
        administrative_release_hours: releaseHours,
        notes: editing?.notes ?? (form.notes.trim() || null),
        admin_tasks: editing?.admin_tasks ?? (form.admin_tasks.trim() || null),
        is_active: form.is_active,
        instructor_type_id: form.instructor_type_id || null,
        affiliation_college_id: form.affiliation_college_id,
        affiliation_department_id: form.affiliation_department_id,
        administrative_position: hourlyContract ? null : form.administrative_position || null,
        administrative_department_id:
          !hourlyContract &&
          requiresAdministrativeDepartment(form.administrative_position) &&
          form.administrative_department_kind === "academic"
            ? form.administrative_department_id || null
            : null,
        administrative_support_department_id:
          !hourlyContract &&
          requiresAdministrativeDepartment(form.administrative_position) &&
          form.administrative_department_kind === "support"
            ? form.administrative_support_department_id || null
            : null,
        college_id: active.id,
      };
      if (editing) {
        const { error } = await facultyWorkflow.rpc("update_home_college_instructor", {
          p_college_id: active.id,
          p_expected_updated_at: editing.updated_at,
          p_instructor_id: editing.id,
          p_full_name: payload.full_name,
          p_full_name_ar: payload.full_name_ar,
          p_employee_number: payload.employee_number,
          p_specialization: payload.specialization,
          p_academic_rank: payload.academic_rank,
          p_email: payload.email,
          p_phone: payload.phone,
          p_employment_type: payload.employment_type,
          p_max_weekly_hours: payload.max_weekly_hours,
          p_administrative_release_hours: payload.administrative_release_hours,
          p_is_active: payload.is_active,
          p_instructor_type_id: payload.instructor_type_id,
          p_affiliation_college_id: payload.affiliation_college_id,
          p_affiliation_department_id: payload.affiliation_department_id,
          p_administrative_position: payload.administrative_position,
          p_administrative_department_id: payload.administrative_department_id,
          p_administrative_support_department_id: payload.administrative_support_department_id,
          p_availability_status: payload.availability_status,
        });
        if (error) throw error;
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
        void qc.invalidateQueries({ queryKey: [key] });
      void qc.invalidateQueries({ queryKey: ["faculty-university-report"] });
      void qc.invalidateQueries({ queryKey: ["report-instructor-directory"] });
      void qc.invalidateQueries({ queryKey: ["faculty-home-profiles"] });
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
      if (!(rows ?? []).some((row) => row.id === id && row.can_delete))
        throw new Error("الحذف من الكلية الأصلية فقط");
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
      void qc.invalidateQueries({ queryKey: ["faculty-home-profiles"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const startEdit = (i: Instructor, field: InstructorReview | null = review ?? null) => {
    if (!i.can_edit) return;
    setRepairField(field);
    setEditing(i);
    setForm({
      full_name: i.full_name,
      academic_rank: i.academic_rank ?? "",
      email: i.email ?? "",
      phone: i.phone ?? "",
      department_id: i.department_id ?? "",
      employment_type: i.employment_type,
      availability_status: i.availability_status ?? DEFAULT_AVAILABILITY_STATUS,
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
      affiliation_college_id: i.affiliation_college_id ?? i.college_id,
      affiliation_department_id: i.affiliation_department_id ?? i.department_id ?? "",
      administrative_position: i.administrative_position ?? "",
      administrative_department_id: i.administrative_department_id ?? "",
      administrative_support_department_id: i.administrative_support_department_id ?? "",
      administrative_department_kind: i.administrative_support_department_id
        ? "support"
        : "academic",
    });
    setOpen(true);
  };
  const startCreate = () => {
    setRepairField(null);
    setEditing(null);
    setForm({ ...emptyForm(), affiliation_college_id: active?.id ?? "" });
    setOpen(true);
  };

  const deptMap = new Map((depts ?? []).map((d) => [d.id, d.name]));
  for (const row of rows ?? []) {
    if (row.department_id && row.home_department)
      deptMap.set(row.department_id, row.home_department);
  }
  const typeRows = (types ?? []) as InstructorTypeRow[];
  const typeMap = new Map(typeRows.map((t) => [t.id, t]));
  for (const row of rows ?? []) {
    if (row.instructor_type_id && !typeMap.has(row.instructor_type_id)) {
      typeMap.set(row.instructor_type_id, {
        id: row.instructor_type_id,
        code: row.instructor_type_code,
        name_ar: row.type_name ?? "حالة وظيفية بحاجة إلى مراجعة",
        is_external: null,
      });
    }
  }
  const selectedType = typeMap.get(form.instructor_type_id);
  const scopeLabel =
    scope === "home"
      ? "أعضاء الكلية"
      : scope === "visiting"
        ? "مكلّفون من كليات أخرى"
        : "تبعية تحتاج مراجعة";
  const rowCategoryLabel = (row: Instructor) => {
    if (!row.home_college_id) return "تبعية تحتاج مراجعة";
    if (row.home_college_id !== active?.id) return "محاضر من كلية أخرى";
    return (
      (
        { permanent: "مثبت", annual_contract: "متعاقد سنوي", con: "متعاقد بالساعات" } as Record<
          string,
          string
        >
      )[row.instructor_type_code ?? ""] ?? "حالة وظيفية بحاجة إلى مراجعة"
    );
  };
  const hourlyContract = isHourlyContractTypeCode(selectedType?.code);
  const effectiveQuota =
    effectiveInstructorWeeklyHours(
      Number(form.max_weekly_hours),
      hourlyContract ? 0 : Number(form.administrative_release_hours),
    ) ?? 0;
  const reviewRows = review ? (rows ?? []).filter((i) => instructorNeedsReview(i, review)) : rows;
  const departmentLabel = (id: string | null | undefined) =>
    id ? (deptMap.get(id) ?? "بدون قسم") : "بدون قسم";
  // Search, filters and sorting are presentation-only and compose together.
  const visibleRows = reviewRows
    ? filterAndSortInstructors(reviewRows, directory, departmentLabel)
    : reviewRows;
  const availableRanks = Array.from(
    new Set((rows ?? []).map((i) => i.academic_rank ?? "").filter((r) => r !== "")),
  ).sort((a, b) => a.localeCompare(b, "ar"));

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
      {active && <FacultyHomeReview collegeId={active.id} />}

      <div className="mb-4 space-y-2">
        <label className="flex flex-wrap items-center gap-3">
          <span>قائمة المحاضرين</span>
          <select
            aria-label="قائمة المحاضرين"
            className="rounded border bg-background p-2"
            value={scope}
            onChange={(event) => {
              setScope(event.target.value as typeof scope);
              setDirectory({ ...DEFAULT_DIRECTORY_FILTERS });
              setOpen(false);
              setEditing(null);
            }}
          >
            <option value="home">أعضاء الكلية</option>
            <option value="visiting">مكلّفون من كليات أخرى</option>
            <option value="pending">تبعية تحتاج مراجعة</option>
          </select>
        </label>
        <p className="text-sm text-muted-foreground">
          {scope === "home"
            ? "هذه القائمة لأعضاء الكلية الأصلية فقط."
            : scope === "visiting"
              ? "محاضرون لهم إسناد أو جدول في الكلية الحالية. تُعدّل بياناتهم من كليتهم الأصلية."
              : "سجلات سابقة لم تُحسم كليتها الأصلية. يستكمل الأدمن تبعيتها من تسوية السجلات أعلاه."}
        </p>
      </div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <CollegeSwitcher />
        <div className="flex flex-wrap gap-2">
          {canManage && active && (
            <Button asChild variant="outline">
              <Link to="/reports/instructors" aria-label="فتح كشف بيانات محاضري الكلية للطباعة">
                <Printer className="ml-2 h-4 w-4" />
                طباعة بيانات محاضري الكلية
              </Link>
            </Button>
          )}
          <AdminExportMenu
            testId="instructors-export"
            disabled={!active || (visibleRows ?? []).length === 0}
            dataset={() =>
              instructorsExportDataset({
                rows: (visibleRows ?? []).map((i) => ({
                  ...i,
                  home_college_name: i.home_college_name ?? "تحتاج مراجعة",
                  category_label: rowCategoryLabel(i),
                  needs_review:
                    isMissingInstructorSpecialization(i) || isMissingInstructorDepartment(i),
                })),
                collegeName: active?.name ?? null,
                departmentLabel: (id) => (id ? (deptMap.get(id) ?? "") : "بدون قسم"),
                categoryLabel: (id) =>
                  CATEGORY_LABEL_AR[categorizeInstructor(typeMap.get(id ?? "") ?? null)] ?? "",
                employmentLabel: (v) => employmentTypeLabelAr(v ?? UNKNOWN_EMPLOYMENT_TYPE),
                filters: activeFilters([
                  { label: "القائمة", value: scopeLabel },
                  {
                    label: "مرشّح المراجعة",
                    value: review ? INSTRUCTOR_REVIEW_LABELS[review] : "",
                  },
                ]),
              })
            }
          />
        </div>
        {canEdit && (
          <Dialog open={open} onOpenChange={setOpen}>
            {canManage && (
              <DialogTrigger asChild>
                <Button onClick={startCreate}>محاضر جديد</Button>
              </DialogTrigger>
            )}
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
              <div className="space-y-3" data-testid="instructor-ordered-form">
                <div data-field-order="1-affiliation-college">
                  <Label>{hourlyContract ? "الكلية المتعاقد فيها" : "الكلية التابع لها"}</Label>
                  <Select
                    disabled
                    value={form.affiliation_college_id || undefined}
                    onValueChange={(v) =>
                      setForm({
                        ...form,
                        affiliation_college_id: v,
                        affiliation_department_id: "",
                        administrative_department_id: "",
                        administrative_support_department_id: "",
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="اختر الكلية" />
                    </SelectTrigger>
                    <SelectContent>
                      {(accessibleColleges ?? []).map((college) => (
                        <SelectItem key={college.id} value={college.id}>
                          {college.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div data-field-order="2-category">
                  <Label>الحالة الوظيفية</Label>
                  <Select
                    value={form.instructor_type_id || "_none"}
                    onValueChange={(v) => {
                      const id = v === "_none" ? "" : v;
                      const type = typeRows.find((t) => t.id === id);
                      const hourly = isHourlyContractTypeCode(type?.code);
                      setForm({
                        ...form,
                        instructor_type_id: id,
                        administrative_release_hours: hourly
                          ? 0
                          : form.administrative_release_hours,
                        administrative_support_department_id: hourly
                          ? ""
                          : form.administrative_support_department_id,
                        administrative_position: hourly ? "" : form.administrative_position,
                        administrative_department_id: hourly
                          ? ""
                          : form.administrative_department_id,
                        employment_type:
                          type?.code === "con" || type?.code === "annual_contract"
                            ? "contract"
                            : type?.code === "permanent"
                              ? "full_time"
                              : form.employment_type,
                      });
                    }}
                  >
                    <SelectTrigger data-testid="instructor-category-select">
                      <SelectValue
                        placeholder={typesLoading ? "جارٍ تحميل الفئات…" : "اختر الفئة"}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {editing && !form.instructor_type_id && (
                        <SelectItem value="_none">— غير محدد —</SelectItem>
                      )}
                      {editing &&
                        form.instructor_type_id &&
                        !typeRows.some((t) => t.id === form.instructor_type_id) && (
                          <SelectItem value={form.instructor_type_id}>
                            {editing.type_name ?? "الحالة المسجلة"}
                          </SelectItem>
                        )}
                      {typeRows
                        .filter(
                          (t) =>
                            t.id === editing?.instructor_type_id ||
                            ["permanent", "annual_contract", "con"].includes(
                              t.code?.toLowerCase() ?? "",
                            ),
                        )
                        .map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.code === "annual_contract" ? "متعاقد سنوي" : t.name_ar}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  {typesLoading && (
                    <p
                      className="mt-1 text-xs text-muted-foreground"
                      data-testid="instructor-category-loading"
                    >
                      جارٍ تحميل فئات المحاضرين…
                    </p>
                  )}
                  {typesError && (
                    <p
                      className="mt-1 text-xs text-destructive"
                      data-testid="instructor-category-error"
                    >
                      تعذر تحميل فئات المحاضرين. حدّث الصفحة وحاول مرة أخرى.
                    </p>
                  )}
                  {!typesLoading && !typesError && typeRows.length === 0 && (
                    <p
                      className="mt-1 text-xs text-amber-700"
                      data-testid="instructor-category-empty"
                    >
                      لا توجد فئات محاضرين مفعّلة لهذه الكلية بعد.
                    </p>
                  )}
                  {selectedType && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {INSTRUCTOR_FORM_HINT_AR[categorizeInstructor(selectedType)]}
                    </p>
                  )}
                </div>

                <div
                  className="rounded-md border bg-muted/30 p-3"
                  data-testid="automatic-faculty-number"
                >
                  <Label>الرقم الجامعي — تلقائي</Label>
                  <p className="mt-1 text-sm" dir="ltr">
                    {editing?.university_number ??
                      (selectedType?.code === "permanent"
                        ? "USABA-P-…"
                        : selectedType?.code === "annual_contract"
                          ? "USABA-C-…"
                          : selectedType?.code === "con"
                            ? "USABA-H-…"
                            : "—")}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    يُصدر الرقم عند الحفظ بعد اختيار الكلية والحالة الوظيفية. عند تغيير الفئة يُحفظ
                    الرقم السابق مع بقاء هوية المحاضر وإسناداته. إذا كان المحاضر مسجلاً في كلية
                    أخرى، تُربط سجلاته بعد التحقق من هويته.
                  </p>
                </div>

                {!hourlyContract && (
                  <div data-field-order="2-employee-number">
                    <Label>رقم الموارد البشرية (اختياري)</Label>
                    <Input
                      value={form.employee_number}
                      onChange={(e) => setForm({ ...form, employee_number: e.target.value })}
                    />
                  </div>
                )}

                <div data-field-order="3-default-name">
                  <Label>الاسم الافتراضي</Label>
                  <Input
                    value={form.full_name}
                    onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                  />
                </div>

                <div data-field-order="4-full-arabic-name">
                  {!editing && (registrationMatches.data?.length ?? 0) > 0 && (
                    <div role="status" className="mb-3 rounded border p-3 text-sm">
                      <b>سجلات موجودة تحتاج المراجعة قبل الإضافة</b>
                      {registrationMatches.data?.map((m) => (
                        <p key={m.university_number}>
                          {m.name} — {m.university_number} —{" "}
                          {m.home_college ?? "تبعية تحتاج مراجعة"}
                        </p>
                      ))}
                      <p>
                        إن كان المحاضر مسجلًا، استخدمه من صفحة الإسناد. تشابه الأسماء لا يدمج
                        الهويات تلقائيًا.
                      </p>
                    </div>
                  )}
                  {registrationMatches.error && (
                    <p role="alert">
                      تعذر فحص السجلات الموجودة: {registrationMatches.error.message}
                    </p>
                  )}
                  <Label>الاسم الرباعي</Label>
                  <Input
                    value={form.full_name_ar}
                    onChange={(e) => setForm({ ...form, full_name_ar: e.target.value })}
                  />
                </div>

                <div
                  data-field-order="6-affiliation-department"
                  className={
                    repairField === "missing_department"
                      ? "rounded-md border border-amber-500 bg-amber-50/40 p-2"
                      : undefined
                  }
                >
                  <Label htmlFor="instructor-department">
                    {hourlyContract ? "القسم المتعاقد فيه" : "القسم التابع له"}
                  </Label>
                  <Select
                    value={form.affiliation_department_id || undefined}
                    onValueChange={(v) =>
                      setForm({
                        ...form,
                        affiliation_department_id: v,
                        administrative_department_id: "",
                        administrative_support_department_id: "",
                      })
                    }
                    disabled={!form.affiliation_college_id}
                  >
                    <SelectTrigger id="instructor-department" ref={departmentRef}>
                      <SelectValue placeholder="اختر القسم" />
                    </SelectTrigger>
                    <SelectContent>
                      {(affiliationDepts ?? []).map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div data-field-order="7-specialization">
                  <Label htmlFor="instructor-specialization">التخصص</Label>
                  <Input
                    id="instructor-specialization"
                    ref={specializationRef}
                    value={form.specialization}
                    onChange={(e) => setForm({ ...form, specialization: e.target.value })}
                  />
                </div>

                <div data-field-order="8-rank">
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

                <div data-field-order="9-base-quota">
                  <Label>النصاب الأساسي الأسبوعي</Label>
                  <Input
                    type="number"
                    min={0}
                    value={form.max_weekly_hours}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        max_weekly_hours: Number(e.target.value),
                      })
                    }
                  />
                </div>

                {!hourlyContract && (
                  <div data-field-order="10-admin-release">
                    <Label>ساعات الإعفاء الإداري</Label>
                    <Input
                      type="number"
                      min={0}
                      value={form.administrative_release_hours}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          administrative_release_hours: Number(e.target.value),
                        })
                      }
                    />
                  </div>
                )}
                <p
                  className="rounded border bg-muted/30 p-2 text-xs"
                  data-testid="effective-weekly-quota"
                >
                  {EFFECTIVE_QUOTA_FORMULA_AR}: <b>{effectiveQuota} ساعة</b>
                </p>

                {!hourlyContract && (
                  <div data-field-order="11-administrative-position" className="space-y-2">
                    <Label>المنصب الإداري في حال توافره</Label>
                    <Select
                      value={form.administrative_position || "_none"}
                      onValueChange={(v) =>
                        setForm({
                          ...form,
                          administrative_position: v === "_none" ? "" : v,
                          administrative_support_department_id:
                            v === "department_head"
                              ? form.administrative_support_department_id
                              : "",
                          administrative_department_id:
                            v === "department_head" ? form.administrative_department_id : "",
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none">— بدون منصب إداري —</SelectItem>
                        {ADMINISTRATIVE_POSITION_OPTIONS.map((position) => (
                          <SelectItem key={position.value} value={position.value}>
                            {position.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {requiresAdministrativeDepartment(form.administrative_position) && (
                      <div className="space-y-3">
                        <Label>نوع الجهة الإدارية</Label>
                        <Select
                          value={form.administrative_department_kind}
                          onValueChange={(v) =>
                            setForm({
                              ...form,
                              administrative_department_kind: v,
                              administrative_department_id: "",
                              administrative_support_department_id: "",
                            })
                          }
                        >
                          <SelectTrigger aria-label="نوع الجهة الإدارية">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="academic">قسم أكاديمي</SelectItem>
                            <SelectItem value="support">قسم مساند</SelectItem>
                          </SelectContent>
                        </Select>
                        <Label>القسم الذي يرأسه</Label>
                        <Select
                          value={
                            (form.administrative_department_kind === "support"
                              ? form.administrative_support_department_id
                              : form.administrative_department_id) || undefined
                          }
                          onValueChange={(v) =>
                            setForm({
                              ...form,
                              [form.administrative_department_kind === "support"
                                ? "administrative_support_department_id"
                                : "administrative_department_id"]: v,
                            })
                          }
                        >
                          <SelectTrigger aria-label="القسم الذي يرأسه">
                            <SelectValue placeholder="اختر القسم" />
                          </SelectTrigger>
                          <SelectContent>
                            {(form.administrative_department_kind === "support"
                              ? (supportQuery.data ?? [])
                              : (affiliationDepts ?? [])
                            ).map((d) => (
                              <SelectItem key={d.id} value={d.id}>
                                {d.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {form.administrative_department_kind === "support" && (
                          <div className="space-y-2">
                            {supportQuery.isPending && (
                              <p className="text-sm">جارٍ تحميل الأقسام المساندة…</p>
                            )}
                            {supportQuery.isError && (
                              <Button variant="outline" onClick={() => void supportQuery.refetch()}>
                                إعادة تحميل الأقسام المساندة
                              </Button>
                            )}
                            {!supportQuery.isPending &&
                              !supportQuery.isError &&
                              !supportQuery.data?.length && (
                                <p className="text-sm text-muted-foreground">
                                  لا توجد أقسام مساندة مسجلة لهذه الكلية.
                                </p>
                              )}
                            {canManage && (
                              <div className="flex gap-2">
                                <Input
                                  aria-label="اسم قسم مساند جديد"
                                  placeholder="اسم قسم مساند جديد"
                                  value={supportName}
                                  onChange={(e) => setSupportName(e.target.value)}
                                  maxLength={150}
                                />
                                <Button
                                  variant="outline"
                                  disabled={addSupport.isPending || !supportName.trim()}
                                  onClick={() => addSupport.mutate()}
                                >
                                  إضافة
                                </Button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div data-field-order="12-availability-status">
                  <Label>الحالة</Label>
                  <Select
                    value={form.availability_status || DEFAULT_AVAILABILITY_STATUS}
                    onValueChange={(v) => setForm({ ...form, availability_status: v })}
                  >
                    <SelectTrigger data-testid="instructor-availability-select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {INSTRUCTOR_AVAILABILITY_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div data-field-order="13-email">
                  <Label>البريد الإلكتروني</Label>
                  <Input
                    dir="ltr"
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                  />
                </div>

                <div data-field-order="14-phone">
                  <Label>رقم التلفون/الواتساب</Label>
                  <Input
                    dir="ltr"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  />
                </div>

                <div
                  data-field-order="15-active"
                  className="flex items-center justify-between rounded border border-border p-3"
                >
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
        {canManage && (
          <Button asChild variant="outline">
            <Link to="/data-onboarding" search={{ step: "readiness_check" }}>
              العودة إلى المراجعة النهائية
            </Link>
          </Button>
        )}
      </div>

      <Card className="mb-4 space-y-3 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-72 flex-1">
            <Label htmlFor="instructor-search">بحث</Label>
            <Input
              id="instructor-search"
              value={directory.search}
              onChange={(e) => setDirectoryField("search", e.target.value)}
              placeholder="ابحث بالاسم أو الرقم الجامعي أو رقم الموظف أو البريد أو القسم…"
            />
          </div>
          <div className="min-w-44">
            <Label htmlFor="instructor-department-filter">القسم</Label>
            <Select
              value={directory.departmentId}
              onValueChange={(v) => setDirectoryField("departmentId", v)}
            >
              <SelectTrigger id="instructor-department-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الأقسام</SelectItem>
                <SelectItem value="none">بدون قسم</SelectItem>
                {Array.from(deptMap, ([id, name]) => ({ id, name })).map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-40">
            <Label htmlFor="instructor-status-filter">حالة العضو</Label>
            <Select value={directory.status} onValueChange={(v) => setDirectoryField("status", v)}>
              <SelectTrigger id="instructor-status-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                <SelectItem value="active">نشط</SelectItem>
                <SelectItem value="inactive">غير نشط</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-44">
            <Label htmlFor="instructor-rank-filter">الرتبة</Label>
            <Select value={directory.rank} onValueChange={(v) => setDirectoryField("rank", v)}>
              <SelectTrigger id="instructor-rank-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الرتب</SelectItem>
                {availableRanks.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-44">
            <Label htmlFor="instructor-type-filter">نوع العضو</Label>
            <Select value={directory.typeId} onValueChange={(v) => setDirectoryField("typeId", v)}>
              <SelectTrigger id="instructor-type-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الأنواع</SelectItem>
                <SelectItem value="none">بدون نوع</SelectItem>
                {Array.from(typeMap.values()).map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.code === "annual_contract" ? "متعاقد سنوي" : t.name_ar}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-44">
            <Label htmlFor="instructor-sort">الفرز</Label>
            <Select
              value={directory.sortKey}
              onValueChange={(v) => setDirectoryField("sortKey", v as InstructorSortKey)}
            >
              <SelectTrigger id="instructor-sort">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(INSTRUCTOR_SORT_LABEL_AR).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="outline"
            onClick={() =>
              setDirectoryField("sortDirection", directory.sortDirection === "asc" ? "desc" : "asc")
            }
            aria-label="اتجاه الفرز"
          >
            {directory.sortDirection === "asc" ? "تصاعدي ↑" : "تنازلي ↓"}
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p data-testid="instructors-count" className="text-muted-foreground">
            عرض {visibleRows?.length ?? 0} من {rows?.length ?? 0}
          </p>
          {hasActiveDirectoryFilters(directory) && (
            <Button variant="ghost" onClick={() => setDirectory({ ...DEFAULT_DIRECTORY_FILTERS })}>
              مسح الفلاتر
            </Button>
          )}
        </div>
      </Card>

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
          <div className="space-y-2 p-6 text-center text-muted-foreground">
            <p>
              {hasActiveDirectoryFilters(directory)
                ? "لا توجد نتائج مطابقة للبحث أو الفلاتر الحالية."
                : review
                  ? "لا توجد سجلات ناقصة بهذا المعيار في الكلية الحالية."
                  : "لا يوجد محاضرون بعد."}
            </p>
            {hasActiveDirectoryFilters(directory) && (
              <Button
                variant="outline"
                onClick={() => setDirectory({ ...DEFAULT_DIRECTORY_FILTERS })}
              >
                مسح الفلاتر
              </Button>
            )}
          </div>
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
                  <p className="text-xs text-muted-foreground">
                    الحالة: {availabilityStatusLabelAr(i.availability_status)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    الرقم الجامعي: <span dir="ltr">{i.university_number ?? "—"}</span>
                  </p>
                  <FacultyIdentityLink instructorId={i.id} name={i.full_name} />
                  <p
                    className={`mt-1 text-sm ${isMissingInstructorSpecialization(i) ? "font-medium text-amber-800" : "text-muted-foreground"}`}
                  >
                    التخصص:{" "}
                    {isMissingInstructorSpecialization(i)
                      ? "غير محدد — يحتاج استكمالًا"
                      : i.specialization}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {i.academic_rank ?? "—"} · {employmentTypeLabelAr(i.employment_type)} ·{" "}
                    {i.max_weekly_hours} س/أسبوع
                  </p>
                  <InstructorHomeAffiliation
                    home={{
                      home_college_id: i.home_college_id,
                      home_college: i.home_college_name,
                      home_department: i.home_department,
                    }}
                    currentCollegeId={active.id}
                    defaultCategoryLabel={rowCategoryLabel(i)}
                  />
                  {(i.email || i.phone) && (
                    <p className="text-xs text-muted-foreground" dir="ltr">
                      {i.email ?? ""} {i.phone ? ` · ${i.phone}` : ""}
                    </p>
                  )}
                  {i.admin_tasks && (
                    <p className="text-xs text-muted-foreground">الصفة: {i.admin_tasks}</p>
                  )}
                </div>
                {canEdit && i.can_edit && (
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
                    {canManage && i.can_delete && (
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
                    )}
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
