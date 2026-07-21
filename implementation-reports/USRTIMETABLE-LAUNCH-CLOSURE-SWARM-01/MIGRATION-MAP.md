# MIGRATION MAP — USRTIMETABLE-LAUNCH-CLOSURE-SWARM-01

Rule: no migration counts as applied without remote evidence.

## Source-only, NOT APPLIED (confirmed in repo, unconfirmed remotely)

| Migration | Purpose | Apply status |
|---|---|---|
| 20260717050000_source_only_harden_cross_college_references.sql | Composite UNIQUE(id, college_id) + tenant FKs (21 mappings) | NOT APPLIED — prerequisite for headcount |
| 20260718183000_forward_harden_cohort_curriculum_runtime.sql | Cohort-curriculum runtime hardening | NOT APPLIED |
| 20260720120000_source_only_availability_all_active_days.sql | Availability all-active-days | NOT APPLIED |
| 20260720143000_source_only_program_department_integrity.sql | academic_programs FKs ON DELETE RESTRICT + ensure_prog_college trigger | NOT APPLIED — apply when need/order confirmed |
| 20260721090000_source_only_legacy_write_hardening.sql | Legacy write-blocking triggers + REVOKE (A1.3c) | NOT APPLIED — conditional on A1.3b remediation first |
| 20260721180000_source_only_scheduling_headcount_foundation.sql | Headcount tables/RPC/RLS/audit | NOT APPLIED — needs 20260717050000 first |

## Expected apply order (no execution without APPROVE_DB_MIGRATION_APPLY)

1. 20260717050000
2. 20260720143000 (when its need and ordering are confirmed)
3. 20260721180000
4. Insert approved cohort headcounts
5. Then A2

See SCHEDULING-HEADCOUNT-PRODUCTION-DEPENDENCY-MAP.md for full dependency detail.
