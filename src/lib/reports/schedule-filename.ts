/** Human-readable basename shared by timetable print and spreadsheet exports. */
export function buildScheduleReportFilename(
  parts: readonly (string | null | undefined)[],
  fallback = "جدول",
): string {
  const sanitize = (value: string) =>
    value
      .replace(/[\\/:*?"<>|]+/g, " - ")
      .replace(/\s+/g, " ")
      .trim();
  const filename = sanitize(
    parts
      .map((part) => part?.trim())
      .filter((part): part is string => !!part)
      .join(" — "),
  );
  return filename || sanitize(fallback) || "جدول";
}
