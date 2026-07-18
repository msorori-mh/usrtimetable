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
- TypeScript: BLOCKED before compilation because installed dependencies are incomplete (`vite/client` and `@supabase/supabase-js` missing).
- Production build: BLOCKED because `vite` is not installed.
- Scoped lint: BLOCKED because `eslint` is not installed.
- Dependency restoration: BLOCKED. `bun install --frozen-lockfile` cannot write to its temp directory under the managed environment; npm cannot reach an uncached registry artifact.

## Ownership conflicts

- `OWNERSHIP_CONFLICT`: replacing the validator's Legacy `section_id` overlap path with authoritative cohort/delivery-group conflict generation would modify Legacy-section/curriculum-owned behavior. This agent left that behavior unchanged and only labels section evidence as Legacy in its report read model.
- `OWNERSHIP_CONFLICT`: lifecycle eligibility/count consumption is lifecycle-owned and was not modified.
- Central timetable state, decision, policy, and log documents were read but not edited.

## GitHub handoff

- Base observed locally: `fcd91f35f397af2fecd0de2ba0bc205301cb1c54`.
- Live `origin/main` refresh: BLOCKED because the shared worktree Git metadata is read-only (`FETCH_HEAD` permission denied).
- Commit/SHA: NOT CREATED; required gates did not all pass.
- Push/Draft PR: NOT CREATED; required gates did not all pass. Additionally, `gh auth status` reports an invalid token.
- Production/database impact: none. No migration apply, database write, deploy, import, schedule publication, or production operation was performed.

Leader handoff: restore dependencies in an environment with a writable temp directory and registry/cache access; run TypeScript, production build, and scoped lint; review the cohort/delivery-group ownership conflict with the responsible agent; refresh live `origin/main`; then commit, push, and open the independent Draft PR only if every gate passes.
