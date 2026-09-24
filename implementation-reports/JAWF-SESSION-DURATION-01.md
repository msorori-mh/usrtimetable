# JAWF-SESSION-DURATION-01 — plan-cadence sessions in V2 auto-scheduling

Baseline: `86153adfe84e73c097400941e087c0aea9f95bfa` (clean worktree, no newer edits).
No database mutations, no migrations, no SQL, no RLS/RBAC change, no deployment.

## Defect

`src/lib/auto-scheduler/v2.ts` created **one** session per work item using the whole
`remaining_schedule_hours` clamped to 4h:

```ts
const durationMinutes = Math.max(60, Math.min(240, Math.round(item.remaining_schedule_hours * 60)));
```

A 4h theory component was therefore placed as a single 4h block instead of the
required 2 weekly 2h sessions.

## Fix

New pure module `src/lib/auto-scheduler/session-plan.ts`:

- `requiredCadenceForComponent` reads the validated `plan_courses` weekly pattern for the
  component family (`theory`/`tutorial` → `lectures_per_week` × `lecture_session_duration`,
  `practical` → `labs_per_week` × `lab_session_duration`). The pattern is used only when
  `count × duration` equals the component's assigned hours; otherwise durations are derived
  from hours and the run reports an Arabic note.
- `planRemainingSessions` reconciles the required cadence against sessions already stored for
  the same teaching assignment + delivery group: matching sessions count as done (idempotent
  re-run creates no duplicates), unmatched ones are reported as **nonconforming and left
  untouched**, and the remaining list is trimmed so total hours can never exceed the component
  budget.
- `orderSlotsByDistinctDay` prefers days the group is not already using for repeated sessions.
- `filterCandidateRooms` / `roomMatchesRequirement` prefilter by required room type
  (`plan_course_components.required_room_type_id`, else the plan text room type) and capacity;
  when the room-type prefilter empties the candidate set it falls back to capacity-only.
- `isLocallyBlocked` skips candidates that overlap sessions already known to this run
  (same room, instructor, cohort or delivery group) to cut doomed round-trips.
- `assertVersionNotStale` stops the run fail-closed on a stale schedule version.

`src/lib/auto-scheduler/v2.ts` now loops per required session and creates every session through
the **existing guarded RPC** `create_schedule_session_from_assignment_v2` (no bypass, no direct
DML). It also reports `nonconforming_existing_sessions`, `cadence_source` and `cancelled` in the
run summary, and accepts optional `onProgress` / `signal`.

`src/routes/_authenticated/auto-schedule.tsx` shows live progress and a "إيقاف التشغيل" button;
cancelling stops before the next session and keeps everything already created.

Prefilters are advisory only — the guarded RPC remains the sole authority for conflicts,
capacity, room type, availability, hours, term, college and permissions.

## Files changed

- `src/lib/auto-scheduler/session-plan.ts` (new)
- `src/lib/auto-scheduler/v2.ts`
- `src/routes/_authenticated/auto-schedule.tsx`
- `tests/jawf-session-duration-01.test.ts` (new)
- `implementation-reports/JAWF-SESSION-DURATION-01.md` (this report)

## Verification

- `bun test tests/jawf-session-duration-01.test.ts` → 16 pass / 0 fail, 71 assertions
  (theory 4h = 2×2, practical-only 4h = 2×2, mixed 2h+2h, pure theory 3h = 1×3, partial 2h
  resume, no duplicates on re-run, mismatched existing 4h held, hour ceiling, distinct-day
  preference, wrong room type / small room excluded, local occupancy prefilter, stale version stop).
- `bun test` (full) → 216 pass / 0 fail, 748 assertions.
- `bunx tsgo --noEmit` → clean.
- `bunx eslint` on changed files → clean.
- `node tests/harness/run.mjs` → 68 passed, 0 failed.
- Build telemetry → build OK.

## Not done (root owns)

- The three-plus partial sessions left by the old generator in the draft version were **not**
  modified; they now surface as nonconforming warnings for root reconciliation.
- No deployment; root reviews and publishes.
