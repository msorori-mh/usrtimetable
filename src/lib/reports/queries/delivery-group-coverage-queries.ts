import { fetchSharedLectures } from "@/lib/academic-delivery/shared-lectures";
import { fetchVersionGroupCatalog } from "@/lib/academic-delivery/version-group-catalog";
import { fetchVersionStudentMemberships } from "@/lib/academic-delivery/version-student-memberships";
import { readAllReportRows } from "@/lib/reports/read-all";
import { supabase } from "@/integrations/supabase/client";
import type { DeliveryGroupCatalogRow } from "@/lib/reports/program-timetable-coverage";
import { fetchReportAssignmentRefs } from "./assignment-queries";

/** Active groups are the coverage catalogue, including groups with no sessions. */
export async function fetchCohortDeliveryGroupCatalog(params: {
  collegeId: string;
  cohortIds: readonly string[];
  versionId?: string;
}): Promise<DeliveryGroupCatalogRow[]> {
  const cohortIds = new Set(params.cohortIds.filter(Boolean));
  if (!cohortIds.size) return [];
  const college = params.collegeId;
  const allGroups = params.versionId
    ? await fetchVersionGroupCatalog(params.versionId, params.cohortIds)
    : await readAllReportRows((from, to) =>
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
  const liveGroups = allGroups
    .filter((g): g is typeof g & { id: string } => g.id != null)
    // Archived groups may still exist in a version catalogue for historical reads.
    .filter((g) => g.active !== false && g.is_obsolete !== true);
  // Which cohorts attend each group. A schedule version carries its own merges,
  // so they are read from that version; without one the global links apply.
  const attendingCohorts = new Map<string, Set<string>>();
  const attend = (groupId: string, cohortId: string | null | undefined) => {
    if (!cohortId) return;
    const set = attendingCohorts.get(groupId) ?? new Set<string>();
    set.add(cohortId);
    attendingCohorts.set(groupId, set);
  };
  for (const g of liveGroups) attend(g.id, g.cohort_id);
  if (params.versionId) {
    const memberships = await fetchVersionStudentMemberships(
      params.versionId,
      liveGroups.map((g) => g.id),
    );
    for (const m of memberships) attend(m.delivery_group_id, m.cohort_id);
  } else {
    for (const l of await fetchSharedLectures(college)) attend(l.anchor_group_id, l.cohort_id);
  }
  const groups = liveGroups.filter((g) =>
    [...(attendingCohorts.get(g.id) ?? [])].some((id) => cohortIds.has(id)),
  );
  if (!groups.length) return [];
  // Fetch all pages of scoped references: a server limit must not silently drop a
  // co-teacher or a component and change the report's demand or instructor label.
  const [components, planCourses, assignments, courses] = await Promise.all([
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
    fetchReportAssignmentRefs({
      collegeId: college,
      versionId: params.versionId,
      groupIds: groups.map((group) => group.id),
    }),
    readAllReportRows((from, to) =>
      supabase
        .from("courses")
        .select("id, code, name")
        .eq("college_id", college)
        .order("id")
        .range(from, to),
    ),
  ]);
  const componentById = new Map(components.map((c) => [c.id, c]));
  const planCourseById = new Map(planCourses.map((c) => [c.id, c]));
  const courseById = new Map(courses.map((c) => [c.id, c]));
  const teachersByGroup = new Map<string, Set<string>>();
  for (const assignment of assignments) {
    if (!assignment.delivery_group_id || !assignment.instructor_id) continue;
    const names = teachersByGroup.get(assignment.delivery_group_id) ?? new Set<string>();
    names.add(assignment.instructor_name ?? "محاضر غير متاح");
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
          : [...(attendingCohorts.get(group.id) ?? [])].find((id) => cohortIds.has(id))!,
      sharedCohortIds: [...(attendingCohorts.get(group.id) ?? [])],
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
