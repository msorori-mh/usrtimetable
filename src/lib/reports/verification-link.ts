export const REPORT_KIND_LABELS = {
  student: "جدول الطلاب",
  instructor: "تقرير المحاضر",
  room: "تقرير القاعات",
  report: "تقرير أكاديمي",
} as const;
export type VerificationReportKind = keyof typeof REPORT_KIND_LABELS;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Extract only the version and a fixed category; never forward URL query/hash data. */
export function reportVerificationSource(value: string): {
  versionId: string | null;
  kind: VerificationReportKind;
} {
  try {
    const url = new URL(value, "https://report.invalid");
    const pathVersion = url.pathname.match(/^\/timetable\/([^/]+)\/print\/?$/)?.[1];
    const candidate =
      pathVersion ?? url.searchParams.get("versionId") ?? url.searchParams.get("version");
    const type = url.searchParams.get("type") ?? "";
    const path = url.pathname;
    const kind =
      type === "instructor" || path.includes("instructor")
        ? "instructor"
        : type === "room" || /room/.test(path)
          ? "room"
          : ["student", "program", "department", "level"].includes(type) || /timetable/.test(path)
            ? "student"
            : "report";
    return { versionId: candidate && UUID_PATTERN.test(candidate) ? candidate : null, kind };
  } catch {
    return { versionId: null, kind: "report" };
  }
}

export function publicVerificationUrl(origin: string, receiptId?: string | null): string {
  const url = new URL("/verify-report", new URL(origin).origin);
  if (receiptId && UUID_PATTERN.test(receiptId)) url.searchParams.set("ref", receiptId);
  return url.toString();
}
