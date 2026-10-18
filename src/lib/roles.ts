/**
 * Role names and predicates. Use these instead of string literals so a typo is
 * a compile error and every check means the same thing everywhere.
 * UI checks are conveniences only — the database (RLS / RPC checks) decides.
 */
export const ROLES = {
  superAdmin: "super_admin",
  collegeAdmin: "college_admin",
  readOnly: "read_only",
  institutionalViewer: "institutional_viewer",
  universityLeadership: "university_leadership",
  collegeDean: "college_dean",
} as const;

export type AppRoleName = (typeof ROLES)[keyof typeof ROLES];

type RoleList = readonly string[] | null | undefined;

export function hasRole(roles: RoleList, role: AppRoleName): boolean {
  return !!roles && roles.includes(role);
}

export function isSuperAdmin(roles: RoleList): boolean {
  return hasRole(roles, ROLES.superAdmin);
}

/** Can manage college data (super admin or college admin). */
export function isAdmin(roles: RoleList): boolean {
  return hasRole(roles, ROLES.superAdmin) || hasRole(roles, ROLES.collegeAdmin);
}

export function canManageCollege(roles: RoleList): boolean {
  return isAdmin(roles);
}
