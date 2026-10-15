import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSecureAdmin } from "@/integrations/supabase/secure-admin-middleware";
import {
  assignsAllColleges,
  requiresCollegeAssignment,
  requiresExactlyOneCollege,
} from "@/lib/viewer-roles";
import {
  PASSWORD_MAX_BYTES,
  describePasswordIssues,
  passwordPolicyIssues,
  requiresInitialPassword,
} from "@/lib/password-policy";
import { isMissingFunctionError, serverFailure } from "@/lib/server-errors";
import { planCollegeChange, validateRoleChange } from "@/lib/user-membership-rules";

/**
 * SECURITY-HARDENING-01: the service-role client is loaded inside handlers so
 * the server-only module never enters a client-reachable import chain.
 *
 * H-11: every handler here runs behind `requireSecureAdmin`, which proves with
 * the CALLER's RLS-bound client that the session is valid, MFA-verified (aal2),
 * not waiting for a password change, and that the caller is a super_admin —
 * BEFORE the service-role client is used.
 */
async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/**
 * Fail-closed per-actor throttle for sensitive administrative operations.
 * A failure to evaluate the limit denies the operation.
 */
async function assertRateLimit(
  actorId: string,
  action: "user_create" | "user_admin" | "password_reset_admin" | "role_change",
): Promise<void> {
  const supabaseAdmin = await admin();
  const { data, error } = await supabaseAdmin.rpc("consume_security_limit", {
    p_actor: actorId,
    p_action: action,
  });
  if (error || data !== true) {
    throw new Error("تم تجاوز الحد المسموح لهذه العملية مؤقتًا. أعد المحاولة بعد قليل.");
  }
}

const ROLE = z.enum([
  "super_admin",
  "college_admin",
  "read_only",
  "institutional_viewer",
  "university_leadership",
  "college_dean",
]);

/**
 * PROVISIONING-GRANT-02: trusted-boundary mapping from a UI role to the role
 * accepted by issue_account_provisioning_grant / enforce_admin_account_creation.
 * The allowed database role list is NOT widened; "college_dean" is provisioned
 * as "college_admin" and the dean role is assigned after the account exists.
 */
export const PROVISIONING_ROLE_BY_ROLE: Record<z.infer<typeof ROLE>, string> = {
  super_admin: "super_admin",
  college_admin: "college_admin",
  read_only: "read_only",
  institutional_viewer: "institutional_viewer",
  university_leadership: "university_leadership",
  college_dean: "college_admin",
};

async function audit(entry: {
  actor_id: string;
  action: string;
  entity: string;
  entity_id: string | null;
  college_id?: string | null;
  details: Record<string, unknown>;
}) {
  const supabaseAdmin = await admin();
  const { error } = await supabaseAdmin.from("audit_logs").insert({
    ...entry,
    details: entry.details as never,
  });
  if (error) console.error("[users.functions] audit insert failed", entry.action, error);
}

/** Returns auth metadata (last_sign_in_at, banned_until) for all users. */
export const adminListUserMeta = createServerFn({ method: "POST" })
  .middleware([requireSecureAdmin])
  .handler(async () => {
    const supabaseAdmin = await admin();
    const out: Array<{ id: string; last_sign_in_at: string | null; banned_until: string | null }> =
      [];
    let page = 1;
    // paginate up to 10 pages (10000 users)
    for (let i = 0; i < 10; i++) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw serverFailure("تعذّر قراءة بيانات الدخول للمستخدمين.", error, "listUsers");
      for (const u of data.users) {
        out.push({
          id: u.id,
          last_sign_in_at: u.last_sign_in_at ?? null,
          banned_until: (u as unknown as { banned_until?: string | null }).banned_until ?? null,
        });
      }
      if (data.users.length < 1000) break;
      page += 1;
    }
    return out;
  });

export const adminCreateUser = createServerFn({ method: "POST" })
  .middleware([requireSecureAdmin])
  .inputValidator(
    z
      .object({
        full_name: z.string().trim().min(1).max(200),
        email: z.string().email(),
        password: z
          .string()
          .refine((v) => new TextEncoder().encode(v).length <= PASSWORD_MAX_BYTES, {
            message: `كلمة المرور أطول من ${PASSWORD_MAX_BYTES} بايت.`,
          }),
        role: ROLE,
        college_ids: z.array(z.string().uuid()).max(50).default([]),
      })
      .superRefine((value, ctx) => {
        // M-3: the same new-password policy as every other place passwords are set.
        const issues = passwordPolicyIssues(value.password, {
          email: value.email,
          name: value.full_name,
        });
        if (issues.length > 0)
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["password"],
            message: describePasswordIssues(issues),
          });
      }),
  )
  .handler(async ({ data, context }) => {
    // The caller's super_admin role, session and aal2 are proven by requireSecureAdmin.
    await assertRateLimit(context.userId, "user_create");
    const supabaseAdmin = await admin();

    // Only academic affairs receives all colleges. Report viewers retain the
    // explicit selection, including when the auth trigger grants read_only.
    let collegeIds = data.role === "university_leadership" ? [] : [...new Set(data.college_ids)];
    if (assignsAllColleges(data.role)) {
      const { data: allColleges, error: colErr } = await supabaseAdmin
        .from("colleges")
        .select("id")
        .order("id");
      if (colErr) throw serverFailure("تعذّر قراءة قائمة الكليات.", colErr, "create:colleges");
      collegeIds = (allColleges ?? []).map((c) => c.id);
    } else if (requiresCollegeAssignment(data.role) && collegeIds.length === 0) {
      throw new Error("يجب إسناد كلية واحدة على الأقل لهذا الدور.");
    }
    if (requiresExactlyOneCollege(data.role) && collegeIds.length !== 1) {
      throw new Error("يجب إسناد كلية واحدة فقط لعميد الكلية.");
    }

    if (collegeIds.length > 0) {
      const { data: selected, error } = await supabaseAdmin
        .from("colleges")
        .select("id")
        .in("id", collegeIds);
      if (error) throw serverFailure("تعذّر التحقق من الكليات المختارة.", error, "create:in");
      if (selected?.length !== collegeIds.length)
        throw new Error("إحدى الكليات المختارة غير موجودة؛ حدّث الصفحة.");
    }

    // PROVISIONING-GRANT-01: the deferred admin-only guard cannot rely on Auth
    // metadata, which is not yet visible in the first auth.users transaction.
    // Issue a 60s single-use grant bound to normalized email + role + creator;
    // the guard consumes it atomically at COMMIT and fails closed without it.
    const normalizedEmail = data.email.trim().toLowerCase();
    // PROVISIONING-GRANT-02: the provisioning guard accepts only the five
    // canonical account-creation roles. The college dean is provisioned as a
    // college_admin account, then receives its real role below; no other value
    // is ever forwarded to the guard (fail-closed).
    const provisioningRole = PROVISIONING_ROLE_BY_ROLE[data.role];
    if (!provisioningRole) {
      throw new Error("هذا الدور غير مسموح به لإنشاء الحسابات.");
    }
    const { data: grantRows, error: grantErr } = await supabaseAdmin.rpc(
      "issue_account_provisioning_grant",
      { p_email: normalizedEmail, p_role: provisioningRole, p_created_by: context.userId },
    );
    const grant = (grantRows as unknown as Array<{ grant_id: string; nonce: string }> | null)?.[0];
    if (grantErr || !grant) {
      throw serverFailure("تعذّر تفويض إنشاء الحساب.", grantErr, "create:grant");
    }

    // H-2: the provisioning keys travel ONLY in app_metadata (not user-writable);
    // the guard trusts raw_app_meta_data exclusively. user_metadata carries
    // display fields only.
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: normalizedEmail,
      password: data.password,
      email_confirm: true,
      user_metadata: {
        full_name: data.full_name,
      },
      app_metadata: {
        provisioning_role: provisioningRole,
        provisioning_nonce: grant.nonce,
        must_change_password: requiresInitialPassword(data.role),
      },
    });
    if (createErr || !created.user) {
      // Never leave an unconsumed grant behind when creation fails.
      await supabaseAdmin.rpc("revoke_account_provisioning_grant", { p_grant_id: grant.grant_id });
      await audit({
        actor_id: context.userId,
        action: "user_create_failed",
        entity: "profiles",
        entity_id: null,
        details: { email: normalizedEmail, role: data.role, grant_revoked: true },
      });
      throw serverFailure("تعذّر إنشاء الحساب.", createErr, "create:auth");
    }
    const newId = created.user.id;
    // Consumed grants are terminal; drop the row so nothing can linger.
    await supabaseAdmin.rpc("revoke_account_provisioning_grant", { p_grant_id: grant.grant_id });

    // The handle_new_user trigger has already created a profile + a default role assignment.
    // Sync the profile name + replace role(s) with the requested one.
    await supabaseAdmin
      .from("profiles")
      .upsert({ id: newId, email: data.email, full_name: data.full_name }, { onConflict: "id" });

    await supabaseAdmin.from("user_roles").delete().eq("user_id", newId);
    const { error: roleErr } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: newId, role: data.role as never });
    if (roleErr) throw serverFailure("أُنشئ الحساب لكن تعذّر إسناد الدور.", roleErr, "create:role");

    if (collegeIds.length > 0) {
      const rows = collegeIds.map((collegeId: string) => ({
        user_id: newId,
        college_id: collegeId,
      }));
      // The role trigger may already have inserted the same rows: stay idempotent.
      const { error: ucErr } = await supabaseAdmin
        .from("user_colleges")
        .upsert(rows, { onConflict: "user_id,college_id", ignoreDuplicates: true });
      if (ucErr) throw serverFailure("أُنشئ الحساب لكن تعذّر إسناد الكليات.", ucErr, "create:uc");
    }

    await audit({
      actor_id: context.userId,
      action: "user_created",
      entity: "profiles",
      entity_id: newId,
      details: { email: data.email, role: data.role, college_ids: collegeIds },
    });

    return { id: newId };
  });

export const adminSetUserEnabled = createServerFn({ method: "POST" })
  .middleware([requireSecureAdmin])
  .inputValidator(z.object({ user_id: z.string().uuid(), enabled: z.boolean() }))
  .handler(async ({ data, context }) => {
    await assertRateLimit(context.userId, "user_admin");
    const supabaseAdmin = await admin();
    if (data.user_id === context.userId && !data.enabled) {
      throw new Error("لا يمكنك تعطيل حسابك.");
    }
    const ban_duration = data.enabled ? "none" : "876000h"; // ~100 years
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, { ban_duration });
    if (error) throw serverFailure("تعذّر تحديث حالة الحساب.", error, "ban");

    let sessionsRevoked: boolean | null = null;
    if (!data.enabled) {
      // L-2: a ban blocks new tokens only; revoke live sessions/refresh tokens too.
      const { error: revokeErr } = await supabaseAdmin.rpc(
        "admin_revoke_user_sessions" as never,
        { p_user_id: data.user_id } as never,
      );
      if (revokeErr && isMissingFunctionError(revokeErr)) {
        console.warn(
          "[users.functions] admin_revoke_user_sessions is not deployed yet; sessions were not revoked",
        );
        sessionsRevoked = false;
      } else if (revokeErr) {
        await audit({
          actor_id: context.userId,
          action: "user_disabled",
          entity: "profiles",
          entity_id: data.user_id,
          details: { sessions_revoked: false },
        });
        throw serverFailure(
          "عُطّل الحساب لكن تعذّر إنهاء جلساته الحالية؛ أعد المحاولة.",
          revokeErr,
          "revoke",
        );
      } else sessionsRevoked = true;
    }

    await audit({
      actor_id: context.userId,
      action: data.enabled ? "user_enabled" : "user_disabled",
      entity: "profiles",
      entity_id: data.user_id,
      details: data.enabled ? {} : { sessions_revoked: sessionsRevoked },
    });
    return { ok: true };
  });

function resetRedirectUrl(): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  const base = env?.SITE_URL || env?.PUBLIC_SITE_URL;
  if (!base) return undefined;
  try {
    return new URL("/reset-password", base).toString();
  } catch {
    return undefined;
  }
}

export const adminGeneratePasswordReset = createServerFn({ method: "POST" })
  .middleware([requireSecureAdmin])
  .inputValidator(z.object({ user_id: z.string().uuid(), email: z.string().email() }))
  .handler(async ({ data, context }) => {
    await assertRateLimit(context.userId, "password_reset_admin");
    const supabaseAdmin = await admin();
    const { data: account, error: accountError } = await supabaseAdmin.auth.admin.getUserById(
      data.user_id,
    );
    const user = account?.user;
    if (
      accountError ||
      !user?.email ||
      user.email.toLowerCase() !== data.email.trim().toLowerCase()
    )
      throw new Error("تعذر مطابقة المستخدم والبريد الإلكتروني؛ حدّث قائمة المستخدمين.");
    const { data: roles, error: rolesError } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);
    if (rolesError || !roles?.length) throw new Error("تعذر التحقق من أدوار المستخدم.");

    // Super admins are exempt from the first-login password-change flow.
    // L-1: never hand a live recovery link to another admin's browser: Supabase
    // e-mails the recovery link directly to the account owner.
    if (roles.some((r) => r.role === "super_admin")) {
      const redirectTo = resetRedirectUrl();
      const { error } = await supabaseAdmin.auth.resetPasswordForEmail(
        user.email,
        redirectTo ? { redirectTo } : undefined,
      );
      if (error) throw serverFailure("تعذر إرسال رابط الاستعادة.", error, "recovery-email");
      await audit({
        actor_id: context.userId,
        action: "password_reset_requested",
        entity: "profiles",
        entity_id: user.id,
        details: { delivery: "email" },
      });
      return {
        email: user.email,
        temporary_password: null,
        action_link: null,
        sent: true,
      };
    }

    // Uniform selection from 64 symbols; generated only on the authenticated server.
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const password = Array.from(
      crypto.getRandomValues(new Uint8Array(24)),
      (value) => alphabet[value & 63],
    ).join("");
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      password,
      app_metadata: {
        ...user.app_metadata,
        must_change_password: true,
        password_reset_after: Math.floor(Date.now() / 1000),
      },
    });
    if (updateError) throw new Error("تعذر تعيين كلمة المرور المؤقتة؛ أعد المحاولة.");
    await audit({
      actor_id: context.userId,
      action: "password_reset_completed",
      entity: "profiles",
      entity_id: user.id,
      details: {},
    });
    return { email: user.email, temporary_password: password, action_link: null, sent: false };
  });

async function loadMembership(userId: string) {
  const supabaseAdmin = await admin();
  const [rolesRes, collegesRes] = await Promise.all([
    supabaseAdmin.from("user_roles").select("role").eq("user_id", userId),
    supabaseAdmin.from("user_colleges").select("college_id").eq("user_id", userId),
  ]);
  if (rolesRes.error || collegesRes.error)
    throw serverFailure(
      "تعذّر قراءة أدوار المستخدم وكلياته.",
      rolesRes.error ?? collegesRes.error,
      "membership",
    );
  return {
    roles: (rolesRes.data ?? []).map((r) => String(r.role)),
    collegeIds: (collegesRes.data ?? []).map((c) => c.college_id),
  };
}

/** L-3: role grant/revoke, enforced server-side (was a direct browser write). */
export const setUserRole = createServerFn({ method: "POST" })
  .middleware([requireSecureAdmin])
  .inputValidator(z.object({ userId: z.string().uuid(), role: ROLE, enabled: z.boolean() }))
  .handler(async ({ data, context }) => {
    await assertRateLimit(context.userId, "role_change");
    const supabaseAdmin = await admin();
    const current = await loadMembership(data.userId);
    let superAdminCount = Number.POSITIVE_INFINITY;
    if (!data.enabled && data.role === "super_admin") {
      const { count, error } = await supabaseAdmin
        .from("user_roles")
        .select("user_id", { count: "exact", head: true })
        .eq("role", "super_admin");
      if (error || typeof count !== "number")
        throw serverFailure("تعذّر التحقق من عدد مديري النظام.", error, "count-super");
      superAdminCount = count;
    }
    const violation = validateRoleChange({
      actorId: context.userId,
      targetId: data.userId,
      role: data.role,
      enabled: data.enabled,
      currentRoles: current.roles,
      currentCollegeIds: current.collegeIds,
      superAdminCount,
    });
    if (violation) throw new Error(violation);

    const has = current.roles.includes(data.role);
    if (data.enabled && !has) {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: data.userId, role: data.role as never });
      if (error && error.code !== "23505")
        throw serverFailure("تعذّر إسناد الدور.", error, "role-insert");
      // Academic affairs reads every college. Multi-role safety: never widen an
      // account that carries an admin role (DB trigger is the safety net).
      const isAdminAccount =
        current.roles.includes("super_admin") || current.roles.includes("college_admin");
      if (assignsAllColleges(data.role) && !isAdminAccount) {
        const { data: all, error: allErr } = await supabaseAdmin
          .from("colleges")
          .select("id")
          .order("id");
        if (allErr) throw serverFailure("تعذّر قراءة الكليات.", allErr, "role-colleges");
        if ((all ?? []).length > 0) {
          const { error: ucErr } = await supabaseAdmin.from("user_colleges").upsert(
            (all ?? []).map((c) => ({ user_id: data.userId, college_id: c.id })),
            { onConflict: "user_id,college_id", ignoreDuplicates: true },
          );
          if (ucErr) throw serverFailure("تعذّر إسناد الكليات.", ucErr, "role-uc");
        }
      }
    } else if (!data.enabled && has) {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .delete()
        .eq("user_id", data.userId)
        .eq("role", data.role as never);
      // LAST_SUPER_ADMIN from the DB trigger is mapped to Arabic by serverFailure.
      if (error) throw serverFailure("تعذّر إزالة الدور.", error, "role-delete");
    } else {
      return { ok: true, changed: false };
    }

    await audit({
      actor_id: context.userId,
      action: "role_changed",
      entity: "user_roles",
      entity_id: data.userId,
      details: { role: data.role, on: data.enabled },
    });
    return { ok: true, changed: true };
  });

/** L-3: college assignment, with the dean "exactly one college" rule on the final state. */
export const setUserCollege = createServerFn({ method: "POST" })
  .middleware([requireSecureAdmin])
  .inputValidator(
    z.object({ userId: z.string().uuid(), collegeId: z.string().uuid(), enabled: z.boolean() }),
  )
  .handler(async ({ data, context }) => {
    await assertRateLimit(context.userId, "role_change");
    const supabaseAdmin = await admin();
    const current = await loadMembership(data.userId);
    if (data.enabled) {
      const { data: college, error } = await supabaseAdmin
        .from("colleges")
        .select("id")
        .eq("id", data.collegeId)
        .maybeSingle();
      if (error) throw serverFailure("تعذّر التحقق من الكلية.", error, "college-read");
      if (!college) throw new Error("الكلية غير موجودة؛ حدّث الصفحة.");
    }
    const plan = planCollegeChange({
      collegeId: data.collegeId,
      enabled: data.enabled,
      currentRoles: current.roles,
      currentCollegeIds: current.collegeIds,
    });
    if (!plan.ok) throw new Error(plan.error);
    if (plan.add.length === 0 && plan.remove.length === 0) return { ok: true, changed: false };

    // Insert first, then remove: a dean is never left with zero colleges.
    if (plan.add.length > 0) {
      const { error } = await supabaseAdmin.from("user_colleges").upsert(
        plan.add.map((collegeId) => ({ user_id: data.userId, college_id: collegeId })),
        { onConflict: "user_id,college_id", ignoreDuplicates: true },
      );
      if (error) throw serverFailure("تعذّر إسناد الكلية.", error, "college-insert");
    }
    if (plan.remove.length > 0) {
      const { error } = await supabaseAdmin
        .from("user_colleges")
        .delete()
        .eq("user_id", data.userId)
        .in("college_id", plan.remove);
      if (error) throw serverFailure("تعذّر إزالة إسناد الكلية.", error, "college-delete");
    }

    for (const collegeId of plan.add)
      await audit({
        actor_id: context.userId,
        action: "college_assignment_added",
        entity: "user_colleges",
        entity_id: data.userId,
        college_id: collegeId,
        details: {},
      });
    for (const collegeId of plan.remove)
      await audit({
        actor_id: context.userId,
        action: "college_assignment_removed",
        entity: "user_colleges",
        entity_id: data.userId,
        college_id: collegeId,
        details: {},
      });
    return { ok: true, changed: true };
  });
