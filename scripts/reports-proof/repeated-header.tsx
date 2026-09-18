import { createRoot } from "react-dom/client";
import "../../src/styles.css";
import { ReportShell } from "@/components/reports/report-shell";
import { ReportOfficialHeader } from "@/components/reports/report-official-header";
import { RepeatingPrintHeader } from "@/components/reports/repeating-print-header";
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

createRoot(document.getElementById("root")!).render(
  <main dir="rtl">
    {mode === "sheet" ? (
      <PrintSheet
        page={{ key: "proof", title: "COLUMN_KEY", sessions: sheetSessions }}
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
    <style>{printPageStyleCss(paper, orientation)}</style>
  </main>,
);
