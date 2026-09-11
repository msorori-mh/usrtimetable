import { supabase } from "@/integrations/supabase/client";
import { fetchCollegeReadiness, type ReadinessData } from "@/lib/reports/readiness";
import { classifyNewFlowReadinessIssues, countSeverities, newFlowBlockers } from "./classify";
import {
  buildWizardStepResults,
  wizardPercentComplete,
  type OnboardingCounts,
} from "./wizard-steps";
import type { ClassifiedReadinessIssue, ReadinessSeverityCounts, WizardStepResult } from "./types";

export interface OnboardingReadinessSnapshot {
  readiness: ReadinessData;
  counts: OnboardingCounts;
  steps: WizardStepResult[];
  percentComplete: number;
  newFlowIssues: ClassifiedReadinessIssue[];
  severityCounts: ReadinessSeverityCounts;
  blockers: ClassifiedReadinessIssue[];
  checkedAt: string;
  hasElectives: boolean;
}

async function countExact(table: string, collegeId: string): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count, error } = await (supabase as any)
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("college_id", collegeId);
  if (error) throw new Error(`ONBOARDING_COUNT_FAILED[${table}]: ${error.message}`);
  return count ?? 0;
}

/**
 * Read-only onboarding snapshot. Uses fetchCollegeReadiness + lightweight counts.
 * Never inserts/updates/deletes; never touches published schedule sessions.
 */
export async function fetchOnboardingReadinessSnapshot(
  collegeId: string,
): Promise<OnboardingReadinessSnapshot> {
  const readiness = await fetchCollegeReadiness(collegeId);

  const [
    departments,
    programs,
    terms,
    cohorts,
    deliveryGroups,
    instructors,
    rooms,
    scheduleVersions,
    taV2,
    availability,
    electiveSlots,
  ] = await Promise.all([
    countExact("departments", collegeId),
    countExact("academic_programs", collegeId),
    countExact("academic_terms", collegeId),
    countExact("academic_cohorts", collegeId),
    // DELIVERY-GROUP-COVERAGE-FIX-01: exclude historical (obsolete) groups.
    supabase
      .from("delivery_groups")
      .select("id", { count: "exact", head: true })
      .eq("college_id", collegeId)
      .or("is_obsolete.is.null,is_obsolete.eq.false"),
    countExact("instructors", collegeId),
    countExact("rooms", collegeId),
    countExact("schedule_versions", collegeId),
    supabase
      .from("teaching_assignments")
      .select("id", { count: "exact", head: true })
      .eq("college_id", collegeId)
      .not("delivery_group_id", "is", null),
    supabase.from("instructor_availability").select("instructor_id").eq("college_id", collegeId),
    countExact("elective_slots", collegeId),
  ]);

  if (deliveryGroups.error) {
    throw new Error(`ONBOARDING_COUNT_FAILED[delivery_groups]: ${deliveryGroups.error.message}`);
  }
  if (taV2.error) {
    throw new Error(`ONBOARDING_COUNT_FAILED[teaching_assignments]: ${taV2.error.message}`);
  }
  if (availability.error) {
    throw new Error(
      `ONBOARDING_COUNT_FAILED[instructor_availability]: ${availability.error.message}`,
    );
  }

  const availIds = new Set(
    ((availability.data ?? []) as { instructor_id: string }[]).map((r) => r.instructor_id),
  );

  const counts: OnboardingCounts = {
    departments,
    programs,
    terms,
    planCourses: readiness.totals.planCourses,
    cohorts,
    deliveryGroups,
    instructors,
    rooms,
    teachingAssignmentsV2: taV2.count ?? 0,
    instructorsWithAvailability: availIds.size,
    scheduleVersions,
  };

  const allMetrics = [...readiness.studyPlan, ...readiness.resources, ...readiness.scheduling];
  const newFlowIssues = classifyNewFlowReadinessIssues(allMetrics);
  const severityCounts = countSeverities(newFlowIssues);
  const blockers = newFlowBlockers(newFlowIssues);
  const steps = buildWizardStepResults(counts, readiness);

  return {
    readiness,
    counts,
    steps,
    percentComplete: wizardPercentComplete(steps),
    newFlowIssues,
    severityCounts,
    blockers,
    checkedAt: new Date().toISOString(),
    hasElectives: electiveSlots > 0,
  };
}
