import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Recheck live Auth and database state before a service-role operation. */
export async function assertLiveSecuritySession(
  client: SupabaseClient,
  userId: string,
  allowPasswordChange = false,
) {
  const { data, error } = await client.auth.getUser();
  if (error || data.user?.id !== userId)
    throw new Error("انتهت صلاحية الجلسة. سجّل الدخول مجددًا.");
  const status = await client.rpc("security_access_status");
  if (status.error || !status.data?.session_valid) throw new Error("تعذر التحقق من صلاحية الجلسة.");
  if (status.data.password_required && !allowPasswordChange)
    throw new Error("يجب تغيير كلمة المرور المؤقتة.");
  if (status.data.mfa_required && !allowPasswordChange)
    throw new Error("أكمل التحقق بخطوتين أولًا.");
}

export async function enforceSecurityLimit(
  userId: string,
  action: "user_admin" | "password_change",
) {
  const { data, error } = await supabaseAdmin.rpc(
    "consume_security_limit" as never,
    {
      p_actor: userId,
      p_action: action,
    } as never,
  );
  if (error) throw new Error("تعذر التحقق من حد المحاولات. أعد المحاولة لاحقًا.");
  if (data !== true) throw new Error("تجاوزت حد المحاولات. انتظر قليلًا ثم أعد المحاولة.");
}
