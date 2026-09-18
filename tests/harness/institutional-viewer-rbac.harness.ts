import { readPrimaryNavigationSource } from "./nav-source";
/**
 * ACADEMIC_AFFAIRS_RBAC — source-only static contract harness.
 *
 * `institutional_viewer` is the dedicated «إدارة الشؤون الأكاديمية» role:
 *  - reports + instructor directory only;
 *  - may edit existing instructor basic data through one scoped RPC;
 *  - may NOT create/delete instructors or obtain generic college write access;
 *  - generic `read_only` remains reports-only.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failures += 1;
    console.error(`FAIL: ${msg}`);
  }
}

const cu = read("src/hooks/use-current-user.ts");
assert(
  /export type AppRole =[^;]*"institutional_viewer"/.test(cu),
  "AppRole union includes institutional_viewer",
);
assert(
  cu.includes('isInstitutionalViewer: roles.includes("institutional_viewer")'),
  "isInstitutionalViewer derives from user_roles",
);
assert(!cu.includes("user_metadata"), "authorization never comes from user_metadata");

const dbTypes = read("src/integrations/supabase/types.ts");
assert(dbTypes.includes("institutional_viewer"), "Supabase generated types carry the role");

const viewerRoles = read("src/lib/viewer-roles.ts");
assert(
  viewerRoles.includes('INSTITUTIONAL_VIEWER_ROLE_LABEL_AR = "إدارة الشؤون الأكاديمية"'),
  "institutional_viewer label is إدارة الشؤون الأكاديمية",
);
assert(viewerRoles.includes("isAcademicAffairsRole"), "academic-affairs role helper exists");
assert(
  viewerRoles.includes('pathname === "/instructors"'),
  "academic affairs path scope includes instructor directory",
);
assert(viewerRoles.includes("resolveViewerScopeRedirect"), "viewer scope redirect is centralized");

const nav = readPrimaryNavigationSource(ROOT);
assert(
  /export const OPERATIONAL: Role\[\] = \["super_admin", "college_admin"\]/.test(nav),
  "institutional_viewer is excluded from operational pages",
);
assert(
  /export const INSTRUCTOR_ACCESS: Role\[\] = \["super_admin", "college_admin", "institutional_viewer"\]/.test(
    nav,
  ),
  "instructor access explicitly includes academic affairs",
);
assert(
  /to:\s*"\/instructors"[\s\S]{0,500}roles:\s*INSTRUCTOR_ACCESS/.test(nav),
  "instructors navigation entry uses the scoped instructor role list",
);
assert(
  /to:\s*"\/reports"[\s\S]{0,500}roles:\s*ALL/.test(nav),
  "reports navigation remains available to viewer roles",
);

const canManageHook = read("src/hooks/use-can-manage.ts");
const genericManage = canManageHook.slice(
  canManageHook.indexOf("export function useCanManageActiveCollege"),
  canManageHook.indexOf("export function useCanEditInstructorsActiveCollege"),
);
assert(
  !genericManage.includes("isInstitutionalViewer"),
  "useCanManageActiveCollege is NOT widened to academic affairs",
);
assert(
  /export function useCanEditInstructorsActiveCollege/.test(canManageHook) &&
    /me\.isInstitutionalViewer\s*&&\s*me\.collegeIds\.includes\(active\.id\)/.test(canManageHook),
  "dedicated instructor-edit capability requires academic-affairs role + assigned college",
);

const layout = read("src/components/app-layout.tsx");
assert(
  layout.includes("isAcademicAffairsRole") && layout.includes("restrictedViewer"),
  "app layout recognizes academic affairs as a restricted viewer",
);
assert(
  layout.includes("إدارة الشؤون الأكاديمية: التقارير وبيانات المحاضرين لجميع الكلّيات."),
  "app layout explains the academic-affairs scope",
);

const gate = read("src/components/reports-only-gate.tsx");
assert(
  gate.includes("resolveViewerScopeRedirect"),
  "route gate enforces the centralized viewer scope",
);

const instructors = read("src/routes/_authenticated/instructors.tsx");
assert(
  instructors.includes("useCanEditInstructorsActiveCollege"),
  "instructor page uses the dedicated edit capability",
);
assert(
  instructors.includes('"academic_affairs_update_instructor"'),
  "academic-affairs instructor edit uses the dedicated RPC",
);
assert(
  instructors.includes("editing && !canManage"),
  "dedicated RPC is used only for editing an existing row by a non-admin",
);
assert(
  instructors.includes("صلاحيتك تسمح بتعديل المحاضرين الحاليين فقط"),
  "non-admin academic affairs cannot create a new instructor",
);
assert(
  /\{canManage && \([\s\S]{0,250}<DialogTrigger asChild>/.test(instructors),
  "new-instructor trigger stays admin-only",
);
assert(
  /\{canManage && \([\s\S]{0,300}aria-label=\{`حذف/.test(instructors),
  "delete action stays admin-only",
);

const migration = read(
  "supabase/migrations/20260915034500_academic_affairs_instructor_basic_edit.sql",
);
assert(
  /CREATE OR REPLACE FUNCTION public\.academic_affairs_update_instructor/.test(migration),
  "dedicated academic-affairs update RPC exists",
);
assert(/SECURITY DEFINER/.test(migration), "dedicated RPC is SECURITY DEFINER");
assert(
  /public\.has_role\(v_actor, 'institutional_viewer'\)/.test(migration) &&
    /public\.is_viewer_only\(v_actor\)/.test(migration) &&
    /public\.user_in_college\(v_actor, v_current\.college_id\)/.test(migration),
  "RPC requires academic-affairs-only actor assigned to the instructor college",
);
assert(
  /INSERT INTO public\.audit_logs/.test(migration) && migration.includes("academic_affairs_update"),
  "RPC writes an audit record",
);
assert(
  !/CREATE OR REPLACE FUNCTION public\.can_manage_college/.test(migration),
  "migration never widens can_manage_college",
);
assert(
  !/INSERT INTO public\.instructors/i.test(migration) &&
    !/DELETE FROM public\.instructors/i.test(migration),
  "migration grants update-only behavior, not instructor create/delete",
);

const reportHub = read("src/routes/_authenticated/reports.index.tsx");
const instructorReport = read("src/routes/_authenticated/reports.instructors.tsx");
assert(
  reportHub.includes("/reports/instructors") && reportHub.includes("دليل المحاضرين وبياناتهم"),
  "reports hub links the instructor data report",
);
for (const label of [
  "رقم الموظف",
  "الاسم الافتراضي",
  "الاسم الرباعي",
  "كلية التبعية",
  "قسم التبعية",
  "التخصص",
  "الرتبة العلمية",
  "النصاب الأساسي",
  "الإعفاء الإداري",
  "النصاب الفعلي",
  "البريد الإلكتروني",
  "التلفون/الواتساب",
  "الحالة",
]) {
  assert(instructorReport.includes(label), `instructor report contains ${label}`);
}
assert(
  instructorReport.includes("ReportFilterBar") &&
    instructorReport.includes("تعديل بيانات المحاضرين"),
  "instructor report uses the shared report filters and edit handoff",
);

const usersFn = read("src/lib/users.functions.ts");
assert(
  /const ROLE = z\.enum\(\[[\s\S]*?"institutional_viewer"[\s\S]*?\]\)/.test(usersFn),
  "user provisioning accepts institutional_viewer alongside other roles",
);
assert(
  /assignsAllColleges\(data\.role\)/.test(usersFn),
  "viewer-role provisioning auto-assigns all colleges",
);
assert(
  viewerRoles.includes("if (isReportsOnlyRole(me))") &&
    viewerRoles.includes("return isReportsOnlyPath(pathname) ? null : REPORTS_ONLY_HOME"),
  "generic read_only remains reports-only",
);

if (failures) {
  console.error(`ACADEMIC_AFFAIRS_RBAC_FAIL: ${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("ACADEMIC_AFFAIRS_RBAC_PASS");
