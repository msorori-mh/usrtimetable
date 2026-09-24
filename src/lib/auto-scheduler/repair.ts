/**
 * JAWF-REPAIR-01 — bounded repair search for the V2 auto-scheduler.
 *
 * When direct placement of a missing weekly session fails, this module looks for
 * a *very* small, legal rearrangement of the existing draft that opens a slot:
 *
 *   depth 1 (1-hop): one movable session blocks the slot -> relocate it legally.
 *   depth 2 (2-hop): the blocker's own alternative is blocked by exactly one
 *                    further movable session -> relocate that one first.
 *
 * Every candidate placement (for the missing session and for every relocated
 * session) is validated with the same pure `feasible()` predicate used by the
 * compactor, so instructor overlap, room overlap, cohort/shared-student overlap,
 * capacity, room availability, room-type fallback policy, study-system
 * templates, instructor daily load and the max-five-attendance-days rule are all
 * preserved. Locked sessions are never moved. No DB access and no writes: the
 * caller applies the whole plan through one guarded transaction; failure rolls
 * back every write.
 */
import {
  compactSlots,
  context,
  feasible as defaultFeasible,
  minutes,
  type Session,
  type Snapshot,
} from "./compact.ts";
import { validateJointPlan } from "./joint-model.ts";

export type RepairPlacement = {
  day_of_week: number;
  start_time: string;
  end_time: string;
  room_id: string;
};

export type RepairMove = {
  sessionId: string;
  updatedAt: string;
  from: RepairPlacement;
  to: RepairPlacement;
};

export type RepairPlan = {
  /** Existing sessions to relocate first, in order. */
  moves: RepairMove[];
  /** Where the missing session goes once the moves are applied. */
  placement: RepairPlacement;
  /** Number of relocations in this plan (0 = direct placement). */
  depth: number;
  /** Feasibility evaluations consumed while building the plan. */
  attempts: number;
};

/** Stable identity for alternatives rejected by the authoritative transaction. */
export function repairPlanKey(plan: RepairPlan): string {
  const tuple = (p: RepairPlacement) => [p.day_of_week, p.start_time, p.end_time, p.room_id];
  return JSON.stringify([
    tuple(plan.placement),
    [...plan.moves]
      .sort((a, b) => a.sessionId.localeCompare(b.sessionId))
      .map((m) => [m.sessionId, tuple(m.to)]),
  ]);
}

export type RepairBudget = {
  /** Hard cap on feasibility evaluations for one missing session. */
  maxAttempts: number;
  /** Maximum relocations allowed in a single plan (1 or 2). */
  maxDepth: number;
};

export const DEFAULT_REPAIR_BUDGET: RepairBudget = {
  maxAttempts: 4000,
  maxDepth: 2,
};

const placementOf = (session: Session): RepairPlacement => ({
  day_of_week: session.day_of_week,
  start_time: session.start_time,
  end_time: session.end_time,
  room_id: session.room_id,
});

const samePlacement = (a: RepairPlacement, b: RepairPlacement) =>
  a.day_of_week === b.day_of_week &&
  minutes(a.start_time) === minutes(b.start_time) &&
  minutes(a.end_time) === minutes(b.end_time) &&
  a.room_id === b.room_id;

const durationMinutes = (session: Session) =>
  minutes(session.end_time) - minutes(session.start_time);

const withPlacement = (session: Session, placement: RepairPlacement): Session => ({
  ...session,
  day_of_week: placement.day_of_week,
  start_time: placement.start_time,
  end_time: placement.end_time,
  room_id: placement.room_id,
});

/**
 * Existing sessions that overlap the candidate on room, instructor or shared
 * students. These are the only sessions a repair is allowed to consider moving.
 */
export function conflictingSessions(
  snapshot: Snapshot,
  sessions: readonly Session[],
  candidate: Session,
): Session[] {
  const share = context(snapshot).share;
  const start = minutes(candidate.start_time);
  const end = minutes(candidate.end_time);
  const dailyCountBlocked =
    sessions.filter(
      (x) =>
        x.id !== candidate.id &&
        x.instructor_id === candidate.instructor_id &&
        x.day_of_week === candidate.day_of_week &&
        !x.replaced_by_split,
    ).length >= 3;
  return sessions.filter((other) => {
    if (other.id === candidate.id) return false;
    if (other.day_of_week !== candidate.day_of_week) return false;
    const gap = Math.max(0, snapshot.settings.break_between_sessions_min || 0);
    const overlap = start < minutes(other.end_time) && end > minutes(other.start_time);
    const personOverlap =
      start < minutes(other.end_time) + gap && end > minutes(other.start_time) - gap;
    return (
      (dailyCountBlocked && other.instructor_id === candidate.instructor_id) ||
      (overlap && other.room_id === candidate.room_id) ||
      (personOverlap &&
        (other.instructor_id === candidate.instructor_id || share(other, candidate)))
    );
  });
}

export type FeasibleFn = (
  snapshot: Snapshot,
  sessions: Session[],
  candidate: Session,
  original: Session,
) => boolean;

type SearchState = {
  snapshot: Snapshot;
  feasible: FeasibleFn;
  roomIds: string[];
  budget: RepairBudget;
  attempts: number;
  /** Sessions that must never move: the missing candidate and already-planned moves. */
  pinned: Set<string>;
};

/** Prefer shorter blockers so short 2h sessions free 3h blocks. */
const byBlockerPreference = (a: Session, b: Session) =>
  durationMinutes(a) - durationMinutes(b) || a.id.localeCompare(b.id);

/**
 * Try to relocate one existing session inside `others` (which must NOT contain
 * it). Returns the resulting session list plus the moves performed.
 */
function relocate(
  state: SearchState,
  session: Session,
  others: Session[],
  depth: number,
): { sessions: Session[]; moves: RepairMove[] } | null {
  if (session.is_locked || state.pinned.has(session.id)) return null;
  const current = placementOf(session);
  const slots = compactSlots({ ...state.snapshot, sessions: others }, session);
  for (const slot of slots) {
    for (const roomId of state.roomIds) {
      if (state.attempts >= state.budget.maxAttempts) return null;
      const placement: RepairPlacement = {
        day_of_week: slot.day,
        start_time: slot.start,
        end_time: slot.end,
        room_id: roomId,
      };
      if (samePlacement(placement, current)) continue;
      const candidate = withPlacement(session, placement);
      state.attempts++;
      if (state.feasible(state.snapshot, [...others, candidate], candidate, session)) {
        return {
          sessions: [...others, candidate],
          moves: [
            {
              sessionId: session.id,
              updatedAt: session.updated_at,
              from: current,
              to: placement,
            },
          ],
        };
      }
      if (depth <= 0) continue;
      const blockers = conflictingSessions(state.snapshot, others, candidate);
      if (blockers.length !== 1) continue;
      const blocker = blockers[0];
      if (blocker.is_locked || state.pinned.has(blocker.id)) continue;
      const rest = others.filter((x) => x.id !== blocker.id);
      const inner = relocate(state, blocker, rest, depth - 1);
      if (!inner) continue;
      if (state.attempts >= state.budget.maxAttempts) return null;
      state.attempts++;
      if (!state.feasible(state.snapshot, [...inner.sessions, candidate], candidate, session)) {
        continue;
      }
      return {
        sessions: [...inner.sessions, candidate],
        moves: [
          ...inner.moves,
          {
            sessionId: session.id,
            updatedAt: session.updated_at,
            from: current,
            to: placement,
          },
        ],
      };
    }
  }
  return null;
}

/**
 * Bounded repair plan for one missing session.
 *
 * `missing` is a seed session (identity + duration + study system + headcount)
 * whose placement fields are ignored. `targetSlots` and `roomIds` come from the
 * same ordered candidate generation the direct pass used.
 */
export function planRepair(input: {
  snapshot: Snapshot;
  sessions: readonly Session[];
  missing: Session;
  targetSlots: ReadonlyArray<{ day: number; start: string; end: string }>;
  roomIds: readonly string[];
  dayCap?: number;
  /** Rooms for blockers are independent of the missing session's room requirement. */
  relocationRoomIds?: readonly string[];
  excludedPlans?: ReadonlySet<string>;
  budget?: Partial<RepairBudget>;
  feasible?: FeasibleFn;
  /** Mutable counter: receives the feasibility evaluations consumed, found or not. */
  stats?: { attempts: number };
}): RepairPlan | null {
  const budget: RepairBudget = {
    maxAttempts: Math.max(1, input.budget?.maxAttempts ?? DEFAULT_REPAIR_BUDGET.maxAttempts),
    maxDepth: Math.max(1, Math.min(2, input.budget?.maxDepth ?? DEFAULT_REPAIR_BUDGET.maxDepth)),
  };
  const state: SearchState = {
    snapshot: input.snapshot,
    feasible: input.feasible ?? defaultFeasible,
    roomIds: [
      ...(input.relocationRoomIds ??
        input.snapshot.rooms.filter((r) => r.is_active).map((r) => r.id)),
    ],
    budget,
    attempts: 0,
    pinned: new Set<string>([input.missing.id]),
  };
  const sessions = [...input.sessions];
  const finish = <T>(value: T): T => {
    if (input.stats) input.stats.attempts += state.attempts;
    return value;
  };

  for (const slot of input.targetSlots) {
    for (const roomId of input.roomIds) {
      if (state.attempts >= budget.maxAttempts) {
        return finish(null);
      }
      const placement: RepairPlacement = {
        day_of_week: slot.day,
        start_time: slot.start,
        end_time: slot.end,
        room_id: roomId,
      };
      const candidate = withPlacement(input.missing, placement);
      const blockers = conflictingSessions(state.snapshot, sessions, candidate);
      if (blockers.length === 0) {
        // Not blocked by occupancy: the direct pass already rejected it for a
        // structural reason (room type, availability, load, five-day rule).
        continue;
      }
      if (blockers.length > budget.maxDepth) continue;
      if (blockers.some((blocker) => blocker.is_locked)) continue;

      const rest = sessions.filter((x) => !blockers.some((blocker) => blocker.id === x.id));
      state.attempts++;
      if (!state.feasible(state.snapshot, [...rest, candidate], candidate, input.missing)) {
        // Even with the blockers removed the slot is illegal — moving them is pointless.
        continue;
      }

      let current: Session[] = [...rest, candidate];
      state.pinned = new Set<string>([input.missing.id]);
      const moves: RepairMove[] = [];
      let ok = true;
      for (const blocker of [...blockers].sort(byBlockerPreference)) {
        const others = current.filter((x) => x.id !== blocker.id);
        const relocated = relocate(state, blocker, others, budget.maxDepth - 1);
        if (!relocated) {
          ok = false;
          break;
        }
        current = relocated.sessions;
        moves.push(...relocated.moves);
        for (const move of relocated.moves) state.pinned.add(move.sessionId);
      }
      if (!ok || moves.length === 0) continue;
      if (moves.length > budget.maxDepth) continue;
      if (
        !validateJointPlan(
          { ...input.snapshot, sessions: [...sessions, input.missing] },
          current,
          input.dayCap ?? 5,
        )
      )
        continue;
      const plan = {
        moves,
        placement,
        depth: moves.length,
        attempts: state.attempts,
      };
      if (input.excludedPlans?.has(repairPlanKey(plan))) continue;
      return finish(plan);
    }
  }
  return finish(null);
}

/** Hardest first: longer blocks and scarcer domains before flexible short ones. */
export function compareRepairPriority(
  a: { durationMinutes: number; candidateCount: number },
  b: { durationMinutes: number; candidateCount: number },
): number {
  if (a.durationMinutes !== b.durationMinutes) return b.durationMinutes - a.durationMinutes;
  return a.candidateCount - b.candidateCount;
}
