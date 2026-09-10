/**
 * LAUNCH-CLOSURE-04 full-shell print proof — browser entry.
 *
 * The earlier proof mounted `PrintSheet` on its own and therefore could not see the
 * defects the root review found on a real print: the mobile AppLayout header, the
 * brand mark and the college badge printed on top of the official sheet header, and
 * the viewport-sized flex shell clipped the QR code and the heading edge.
 *
 * This entry mounts the REAL `AppLayout` (real wrappers, real mobile header, real
 * page context bar) with the REAL `PrintSheet` sheets as its children and the REAL
 * print stylesheet + `@page` rule. Only auth/data/navigation are stubbed (see
 * ./mocks) — no layout is re-implemented and no backend is touched.
 */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppLayout } from "@/components/app-layout";
import { PrintSheet } from "@/components/print-center/print-sheet";
import {
  DEFAULT_PRINT_VISIBILITY,
  PRINT_PAGE_STYLE_ELEMENT_ID,
  filterPrintSessions,
  groupPrintPages,
  printPageStyleCss,
  type PrintOrientation,
  type PrintPaperSize,
} from "@/lib/print-center";
import { FIXTURE_FILTERS, LONG_FIXTURE, SHORT_FIXTURE } from "./fixture";
import "@/styles.css";

const q = new URLSearchParams(window.location.search);
const paper = (q.get("paper") === "A3" ? "A3" : "A4") as PrintPaperSize;
const orientation = (
  q.get("orientation") === "portrait" ? "portrait" : "landscape"
) as PrintOrientation;
const fixture = q.get("fixture") === "short" ? SHORT_FIXTURE : LONG_FIXTURE;
const isLongFixture = fixture === LONG_FIXTURE;

const sessions = filterPrintSessions(fixture, FIXTURE_FILTERS);
const pages = groupPrintPages(sessions, FIXTURE_FILTERS);

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

function Sheets() {
  useEffect(() => {
    const el = document.createElement("style");
    el.id = PRINT_PAGE_STYLE_ELEMENT_ID;
    el.textContent = printPageStyleCss(paper, orientation);
    document.head.appendChild(el);
    document.documentElement.dataset.printProofReady = "1";
    return () => el.remove();
  }, []);

  const exportAt = new Date("2026-09-10T00:00:00.000Z");
  return (
    <div
      className={`print-center-root report-print-root space-y-4 print-paper-${paper.toLowerCase()} print-orient-${orientation}`}
      dir="rtl"
      data-paper={paper}
      data-orientation={orientation}
    >
      {/* Same screen-only header block shape the print centre renders. */}
      <div className="report-no-print space-y-4">
        <h1 className="text-2xl font-bold">مركز الطباعة والتصدير</h1>
      </div>

      <div className="report-print-body print-center-body space-y-6">
        {pages.map((page, i) => {
          const proofPage = isLongFixture
            ? {
                ...page,
                departmentName: "قسم تكنولوجيا المعلومات وعلوم الحاسوب وهندسة البرمجيات المتقدمة",
                programName: "برنامج بكالوريوس تكنولوجيا المعلومات والأنظمة الذكية وتحليل البيانات",
                levelName: `${page.levelName || "المستوى الأول"} — المسار الأكاديمي التطبيقي`,
              }
            : page;
          return (
            <PrintSheet
              key={page.key}
              page={proofPage}
              meta={{
                collegeName: isLongFixture
                  ? "كلية تكنولوجيا المعلومات وعلوم الحاسوب والأنظمة الذكية التطبيقية"
                  : "كلية تكنولوجيا المعلومات وعلوم الحاسوب (فكسچر اختباري)",
                departmentName: isLongFixture
                  ? "قسم تكنولوجيا المعلومات وعلوم الحاسوب وهندسة البرمجيات المتقدمة"
                  : page.departmentName,
                programName: isLongFixture
                  ? "برنامج بكالوريوس تكنولوجيا المعلومات والأنظمة الذكية وتحليل البيانات"
                  : page.programName,
                levelName: isLongFixture
                  ? `${page.levelName || "المستوى الأول"} — المسار الأكاديمي التطبيقي`
                  : page.levelName,
                studySystem: "all",
                termName: isLongFixture
                  ? "الفصل الدراسي الأول للعام الجامعي ١٤٤٨هـ / 2026-2027م"
                  : "الفصل الأول ١٤٤٨هـ / 2026-2027",
                versionName: isLongFixture
                  ? "النسخة النهائية المعتمدة لأغراض إثبات تنسيق رأس الجدول"
                  : "PRINT-PROOF-FIXTURE",
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
          );
        })}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppLayout>
        <Sheets />
      </AppLayout>
    </QueryClientProvider>
  </StrictMode>,
);
