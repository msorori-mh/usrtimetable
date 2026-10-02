import { assignmentRowDaysLabel } from "./assignment-row-days";

export type AssignmentPlacement = {
  inVersion: boolean;
  sharedLecture: boolean;
  days: number[];
};

/** Reject incomplete/stale context instead of turning a failed read into missing lectures. */
export function parseAssignmentPlacementContext(
  value: unknown,
  versionId: string,
): Map<string, AssignmentPlacement> {
  const payload = value as { version_id?: unknown; groups?: unknown } | null;
  if (payload?.version_id !== versionId || !Array.isArray(payload.groups)) {
    throw new Error("تعذر قراءة حالة التسكين لنسخة الجدول المحددة");
  }
  const result = new Map<string, AssignmentPlacement>();
  for (const row of payload.groups) {
    if (
      !row ||
      typeof row.group_id !== "string" ||
      !row.group_id ||
      result.has(row.group_id) ||
      typeof row.in_version !== "boolean" ||
      typeof row.shared_lecture !== "boolean" ||
      !Array.isArray(row.days) ||
      row.days.some((day: unknown) => !Number.isInteger(day) || Number(day) < 0 || Number(day) > 6)
    ) {
      throw new Error("بيانات حالة التسكين غير مكتملة");
    }
    const days = [...new Set<number>(row.days)].sort(
      (a, b) => (a === 6 ? 0 : a + 1) - (b === 6 ? 0 : b + 1),
    );
    if (!row.in_version && (row.shared_lecture || days.length)) {
      throw new Error("بيانات حالة التسكين غير متسقة");
    }
    result.set(row.group_id, {
      inVersion: row.in_version,
      sharedLecture: row.shared_lecture,
      days,
    });
  }
  return result;
}

export function assignmentRowPlacementLabel(
  placement: AssignmentPlacement | undefined,
  hasVersion: boolean,
): string {
  if (hasVersion && !placement?.inVersion) return "خارج هذه النسخة";
  const days = assignmentRowDaysLabel(placement?.days);
  return placement?.sharedLecture ? `${days} · مدموج` : days;
}

/** Operational groups remain editable; an explicit version shows only its own catalogue. */
export function assignmentRowsForVersion<T extends { delivery_group_id: string }>(
  rows: readonly T[],
  placements: ReadonlyMap<string, AssignmentPlacement> | undefined,
  versionView: boolean,
): T[] {
  return rows.filter(
    (row) =>
      !versionView || !placements || placements.get(row.delivery_group_id)?.inVersion === true,
  );
}
