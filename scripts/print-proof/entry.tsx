/**
 * LAUNCH-CLOSURE-03 print/export proof — browser entry.
 *
 * This file contains NO layout and NO export logic of its own. It mounts the real
 * `PrintSheet` component with the real print stylesheet (`src/styles.css`) and the
 * real `@page` rule (`printPageStyleCss`), and exposes the real `downloadCSV`,
 * `downloadXLSX` and `exportRowsToXlsx` helpers on `window` so a headless browser can
 * trigger genuine downloads and the bytes can be inspected.
 *
 * The paper size / orientation / fixture are chosen from the URL query so one build
 * covers A4 and A3 in both orientations.
 */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { PrintSheet } from "@/components/print-center/print-sheet";
import {
  DEFAULT_PRINT_VISIBILITY,
  PRINT_EXPORT_HEADERS,
  PRINT_PAGE_STYLE_ELEMENT_ID,
  buildExportRows,
  filterPrintSessions,
  groupPrintPages,
  printPageStyleCss,
  requestPrint,
  type PrintRequestResult,
  type PrintOrientation,
  type PrintPaperSize,
} from "@/lib/print-center";
import { downloadCSV, downloadXLSX } from "@/lib/reports/export";
import { exportRowsToXlsx } from "@/lib/admin-export/to-xlsx";
import { FIXTURE_FILTERS, LONG_FIXTURE, SHORT_FIXTURE } from "./fixture";
import "@/styles.css";

const q = new URLSearchParams(window.location.search);
const paper = (q.get("paper") === "A3" ? "A3" : "A4") as PrintPaperSize;
const orientation = (
  q.get("orientation") === "portrait" ? "portrait" : "landscape"
) as PrintOrientation;
const fixture = q.get("fixture") === "short" ? SHORT_FIXTURE : LONG_FIXTURE;

const sessions = filterPrintSessions(fixture, FIXTURE_FILTERS);
const pages = groupPrintPages(sessions, FIXTURE_FILTERS);
const rows = buildExportRows(pages);

declare global {
  interface Window {
    __printProof: {
      sessionCount: number;
      pageCount: number;
      rowCount: number;
      paper: PrintPaperSize;
      orientation: PrintOrientation;
      exportCsv: () => void;
      exportXlsx: () => void;
      exportAdminXlsx: () => void;
      lastPrint?: PrintRequestResult;
    };
  }
}

window.__printProof = {
  sessionCount: sessions.length,
  pageCount: pages.length,
  rowCount: rows.length,
  paper,
  orientation,
  exportCsv: () => downloadCSV(rows, PRINT_EXPORT_HEADERS, "print-proof-timetable"),
  exportXlsx: () => downloadXLSX(rows, PRINT_EXPORT_HEADERS, "print-proof-timetable", "الجدول"),
  exportAdminXlsx: () => exportRowsToXlsx("print-proof-admin", "الجدول", rows),
};

function Proof() {
  // Same runtime @page injection the print centre performs.
  useEffect(() => {
    const el = document.createElement("style");
    el.id = PRINT_PAGE_STYLE_ELEMENT_ID;
    el.textContent = printPageStyleCss(paper, orientation);
    document.head.appendChild(el);
    document.documentElement.dataset.printProofReady = "1";
    return () => el.remove();
  }, []);

  const onPrintClick = () => {
    // Exactly the shape of the application's print handler: window.print() via requestPrint.
    window.__printProof.lastPrint = requestPrint(window);
  };

  const exportAt = new Date("2026-09-10T00:00:00.000Z");
  return (
    <div dir="rtl" className="bg-background text-foreground">
      <button
        type="button"
        data-testid="print-proof-print-button"
        className="report-no-print"
        onClick={onPrintClick}
      >
        طباعة
      </button>
      {pages.map((page, i) => (
        <PrintSheet
          key={page.key}
          page={page}
          meta={{
            collegeName: "كلية تكنولوجيا المعلومات وعلوم الحاسوب (فكسچر اختباري)",
            departmentName: page.departmentName,
            programName: page.programName,
            levelName: page.levelName,
            studySystem: "all",
            termName: "الفصل الأول ١٤٤٨هـ / 2026-2027",
            versionName: "PRINT-PROOF-FIXTURE",
            versionStatus: "published",
            versionNumber: "v1",
            exportAt,
            lastUpdate: "2026-09-09T18:00:00.000Z",
            qrUrl: "https://example.invalid/print-proof",
            isDemo: false,
            pageIndex: i + 1,
            pageCount: pages.length,
          }}
          visibility={DEFAULT_PRINT_VISIBILITY}
        />
      ))}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Proof />
  </StrictMode>,
);
