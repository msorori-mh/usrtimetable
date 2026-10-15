/**
 * L-3: server-side rules for role / college membership changes made by a
 * super admin. Pure module (no imports) so it is unit-testable; the server
 * functions in users.functions.ts load the current state and apply these.
 * The database trigger (LAST_SUPER_ADMIN) remains the authoritative backstop.
 */

export const MEMBERSHIP_ROLES = [
  "super_admin",
  "college_admin",
  "read_only",
  "institutional_viewer",
  "university_leadership",
  "college_dean",
] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

export const MEMBERSHIP_ERROR_AR = {
  selfSuperAdmin: "لا يمكنك إزالة دور مدير النظام (Super Admin) عن حسابك.",
  lastSuperAdmin: "لا يمكن إزالة آخر مدير نظام (Super Admin) في المنصة.",
  deanNeedsOneCollege:
    "عميد الكلية يجب أن يُسند إلى كلية واحدة بالضبط. أسند كلية واحدة أولًا ثم فعّل الدور.",
  deanCannotLoseCollege:
    "لا يمكن إزالة الكلية الوحيدة لعميد الكلية. أسند كلية أخرى (تُستبدل تلقائيًا) أو أزل دور العميد أولًا.",
} as const;

export type RoleChange = {
  actorId: string;
  targetId: string;
  role: MembershipRole;
  enabled: boolean;
  currentRoles: readonly string[];
  currentCollegeIds: readonly string[];
  /** Number of accounts currently holding super_admin (including the target). */
  superAdminCount: number;
};

/** Returns a fixed Arabic error, or null when the change is allowed. */
export function validateRoleChange(change: RoleChange): string | null {
  const has = change.currentRoles.includes(change.role);
  if (!change.enabled && change.role === "super_admin" && has) {
    if (change.actorId === change.targetId) return MEMBERSHIP_ERROR_AR.selfSuperAdmin;
    if (change.superAdminCount <= 1) return MEMBERSHIP_ERROR_AR.lastSuperAdmin;
  }
  if (change.enabled && change.role === "college_dean" && !has) {
    if (new Set(change.currentCollegeIds).size !== 1) return MEMBERSHIP_ERROR_AR.deanNeedsOneCollege;
  }
  return null;
}

export type CollegeChange = {
  collegeId: string;
  enabled: boolean;
  currentRoles: readonly string[];
  currentCollegeIds: readonly string[];
};

export type CollegePlan =
  | { ok: false; error: string }
  | {
      ok: true;
      /** College ids to insert. */
      add: string[];
      /** College ids to delete. */
      remove: string[];
      /** Final assignment after the change. */
      final: string[];
    };

/**
 * Plans a college assignment change so that the FINAL state honours the dean
 * rule: a college dean always ends with exactly one college. Assigning a new
 * college to a dean replaces the previous one (atomic intent, one request).
 */
export function planCollegeChange(change: CollegeChange): CollegePlan {
  const current = [...new Set(change.currentCollegeIds)];
  const isDean = change.currentRoles.includes("college_dean");
  if (change.enabled) {
    if (isDean) {
      return {
        ok: true,
        add: current.includes(change.collegeId) ? [] : [change.collegeId],
        remove: current.filter((id) => id !== change.collegeId),
        final: [change.collegeId],
      };
    }
    if (current.includes(change.collegeId)) return { ok: true, add: [], remove: [], final: current };
    return { ok: true, add: [change.collegeId], remove: [], final: [...current, change.collegeId] };
  }
  if (!current.includes(change.collegeId)) return { ok: true, add: [], remove: [], final: current };
  const final = current.filter((id) => id !== change.collegeId);
  if (isDean && final.length !== 1) return { ok: false, error: MEMBERSHIP_ERROR_AR.deanCannotLoseCollege };
  return { ok: true, add: [], remove: [change.collegeId], final };
}

/** Removing these roles is destructive enough to require an explicit confirmation in the UI. */
export function roleRemovalNeedsConfirmation(role: string): boolean {
  return role === "super_admin" || role === "college_admin";
}
