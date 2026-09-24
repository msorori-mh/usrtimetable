# USR-TIMETABLE-SIMPLIFIED-BUILDER-WORKSPACE-02

## 1. Summary

- Parent source: `agent/simplify-core-workflow-01` / PR #138.
- Scope: reduce cognitive load inside Schedule Builder without changing scheduling behavior.
- The weekly grid is now the primary surface immediately after the required context selectors.
- Unscheduled assignments are presented as one compact, expandable action queue with a live count.
- Version shortcuts, statistics, and six filters remain available under one progressive-disclosure control.
- Session editing is presented as three explicit steps: apply locally, validate conflicts, save safely.
- Static session metadata is collapsed by default but remains available.

## 2. Files modified

- `src/routes/_authenticated/schedule-builder.tsx`
- `src/components/schedule-builder/v2-work-items-panel.tsx`
- `src/components/schedule-builder/session-edit-sheet.tsx`
- `tests/harness/builder-progressive-disclosure.harness.ts` (new)
- `tests/harness/run.mjs`
- `implementation-reports/USR-TIMETABLE-SIMPLIFIED-BUILDER-WORKSPACE-02.md` (new)

## 3. Security Review

- Did migrations change? **No**.
- Did RLS change? **No**.
- Did RPCs change? **No**.
- Authentication impact: **No**.
- Authorization impact: **No**.
- Sensitive data exposure: **No**.
- Privilege escalation risk: **No identified risk**.
- Production risk: **Low**, presentation-only source changes.
- Ready for merge: **Pending complete CI and review**.
- Ready for deploy: **No**, authenticated acceptance is still required.

### Preserved invariants

- The save button remains disabled until `canSaveAfterValidation(validation)` succeeds.
- Adding unscheduled work still requires both the client role and server-returned `can_manage`, and the version must be a draft.
- The builder still validates and saves through the existing RPC helpers.
- No direct `schedule_sessions` update/delete path was introduced.
- Published/archived version locks, stale-session protection, unsaved-change guard, drag/drop safety, and undo remain unchanged.

## 4. TEST_ONLY acceptance pack

The user authorized isolated test identities and data. The intended authenticated matrix is:

| Identity                      | Role            | Expected capability                                  |
| ----------------------------- | --------------- | ---------------------------------------------------- |
| `TEST_ONLY-UAT-<run>-super`   | `super_admin`   | Full institution administration and user creation    |
| `TEST_ONLY-UAT-<run>-college` | `college_admin` | Manage only the assigned TEST_ONLY college           |
| `TEST_ONLY-UAT-<run>-viewer`  | `read_only`     | View schedules; no edit, import, or publish controls |

Rules:

- Generate passwords at apply time; never commit or record them in this repository.
- Assign non-super roles to one isolated TEST_ONLY college only.
- Use a disposable draft version marked with the existing `disposable_test` contract when available.
- Never edit real users, real versions, or production schedules.
- Cleanup must target exact recorded user/version IDs only.

Current execution environment does not contain a Supabase service-role credential, and the connected application browser is signed out. Therefore, identity/data creation and authenticated browser acceptance remain **HOLD**, not silently simulated.

## 5. Verification results

- Prettier: **PASS**.
- `git diff --check`: **PASS**.
- Focused progressive-disclosure harness: **PASS**.
- Full repository harness suite: **63 passed, 0 failed**.
- Unit tests: **58 passed, 0 failed**, 209 assertions across 10 files.
- Scoped ESLint: **PASS**.
- TypeScript `tsc --noEmit`: **PASS**.
- Vite production build: **PASS**.
- GitHub Actions runtime gate: pending branch publication.

Non-blocking pre-existing observations:

- `createServerFn().inputValidator()` deprecation warnings remain outside this stage.
- Existing bundle-size warnings for `xlsx` and the main index chunk remain outside this stage.

## 6. Migration status

- No migration added, edited, applied, or reordered.
- No database write performed by this source stage.

## 7. Production impact

- No production deployment or database mutation.
- Expected UI impact after deployment: less initial scrolling and fewer simultaneous controls, while all existing capabilities remain discoverable.

## 8. Remaining risks and next step

- Complete authenticated acceptance for all three roles after a project administrator signs in through the connected application session.
- Create only the exact TEST_ONLY identities and disposable draft required for that run.
- Record IDs and remove the fixtures with exact-target cleanup after evidence capture.

## Decision

**PASS (local source gate). HOLD (authenticated TEST_ONLY acceptance) until an administrator session is available.**
