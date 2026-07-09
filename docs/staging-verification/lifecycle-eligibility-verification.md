# G7 — Lifecycle Eligibility Verification (Read-Only)

`evaluateEligibility` in `src/lib/schedule-versions/lifecycle.ts` was
exercised through its underlying pieces (identical query set + validator
output from G4). No transition was invoked.

| Field | Value |
| --- | --- |
| Current status | `draft` |
| `sessionsCount` | 198 |
| `totalHardConflicts` | 96 |
| `approvedHardConflicts` | 86 |
| `unapprovedHardConflicts` | **10** |
| `hardConflicts` (gate metric) | 10 |
| Latest quality score | *none* (no `schedule_quality_runs` for target) |
| `ok` | **false** |
| Reason | "يوجد 10 تعارض إلزامي غير معتمد (96 إجمالي، 86 معتمد)." |

## Gate evaluation (via `validateGate`) — none actually invoked
- To `review`: FAIL — 10 unapproved hard conflicts.
- To `approved`: FAIL — same.
- To `published`: FAIL — same, plus missing quality score.

## Confirmed side-effect posture
- No `UPDATE schedule_versions.status` executed.
- No new `schedule_version_events` row.
- No partial update.
- No `transitionVersion(...)` call issued (only the read helpers).

Result: **PASS** — eligibility correctly resolves to FAIL and prevents
progression while the 10 blockers remain.
