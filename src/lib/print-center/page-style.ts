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

export function printPageStyleCss(paper: PrintPaperSize, orientation: PrintOrientation): string {
  return `@media print { @page { size: ${paper} ${orientation}; margin: 1.2cm 1.5cm; } }`;
}
