# SCHEDULING HEADCOUNT — PRODUCTION DEPENDENCY MAP

Source: review of supabase/migrations/20260721180000_source_only_scheduling_headcount_foundation.sql (source-only, NOT APPLIED) and its prerequisite chain. Review only — nothing executed.

## 1. What 20260721180000 creates

- Tables: `scheduling_cohort_term_headcounts` (UNIQUE (cohort_id, term_id); composite FKs (cohort_id, college_id) -> academic_cohorts(id, college_id) and (term_id, college_id) -> academic_terms(id, college_id)), `scheduling_headcount_overrides` (partial unique index on active grain), `scheduling_headcount_revisions` (audit).
- Triggers: updated_at via existing `public.set_updated_at()`.
- RLS: enabled on all 3 tables; policies via existing `public.can_view_college` / `public.can_manage_college`; writes revoked from authenticated/anon/PUBLIC; service_role full.
- RPCs (SECURITY DEFINER, EXECUTE granted to authenticated + service_role only): upsert_scheduling_cohort_term_headcount, approve_scheduling_cohort_term_headcount, upsert_scheduling_headcount_override, archive_scheduling_headcount_override, resolve_scheduling_headcount, list_scheduling_headcount_revisions. Writes audit rows into existing `public.audit_logs`.
- Fail-closed: `resolve_scheduling_headcount` returns blocker SCHEDULING_HEADCOUNT_MISSING when no approved headcount exists; no legacy expected-student fallback.

## 2. Dependency map

| # | Dependency | Reason | Required unique keys | Data prerequisite | Apply blocker | Verifier | Rollback consideration |
|---|---|---|---|---|---|---|---|
| 1 | 20260717050000_source_only_harden_cross_college_references.sql | Headcount uses composite FKs (cohort_id, college_id) and (term_id, college_id) | UNIQUE(id, college_id) on academic_cohorts and academic_terms (constraint names academic_cohorts_id_college_key, academic_terms_id_college_key), created by 20260717050000 | Its preflight must pass: no orphan/cross-college rows among the 21 reference mappings (incl. delivery_groups, teaching_assignments, schedule_sessions) | APPROVE_DB_MIGRATION_APPLY + remote preflight evidence | Remote check: pg_constraint shows validated composite FKs + the UNIQUE keys exist | Composite FKs + unique keys must be dropped in reverse dependency order; 20260721180000 objects depend on them |
| 2 | Existing helpers: set_updated_at(), can_view_college(), can_manage_college(), audit_logs, colleges, auth.users | Referenced by triggers, RLS policies, RPCs, audit inserts | n/a | None (already in production schema per current runtime) | None beyond gate | to_regclass / pg_proc lookups before apply | n/a (pre-existing) |
| 3 | course_offerings, plan_course_components | Override targets (nullable FKs, ON DELETE RESTRICT) | n/a | None — overrides optional | None beyond gate | Post-apply: insert-path smoke via RPC in draft status | Dropping the three headcount tables drops these FKs |
| 4 | 20260720143000_source_only_program_department_integrity.sql | Independent (academic_programs FKs + ensure_prog_college trigger); apply when its need and ordering are confirmed; production has 0 academic_programs so it is low-risk but still gated | n/a | None | APPROVE_DB_MIGRATION_APPLY | Remote constraint/trigger existence check | Drop trigger/function, restore prior FK definitions |
| 5 | Approved cohort headcount data entry | A2 and generation consume resolve_scheduling_headcount; missing approved rows = hard blocker by design | UNIQUE (cohort_id, term_id) | Real approved numbers per cohort/term from the college; entered via upsert RPC then approve RPC (source required; over-eligible requires notes) | After migration apply only; no invented headcounts | Count of approved rows vs expected cohorts for college 7168345f-cf9d-4789-b2ad-547abb687dc8 | archive/re-upsert path via revisions; data, not schema |

## 3. Expected apply order (verification of ordering only — nothing executed)

1. 20260717050000 — composite keys + tenant FKs (must be first).
2. 20260720143000 — when its need and ordering are confirmed (independent of headcount; safe either side of 20260721180000, but recommended before it to keep one reviewed apply batch).
3. 20260721180000 — headcount foundation (after 1).
4. Insert approved cohort headcounts (data step, via RPCs, after apply).
5. Then A2 (shared groups SUM scheduling_headcount for explicitly participating cohorts).

Note: 20260718183000 and 20260720120000 are also NOT APPLIED; they are independent of the headcount chain but belong to the same APPROVE_DB_MIGRATION_APPLY decision batch — confirm their ordering in the same review.

## 4. Explicitly gated — do NOT apply now

- 20260721090000_source_only_legacy_write_hardening.sql (A1.3c): conditional on Legacy data remediation (A1.3b) completing first — apply order is strictly A1.3b -> A1.3c. Legacy remediation itself is blocked on the read-only relationship schema map + APPROVE_LEGACY_DATA_REMEDIATION.

## 5. Global constraints

No DB writes, no migration apply, no backfill/cleanup, no touching the 174 TA / 5 COS rows, no A2 start, no real import, no deploy/publish. Every apply requires APPROVE_DB_MIGRATION_APPLY and post-apply remote verification evidence.
