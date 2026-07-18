# Schedule Version Lifecycle Agent Report

Date: 2026-07-18 (Asia/Riyadh)

## Decision

Implemented a fail-closed source-only lifecycle design. The leader completed the previously blocked runtime gates on disposable PostgreSQL and the verified baseline dependency tree. No schedule was published and no production state was accessed or changed.

PR #38 was inspected from its locally available branch `origin/codex/lifecycle-optimistic-transition`. Its expected-status predicate is correct, but its client-side status update and later event insert are not atomic. None of its central timetable-document edits were copied and PR #38 was not merged.

## Implementation

- Added source-only migration `20260718120000_source_only_atomic_schedule_version_lifecycle.sql`, explicitly labeled `NOT APPLIED`.
- Added tenant-authorized `transition_schedule_version` RPC for the allowed `draft -> review -> approved -> published -> archived` path and the existing review rollbacks.
- The RPC uses the caller identity, `can_manage_college`, a tenant/version lookup, expected-status optimistic concurrency, publish blockers, status mutation, and event audit in one database statement/transaction.
- Transaction advisory locks are shared by session, quality-run, conflict-check, and conflict-exception writers so eligibility inputs cannot change during the transition decision.
- Direct authenticated table status updates are revoked; ordinary `name` and `notes` updates remain column-scoped.
- Published/archived version metadata updates and deletion are rejected. Existing session immutability remains in the prior migration.
- Client transition code now calls only the RPC; it no longer separately updates status and inserts audit.
- Added generated RPC typing, a focused static harness, and a disposable PostgreSQL proof fixture covering unauthorized actor rejection, stale status, forced audit failure rollback, publish, and immutability.

## Verification

- Lifecycle advancement now requires quality evidence stamped with the exact numeric `eligibility_revision`; every scorer/validator input invalidates affected versions, including deterministic OLD+NEW college/version moves and global quality-metric changes.

- Focused Bun harness: **PASS**.
- `git diff --check`: **PASS** (line-ending conversion warnings only).
- Disposable PostgreSQL 15 proof: **PASS** for compilation, unauthorized actor, stale status, forced audit-failure rollback, positive transitions, publish blockers, audit count, and published immutability. The disposable container was removed.
- TypeScript: **PASS**.
- Production build: **PASS**.
- Scoped lint: **PASS** with the repository's existing CRLF/Prettier baseline disabled; focused new-file formatting passed.
- Migration status: **SOURCE-ONLY — NOT APPLIED**.
- Production/Supabase connection: **NONE**.

## GitHub / delivery status

- Base checkout SHA: `fcd91f35f397af2fecd0de2ba0bc205301cb1c54`, matching the locally available `origin/main` ref.
- Live fetch/`ls-remote`: blocked by network and the worktree gitdir's read-only parent metadata.
- GitHub CLI authentication is invalid for the configured account.
- Commit SHA: pending leader commit.
- Push: pending leader push.
- Draft PR: pending leader creation and independent review.

## Ownership and handoff

No owned-file collision was observed. The four central timetable documents were read and not edited. No `OWNERSHIP_CONFLICT` was recorded.

Leader handoff: all local gates passed. Commit only the scoped lifecycle files, push, open a Draft PR, and require independent authorization/isolation/concurrency/migration/audit review before merge. Do not apply the migration or publish an actual schedule.
