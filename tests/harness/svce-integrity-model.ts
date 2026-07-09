/**
 * Pure TypeScript mirror of ensure_svce_session_version_integrity() for local harness tests.
 * Must stay aligned with supabase/migrations/20260709193500_schedule_version_conflict_exceptions.sql
 */

export type SvceRow = {
  college_id: string;
  schedule_version_id: string;
  session_id: string;
  related_session_id: string | null;
};

export type ScheduleVersion = { id: string; college_id: string };
export type ScheduleSession = { id: string; college_id: string; schedule_version_id: string };

export class SvceIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SvceIntegrityError";
  }
}

export function validateSvceSessionVersionIntegrity(
  row: SvceRow,
  versions: Map<string, ScheduleVersion>,
  sessions: Map<string, ScheduleSession>,
): void {
  const version = versions.get(row.schedule_version_id);
  if (!version) {
    throw new SvceIntegrityError(`schedule_version not found: ${row.schedule_version_id}`);
  }
  if (version.college_id !== row.college_id) {
    throw new SvceIntegrityError("version/college mismatch");
  }

  const session = sessions.get(row.session_id);
  if (!session) {
    throw new SvceIntegrityError(`session not found: ${row.session_id}`);
  }
  if (session.college_id !== row.college_id) {
    throw new SvceIntegrityError("session/college mismatch");
  }
  if (session.schedule_version_id !== row.schedule_version_id) {
    throw new SvceIntegrityError(
      `session/schedule_version mismatch: session ${row.session_id} belongs to version ${session.schedule_version_id}, expected ${row.schedule_version_id}`,
    );
  }

  if (row.related_session_id !== null) {
    if (row.related_session_id === row.session_id) {
      throw new SvceIntegrityError("related_session_id must differ from session_id for pair exceptions");
    }

    const related = sessions.get(row.related_session_id);
    if (!related) {
      throw new SvceIntegrityError(`related_session not found: ${row.related_session_id}`);
    }
    if (related.college_id !== row.college_id) {
      throw new SvceIntegrityError("related_session/college mismatch");
    }
    if (related.schedule_version_id !== row.schedule_version_id) {
      throw new SvceIntegrityError(
        `related_session/schedule_version mismatch: session ${row.related_session_id} belongs to version ${related.schedule_version_id}, expected ${row.schedule_version_id}`,
      );
    }
  }
}

/** Simulates UPDATE by validating NEW row against session/version catalog. */
export function validateSvceUpdate(
  before: SvceRow,
  after: SvceRow,
  versions: Map<string, ScheduleVersion>,
  sessions: Map<string, ScheduleSession>,
): void {
  validateSvceSessionVersionIntegrity(after, versions, sessions);
  void before;
}

/** Duplicate normalized pair detection (mirrors uq_svce_active_pair partial unique index). */
export function duplicateNormalizedPairKey(
  scheduleVersionId: string,
  conflictCode: string,
  sessionId: string,
  relatedSessionId: string | null,
): string {
  const a = sessionId;
  const b = relatedSessionId ?? sessionId;
  const least = a < b ? a : b;
  const greatest = a < b ? b : a;
  return `${scheduleVersionId}|${conflictCode}|${least}|${greatest}`;
}

export function assertNoDuplicateActivePair(
  existing: Array<{ status: string; key: string }>,
  candidateKey: string,
): void {
  if (existing.some((e) => e.status === "approved" && e.key === candidateKey)) {
    throw new SvceIntegrityError("duplicate normalized pair");
  }
}
