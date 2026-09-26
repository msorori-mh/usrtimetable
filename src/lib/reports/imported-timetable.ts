/** Read-only projection of source rows; never manufactures sessions or identities. */
import {
  reconcileSourceRow,
  type ReconciliationSession,
} from "./source-reconciliation";

export interface ImportedSource {
  id: string;
  college_id: string;
  term_id: string;
  source_id: string;
  source_file: string;
  source_cell: string;
  raw_course: string | null;
  raw_teacher: string | null;
  raw_day: string | null;
  raw_time: string | null;
  raw_room: string | null;
  day_of_week: number | null;
  start_time: string | null;
  end_time: string | null;
  level_number: number | null;
  study_plan_id: string | null;
  notes: string | null;
  schedule_session_id: string | null;
  teaching_assignment_id: string | null;
  pending_reasons: string[];
  plan_course_id?: string | null;
  component_id?: string | null;
  delivery_group_id?: string | null;
  schedule_version_id?: string | null;
  shared_member?: boolean;
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function metadata(notes: string | null): Record<string, unknown> {
  try {
    return object(JSON.parse(notes ?? "{}"));
  } catch {
    return {};
  }
}

export function sourceDuration(
  start: string | null,
  end: string | null,
): number | null {
  const minutes = (value: string | null) => {
    if (!value || !/^\d{2}:\d{2}(:\d{2})?$/.test(value)) return null;
    const [h, m, s = 0] = value.split(":").map(Number);
    return h < 24 && m < 60 && s < 60 ? h * 60 + m + s / 60 : null;
  };
  const a = minutes(start);
  const b = minutes(end);
  return a !== null && b !== null && b > a ? (b - a) / 60 : null;
}

export function importedTimetableRows(
  sources: ImportedSource[],
  scope: { collegeId: string; termId: string },
  plans: ReadonlyMap<string, string> = new Map(),
  sessions?: readonly ReconciliationSession[],
) {
  return sources
    .filter(
      (source) =>
        source.college_id === scope.collegeId &&
        source.term_id === scope.termId,
    )
    .map((source) => {
      const meta = metadata(source.notes);
      const raw = object(meta.raw_extraction);
      const rawId = text(raw.id);
      const kind = /^S\d+$/.test(rawId)
        ? "timetable"
        : /^C\d+$/.test(rawId)
          ? "assignment"
          : source.day_of_week !== null || source.raw_day || source.raw_time
            ? "timetable"
            : "assignment";
      const hours = sourceDuration(source.start_time, source.end_time);
      const rawHours =
        typeof raw.hours === "number" && Number.isFinite(raw.hours)
          ? raw.hours
          : null;
      // When no version sessions were loaded, show that verification is pending
      // instead of declaring an existing FK complete.
      const reconciliation =
        kind === "timetable" && sessions
          ? reconcileSourceRow(source, sessions)
          : null;
      return {
        id: source.id,
        sourceId: source.source_id,
        kind,
        kindLabel: kind === "timetable" ? "جدول دراسي" : "كشف إسناد",
        department: text(raw.dept) || "غير محدد في المصدر",
        plan: plans.get(source.study_plan_id ?? "") ?? "بانتظار الربط",
        level:
          source.level_number === null
            ? "غير محدد"
            : String(source.level_number),
        courseCode: text(meta.source_course_code),
        course: source.raw_course ?? "",
        teacher: source.raw_teacher ?? "",
        day: source.raw_day ?? "",
        rawTime: source.raw_time ?? "",
        start: source.start_time?.slice(0, 5) ?? "",
        end: source.end_time?.slice(0, 5) ?? "",
        room: source.raw_room ?? "",
        hours: hours ?? "",
        sourceHours: rawHours ?? "",
        activity: text(raw.activity),
        sourceFile: source.source_file,
        sourceCell: source.source_cell,
        sessionLinked: !!source.schedule_session_id,
        assignmentLinked: !!source.teaching_assignment_id,
        stage: reconciliation?.stage ?? "verification_pending",
        status: reconciliation
          ? reconciliation.issues.join("؛ ")
          : kind === "assignment"
            ? "كشف إسناد؛ لا يمثل محاضرة أسبوعية مستقلة"
            : "مطابقة الجلسات بانتظار التحميل",
        matchedSessionId: reconciliation?.sessionId ?? null,
        missingTime:
          kind === "timetable" &&
          (source.day_of_week === null || hours === null),
        review: source.pending_reasons.join("؛ "),
      };
    });
}

export type ImportedTimetableRow = ReturnType<
  typeof importedTimetableRows
>[number];
export type ImportedReportFilters = {
  kind: string;
  department: string;
  level: string;
  teacher: string;
  room: string;
  search: string;
};

export function filterImportedTimetable(
  rows: ImportedTimetableRow[],
  filters: ImportedReportFilters,
) {
  return rows.filter(
    (row) =>
      ["kind", "department", "level", "teacher", "room"].every((key) => {
        const field = key as
          | "kind"
          | "department"
          | "level"
          | "teacher"
          | "room";
        return filters[field] === "all" || row[field] === filters[field];
      }) &&
      `${row.course} ${row.courseCode} ${row.teacher} ${row.department} ${row.sourceFile} ${row.sourceId}`.includes(
        filters.search.trim(),
      ),
  );
}

export const IMPORTED_TIMETABLE_HEADERS = [
  { key: "sourceId", label: "معرف صف المصدر" },
  { key: "kindLabel", label: "نوع المصدر" },
  { key: "department", label: "القسم / البرنامج في المصدر" },
  { key: "level", label: "المستوى" },
  { key: "courseCode", label: "رمز المقرر" },
  { key: "course", label: "المقرر كما ورد" },
  { key: "teacher", label: "المحاضر كما ورد" },
  { key: "day", label: "اليوم كما ورد" },
  { key: "rawTime", label: "الوقت كما ورد" },
  { key: "start", label: "البداية" },
  { key: "end", label: "النهاية" },
  { key: "room", label: "القاعة كما وردت" },
  { key: "hours", label: "مدة الموعد بالساعات" },
  { key: "sourceHours", label: "الساعات المستخرجة من المصدر" },
  { key: "activity", label: "نوع النشاط في المصدر" },
  { key: "plan", label: "الخطة المرتبطة" },
  { key: "status", label: "حالة الربط" },
  { key: "review", label: "ملاحظات المراجعة" },
  { key: "sourceFile", label: "ملف المصدر" },
  { key: "sourceCell", label: "موضع المصدر" },
];
