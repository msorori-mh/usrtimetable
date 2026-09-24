# APPROVAL GATES — USRTIMETABLE-LAUNCH-CLOSURE-SWARM-01

All gates are EXPLICIT user approvals. The swarm never self-approves.

| Gate | Status | Scope when approved |
|---|---|---|
| APPROVE_LEGACY_DATA_REMEDIATION | PENDING | A1.3b execution: backup (zz_backup_a1_3b_*_20260721), dry-run, then remediation of 174 TA + 5 COS per exact-IDs manifest |
| APPROVE_DB_MIGRATION_APPLY | PENDING | Applying source-only migrations in the approved order (20260717050000 -> 20260720143000 if confirmed -> 20260721180000); 20260721090000 only after Legacy remediation |
| APPROVE_TEST_DATA_CLEANUP | PENDING | Removal of confirmed test/generated data after classification |
| APPROVE_REAL_DATA_IMPORT | PENDING | Import of real academic data |
| APPROVE_PILOT_EXECUTION | PENDING | Pilot run |
| APPROVE_DEPLOY_PUBLISH | PENDING | Deploy/publish |

Automation stop conditions: USER_RUNS_FINAL_MAIN_GATES, USER_RUNS_LEGACY_RELATIONSHIP_SCHEMA_MAP, APPROVE_LEGACY_DATA_REMEDIATION, APPROVE_DB_MIGRATION_APPLY.
