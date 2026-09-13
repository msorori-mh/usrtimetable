// Phase 1.5A — Instructor availability business rules.
// Three categories derived from instructor_types.code / is_external:
//   - "permanent"     → Permanent faculty. Availability is OPTIONAL; default
//                       working week is assumed when no rows exist.
//   - "other_college" → Lecturer from another college in the same university.
//                       Availability is MANDATORY (home-college commitments).
//   - "external"      → External lecturer (outside the university). Availability
//                       is MANDATORY before scheduling.
// When an instructor has no type assigned, we default to "permanent" to avoid
// false-positive readiness penalties on legacy data.

export type InstructorCategory = "permanent" | "other_college" | "external";

export interface TypeLike {
  code?: string | null;
  is_external?: boolean | null;
}

export interface InstructorTypeReference {
  id: string;
  instructor_type_id: string | null;
}

export interface InstructorTypeRecord extends TypeLike {
  id: string;
}

export function categorizeInstructor(type: TypeLike | null | undefined): InstructorCategory {
  if (!type) return "permanent";
  const code = (type.code ?? "").toLowerCase();
  if (code === "from_other_college") return "other_college";
  if (code === "permanent") return "permanent";
  if (type.is_external) return "external";
  // Unknown type code with is_external=false → treat as permanent.
  return "permanent";
}

export function requiresAvailability(cat: InstructorCategory): boolean {
  return cat !== "permanent";
}

/**
 * Join instructor rows to their type rows in memory.
 *
 * `instructors.instructor_type_id` is intentionally not assumed to be exposed
 * as a PostgREST relationship. Keeping the join explicit avoids PGRST200 when
 * a deployment has the column but no discoverable foreign-key relationship.
 */
export function buildInstructorCategoryMap(
  instructors: readonly InstructorTypeReference[],
  types: readonly InstructorTypeRecord[],
): Map<string, InstructorCategory> {
  const typesById = new Map(types.map((type) => [type.id, type]));
  return new Map(
    instructors.map((instructor) => [
      instructor.id,
      categorizeInstructor(
        instructor.instructor_type_id ? typesById.get(instructor.instructor_type_id) : null,
      ),
    ]),
  );
}

/**
 * Unified Arabic presentation label for any lecturer whose availability is
 * governed as coming from outside the active college. Internal category codes
 * remain unchanged for backward compatibility and scheduling rules.
 */
export const OTHER_COLLEGE_INSTRUCTOR_LABEL_AR = "محاضر من كلية أخرى";

export const CATEGORY_LABEL_AR: Record<InstructorCategory, string> = {
  permanent: "محاضر دائم",
  other_college: OTHER_COLLEGE_INSTRUCTOR_LABEL_AR,
  external: OTHER_COLLEGE_INSTRUCTOR_LABEL_AR,
};

export const INSTRUCTOR_FORM_HINT_AR: Record<InstructorCategory, string> = {
  permanent:
    "سيعتبر المحاضر متاحاً تلقائياً خلال أوقات العمل الرسمية، ويمكن إضافة استثناءات اختيارية.",
  other_college: "يجب تحديد أيام وأوقات التوفر قبل إدخاله في الجدولة.",
  external: "يجب تحديد أيام وأوقات التوفر قبل إدخاله في الجدولة.",
};
