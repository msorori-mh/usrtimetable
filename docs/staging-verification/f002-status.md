# G9 — F002 Verification

**F002:** `validateScheduleVersion` UI path does not load approved exceptions.

## Status: **OPEN — CONFIRMED**

## Evidence
The UI entry point `src/routes/_authenticated/conflict-checks.tsx` invokes:

```ts
const { checkId, result } = await validateScheduleVersion({
  collegeId: active.id,
  scheduleVersionId: versionId,
});
```

The implementation in `src/lib/conflict-engine/validator.ts` (lines 372–415):

```ts
for (const p of proposed) {
  const sub = await validateProposed({
    collegeId,
    scheduleVersionId,
    sessions: [p],
    excludeExistingSessionIds: p.id ? [p.id] : [],
    // ← no `approvedExceptions` argument
  });
  conflicts.push(...sub.conflicts);
}
const result = applyApprovedExceptions(conflicts, scheduleVersionId);
// ← no `approvedExceptions` argument here either
```

Because `applyApprovedExceptions(conflicts, scheduleVersionId)` is called
**without** an exceptions array, `buildApprovedExceptionIndex([], …)` yields
an empty index, so every one of the 96 conflicts is treated as
`approved_exception: false` in the UI-persisted `conflict_checks` /
`conflict_results` records.

## Impact
- The lifecycle path (`lifecycle.ts::evaluateEligibility`) correctly calls
  `loadApprovedExceptions(...)` and passes them into `validateProposed(...)`,
  so eligibility gating works as intended (verified in G7: 96/86/10).
- The **conflict-checks page** and any persisted `conflict_checks.total_conflicts`
  it writes will overcount by treating approved conflicts as unapproved
  (would report 96 unapproved instead of 10).
- Do **not** rely on the conflict-checks UI number for publish/gate decisions
  until F002 is fixed.

## Remediation (deferred — do NOT apply here)
In `validateScheduleVersion`, call `loadApprovedExceptions({ scheduleVersionId })`
once, pass into each `validateProposed({ …, approvedExceptions })` sub-call, and
into the final `applyApprovedExceptions(...)`.

Result: **OPEN — CONFIRMED** (blocks integration close, not this phase).
