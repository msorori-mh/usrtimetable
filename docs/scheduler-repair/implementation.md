# Scheduler repair — 2026-09-19

Baseline: main e96ee023e06414f282dae8b334a9f53d7e2ca904.

Implemented:

1. Placement failures now use the same constraint evaluation as feasibility and identify the affected session and instructor. Inactive assignments, room closures, availability, cross-college conflicts, daily load and attendance limits are distinguished.
2. Existing baseline metrics are retained, with individual instructor/student impact and every proposed placement shown alongside aggregate before/after values.
3. Generation ranks instructor consolidation before gap polishing. Room-specific penalties are calculated per room, and tied placements prefer an already-used day. Student gap increases for an individual partition are rejected even when aggregate quality improves.
4. Local search compares feasible alternatives before committing a move, and commits its best examined candidate when a search budget is exhausted.
5. A bounded three-order portfolio keeps the best incumbent, reruns local/swapping/MIP neighborhoods after previous improvements and preserves the original application fingerprint. Search budgets and evaluation counts are shared across runs. Solver timeouts are not infeasibility proofs.
6. Generation reserves 20% of its search budget for post-placement improvement, preserving the existing-session relocation allowance. Instructor attendance-cap violations can be repaired simultaneously without changing caps; stale academic data is blocked with actionable diagnostics.
7. Tests cover consolidation, contiguous placement, simultaneous swaps, room ranking, preserved identity/hours/locks, external busy time, bounded best-so-far search, invalid assignment diagnostics, attendance repair, atomic save and safe undo.
8. The UI offers in-session undo after confirmed application. Undo rechecks the exact saved snapshot and current hard constraints, submits one atomic relayout, and uses the existing receipt/retry path on transport uncertainty. An intervening edit invalidates undo. Reloading the page loses this in-session undo point; audit history remains on the server.

## Actual draft comparison: HOLD

A read-only independent in-memory copy of the actual 275-session ITCS draft, revision 329, was examined. `draft-baseline.json` records the before/after metrics. The result is deliberately unchanged:

- Five sessions reference inactive teaching assignments. No active replacement matches the same group and course offering.
- Six sessions belong to two instructors scheduled on three days despite their stored maximum of two.
- The first condition blocks a valid full-timetable result. No sessions were removed, no assignment reactivated, and no instructor substituted to manufacture an improvement.
- Published and draft production schedules were not modified by this repair.

The algorithm can repair attendance-cap violations when academic assignments are valid. Actual quality improvement and final production application must be retested after the five assignment discrepancies are resolved. This is not a claim that the current real draft is optimized or that the full operational rollout is complete.

## Validation

- TypeScript check and production build passed locally.
- 48 quality/generation-ranking/atomic-service tests passed, including new regression cases.
- 32 V2 generation orchestration tests passed.
- Existing worker, compaction and joint-model tests passed (52-test combined run before the final additions).
- Existing database RPCs and authorization/triggers were retained; no schema migration or database guard bypass was introduced.
