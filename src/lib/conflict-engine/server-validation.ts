/**
 * Server-computed conflict validation (Q-2).
 *
 * `public.validate_schedule_version` evaluates every session of a version with the
 * authoritative database collector (all hard rules incl. ITCS 14:00, student daily hours,
 * extended days, membership-aware student overlap), removes approved exceptions and
 * super-admin policy waivers, and returns the counts the publish gate uses. The browser no
 * longer computes or persists hard-conflict counts for the gate.
 */
import { supabase } from "@/integrations/supabase/client";
import { mapServerValidation, type ServerVersionValidation } from "./server-conflicts";

export {
  mapServerConflict,
  mapServerValidation,
  parseHardConflictDetails,
  sessionWriteErrorMessageAr,
  type ServerVersionValidation,
} from "./server-conflicts";

/** Read-only, server-computed validation of a whole stored version. */
export async function fetchServerVersionValidation(
  scheduleVersionId: string,
): Promise<ServerVersionValidation> {
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await rpc("validate_schedule_version", {
    p_version_id: scheduleVersionId,
  });
  if (error) throw new Error(`تعذر فحص تعارضات النسخة على الخادم: ${error.message}`);
  return mapServerValidation(data);
}
