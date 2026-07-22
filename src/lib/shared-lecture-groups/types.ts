/**
 * A2.3: Shared lecture groups (المجموعات المشتركة للمحاضرات) — local UI types.
 *
 * Local types only (PR #62 style): the generated
 * src/integrations/supabase/types.ts is NOT hand-edited; the A2.1/A2.2 tables
 * and RPCs are SOURCE ONLY — NOT APPLIED, so all calls go through
 * rpc(name as never) / from(name as never) with local casts.
 */

export type SharedGroupStatus = "draft" | "active" | "locked" | "archived";

export type SharedGroupRevisionKind =
  | "create"
  | "add_component"
  | "remove_component"
  | "add_cohort"
  | "remove_cohort"
  | "status_transition"
  | "add_cross_college_cohort"
  | "remove_cross_college_cohort";

export interface SharedLectureGroup {
  id: string;
  college_id: string;
  term_id: string;
  name: string;
  status: SharedGroupStatus;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface SharedGroupComponentLink {
  id: string;
  college_id: string;
  group_id: string;
  plan_course_component_id: string;
  created_at: string;
}

export interface SharedGroupCohortMembership {
  id: string;
  college_id: string;
  group_id: string;
  cohort_id: string;
  created_at: string;
}

export interface SharedGroupCrossCollegeMembership {
  id: string;
  college_id: string;
  group_id: string;
  cohort_id: string;
  cohort_college_id: string;
  created_by: string;
  created_at: string;
}

export interface SharedGroupRevision {
  id: string;
  college_id: string;
  group_id: string;
  revision_kind: SharedGroupRevisionKind;
  snapshot: Record<string, unknown>;
  changed_by: string;
  changed_at: string;
  notes: string | null;
}

export interface SharedGroupCapacityBreakdownRow {
  cohort_id: string;
  membership_kind?: "same_college" | "cross_college";
  headcount_id: string;
  scheduling_headcount: number;
  reserve_margin: number | null;
}

export type SharedGroupRpcResult<T = Record<string, unknown>> =
  | ({ ok: true; code?: string } & T)
  | {
      ok: false;
      code: string;
      message: string;
      blocker?: boolean;
      missing_cohorts?: Array<{ cohort_id: string }>;
    };
