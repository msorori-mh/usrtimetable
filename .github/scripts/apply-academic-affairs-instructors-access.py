from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    s = p.read_text()
    if old not in s:
        raise SystemExit(f"anchor not found in {path}: {old[:120]!r}")
    p.write_text(s.replace(old, new, 1))


def write(path: str, content: str):
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content)


# 1) Recast institutional_viewer as the dedicated academic-affairs role.
path = "src/lib/viewer-roles.ts"
s = Path(path).read_text()
s = s.replace("export const INSTITUTIONAL_VIEWER_ROLE_LABEL_AR = \"مشاهد مؤسسي\";", "export const INSTITUTIONAL_VIEWER_ROLE_LABEL_AR = \"إدارة الشؤون الأكاديمية\";")
s = s.replace(
    'export const INSTITUTIONAL_VIEWER_ROLE_HINT_AR =\n  "استعراض كامل محتويات المنصة في جميع الكلّيات للقراءة فقط، بدون أي إضافة أو تعديل أو حذف.";',
    'export const INSTITUTIONAL_VIEWER_ROLE_HINT_AR =\n  "تقارير جميع الكلّيات مع صلاحية تعديل البيانات الأساسية للمحاضرين فقط، دون إنشاء/حذف محاضرين أو تعديل بقية بيانات المنصة.";',
)
s = s.replace(
    'export const INSTITUTIONAL_VIEWER_CREATE_NOTE_AR =\n  "حساب «مشاهد مؤسسي»: يستعرض كامل صفحات المنصة في جميع الكلّيات للقراءة فقط. تُسند له تلقائيًا جميع الكلّيات الحالية وأي كلّية تُنشأ لاحقًا، بدون أي صلاحية تعديل.";',
    'export const INSTITUTIONAL_VIEWER_CREATE_NOTE_AR =\n  "حساب «إدارة الشؤون الأكاديمية»: يرى التقارير في جميع الكلّيات، ويستطيع تعديل البيانات الأساسية للمحاضرين فقط. تُسند له تلقائيًا جميع الكلّيات الحالية وأي كلّية تُنشأ لاحقًا.";',
)
# Replace the old full-platform helper with a scoped academic-affairs contract while keeping an alias for compatibility.
old = '''/** True for an `institutional_viewer` account without any admin role: full read-only platform view. */
export function isFullPlatformViewerRole(me: RoleFlags | null | undefined): boolean {
  return !!me && !hasAdminRole(me) && !!me.isInstitutionalViewer;
}
'''
new = '''/** Dedicated academic-affairs account: reports + instructor data only. */
export function isAcademicAffairsRole(me: RoleFlags | null | undefined): boolean {
  return !!me && !hasAdminRole(me) && !!me.isInstitutionalViewer;
}

/** @deprecated institutional_viewer is no longer a full-platform viewer. */
export function isFullPlatformViewerRole(me: RoleFlags | null | undefined): boolean {
  return false && isAcademicAffairsRole(me);
}
'''
if old not in s:
    raise SystemExit("viewer full-platform helper anchor not found")
s = s.replace(old, new, 1)
old = '''/** Returns the redirect target when the reports-only role opened a forbidden path. */
export function resolveReportsOnlyRedirect(
  me: RoleFlags | null | undefined,
  pathname: string,
): typeof REPORTS_ONLY_HOME | null {
  if (!isReportsOnlyRole(me)) return null;
  return isReportsOnlyPath(pathname) ? null : REPORTS_ONLY_HOME;
}
'''
new = '''/** Academic affairs may open reports and the instructor directory/editor only. */
export function isAcademicAffairsPath(pathname: string): boolean {
  return isReportsOnlyPath(pathname) || pathname === "/instructors";
}

/** Returns the redirect target for restricted viewer roles. */
export function resolveViewerScopeRedirect(
  me: RoleFlags | null | undefined,
  pathname: string,
): typeof REPORTS_ONLY_HOME | null {
  if (isReportsOnlyRole(me)) return isReportsOnlyPath(pathname) ? null : REPORTS_ONLY_HOME;
  if (isAcademicAffairsRole(me)) return isAcademicAffairsPath(pathname) ? null : REPORTS_ONLY_HOME;
  return null;
}

/** Backward-compatible alias for the reports-only contract. */
export function resolveReportsOnlyRedirect(
  me: RoleFlags | null | undefined,
  pathname: string,
): typeof REPORTS_ONLY_HOME | null {
  if (!isReportsOnlyRole(me)) return null;
  return isReportsOnlyPath(pathname) ? null : REPORTS_ONLY_HOME;
}
'''
if old not in s:
    raise SystemExit("viewer redirect anchor not found")
s = s.replace(old, new, 1)
# Update top comments.
s = s.replace(
    ' * `institutional_viewer` — «مشاهد مؤسسي»:\n *  - may browse the whole platform across all colleges, read-only;\n *  - is NOT reports-only and is never redirected to /reports;\n *  - holds every current and future college as read scope, same as above.',
    ' * `institutional_viewer` — «إدارة الشؤون الأكاديمية»:\n *  - may open reports and the instructor directory/editor only;\n *  - may update basic instructor fields through a dedicated RPC, but cannot create/delete instructors;\n *  - holds every current and future college as scope, same as above.',
)
Path(path).write_text(s)

# 2) Gate both restricted viewer roles.
replace_once(
    "src/components/reports-only-gate.tsx",
    'import { resolveReportsOnlyRedirect, REPORTS_ONLY_HOME } from "@/lib/viewer-roles";',
    'import { resolveViewerScopeRedirect, REPORTS_ONLY_HOME } from "@/lib/viewer-roles";',
)
replace_once(
    "src/components/reports-only-gate.tsx",
    "  const redirectTo = isLoading ? null : resolveReportsOnlyRedirect(me, pathname);",
    "  const redirectTo = isLoading ? null : resolveViewerScopeRedirect(me, pathname);",
)
replace_once(
    "src/components/reports-only-gate.tsx",
    '        هذه الصفحة غير متاحة لحساب «مشاهد». جارٍ التحويل إلى مركز التقارير…',
    '        هذه الصفحة غير متاحة لصلاحيات حسابك. جارٍ التحويل إلى مركز التقارير…',
)

# 3) Navigation: academic affairs gets only instructors + reports.
path = "src/lib/admin-nav.ts"
s = Path(path).read_text()
s = s.replace(
    'export const OPERATIONAL: Role[] = ["super_admin", "college_admin", "institutional_viewer"];',
    'export const OPERATIONAL: Role[] = ["super_admin", "college_admin"];\n\n// Academic affairs is deliberately limited to reports + instructor data.\nexport const INSTRUCTOR_ACCESS: Role[] = ["super_admin", "college_admin", "institutional_viewer"];',
)
s = s.replace(
    '    roles: OPERATIONAL,\n    tier: "basic",\n    journey: "staff",\n  },\n  {\n    to: "/instructor-types",',
    '    roles: INSTRUCTOR_ACCESS,\n    tier: "basic",\n    journey: "staff",\n  },\n  {\n    to: "/instructor-types",',
    1,
)
Path(path).write_text(s)

# 4) Current-user documentation + capability hook.
replace_once(
    "src/hooks/use-current-user.ts",
    '   * Academic affairs («إدارة الشؤون الأكاديمية», DB value `institutional_viewer`):\n   * reports only, restricted to the colleges assigned in user_colleges, never writes.',
    '   * Academic affairs («إدارة الشؤون الأكاديمية», DB value `institutional_viewer`):\n   * reports + instructor data for assigned colleges; instructor edits use a dedicated RPC only.',
)
path = "src/hooks/use-can-manage.ts"
s = Path(path).read_text()
if "useCanEditInstructorsActiveCollege" not in s:
    s += '''\n\n/** Admins plus the dedicated academic-affairs role may edit existing instructor basic data. */\nexport function useCanEditInstructorsActiveCollege() {\n  const { active } = useActiveCollege();\n  const { data: me } = useCurrentUser();\n  return useMemo(() => {\n    if (!me || !active) return false;\n    if (me.isSuperAdmin) return true;\n    if (me.isCollegeAdmin && me.collegeIds.includes(active.id)) return true;\n    return me.isInstitutionalViewer && me.collegeIds.includes(active.id);\n  }, [me, active]);\n}\n'''
Path(path).write_text(s)

# 5) App layout: force academic affairs into the filtered all-tools nav and hide the mode toggle/admin tools.
path = "src/components/app-layout.tsx"
s = Path(path).read_text()
s = s.replace(
    '  READ_ONLY_ROLE_LABEL_AR,\n  isReportsOnlyRole,',
    '  READ_ONLY_ROLE_LABEL_AR,\n  isAcademicAffairsRole,\n  isReportsOnlyRole,',
)
s = s.replace(
    '  /** «مشاهد» (read_only only): reports centre only. */\n  const reportsOnly = isReportsOnlyRole(user);\n  const effectiveMode: NavMode = reportsOnly ? "core" : mode;',
    '  /** Restricted viewer scopes. */\n  const reportsOnly = isReportsOnlyRole(user);\n  const academicAffairs = isAcademicAffairsRole(user);\n  const restrictedViewer = reportsOnly || academicAffairs;\n  const effectiveMode: NavMode = reportsOnly ? "core" : academicAffairs ? "all" : mode;',
)
s = s.replace("  const modeToggle = reportsOnly ? null : (", "  const modeToggle = restrictedViewer ? null : (")
s = s.replace(
    '''          {reportsOnly
            ? "حساب مشاهد: مركز التقارير لجميع الكلّيات، قراءة وطباعة وتصدير فقط."
            : "أربع خطوات: تجهيز البيانات، إنشاء الجدول، المراجعة والاعتماد، التقارير والطباعة."}''',
    '''          {reportsOnly
            ? "حساب مشاهد: مركز التقارير لجميع الكلّيات، قراءة وطباعة وتصدير فقط."
            : academicAffairs
              ? "إدارة الشؤون الأكاديمية: التقارير وبيانات المحاضرين لجميع الكلّيات."
              : "أربع خطوات: تجهيز البيانات، إنشاء الجدول، المراجعة والاعتماد، التقارير والطباعة."}''',
)
s = s.replace("        {!reportsOnly && (", "        {!restrictedViewer && (", 1)
s = s.replace("              {!reportsOnly && (", "              {!restrictedViewer && (", 1)
Path(path).write_text(s)

# 6) Reports hub: hide publishing link for academic affairs and add instructor data report.
path = "src/routes/_authenticated/reports.index.tsx"
s = Path(path).read_text()
s = s.replace(
    'import { isReportsOnlyRole } from "@/lib/viewer-roles";',
    'import { isAcademicAffairsRole, isReportsOnlyRole } from "@/lib/viewer-roles";',
)
needle = '''const ANALYTICS_REPORTS: ReportCard[] = [
  {
    to: "/reports/academic-affairs",'''
insert = '''const ANALYTICS_REPORTS: ReportCard[] = [
  {
    to: "/reports/instructors",
    title: "دليل المحاضرين وبياناتهم",
    desc: "بيانات المحاضرين الأساسية، التبعية الأكاديمية، الرتبة، النصاب، الإعفاء الإداري، وسائل التواصل والحالة.",
    icon: <UserSquare2 className="h-5 w-5" />,
    badge: "official",
  },
  {
    to: "/reports/academic-affairs",'''
if needle not in s:
    raise SystemExit("reports hub analytics anchor not found")
s = s.replace(needle, insert, 1)
s = s.replace(
    '  const reportsOnly = isReportsOnlyRole(me);',
    '  const restrictedViewer = isReportsOnlyRole(me) || isAcademicAffairsRole(me);',
)
s = s.replace("          {!reportsOnly && (", "          {!restrictedViewer && (", 1)
Path(path).write_text(s)

# 7) Instructor page: academic affairs can edit existing records only, through dedicated RPC.
path = "src/routes/_authenticated/instructors.tsx"
s = Path(path).read_text()
s = s.replace(
    'import { useCanManageActiveCollege } from "@/hooks/use-can-manage";',
    'import {\n  useCanEditInstructorsActiveCollege,\n  useCanManageActiveCollege,\n} from "@/hooks/use-can-manage";',
)
s = s.replace(
    '  const canManage = useCanManageActiveCollege();\n  const qc = useQueryClient();',
    '  const canManage = useCanManageActiveCollege();\n  const canEdit = useCanEditInstructorsActiveCollege();\n  const qc = useQueryClient();',
)
s = s.replace(
    '      if (!canManage) throw new Error("صلاحيتك للقراءة فقط");',
    '      if (!canEdit) throw new Error("صلاحيتك للقراءة فقط");\n      if (!editing && !canManage) throw new Error("صلاحيتك تسمح بتعديل المحاضرين الحاليين فقط");',
)
old = '''      if (editing) {
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
      } else {'''
new = '''      if (editing && !canManage) {
        const { error } = await supabase.rpc(
          "academic_affairs_update_instructor" as never,
          {
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
          } as never,
        );
        if (error) throw error;
      } else if (editing) {
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
      } else {'''
if old not in s:
    raise SystemExit("instructors update block anchor not found")
s = s.replace(old, new, 1)
s = s.replace("        {canManage && (\n          <Dialog open={open} onOpenChange={setOpen}>", "        {canEdit && (\n          <Dialog open={open} onOpenChange={setOpen}>", 1)
s = s.replace(
    '''            <DialogTrigger asChild>
              <Button onClick={startCreate}>محاضر جديد</Button>
            </DialogTrigger>''',
    '''            {canManage && (
              <DialogTrigger asChild>
                <Button onClick={startCreate}>محاضر جديد</Button>
              </DialogTrigger>
            )}''',
    1,
)
old = '''                            <div className="flex gap-2">
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
                            </div>'''
new = '''                            {canManage && (
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
                            )}'''
if old not in s:
    raise SystemExit("support department create anchor not found")
s = s.replace(old, new, 1)
# Hide the onboarding return link from academic affairs.
s = s.replace(
    '''        <Button asChild variant="outline">
          <Link to="/data-onboarding" search={{ step: "readiness_check" }}>
            العودة إلى المراجعة النهائية
          </Link>
        </Button>''',
    '''        {canManage && (
          <Button asChild variant="outline">
            <Link to="/data-onboarding" search={{ step: "readiness_check" }}>
              العودة إلى المراجعة النهائية
            </Link>
          </Button>
        )}''',
    1,
)
# Existing-row actions: edit for academic affairs, delete only for admins.
s = s.replace("                {canManage && (\n                  <div className=\"flex flex-wrap gap-1\">", "                {canEdit && (\n                  <div className=\"flex flex-wrap gap-1\">", 1)
old = '''                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`حذف ${i.full_name}`}
                      onClick={() => {
                        if (confirm("حذف المحاضر؟")) del.mutate(i.id);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>'''
new = '''                    {canManage && (
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
                    )}'''
if old not in s:
    raise SystemExit("delete button anchor not found")
s = s.replace(old, new, 1)
Path(path).write_text(s)

# 8) Dedicated instructors report.
write(
    "src/routes/_authenticated/reports.instructors.tsx",
    r'''import { createFileRoute, Link } from "@tanstack/react-router";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
      const { data, error } = await supabase.from("departments").select("id, name, college_id").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const supportDepartments = useQuery({
    queryKey: ["report-instructor-directory-support-departments", me?.collegeIds],
    enabled: !!me,
    queryFn: async () => {
      const { data, error } = await supabase.from("support_departments").select("id, name, college_id").order("name");
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

  const collegeMap = useMemo(() => new Map((colleges ?? []).map((c) => [c.id, c.name])), [colleges]);
  const departmentMap = useMemo(
    () => new Map((departments.data ?? []).map((d) => [d.id, d.name])),
    [departments.data],
  );
  const supportMap = useMemo(
    () => new Map((supportDepartments.data ?? []).map((d) => [d.id, d.name])),
    [supportDepartments.data],
  );
  const typeMap = useMemo(() => new Map((types.data ?? []).map((t) => [t.id, t.name_ar])), [types.data]);
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
    return filterRowsBySearch(value, search).map(({ _status, _type_id, _department_id, ...row }) => row);
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
    instructors.isLoading || departments.isLoading || supportDepartments.isLoading || types.isLoading;
  const filterSummary = [
    status === "all" ? "كل الحالات" : status === "active" ? "نشط" : "غير نشط",
    typeId === "all" ? "كل الفئات" : typeMap.get(typeId) ?? "فئة محددة",
    departmentId === "all" ? "كل الأقسام" : departmentMap.get(departmentId) ?? "قسم محدد",
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
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="الاسم، رقم الموظف، البريد…" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">الحالة</label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
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
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                {(types.data ?? []).map((t) => <SelectItem key={t.id} value={t.id}>{t.name_ar}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">قسم التبعية</label>
            <Select value={departmentId} onValueChange={setDepartmentId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                {departmentItems.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
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
      emptyMessage={search ? "لا توجد بيانات محاضرين مطابقة للبحث." : "لا توجد بيانات محاضرين في هذه الكلية."}
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
''',
)

# 9) Production migration: dedicated, column-scoped academic-affairs update RPC.
write(
    "supabase/migrations/20260915034500_academic_affairs_instructor_basic_edit.sql",
    r'''-- Academic affairs: reports + instructor basic-data editing only.
-- institutional_viewer remains denied by can_manage_college and all generic write policies.
-- The only write elevation is this SECURITY DEFINER RPC with an explicit field whitelist.

CREATE OR REPLACE FUNCTION public.academic_affairs_update_instructor(
  p_instructor_id uuid,
  p_full_name text,
  p_full_name_ar text,
  p_employee_number text,
  p_specialization text,
  p_academic_rank text,
  p_email text,
  p_phone text,
  p_employment_type text,
  p_max_weekly_hours integer,
  p_administrative_release_hours integer,
  p_is_active boolean,
  p_instructor_type_id uuid,
  p_affiliation_college_id uuid,
  p_affiliation_department_id uuid,
  p_administrative_position text,
  p_administrative_department_id uuid,
  p_administrative_support_department_id uuid
)
RETURNS public.instructors
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_current public.instructors%ROWTYPE;
  v_updated public.instructors%ROWTYPE;
  v_type_code text;
  v_hourly boolean := false;
  v_release integer;
  v_admin_position text;
  v_admin_department uuid;
  v_admin_support_department uuid;
  v_employee_number text;
  v_operational_department uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'insufficient_privilege';
  END IF;

  SELECT * INTO v_current
  FROM public.instructors
  WHERE id = p_instructor_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INSTRUCTOR_NOT_FOUND';
  END IF;

  IF NOT public.has_role(v_actor, 'institutional_viewer')
     OR NOT public.is_viewer_only(v_actor)
     OR NOT public.user_in_college(v_actor, v_current.college_id) THEN
    RAISE EXCEPTION 'insufficient_privilege';
  END IF;

  IF btrim(COALESCE(p_full_name, '')) = '' THEN
    RAISE EXCEPTION 'INSTRUCTOR_NAME_REQUIRED';
  END IF;
  IF p_affiliation_college_id IS NULL OR p_affiliation_department_id IS NULL THEN
    RAISE EXCEPTION 'INSTRUCTOR_AFFILIATION_REQUIRED';
  END IF;
  IF NOT public.user_in_college(v_actor, p_affiliation_college_id) THEN
    RAISE EXCEPTION 'AFFILIATION_COLLEGE_FORBIDDEN';
  END IF;
  IF COALESCE(p_max_weekly_hours, -1) < 0 OR COALESCE(p_administrative_release_hours, -1) < 0 THEN
    RAISE EXCEPTION 'INSTRUCTOR_HOURS_MUST_BE_NONNEGATIVE';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.departments d
    WHERE d.id = p_affiliation_department_id
      AND d.college_id = p_affiliation_college_id
  ) THEN
    RAISE EXCEPTION 'AFFILIATION_DEPARTMENT_COLLEGE_MISMATCH';
  END IF;

  IF p_instructor_type_id IS NOT NULL THEN
    SELECT it.code INTO v_type_code
    FROM public.instructor_types it
    WHERE it.id = p_instructor_type_id
      AND it.college_id = v_current.college_id
      AND it.is_active = true;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'INSTRUCTOR_TYPE_INVALID';
    END IF;
  END IF;

  v_hourly := lower(COALESCE(v_type_code, '')) = 'con';
  v_release := CASE WHEN v_hourly THEN 0 ELSE p_administrative_release_hours END;
  v_admin_position := CASE WHEN v_hourly THEN NULL ELSE NULLIF(btrim(COALESCE(p_administrative_position, '')), '') END;
  v_employee_number := CASE
    WHEN v_hourly THEN v_current.employee_number
    ELSE NULLIF(btrim(COALESCE(p_employee_number, '')), '')
  END;

  IF NOT v_hourly AND v_employee_number IS NULL THEN
    RAISE EXCEPTION 'EMPLOYEE_NUMBER_REQUIRED';
  END IF;

  IF v_admin_position = 'department_head' THEN
    IF (p_administrative_department_id IS NULL) = (p_administrative_support_department_id IS NULL) THEN
      RAISE EXCEPTION 'ADMINISTRATIVE_DEPARTMENT_REQUIRED';
    END IF;
    IF p_administrative_department_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.departments d
      WHERE d.id = p_administrative_department_id
        AND d.college_id = p_affiliation_college_id
    ) THEN
      RAISE EXCEPTION 'ADMINISTRATIVE_DEPARTMENT_COLLEGE_MISMATCH';
    END IF;
    IF p_administrative_support_department_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.support_departments d
      WHERE d.id = p_administrative_support_department_id
        AND d.college_id = p_affiliation_college_id
    ) THEN
      RAISE EXCEPTION 'ADMINISTRATIVE_SUPPORT_DEPARTMENT_COLLEGE_MISMATCH';
    END IF;
    v_admin_department := p_administrative_department_id;
    v_admin_support_department := p_administrative_support_department_id;
  ELSE
    v_admin_department := NULL;
    v_admin_support_department := NULL;
  END IF;

  v_operational_department := CASE
    WHEN p_affiliation_college_id = v_current.college_id THEN p_affiliation_department_id
    ELSE v_current.department_id
  END;

  UPDATE public.instructors
  SET
    full_name = btrim(p_full_name),
    full_name_ar = COALESCE(NULLIF(btrim(COALESCE(p_full_name_ar, '')), ''), btrim(p_full_name)),
    employee_number = v_employee_number,
    specialization = NULLIF(btrim(COALESCE(p_specialization, '')), ''),
    academic_rank = NULLIF(btrim(COALESCE(p_academic_rank, '')), ''),
    email = NULLIF(btrim(COALESCE(p_email, '')), ''),
    phone = NULLIF(btrim(COALESCE(p_phone, '')), ''),
    employment_type = COALESCE(NULLIF(btrim(COALESCE(p_employment_type, '')), ''), 'unknown'),
    max_weekly_hours = p_max_weekly_hours,
    administrative_release_hours = v_release,
    is_active = p_is_active,
    instructor_type_id = p_instructor_type_id,
    affiliation_college_id = p_affiliation_college_id,
    affiliation_department_id = p_affiliation_department_id,
    administrative_position = v_admin_position,
    administrative_department_id = v_admin_department,
    administrative_support_department_id = v_admin_support_department,
    department_id = v_operational_department,
    updated_at = now()
  WHERE id = p_instructor_id
  RETURNING * INTO v_updated;

  INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, college_id, details)
  VALUES (
    v_actor,
    'academic_affairs_update',
    'instructors',
    p_instructor_id,
    v_current.college_id,
    jsonb_build_object(
      'scope', 'basic_instructor_data',
      'role', 'institutional_viewer',
      'affiliation_college_id', p_affiliation_college_id,
      'affiliation_department_id', p_affiliation_department_id
    )
  );

  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.academic_affairs_update_instructor(
  uuid, text, text, text, text, text, text, text, text, integer, integer, boolean,
  uuid, uuid, uuid, text, uuid, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.academic_affairs_update_instructor(
  uuid, text, text, text, text, text, text, text, text, integer, integer, boolean,
  uuid, uuid, uuid, text, uuid, uuid
) TO authenticated;
''',
)

# 10) Update RBAC regression tests to the new academic-affairs contract.
write(
    "tests/academic-affairs-instructors-access.test.ts",
    r'''import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ADMIN_PAGES, canAccess } from "@/lib/admin-nav";
import {
  INSTITUTIONAL_VIEWER_ROLE_LABEL_AR,
  isAcademicAffairsRole,
  resolveViewerScopeRedirect,
} from "@/lib/viewer-roles";

const ACADEMIC = { isInstitutionalViewer: true } as const;

describe("academic affairs route scope", () => {
  it("allows reports and instructors only", () => {
    expect(isAcademicAffairsRole(ACADEMIC)).toBe(true);
    expect(resolveViewerScopeRedirect(ACADEMIC, "/reports")).toBeNull();
    expect(resolveViewerScopeRedirect(ACADEMIC, "/reports/instructors")).toBeNull();
    expect(resolveViewerScopeRedirect(ACADEMIC, "/instructors")).toBeNull();
    expect(resolveViewerScopeRedirect(ACADEMIC, "/dashboard")).toBe("/reports");
    expect(resolveViewerScopeRedirect(ACADEMIC, "/users")).toBe("/reports");
  });

  it("navigation exposes only instructors and reports", () => {
    const visible = ADMIN_PAGES.filter((p) => canAccess(p, ["institutional_viewer"])).map((p) => p.to);
    expect(visible).toContain("/instructors");
    expect(visible).toContain("/reports");
    expect(visible).not.toContain("/courses");
    expect(visible).not.toContain("/schedule-builder");
  });

  it("uses the academic-affairs label", () => {
    expect(INSTITUTIONAL_VIEWER_ROLE_LABEL_AR).toBe("إدارة الشؤون الأكاديمية");
  });
});

describe("instructor edit wiring", () => {
  const src = readFileSync("src/routes/_authenticated/instructors.tsx", "utf8");
  const migration = readFileSync(
    "supabase/migrations/20260915034500_academic_affairs_instructor_basic_edit.sql",
    "utf8",
  );

  it("uses a dedicated RPC for non-admin academic-affairs edits", () => {
    expect(src).toContain("useCanEditInstructorsActiveCollege");
    expect(src).toContain('"academic_affairs_update_instructor"');
    expect(src).toContain("editing && !canManage");
  });

  it("keeps create/delete admin-only", () => {
    expect(src).toContain("صلاحيتك تسمح بتعديل المحاضرين الحاليين فقط");
    expect(src).toContain("{canManage && (");
    expect(src).toContain("حذف المحاضر؟");
  });

  it("migration whitelists the academic-affairs role without widening can_manage_college", () => {
    expect(migration).toContain("public.has_role(v_actor, 'institutional_viewer')");
    expect(migration).toContain("public.is_viewer_only(v_actor)");
    expect(migration).toContain("academic_affairs_update");
    expect(migration).not.toContain("CREATE OR REPLACE FUNCTION public.can_manage_college");
  });
});

describe("instructor report", () => {
  const hub = readFileSync("src/routes/_authenticated/reports.index.tsx", "utf8");
  const report = readFileSync("src/routes/_authenticated/reports.instructors.tsx", "utf8");

  it("is linked from the report hub", () => {
    expect(hub).toContain('/reports/instructors');
    expect(hub).toContain("دليل المحاضرين وبياناتهم");
  });

  it("contains the requested basic data and edit handoff", () => {
    expect(report).toContain("رقم الموظف");
    expect(report).toContain("كلية التبعية");
    expect(report).toContain("قسم التبعية");
    expect(report).toContain("النصاب الفعلي");
    expect(report).toContain("البريد الإلكتروني");
    expect(report).toContain("تعديل بيانات المحاضرين");
  });
});
''',
)

# Rewrite the existing viewer role test to match the intended academic-affairs semantics.
write(
    "tests/viewer-roles-rbac.test.ts",
    r'''/** RBAC contract for read_only and academic affairs (institutional_viewer). */
import { describe, expect, it } from "vitest";
import { ADMIN_PAGES, ALL, CORE_PATH, OPERATIONAL, canAccess } from "@/lib/admin-nav";
import {
  INSTITUTIONAL_VIEWER_ROLE_LABEL_AR,
  READ_ONLY_ROLE_LABEL_AR,
  REPORTS_ONLY_HOME,
  assignsAllColleges,
  isAcademicAffairsRole,
  isFullPlatformViewerRole,
  isReportsOnlyRole,
  isViewerOnlyRole,
  requiresCollegeAssignment,
  resolveReportsOnlyRedirect,
  resolveViewerScopeRedirect,
  scopeCollegesForRole,
} from "@/lib/viewer-roles";

const visiblePaths = (role: "read_only" | "institutional_viewer") =>
  [...ADMIN_PAGES.filter((p) => canAccess(p, [role])).map((p) => p.to)].concat(
    CORE_PATH.filter((s) => canAccess(s, [role])).map((s) => s.to),
  );

const READ_ONLY = { isReadOnly: true } as const;
const VIEWER = { isInstitutionalViewer: true } as const;
const BOTH = { isReadOnly: true, isInstitutionalViewer: true } as const;
const SUPER = { isSuperAdmin: true, isReadOnly: true } as const;
const COLLEGE_ADMIN = { isCollegeAdmin: true, isReadOnly: true } as const;

describe("labels", () => {
  it("keeps the generic viewer and academic affairs distinct", () => {
    expect(READ_ONLY_ROLE_LABEL_AR).toBe("مشاهد");
    expect(INSTITUTIONAL_VIEWER_ROLE_LABEL_AR).toBe("إدارة الشؤون الأكاديمية");
  });
});

describe("read_only-only account is reports-only", () => {
  it("allows /reports and its children", () => {
    for (const p of ["/reports", "/reports/instructor-schedule", "/reports/program-timetable"]) {
      expect(resolveReportsOnlyRedirect(READ_ONLY, p)).toBeNull();
    }
  });

  it("blocks every other path and redirects to /reports", () => {
    for (const p of ["/dashboard", "/courses", "/schedule-builder", "/admin-tools", "/users"]) {
      expect(resolveReportsOnlyRedirect(READ_ONLY, p)).toBe(REPORTS_ONLY_HOME);
    }
  });

  it("sees reports entries only in the navigation", () => {
    const paths = visiblePaths("read_only");
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((p) => p === "/reports" || p.startsWith("/reports/"))).toBe(true);
  });
});

describe("institutional_viewer is the academic-affairs role", () => {
  it("allows reports + instructors and blocks operational pages", () => {
    expect(isReportsOnlyRole(VIEWER)).toBe(false);
    expect(isAcademicAffairsRole(VIEWER)).toBe(true);
    expect(isFullPlatformViewerRole(VIEWER)).toBe(false);
    expect(resolveViewerScopeRedirect(VIEWER, "/reports")).toBeNull();
    expect(resolveViewerScopeRedirect(VIEWER, "/instructors")).toBeNull();
    expect(resolveViewerScopeRedirect(VIEWER, "/dashboard")).toBe(REPORTS_ONLY_HOME);
  });

  it("sees only instructors and reports in navigation", () => {
    const paths = visiblePaths("institutional_viewer");
    expect(paths).toContain("/instructors");
    expect(paths).toContain("/reports");
    expect(paths).not.toContain("/schedule-builder");
    expect(OPERATIONAL).not.toContain("institutional_viewer");
    expect(OPERATIONAL).not.toContain("read_only");
    expect(ALL).toContain("read_only");
    expect(ALL).toContain("institutional_viewer");
  });
});

describe("multi-role safety", () => {
  it("read_only + institutional_viewer follows academic-affairs scope", () => {
    expect(isReportsOnlyRole(BOTH)).toBe(false);
    expect(isAcademicAffairsRole(BOTH)).toBe(true);
  });

  it("admins keep full behaviour and are never narrowed", () => {
    expect(isReportsOnlyRole(SUPER)).toBe(false);
    expect(isReportsOnlyRole(COLLEGE_ADMIN)).toBe(false);
    expect(isViewerOnlyRole(SUPER)).toBe(false);
    expect(isViewerOnlyRole(COLLEGE_ADMIN)).toBe(false);
  });

  it("does not auto-scope an admin's colleges", () => {
    const colleges = [{ id: "a" }, { id: "b" }];
    expect(scopeCollegesForRole(colleges, ["a"], isViewerOnlyRole(SUPER))).toHaveLength(2);
    expect(scopeCollegesForRole(colleges, ["a"], isViewerOnlyRole(READ_ONLY))).toEqual([{ id: "a" }]);
  });
});

describe("college assignment", () => {
  it("auto-assigns all colleges to both viewer roles only", () => {
    expect(assignsAllColleges("read_only")).toBe(true);
    expect(assignsAllColleges("institutional_viewer")).toBe(true);
    expect(assignsAllColleges("college_admin")).toBe(false);
    expect(assignsAllColleges("super_admin")).toBe(false);
  });

  it("requires a manual picker for college_admin only", () => {
    expect(requiresCollegeAssignment("college_admin")).toBe(true);
    expect(requiresCollegeAssignment("read_only")).toBe(false);
    expect(requiresCollegeAssignment("institutional_viewer")).toBe(false);
  });
});
''',
)

# Small update to read-only regression for the changed app-layout ternary.
path = "tests/read-only-scope-regression.test.ts"
s = Path(path).read_text()
s = s.replace(
    '    expect(src).toMatch(/reportsOnly \\? "core" : mode/);',
    '    expect(src).toContain(\'reportsOnly ? "core" : academicAffairs ? "all" : mode\');',
)
Path(path).write_text(s)

print("academic affairs instructors access patch applied")
