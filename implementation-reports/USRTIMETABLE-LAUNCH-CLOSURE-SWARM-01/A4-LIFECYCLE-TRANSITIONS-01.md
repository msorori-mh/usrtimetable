# A4 — Schedule Version Lifecycle Transitions (SOURCE ONLY — NOT APPLIED)

Swarm: USRTIMETABLE-AUTONOMOUS-SOURCE-CLOSURE-WAVE-03 · Track 5 · Agent: AGENT-LIFECYCLE-AUTHZ-A4
Deliverable: `supabase/migrations/20260722100000_source_only_schedule_version_lifecycle.sql`
Validation: **static review only** — no runtime gates were executed in this environment.

**NOT APPLIED.** This migration is source-only and gated behind
`APPROVE_DB_MIGRATION_APPLY`. No database writes, no migration apply, no deploy,
no publish were performed or are authorized by this change.

## States

Main uses lowercase statuses on `public.schedule_versions.status`:
`draft`, `review`, `approved`, `published`, `archived`.
The track vocabulary maps as: DRAFT→`draft`, UNDER_REVIEW→`review`,
APPROVED→`approved`, PUBLISHED→`published`, ARCHIVED→`archived`.

## Edge matrix

| Edge | Event type | Allowed roles | Notes | Quality gates |
| --- | --- | --- | --- | --- |
| draft → review (submit) | `submitted_for_review` | college_admin (own college), super_admin | optional | sessions exist; fresh quality run; 0 unapproved hard conflicts |
| review → approved (approve) | `approved` | college_admin (own college), super_admin | optional | fresh quality run; 0 unapproved hard conflicts |
| approved → published (publish) | `published` | **college_admin (own college) only**; super_admin only as audited override | mandatory for super_admin override (`PUBLISH_OVERRIDE_NOTES_REQUIRED`) | fresh quality run; 0 unapproved hard conflicts |
| published → archived (archive) | `archived` | college_admin (own college), super_admin | optional | none |
| review → draft (reject back) | `rolled_back_to_draft` | college_admin (own college), super_admin | **mandatory** (`REVIEW_NOTES_REQUIRED`) | none |
| approved → review (revoke approval) | `rolled_back_to_review` | college_admin (own college), super_admin | **mandatory** (`REVIEW_NOTES_REQUIRED`) | none |

Every other (from, to) pair raises `INVALID_SCHEDULE_VERSION_TRANSITION`
(ERRCODE 23514). **archived is terminal**: the matrix has no outgoing edges
from `archived`, and the 20260718120000 immutability triggers
(`IMMUTABLE_SCHEDULE_VERSION`) additionally lock published/archived rows
against update/delete.

## Enforcement model

- Single entry point: `public.transition_schedule_version(p_college_id,
  p_schedule_version_id, p_expected_status, p_target_status, p_notes)` —
  SECURITY DEFINER, advisory-locked (`pg_advisory_xact_lock`), row locked
  `FOR UPDATE`, tenant-scoped by `p_college_id`.
- Optimistic stale-transition rejection: `v_version.status <> p_expected_status`
  raises `STALE_VERSION_STATUS` (ERRCODE 40001); the guarded UPDATE re-checks
  `status = p_expected_status` and re-raises on miss.
- Base role check: `can_manage_college(v_actor, p_college_id)`
  (= `is_super_admin` OR (`has_role college_admin` AND `user_in_college`)).
- Role-per-edge: publish requires college_admin of the owning college; a
  super_admin publish is flagged `super_admin_override=true` in both the
  lifecycle event metadata and the audit row, and requires justification notes.
- No general bypass: `REVOKE UPDATE ON public.schedule_versions FROM
  authenticated` (re-asserted); only `UPDATE (name, notes)` is granted.
- Privilege discipline: `REVOKE ALL ... FROM PUBLIC, anon`;
  `GRANT EXECUTE ... TO authenticated, service_role` on both RPCs.

## History / audit model

- `public.schedule_version_events` (existing on main) is the lifecycle history
  table: `college_id`, `schedule_version_id`, `event_type`, `from_status`,
  `to_status`, `performed_by`, **`actor_role` (added here)**, `notes`,
  `metadata`, `created_at`. Append-only for clients (`REVOKE UPDATE, DELETE`),
  college-scoped RLS (`can_view_college` select; `can_manage_college` +
  self-attributed insert, preserving the client's clone-event path).
- Every transition additionally inserts `public.audit_logs` row
  (`action='schedule_version_transition'`, entity `schedule_versions`, details
  include from/to, actor_role, override flag, notes, quality evidence).
- Approval history = events `approved`; publish history = events `published`
  (with override flag); archive history = events `archived`.
- `public.list_schedule_version_lifecycle_events(p_college_id,
  p_schedule_version_id)` (new) returns the ordered history to any
  `can_view_college` actor without broadening table grants.

## Gap analysis vs existing main

Already existed (NOT redefined, preserved verbatim inside the CREATE OR REPLACE):
atomic transition RPC with advisory lock + `FOR UPDATE`; six-edge matrix;
`STALE_VERSION_STATUS`; quality gates (`NO_SESSIONS`, `QUALITY_RUN_REQUIRED`,
`QUALITY_RUN_STALE`, `UNAPPROVED_HARD_CONFLICTS`); `schedule_version_events`
insert; eligibility_revision machinery and dependency-invalidation triggers;
published/archived immutability triggers; direct-status-update lockout.

Added by this migration (gap-fill only):
1. `actor_role` capture on lifecycle history (column + RPC population).
2. Role-per-edge enforcement (publish restricted; super_admin override audited
   and notes-gated).
3. Mandatory review notes on reject/revoke edges.
4. `audit_logs` integration per house style (20260721180000).
5. RLS/grant hardening + safety-net DDL for `schedule_version_events`.
6. `list_schedule_version_lifecycle_events` read RPC.

## Interaction with PR #38

PR #38 (draft, `codex/lifecycle-optimistic-transition`) added a client-side
expected-status compare (`.eq("status", from)` + `STALE_VERSION_STATUS`) and a
harness. It was left Draft/BLOCKED on a HIGH finding: status mutation and audit
insert were non-atomic. Main superseded it: the client now calls the atomic
`transition_schedule_version` RPC (20260718120000), which implements the same
expected-status concept server-side in one transaction. This migration keeps
that concept unchanged and extends the same RPC. Recommendation: close PR #38
as superseded; do not merge it (its client-side `.update({ status: to })`
conflicts with the RPC-only status model and the `REVOKE UPDATE` lockout).

## UNKNOWNs / residual risk

- The migration file that defines `public.schedule_version_events` could not be
  located by source inspection (repo code search unindexed; 10 candidate
  migrations read). Safety-net `CREATE TABLE IF NOT EXISTS` uses the shape
  inferred from all known writers; if the real table diverges (e.g. extra NOT
  NULL columns), the RPC insert could fail at apply time. Pre-apply preflight
  should diff the live table shape.
- `GRANT EXECUTE ... TO service_role` widens the 20260718120000 grant
  (authenticated-only) to match the 20260721180000 house style for server jobs.
- Direct client inserts into `schedule_version_events` (clone events) remain
  allowed under the self-attribution policy; a fully RPC-only event path is
  future work.
- No runtime validation: harness is static source assertion only; disposable
  PostgreSQL compile/runtime checks were not possible in this environment.
