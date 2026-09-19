import { InstructorCollegeHours } from "@/components/reports/instructor-college-hours";
import { summarizeUniversitySchedule } from "@/lib/reports/university-instructor-schedule";
import { createRoot } from "react-dom/client";
import "../../src/styles.css";
import { ReportShell } from "@/components/reports/report-shell";
import { ReportOfficialHeader } from "@/components/reports/report-official-header";
import { RepeatingPrintHeader } from "@/components/reports/repeating-print-header";
import { ReportTimetableView } from "@/components/reports/report-timetable-view";
import type { TimetableReportSession } from "@/lib/reports/session-mappers";
import { StudentScheduleTables } from "@/components/reports/student-schedule-tables";
import { PrintSheet } from "@/components/print-center/print-sheet";
import { DEFAULT_PRINT_VISIBILITY, printPageStyleCss } from "@/lib/print-center";
import { SHORT_FIXTURE } from "../print-proof/fixture";

const params = new URLSearchParams(location.search);
const mode = params.get("mode");
const readable = mode === "readable" || mode === "room-fit";
const paper = params.get("paper") === "A3" ? "A3" : "A4";
const orientation = params.get("orientation") === "landscape" ? "landscape" : "portrait";
const rows = Array.from({ length: mode === "room-fit" ? 18 : 140 }, (_, i) => ({
  id: `ROW${String(i).padStart(3, "0")}`,
  description: "محاضرة اختبار لقياس وضوح بيانات التقرير وتكرار الترويسة الرسمية",
}));
const headerMeta = {
  collegeName: "كلية تكنولوجيا المعلومات وعلوم الحاسوب",
  termName: "الفصل الأول 2026–2027",
  versionName: "PRINT_HEADER_PROOF_2026",
  versionStatus: "published" as const,
  studySystem: "all" as const,
};
const header = (
  <ReportOfficialHeader
    reportTitle="تقرير اختبار الطباعة"
    {...headerMeta}
    qrUrl="https://example.test/reports?version=PRINT_HEADER_PROOF_2026"
  />
);
const table = (
  <table>
    <thead>
      <tr>
        <th>COLUMN_KEY</th>
        <th>التفاصيل</th>
      </tr>
    </thead>
    <tbody>
      {rows.map((row) => (
        <tr key={row.id}>
          <td>{row.id}</td>
          <td>{row.description}</td>
        </tr>
      ))}
    </tbody>
  </table>
);
const sheetSessions = rows.map((row, i) => ({
  ...SHORT_FIXTURE[0],
  id: row.id,
  start_time: ["08:00:00", "12:00:00", "14:00:00", "08:30:00"][i % 4],
  end_time: ["10:00:00", "14:00:00", "16:00:00", "10:00:00"][i % 4],
  day_of_week: i % 6,
  course_offerings: {
    ...SHORT_FIXTURE[0].course_offerings!,
    courses: { ...SHORT_FIXTURE[0].course_offerings!.courses!, name: row.id },
  },
}));

const instructorSessions: TimetableReportSession[] = rows.slice(0, 18).map((row, i) => ({
  id: row.id,
  day_of_week: i % 6,
  start_time: String(8 + Math.floor(i / 6) * 2).padStart(2, "0") + ":00",
  end_time: String(10 + Math.floor(i / 6) * 2).padStart(2, "0") + ":00",
  session_type: "lecture",
  study_system: "regular",
  course_code: row.id,
  course_name: row.id,
  instructor_name: "محاضر الاختبار",
  room_label: "قاعة الاختبار",
  section_number: "",
  cohort_label: "دفعة الاختبار",
  delivery_group_label: "المجموعة الأولى",
  program_name: "علوم الحاسوب",
  level_name: "المستوى الأول",
  department_name: "الحاسوب",
}));

const individualSessions = instructorSessions.slice(0, 2).map((s, i) => ({
  ...s,
  day_of_week: 6,
  start_time: i === 0 ? "08:00" : "14:00",
  end_time: i === 0 ? "10:00" : "16:00",
  course_name: `مهارات الحاسوب ${s.id}`,
  session_type: "lab",
  study_system: "parallel",
  college_name: "كلية تكنولوجيا المعلومات وعلوم الحاسوب",
  department_name: "قسم نظم المعلومات الحاسوبية",
  cohort_label: "CS-P-L1-2026",
  delivery_group_label: i === 0 ? "G2" : "G1",
  room_label: i === 0 ? "قاعة 9" : "معمل حاسوب 3",
}));
const collegeSessions =
  mode === "individual"
    ? individualSessions
    : instructorSessions.slice(0, 6).map((s, i) => ({
        ...s,
        college_name: i < 3 ? "كلية الحاسوب" : "كلية العلوم الإدارية",
      }));

createRoot(document.getElementById("root")!).render(
  <main dir="rtl">
    {mode === "university" || mode === "individual" ? (
      <ReportShell
        title="COLUMN_KEY جدول المحاضر الموحد"
        headerMeta={headerMeta}
        rows={rows.slice(0, 6)}
        headers={[{ key: "id", label: "المحاضرة" }]}
        filename="university-proof"
      >
        <ReportTimetableView
          sessions={collegeSessions}
          hideInstructor
          printSummary={
            <InstructorCollegeHours
              summary={summarizeUniversitySchedule(
                collegeSessions.map((s, i) => ({
                  ...s,
                  college_id: i < 3 ? "c1" : "c2",
                  college_name: i < 3 ? "كلية الحاسوب" : "كلية العلوم الإدارية",
                  version_name: i < 3 ? "COMPUTING_V1" : "BUSINESS_V1",
                })),
                { maxWeeklyHours: 10, adminReleaseHours: 2 },
              )}
            />
          }
          compactDetails
        />
      </ReportShell>
    ) : mode === "student" ? (
      <ReportShell
        title="جدول الطلاب المنشور"
        headerMeta={headerMeta}
        rows={rows}
        headers={[{ key: "id", label: "المقرر" }]}
        filename="student-proof"
      >
        <StudentScheduleTables
          rows={rows.map((row, i) => ({
            id: row.id,
            scope_key: String(Math.floor(i / 70)),
            department: "قسم الحاسوب",
            program: "COLUMN_KEY",
            level: i < 70 ? "المستوى الأول" : "المستوى الثاني",
            cohort: "دفعة الاختبار",
            study_system: "عام",
            day_order: i % 6,
            day: "السبت",
            time: "08:00 - 10:00",
            course: row.id,
            instructor: "أ. محاضر الاختبار",
            room: "قاعة 1",
            session_type: "نظري",
            delivery_group: "G1",
          }))}
        />
      </ReportShell>
    ) : mode === "instructor" ? (
      <ReportShell
        title="COLUMN_KEY"
        headerMeta={headerMeta}
        rows={rows.slice(0, 18)}
        headers={[{ key: "id", label: "المحاضرة" }]}
        filename="instructor-proof"
      >
        <ReportTimetableView sessions={instructorSessions} />
      </ReportShell>
    ) : mode === "sheet" || readable ? (
      <PrintSheet
        readable={readable}
        labels={
          readable
            ? {
                cohorts: new Map([["cohort-proof", "CYB-L3-2024"]]),
                deliveryGroups: new Map([["group-proof", "G2"]]),
              }
            : undefined
        }
        page={{
          key: "proof",
          departmentName: readable ? "قسم الأمن السيبراني" : undefined,
          title: readable
            ? "COLUMN_KEY الأمن السيبراني – المستوى 3 – الموازي (نفقة خاصة)"
            : "COLUMN_KEY",
          sessions: readable
            ? sheetSessions.map((s) => ({
                ...s,
                rooms: {
                  ...s.rooms,
                  name: ["معمل حاسوب 2", "معمل حاسوب 12", "القاعة الكبرى", "قاعة 11"][
                    Number(s.id.slice(3)) % 4
                  ],
                },
                cohort_id: "cohort-proof",
                delivery_group_id: "group-proof",
                instructors: {
                  full_name:
                    mode === "room-fit" ? "د. محاضر الاختبار" : "د. محمد عبدالرحمن محاضر الاختبار",
                },
                course_offerings: {
                  ...s.course_offerings,
                  courses: {
                    ...s.course_offerings.courses,
                    name:
                      mode === "room-fit"
                        ? `${s.id} ${["أساسيات الويب", "قواعد البيانات", "الذكاء الاصطناعي للأمن السيبراني"][Number(s.id.slice(3)) % 3]}`
                        : `${s.id} الذكاء الاصطناعي للأمن السيبراني`,
                  },
                },
              }))
            : sheetSessions,
        }}
        visibility={DEFAULT_PRINT_VISIBILITY}
        meta={{
          ...headerMeta,
          exportAt: new Date("2026-09-18T00:00:00Z"),
          qrUrl: "https://example.test/reports",
          isDemo: false,
          pageIndex: 1,
          pageCount: 1,
        }}
      />
    ) : mode === "summary" ? (
      <section className="print-center-page">
        <RepeatingPrintHeader header={header}>
          <h2>ملخص القاعات والمعامل</h2>
          {table}
        </RepeatingPrintHeader>
      </section>
    ) : (
      <ReportShell
        title="تقرير اختبار الطباعة"
        headerMeta={headerMeta}
        rows={rows}
        headers={[{ key: "id", label: "COLUMN_KEY" }]}
        filename="proof"
      >
        {table}
      </ReportShell>
    )}
    <style>
      {params.has("paper") ? printPageStyleCss(paper, orientation) : printPageStyleCss()}
    </style>
  </main>,
);
