import type { Tables } from "@/integrations/supabase/types";

export type StudySystem = "regular" | "parallel" | "evening" | "distance" | "other";
export type ApprovalStatus = "draft" | "approved" | "archived";

/**
 * Row shapes are inferred from the generated Supabase types (single source of
 * truth: supabase/migrations/20260721180000_source_only_scheduling_headcount_foundation.sql)
 * instead of hand-maintained duplicate interfaces.
 */
export type SchedulingHeadcount = Tables<"scheduling_cohort_term_headcounts">;
export type SchedulingHeadcountOverride = Tables<"scheduling_headcount_overrides">;
export type SchedulingHeadcountRevision = Tables<"scheduling_headcount_revisions">;

export type HeadcountRpcResult<T = Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; code: string; message: string; blocker?: boolean };

export interface HeadcountInput {
  cohortId: string;
  termId: string;
  registeredStudentCount: number;
  eligibleStudentCount: number;
  expectedAttendanceCount: number;
  reserveMargin?: number;
  schedulingHeadcount: number;
  examEligibleCount: number;
  source: string;
  notes?: string | null;
  allowOverEligible?: boolean;
}

export interface HeadcountOverrideInput {
  headcountId: string;
  courseOfferingId?: string | null;
  planCourseComponentId?: string | null;
  schedulingHeadcount: number;
  examEligibleCount?: number | null;
  reserveMargin?: number | null;
  source: string;
  notes?: string | null;
  allowOverEligible?: boolean;
}
