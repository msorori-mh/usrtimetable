import { context, minutes, placementIssue, type Snapshot, type Session } from "./compact.ts";
import { instructorAttendanceDayCap } from "./attendance-objective.ts";
import { isInstructorAvailabilityEnforced } from "../scheduling/instructor-availability-policy.ts";
import { evaluateInstructorSlotAvailability } from "../scheduling/instructor-slot-availability.ts";

const minuteTime = (value: number) =>
  `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}:00`;

export const placementLabels: Record<string, string> = {
  inactive_assignment: "الإسناد غير نشط أو غير موجود؛ يلزم تصحيح الإسناد قبل التحسين",
  inactive_room: "القاعة غير نشطة أو غير موجودة",
  inactive_instructor: "المحاضر غير نشط أو غير موجود",
  locked_session: "المحاضرة مقفلة",
  changed_duration: "تغيرت مدة المحاضرة",
  external_instructor_conflict: "تعارض مع تدريس المحاضر في كلية أخرى",
  working_window: "خارج أيام أو ساعات العمل",
  room_capacity_or_type: "سعة القاعة أو نوعها غير مناسب",
  room_closed_day: "القاعة غير متاحة في هذا اليوم",
  room_window: "خارج ساعات إتاحة القاعة",
  room_closure: "القاعة مغلقة في هذه الفترة",
  system_template: "خارج الفترات المسموحة للنظام الدراسي",
  instructor_availability: "خارج أوقات إتاحة المحاضر",
  instructor_daily_sessions: "تجاوز عدد محاضرات المحاضر في اليوم",
  instructor_day_cap: "تجاوز الحد المحفوظ لأيام حضور المحاضر",
  extended_day_cap: "تجاوز أيام التمديد للطلاب",
  resource_overlap: "تعارض وقت المحاضر أو الطلاب أو القاعة",
  required_break: "الاستراحة المطلوبة غير متاحة",
  student_day_cap: "تجاوز أيام حضور الطلاب",
  instructor_daily_hours: "تجاوز ساعات المحاضر اليومية",
  student_daily_hours: "تجاوز ساعات الطلاب اليومية",
  incomplete_partition: "بيانات المجموعات الطلابية غير مكتملة",
};
export interface QualityIssue {
  sessionId: string;
  instructorId: string;
  code: string;
  message: string;
}
/** Optimistic continuous-minute capacity: ignores rooms, students and packing, so a
 * deficit proves inconsistent inputs, never merely exhaustion of the search grid. */
export function instructorCapacityIssues(snapshot: Snapshot): QualityIssue[] {
  const issues: QualityIssue[] = [];
  for (const id of new Set(snapshot.sessions.map((s) => s.instructor_id))) {
    const teacher = snapshot.instructors.find((t) => t.id === id);
    if (!teacher) continue;
    const lectures = snapshot.sessions.filter((s) => s.instructor_id === id);
    const required = lectures.reduce((n, s) => n + minutes(s.end_time) - minutes(s.start_time), 0);
    const cap = instructorAttendanceDayCap(
      teacher.target_attendance_days_per_week,
      undefined,
      teacher.max_attendance_days_per_week,
    );
    const type = snapshot.types.find((t) => t.id === teacher.instructor_type_id);
    const daily = [...new Set(snapshot.settings.working_days)].map((day) => {
      const windows = snapshot.availability.filter(
        (w) => w.instructor_id === id && w.day_of_week === day && !w.is_preference,
      );
      let available = 0;
      for (
        let minute = minutes(snapshot.settings.day_start_time);
        minute < minutes(snapshot.settings.day_end_time);
        minute++
      ) {
        if (isInstructorAvailabilityEnforced(snapshot.settings.enforce_instructor_availability)) {
          if (
            !evaluateInstructorSlotAvailability({
              enforce: snapshot.settings.enforce_instructor_availability,
              startTime: minuteTime(minute),
              endTime: minuteTime(minute + 1),
              windows,
              requiresExplicitPositiveWindow:
                !!type?.is_external || type?.code === "from_other_college",
            }).available
          )
            continue;
        }
        if (
          snapshot.externalBusy?.some(
            (w) =>
              w.instructor_id === id &&
              w.day_of_week === day &&
              minute >= minutes(w.start_time) &&
              minute < minutes(w.end_time),
          )
        )
          continue;
        available++;
      }
      return Math.min(
        available,
        (teacher.max_hours_per_day ?? snapshot.settings.max_daily_hours_per_instructor ?? 6) * 60,
      );
    });
    const capacity = daily
      .sort((a, b) => b - a)
      .slice(0, cap)
      .reduce((a, b) => a + b, 0);
    if (required > capacity)
      issues.push({
        sessionId: lectures[0].id,
        instructorId: id,
        code: "instructor_capacity_deficit",
        message: `المطلوب ${required / 60} ساعات، والمتاح بحد أقصى ${capacity / 60} ساعات ضمن حد الحضور (${cap} أيام)؛ يلزم تصحيح الإتاحة أو حد الأيام قبل الجدولة`,
      });
  }
  return issues;
}
export function diagnoseQuality(snapshot: Snapshot): QualityIssue[] {
  return [
    ...instructorCapacityIssues(snapshot),
    ...snapshot.sessions.flatMap((session) => {
      const code = context(snapshot)
        .students(session)
        .some((p) => p.startsWith("cohort:"))
        ? "incomplete_partition"
        : placementIssue(snapshot, snapshot.sessions, { ...session, is_locked: false }, session);
      return code
        ? [
            {
              sessionId: session.id,
              instructorId: session.instructor_id,
              code,
              message: placementLabels[code] ?? code,
            },
          ]
        : [];
    }),
  ];
}
export interface PersonImpact {
  id: string;
  kind: "instructor" | "student";
  before: { days: number; gapMinutes: number; singleLectureDays: number };
  after: { days: number; gapMinutes: number; singleLectureDays: number };
}
/** Per-person comparison prevents aggregate improvements from concealing a harmed group. */
export function qualityImpact(snapshot: Snapshot, final: Session[]): PersonImpact[] {
  const summarize = (sessions: Session[]) => {
    const people = new Map<string, Map<number, Session[]>>();
    for (const session of sessions)
      for (const key of [
        `instructor:${session.instructor_id}`,
        ...context(snapshot)
          .students(session)
          .map((id) => `student:${id}`),
      ]) {
        const days = people.get(key) ?? new Map<number, Session[]>();
        days.set(session.day_of_week, [...(days.get(session.day_of_week) ?? []), session]);
        people.set(key, days);
      }
    return new Map(
      [...people].map(([id, days]) => {
        let gapMinutes = 0;
        for (const sessions of days.values()) {
          let end = 0;
          for (const s of [...sessions].sort(
            (a, b) => minutes(a.start_time) - minutes(b.start_time),
          )) {
            if (end) gapMinutes += Math.max(0, minutes(s.start_time) - end);
            end = Math.max(end, minutes(s.end_time));
          }
        }
        return [
          id,
          {
            days: days.size,
            gapMinutes,
            singleLectureDays: [...days.values()].filter((x) => x.length === 1).length,
          },
        ];
      }),
    );
  };
  const before = summarize(snapshot.sessions),
    after = summarize(final);
  return [...before].flatMap(([key, original]) => {
    const next = after.get(key);
    if (!next || JSON.stringify(original) === JSON.stringify(next)) return [];
    const colon = key.indexOf(":");
    return [
      {
        id: key.slice(colon + 1),
        kind: key.slice(0, colon) as PersonImpact["kind"],
        before: original,
        after: next,
      },
    ];
  });
}
