import { facultyWorkflow } from "@/lib/instructors/faculty-workflow";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAccessibleColleges, useActiveCollege } from "@/hooks/use-colleges";
import { useCurrentUser } from "@/hooks/use-current-user";
import { ReportShell } from "@/components/reports/report-shell";
import { ReportFilterBar, ReportFilterField } from "@/components/reports/report-filter-bar";
import {
  ReportDataTable,
  ReportSection,
  type ReportColumn,
} from "@/components/reports/report-section";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  university_number?: string | null;
  approved_quota?: number | null;
  resolved_home_name?: string | null;
  resolved_home_department?: string | null;
  affiliation_college_id: string | null;
  affiliation_department_id: string | null;
  specialization: string | null;
  academic_rank: string | null;
  instructor_type_id: string | null;
  max_weekly_hours: number | null;
  administrative_release_hours: number | null;
  administrative_position: string | null;
  administrative_department_id: string | null;
  administrative_support_department_id: string | null;
  employment_type: string;
  email: string | null;
  phone: string | null;
  is_active: boolean;
};

const AFFILIATION_LABELS: Record<string, string> = {
  all: "كل جهات التبعية",
  internal: "من داخل الكلية",
  external: "من خارج الكلية",
  unknown: "تبعية غير محددة",
};

function instructorAffiliation(i: InstructorRow, typeCode?: string): string {
  if (typeCode === "from_other_college" && !i.affiliation_college_id) return "unknown";
  if (!i.affiliation_college_id) return "unknown";
  return i.affiliation_college_id === i.college_id ? "internal" : "external";
}

type InstructorDirectoryDisplayRow = Record<string, string | number>;

const instructorText = (value: unknown) =>
  value === null || value === undefined || value === "" ? "—" : String(value);

function InstructorIdentityCell({ row }: { row: InstructorDirectoryDisplayRow }) {
  const arabicName =
    row.full_name_ar && row.full_name_ar !== "—" && row.full_name_ar !== row.instructor
      ? String(row.full_name_ar)
      : "";
  return (
    <div className="min-w-[180px] space-y-0.5 leading-5">
      <div className="font-semibold">{instructorText(row.instructor)}</div>
      {arabicName && <div className="text-[11px] text-muted-foreground">{arabicName}</div>}
      <div className="text-[10px] tabular-nums text-muted-foreground">
        جامعي: {instructorText(row.university_number)} · موظف: {instructorText(row.employee_number)}
      </div>
    </div>
  );
}

function InstructorAffiliationCell({ row }: { row: InstructorDirectoryDisplayRow }) {
  return (
    <div className="min-w-[155px] space-y-0.5 leading-5">
      <div className="font-semibold">{instructorText(row.affiliation_scope)}</div>
      <div className="text-[11px] text-muted-foreground">
        {instructorText(row.affiliation_college)}
      </div>
      <div className="text-[10px] text-muted-foreground">
        {instructorText(row.affiliation_department)}
      </div>
    </div>
  );
}

function InstructorAcademicCell({ row }: { row: InstructorDirectoryDisplayRow }) {
  return (
    <div className="min-w-[160px] space-y-0.5 leading-5">
      <div className="font-semibold">{instructorText(row.academic_rank)}</div>
      <div className="text-[11px] text-muted-foreground">{instructorText(row.specialization)}</div>
      <div className="text-[10px] text-muted-foreground">
        {instructorText(row.instructor_type)} · {instructorText(row.employment_type)}
      </div>
    </div>
  );
}

function InstructorQuotaCell({ row }: { row: InstructorDirectoryDisplayRow }) {
  return (
    <div className="min-w-[155px] space-y-0.5 leading-5">
      <div className="flex justify-between gap-3">
        <span className="text-[11px] text-muted-foreground">الأساسي</span>
        <span className="tabular-nums">{instructorText(row.base_quota)} س</span>
      </div>
      <div className="flex justify-between gap-3">
        <span className="text-[11px] text-muted-foreground">الإعفاء</span>
        <span className="tabular-nums">{instructorText(row.admin_release)} س</span>
      </div>
      <div className="flex justify-between gap-3 font-semibold">
        <span>الصافي</span>
        <span className="tabular-nums">{instructorText(row.effective_quota)} س</span>
      </div>
      {row.administrative_position !== "—" && (
        <div className="pt-0.5 text-[10px] text-muted-foreground">
          {instructorText(row.administrative_position)}
          {row.administrative_unit !== "—" ? ` · ${instructorText(row.administrative_unit)}` : ""}
        </div>
      )}
    </div>
  );
}

function InstructorContactCell({ row }: { row: InstructorDirectoryDisplayRow }) {
  return (
    <div className="min-w-[170px] space-y-0.5 leading-5">
      <div className="font-semibold">{instructorText(row.status)}</div>
      <div className="text-[11px] text-muted-foreground">{instructorText(row.phone)}</div>
      <div className="break-all text-[10px] text-muted-foreground">{instructorText(row.email)}</div>
    </div>
  );
}

function compactInstructorDirectoryColumns(): ReportColumn<InstructorDirectoryDisplayRow>[] {
  return [
    {
      key: "instructor",
      label: "المحاضر والهوية",
      className: "w-[25%]",
      render: (row) => <InstructorIdentityCell row={row} />,
    },
    {
      key: "affiliation_scope",
      label: "التبعية",
      className: "w-[19%]",
      render: (row) => <InstructorAffiliationCell row={row} />,
    },
    {
      key: "academic_rank",
      label: "البيانات الأكاديمية",
      className: "w-[20%]",
      render: (row) => <InstructorAcademicCell row={row} />,
    },
    {
      key: "effective_quota",
      label: "النصاب والإدارة",
      className: "w-[19%]",
      render: (row) => <InstructorQuotaCell row={row} />,
    },
    {
      key: "status",
      label: "التواصل والحالة",
      className: "w-[17%]",
      render: (row) => <InstructorContactCell row={row} />,
    },
  ];
}

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
  const [affiliation, setAffiliation] = useState("internal");
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
      const { data: homes, error: homeError } = await facultyWorkflow.rpc(
        "get_faculty_home_profiles",
        { p_college_id: active!.id },
      );
      if (homeError) throw homeError;
      const { data: nativeRecords, error: nativeError } = await facultyWorkflow.rpc(
        "get_college_faculty_roster",
        { p_college_id: active!.id, p_scope: "home" },
      );
      if (nativeError) throw nativeError;
      const nativeByNumber = new Map(
        (nativeRecords ?? []).map((record) => [record.university_number, record]),
      );
      return (homes ?? [])
        .filter((h) => h.home_college_id !== active!.id || nativeByNumber.has(h.university_number))
        .map((h): InstructorRow => {
          const local =
            nativeByNumber.get(h.university_number) ??
            (data ?? []).find((i) => h.members.some((m) => m.id === i.id));
          return {
            id: h.identity_id,
            full_name: h.name,
            full_name_ar: h.name,
            employee_number: null,
            affiliation_department_id: null,
            instructor_type_id: null,
            max_weekly_hours: null,
            administrative_release_hours: null,
            administrative_position: null,
            administrative_department_id: null,
            administrative_support_department_id: null,
            email: null,
            phone: null,
            ...local,
            college_id: active!.id,
            university_number: h.university_number,
            affiliation_college_id: h.home_college_id,
            resolved_home_name: h.home_college,
            resolved_home_department: h.home_department,
            approved_quota: h.quota,
            is_active: h.is_active,
            academic_rank: h.academic_rank,
            specialization: h.specialization,
            employment_type: h.employment_type,
          };
        });
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
        .select("id, name_ar, code")
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
  const typeCodeMap = useMemo(
    () => new Map((types.data ?? []).map((t) => [t.id, t.code])),
    [types.data],
  );
  const positionMap = useMemo(
    () => new Map(ADMINISTRATIVE_POSITION_OPTIONS.map((p) => [p.value, p.label])),
    [],
  );

  const allRows = useMemo(
    () =>
      (instructors.data ?? []).map((i) => ({
        university_number: i.university_number ?? "—",
        employee_number: i.employee_number ?? "—",
        instructor: i.full_name,
        full_name_ar: i.full_name_ar ?? "—",
        affiliation_college:
          i.resolved_home_name ?? collegeMap.get(i.affiliation_college_id ?? "") ?? "غير محدد",
        affiliation_scope:
          AFFILIATION_LABELS[instructorAffiliation(i, typeCodeMap.get(i.instructor_type_id ?? ""))],
        affiliation_department:
          i.resolved_home_department ?? departmentMap.get(i.affiliation_department_id ?? "") ?? "—",
        specialization: i.specialization ?? "—",
        academic_rank: i.academic_rank ?? "—",
        instructor_type: typeMap.get(i.instructor_type_id ?? "") ?? "—",
        base_quota: i.max_weekly_hours ?? "—",
        admin_release: i.administrative_release_hours ?? "—",
        effective_quota: i.approved_quota ?? "بانتظار الاعتماد",
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
        _affiliation: instructorAffiliation(i, typeCodeMap.get(i.instructor_type_id ?? "")),
        _department_id: i.affiliation_department_id ?? "none",
      })),
    [instructors.data, collegeMap, departmentMap, supportMap, typeMap, typeCodeMap, positionMap],
  );

  const rows = useMemo(() => {
    let value = allRows;
    if (status !== "all") value = value.filter((r) => r._status === status);
    if (typeId !== "all") value = value.filter((r) => r._type_id === typeId);
    if (affiliation !== "all") value = value.filter((r) => r._affiliation === affiliation);
    if (departmentId !== "all") value = value.filter((r) => r._department_id === departmentId);
    return filterRowsBySearch(value, search).map(
      ({ _status, _type_id, _department_id, _affiliation, ...row }) => row,
    );
  }, [allRows, status, typeId, departmentId, affiliation, search]);

  const activeCount = rows.filter((r) => r.status === "نشط").length;
  const totalQuota = rows.reduce(
    (sum, r) =>
      sum +
      (typeof r.effective_quota === "number" && r.affiliation_scope === AFFILIATION_LABELS.internal
        ? r.effective_quota
        : 0),
    0,
  );
  const externalCount = rows.filter(
    (r) => r.affiliation_scope === AFFILIATION_LABELS.external,
  ).length;
  const missingAffiliation = rows.filter((r) => {
    return (
      r.affiliation_scope === AFFILIATION_LABELS.unknown || r.affiliation_college === "غير محدد"
    );
  }).length;
  const departmentItems = (departments.data ?? []).filter((d) =>
    (instructors.data ?? []).some((i) => i.affiliation_department_id === d.id),
  );

  const headers = [
    { key: "university_number", label: "الرقم الجامعي الموحّد" },
    { key: "employee_number", label: "رقم الموظف" },
    { key: "instructor", label: "الاسم الافتراضي" },
    { key: "full_name_ar", label: "الاسم الرباعي" },
    { key: "affiliation_college", label: "كلية التبعية" },
    { key: "affiliation_scope", label: "نطاق التبعية" },
    { key: "affiliation_department", label: "قسم التبعية" },
    { key: "specialization", label: "التخصص" },
    { key: "academic_rank", label: "الرتبة العلمية" },
    { key: "instructor_type", label: "فئة المحاضر" },
    { key: "base_quota", label: "النصاب الأساسي المسجل" },
    { key: "admin_release", label: "الإعفاء الإداري" },
    { key: "effective_quota", label: "النصاب الفعلي المعتمد من الأصلية" },
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
  const activeFilterSummary = [
    search.trim() ? `بحث: ${search.trim()}` : "",
    status === "all" ? "" : `الحالة: ${status === "active" ? "نشط" : "غير نشط"}`,
    typeId === "all" ? "" : `الفئة: ${typeMap.get(typeId) ?? "غير محدد"}`,
    affiliation === "internal" ? "" : AFFILIATION_LABELS[affiliation],
    departmentId === "all" ? "" : `القسم: ${departmentMap.get(departmentId) ?? "قسم محدد"}`,
  ].filter(Boolean);
  const filterSummary = [
    status === "all" ? "كل الحالات" : status === "active" ? "نشط" : "غير نشط",
    typeId === "all" ? "كل الفئات" : (typeMap.get(typeId) ?? "غير محدد"),
    AFFILIATION_LABELS[affiliation],
    departmentId === "all" ? "كل الأقسام" : (departmentMap.get(departmentId) ?? "قسم محدد"),
    search.trim() ? `بحث: ${search.trim()}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <ReportShell
      title="دليل المحاضرين وبياناتهم"
      description="يعرض أعضاء الكلية الأصليين افتراضيًا. لعرض المحاضرين من كليات أخرى أو السجلات غير المحسومة، اختر نطاق التبعية من الفلتر."
      filename="instructors_directory"
      printOrientation="landscape"
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
        { label: "السجلات المعروضة", value: rows.length },
        {
          label: "التابعون للكلية",
          value: rows.filter((r) => r.affiliation_scope === AFFILIATION_LABELS.internal).length,
        },
        { label: "النشطون", value: activeCount, tone: "accent" },
        { label: "من خارج الكلية", value: externalCount },
        {
          label: "تبعية غير مكتملة",
          value: missingAffiliation,
          tone: missingAffiliation > 0 ? "warning" : "neutral",
        },
        { label: "نصاب أعضاء الكلية المعتمد", value: totalQuota, tone: "accent" },
      ]}
      filters={
        <div className="space-y-2">
          <ReportFilterBar
            search={{
              value: search,
              onChange: setSearch,
              placeholder: "الاسم، الرقم الجامعي، رقم الموظف، البريد…",
            }}
            basic={
              <>
                <ReportFilterField label="الحالة">
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
                </ReportFilterField>
                <ReportFilterField label="فئة المحاضر">
                  <Select value={typeId} onValueChange={setTypeId}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">الكل</SelectItem>
                      <SelectItem value="none">غير محدد</SelectItem>
                      {(types.data ?? []).map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name_ar}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </ReportFilterField>
                <ReportFilterField label="تبعية المحاضر">
                  <Select value={affiliation} onValueChange={setAffiliation}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(AFFILIATION_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </ReportFilterField>
              </>
            }
            advanced={
              <ReportFilterField label="قسم التبعية">
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
              </ReportFilterField>
            }
            activeSummary={activeFilterSummary}
            onClear={
              activeFilterSummary.length
                ? () => {
                    setSearch("");
                    setStatus("all");
                    setTypeId("all");
                    setAffiliation("internal");
                    setDepartmentId("all");
                  }
                : undefined
            }
          />
          {me?.isInstitutionalViewer && (
            <div className="report-no-print flex justify-end">
              <Button asChild variant="outline" size="sm">
                <Link to="/instructors">تعديل بيانات المحاضرين</Link>
              </Button>
            </div>
          )}
        </div>
      }
      emptyMessage={
        activeFilterSummary.length
          ? "لا توجد بيانات محاضرين مطابقة للفلاتر."
          : "لا توجد بيانات محاضرين في هذه الكلية."
      }
    >
      <ReportSection title="بيانات المحاضرين" count={rows.length} bodyClassName="p-0">
        <ReportDataTable
          rows={rows}
          caption="دليل المحاضرين وبياناتهم"
          minWidthClassName="min-w-[820px]"
          primaryColumnLimit={6}
          columns={
            compactInstructorDirectoryColumns() as unknown as ReportColumn<(typeof rows)[number]>[]
          }
        />
      </ReportSection>
    </ReportShell>
  );
}
