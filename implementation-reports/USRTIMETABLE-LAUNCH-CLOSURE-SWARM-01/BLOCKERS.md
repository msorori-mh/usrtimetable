# BLOCKERS — USRTIMETABLE-LAUNCH-CLOSURE-SWARM-01

| Blocker | Blocking | Unblocked by |
|---|---|---|
| LEGACY_ORPHAN_CLASSIFICATION (relationship unknown; V1 rejected) | Legacy data remediation, A1.3c apply, A2 | User runs PHASE-A1-LEGACY-RELATIONSHIP-SCHEMA-MAP (read-only) and returns results |
| LEGACY_DATA_REMEDIATION (174 TA + 5 COS) | A1.3c migration 20260721090000, test-data cleanup | APPROVE_LEGACY_DATA_REMEDIATION + completed schema map |
| MIGRATION_APPLY (6 source-only migrations) | Headcount production, A2 | APPROVE_DB_MIGRATION_APPLY + remote preflight evidence |
| Final-main post-merge gates unverified | Any production-readiness claim | USER_RUNS_FINAL_MAIN_GATES via USRTIMETABLE-FINAL-MAIN-91B5F65-LOCAL-GATES.zip |
| A2 shared groups | — | Headcount migration applied + approved cohort headcounts inserted |
| Real data import / pilot / deploy | Launch | APPROVE_REAL_DATA_IMPORT / APPROVE_PILOT_EXECUTION / APPROVE_DEPLOY_PUBLISH |

Open question for user: gates target SHA — 91b5f65 (user-confirmed) vs 6c4401bb (current origin/main after drift).
