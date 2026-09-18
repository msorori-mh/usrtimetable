/**
 * LAUNCH-CLOSURE-03 — single source of truth for the printed page box.
 *
 * `@page` cannot be nested inside a CSS selector, so the print centre injects this
 * rule into a <style> element at runtime. It lives here (instead of inline in the
 * component) so the print-proof harness renders with EXACTLY the same page box the
 * application uses, and cannot drift from it.
 */
import type { PrintOrientation, PrintPaperSize } from "./types";

export const PRINT_PAGE_STYLE_ELEMENT_ID = "print-center-page-style";

/**
 * Physical page numbering.
 *
 * The in-flow footer can only know the LOGICAL schedule-group index (one <section> per
 * program/level group); a group frequently breaks across several physical sheets, so using
 * that index as "صفحة X من Y" was wrong. The real physical counters only exist in the print
 * engine, so they are emitted from a `@page` margin box using the CSS `page`/`pages`
 * counters (CSS Paged Media Level 3, §5). Verified supported by the Chromium used for
 * printing (HeadlessChrome 141) by the print-proof runner, which asserts the rendered
 * counters against the real PDF page count.
 */
export const PRINT_PHYSICAL_PAGE_PREFIX_AR = "صفحة";
export const PRINT_PHYSICAL_PAGE_SEPARATOR_AR = "من";

export function printPageStyleCss(
  paper: PrintPaperSize = "A4",
  orientation: PrintOrientation = "portrait",
): string {
  return `@media print {
  @page {
    size: ${paper} ${orientation};
    margin: 1.2cm 1.5cm;
    @bottom-center {
      content: "${PRINT_PHYSICAL_PAGE_PREFIX_AR} " counter(page) " ${PRINT_PHYSICAL_PAGE_SEPARATOR_AR} " counter(pages);
      direction: rtl;
      font-size: 9pt;
      color: #000;
    }
  }
}`;
}
