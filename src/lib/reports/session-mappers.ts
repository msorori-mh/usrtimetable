import { DAY_NAMES_AR, fmtTime, hoursBetween } from "@/lib/reports/formatters";
import type { Row } from "@/lib/reports/export";

export const SESSION_TYPE_LABELS: Record<string, string> = {
  lecture: "محاضرة",
  lab: "عملي",
  tutorial: "تمرين",
  seminar: "ندوة",
  workshop: "ورشة",
};

export const SESSION_STUDY_SYSTEM_LABELS: Record<string, string> = {
  regular: "عام",
  parallel: "موازي",
  both: "مشترك",
};

/** Normalized session shape for timetable reports. */
export interface TimetableReportSession {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  session_type: string;
  study_system: string;
  course_code: string;
  course_name: string;
  instructor_name: string;
  room_label: string;
  section_number: string;
  program_name: string;
  level_name: string;
  department_name: string;
}

export function sessionTypeLabel(type: string): string {
  return SESSION_TYPE_LABELS[type] ?? type;
}

export function studySystemLabel(sys: string | null | undefined): string {
  return SESSION_STUDY_SYSTEM_LABELS[sys ?? "regular"] ?? sys ?? "";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapRawToTimetableSession(raw: any): TimetableReportSession {
  const co = raw.course_offerings;
  const course = co?.courses;
  return {
    id: raw.id,
    day_of_week: raw.day_of_week,
    start_time: raw.start_time,
    end_time: raw.end_time,
    session_type: raw.session_type ?? "lecture",
    study_system: raw.study_system ?? "regular",
    course_code: course?.code ?? "",
    course_name: course?.name ?? "",
    instructor_name: raw.instructors?.full_name ?? "",
    room_label: raw.rooms ? `${raw.rooms.code ?? ""} ${raw.rooms.name ?? ""}`.trim() : "",
    section_number: raw.sections?.section_number ?? "",
    program_name: co?.academic_programs?.name ?? "",
    level_name: co?.academic_levels?.name ?? "",
    department_name: course?.departments?.name ?? "",
  };
}

export function mapRawSessions(raw: unknown[]): TimetableReportSession[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (raw as any[]).map(mapRawToTimetableSession);
}

export const TIMETABLE_TABLE_HEADERS: { key: string; label: string }[] = [
  { key: "department", label: "القسم" },
  { key: "program", label: "البرنامج" },
  { key: "level", label: "المستوى" },
  { key: "section", label: "المجموعة" },
  { key: "course", label: "المقرر" },
  { key: "day", label: "اليوم" },
  { key: "time", label: "الوقت" },
  { key: "session_type", label: "النوع" },
  { key: "instructor", label: "المحاضر" },
  { key: "room", label: "القاعة" },
  { key: "study_system", label: "نظام الدراسة" },
  { key: "hours", label: "الساعات" },
];

export function timetableSessionToRow(s: TimetableReportSession): Row {
  return {
    department: s.department_name,
    program: s.program_name,
    level: s.level_name,
    section: s.section_number,
    course: `${s.course_code} ${s.course_name}`.trim(),
    day: DAY_NAMES_AR[s.day_of_week] ?? "",
    time: `${fmtTime(s.start_time)} - ${fmtTime(s.end_time)}`,
    session_type: sessionTypeLabel(s.session_type),
    instructor: s.instructor_name,
    room: s.room_label,
    study_system: studySystemLabel(s.study_system),
    hours: Number(hoursBetween(s.start_time, s.end_time).toFixed(2)),
  };
}

export function timetableSessionsToRows(sessions: TimetableReportSession[]): Row[] {
  return sessions.map(timetableSessionToRow);
}

export function courseTitle(s: TimetableReportSession): string {
  const code = s.course_code ? `${s.course_code} ` : "";
  return `${code}${s.course_name}`.trim() || "—";
}
