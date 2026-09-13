/** Only report choices are stored; no results, credentials or student records. */
export function readReportPreference(key: string): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(`reports:${key}`) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
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

/** Safe, actionable scope message; raw database errors remain hidden. */
export class ReportScopeError extends Error {}
