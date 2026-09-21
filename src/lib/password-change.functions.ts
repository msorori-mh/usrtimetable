import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { PASSWORD_POLICY_AR, validPersonalPassword } from "@/lib/password-policy";

/** Loaded inside handlers only: the server-only module must not enter client chunks. */
async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Authenticated only; never accepts a target user ID from the browser. */
export const completeInitialPasswordChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      currentPassword: z.string().min(1).max(200),
      newPassword: z.string().refine(validPersonalPassword, PASSWORD_POLICY_AR),
    }),
  )
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await admin();
    // Fail-closed throttle: brute-force attempts on the temporary credential are
    // capped per actor without ever locking the account out globally.
    const { data: allowed, error: limitError } = await supabaseAdmin.rpc("consume_security_limit", {
      p_actor: context.userId,
      p_action: "password_change",
    });
    if (limitError || allowed !== true)
      throw new Error("تم تجاوز عدد المحاولات المسموح مؤقتًا. أعد المحاولة بعد قليل.");
    const { data: roles, error: roleError } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (roleError) throw new Error("تعذر التحقق من صلاحية الحساب.");
    if (roles?.some((r) => r.role === "super_admin"))
      throw new Error("حساب الأدمن مستثنى من هذا الإجراء.");
    const { data: account, error } = await supabaseAdmin.auth.admin.getUserById(context.userId);
    if (error || !account.user?.email) throw new Error("تعذر التحقق من الحساب.");
    const user = account.user;
    if (user.app_metadata?.must_change_password !== true)
      throw new Error(
        "لا يوجد تغيير أولي مطلوب لهذا الحساب. سجّل الخروج ثم ادخل مجددًا بكلمة مرورك الحالية.",
      );
    if (data.newPassword === data.currentPassword)
      throw new Error("اختر كلمة مرور مختلفة عن كلمة المرور المؤقتة.");

    // Verify the current credential in an isolated client, without replacing the
    // administrator/service client or persisting the temporary verification session.
    const verifier = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      },
    );
    const verified = await verifier.auth.signInWithPassword({
      email: user.email!,
      password: data.currentPassword,
    });
    if (verified.error || verified.data.user?.id !== context.userId)
      throw new Error("كلمة المرور المؤقتة غير صحيحة. أعد المحاولة.");
    try {
      // The Auth API updates password and protected app metadata together.
      const result = await supabaseAdmin.auth.admin.updateUserById(context.userId, {
        password: data.newPassword,
        app_metadata: {
          ...user.app_metadata,
          must_change_password: false,
          password_changed_at: new Date().toISOString(),
        },
      });
      if (result.error) throw new Error("تعذر حفظ كلمة المرور الجديدة. أعد المحاولة.");
      await supabaseAdmin.from("audit_logs").insert({
        actor_id: context.userId,
        action: "initial_password_changed",
        entity: "profiles",
        entity_id: context.userId,
        details: {} as never,
      });
      return { ok: true };
    } finally {
      // Revoke only this short-lived verification session, not other users.
      await verifier.auth.signOut({ scope: "local" });
    }
  });
