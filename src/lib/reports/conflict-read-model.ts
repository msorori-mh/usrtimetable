export interface ApprovedExceptionEvidence {
  id: string;
  schedule_version_id: string;
  conflict_code: string;
  session_id: string;
  related_session_id: string | null;
  approval_type: string;
  reason: string;
}

export type ConflictClassification = "hard_blocker" | "warning" | "approved_exception" | "unknown";

export interface ConflictSessionEvidence {
  id: string;
  schedule_version_id: string;
  day_of_week: number | null;
  start_time: string | null;
  end_time: string | null;
  study_system: string;
  updated_at: string;
}

export interface ConflictReadInput {
  conflict_code: string;
  severity: string;
  schedule_session_id: string | null;
  related_session_id: string | null;
}

const PAIR_TEMPORAL_CODES = new Set([
  "instructor_conflict", "room_conflict", "cohort_conflict", "delivery_group_conflict",
  "section_conflict", "subgroup_conflict",
]);

const normTime = (value: string | null) => !value ? null : value.length === 5 ? `${value}:00` : value;

export function overlappingInterval(primary?: ConflictSessionEvidence, related?: ConflictSessionEvidence) {
  if (!primary || !related || primary.day_of_week == null || related.day_of_week == null) return null;
  if (primary.day_of_week !== related.day_of_week) return null;
  const aStart = normTime(primary.start_time), aEnd = normTime(primary.end_time);
  const bStart = normTime(related.start_time), bEnd = normTime(related.end_time);
  if (!aStart || !aEnd || !bStart || !bEnd) return null;
  const start = aStart > bStart ? aStart : bStart;
  const end = aEnd < bEnd ? aEnd : bEnd;
  return start < end ? { start, end } : null;
}

export function classifyConflict(params: {
  result: ConflictReadInput;
  versionId: string;
  primary?: ConflictSessionEvidence;
  related?: ConflictSessionEvidence;
  approvedException?: ApprovedExceptionEvidence | null;
  checkCreatedAt: string;
}) {
  const sessions = [params.primary, params.related].filter(Boolean) as ConflictSessionEvidence[];
  const overlap = overlappingInterval(params.primary, params.related);
  const isolatedStudySystem = sessions.length < 2 || sessions.every((s) => s.study_system === sessions[0].study_system);
  const snapshotIsFresh = sessions.every(
    (session) => Date.parse(session.updated_at) <= Date.parse(params.checkCreatedAt),
  );
  const evidenceStatus: "verified" | "unknown" = sessions.length > 0 &&
    sessions.every((s) => s.schedule_version_id === params.versionId) &&
    snapshotIsFresh &&
    isolatedStudySystem &&
    (!PAIR_TEMPORAL_CODES.has(params.result.conflict_code) || overlap !== null)
    ? "verified" : "unknown";
  if (evidenceStatus === "unknown") return { classification: "unknown" as const, evidenceStatus, overlap };
  if (params.approvedException) return { classification: "approved_exception" as const, evidenceStatus, overlap };
  if (params.result.severity.toLowerCase() === "hard") return { classification: "hard_blocker" as const, evidenceStatus, overlap };
  return { classification: "warning" as const, evidenceStatus, overlap };
}

export function approvedExceptionForResult(exceptions: Map<string, ApprovedExceptionEvidence>, versionId: string, result: ConflictReadInput) {
  if (!result.schedule_session_id) return null;
  const pair = [result.schedule_session_id, result.related_session_id].filter(Boolean).sort();
  return exceptions.get([versionId, result.conflict_code, ...pair].join("|")) ?? null;
}
