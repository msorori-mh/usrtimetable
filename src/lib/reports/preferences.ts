/** Only report choices are stored; no results, credentials or student records. */
export function readReportPreference(key: string): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.sessionStorage.getItem(`reports:${key}`) ?? "{}");
  } catch {
    return {};
  }
}
export function writeReportPreference(key: string, value: Record<string, string>) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(`reports:${key}`, JSON.stringify(value));
  } catch {
    /* Storage may be disabled. */
  }
}
