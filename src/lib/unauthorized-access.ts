/**
 * Shared unauthorized / forbidden page-access helpers (UX only — does not grant roles).
 */

export const UNAUTHORIZED_PAGE_MESSAGE_AR = "ليس لديك صلاحية للوصول إلى هذه الصفحة";

export const UNAUTHORIZED_BACK_HOME_LABEL_AR = "العودة إلى الرئيسية";

export const UNAUTHORIZED_BACK_HOME_TO = "/dashboard" as const;

export type SuperAdminPageAccess = "loading" | "allowed" | "forbidden";

/** Resolve whether a super_admin-only page may render admin content. */
export function resolveSuperAdminPageAccess(
  me: { isSuperAdmin: boolean } | null | undefined,
  isLoading: boolean,
): SuperAdminPageAccess {
  if (isLoading || me === undefined) return "loading";
  if (me === null || !me.isSuperAdmin) return "forbidden";
  return "allowed";
}

/** Admin data queries must stay disabled until access is allowed. */
export function shouldLoadSuperAdminPageData(access: SuperAdminPageAccess): boolean {
  return access === "allowed";
}

/**
 * Institutional viewer account («مشاهد مؤسسي», DB value `institutional_viewer`):
 * browses the whole platform across all assigned colleges, read-only. Admin pages
 * branch on it to hide every write control. The reports-only role («مشاهد» =
 * `read_only`) never reaches these pages: ReportsOnlyGate sends it to /reports.
 * Writes are denied server-side (can_manage_college was NOT widened).
 */
export function isInstitutionalReadOnlyViewer(
  me:
    | { isSuperAdmin?: boolean; isCollegeAdmin?: boolean; isInstitutionalViewer?: boolean }
    | null
    | undefined,
): boolean {
  // Multi-role safety: an existing super_admin / college_admin never loses
  // behaviour by also carrying institutional_viewer. Mirrors the SQL predicate
  // in the zero-write trigger guard.
  return !!me && !me.isSuperAdmin && !me.isCollegeAdmin && !!me.isInstitutionalViewer;
}

/**
 * Resolve access for a page that used to be super_admin-only but is now also
 * readable by the institutional viewer.
 */
export function resolveAdminReadablePageAccess(
  me: { isSuperAdmin: boolean; isInstitutionalViewer?: boolean } | null | undefined,
  isLoading: boolean,
): SuperAdminPageAccess {
  if (isLoading || me === undefined) return "loading";
  if (me === null || (!me.isSuperAdmin && !me.isInstitutionalViewer)) return "forbidden";
  return "allowed";
}

export const READ_ONLY_VIEW_BADGE_AR = "عرض فقط — لا تملك صلاحية التعديل";

/**
 * Root / shared error UI must not treat arbitrary runtime errors as permission denials.
 * Only explicit forbidden access states map to the unauthorized message.
 */
export function resolveCaughtErrorDisplayKind(error: unknown): "unauthorized" | "generic" {
  if (
    error instanceof Error &&
    (error.name === "UnauthorizedAccessError" || error.message === UNAUTHORIZED_PAGE_MESSAGE_AR)
  ) {
    return "unauthorized";
  }
  return "generic";
}
