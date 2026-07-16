/**
 * Client wrapper: explicit V2 delivery generator invocation (never a hidden side-effect).
 */
import { supabase } from "@/integrations/supabase/client";
import type { GeneratorSummary } from "./types";
import { emptyGeneratorSummary } from "./types";

export interface GenerateDeliveryResult {
  ok: boolean;
  code?: string;
  message_ar?: string;
  summary: GeneratorSummary;
  raw?: unknown;
}

/**
 * Calls SECURITY DEFINER RPC `generate_academic_delivery_for_cohorts`.
 * Requires migration Phase 9.2 to be applied on the target database.
 */
export async function invokeGenerateAcademicDelivery(params: {
  collegeId: string;
  cohortIds: string[];
}): Promise<GenerateDeliveryResult> {
  if (!params.cohortIds.length) {
    return {
      ok: false,
      code: "EMPTY_COHORTS",
      message_ar: "حدّد دفعة واحدة على الأقل لتوليد نموذج التسليم.",
      summary: emptyGeneratorSummary(),
    };
  }

  const { data, error } = await supabase.rpc(
    "generate_academic_delivery_for_cohorts" as never,
    {
      p_college_id: params.collegeId,
      p_cohort_ids: params.cohortIds,
    } as never,
  );

  if (error) {
    return {
      ok: false,
      code: "RPC_ERROR",
      message_ar: `فشل استدعاء مولّد التسليم: ${error.message}`,
      summary: emptyGeneratorSummary(),
      raw: error,
    };
  }

  const raw = data as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") {
    return {
      ok: false,
      code: "INVALID_RESPONSE",
      message_ar: "استجابة غير متوقعة من مولّد التسليم.",
      summary: emptyGeneratorSummary(),
      raw: data,
    };
  }

  const summary = {
    ...emptyGeneratorSummary(),
    ...(typeof raw.summary === "object" && raw.summary != null
      ? (raw.summary as Partial<GeneratorSummary>)
      : {}),
  } as GeneratorSummary;

  // Some RPC shapes flatten counters at top level
  for (const k of [
    "cohorts_processed",
    "offerings_created",
    "offerings_updated",
    "delivery_groups_created",
    "delivery_groups_updated",
    "unchanged",
  ] as const) {
    if (typeof raw[k] === "number") summary[k] = raw[k] as number;
  }
  if (Array.isArray(raw.warnings)) summary.warnings = raw.warnings as GeneratorSummary["warnings"];
  if (Array.isArray(raw.validation_errors))
    summary.validation_errors = raw.validation_errors as GeneratorSummary["validation_errors"];

  return {
    ok: raw.ok === true,
    code: typeof raw.code === "string" ? raw.code : undefined,
    message_ar: typeof raw.message_ar === "string" ? raw.message_ar : undefined,
    summary,
    raw: data,
  };
}
