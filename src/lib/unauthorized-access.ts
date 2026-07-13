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
