/**
 * Phase 9.3 — application service for generate_cohort_delivery_groups RPC.
 * Explicit caller only; never auto-invoked after import.
 */

import { supabase } from "@/integrations/supabase/client";
import {
  parseDeliveryGroupGeneratorSummary,
  type DeliveryGroupGeneratorSummary,
} from "@/lib/academic-delivery/delivery-group-generator-summary";
import { checkCohortDeliveryGroupRoomTypes } from "@/lib/academic-delivery/cohort-delivery-group-room-type-gate";
import { resolveSchedulingHeadcountRpc } from "@/lib/scheduling-headcount/api";

export type {
  DeliveryGroupGeneratorSummary,
  DeliveryGroupGeneratorWarning,
  DeliveryGroupGeneratorSkipped,
  DeliveryGroupGeneratorValidationError,
} from "@/lib/academic-delivery/delivery-group-generator-summary";

export { parseDeliveryGroupGeneratorSummary } from "@/lib/academic-delivery/delivery-group-generator-summary";

export class DeliveryGroupRoomTypeGateError extends Error {
  readonly code = "MISSING_ROOM_TYPE_COMPONENTS";
  readonly gate: Awaited<ReturnType<typeof checkCohortDeliveryGroupRoomTypes>>;

  constructor(
    gate: Extract<Awaited<ReturnType<typeof checkCohortDeliveryGroupRoomTypes>>, { ok: false }>,
  ) {
    super("MISSING_ROOM_TYPE_COMPONENTS");
    this.name = "DeliveryGroupRoomTypeGateError";
    this.gate = gate;
  }
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

  const resolution = await resolveSchedulingHeadcountRpc({
    collegeId: cohort.college_id,
    cohortId,
    termId: cohort.term_id,
  });
  if (resolution.ok !== true || resolution.blocker === true) {
    throw new Error(
      "SCHEDULING_HEADCOUNT_MISSING: يلزم اعتماد عدد الدفعة للجدولة قبل توليد المجموعات / An approved scheduling headcount is required before generating delivery groups.",
    );
  }

  const roomTypeGate = await checkCohortDeliveryGroupRoomTypes(cohortId);
  if (!roomTypeGate.ok) {
    throw new DeliveryGroupRoomTypeGateError(roomTypeGate);
  }

  const { data, error } = await supabase.rpc("generate_cohort_delivery_groups", {
    p_cohort_id: cohortId,
  });
  if (error) throw error;
  return parseDeliveryGroupGeneratorSummary(data);
}
