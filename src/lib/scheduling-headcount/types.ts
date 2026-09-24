export type StudySystem = "regular" | "parallel" | "evening" | "distance" | "other";
export type ApprovalStatus = "draft" | "approved" | "archived";

export interface SchedulingHeadcount {
  id: string;
  college_id: string;
  cohort_id: string;
  term_id: string;
  study_system: StudySystem;
  registered_student_count: number;
  eligible_student_count: number;
  expected_attendance_count: number;
  reserve_margin: number;
  scheduling_headcount: number;
  exam_eligible_count: number;
  approval_status: ApprovalStatus;
  source: string;
  notes: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SchedulingHeadcountOverride {
  id: string;
  college_id: string;
  headcount_id: string;
  course_offering_id: string | null;
  plan_course_component_id: string | null;
  scheduling_headcount: number;
  exam_eligible_count: number | null;
  reserve_margin: number | null;
  approval_status: ApprovalStatus;
  source: string;
  notes: string | null;
  active: boolean;
  approved_by: string | null;
  approved_at: string | null;
}

export interface SchedulingHeadcountRevision {
  id: string;
  college_id: string;
  headcount_id: string;
  override_id: string | null;
  revision_kind: "create" | "update" | "approve" | "override_upsert" | "override_archive";
  snapshot: Record<string, unknown>;
  changed_by: string;
  changed_at: string;
  notes: string | null;
}

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
