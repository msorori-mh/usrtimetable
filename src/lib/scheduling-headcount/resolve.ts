import type { SchedulingHeadcount, SchedulingHeadcountOverride } from "./types";

export type LocalHeadcountResolution =
  | {
      ok: true;
      schedulingHeadcount: number;
      examEligibleCount: number;
      reserveMargin: number;
      source: "override" | "base";
    }
  | {
      ok: false;
      code: "SCHEDULING_HEADCOUNT_MISSING";
      blocker: true;
      message: string;
    };

/** Pure preference only: approved override first, then approved base. Never use legacy counts. */
export function resolveSchedulingHeadcount(
  base: SchedulingHeadcount | null | undefined,
  override: SchedulingHeadcountOverride | null | undefined,
): LocalHeadcountResolution {
  if (!base || base.approval_status !== "approved") {
    return {
      ok: false,
      code: "SCHEDULING_HEADCOUNT_MISSING",
      blocker: true,
      message:
        "An approved scheduling headcount is required; registered students are not a fallback.",
    };
  }
  if (override?.active && override.approval_status === "approved") {
    return {
      ok: true,
      schedulingHeadcount: override.scheduling_headcount,
      examEligibleCount: override.exam_eligible_count ?? base.exam_eligible_count,
      reserveMargin: override.reserve_margin ?? base.reserve_margin,
      source: "override",
    };
  }
  return {
    ok: true,
    schedulingHeadcount: base.scheduling_headcount,
    examEligibleCount: base.exam_eligible_count,
    reserveMargin: base.reserve_margin,
    source: "base",
  };
}
