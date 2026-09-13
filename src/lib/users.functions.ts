import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const ROLE = z.enum(["super_admin", "college_admin", "read_only", "institutional_viewer"]);

async function assertInstitutionAdmin(userId: string) {
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
    const out: Array<{ id: string; last_sign_in_at: string | null; banned_until: string | null }> = [];
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

    // Every role except super_admin is college-scoped. `institutional_viewer`
    // («إدارة الشؤون الأكاديمية») reads reports for its assigned colleges only,
    // so at least one college is mandatory for it too.
    if (requiresCollegeAssignment(data.role) && data.college_ids.length === 0) {
      throw new Error("College assignment is required for every role except Super Admin");
    }


    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.full_name },
    });
    if (createErr || !created.user) throw new Error(createErr?.message ?? "Failed to create user");
    const newId = created.user.id;

    // The handle_new_user trigger has already created a profile + a default role assignment.
    // Sync the profile name + replace role(s) with the requested one.
    await supabaseAdmin
      .from("profiles")
      .upsert({ id: newId, email: data.email, full_name: data.full_name }, { onConflict: "id" });

    await supabaseAdmin.from("user_roles").delete().eq("user_id", newId);
    const { error: roleErr } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: newId, role: data.role });
    if (roleErr) throw new Error(roleErr.message);

    if (data.college_ids.length > 0) {
      const rows = data.college_ids.map((collegeId: string) => ({
        user_id: newId,
        college_id: collegeId,
      }));
      const { error: ucErr } = await supabaseAdmin.from("user_colleges").insert(rows);
      if (ucErr) throw new Error(ucErr.message);
    }

    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId,
      action: "user_created",
      entity: "profiles",
      entity_id: newId,
      details: { email: data.email, role: data.role, college_ids: data.college_ids } as never,
    });

    return { id: newId };
  });

export const adminSetUserEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ user_id: z.string().uuid(), enabled: z.boolean() }))
  .handler(async ({ data, context }) => {
    await assertInstitutionAdmin(context.userId);
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
    const { data: link, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email: data.email,
    });
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId,
      action: "password_reset_requested",
      entity: "profiles",
      entity_id: data.user_id,
      details: {} as never,
    });
    return { action_link: link.properties?.action_link ?? null };
  });
