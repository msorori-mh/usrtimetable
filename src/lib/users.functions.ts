import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  assignsAllColleges,
  requiresCollegeAssignment,
  requiresExactlyOneCollege,
} from "@/lib/viewer-roles";
import { requiresInitialPassword } from "@/lib/password-policy";

/**
 * SECURITY-HARDENING-01: the service-role client is loaded inside handlers so
 * the server-only module never enters a client-reachable import chain.
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

async function assertInstitutionAdmin(userId: string) {
  const supabaseAdmin = await admin();
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "super_admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: institution admin only");
}

/** Returns auth metadata (last_sign_in_at, banned_until) for all users. */
export const adminListUserMeta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertInstitutionAdmin(context.userId);
    const supabaseAdmin = await admin();
    const out: Array<{ id: string; last_sign_in_at: string | null; banned_until: string | null }> =
      [];
    let page = 1;
    // paginate up to 10 pages (10000 users)
    for (let i = 0; i < 10; i++) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw new Error(error.message);
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
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      full_name: z.string().min(1).max(200),
      email: z.string().email(),
      password: z.string().min(8).max(200),
      role: ROLE,
      college_ids: z.array(z.string().uuid()).max(50).default([]),
    }),
  )
  .handler(async ({ data, context }) => {
    await assertInstitutionAdmin(context.userId);
    await assertRateLimit(context.userId, "user_create");
    const supabaseAdmin = await admin();

    // Only academic affairs receives all colleges. Report viewers retain the
    // explicit selection, including when the auth trigger grants read_only.
    let collegeIds = data.role === "university_leadership" ? [] : [...new Set(data.college_ids)];
    if (assignsAllColleges(data.role)) {
      const { data: allColleges, error: colErr } = await supabaseAdmin
        .from("colleges")
        .select("id");
      if (colErr) throw new Error(colErr.message);
      collegeIds = (allColleges ?? []).map((c) => c.id);
    } else if (requiresCollegeAssignment(data.role) && collegeIds.length === 0) {
      throw new Error("College assignment is required for every role except Super Admin");
    }
    if (requiresExactlyOneCollege(data.role) && collegeIds.length !== 1) {
      throw new Error("College dean must be assigned to exactly one college");
    }

    if (collegeIds.length > 0) {
      const { data: selected, error } = await supabaseAdmin
        .from("colleges")
        .select("id")
        .in("id", collegeIds);
      if (error) throw new Error(error.message);
      if (selected?.length !== collegeIds.length) throw new Error("Invalid college assignment");
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
      throw new Error("Role is not allowed for account provisioning");
    }
    const { data: grantRows, error: grantErr } = await supabaseAdmin.rpc(
      "issue_account_provisioning_grant",
      { p_email: normalizedEmail, p_role: provisioningRole, p_created_by: context.userId },
    );
    const grant = (grantRows as unknown as Array<{ grant_id: string; nonce: string }> | null)?.[0];
    if (grantErr || !grant) {
      throw new Error(grantErr?.message ?? "Failed to authorize account provisioning");
    }

    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: normalizedEmail,
      password: data.password,
      email_confirm: true,
      user_metadata: {
        full_name: data.full_name,
        provisioning_role: provisioningRole,
        provisioning_nonce: grant.nonce,
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
      await supabaseAdmin.from("audit_logs").insert({
        actor_id: context.userId,
        action: "user_create_failed",
        entity: "profiles",
        entity_id: null,
        details: { email: normalizedEmail, role: data.role, grant_revoked: true } as never,
      });
      throw new Error(createErr?.message ?? "Failed to create user");
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
    if (roleErr) throw new Error(roleErr.message);

    if (collegeIds.length > 0) {
      const rows = collegeIds.map((collegeId: string) => ({
        user_id: newId,
        college_id: collegeId,
      }));
      // The role trigger may already have inserted the same rows: stay idempotent.
      const { error: ucErr } = await supabaseAdmin
        .from("user_colleges")
        .upsert(rows, { onConflict: "user_id,college_id", ignoreDuplicates: true });
      if (ucErr) throw new Error(ucErr.message);
    }

    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId,
      action: "user_created",
      entity: "profiles",
      entity_id: newId,
      details: { email: data.email, role: data.role, college_ids: collegeIds } as never,
    });

    return { id: newId };
  });

export const adminSetUserEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ user_id: z.string().uuid(), enabled: z.boolean() }))
  .handler(async ({ data, context }) => {
    await assertInstitutionAdmin(context.userId);
    await assertRateLimit(context.userId, "user_admin");
    const supabaseAdmin = await admin();
    if (data.user_id === context.userId && !data.enabled) {
      throw new Error("You cannot disable your own account");
    }
    const ban_duration = data.enabled ? "none" : "876000h"; // ~100 years
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, { ban_duration });
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId,
      action: data.enabled ? "user_enabled" : "user_disabled",
      entity: "profiles",
      entity_id: data.user_id,
      details: {} as never,
    });
    return { ok: true };
  });

export const adminGeneratePasswordReset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ user_id: z.string().uuid(), email: z.string().email() }))
  .handler(async ({ data, context }) => {
    await assertInstitutionAdmin(context.userId);
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
    // Keep recovery for them rather than issuing an unchangeable temporary password.
    if (roles.some((r) => r.role === "super_admin")) {
      const { data: link, error } = await supabaseAdmin.auth.admin.generateLink({
        type: "recovery",
        email: user.email,
      });
      if (error || !link?.properties?.action_link) throw new Error("تعذر إنشاء رابط الاستعادة.");
      await supabaseAdmin.from("audit_logs").insert({
        actor_id: context.userId,
        action: "password_reset_requested",
        entity: "profiles",
        entity_id: user.id,
        details: {} as never,
      });
      return {
        email: user.email,
        temporary_password: null,
        action_link: link.properties.action_link,
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
    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId,
      action: "password_reset_completed",
      entity: "profiles",
      entity_id: user.id,
      details: {} as never,
    });
    return { email: user.email, temporary_password: password, action_link: null };
  });
