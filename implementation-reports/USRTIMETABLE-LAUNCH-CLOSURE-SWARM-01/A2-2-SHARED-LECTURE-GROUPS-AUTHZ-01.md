# A2.2 — Shared Lecture Groups (المجموعات المشتركة للمحاضرات): RPC/AuthZ/RLS Hardening

**Status: SOURCE ONLY — NOT APPLIED.** The migration
`supabase/migrations/20260722120000_source_only_shared_lecture_groups_authz.sql` is committed
for review only. First line: `-- SOURCE ONLY — NOT APPLIED — gate APPROVE_DB_MIGRATION_APPLY`.
It stacks on `20260722090000_source_only_shared_lecture_groups.sql` (A2.1, also NOT APPLIED),
which it **does not modify** — all changes are forward-hardening via `CREATE OR REPLACE FUNCTION`
/ `ALTER TABLE ... ADD CONSTRAINT`. Apply prerequisites: `20260717050000`, `20260721180000`,
`20260722090000`, then gate `APPROVE_DB_MIGRATION_APPLY`. No DML against business rows, no seeds,
no invented headcounts. The legacy Sections model is not referenced anywhere.

> **Review revision (PR #73, APPROVE_WITH_NOTES):** findings F1–F4 + F6 addressed in place on the
> same branch. F1 corrected the earlier UNKNOWN-1: `schedule_sessions.plan_course_component_id`
> **does exist** (added by `20260716025117` §6 and pinned by the composite FK
> `ss_component_college_fkey` in `20260717050000`), so the component-unlink guard is now a
> precise session-existence check plus the draft-only rule.

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
3. **Component unlink RPC** — `remove_component_from_shared_lecture_group` with two fail-closed
   guards: **(a)** a precise guard — if any `schedule_sessions` row references the same
   `plan_course_component_id` in the group college, unlink is rejected in **any** status with
   `SHARED_GROUP_COMPONENT_IN_USE`; **(b)** a draft-only guard — once the group leaves `draft`,
   links are frozen (`SHARED_GROUP_COMPONENT_UNLINK_BLOCKED`) because the A2.4 builder consumes
   them. Deletes only the link row in `shared_lecture_group_components`.
4. **super_admin cross-college path** — table `shared_lecture_group_cross_college_cohorts`
   (separate from `shared_lecture_group_cohorts`; the A2.1 tenant-composite same-college FKs are
   **not** weakened) plus RPCs `add_cross_college_cohort_to_shared_lecture_group` /
   `remove_cross_college_cohort_from_shared_lecture_group`, both gated on `is_super_admin`
   (`CROSS_COLLEGE_REQUIRES_SUPER_ADMIN` otherwise). Audit is **dual-keyed**: one row on the
   group's college and one mirror row on the cohort's home college
   (`mirror_reason: 'cohort_college_visibility'`). The SELECT policy covers both colleges:
   `can_view_college(auth.uid(), college_id) OR can_view_college(auth.uid(), cohort_college_id)`.
   The A2.1 `add_cohort_to_shared_lecture_group` redirects super_admins to this path
   (`CROSS_COLLEGE_USE_SUPER_ADMIN_PATH`).
5. **GROUP_LOCKED guard** — A2.1 RPCs `add_component_…`, `add_cohort_…`, `remove_cohort_…` are
   re-issued (`CREATE OR REPLACE`) so `locked` (like `archived`) rejects all membership/component
   changes.
6. **Guards extended** — `STUDY_SYSTEM_MIX_REJECTED` is checked against both membership tables on
   both add paths; the approved-headcount fail-closed rule applies equally to super_admin
   cross-college adds; `resolve_shared_lecture_group_capacity` SUMs approved
   `scheduling_headcount` over both membership paths (breakdown rows carry `membership_kind`).

## Authorization matrix (A2.2 surface)

| RPC / operation | super_admin | college_admin (own college) | college_admin (other college) | read_only | Enforcement |
|---|---|---|---|---|---|
| `transition_shared_lecture_group_status` | ALLOW | ALLOW | DENY | DENY | RPC `can_manage_college` + `FOR UPDATE`; edge whitelist; fail-closed activation preconditions; revision + audit |
| `remove_component_from_shared_lecture_group` | ALLOW (**draft groups only**, and only when no `schedule_sessions` reference the component — no role bypass) | ALLOW (same draft-only + session guards) | DENY | DENY | RPC check + precise session guard (`SHARED_GROUP_COMPONENT_IN_USE`) + draft-only guard (`SHARED_GROUP_COMPONENT_UNLINK_BLOCKED`) |
| `add_cross_college_cohort_to_shared_lecture_group` | ALLOW | DENY (`CROSS_COLLEGE_REQUIRES_SUPER_ADMIN`) | DENY | DENY | RPC `is_super_admin`; term match; `STUDY_SYSTEM_MIX_REJECTED`; approved headcount required; dual-keyed audit |
| `remove_cross_college_cohort_from_shared_lecture_group` | ALLOW | DENY | DENY | DENY | RPC `is_super_admin`; link-row-only delete; dual-keyed audit |
| `add_component_…` / `add_cohort_…` / `remove_cohort_…` (re-issued) | ALLOW | ALLOW | DENY | DENY | RPC `can_manage_college`; `GROUP_LOCKED`/`GROUP_ARCHIVED`; same-college composite FKs intact |
| `resolve_shared_lecture_group_capacity` (re-issued) | ALLOW | ALLOW | DENY | DENY* | RPC `can_view_college`; SUM over both membership paths; fail-closed blockers (*read_only passes `can_view_college` when assigned to the college, as in A2.1) |
| Direct `UPDATE shared_lecture_groups.status` | DENY | DENY | DENY | DENY | `REVOKE INSERT, UPDATE, DELETE` from `authenticated, anon, PUBLIC`; status changes only via RPC |
| `shared_lecture_group_cross_college_cohorts` SELECT | ALLOW | group college OR cohort home college (`can_view_college` on either) | DENY | SELECT (assigned to either college) | RLS policy; writes revoked, RPC-only |

## Key decisions

- **Cross-college representation as a separate table.** A2.1's composite FKs
  `(cohort_id, college_id) → academic_cohorts(id, college_id)` structurally force same-college
  membership; that is a feature, not a bug. The super_admin path therefore uses a dedicated table
  with a plain `cohort_id → academic_cohorts(id)` FK, a composite FK to the group
  (`(group_id, college_id) → shared_lecture_groups(id, college_id)`), and a CHECK that
  `cohort_college_id <> college_id` so the table can only hold genuinely cross-college rows.
- **`locked` status** gives the lifecycle a real freeze point: membership/component edits are
  rejected in `locked`/`archived`, while capacity resolution and audit reads remain available.
- **Two-guard unlink.** Guard (a) is precise: `schedule_sessions.plan_course_component_id` is a
  proven column (see UNKNOWNs), so any scheduled session referencing the component in the group
  college blocks unlink regardless of role or group status. Guard (b) freezes links after
  `draft` because the A2.4 builder will consume group definitions; the escape hatch is `archived`.
- **No rollback transitions** (e.g. `active → draft`) — fail-closed lifecycle.
- **Dual-keyed cross-college audit + widened SELECT** so the cohort's home college can see and
  audit cross-college participation affecting its own cohorts (review F2).

## Operational notes (review F6)

- **NOOP transitions are intentionally unaudited.** Calling the transition RPC with the current
  status returns `{ ok: true, code: 'NOOP' }` without a revision or `audit_logs` row — no state
  changed, so there is nothing to audit. This is deliberate, not a gap.
- **Theoretical capacity overflow.** `resolve_shared_lecture_group_capacity` accumulates into an
  `integer`; `sum()` over `integer` inputs returns `bigint`, and the assignment back to
  `integer` could overflow only if summed headcounts exceed ~2.1B — practically impossible for
  real cohort sizes. Recorded as theoretical; A2.4 may switch the variable to `bigint` for
  symmetry with `sum()`.
- **Post-activation headcount drift.** Activation validates approved headcounts once. If a
  headcount is later edited back to `draft`/un-approved (drift), the group is **not**
  retro-actively deactivated; instead every downstream consumer fails closed at read time —
  `resolve_shared_lecture_group_capacity` re-checks approval on each call and returns
  `SHARED_GROUP_HEADCOUNT_MISSING`. Policy: approval validity is enforced at consumption, not
  cached at activation.

## UNKNOWNs

- ~~UNKNOWN-1: schedule_sessions ↔ shared-group dependency~~ — **RESOLVED (review F1).**
  `schedule_sessions.plan_course_component_id` exists (evidence: `20260717050000` constraint
  mapping `ss_component_college_fkey`: `schedule_sessions(plan_course_component_id, college_id)
  → plan_course_components(id, college_id)`; column introduced per `20260716025117` §6). The
  unlink guard now uses a precise `EXISTS` check on this column. Remaining caveat: sessions are
  matched by component + college, not by group membership, so the guard is conservative (it may
  block unlink because of sessions that are not part of this shared group) — that is the
  intended fail-closed direction; a group-scoped session link remains A2.4 work.
- **UNKNOWN-2: applied state of prerequisites.** `20260717050000`, `20260721180000`,
  `20260722090000` are all SOURCE-ONLY/NOT APPLIED per `STATE.json`; the composite
  `UNIQUE(id, college_id)` keys and `scheduling_cohort_term_headcounts` this migration references
  are assumed from source review only. No migration is considered applied without remote evidence.
- **UNKNOWN-3: runtime behavior.** No runtime exists in this environment; RLS/AuthZ behavior is
  asserted statically only. Live RLS/AuthZ tests against a database remain a follow-up.

## Safety

No DB writes, no migration apply, no deploy, no DML against business rows, no seeds. The A2.1
migration file is **unmodified on this branch** — provable from git history (the branch contains
no commit touching `20260722090000_…sql`); the static harness only checks marker strings, it does
not prove byte-identity. `main` is untouched; work is stacked on `feat/a2-1-shared-lecture-groups`.

## Validation performed

**Static review only.** No runtime in this environment: the new harness
`tests/harness/shared-lecture-groups-authz.harness.ts` is added and registered in
`tests/harness/run.mjs` but **not executed** here; no tsc/build/DB apply performed. The harness
asserts (statically): SOURCE-ONLY header on line 1, prerequisites declared, no legacy-model
references, no DML against business tables, status CHECK extension, all new/re-issued RPC names,
the precise `schedule_sessions` unlink guard (`SHARED_GROUP_COMPONENT_IN_USE` + `EXISTS …
ss.plan_course_component_id`), the widened cross-college SELECT policy
(`can_view_college(…, cohort_college_id)`), dual-keyed cross-college audit
(`mirror_reason: 'cohort_college_visibility'`), fail-closed codes (`GROUP_LOCKED`,
`SHARED_GROUP_COMPONENT_UNLINK_BLOCKED`, `CROSS_COLLEGE_REQUIRES_SUPER_ADMIN`,
`STUDY_SYSTEM_MIX_REJECTED`, `SHARED_GROUP_HEADCOUNT_MISSING`, `SHARED_GROUP_NO_COMPONENTS`),
REVOKE/GRANT discipline, ≥10 audit inserts, A2.1 file markers unchanged, and that A2.1 composite
FKs are not dropped. Harness, typecheck, and database apply remain for an environment with
runtime access. **No operational gate is claimed PASS.**

## Follow-ups

- **A2.3 — UI**: surface `locked` status, the transition RPC, cross-college membership (super_admin
  only), and the new blocker codes (`SHARED_GROUP_COMPONENT_IN_USE`).
- **A2.4 — builder/conflicts/capacity/reports**: session fan-out; introduce a group-scoped
  session link so the unlink guard can narrow from component+college to this group's sessions;
  consider `bigint` for capacity accumulation (F6).
- Live RLS/AuthZ tests once a runtime with an applied database is available (UNKNOWN-3).
