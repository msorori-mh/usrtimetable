# A2.1 — Shared Lecture Groups (المجموعات المشتركة للمحاضرات): Domain Model

**Status: SOURCE ONLY — NOT APPLIED.** The migration
`supabase/migrations/20260722090000_source_only_shared_lecture_groups.sql` is committed
for review only. It must not be applied until (a)
`20260717050000_source_only_harden_cross_college_references.sql` and
`20260721180000_source_only_scheduling_headcount_foundation.sql` are applied, and (b) the
`APPROVE_DB_MIGRATION_APPLY` gate is granted. No DML against business rows, no seeds, no
invented headcounts. The legacy Sections model is not used anywhere in this design.

## Entities

| Table | Purpose |
| --- | --- |
| `shared_lecture_groups` | One shared delivery group per (college, term). `status`: `draft`/`active`/`archived`. `UNIQUE(id, college_id)` + composite term FK. `set_updated_at` trigger. |
| `shared_lecture_group_components` | Links a group to `plan_course_components`. Linkage at component level lets theory components merge while labs stay separate. `UNIQUE(group_id, plan_course_component_id)`; composite FKs to `shared_lecture_groups(id, college_id)` and `plan_course_components(id, college_id)`. |
| `shared_lecture_group_cohorts` | Explicit participating cohorts. `UNIQUE(group_id, cohort_id)`; composite FKs to `shared_lecture_groups(id, college_id)` and `academic_cohorts(id, college_id)`. |
| `shared_lecture_group_revisions` | Append-only audit snapshots (`create`, `add_component`, `add_cohort`, `remove_cohort`) plus `public.audit_logs` rows from every RPC. |

## Relationships

- `shared_lecture_groups.term_id` → `academic_terms(id, college_id)` (composite, RESTRICT).
- `shared_lecture_group_components.plan_course_component_id` → `plan_course_components(id, college_id)`. Delivery groups remain the per-cohort course representation; a shared group **references** them through their components and never replaces or merges them.
- `shared_lecture_group_cohorts.cohort_id` → `academic_cohorts(id, college_id)`. Membership is explicit; nothing is inferred.
- Capacity inputs: `scheduling_cohort_term_headcounts(cohort_id, term_id)` with `approval_status = 'approved'` (from the headcount foundation migration).

## The 15 rules → implementation points

1. **Each cohort's course stays independent** — the model only adds link tables; no `delivery_groups` / `plan_course_components` rows are mutated, merged, or deleted.
2. **Cohorts never merge academically** — memberships are scheduling links only; curricula, enrollments, and grades stay per cohort. No academic write path exists here.
3. **A group links multiple cohort courses** — `shared_lecture_group_components` links the components that back cohort delivery groups.
4. **One session appears for all participating cohorts** — deferred to A2.4 builder: one generated session fans out read-only to each cohort in `shared_lecture_group_cohorts`.
5. **Appears once for instructor and room** — A2.4: the builder emits a single instructor/room occupation for the group, not per cohort.
6. **Capacity = SUM of approved scheduling_headcount of explicitly participating cohorts** — `resolve_shared_lecture_group_capacity` sums `scheduling_headcount` over `shared_lecture_group_cohorts` joined to approved headcounts for the group term.
7. **No approved headcount → fail-closed** — `add_cohort_to_shared_lecture_group` blocks with `SHARED_GROUP_HEADCOUNT_MISSING`; `resolve_shared_lecture_group_capacity` returns blocker `SHARED_GROUP_HEADCOUNT_MISSING` (with `missing_cohorts`) or `SHARED_GROUP_NO_COHORTS`.
8. **Conflict check per participating cohort** — A2.4: conflict evaluation iterates every cohort in the membership table; the membership grain (group × cohort) is the input contract.
9. **Regular (منتظم) and parallel (موازي) do NOT merge by default** — `add_cohort_to_shared_lecture_group` compares `academic_cohorts.study_system` against existing members and rejects any mix with `STUDY_SYSTEM_MIX_REJECTED`.
10. **college_admin within own college** — all write RPCs require `can_manage_college(auth.uid(), group.college_id)` (college_admin + same college); RLS SELECT uses `can_view_college`.
11. **Cross-college merge is super_admin only** — `add_cohort_to_shared_lecture_group` returns `CROSS_COLLEGE_REQUIRES_SUPER_ADMIN` for non-super-admins. A2.1 keeps memberships structurally same-college via tenant-composite FKs and fails closed even for super_admin (`CROSS_COLLEGE_GROUP_NOT_SUPPORTED`); the super_admin cross-college path is designed in A2.2 (see Deferred).
12. **Theory may merge while labs stay separate** — linkage is at `plan_course_components` level, so only chosen components (e.g. theory) join a group.
13. **Removing a cohort does not delete its course** — `remove_cohort_from_shared_lecture_group` only `DELETE`s the membership row; delivery groups and courses are untouched.
14. **Full audit** — `shared_lecture_group_revisions` snapshots + `public.audit_logs` rows on every mutation, and an audit row on capacity resolution.
15. **Never use Sections (legacy)** — no reference to the legacy model anywhere; the static harness asserts its absence.

## RPC surface (SECURITY DEFINER, EXECUTE → authenticated + service_role only)

- `create_shared_lecture_group(college, term, name, notes)`
- `add_component_to_shared_lecture_group(group, component, notes)`
- `add_cohort_to_shared_lecture_group(group, cohort, notes)` — headcount fail-closed, study-system mix rejected, cross-college gated.
- `remove_cohort_from_shared_lecture_group(group, cohort, notes)` — membership-only delete.
- `resolve_shared_lecture_group_capacity(group)` — SUM of approved headcounts, fail-closed blockers.
- `list_shared_lecture_group_revisions(group)` — audit read.

Table writes are revoked from `authenticated`/`anon`/`PUBLIC`; `service_role` has ALL; RLS enabled on all four tables.

## Deferred / follow-ups

- **A2.2 — RPC/AuthZ/RLS hardening**: super_admin cross-college representation (a dedicated, separately reviewed link path that does not weaken tenant-composite FKs), group status transitions (`draft`→`active`→`archived`), removal of component links, runtime RLS/AuthZ tests against a live database.
- **A2.3 — UI**: shared group management screens (المجموعات المشتركة للمحاضرات), cohort/component pickers, capacity + blocker surfacing (`SHARED_GROUP_HEADCOUNT_MISSING`, `STUDY_SYSTEM_MIX_REJECTED`, `CROSS_COLLEGE_REQUIRES_SUPER_ADMIN`).
- **A2.4 — builder/conflicts/capacity/reports**: single-session fan-out to participating cohorts (rules 4–5), per-cohort conflict evaluation (rule 8), capacity enforcement in room assignment (rule 6), readiness/report integration.

## Validation performed

Static review only (no runtime in this environment): migration reviewed against the
20260721180000 conventions; `tests/harness/shared-lecture-groups.harness.ts` added and
registered in `tests/harness/run.mjs` but **not executed** here. Harness, typecheck, and
database apply remain for an environment with runtime access.
