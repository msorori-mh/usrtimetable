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

## Resume after assignment restoration — 2026-09-19

The five existing teaching assignment IDs were restored through the authenticated home-review/assignment workflow. A fresh database snapshot of draft revision 336 contains 275 sessions and zero inactive assignment references. No replacement assignment IDs were introduced.

The resumed preview also detects a cross-college conflict. Quality repair now handles external busy conflicts and instructor day-cap violations together. It first moves affected instructors, then expands to their student peers if needed, while preserving original locks and external college placements. Per-student weekly span ceilings are enforced inside the MIP alongside existing day ceilings. A hard-conflict repair with unchanged quality metrics is accepted by both preview and the independent atomic-save check; an equal-metric move on an already valid baseline is still rejected.

Continuous-minute instructor capacity diagnostics now explain inconsistent availability/day-cap settings before solving. Overlapping windows are unioned, unavailable/external-busy periods are excluded, and daily-hour ceilings are applied. This optimistic bound ignores student/room constraints and lecture packing; therefore a deficit is an actual necessary-capacity failure, not a solver-timeout claim.

**Operational application remains HOLD:** one instructor has three 3-hour sessions (9 hours), hard availability limited to 11:00–14:00 on Saturday/Sunday/Thursday, and a maximum of two attendance days (at most 6 hours). All-scope model exploration also returned infeasible. The system must not invent wider availability or raise the saved day cap. User clarification is needed on this specific input contradiction before applying a complete draft improvement.

Verification: 54 targeted quality, joint-model and atomic-service tests; TypeScript and targeted lint. The production build and CI are checked before merge/deployment. Draft and published timetable session hashes were independently re-read and remain unchanged:

- Draft `d10b9f55-b99a-4abd-83a7-343182ef5c09`: `0f28390b8469e7b184b866faf562836f`.
- Published `30f8a76d-1cb9-4944-a5d7-483dcaea7692`: `a6aed8c45ef69efc00a670b02a885dcc`.
