/** Constants and client helpers for disposable draft schedule version purge. */

export const PROTECTED_ACCEPTED_SCHEDULE_VERSION_ID =
  "835e50fe-3ad2-4232-8c15-0f403c668a7f" as const;

export const PURGE_RPC_NAME = "purge_disposable_draft_schedule_version" as const;

export type DisposablePurgeCounts = {
  schedule_versions: number;
  schedule_sessions: number;
  schedule_version_events: number;
  conflict_checks: number;
  conflict_results: number;
  schedule_version_conflict_exceptions: number;
  schedule_quality_runs: number;
  auto_schedule_runs: number;
};

export type DisposablePurgeResult = {
  purged: boolean;
  already_absent: boolean;
  version_id: string;
  college_id?: string;
  counts: DisposablePurgeCounts;
};

/** Pure guard: disposable purge is only valid for marked drafts that are not protected. */
export function assertDisposablePurgeEligibility(input: {
  versionId: string;
  status: string;
  disposableTest: boolean;
}): { ok: true } | { ok: false; reason: string } {
  if (input.versionId === PROTECTED_ACCEPTED_SCHEDULE_VERSION_ID) {
    return { ok: false, reason: "PURGE_PROTECTED_VERSION" };
  }
  if (!input.disposableTest) {
    return { ok: false, reason: "PURGE_NOT_DISPOSABLE" };
  }
  if (input.status === "approved" || input.status === "published" || input.status === "archived") {
    return { ok: false, reason: "PURGE_STATUS_IMMUTABLE" };
  }
  if (input.status !== "draft") {
    return { ok: false, reason: "PURGE_STATUS_NOT_DRAFT" };
  }
  return { ok: true };
}

/** Only super_admin may request a disposable_test clone marker. */
export function canMarkDisposableTestClone(isSuperAdmin: boolean): boolean {
  return isSuperAdmin === true;
}
