import { fetchAll } from "@/components/data-cleanup/cleanup-data";

/** Data-cleanup diagnostics computed from the fetched rows. */
// ---------- diagnostics ----------
export type IssueId =
  | "temp_codes"
  | "course_no_plan"
  | "course_missing_nature"
  | "course_no_pattern"
  | "course_no_room_req"
  | "ins_no_spec"
  | "ins_no_dept"
  | "ins_no_type"
  | "ins_no_avail"
  | "room_default_cap"
  | "room_no_type"
  | "room_dup_name"
  | "room_inactive"
  | "off_zero_students"
  | "off_no_assignment"
  | "off_no_system"
  | "off_no_plan_course";

export type Issue = {
  id: IssueId;
  label: string;
  count: number;
  total: number;
  severity: "critical" | "medium" | "low";
  impactPct: number; // estimated readiness % impact
  ids: string[];
};

export type Diagnostics = {
  issues: Record<IssueId, Issue>;
  readiness: number;
  estimatedAfter: number;
  critical: number;
  medium: number;
};

export const pct = (a: number, b: number) => (b === 0 ? 0 : Math.round((a / b) * 100));

export function computeDiagnostics(d: Awaited<ReturnType<typeof fetchAll>>): Diagnostics {
  const planCourseIds = new Set(d.planCourses.map((p) => p.course_id));
  const offeringCourseIds = new Set(d.offerings.map((o) => o.course_id));
  const assignedOfferingIds = new Set(d.assignments.map((a) => a.course_offering_id));
  const availInsIds = new Set(d.availability.map((a) => a.instructor_id));

  // Courses
  const tempCodes = d.courses.filter((c) => /^CRS-/i.test(c.code));
  const courseNoPlan = d.courses.filter((c) => !planCourseIds.has(c.id));
  const courseNoNature = d.courses.filter((c) => !c.course_nature);
  // Pattern + room requirements live on plan_courses
  const noPattern = d.planCourses.filter(
    (p) =>
      (Number(p.lectures_per_week ?? 0) === 0 && Number(p.labs_per_week ?? 0) === 0) ||
      ((p.lectures_per_week ?? 0) > 0 && !p.lecture_session_duration) ||
      ((p.labs_per_week ?? 0) > 0 && !p.lab_session_duration),
  );
  const noRoomReq = d.planCourses.filter(
    (p) =>
      ((p.lectures_per_week ?? 0) > 0 && !p.required_room_type_for_lecture) ||
      ((p.labs_per_week ?? 0) > 0 && !p.required_room_type_for_lab),
  );

  // Instructors
  const insNoSpec = d.instructors.filter((i) => !i.specialization);
  const insNoDept = d.instructors.filter((i) => !i.department_id);
  const insNoType = d.instructors.filter((i) => !i.instructor_type_id);
  const insNoAvail = d.instructors.filter((i) => !availInsIds.has(i.id));

  // Rooms
  const roomDefaultCap = d.rooms.filter((r) => r.capacity === 30);
  const roomNoType = d.rooms.filter((r) => !r.room_type_id);
  const nameCounts = new Map<string, number>();
  d.rooms.forEach((r) => {
    const k = r.name.trim().toLowerCase();
    nameCounts.set(k, (nameCounts.get(k) ?? 0) + 1);
  });
  const roomDupName = d.rooms.filter((r) => (nameCounts.get(r.name.trim().toLowerCase()) ?? 0) > 1);
  const roomInactive = d.rooms.filter((r) => !r.is_active);

  // Offerings
  const offZero = d.offerings.filter((o) => Number(o.expected_students ?? 0) === 0);
  const offNoAssign = d.offerings.filter((o) => !assignedOfferingIds.has(o.id));
  const offNoSystem = d.offerings.filter((o) => !o.study_system);
  const offNoPlanCourse = d.offerings.filter((o) => !o.plan_course_id);

  const totals = {
    courses: d.courses.length,
    planCourses: d.planCourses.length,
    instructors: d.instructors.length,
    rooms: d.rooms.length,
    offerings: d.offerings.length,
  };

  const mk = (
    id: IssueId,
    label: string,
    rows: { id: string }[],
    total: number,
    severity: Issue["severity"],
    factor: number,
  ): Issue => {
    const p = pct(rows.length, total);
    return {
      id,
      label,
      count: rows.length,
      total,
      severity,
      impactPct: Math.round(p * factor),
      ids: rows.map((r) => r.id),
    };
  };

  const issues: Record<IssueId, Issue> = {
    temp_codes: mk(
      "temp_codes",
      "مقررات برموز مؤقتة (CRS-)",
      tempCodes,
      totals.courses,
      "critical",
      0.4,
    ),
    course_no_plan: mk(
      "course_no_plan",
      "مقررات غير مرتبطة بأي خطة دراسية",
      courseNoPlan,
      totals.courses,
      "medium",
      0.3,
    ),
    course_missing_nature: mk(
      "course_missing_nature",
      "مقررات بدون طبيعة (course_nature)",
      courseNoNature,
      totals.courses,
      "low",
      0.1,
    ),
    course_no_pattern: mk(
      "course_no_pattern",
      "مقررات الخطة بدون نمط محاضرات صحيح",
      noPattern,
      totals.planCourses,
      "critical",
      0.5,
    ),
    course_no_room_req: mk(
      "course_no_room_req",
      "مقررات الخطة بدون متطلبات قاعة",
      noRoomReq,
      totals.planCourses,
      "medium",
      0.3,
    ),

    ins_no_spec: mk(
      "ins_no_spec",
      "محاضرون بدون تخصص",
      insNoSpec,
      totals.instructors,
      "medium",
      0.2,
    ),
    ins_no_dept: mk(
      "ins_no_dept",
      "محاضرون بدون قسم",
      insNoDept,
      totals.instructors,
      "critical",
      0.4,
    ),
    ins_no_type: mk(
      "ins_no_type",
      "محاضرون بدون نوع",
      insNoType,
      totals.instructors,
      "medium",
      0.2,
    ),
    ins_no_avail: mk(
      "ins_no_avail",
      "محاضرون بدون توفّر مسجّل",
      insNoAvail,
      totals.instructors,
      "medium",
      0.3,
    ),

    room_default_cap: mk(
      "room_default_cap",
      "قاعات بسعة افتراضية (30)",
      roomDefaultCap,
      totals.rooms,
      "medium",
      0.2,
    ),
    room_no_type: mk("room_no_type", "قاعات بدون نوع", roomNoType, totals.rooms, "critical", 0.4),
    room_dup_name: mk("room_dup_name", "قاعات بأسماء مكررة", roomDupName, totals.rooms, "low", 0.1),
    room_inactive: mk("room_inactive", "قاعات غير نشطة", roomInactive, totals.rooms, "low", 0.05),

    off_zero_students: mk(
      "off_zero_students",
      "طرح بـ expected_students = 0",
      offZero,
      totals.offerings,
      "critical",
      0.5,
    ),
    off_no_assignment: mk(
      "off_no_assignment",
      "طرح بدون إسناد تدريسي",
      offNoAssign,
      totals.offerings,
      "critical",
      0.5,
    ),
    off_no_system: mk(
      "off_no_system",
      "طرح بدون نظام دراسة",
      offNoSystem,
      totals.offerings,
      "low",
      0.1,
    ),
    off_no_plan_course: mk(
      "off_no_plan_course",
      "طرح غير مرتبط بمقرر خطة",
      offNoPlanCourse,
      totals.offerings,
      "medium",
      0.3,
    ),
  };

  // overall readiness: 100 - sum of weighted impacts (capped)
  const totalImpact = Object.values(issues).reduce((s, i) => s + i.impactPct, 0);
  const readiness = Math.max(0, 100 - Math.min(100, Math.round(totalImpact / 6)));
  const estimatedAfter = 100; // after fixing all
  const critical = Object.values(issues).filter(
    (i) => i.severity === "critical" && i.count > 0,
  ).length;
  const medium = Object.values(issues).filter((i) => i.severity === "medium" && i.count > 0).length;
  return { issues, readiness, estimatedAfter, critical, medium };
}
