/**
 * Academic affairs role (technical value: `institutional_viewer`).
 *
 * Product definition:
 *  - user-facing Arabic label: «إدارة الشؤون الأكاديمية»;
 *  - reports ONLY: the sole reachable area is /reports and /reports/*;
 *  - read scope is limited to the colleges assigned in `user_colleges`
 *    (it is NOT an institution-wide reader);
 *  - strictly read-only: this module never grants a write permission.
 *
 * Multi-role safety: a user who also carries `super_admin` or `college_admin`
 * keeps that role's full behaviour and is never narrowed to reports.
 *
 * The database enum value is intentionally unchanged.
 */

export const ACADEMIC_AFFAIRS_ROLE_LABEL_AR = "إدارة الشؤون الأكاديمية";

export const ACADEMIC_AFFAIRS_ROLE_HINT_AR =
  "تقارير فقط للكلّيات المُسندة له، بدون أي إضافة أو تعديل أو حذف.";

export const ACADEMIC_AFFAIRS_CREATE_NOTE_AR =
  "حساب «إدارة الشؤون الأكاديمية»: يرى مركز التقارير فقط، وضمن الكلّيات المُسندة له فقط. إسناد كلّية واحدة على الأقل إلزامي، والحساب للقراءة والطباعة والتصدير دون أي تعديل.";

/** The only area this role may open. */
export const REPORTS_ONLY_HOME = "/reports" as const;

export interface RoleFlags {
  isSuperAdmin?: boolean;
  isCollegeAdmin?: boolean;
  isInstitutionalViewer?: boolean;
}

/** True when the account is academic-affairs ONLY (reports-only, assigned colleges). */
export function isReportsOnlyRole(me: RoleFlags | null | undefined): boolean {
  return !!me && !me.isSuperAdmin && !me.isCollegeAdmin && !!me.isInstitutionalViewer;
}

/** /reports and /reports/* only — nothing else is inside the allowed area. */
export function isReportsOnlyPath(pathname: string): boolean {
  return pathname === REPORTS_ONLY_HOME || pathname.startsWith(`${REPORTS_ONLY_HOME}/`);
}

/** Returns the redirect target when the reports-only role opened a forbidden path. */
export function resolveReportsOnlyRedirect(
  me: RoleFlags | null | undefined,
  pathname: string,
): typeof REPORTS_ONLY_HOME | null {
  if (!isReportsOnlyRole(me)) return null;
  return isReportsOnlyPath(pathname) ? null : REPORTS_ONLY_HOME;
}

/** Reports-only accounts must never see a college that is not assigned to them. */
export function scopeCollegesForRole<T extends { id: string }>(
  colleges: readonly T[],
  assignedCollegeIds: readonly string[],
  reportsOnly: boolean,
): T[] {
  if (!reportsOnly) return [...colleges];
  const allowed = new Set(assignedCollegeIds);
  return colleges.filter((c) => allowed.has(c.id));
}

/** College assignment is mandatory for every role except super_admin. */
export function requiresCollegeAssignment(
  role: "super_admin" | "college_admin" | "read_only" | "institutional_viewer",
): boolean {
  return role !== "super_admin";
}
