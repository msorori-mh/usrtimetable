/**
 * Academic affairs role (technical value: `institutional_viewer`).
 *
 * Product definition:
 *  - user-facing Arabic label: «إدارة الشؤون الأكاديمية»;
 *  - reports ONLY: the sole reachable area is /reports and /reports/*;
 *  - read scope is every college, expressed as explicit `user_colleges` rows:
 *    granting the role assigns ALL current colleges, and a college created
 *    later is auto-assigned by a database trigger. There is no manual college
 *    picker for this role, and reads still flow through `user_colleges`;
 *  - strictly read-only: this module never grants a write permission.
 *
 * Multi-role safety: a user who also carries `super_admin` or `college_admin`
 * keeps that role's full behaviour, is never narrowed to reports, and is never
 * auto-assigned colleges (that would widen an admin's manageable colleges).
 *
 * The database enum value is intentionally unchanged.
 */

export const ACADEMIC_AFFAIRS_ROLE_LABEL_AR = "إدارة الشؤون الأكاديمية";

export const ACADEMIC_AFFAIRS_ROLE_HINT_AR =
  "تقارير فقط لجميع الكلّيات، بدون أي إضافة أو تعديل أو حذف.";

export const ACADEMIC_AFFAIRS_CREATE_NOTE_AR =
  "حساب «إدارة الشؤون الأكاديمية»: يرى مركز التقارير فقط. تُسند له تلقائيًا جميع الكلّيات الحالية، وأي كلّية تُنشأ لاحقًا تُسند له تلقائيًا كذلك، والحساب للقراءة والطباعة والتصدير دون أي تعديل.";

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

export type AssignableRole = "super_admin" | "college_admin" | "read_only" | "institutional_viewer";

/**
 * Academic affairs covers every college, so its assignment is computed
 * automatically (all current colleges + future ones via database trigger)
 * instead of being picked by hand.
 */
export function assignsAllColleges(role: AssignableRole): boolean {
  return role === "institutional_viewer";
}

/**
 * Manual college assignment is mandatory for college-scoped operational roles.
 * super_admin is institution-wide; institutional_viewer is auto-assigned.
 */
export function requiresCollegeAssignment(role: AssignableRole): boolean {
  return role !== "super_admin" && !assignsAllColleges(role);
}
