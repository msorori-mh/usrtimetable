/**
 * LAUNCH-CLOSURE print button diagnosis (bounded).
 *
 * The print button previously called `window.print()` inline. That call is correct, but it
 * gives the user NO feedback when the host environment provides no print dialog (some
 * cloud/remote browsers; the tested headless Chromium silently no-ops) or when the call
 * throws. This helper keeps `window.print()` as the one and only print mechanism and adds
 * an honest, testable result so the UI can show an actionable Arabic status instead of
 * appearing dead.
 *
 * It deliberately does NOT claim success/failure of the print JOB: once the dialog is open
 * the outcome (print / save as PDF / cancel) is not observable from the page. So the only
 * claim made is "the print request was dispatched", never "printed".
 */

export const PRINT_REQUEST_UNAVAILABLE_AR =
  "المتصفح الحالي لا يوفر خاصية الطباعة. افتح الصفحة في متصفح سطح المكتب (Ctrl/Cmd + P) أو صدّر Excel/CSV.";

export const PRINT_REQUEST_FAILED_AR =
  "تعذّر فتح نافذة الطباعة في هذا المتصفح. استخدم Ctrl/Cmd + P أو صدّر Excel/CSV.";

export const PRINT_REQUEST_DISPATCHED_AR =
  "تم إرسال طلب الطباعة. إذا لم تظهر النافذة، افتح هذا الرابط في متصفح جهازك واستخدم Ctrl/Cmd + P للطباعة أو الحفظ بصيغة PDF.";

export type PrintRequestResult =
  | { status: "dispatched" }
  | { status: "unavailable"; message: string }
  | { status: "failed"; message: string; error: unknown };

type PrintableWindow = { print?: unknown } | null | undefined;

/**
 * Dispatches a print request. Never throws; never reports success for a cancelled or
 * blocked dialog — only that the request itself was dispatched.
 */
export function requestPrint(win: PrintableWindow): PrintRequestResult {
  const fn = win && (win as { print?: unknown }).print;
  if (typeof fn !== "function") {
    return { status: "unavailable", message: PRINT_REQUEST_UNAVAILABLE_AR };
  }
  try {
    (fn as () => void).call(win);
    return { status: "dispatched" };
  } catch (error) {
    return { status: "failed", message: PRINT_REQUEST_FAILED_AR, error };
  }
}
