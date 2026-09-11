import type { ReadinessMetric } from "@/lib/reports/readiness";
import type { LegacyCounterComponent } from "./plan-course-editor";

export type ReadinessPlanCourse = {
  id: string;
  course_id: string;
  level_id: string | null;
  semester: number | null;
  lectures_per_week: number | null;
  labs_per_week: number | null;
  lecture_session_duration: number | null;
  lab_session_duration: number | null;
};
export type ReadinessPlanComponent = LegacyCounterComponent & { plan_course_id: string };

/** Components are authoritative; old plans without components retain legacy checks. */
export function studyPlanReadinessMetrics(
  courses: { id: string }[],
  plans: ReadinessPlanCourse[],
  components: ReadinessPlanComponent[],
  missingRoomTypes: number,
): ReadinessMetric[] {
  const byPlan = new Map<string, ReadinessPlanComponent[]>();
  for (const c of components) {
    const list = byPlan.get(c.plan_course_id) ?? [];
    list.push(c);
    byPlan.set(c.plan_course_id, list);
  }
  const rows = plans.map((p) => {
    const parts = byPlan.get(p.id) ?? [];
    const hours = (types: string[]) =>
      parts
        .filter((c) => c.is_timetabled !== false && types.includes(c.component_type))
        .reduce((s, c) => s + Math.max(0, Number(c.weekly_contact_hours) || 0), 0);
    return {
      ...p,
      hasComponents: parts.length > 0,
      lectureHours: hours(["theory", "tutorial"]),
      labHours: hours(["practical"]),
    };
  });
  const linked = new Set(plans.map((p) => p.course_id));
  const metric = (
    label: string,
    missing: number,
    total = rows.length,
    critical = false,
  ): ReadinessMetric => ({ label, total, missing, critical, category: "study_plan" });
  const mismatch = (hours: number, count: number | null, duration: number | null) =>
    hours > 0
      ? !(Number(count) > 0) ||
        (Number(duration) > 0 && Math.abs(Number(count) * Number(duration) - hours) > 0.000001)
      : Number(count) > 0;
  const lectures = rows.filter(
    (r) => !r.hasComponents || r.lectureHours > 0 || Number(r.lectures_per_week) > 0,
  );
  const labs = rows.filter(
    (r) => !r.hasComponents || r.labHours > 0 || Number(r.labs_per_week) > 0,
  );
  return [
    metric(
      "مقررات غير مرتبطة بأي خطة دراسية",
      courses.filter((c) => !linked.has(c.id)).length,
      courses.length,
    ),
    metric("صفوف الخطة بدون مستوى", rows.filter((r) => !r.level_id).length),
    metric("صفوف الخطة بدون فصل (semester)", rows.filter((r) => !r.semester).length),
    metric(
      "عدد المحاضرات الأسبوعية يحتاج مزامنة مع الساعات",
      lectures.filter((r) =>
        r.hasComponents
          ? mismatch(r.lectureHours, r.lectures_per_week, r.lecture_session_duration)
          : !(Number(r.lectures_per_week) > 0),
      ).length,
      lectures.length,
    ),
    metric(
      "عدد المعامل الأسبوعية يحتاج مزامنة مع الساعات",
      labs.filter((r) =>
        r.hasComponents
          ? mismatch(r.labHours, r.labs_per_week, r.lab_session_duration)
          : r.labs_per_week == null,
      ).length,
      labs.length,
    ),
    metric(
      "بدون مدة محاضرة",
      lectures.filter((r) => !(Number(r.lecture_session_duration) > 0)).length,
      lectures.length,
    ),
    metric(
      "بدون مدة معمل",
      labs.filter(
        (r) =>
          (r.labHours > 0 || Number(r.labs_per_week) > 0) && !(Number(r.lab_session_duration) > 0),
      ).length,
      labs.length,
    ),
    metric(
      "مكوّنات مفعّلة للجدولة دون ساعات",
      components.filter((c) => c.is_timetabled !== false && !(Number(c.weekly_contact_hours) > 0))
        .length,
      components.length,
      true,
    ),
    metric(
      "PLAN_COMPONENT_ROOM_TYPE_MISSING: مكوّنات مجدولة بدون نوع قاعة صالح",
      missingRoomTypes,
      components.length,
      true,
    ),
  ];
}
