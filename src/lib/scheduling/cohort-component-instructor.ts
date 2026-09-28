export type CohortComponentInstructorFact = {
  cohortId: string;
  planCourseId: string;
  componentType: string;
  deliveryGroupId: string;
  assignmentId?: string | null;
  instructorIdentityId: string | null;
  instructorName?: string | null;
};

export type CohortComponentInstructorViolation = {
  cohort_id: string;
  cohort_code: string | null;
  plan_course_id: string;
  course_code: string | null;
  course_name: string | null;
  component_type: "theory" | "practical";
  group_count: number;
  instructor_count: number;
  identity_missing_count: number;
  instructor_names: string[];
  assignment_ids: string[];
};

export type CohortComponentInstructorReadiness = {
  ok: boolean;
  college_id: string;
  schedule_version_id: string | null;
  academic_term_id: string | null;
  violation_count: number;
  violations: CohortComponentInstructorViolation[];
};

const governedComponent = (
  value: string,
): value is CohortComponentInstructorViolation["component_type"] =>
  value === "theory" || value === "practical";

const finiteNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const textOrNull = (value: unknown): string | null =>
  value == null || String(value).trim() === "" ? null : String(value);

const stringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(String).filter(Boolean) : [];

/** Parse the fail-closed database readiness contract. */
export function parseCohortComponentInstructorReadiness(
  raw: unknown,
): CohortComponentInstructorReadiness {
  const root = (raw ?? {}) as Record<string, unknown>;
  const violations = (Array.isArray(root.violations) ? root.violations : []).flatMap((item) => {
    const row = (item ?? {}) as Record<string, unknown>;
    const componentType = String(row.component_type ?? "");
    if (!governedComponent(componentType)) return [];
    return [
      {
        cohort_id: String(row.cohort_id ?? ""),
        cohort_code: textOrNull(row.cohort_code),
        plan_course_id: String(row.plan_course_id ?? ""),
        course_code: textOrNull(row.course_code),
        course_name: textOrNull(row.course_name),
        component_type: componentType,
        group_count: finiteNumber(row.group_count),
        instructor_count: finiteNumber(row.instructor_count),
        identity_missing_count: finiteNumber(row.identity_missing_count),
        instructor_names: stringArray(row.instructor_names),
        assignment_ids: stringArray(row.assignment_ids),
      } satisfies CohortComponentInstructorViolation,
    ];
  });
  const violationCount = finiteNumber(root.violation_count);
  return {
    ok: root.ok === true && violationCount === 0 && violations.length === 0,
    college_id: String(root.college_id ?? ""),
    schedule_version_id: textOrNull(root.schedule_version_id),
    academic_term_id: textOrNull(root.academic_term_id),
    violation_count: Math.max(violationCount, violations.length),
    violations,
  };
}

/**
 * Pure mirror used by tests and client preflights. The database trigger remains
 * authoritative and compares the same university faculty identity.
 */
export function findCohortComponentInstructorViolations(
  facts: readonly CohortComponentInstructorFact[],
): CohortComponentInstructorViolation[] {
  const buckets = new Map<string, CohortComponentInstructorFact[]>();
  for (const fact of facts) {
    if (!governedComponent(fact.componentType)) continue;
    const key = `${fact.cohortId}|${fact.planCourseId}|${fact.componentType}`;
    buckets.set(key, [...(buckets.get(key) ?? []), fact]);
  }

  const violations: CohortComponentInstructorViolation[] = [];
  for (const factsForKey of buckets.values()) {
    const groupIds = new Set(factsForKey.map((fact) => fact.deliveryGroupId));
    if (groupIds.size < 2) continue;
    // An unassigned delivery group proves that the component is split, but it
    // is not itself a missing faculty identity. The write guard evaluates the
    // identity as soon as an assignment is added to that group.
    const assignedFacts = factsForKey.filter((fact) => Boolean(fact.assignmentId));
    const identities = new Set(
      assignedFacts
        .map((fact) => fact.instructorIdentityId)
        .filter((identity): identity is string => Boolean(identity)),
    );
    const missing = assignedFacts.filter((fact) => !fact.instructorIdentityId).length;
    if (identities.size <= 1 && missing === 0) continue;
    const first = factsForKey[0];
    violations.push({
      cohort_id: first.cohortId,
      cohort_code: null,
      plan_course_id: first.planCourseId,
      course_code: null,
      course_name: null,
      component_type: first.componentType as "theory" | "practical",
      group_count: groupIds.size,
      instructor_count: identities.size,
      identity_missing_count: missing,
      instructor_names: [
        ...new Set(
          assignedFacts
            .map((fact) => fact.instructorName?.trim())
            .filter((name): name is string => Boolean(name)),
        ),
      ].sort((a, b) => a.localeCompare(b, "ar")),
      assignment_ids: assignedFacts
        .map((fact) => fact.assignmentId)
        .filter((id): id is string => Boolean(id)),
    });
  }
  return violations;
}

const componentLabelAr = (component: "theory" | "practical") =>
  component === "theory" ? "النظري" : "العملي";

/** Actionable Arabic message shared by generation and conflict reporting. */
export function cohortComponentInstructorViolationMessageAr(
  violation?: CohortComponentInstructorViolation | null,
): string {
  if (!violation) {
    return "يجب أن يدرّس محاضر واحد جميع مجموعات النظري، ومحاضر واحد جميع مجموعات العملي للمقرر نفسه داخل الدفعة.";
  }
  const course =
    violation.course_code && violation.course_name
      ? `${violation.course_code} — ${violation.course_name}`
      : violation.course_code || violation.course_name || "المقرر";
  const cohort = violation.cohort_code ? ` للدفعة ${violation.cohort_code}` : " للدفعة";
  if (violation.identity_missing_count > 0) {
    return `تعذر اعتماد ${componentLabelAr(violation.component_type)} في ${course}${cohort}: هوية أحد المحاضرين غير مكتملة. استكمل الهوية ثم وحّد المحاضر لجميع المجموعات.`;
  }
  return `${componentLabelAr(violation.component_type)} في ${course}${cohort} موزع على أكثر من محاضر. وحّد المحاضر لجميع المجموعات قبل بناء الجدول.`;
}

export function cohortComponentInstructorViolationMessageEn(
  violation?: CohortComponentInstructorViolation | null,
): string {
  const component = violation?.component_type ?? "theory/practical component";
  return `All split groups for the same cohort, course and ${component} component must use one instructor identity.`;
}
