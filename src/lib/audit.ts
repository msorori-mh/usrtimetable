import { supabase } from "@/integrations/supabase/client";

export async function logAudit(params: {
  action: string;
  entity: string;
  entityId?: string | null;
  collegeId?: string | null;
  details?: Record<string, unknown>;
}) {
  const { data } = await supabase.auth.getUser();
  if (!data.user) return;
  await supabase.from("audit_logs").insert({
    actor_id: data.user.id,
    action: params.action,
    entity: params.entity,
    entity_id: params.entityId ?? null,
    college_id: params.collegeId ?? null,
    details: (params.details ?? null) as never,
  });
}
