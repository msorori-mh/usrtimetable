# A2.2 — Shared Lecture Groups (المجموعات المشتركة للمحاضرات): RPC/AuthZ/RLS Hardening

**Status: SOURCE ONLY — NOT APPLIED.** The migration
`supabase/migrations/20260722120000_source_only_shared_lecture_groups_authz.sql` is committed
for review only. First line: `-- SOURCE ONLY — NOT APPLIED — gate APPROVE_DB_MIGRATION_APPLY`.
It stacks on `20260722090000_source_only_shared_lecture_groups.sql` (A2.1, also NOT APPLIED),
which it **does not modify** — all changes are forward-hardening via `CREATE OR REPLACE FUNCTION`
/ `ALTER TABLE ... ADD CONSTRAINT`. Apply prerequisites: `20260717050000`, `20260721180000`,
`20260722090000`, then gate `APPROVE_DB_MIGRATION_APPLY`. No DML against business rows, no seeds,
no invented headcounts. The legacy Sections model is not referenced anywhere.

## What A2.2 adds over A2.1 (exactly)

1. **Group status lifecycle** — `draft → active → locked → archived` (archive from any state; no
   rollback edges). New status `locked` added by replacing the status CHECK constraint. All
   transitions go through the single gated RPC `transition_shared_lecture_group_status`; direct
   `INSERT/UPDATE/DELETE` on `shared_lecture_groups` stays revoked from
   `authenticated`/`anon`/`PUBLIC` (re-asserted in this migration).
2. **Fail-closed activation** — `draft → active` requires ≥1 linked component
   (`SHARED_GROUP_NO_COMPONENTS`), ≥1 participating cohort across both membership paths
   (`SHARED_GROUP_NO_COHORTS`), and an approved `scheduling_headcount` for **every** participating
   cohort in the group term (`SHARED_GROUP_HEADCOUNT_MISSING` with `missing_cohorts`).
3. **Component unlink RPC** — `remove_component_from_shared_lecture_group`. Deletes only the link
   row in `shared_lecture_group_components`. Guard: allowed **only while the group is `draft`**;
   otherwise `SHARED_GROUP_COMPONENT_UNLINK_BLOCKED` (blocker) with `dependency_evidence: 'UNKNOWN'`
   (see UNKNOWN-1). Locked/archived groups are also covered by this guard.
4. **super_admin cross-college path** — new table `shared_lecture_group_cross_college_cohorts`
   (separate from `shared_lecture_group_cohorts`; the A2.1 tenant-composite same-college FKs are
   **not** weakened) plus RPCs `add_cross_college_cohort_to_shared_lecture_group` /
   `remove_cross_college_cohort_from_shared_lecture_group`, both gated on `is_super_admin`
   (`CROSS_COLLEGE_REQUIRES_SUPER_ADMIN` otherwise). The A2.1 `add_cohort_to_shared_lecture_group`
   now redirects super_admins to this path (`CROSS_COLLEGE_USE_SUPER_ADMIN_PATH`) instead of the
   A2.1 dead-end `CROSS_COLLEGE_GROUP_NOT_SUPPORTED`. Mandatory `audit_logs` + revision rows on
   every mutation.
5. **GROUP_LOCKED guard** — A2.1 RPCs `add_component_…`, `add_cohort_…`, `remove_cohort_…` are
   re-issued (`CREATE OR REPLACE`) so `locked` (like `archived`) rejects all membership/component
   changes.
6. **Guards extended** — `STUDY_SYSTEM_MIX_REJECTED` is checked against both membership tables on
   both add paths; the approved-headcount fail-closed rule applies equally to super_admin
   cross-college adds; `resolve_shared_lecture_group_capacity` now SUMs approved
   `scheduling_headcount` over both membership paths (breakdown rows carry `membership_kind`).

## Authorization matrix (A2.2 surface)

| RPC / operation | super_admin | college_admin (own college) | college_admin (other college) | read_only | Enforcement |
|---|---|---|---|---|---|
| `transition_shared_lecture_group_status` | ALLOW | ALLOW | DENY | DENY | RPC `can_manage_college` + `FOR UPDATE`; edge whitelist; fail-closed activation preconditions; revision + audit |
| `remove_component_from_shared_lecture_group` | ALLOW | ALLOW (draft groups only) | DENY | DENY | RPC check + draft-only fail-closed (`SHARED_GROUP_COMPONENT_UNLINK_BLOCKED`) |
| `add_cross_college_cohort_to_shared_lecture_group` | ALLOW | DENY (`CROSS_COLLEGE_REQUIRES_SUPER_ADMIN`) | DENY | DENY | RPC `is_super_admin`; term match; `STUDY_SYSTEM_MIX_REJECTED`; approved headcount required; audit mandatory |
| `remove_cross_college_cohort_from_shared_lecture_group` | ALLOW | DENY | DENY | DENY | RPC `is_super_admin`; link-row-only delete; audit mandatory |
| `add_component_…` / `add_cohort_…` / `remove_cohort_…` (re-issued) | ALLOW | ALLOW | DENY | DENY | RPC `can_manage_college`; `GROUP_LOCKED`/`GROUP_ARCHIVED`; same-college composite FKs intact |
| `resolve_shared_lecture_group_capacity` (re-issued) | ALLOW | ALLOW | DENY | DENY* | RPC `can_view_college`; SUM over both membership paths; fail-closed blockers (*read_only passes `can_view_college` when assigned to the college, as in A2.1) |
| Direct `UPDATE shared_lecture_groups.status` | DENY | DENY | DENY | DENY | `REVOKE INSERT, UPDATE, DELETE` from `authenticated, anon, PUBLIC`; status changes only via RPC |
| `shared_lecture_group_cross_college_cohorts` SELECT | ALLOW | own-college groups (`can_view_college` on group college) | DENY | SELECT (assigned) | RLS policy; writes revoked, RPC-only |

## Key decisions

- **Cross-college representation as a separate table.** A2.1's composite FKs
  `(cohort_id, college_id) → academic_cohorts(id, college_id)` structurally force same-college
  membership; that is a feature, not a bug. The super_admin path therefore uses a dedicated table
  with a plain `cohort_id → academic_cohorts(id)` FK, a composite FK to the group
  (`(group_id, college_id) → shared_lecture_groups(id, college_id)`), and a CHECK that
  `cohort_college_id <> college_id` so the table can only hold genuinely cross-college rows.
- **`locked` status** gives the lifecycle a real freeze point: membership/component edits are
  rejected in `locked`/`archived`, while capacity resolution and audit reads remain available.
- **Unlink restricted to `draft`** instead of attempting a session-dependency query (UNKNOWN-1).
  This is the fail-closed reading of the rule "no removal when scheduled sessions depend on the
  link": sessions can only be produced by the A2.4 builder from non-draft groups, so draft-only
  unlink is provably safe, and everything else is blocked rather than guessed.
- **No rollback transitions** (e.g. `active → draft`) — fail-closed lifecycle; the escape hatch is
  `archived`, which is terminal for edits.

## UNKNOWNs

- **UNKNOWN-1: schedule_sessions ↔ shared-group dependency cannot be proven.** The reviewed
  `schedule_sessions` surface (via `20260714010000_schedule_session_move_rpc.sql`) exposes
  `section_id` (legacy), `course_offering_id`, `teaching_assignment_id`, `study_system`,
  `expected_students`, `room_id`, etc., and **no** column or FK referencing shared lecture groups
  or `plan_course_components`; the builder fan-out that would create such a dependency is deferred
  to A2.4. Therefore the unlink guard is designed fail-closed (draft-only) and records
  `dependency_evidence: 'UNKNOWN'`. If A2.4 adds a session↔group link, this guard should be
  revisited to a precise session-existence check.
- **UNKNOWN-2: applied state of prerequisites.** `20260717050000`, `20260721180000`,
  `20260722090000` are all SOURCE-ONLY/NOT APPLIED per `STATE.json`; the composite
  `UNIQUE(id, college_id)` keys and `scheduling_cohort_term_headcounts` this migration references
  are assumed from source review only. No migration is considered applied without remote evidence.
- **UNKNOWN-3: runtime behavior.** No runtime exists in this environment; RLS/AuthZ behavior is
  asserted statically only. Live RLS/AuthZ tests against a database remain a follow-up.

## Safety

No DB writes, no migration apply, no deploy, no DML against business rows, no seeds. The A2.1
migration file is byte-untouched (harness-asserted). `main` is untouched; work is stacked on
`feat/a2-1-shared-lecture-groups`.

## Validation performed

**Static review only.** No runtime in this environment: the new harness
`tests/harness/shared-lecture-groups-authz.harness.ts` is added and registered in
`tests/harness/run.mjs` but **not executed** here; no tsc/build/DB apply performed. The harness
asserts (statically): SOURCE-ONLY header on line 1, prerequisites declared, no legacy-model
references, no DML against business tables, status CHECK extension, all new/re-issued RPC names,
fail-closed codes (`GROUP_LOCKED`, `SHARED_GROUP_COMPONENT_UNLINK_BLOCKED`,
`CROSS_COLLEGE_REQUIRES_SUPER_ADMIN`, `STUDY_SYSTEM_MIX_REJECTED`,
`SHARED_GROUP_HEADCOUNT_MISSING`, `SHARED_GROUP_NO_COMPONENTS`), REVOKE/GRANT discipline, ≥8 audit
inserts, A2.1 file unmodified, and that A2.1 composite FKs are not dropped. Harness, typecheck,
and database apply remain for an environment with runtime access. **No operational gate is
claimed PASS.**

## Follow-ups

- **A2.3 — UI**: surface `locked` status, the transition RPC, cross-college membership (super_admin
  only), and the new blocker codes.
- **A2.4 — builder/conflicts/capacity/reports**: session fan-out; when a session↔group link exists,
  replace the draft-only unlink guard with a precise session-existence check (UNKNOWN-1).
- Live RLS/AuthZ tests once a runtime with an applied database is available (UNKNOWN-3).
