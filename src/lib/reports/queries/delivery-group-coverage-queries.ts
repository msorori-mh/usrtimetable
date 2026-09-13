import { readAllReportRows } from "@/lib/reports/read-all";
import { supabase } from "@/integrations/supabase/client";
import type { DeliveryGroupCatalogRow } from "@/lib/reports/program-timetable-coverage";

/**
 * Authoritative delivery-group catalogue for a college/term: every ACTIVE and
 * NON-OBSOLETE group, regardless of whether the selected schedule version
 * placed it. Read-only; RLS scopes the rows to the caller's colleges.
 */
export async function fetchCohortDeliveryGroupCatalog(params: {
  collegeId: string;
  cohortIds: readonly string[];
}): Promise<DeliveryGroupCatalogRow[]> {
  const cohortIds = [...new Set(params.cohortIds)].filter(Boolean);
  if (!cohortIds.length) return [];

  const groups = await readAllReportRows((from, to) =>
    supabase
      .from("delivery_groups")
      .select(
        "id, cohort_id, group_code, group_number, expected_students, component_id, plan_course_id, active, is_obsolete",
      )
      .eq("college_id", params.collegeId)
      .in("cohort_id", cohortIds)
      .or("active.is.null,active.eq.true")
      .or("is_obsolete.is.null,is_obsolete.eq.false")
      .order("id")
      .range(from, to),
  );

  const rows = groups ?? [];
  if (!rows.length) return [];

  const componentIds = [...new Set(rows.map((r) => r.component_id).filter(Boolean))] as string[];
  const planCourseIds = [...new Set(rows.map((r) => r.plan_course_id).filter(Boolean))] as string[];
  const groupIds = rows.map((r) => r.id);

  const [components, planCourses, assignments] = await Promise.all([
    componentIds.length
      ? supabase
          .from("plan_course_components")
          .select("id, component_type, weekly_contact_hours")
          .in("id", componentIds)
      : Promise.resolve({ data: [], error: null }),
    planCourseIds.length
      ? supabase.from("plan_courses").select("id, course_id").in("id", planCourseIds)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("teaching_assignments")
      .select("delivery_group_id, instructor_id, weekly_hours, assigned_component_hours, is_active")
      .eq("college_id", params.collegeId)
      .in("delivery_group_id", groupIds)
      .or("is_active.is.null,is_active.eq.true"),
  ]);
  for (const res of [components, planCourses, assignments]) if (res.error) throw res.error;

  const courseIds = [
    ...new Set(((planCourses.data ?? []) as { course_id: string }[]).map((p) => p.course_id)),
  ].filter(Boolean);
  const instructorIds = [
    ...new Set(
      ((assignments.data ?? []) as { instructor_id: string | null }[])
        .map((a) => a.instructor_id)
        .filter(Boolean) as string[],
    ),
  ];

  const [courses, instructors] = await Promise.all([
    courseIds.length
      ? supabase.from("courses").select("id, code, name").in("id", courseIds)
      : Promise.resolve({ data: [], error: null }),
    instructorIds.length
      ? supabase.from("instructors").select("id, full_name").in("id", instructorIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const res of [courses, instructors]) if (res.error) throw res.error;

  const componentById = new Map(
    (
      (components.data ?? []) as {
        id: string;
        component_type: string | null;
        weekly_contact_hours: number | null;
      }[]
    ).map((c) => [c.id, c]),
  );
  const courseById = new Map(
    ((courses.data ?? []) as { id: string; code: string | null; name: string | null }[]).map(
      (c) => [c.id, c],
    ),
  );
  const courseIdByPlanCourse = new Map(
    ((planCourses.data ?? []) as { id: string; course_id: string }[]).map((p) => [
      p.id,
      p.course_id,
    ]),
  );
  const instructorById = new Map(
    ((instructors.data ?? []) as { id: string; full_name: string | null }[]).map((i) => [i.id, i]),
  );
  const assignmentByGroup = new Map<
    string,
    {
      instructor_id: string | null;
      weekly_hours: number | null;
      assigned_component_hours: number | null;
    }
  >();
  for (const a of (assignments.data ?? []) as {
    delivery_group_id: string | null;
    instructor_id: string | null;
    weekly_hours: number | null;
    assigned_component_hours: number | null;
  }[]) {
    if (a.delivery_group_id && !assignmentByGroup.has(a.delivery_group_id)) {
      assignmentByGroup.set(a.delivery_group_id, a);
    }
  }

  return rows.map((r): DeliveryGroupCatalogRow => {
    const component = r.component_id ? componentById.get(r.component_id) : undefined;
    const course = r.plan_course_id
      ? courseById.get(courseIdByPlanCourse.get(r.plan_course_id) ?? "")
      : undefined;
    const assignment = assignmentByGroup.get(r.id);
    const requiredHours = Number(component?.weekly_contact_hours);
    if (!component || !Number.isFinite(requiredHours) || requiredHours <= 0)
      throw new Error("ساعات مكوّن مجموعة التدريس غير مكتملة؛ راجع الخطة قبل اعتماد التغطية");
    return {
      id: r.id,
      cohortId: r.cohort_id,
      groupCode: r.group_code ?? null,
      groupNumber: r.group_number ?? null,
      componentType: component?.component_type ?? null,
      courseCode: course?.code ?? null,
      courseName: course?.name ?? null,
      expectedStudents: r.expected_students ?? null,
      requiredHours: Number.isFinite(requiredHours) ? requiredHours : 0,
      instructorName: assignment?.instructor_id
        ? (instructorById.get(assignment.instructor_id)?.full_name ?? null)
        : null,
    };
  });
}
