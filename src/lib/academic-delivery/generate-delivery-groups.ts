/**
 * Phase 9.3 — application service for generate_cohort_delivery_groups RPC.
 * Explicit caller only; never auto-invoked after import.
 */

import { supabase } from "@/integrations/supabase/client";
import {
  parseDeliveryGroupGeneratorSummary,
  type DeliveryGroupGeneratorSummary,
} from "@/lib/academic-delivery/delivery-group-generator-summary";

export type {
  DeliveryGroupGeneratorSummary,
  DeliveryGroupGeneratorWarning,
  DeliveryGroupGeneratorSkipped,
  DeliveryGroupGeneratorValidationError,
} from "@/lib/academic-delivery/delivery-group-generator-summary";

export { parseDeliveryGroupGeneratorSummary } from "@/lib/academic-delivery/delivery-group-generator-summary";

export async function generateCohortDeliveryGroups(
  cohortId: string,
): Promise<DeliveryGroupGeneratorSummary> {
  if (!cohortId) {
    throw new Error("COHORT_ID_REQUIRED");
  }
  const { data, error } = await supabase.rpc("generate_cohort_delivery_groups", {
    p_cohort_id: cohortId,
  });
  if (error) throw error;
  return parseDeliveryGroupGeneratorSummary(data);
}
