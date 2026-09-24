import { supabase } from "@/integrations/supabase/client";

export type ExceptionStatus = "approved" | "revoked";

export interface ApprovedException {
  id: string;
  schedule_version_id: string;
  conflict_code: string;
  session_id: string;
  related_session_id: string | null;
  approval_type: string;
  reason: string;
  source: string | null;
  status: ExceptionStatus;
  approved_by: string | null;
  approved_at: string | null;
  metadata: Record<string, unknown> | null;
}

/** Normalize a session pair so order does not affect matching. */
export function normalizeSessionPair(
  sessionId: string,
  relatedSessionId?: string | null,
): { primary: string; secondary: string | null } {
  if (!relatedSessionId) {
    return { primary: sessionId, secondary: null };
  }
  return sessionId < relatedSessionId
    ? { primary: sessionId, secondary: relatedSessionId }
    : { primary: relatedSessionId, secondary: sessionId };
}

/** Stable lookup key for pair or single-session exceptions. */
export function exceptionMatchKey(params: {
  scheduleVersionId: string;
  conflictCode: string;
  sessionId: string;
  relatedSessionId?: string | null;
}): string {
  const { primary, secondary } = normalizeSessionPair(params.sessionId, params.relatedSessionId);
  if (secondary) {
    return `${params.scheduleVersionId}|${params.conflictCode}|${primary}|${secondary}`;
  }
  return `${params.scheduleVersionId}|${params.conflictCode}|${primary}`;
}

/** Build an index of approved exceptions for O(1) conflict lookup. */
export function buildApprovedExceptionIndex(
  exceptions: ApprovedException[],
  scheduleVersionId: string,
): Map<string, ApprovedException> {
  const index = new Map<string, ApprovedException>();
  for (const ex of exceptions) {
    if (ex.status !== "approved") continue;
    if (ex.schedule_version_id !== scheduleVersionId) continue;
    const key = exceptionMatchKey({
      scheduleVersionId: ex.schedule_version_id,
      conflictCode: ex.conflict_code,
      sessionId: ex.session_id,
      relatedSessionId: ex.related_session_id,
    });
    index.set(key, ex);
  }
  return index;
}

/**
 * Find an approved exception covering a detected conflict.
 * Rules: status=approved only; exact version + conflict_code; normalized session pair.
 */
export function findMatchingException(
  index: Map<string, ApprovedException>,
  params: {
    scheduleVersionId: string;
    conflictCode: string;
    sessionId: string | null | undefined;
    relatedSessionId?: string | null;
  },
): ApprovedException | null {
  if (!params.sessionId) return null;
  const key = exceptionMatchKey({
    scheduleVersionId: params.scheduleVersionId,
    conflictCode: params.conflictCode,
    sessionId: params.sessionId,
    relatedSessionId: params.relatedSessionId,
  });
  return index.get(key) ?? null;
}

/** Load approved (non-revoked) exceptions for a schedule version. */
export async function loadApprovedExceptions(params: {
  scheduleVersionId: string;
  collegeId?: string;
}): Promise<ApprovedException[]> {
  let query = supabase
    .from("schedule_version_conflict_exceptions")
    .select(
      "id, schedule_version_id, conflict_code, session_id, related_session_id, approval_type, reason, source, status, approved_by, approved_at, metadata",
    )
    .eq("schedule_version_id", params.scheduleVersionId)
    .eq("status", "approved");
  if (params.collegeId) query = query.eq("college_id", params.collegeId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as ApprovedException[];
}

export interface ConflictExceptionSummary {
  totalHardConflicts: number;
  approvedHardConflicts: number;
  unapprovedHardConflicts: number;
}

export function summarizeConflictExceptions(
  conflicts: Array<{ approved_exception?: boolean; severity?: "hard" | "soft" }>,
): ConflictExceptionSummary {
  const hard = conflicts.filter((c) => (c.severity ?? "hard") === "hard");
  const totalHardConflicts = hard.length;
  const approvedHardConflicts = hard.filter((c) => c.approved_exception).length;
  return {
    totalHardConflicts,
    approvedHardConflicts,
    unapprovedHardConflicts: totalHardConflicts - approvedHardConflicts,
  };
}
