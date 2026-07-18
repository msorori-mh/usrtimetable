# Harness Reliability Agent

## Scope

Owned `tests/harness/run.mjs`, focused runner tests, the harness package scripts/runtime declaration, and this report. No product source, migrations, central documentation, or registry files were changed.

## Implementation

- Replaced shell-based `npx tsx` execution with the locked local `tsx` CLI invoked by the current Node executable. This removes package-registry lookup and platform-specific shell resolution from the runner.
- Registered the merged `academic-cohort-legacy-section-adapter` and `conflict-exception-reporting` focused harnesses.
- Added per-harness results and a deterministic summary.
- Kept every harness assertion active. A failed harness is classified as `MISSING-HISTORICAL-ARTIFACT` only when its declared historical file is absent and its output contains that exact missing-artifact assertion. The suite remains non-zero for both true failures and missing historical artifacts.
- Added focused tests covering registration uniqueness, local non-shell execution, and strict failure classification.

## Ownership

No owned file contained overlapping work, so no `OWNERSHIP_CONFLICT` was recorded.

## Verification

- Focused runner tests: PASS (4 tests), including bounded timeout and continued summary behavior.
- Runner baseline before the change: FAIL because `npx` attempted an unavailable registry lookup for every harness.
- Updated runner without installed dependencies: expected infrastructure exit 2 with a local `tsx` installation message; no network lookup attempted.
- Full runner, TypeScript, build, and scoped lint: blocked in this clean worktree because dependencies are not installed and network access is unavailable.
- `git diff --check`: PASS.

## Publication

Draft PR #47 was created by the leader after all local gates passed. Independent review requested a bounded per-harness timeout; the runner now terminates a stuck child after 120 seconds, records it as a failure, and continues to the deterministic suite summary.
