/**
 * Viewer role contract (read-only roles). No helper here grants a write.
 *
 * `read_only` — «مشاهد»:
 *  - reports ONLY: the sole reachable area is /reports and /reports/*;
 *  - may read, print and export the reports of EVERY college, expressed as
 *    explicit `user_colleges` rows: granting the role assigns all current
 *    colleges and a college created later is auto-assigned by a database
 *    trigger;
 *  - no add / edit / delete anywhere.
 *
 * `institutional_viewer` — «مشاهد مؤسسي»:
 *  - may browse the whole platform across all colleges, read-only;
 *  - is NOT reports-only and is never redirected to /reports;
 *  - holds every current and future college as read scope, same as above.
 *
 * Multi-role safety: an account that also carries `super_admin` or
 * `college_admin` keeps that role's full behaviour, is never narrowed to
 * reports, and is never auto-assigned colleges (that would widen an admin's
 * manageable colleges).
 *
 * The database enum values are intentionally unchanged.
 */

export const READ_ONLY_ROLE_LABEL_AR = "مشاهد";
export const INSTITUTIONAL_VIEWER_ROLE_LABEL_AR = "مشاهد مؤسسي";

export const READ_ONLY_ROLE_HINT_AR =
  "التقارير فقط لجميع الكلّيات: قراءة وطباعة وتصدير، بدون أي إضافة أو تعديل أو حذف.";

export const INSTITUTIONAL_VIEWER_ROLE_HINT_AR =
  "استعراض كامل محتويات المنصة في جميع الكلّيات للقراءة فقط، بدون أي إضافة أو تعديل أو حذف.";

export const READ_ONLY_CREATE_NOTE_AR =
  "حساب «مشاهد»: يرى مركز التقارير فقط. تُسند له تلقائيًا جميع الكلّيات الحالية، وأي كلّية تُنشأ لاحقًا تُسند له تلقائيًا كذلك، والحساب للقراءة والطباعة والتصدير دون أي تعديل.";

export const INSTITUTIONAL_VIEWER_CREATE_NOTE_AR =
  "حساب «مشاهد مؤسسي»: يستعرض كامل صفحات المنصة في جميع الكلّيات للقراءة فقط. تُسند له تلقائيًا جميع الكلّيات الحالية وأي كلّية تُنشأ لاحقًا، بدون أي صلاحية تعديل.";

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

/** True for an `institutional_viewer` account without any admin role: full read-only platform view. */
export function isFullPlatformViewerRole(me: RoleFlags | null | undefined): boolean {
  return !!me && !hasAdminRole(me) && !!me.isInstitutionalViewer;
}

/** True for any viewer-only account (read_only and/or institutional_viewer, no admin role). */
export function isViewerOnlyRole(me: RoleFlags | null | undefined): boolean {
  return !!me && !hasAdminRole(me) && (!!me.isReadOnly || !!me.isInstitutionalViewer);
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
 * Viewer roles cover every college, so their assignment is computed
 * automatically (all current colleges + future ones via database trigger)
 * instead of being picked by hand.
 */
export function assignsAllColleges(role: AssignableRole): boolean {
  return role === "read_only" || role === "institutional_viewer";
}

/**
 * Manual college assignment is mandatory only for the college-scoped
 * operational role. super_admin is institution-wide; viewer roles are
 * auto-assigned every college.
 */
export function requiresCollegeAssignment(role: AssignableRole): boolean {
  return role === "college_admin";
}
