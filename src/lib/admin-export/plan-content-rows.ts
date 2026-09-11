/**
 * ADMIN-EXPORT-01 — flatten plan courses + their components into export rows.
 * A plan course with no components still produces one row (visible gap).
 */
import type { PlanContentExportRow } from "./datasets";

export type PlanCourseLike = {
  id: string;
  course_id: string;
  level_id: string | null;
  semester: number;
  is_required: boolean;
  lectures_per_week?: number | null;
  lecture_session_duration?: number | null;
  labs_per_week?: number | null;
  lab_session_duration?: number | null;
};

export type PlanComponentLike = {
  plan_course_id: string;
  component_type: string;
  weekly_contact_hours: number;
  required_room_type_id: string | null;
  is_timetabled: boolean;
  counts_toward_regular_load: boolean;
  counts_toward_overtime: boolean;
  compensation_mode: string;
  explicit_group_size: number | null;
};

export function buildPlanContentRows(input: {
  planCourses: PlanCourseLike[];
  components: PlanComponentLike[];
  courseLabel: (courseId: string) => { code: string; name: string } | null;
  levelLabel: (levelId: string | null) => string | null;
  roomTypeLabel: (roomTypeId: string | null) => string | null;
}): PlanContentExportRow[] {
  const byPlanCourse = new Map<string, PlanComponentLike[]>();
  for (const c of input.components) {
    const list = byPlanCourse.get(c.plan_course_id) ?? [];
    list.push(c);
    byPlanCourse.set(c.plan_course_id, list);
  }
  const rows: PlanContentExportRow[] = [];
  for (const pc of input.planCourses) {
    const course = input.courseLabel(pc.course_id);
    const base = {
      course_code: course?.code ?? "",
      course_name: course?.name ?? "",
      level_name: input.levelLabel(pc.level_id),
      semester: pc.semester,
      is_required: pc.is_required,
      lectures_per_week: pc.lectures_per_week ?? null,
      lecture_session_duration: pc.lecture_session_duration ?? null,
      labs_per_week: pc.labs_per_week ?? null,
      lab_session_duration: pc.lab_session_duration ?? null,
    };
    const components = byPlanCourse.get(pc.id) ?? [];
    if (components.length === 0) {
      rows.push({
        ...base,
        component_type: null,
        weekly_contact_hours: null,
        room_type_name: null,
        is_timetabled: null,
        counts_toward_regular_load: null,
        counts_toward_overtime: null,
        compensation_mode: null,
        explicit_group_size: null,
      });
      continue;
    }
    for (const c of components) {
      rows.push({
        ...base,
        component_type: c.component_type,
        weekly_contact_hours: c.weekly_contact_hours,
        room_type_name: input.roomTypeLabel(c.required_room_type_id),
        is_timetabled: c.is_timetabled,
        counts_toward_regular_load: c.counts_toward_regular_load,
        counts_toward_overtime: c.counts_toward_overtime,
        compensation_mode: c.compensation_mode,
        explicit_group_size: c.explicit_group_size,
      });
    }
  }
  return rows;
}
