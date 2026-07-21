# BLOCKERS — USRTIMETABLE-LAUNCH-CLOSURE-SWARM-01

## Active

| Blocker | Status | Resolution path |
|---------|--------|-----------------|
| B-CLASSIFICATION-V1-SCHEMA — classification package assumed `delivery_groups.course_offering_id` (absent in Production); run FAILED 2026-07-21 | ACTIVE | Run `PHASE-A1-LEGACY-RELATIONSHIP-SCHEMA-MAP-01` (read-only) → design Classification V2 on proven paths only (DESIGN HOLD until then) |
| B-FINAL-MAIN-GATES — no returned, independent runtime-gate evidence on final main (post PR #62 + tooling commit 6c4401bb) | ACTIVE | Operator runs `USRTIMETABLE-FINAL-MAIN-91B5F65-LOCAL-GATES.zip`, returns results dir with `results.json` |
| B-09.2 CAPACITY_SPLIT_BALANCE | OPEN (external) | feeds headcount consumption design |

## Pending approvals (not blockers for source work)

| Gate | Status |
|------|--------|
| APPROVE_LEGACY_DATA_REMEDIATION | WAITING (Classification V2 first; V1 package failed, do not rerun) |
| APPROVE_DB_MIGRATION_APPLY | WAITING (order: 20260717050000 → 20260721180000; 20260720143000 any order; 20260721090000 only after A1.3b) |

## Hard stops (must never bypass)

- Any production DB write / DML / backfill / cleanup
- Migration apply on Production
- Deploy / Publish
- Start A2 before headcount source applied + approved data entered
- Force-push / rebase / delete branch or worktree
- Declaring A1 production-closed before approval gates
- Rerunning the failed V1 classification package, or writing Classification V2 SQL before schema-map results
