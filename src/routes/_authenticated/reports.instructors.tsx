import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAccessibleColleges, useActiveCollege } from "@/hooks/use-colleges";
import { useCurrentUser } from "@/hooks/use-current-user";
import { ReportShell } from "@/components/reports/report-shell";
import { ReportDataTable, ReportSection } from "@/components/reports/report-section";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { effectiveInstructorWeeklyHours } from "@/lib/instructors/effective-hours";
import { ADMINISTRATIVE_POSITION_OPTIONS } from "@/lib/instructors/administrative-positions";
import { employmentTypeLabelAr } from "@/lib/instructor-metadata";
import { filterRowsBySearch } from "@/lib/reports/search";

export const Route = createFileRoute("/_authenticated/reports/instructors")({
  head: () => ({ meta: [{ title: "دليل المحاضرين وبياناتهم" }] }),
  component: Page,
});

type InstructorRow = {
  id: string;
  college_id: string;
  full_name: string;
  full_name_ar: string | null;
  employee_number: string | null;
  affiliation_college_id: string | null;
  affiliation_department_id: string | null;
  specialization: string | null;
  academic_rank: string | null;
  instructor_type_id: string | null;
  max_weekly_hours: number;
  administrative_release_hours: number;
  administrative_position: string | null;
  administrative_department_id: string | null;
  administrative_support_department_id: string | null;
  employment_type: string;
  email: string | null;
  phone: string | null;
  is_active: boolean;
};

function Page() {
  const { active } = useActiveCollege();
  return active ? <Report key={active.id} /> : <Card className="p-6">اختر كلية لعرض التقرير.</Card>;
}

function Report() {
  const { active } = useActiveCollege();
  const { data: colleges } = useAccessibleColleges();
  const { data: me } = useCurrentUser();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [typeId, setTypeId] = useState("all");
  const [departmentId, setDepartmentId] = useState("all");

  const instructors = useQuery({
    queryKey: ["report-instructor-directory", active?.id],
    enabled: !!active,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("instructors")
        .select(
          "id, college_id, full_name, full_name_ar, employee_number, affiliation_college_id, affiliation_department_id, specialization, academic_rank, instructor_type_id, max_weekly_hours, administrative_release_hours, administrative_position, administrative_department_id, administrative_support_department_id, employment_type, email, phone, is_active",
        )
        .eq("college_id", active!.id)
        .order("full_name");
      if (error) throw error;
      return (data ?? []) as InstructorRow[];
    },
  });

  const departments = useQuery({
    queryKey: ["report-instructor-directory-departments", me?.collegeIds],
    enabled: !!me,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("departments")
        .select("id, name, college_id")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const supportDepartments = useQuery({
    queryKey: ["report-instructor-directory-support-departments", me?.collegeIds],
    enabled: !!me,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_departments")
        .select("id, name, college_id")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const types = useQuery({
    queryKey: ["report-instructor-directory-types", active?.id],
    enabled: !!active,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("instructor_types")
        .select("id, name_ar")
        .eq("college_id", active!.id)
        .order("display_order");
      if (error) throw error;
      return data ?? [];
    },
  });

  const collegeMap = useMemo(
    () => new Map((colleges ?? []).map((c) => [c.id, c.name])),
    [colleges],
  );
  const departmentMap = useMemo(
    () => new Map((departments.data ?? []).map((d) => [d.id, d.name])),
    [departments.data],
  );
  const supportMap = useMemo(
    () => new Map((supportDepartments.data ?? []).map((d) => [d.id, d.name])),
    [supportDepartments.data],
  );
  const typeMap = useMemo(
    () => new Map((types.data ?? []).map((t) => [t.id, t.name_ar])),
    [types.data],
  );
  const positionMap = useMemo(
    () => new Map(ADMINISTRATIVE_POSITION_OPTIONS.map((p) => [p.value, p.label])),
    [],
  );

  const allRows = useMemo(
    () =>
      (instructors.data ?? []).map((i) => ({
        employee_number: i.employee_number ?? "—",
        instructor: i.full_name,
        full_name_ar: i.full_name_ar ?? "—",
        affiliation_college: collegeMap.get(i.affiliation_college_id ?? i.college_id) ?? "—",
        affiliation_department: departmentMap.get(i.affiliation_department_id ?? "") ?? "—",
        specialization: i.specialization ?? "—",
        academic_rank: i.academic_rank ?? "—",
        instructor_type: typeMap.get(i.instructor_type_id ?? "") ?? "—",
        base_quota: i.max_weekly_hours,
        admin_release: i.administrative_release_hours,
        effective_quota:
          effectiveInstructorWeeklyHours(i.max_weekly_hours, i.administrative_release_hours) ?? 0,
        administrative_position: i.administrative_position
          ? (positionMap.get(i.administrative_position as never) ?? i.administrative_position)
          : "—",
        administrative_unit:
          departmentMap.get(i.administrative_department_id ?? "") ??
          supportMap.get(i.administrative_support_department_id ?? "") ??
          "—",
        employment_type: employmentTypeLabelAr(i.employment_type),
        email: i.email ?? "—",
        phone: i.phone ?? "—",
        status: i.is_active ? "نشط" : "غير نشط",
        _status: i.is_active ? "active" : "inactive",
        _type_id: i.instructor_type_id ?? "none",
        _department_id: i.affiliation_department_id ?? "none",
      })),
    [instructors.data, collegeMap, departmentMap, supportMap, typeMap, positionMap],
  );

  const rows = useMemo(() => {
    let value = allRows;
    if (status !== "all") value = value.filter((r) => r._status === status);
    if (typeId !== "all") value = value.filter((r) => r._type_id === typeId);
    if (departmentId !== "all") value = value.filter((r) => r._department_id === departmentId);
    return filterRowsBySearch(value, search).map(
      ({ _status, _type_id, _department_id, ...row }) => row,
    );
  }, [allRows, status, typeId, departmentId, search]);

  const activeCount = rows.filter((r) => r.status === "نشط").length;
  const totalQuota = rows.reduce((sum, r) => sum + Number(r.effective_quota || 0), 0);
  const departmentItems = (departments.data ?? []).filter((d) =>
    (instructors.data ?? []).some((i) => i.affiliation_department_id === d.id),
  );

  const headers = [
    { key: "employee_number", label: "رقم الموظف" },
    { key: "instructor", label: "الاسم الافتراضي" },
    { key: "full_name_ar", label: "الاسم الرباعي" },
    { key: "affiliation_college", label: "كلية التبعية" },
    { key: "affiliation_department", label: "قسم التبعية" },
    { key: "specialization", label: "التخصص" },
    { key: "academic_rank", label: "الرتبة العلمية" },
    { key: "instructor_type", label: "فئة المحاضر" },
    { key: "base_quota", label: "النصاب الأساسي" },
    { key: "admin_release", label: "الإعفاء الإداري" },
    { key: "effective_quota", label: "النصاب الفعلي" },
    { key: "administrative_position", label: "المنصب الإداري" },
    { key: "administrative_unit", label: "الجهة الإدارية" },
    { key: "employment_type", label: "حالة التفرغ/التعاقد" },
    { key: "email", label: "البريد الإلكتروني" },
    { key: "phone", label: "التلفون/الواتساب" },
    { key: "status", label: "الحالة" },
  ];

  const error = instructors.error ?? departments.error ?? supportDepartments.error ?? types.error;
  const isLoading =
    instructors.isLoading ||
    departments.isLoading ||
    supportDepartments.isLoading ||
    types.isLoading;
  const filterSummary = [
    status === "all" ? "كل الحالات" : status === "active" ? "نشط" : "غير نشط",
    typeId === "all" ? "كل الفئات" : (typeMap.get(typeId) ?? "فئة محددة"),
    departmentId === "all" ? "كل الأقسام" : (departmentMap.get(departmentId) ?? "قسم محدد"),
    search.trim() ? `بحث: ${search.trim()}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <ReportShell
      title="دليل المحاضرين وبياناتهم"
      description="كشف إداري ببيانات المحاضرين الأساسية والتبعية والنصاب ووسائل التواصل والحالة."
      filename="instructors_directory"
      rows={rows}
      headers={headers}
      isLoading={isLoading}
      error={error}
      onRetry={() => {
        void instructors.refetch();
        void departments.refetch();
        void supportDepartments.refetch();
        void types.refetch();
      }}
      filterSummary={filterSummary}
      kpis={[
        { label: "المحاضرون", value: rows.length },
        { label: "النشطون", value: activeCount, tone: "accent" },
        { label: "غير النشطين", value: rows.length - activeCount },
        { label: "إجمالي النصاب الفعلي", value: totalQuota, tone: "accent" },
      ]}
      filters={
        <Card className="report-no-print grid gap-3 p-4 md:grid-cols-4">
          <div>
            <label className="text-xs text-muted-foreground">بحث</label>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="الاسم، رقم الموظف، البريد…"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">الحالة</label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                <SelectItem value="active">نشط</SelectItem>
                <SelectItem value="inactive">غير نشط</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">فئة المحاضر</label>
            <Select value={typeId} onValueChange={setTypeId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                {(types.data ?? []).map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name_ar}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">قسم التبعية</label>
            <Select value={departmentId} onValueChange={setDepartmentId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                {departmentItems.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {me?.isInstitutionalViewer && (
            <div className="md:col-span-4 flex justify-end">
              <Button asChild variant="outline" size="sm">
                <Link to="/instructors">تعديل بيانات المحاضرين</Link>
              </Button>
            </div>
          )}
        </Card>
      }
      emptyMessage={
        search ? "لا توجد بيانات محاضرين مطابقة للبحث." : "لا توجد بيانات محاضرين في هذه الكلية."
      }
    >
      <ReportSection title="بيانات المحاضرين" count={rows.length} bodyClassName="p-0">
        <ReportDataTable
          rows={rows}
          caption="دليل المحاضرين وبياناتهم"
          minWidthClassName="min-w-[1500px]"
          columns={headers.map((h) => ({
            key: h.key,
            label: h.label,
            numeric: ["base_quota", "admin_release", "effective_quota"].includes(h.key),
            secondary: ["email", "phone", "administrative_unit"].includes(h.key),
          }))}
        />
      </ReportSection>
    </ReportShell>
  );
}
