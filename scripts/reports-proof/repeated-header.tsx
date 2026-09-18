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
const paper = params.get("paper") === "A3" ? "A3" : "A4";
const orientation = params.get("orientation") === "landscape" ? "landscape" : "portrait";
const rows = Array.from({ length: 140 }, (_, i) => ({
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

createRoot(document.getElementById("root")!).render(
  <main dir="rtl">
    {mode === "student" ? (
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
    ) : mode === "sheet" || mode === "readable" ? (
      <PrintSheet
        readable={mode === "readable"}
        labels={
          mode === "readable"
            ? {
                cohorts: new Map([["cohort-proof", "CYB-L3-2024"]]),
                deliveryGroups: new Map([["group-proof", "G2"]]),
              }
            : undefined
        }
        page={{
          key: "proof",
          title: "COLUMN_KEY",
          sessions:
            mode === "readable"
              ? sheetSessions.map((s) => ({
                  ...s,
                  cohort_id: "cohort-proof",
                  delivery_group_id: "group-proof",
                  instructors: { full_name: "د. محمد عبدالرحمن محاضر الاختبار" },
                  course_offerings: {
                    ...s.course_offerings,
                    courses: {
                      ...s.course_offerings.courses,
                      name: `${s.id} الذكاء الاصطناعي للأمن السيبراني`,
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
