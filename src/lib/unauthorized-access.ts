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
 * Institution-wide read-only viewer: may OPEN every page (including super_admin-only
 * ones) but must never see a write control. This is UX only — every write is denied
 * server-side by RLS / RPC checks (can_manage_college was NOT widened).
 */
export function isInstitutionalReadOnlyViewer(
  me: { isSuperAdmin?: boolean; isInstitutionalViewer?: boolean } | null | undefined,
): boolean {
  return !!me && !me.isSuperAdmin && !!me.isInstitutionalViewer;
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
