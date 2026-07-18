# Conflict and Exception Reporting Agent

## Decision

Implemented a fail-closed conflict report read model that separates `hard_blocker`, `warning`, `approved_exception`, and `unknown`. Pair-based temporal findings require same-version session evidence, the same day, and an actual overlapping interval. Missing or contradictory evidence is reported as readiness/unknown rather than a temporal conflict.

Approved exceptions are matched by exact schedule version, conflict code, and normalized session pair. Exception loading is college-scoped. Report rows and exports now include the version/session evidence identifiers, evidence status, cohort and delivery-group identifiers, an explicitly labelled Legacy section value, and approved exception type/reason.

Regular/parallel isolation fails closed: a cross-system pair is never classified as a verified conflict, and a filtered pair report requires both sessions to survive the selected study-system filter.

## Files

- `src/lib/reports/conflict-read-model.ts`
- `src/lib/reports/queries/operational-queries.ts`
- `src/routes/_authenticated/reports.conflicts.tsx`
- `src/lib/conflict-engine/exceptions.ts`
- `src/lib/conflict-engine/validator.ts`
- `tests/harness/conflict-exception-reporting.harness.ts`
- `implementation-reports/CONFLICT-AND-EXCEPTION-REPORTING-AGENT.md`

## Verification

- Focused harness: PASS (`bun tests/harness/conflict-exception-reporting.harness.ts`).
- `git diff --check`: PASS (line-ending conversion warnings only).
- TypeScript: PASS using the leader-provided clean dependency junction.
- Production build: PASS.
- Scoped lint: PASS (repository formatting rule disabled for the known CRLF baseline only).
- Focused harness and `git diff --check`: PASS. The shared `tests/harness/run.mjs` remained outside this agent's ownership scope.

## Ownership conflicts

- `OWNERSHIP_CONFLICT`: replacing the validator's Legacy `section_id` overlap path with authoritative cohort/delivery-group conflict generation would modify Legacy-section/curriculum-owned behavior. This agent left that behavior unchanged and only labels section evidence as Legacy in its report read model.
- `OWNERSHIP_CONFLICT`: lifecycle eligibility/count consumption is lifecycle-owned and was not modified.
- Central timetable state, decision, policy, and log documents were read but not edited.

## GitHub handoff

- Base observed locally: `fcd91f35f397af2fecd0de2ba0bc205301cb1c54`.
- Live baseline was refreshed by the leader after PR creation.
- Commit/SHA: NOT CREATED; required gates did not all pass.
- Push/Draft PR: NOT CREATED; required gates did not all pass. Additionally, `gh auth status` reports an invalid token.
- Production/database impact: none. No migration apply, database write, deploy, import, schedule publication, or production operation was performed.

Leader handoff: independent review found historical/current evidence mixing; remediation now fails closed when any session was updated after the selected conflict check and surfaces query failures distinctly from an empty report.
