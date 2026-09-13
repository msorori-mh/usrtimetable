import { createRoot } from "react-dom/client";
import { useState } from "react";
import "../../src/styles.css";
import { ReportShell } from "@/components/reports/report-shell";
import { ReportTimetableView } from "@/components/reports/report-timetable-view";
import { ReportDataTable } from "@/components/reports/report-section";
import { ReportFilterBar } from "@/components/reports/report-filter-bar";
import {
  timetableSessionsToRows,
  type TimetableReportSession,
  NEW_FLOW_TIMETABLE_TABLE_HEADERS,
} from "@/lib/reports/session-mappers";
const sessions: TimetableReportSession[] = Array.from({ length: 18 }, (_, i) => ({
  id: `s${i}`,
  day_of_week: i % 6,
  start_time: `${8 + Math.floor(i / 6) * 2}:00`.padStart(5, "0"),
  end_time: `${10 + Math.floor(i / 6) * 2}:00`,
  session_type: i % 2 ? "lab" : "lecture",
  study_system: "regular",
  course_code: `IT${i}`,
  course_name: ["قواعد البيانات المتقدمة وتطبيقاتها", "هندسة البرمجيات", "الذكاء الاصطناعي"][i % 3],
  instructor_name: "أ. محاضر الاختبار",
  room_label: "معمل الحاسوب 3",
  section_number: "",
  cohort_label: "دفعة 2026",
  delivery_group_label: `مجموعة ${(i % 3) + 1}`,
  program_name: "تقنية المعلومات",
  level_name: "المستوى الثالث",
  department_name: "الحاسوب",
}));
const manyRows = Array.from({ length: 67 }, (_, i) => ({
  name: `عضو ${i + 1}`,
  required: 12,
  assigned: i % 20,
  status: "مراجعة",
  department: "الحاسوب",
  rank: "معيد",
  source: "بطاقة العضو",
  detail: `تفصيل ${i + 1}`,
}));
const columns = Object.keys(manyRows[0]).map((key) => ({
  key,
  label: (
    {
      name: "العضو",
      required: "النصاب",
      assigned: "المسند",
      status: "الحالة",
      department: "القسم",
      rank: "الرتبة",
      source: "المصدر",
      detail: "بيانات إضافية",
    } as Record<string, string>
  )[key],
}));
function App() {
  const [table, setTable] = useState(false),
    [search, setSearch] = useState("");
  const rows = table
    ? manyRows.filter((r) => r.name.includes(search))
    : timetableSessionsToRows(sessions);
  return (
    <main className="mx-auto max-w-[1440px] p-4 md:p-8" dir="rtl">
      <button className="report-no-print mb-3 underline" onClick={() => setTable(!table)}>
        تبديل مثال الاختبار
      </button>
      <ReportShell
        title={table ? "النصاب والإسناد — بيانات اختبار" : "الجدول الأسبوعي — أ. محاضر الاختبار"}
        description="بيانات اصطناعية للتحقق من العرض والطباعة"
        rows={rows}
        headers={table ? columns : NEW_FLOW_TIMETABLE_TABLE_HEADERS}
        filename="fixture"
        headerMeta={{
          termName: "الفصل الأول 2026–2027",
          versionName: "نسخة الاختبار",
          versionStatus: "draft",
        }}
        kpis={[
          { label: "المحاضرات", value: 18 },
          { label: "ساعات التدريس", value: 36 },
          { label: "أيام الحضور", value: 6 },
          { label: "المقررات", value: 3 },
        ]}
        filters={
          <ReportFilterBar
            basic={<p>الفصل الأول · نسخة اختبار · أ. محاضر الاختبار</p>}
            search={table ? { value: search, onChange: setSearch } : undefined}
          />
        }
      >
        {table ? (
          <ReportDataTable rows={rows} columns={columns} />
        ) : (
          <ReportTimetableView sessions={sessions} hideInstructor />
        )}
      </ReportShell>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
