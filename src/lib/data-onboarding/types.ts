/** Shared types for DATA-ONBOARDING-READINESS-WIZARD-01 (read-only classification). */

export type WizardStepStatus = "complete" | "incomplete" | "needs-review" | "warning" | "blocker";

export type ReadinessIssueSeverity = "BLOCKER" | "WARNING" | "INFO";

/** New Flow vs Legacy vs shared foundational metrics from fetchCollegeReadiness. */
export type ReadinessFlowKind = "new_flow" | "legacy" | "shared";

export type WizardStepId =
  | "academic_structure"
  | "study_plans"
  | "cohorts"
  | "delivery_groups"
  | "instructors"
  | "rooms"
  | "teaching_assignments"
  | "constraints"
  | "readiness_check"
  | "create_schedule_version";

export interface WizardStepDef {
  id: WizardStepId;
  order: number;
  titleAr: string;
  helpEli5Ar: string;
  /** Existing app route for "أصلح الآن" / open step. */
  fixHref: string;
}

export interface ClassifiedReadinessIssue {
  label: string;
  severity: ReadinessIssueSeverity;
  flow: ReadinessFlowKind;
  missing: number;
  total: number;
  /** Route for أصلح الآن — null when informational only. */
  fixHref: string | null;
  fixLabelAr: string;
}

export interface ReadinessSeverityCounts {
  BLOCKER: number;
  WARNING: number;
  INFO: number;
}

export interface WizardStepResult {
  id: WizardStepId;
  status: WizardStepStatus;
  titleAr: string;
  helpEli5Ar: string;
  fixHref: string;
  detailAr: string;
}

/** Pilot study systems stay strictly isolated. */
export const PILOT_STUDY_SYSTEMS = ["regular", "parallel"] as const;
export type PilotStudySystem = (typeof PILOT_STUDY_SYSTEMS)[number];
