# USR-TIMETABLE-SIMPLIFIED-CORE-WORKFLOW-01

## 1. Summary

- Baseline: GitHub `main` at `41f57f52b6b53fec426a4cbf6c77124d8f6777d9`.
- Scope: simplify the primary timetable-management journey without changing scheduling rules.
- New default journey: **Prepare → Build → Review → Publish**.
- Advanced tools remain available behind an explicit, discoverable control.
- The dashboard now derives one safe next action from live readiness and version state.
- Mobile users now have a real navigation header and menu.
- New schedule versions open in the primary V2 schedule builder.
- No database, migration, RLS, RPC, authentication, or production changes were made.

## 2. Files modified

- `src/components/app-layout.tsx`
- `src/routes/_authenticated/dashboard.tsx`
- `src/routes/_authenticated/data-onboarding.tsx`
- `src/routes/_authenticated/schedule-versions.tsx`
- `src/lib/core-workflow.ts` (new)
- `tests/harness/core-workflow-simplification.harness.ts` (new)
- `tests/harness/run.mjs`
- `implementation-reports/USR-TIMETABLE-SIMPLIFIED-CORE-WORKFLOW-01.md` (new)

## 3. Security Review

- Files changed: UI navigation, workflow presentation logic, static verification, report.
- Did migrations change? **No**.
- Did RLS change? **No**.
- Did RPCs change? **No**.
- Authentication impact: **No**.
- Authorization impact: **No**; existing role gates remain enforced and advanced items still use their original `roles` restrictions.
- Sensitive data exposure: **No**.
- Privilege escalation risk: **No identified risk**.
- Production risk: **Low**; source-only presentation and navigation changes.
- Ready for merge: **Yes, after branch CI is green and human review is complete**.
- Ready for deploy: **No**; deployment and authenticated runtime acceptance remain separate gated actions.

### Security invariants preserved

- The workflow resolver is presentation-only and cannot authorize a lifecycle transition.
- Server readiness, conflict, RBAC, RLS, and publish gates remain authoritative.
- No direct schedule-session update/delete path was introduced.
- Cross-college and role restrictions were not weakened.

## 4. Verification results

- `git diff --check`: PASS.
- Scoped ESLint for changed TypeScript files: PASS.
- `tsc --noEmit`: PASS.
- Vite production build: PASS.
- Repository harnesses: **62 passed, 0 failed** using the non-IPC `tsx` loader required by the execution sandbox.
- Bun unit tests: **58 passed, 0 failed**, 209 assertions across 10 files.
- Focused simplification harness verifies:
  - four-stage next-action resolution;
  - simple navigation and advanced-tool discovery;
  - role gates remain attached;
  - dashboard next-action behavior;
  - new version navigation to the primary builder;
  - absence of direct schedule-session mutation paths.

### Non-blocking build observations

- Existing deprecation warning for `createServerFn().inputValidator()` remains outside this stage.
- Existing large bundle warnings for `xlsx` and the main index chunk remain outside this stage.

## 5. Migration status

- No migration was added, edited, applied, or reordered.
- No production database connection or write was performed.

## 6. Production impact

- Production was not modified or deployed.
- Expected post-deployment impact: fewer primary choices, clearer next action, better mobile navigation, and direct entry into the supported V2 builder.
- The underlying scheduling, validation, version lifecycle, and publication mechanisms are unchanged.

## 7. Remaining risks

- Authenticated browser acceptance testing with representative `super_admin`, `college_admin`, and `read_only` accounts is still required before production deployment.
- The remaining advanced screens have not yet been simplified internally; they remain fully available through the advanced-tools menu.
- Existing bundle-size and deprecation warnings should be handled in a separate stage.

## 8. Recommended next step

1. Complete GitHub branch CI and review this isolated change set.
2. Run authenticated staging acceptance for the four roles/workflow states.
3. If accepted, start a separate fixed-scope stage to simplify the internal builder panels and forms without changing conflict or lifecycle logic.

## Decision

**PASS (source gate). HOLD (production deploy) until authenticated staging acceptance and explicit deployment approval.**
