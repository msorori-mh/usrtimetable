import { useEffect } from "react";
import { buildScheduleReportFilename } from "@/lib/reports/schedule-filename";

/** Keep browser Save as PDF (including Ctrl+P) in sync with the report selection. */
export function useReportDocumentTitle(filename?: string) {
  useEffect(() => {
    if (!filename) return;

    const originalTitle = document.title;
    const reportTitle = buildScheduleReportFilename([filename]);
    const applyTitle = () => {
      document.title = reportTitle;
    };

    applyTitle();
    // Route metadata may update after this effect; native print must use the report name.
    window.addEventListener("beforeprint", applyTitle);
    return () => {
      window.removeEventListener("beforeprint", applyTitle);
      // Do not overwrite the next route's title when leaving this report.
      if (document.title === reportTitle) document.title = originalTitle;
    };
  }, [filename]);
}
