import { fetchSharedLectures } from "@/lib/academic-delivery/shared-lectures";
import { readAllReportRows } from "@/lib/reports/read-all";
import { supabase } from "@/integrations/supabase/client";
import type { DeliveryGroupCatalogRow } from "@/lib/reports/program-timetable-coverage";

/** Active groups are the coverage catalogue, including groups with no sessions. */
export async function fetchCohortDeliveryGroupCatalog(params: {
  collegeId: string;
  cohortIds: readonly string[];
}): Promise<DeliveryGroupCatalogRow[]> {
  const cohortIds = new Set(params.cohortIds.filter(Boolean));
  if (!cohortIds.size) return [];
  const college = params.collegeId;
  const allGroups = await readAllReportRows((from, to) =>
    supabase
      .from("operational_delivery_groups")
      .select(
        "id, cohort_id, group_code, group_number, expected_students, component_id, plan_course_id, active, is_obsolete",
      )
      .eq("college_id", college)
      .or("active.is.null,active.eq.true")
      .or("is_obsolete.is.null,is_obsolete.eq.false")
      .order("id")
      .range(from, to),
  );
  const shared = await fetchSharedLectures(college);
  const groups = allGroups
    .filter((g): g is typeof g & { id: string } => g.id != null)
    .filter(
      (g) =>
        (g.cohort_id != null && cohortIds.has(g.cohort_id)) ||
        shared.some((l) => l.anchor_group_id === g.id && cohortIds.has(l.cohort_id)),
    );
  if (!groups.length) return [];
  // Fetch all pages of scoped references: a server limit must not silently drop a
  // co-teacher or a component and change the report's demand or instructor label.
  const [components, planCourses, assignments, courses, instructors] = await Promise.all([
    readAllReportRows((from, to) =>
      supabase
        .from("plan_course_components")
        .select("id, component_type, weekly_contact_hours")
        .eq("college_id", college)
        .order("id")
        .range(from, to),
    ),
    readAllReportRows((from, to) =>
      supabase
        .from("plan_courses")
        .select("id, course_id")
        .eq("college_id", college)
        .order("id")
        .range(from, to),
    ),
    readAllReportRows((from, to) =>
      supabase
        .from("teaching_assignments")
        .select("id, delivery_group_id, instructor_id")
        .eq("college_id", college)
        .or("is_active.is.null,is_active.eq.true")
        .order("id")
        .range(from, to),
    ),
    readAllReportRows((from, to) =>
      supabase
        .from("courses")
        .select("id, code, name")
        .eq("college_id", college)
        .order("id")
        .range(from, to),
    ),
    readAllReportRows((from, to) =>
      supabase
        .from("instructors")
        .select("id, full_name")
        .eq("college_id", college)
        .order("id")
        .range(from, to),
    ),
  ]);
  const componentById = new Map(components.map((c) => [c.id, c]));
  const planCourseById = new Map(planCourses.map((c) => [c.id, c]));
  const courseById = new Map(courses.map((c) => [c.id, c]));
  const instructorById = new Map(instructors.map((i) => [i.id, i.full_name]));
  const teachersByGroup = new Map<string, Set<string>>();
  for (const assignment of assignments) {
    if (!assignment.delivery_group_id || !assignment.instructor_id) continue;
    const names = teachersByGroup.get(assignment.delivery_group_id) ?? new Set<string>();
    names.add(instructorById.get(assignment.instructor_id) ?? "محاضر غير متاح");
    teachersByGroup.set(assignment.delivery_group_id, names);
  }
  return groups.map((group) => {
    const component = group.component_id ? componentById.get(group.component_id) : undefined;
    const planCourse = group.plan_course_id ? planCourseById.get(group.plan_course_id) : undefined;
    const course = planCourse ? courseById.get(planCourse.course_id) : undefined;
    // Demand belongs to the component, never the first co-teacher's allocation.
    const requiredHours = Number(component?.weekly_contact_hours);
    if (
      !component ||
      component.weekly_contact_hours == null ||
      !Number.isFinite(requiredHours) ||
      requiredHours < 0
    )
      throw new Error("ساعات مكوّن مجموعة التدريس غير مكتملة؛ راجع الخطة قبل اعتماد التغطية");
    return {
      id: group.id,
      cohortId:
        group.cohort_id != null && cohortIds.has(group.cohort_id)
          ? group.cohort_id
          : shared.find((l) => l.anchor_group_id === group.id && cohortIds.has(l.cohort_id))!
              .cohort_id,
      groupCode: group.group_code,
      groupNumber: group.group_number,
      componentType: component.component_type,
      courseCode: course?.code ?? null,
      courseName: course?.name ?? null,
      expectedStudents: group.expected_students,
      requiredHours,
      instructorName: [...(teachersByGroup.get(group.id) ?? [])].join("، ") || null,
    };
  });
}
