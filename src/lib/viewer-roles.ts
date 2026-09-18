/**
 * Viewer role contract (read-only roles). No helper here grants a write.
 *
 * `read_only` — «مشاهد»:
 *  - reports ONLY: the sole reachable area is /reports and /reports/*;
 *  - may read, print and export reports only for explicitly selected
 *    `user_colleges` rows; neither role grants nor new colleges widen scope;
 *  - no add / edit / delete anywhere.
 *
 * `institutional_viewer` — «إدارة الشؤون الأكاديمية»:
 *  - may open reports and the instructor directory/editor only;
 *  - may update basic instructor fields through a dedicated RPC, but cannot create/delete instructors;
 *  - holds every current and future college as scope, same as above.
 *
 * Multi-role safety: an account that also carries `super_admin` or
 * `college_admin` keeps that role's full behaviour, is never narrowed to
 * reports, and is never auto-assigned colleges (that would widen an admin's
 * manageable colleges).
 *
 * The database enum values are intentionally unchanged.
 */

export const READ_ONLY_ROLE_LABEL_AR = "مشاهد";
export const INSTITUTIONAL_VIEWER_ROLE_LABEL_AR = "إدارة الشؤون الأكاديمية";

export const READ_ONLY_ROLE_HINT_AR =
  "تقارير الكلّيات المُسندة فقط: قراءة وطباعة وتصدير، بدون أي إضافة أو تعديل أو حذف.";

export const INSTITUTIONAL_VIEWER_ROLE_HINT_AR =
  "تقارير جميع الكلّيات مع صلاحية تعديل البيانات الأساسية للمحاضرين فقط، دون إنشاء/حذف محاضرين أو تعديل بقية بيانات المنصة.";

export const READ_ONLY_CREATE_NOTE_AR =
  "حساب «مشاهد»: يرى تقارير الكلّيات التي تختارها فقط، للقراءة والطباعة والتصدير دون أي تعديل. لا تُضاف الكلّيات الجديدة تلقائيًا.";

export const INSTITUTIONAL_VIEWER_CREATE_NOTE_AR =
  "حساب «إدارة الشؤون الأكاديمية»: يرى التقارير في جميع الكلّيات، ويستطيع تعديل البيانات الأساسية للمحاضرين فقط. تُسند له تلقائيًا جميع الكلّيات الحالية وأي كلّية تُنشأ لاحقًا.";

/** The only area the reports-only role may open. */
export const REPORTS_ONLY_HOME = "/reports" as const;

export interface RoleFlags {
  isSuperAdmin?: boolean;
  isCollegeAdmin?: boolean;
  isReadOnly?: boolean;
  isInstitutionalViewer?: boolean;
}

function hasAdminRole(me: RoleFlags): boolean {
  return !!me.isSuperAdmin || !!me.isCollegeAdmin;
}

/**
 * True for a `read_only`-ONLY account: reports-only scope.
 * A wider role (institutional_viewer, college_admin, super_admin) wins.
 */
export function isReportsOnlyRole(me: RoleFlags | null | undefined): boolean {
  if (!me) return false;
  return !hasAdminRole(me) && !me.isInstitutionalViewer && !!me.isReadOnly;
}

/** Dedicated academic-affairs account: reports + instructor data only. */
export function isAcademicAffairsRole(me: RoleFlags | null | undefined): boolean {
  return !!me && !hasAdminRole(me) && !!me.isInstitutionalViewer;
}

/** @deprecated institutional_viewer is no longer a full-platform viewer. */
export function isFullPlatformViewerRole(_me: RoleFlags | null | undefined): boolean {
  return false;
}

/** True for any viewer-only account (read_only and/or institutional_viewer, no admin role). */
export function isViewerOnlyRole(me: RoleFlags | null | undefined): boolean {
  return !!me && !hasAdminRole(me) && (!!me.isReadOnly || !!me.isInstitutionalViewer);
}

/** /reports and /reports/* only — nothing else is inside the allowed area. */
export function isReportsOnlyPath(pathname: string): boolean {
  return pathname === REPORTS_ONLY_HOME || pathname.startsWith(`${REPORTS_ONLY_HOME}/`);
}

/** Academic affairs may open reports and the instructor directory/editor only. */
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

/** Viewer accounts read only the colleges assigned to them in user_colleges. */
export function scopeCollegesForRole<T extends { id: string }>(
  colleges: readonly T[],
  assignedCollegeIds: readonly string[],
  viewerOnly: boolean,
): T[] {
  if (!viewerOnly) return [...colleges];
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
 * Manual college assignment is mandatory for college admins and report viewers.
 * Academic affairs remains institution-wide.
 */
export function requiresCollegeAssignment(role: AssignableRole): boolean {
  return role === "college_admin" || role === "read_only";
}

