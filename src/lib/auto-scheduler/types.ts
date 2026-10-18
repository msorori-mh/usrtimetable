/**
 * Shared result types of an auto-scheduling run (consumed by the V2 scheduler in ./v2.ts and
 * the auto-schedule page). They used to live in the legacy greedy placer (greedy.ts), which
 * was never called and has been removed (L-12): it carried an unguarded full_rebuild delete
 * path on schedule_sessions.
 */
export interface UnplacedItem {
  course_offering_id: string;
  teaching_assignment_id: string | null;
  instructor_id: string;
  course_id: string | null;
  session_type: string;
  duration_minutes: number;
  unit_index: number;
  reason: string;
}

export type AutoRunMode = "fill_missing" | "regenerate_auto" | "full_rebuild";

export interface AutoRunResult {
  runId: string;
  placed: number;
  unplaced: UnplacedItem[];
  totalRequired: number;
  byType: Record<string, { required: number; placed: number; unplaced: number }>;
  warnings: string[];
  hardConflictsAfter: number;
  softViolationsAfter: number;
  qualityScoreBefore: number;
  qualityScoreAfter: number;
  improvementDelta: number;
  preservedExistingSessions: number;
  relocatedSessions: number;
  backtrackingAttempts: number;
  durationMs: number;
  totalOfferings: number;
  mode: AutoRunMode;
  deletedAutoSessions: number;
  skippedLockedSessions: number;
  /** Practical sessions placed in a lecture hall via the allowed room fallback. */
  practicalRoomFallbacks?: number;
}
