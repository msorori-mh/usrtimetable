# Draft lecturer timetable report audit

## Decision

Fix required on `origin/main` at `d9881f353a62fa2b6dae5500837665eb37ea708d`.

## Root cause

The lecturer timetable route was the only timetable report still using legacy local version state and a direct, version-scoped `schedule_sessions` query. Unlike the shared report context, its version started empty and required manual selection, so the initial draft report rendered an empty result and a `0.00` total. The route also silently discarded query errors and retained a stale lecturer selection when the active college changed.

## Fix

Wire the route to the existing report context, filters, session query, mapper, and timetable view; surface query failures and reset the lecturer when the college changes. Register the regression harness in the standard runner. No database or migration change is required, and no Phase 9.5 file is touched.

## Verification

- Focused harness: PASS.
- `git diff --check`: PASS.
- TypeScript (`tsc --noEmit`): PASS after the leader reused the verified main worktree dependency tree.
- Production build (`vite build`): PASS; only existing bundle/dependency warnings were emitted.
- Scoped lint for the route and regression harness: PASS after scoped Prettier normalization.
- `git diff --check`: PASS.
- Independent remediation review: PASS; no BLOCKER, HIGH, or MEDIUM findings remain.
- Migration path: NOT APPLICABLE; no migration or database action is needed.
- Production publish/deploy: NOT PERFORMED and not authorized.
