import { supabase } from "@/integrations/supabase/client";

/**
 * Audit trail writer.
 *
 * SECURITY-HARDENING-01: the client can no longer INSERT into audit_logs; it
 * calls the server-side `record_audit_log` RPC, which stamps actor_id from the
 * verified session, so the actor cannot be forged from the browser.
 */
export async function logAudit(params: {
  action: string;
  entity: string;
  entityId?: string | null;
  collegeId?: string | null;
  details?: Record<string, unknown>;
}) {
  const { data } = await supabase.auth.getUser();
  if (!data.user) return;
  await supabase.rpc("record_audit_log", {
    p_action: params.action,
    p_entity: params.entity,
    p_entity_id: params.entityId ?? undefined,
    p_college_id: params.collegeId ?? undefined,
    p_details: (params.details ?? null) as never,
  });
}
