/**
 * Pure client-side hydration for Schedule Builder sessions.
 * No React / Supabase — safe for harnesses.
 */

export interface WorkspaceSessionFlatRow {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  session_type: string | null;
  study_system: string | null;
  section_id: string | null;
  section_subgroup_id?: string | null;
  instructor_id: string | null;
  room_id: string | null;
  updated_at: string | null;
  is_locked: boolean | null;
  replaced_by_split?: boolean | null;
  course_offering_id: string;
  expected_students?: number | null;
  /** New Flow identity (optional; preserved through hydrate). */
  cohort_id?: string | null;
  delivery_group_id?: string | null;
  source_type?: string | null;
  teaching_assignment_id?: string | null;
  section_group_id?: string | null;
  schedule_version_id?: string | null;
}

/** Nested shape expected by mapWorkspaceSessions (assembled client-side). */
export interface WorkspaceSessionHydratedRow {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  session_type?: string | null;
  study_system?: string | null;
  instructor_id?: string | null;
  section_id?: string | null;
  room_id?: string | null;
  updated_at?: string | null;
  is_locked?: boolean | null;
  course_offering_id?: string;
  cohort_id?: string | null;
  delivery_group_id?: string | null;
  source_type?: string | null;
  teaching_assignment_id?: string | null;
  section_group_id?: string | null;
  schedule_version_id?: string | null;
  /** Authoritative modern cohort + term scheduling headcount, when the session has a cohort. */
  cohort_term_headcount?: WorkspaceCohortTermHeadcountRow | null;
  course_offerings?: {
    program_id?: string | null;
    level_id?: string | null;
    expected_students?: number | null;
    enrollment_count_status?: string | null;
    enrollment_count_updated_at?: string | null;
    courses?: {
      name?: string | null;
      code?: string | null;
      department_id?: string | null;
      departments?: { name?: string | null } | null;
    } | null;
    academic_programs?: { name?: string | null } | null;
    academic_levels?: { name?: string | null; level_number?: number | null } | null;
  } | null;
  sections?: { section_number?: string | number | null } | null;
  section_subgroups?: {
    subgroup_code?: string | null;
    ordinal?: number | null;
    expected_students?: number | null;
  } | null;
  instructors?: { full_name?: string | null } | null;
  rooms?: { code?: string | null; name?: string | null } | null;
  section_subgroup_id?: string | null;
  expected_students?: number | null;
  replaced_by_split?: boolean | null;
}

export interface WorkspaceCohortTermHeadcountRow {
  cohort_id: string;
  scheduling_headcount: number;
  approval_status: string;
  updated_at: string | null;
}

export interface WorkspaceSessionLookups {
  offerings: Map<
    string,
    {
      id: string;
      program_id: string | null;
      level_id: string | null;
      course_id: string;
      expected_students?: number | null;
      enrollment_count_status?: string | null;
      enrollment_count_updated_at?: string | null;
    }
  >;
  courses: Map<
    string,
    { id: string; name: string | null; code: string | null; department_id: string | null }
  >;
  departments: Map<string, { id: string; name: string | null }>;
  programs: Map<string, { id: string; name: string | null }>;
  levels: Map<string, { id: string; name: string | null; level_number: number | null }>;
  sections: Map<string, { id: string; section_number: string | number | null }>;
  subgroups: Map<
    string,
    {
      id: string;
      subgroup_code: string | null;
      ordinal: number | null;
      expected_students: number | null;
    }
  >;
  instructors: Map<string, { id: string; full_name: string | null }>;
  rooms: Map<string, { id: string; code: string | null; name: string | null }>;
}

/**
 * Assemble flat session rows + lookup maps into the nested view shape.
 * Missing lookups stay null (no silent fallback to another college/room).
 */
export function assembleWorkspaceSessionRows(
  flat: WorkspaceSessionFlatRow[],
  lookups: WorkspaceSessionLookups,
): WorkspaceSessionHydratedRow[] {
  return flat.map((s) => {
    const offering = lookups.offerings.get(s.course_offering_id) ?? null;
    const course = offering ? (lookups.courses.get(offering.course_id) ?? null) : null;
    const department =
      course?.department_id != null
        ? (lookups.departments.get(course.department_id) ?? null)
        : null;
    const program =
      offering?.program_id != null ? (lookups.programs.get(offering.program_id) ?? null) : null;
    const level =
      offering?.level_id != null ? (lookups.levels.get(offering.level_id) ?? null) : null;
    const section = s.section_id ? (lookups.sections.get(s.section_id) ?? null) : null;
    const subgroup = s.section_subgroup_id
      ? (lookups.subgroups.get(s.section_subgroup_id) ?? null)
      : null;
    const instructor = s.instructor_id ? (lookups.instructors.get(s.instructor_id) ?? null) : null;
    const room = s.room_id ? (lookups.rooms.get(s.room_id) ?? null) : null;

    return {
      id: s.id,
      day_of_week: s.day_of_week,
      start_time: s.start_time,
      end_time: s.end_time,
      session_type: s.session_type,
      study_system: s.study_system,
      instructor_id: s.instructor_id,
      section_id: s.section_id,
      section_subgroup_id: s.section_subgroup_id ?? null,
      cohort_id: s.cohort_id ?? null,
      delivery_group_id: s.delivery_group_id ?? null,
      source_type: s.source_type ?? null,
      teaching_assignment_id: s.teaching_assignment_id ?? null,
      section_group_id: s.section_group_id ?? null,
      schedule_version_id: s.schedule_version_id ?? null,
      expected_students:
        offering?.expected_students ?? s.expected_students ?? subgroup?.expected_students ?? null,
      replaced_by_split: s.replaced_by_split ?? false,
      room_id: s.room_id,
      updated_at: s.updated_at,
      is_locked: s.is_locked,
      course_offering_id: s.course_offering_id,
      course_offerings: offering
        ? {
            program_id: offering.program_id,
            level_id: offering.level_id,
            expected_students: offering.expected_students ?? null,
            enrollment_count_status: offering.enrollment_count_status ?? "unverified",
            enrollment_count_updated_at: offering.enrollment_count_updated_at ?? null,
            // Missing course stays null for this row only — never drop the session.
            courses: course
              ? {
                  name: course.name,
                  code: course.code,
                  department_id: course.department_id,
                  departments: department ? { name: department.name } : null,
                }
              : null,
            academic_programs: program ? { name: program.name } : null,
            academic_levels: level ? { name: level.name, level_number: level.level_number } : null,
          }
        : null,
      sections: section ? { section_number: section.section_number } : null,
      section_subgroups: subgroup
        ? {
            subgroup_code: subgroup.subgroup_code,
            ordinal: subgroup.ordinal,
            expected_students: subgroup.expected_students,
          }
        : null,
      instructors: instructor ? { full_name: instructor.full_name } : null,
      rooms: room ? { code: room.code, name: room.name } : null,
    };
  });
}

/**
 * Attach the modern cohort + term source to hydrated rows.
 * A cohort session with no matching approved row remains explicitly unverified in the view mapper.
 */
export function attachCohortTermHeadcounts(
  rows: WorkspaceSessionHydratedRow[],
  headcounts: WorkspaceCohortTermHeadcountRow[],
): WorkspaceSessionHydratedRow[] {
  const byCohortId = new Map(headcounts.map((row) => [row.cohort_id, row]));
  return rows.map((row) => ({
    ...row,
    cohort_term_headcount: row.cohort_id ? (byCohortId.get(row.cohort_id) ?? null) : null,
  }));
}
