# Report access recovery — 2026-09-23

## Scope and baseline

The reported symptom is disabled report printing. The observed program-level report had no loaded colleges, no role label, zero rows and disabled print/export buttons. This is a report-access failure before the print handler; successful PDF output has not yet been established.

Initial source baseline: `3f390b0eebdedc984a1b566e35e2709eaef91124`. During diagnosis, PR #285 merged as `305ba02a857bd7f3913a72c0e5a32df9a8fc88d7`, fixing saved-session MFA continuation, bounded session checks and repeated SIGNED_IN refreshes. This follow-up preserves that implementation exactly and adds only the remaining query-error and pre-request permission recovery.

PR #286 subsequently merged as `dfff748dc11dfbebbd3c9d0f8f011ee5e2661fd8`, retaining printable content through background refetches and bounding the web-font wait. This follow-up is based on that newer tree and preserves its print-handler changes.

The academic staffing readiness unit remains marked «جاري التطوير». This change does not remove that unit or change staffing calculations, report layouts or print CSS. No causal link from the staffing unit itself to this access failure was established.

## Remaining defects and changes

- Failed profile, role and college queries were converted into empty permissions. Propagate failures and keep report children closed until retry succeeds.
- College loading failures were displayed as “no assigned colleges”. Expose the query error and a retry action; preserve the genuine successful-empty state.
- Refocusing many open tabs could refetch stale heavy reports. Disable automatic window-focus refetch; navigation, explicit refetch and mutation invalidation remain available.
- Production inspection found `anon` unable to execute `public.enforce_initial_password_change()`, the void pre-request hook. Restore only EXECUTE on that hook; its existing body, all table permissions, RLS and session/password/MFA requirements stay unchanged.

The production guard body hash before this follow-up was `aae86fcfe6b0cf1f3629e235ca54b221` (MD5 of `pg_get_functiondef`). Deployment must recheck the exact body before applying the grant and verify it is unchanged afterward. The migration is repeatable and has no row writes.

## Security review

- Files: two permission/college hooks, two scope/error components, router query defaults, the password-onboarding workflow, one migration, one regression test and this record.
- Migration: yes; one narrowly scoped EXECUTE grant and schema-cache notification.
- RLS: unchanged. RPC implementation: unchanged. No data-reading RPC privilege added.
- Authentication: preserves PR #285's server-verified MFA/session/password checks.
- Authorization: failed client scope reads block report rendering; database authorization remains authoritative. No new role or college membership.
- Sensitive data / secrets: no credentials or tokens added. Errors shown by the new scope components are fixed Arabic messages.
- Privilege escalation: no added data privileges; anonymous execution returns void and does not bypass any table permission or policy. Disposable PostgreSQL tests verify this boundary.
- Production risk: low for the scope UI and query defaults; security-sensitive grant independently verified against the current guard body.

## Verification and release gates

PASS: 32 authentication/security tests, including the PR #285 session/MFA regression tests and two new tests exercising real permission-reading code and the PostgreSQL guard. The latter reproduces the missing grant, applies the migration twice, and proves unchanged function body, anonymous data denial, college isolation, and rejection of revoked/password-required/MFA-required sessions.

PASS: TypeScript no-emit check, production build, and ESLint for all five changed application files.

PASS: 19 additional regression tests covering print snapshot retention, font timeout, large-report query batching and the academic staffing development/readiness gate. The viewer-role suite requires Vitest, not the Node test runner; its initially incorrect runner invocation is not a product failure.

HOLD until release verification: all PR checks on the exact candidate commit; merged code synchronized to the production host; guarded production EXECUTE grant; authenticated report population and the actual print action. A live browser now reaches the existing account's OTP step, which must be completed by its owner before authenticated printing can be verified. Do not describe code/CI success as a successful printed report.

Rollback, if required, should revert only this follow-up's files. Reverting the EXECUTE grant restores the known anonymous-hook failure and is not a normal recovery step. Never disable MFA, the pre-request hook or RLS to make a report load.
