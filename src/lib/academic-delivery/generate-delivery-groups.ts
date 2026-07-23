/**
 * Phase 9.3 — application service for generate_cohort_delivery_groups RPC.
 * Explicit caller only; never auto-invoked after import.
 */

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
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

type ResolveSchedulingHeadcountReturns =
  Database["public"]["Functions"]["resolve_scheduling_headcount"]["Returns"];

/**
 * Fail-closed narrowing of the jsonb resolution payload (no casts): anything
 * that is not an explicit `{ ok: true }` without `blocker` is treated as a
 * missing approved scheduling headcount.
 */
function isSchedulingHeadcountMissing(resolved: ResolveSchedulingHeadcountReturns): boolean {
  if (typeof resolved !== "object" || resolved === null || Array.isArray(resolved)) {
    return true;
  }
  return resolved.ok !== true || resolved.blocker === true;
}

export async function generateCohortDeliveryGroups(
  cohortId: string,
): Promise<DeliveryGroupGeneratorSummary> {
  if (!cohortId) {
    throw new Error("COHORT_ID_REQUIRED");
  }
  const { data: cohort, error: cohortError } = await supabase
    .from("academic_cohorts")
    .select("college_id, term_id")
    .eq("id", cohortId)
    .maybeSingle();
  if (cohortError) throw cohortError;
  if (!cohort) throw new Error("COHORT_NOT_FOUND");

  const { data: resolved, error: resolveError } = await supabase.rpc(
    "resolve_scheduling_headcount",
    {
      p_college_id: cohort.college_id,
      p_cohort_id: cohortId,
      p_term_id: cohort.term_id,
    },
  );
  if (resolveError) throw resolveError;
  if (isSchedulingHeadcountMissing(resolved)) {
    throw new Error(
      "SCHEDULING_HEADCOUNT_MISSING: يلزم اعتماد عدد الدفعة للجدولة قبل توليد المجموعات / An approved scheduling headcount is required before generating delivery groups.",
    );
  }

  const { data, error } = await supabase.rpc("generate_cohort_delivery_groups", {
    p_cohort_id: cohortId,
  });
  if (error) throw error;
  return parseDeliveryGroupGeneratorSummary(data);
}
