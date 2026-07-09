# G8 — Scorer Read-Only Verification

`scoreScheduleVersion` (`src/lib/conflict-engine/scorer.ts`) was NOT invoked
in `persist=true` mode in this phase (would create a `schedule_quality_runs`
row and violate the no-side-effects constraint).

## Reasoning (from code review + G4 data)
The scorer consumes the same `ValidationResult` as the validator:

- `approvedHardConflicts` are counted in `totalHardConflicts` but excluded
  from the unapproved-hard deduction path used to compute the hard-conflict
  penalty. This is enforced by the same `applyApprovedExceptions` step used
  in G4, which tags each conflict with `approved_exception: true|false`.
- Each conflict instance appears exactly once (per-session emission with
  excludeSelf loop). No conflict is double-counted in the source list, so it
  cannot be double-penalized by the scorer.
- No self-conflict regressions detected (0 same-session hits in G4).
- Approved conflict instances (86) do not enter the unapproved-hard
  penalty bucket.

## Side-effect verification
| Check | Result |
| --- | --- |
| New `schedule_quality_runs` row | **0** |
| New `quality_metrics` row | **0** |
| Any DB write during scorer analysis | **0** (analysis was purely offline) |

Note: publishing (`transitionVersion → published`) would auto-run the scorer
in `persist=true`. That path is intentionally NOT exercised here — VERIFY-01
explicitly forbids Publish and lifecycle transitions.

Result: **PASS (analytical)** — scorer contract holds; no side effects.
