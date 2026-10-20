/**
 * H-11: pure decision logic for privileged server functions.
 *
 * Server functions that later use the service-role client must first prove,
 * with the CALLER's own Supabase client (so the database pre-request hook and
 * RLS apply), that the session is valid, MFA is satisfied, no temporary
 * password change is pending and the caller really holds the required role.
 * A super-admin action additionally requires an aal2 (MFA-verified) JWT.
 *
 * Every unexpected input fails closed. Messages are fixed Arabic strings and
 * never include backend details.
 */

export type AccessStatus = {
  session_valid: boolean;
  password_required: boolean;
  mfa_required: boolean;
};

export type AdminAccessPolicy = {
  /** Role the caller must hold; null skips the role check (self-service actions). */
  role: string | null;
  /** Require claims.aal === "aal2". */
  requireAal2: boolean;
  /** Allow a pending initial-password change (only the change itself). */
  allowPendingPasswordChange: boolean;
};

export const SUPER_ADMIN_POLICY: AdminAccessPolicy = {
  role: "super_admin",
  requireAal2: true,
  allowPendingPasswordChange: false,
};

/** completeInitialPasswordChange: must work exactly while a change is pending. */
export const INITIAL_PASSWORD_CHANGE_POLICY: AdminAccessPolicy = {
  role: null,
  requireAal2: false,
  allowPendingPasswordChange: true,
};

export type AdminAccessDenial =
  | "status_unavailable"
  | "session_invalid"
  | "mfa_required"
  | "password_change_required"
  | "aal2_required"
  | "roles_unavailable"
  | "forbidden";

export type AdminAccessDecision = { ok: true } | { ok: false; reason: AdminAccessDenial };

export const ADMIN_ACCESS_DENIAL_AR: Record<AdminAccessDenial, string> = {
  status_unavailable: "تعذّر التحقق من حالة الجلسة. أعد تسجيل الدخول ثم حاول مجددًا.",
  session_invalid: "انتهت صلاحية الجلسة أو أُلغيت. سجّل الدخول مجددًا.",
  mfa_required: "يلزم إكمال التحقق بخطوتين قبل تنفيذ هذا الإجراء.",
  password_change_required: "يجب تغيير كلمة المرور المؤقتة قبل تنفيذ هذا الإجراء.",
  aal2_required:
    "إجراءات مدير النظام تتطلب تفعيل التحقق بخطوتين وإكماله في هذه الجلسة (صفحة أمان الحساب).",
  roles_unavailable: "تعذّر التحقق من صلاحيات الحساب. أعد المحاولة.",
  forbidden: "ليس لديك صلاحية لتنفيذ هذا الإجراء.",
};

/** Strict shape check of the security_access_status RPC result. */
export function parseAccessStatus(value: unknown): AccessStatus | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.session_valid !== "boolean" ||
    typeof v.password_required !== "boolean" ||
    typeof v.mfa_required !== "boolean"
  )
    return null;
  return {
    session_valid: v.session_valid,
    password_required: v.password_required,
    mfa_required: v.mfa_required,
  };
}

export function evaluateAdminAccess(
  status: unknown,
  claims: unknown,
  roles: readonly string[] | null | undefined,
  policy: AdminAccessPolicy = SUPER_ADMIN_POLICY,
): AdminAccessDecision {
  const parsed = parseAccessStatus(status);
  if (!parsed) return { ok: false, reason: "status_unavailable" };
  if (!parsed.session_valid) return { ok: false, reason: "session_invalid" };
  if (parsed.mfa_required) return { ok: false, reason: "mfa_required" };
  if (parsed.password_required && !policy.allowPendingPasswordChange)
    return { ok: false, reason: "password_change_required" };
  if (policy.requireAal2) {
    const aal =
      claims && typeof claims === "object" ? (claims as Record<string, unknown>).aal : undefined;
    if (aal !== "aal2") return { ok: false, reason: "aal2_required" };
  }
  if (policy.role !== null) {
    if (!Array.isArray(roles)) return { ok: false, reason: "roles_unavailable" };
    if (!roles.includes(policy.role)) return { ok: false, reason: "forbidden" };
  }
  return { ok: true };
}

/** Minimal surface of the caller's (RLS-bound) Supabase client used for verification. */
export type CallerClient = {
  rpc: (fn: "security_access_status") => PromiseLike<{ data: unknown; error: unknown }>;
  from: (table: "user_roles") => {
    select: (columns: "role") => {
      eq: (
        column: "user_id",
        value: string,
      ) => PromiseLike<{ data: Array<{ role: unknown }> | null; error: unknown }>;
    };
  };
};

export class AdminAccessError extends Error {
  readonly reason: AdminAccessDenial;
  constructor(reason: AdminAccessDenial) {
    super(ADMIN_ACCESS_DENIAL_AR[reason]);
    this.name = "AdminAccessError";
    this.reason = reason;
  }
}

/**
 * Reads the caller's access status and roles with the CALLER's client (the DB
 * pre-request hook and RLS apply), then applies `evaluateAdminAccess`.
 * Throws AdminAccessError with a fixed Arabic message on any denial.
 */
export async function verifyCallerAccess(
  client: CallerClient,
  userId: string,
  claims: unknown,
  policy: AdminAccessPolicy,
): Promise<void> {
  let status: unknown = null;
  try {
    const result = await client.rpc("security_access_status");
    status = result.error ? null : result.data;
    if (result.error) console.error("[admin-access] security_access_status failed", result.error);
  } catch (error) {
    console.error("[admin-access] security_access_status threw", error);
    status = null;
  }
  // Evaluate the session first: never probe roles on a dead/unready session.
  const pre = evaluateAdminAccess(status, claims, [], { ...policy, role: null });
  if (!pre.ok) throw new AdminAccessError(pre.reason);
  if (policy.role === null) return;
  let roles: string[] | null = null;
  try {
    // read-all-ok: rows of a single user (one role/college list), far below the page cap
    const result = await client.from("user_roles").select("role").eq("user_id", userId);
    if (result.error || !Array.isArray(result.data)) {
      console.error("[admin-access] caller role read failed", result.error);
      roles = null;
    } else roles = result.data.map((r) => String(r.role));
  } catch (error) {
    console.error("[admin-access] caller role read threw", error);
    roles = null;
  }
  const decision = evaluateAdminAccess(status, claims, roles, policy);
  if (!decision.ok) throw new AdminAccessError(decision.reason);
}
