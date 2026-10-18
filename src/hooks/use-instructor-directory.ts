import { facultyWorkflow, type FacultyRosterRecord } from "@/lib/instructors/faculty-workflow";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAccessibleColleges, useActiveCollege } from "@/hooks/use-colleges";
import { useCanEditInstructorsActiveCollege, useCanManageActiveCollege } from "@/hooks/use-can-manage";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import { ACADEMIC_RANKS, UNKNOWN_EMPLOYMENT_TYPE, DEFAULT_AVAILABILITY_STATUS } from "@/lib/instructor-metadata";
import { effectiveInstructorWeeklyHours, isHourlyContractTypeCode } from "@/lib/instructors/effective-hours";
import { requiresAdministrativeDepartment } from "@/lib/instructors/administrative-positions";
import { instructorNeedsReview, type InstructorReview } from "@/lib/data-onboarding/instructor-review";
import {
  DEFAULT_DIRECTORY_FILTERS,
  filterAndSortInstructors,
  type DirectoryFilters,
} from "@/lib/instructors/directory-filters";
import { userErrorMessage } from "@/lib/user-error";
import { useRowWindow } from "@/hooks/use-row-window";

/**
 * State, reads and writes of the instructors directory page (roster, lookups, form,
 * save/delete) plus its shared types. Split from routes/_authenticated/instructors.tsx
 * (L-14); the page keeps the JSX and the route-bound search params.
 */
export type Instructor = FacultyRosterRecord;

export interface InstructorTypeRow {
  id: string;
  code: string | null;
  name_ar: string;
  is_external: boolean | null;
}

export const RANKS = ACADEMIC_RANKS;

export function emptyForm() {
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

export const EMPTY_ROSTER: Instructor[] = [];

export type InstructorJump = { collegeId: string; scope: "home" | "pending"; search: string };

export function useInstructorDirectory({
  initialJump,
  review,
}: {
  initialJump: InstructorJump | null;
  review: InstructorReview | undefined;
}) {
  const { active } = useActiveCollege();
  const { data: accessibleColleges } = useAccessibleColleges();
  const canManage = useCanManageActiveCollege();
  const canEdit = useCanEditInstructorsActiveCollege();
  const qc = useQueryClient();
  const [scope, setScope] = useState<"home" | "visiting" | "pending">(initialJump?.scope ?? "home");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Instructor | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [repairField, setRepairField] = useState<InstructorReview | null>(null);
  const [directory, setDirectory] = useState<DirectoryFilters>({
    ...DEFAULT_DIRECTORY_FILTERS,
    search: initialJump?.search ?? "",
  });
  const setDirectoryField = <K extends keyof DirectoryFilters>(
    key: K,
    value: DirectoryFilters[K],
  ) => setDirectory((prev) => ({ ...prev, [key]: value }));

  const specializationRef = useRef<HTMLInputElement>(null);
  const departmentRef = useRef<HTMLButtonElement>(null);

  const { data: depts, error: deptsError } = useQuery({
    queryKey: ["departments", active?.id, "including-archived"],
    enabled: !!active,
    queryFn: async () => {
      // read-all-ok: departments of one college (tens)
      const { data, error } = await supabase
          .from("departments")
          .select("id, name")
          .eq("college_id", active!.id)
          .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const {
    data: types,
    isLoading: typesLoading,
    isError: typesError,
  } = useQuery({
    queryKey: ["instructor-types", active?.id],
    enabled: !!active,
    queryFn: async () => {
      // read-all-ok: instructor types of one college (a handful)
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
  const { data: affiliationDepts, error: affiliationDeptsError } = useQuery({
    queryKey: ["instructor-affiliation-depts", affiliationCollegeId],
    enabled: !!affiliationCollegeId,
    queryFn: async () => {
      // read-all-ok: departments of one college (tens)
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
      // read-all-ok: support departments of one college (a handful)
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
      toast.error(e.message.includes("duplicate") ? "القسم المساند موجود بالفعل" : userErrorMessage(e)),
  });

  const {
    data: rows,
    isLoading,
    isError,
    error: rosterError,
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
        "reports-data-readiness",
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
        e.message.includes("duplicate") ? "رقم الموظف مستخدم بالفعل في هذه الكلّية" : userErrorMessage(e),
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
    onError: (e: Error) => toast.error(userErrorMessage(e)),
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
  const rowWindow = useRowWindow(visibleRows ?? EMPTY_ROSTER);
  const lookupError = deptsError ?? affiliationDeptsError;
  const availableRanks = Array.from(
    new Set((rows ?? []).map((i) => i.academic_rank ?? "").filter((r) => r !== "")),
  ).sort((a, b) => String(a).localeCompare(String(b), "ar"));

  return {
    active, accessibleColleges, canManage, canEdit, qc, scope, setScope, open, setOpen, editing, setEditing, form, setForm, repairField, setRepairField, directory, setDirectory, setDirectoryField, specializationRef, departmentRef, depts, deptsError, types, typesLoading, typesError, supportName, setSupportName, affiliationCollegeId, registrationMatches, affiliationDepts, affiliationDeptsError, supportQuery, addSupport, rows, isLoading, isError, rosterError, refetch, save, del, startEdit, startCreate, deptMap, typeRows, typeMap, selectedType, scopeLabel, rowCategoryLabel, hourlyContract, effectiveQuota, reviewRows, departmentLabel, visibleRows, rowWindow, lookupError, availableRanks,
  };
}
