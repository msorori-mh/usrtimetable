# PLAN — USRTIMETABLE-LAUNCH-CLOSURE-SWARM-01

Current phase: PHASE_A1_POSTMERGE_VERIFICATION_AND_LEGACY_SCHEMA_MAP
Next safe action: PREPARE_FINAL_MAIN_GATES_AND_LEGACY_RELATIONSHIP_SCHEMA_MAP

## Track 1 — Final main post-merge gates
- Agent cannot run gates (no clone access to private repo / no bun toolchain). No PASS claimed.
- Deliverable: USRTIMETABLE-FINAL-MAIN-91B5F65-LOCAL-GATES.zip (RUN-FINAL-MAIN-GATES.ps1 + INSTRUCTIONS.md + EXPECTED-RESULTS.md + GATE-MANIFEST.json + RESULTS-TEMPLATE.json).
- Runs on Windows from C:\projects\usrtimetable-mainline, clean worktree, results to C:\projects\usrtimetable-final-main-gates-results. No commit/push/merge.
- Awaits: USER_RUNS_FINAL_MAIN_GATES.

## Track 2 — Legacy relationship schema map (read-only)
- Deliverable: PHASE-A1-LEGACY-RELATIONSHIP-SCHEMA-MAP-READONLY.sql + LOVABLE-EXEC.txt + COMBINED.txt.
- SELECT/WITH SELECT only. No DML/DDL, no dynamic SQL, no temp objects, no RPC/UDF, no unproven columns (delivery_groups.course_offering_id banned).
- Output feeds relationship classification: PROVEN_BY_FK / PROVEN_BY_UNIQUE_KEY / SOURCE_ONLY_NOT_IN_PRODUCTION / NO_PROVEN_RELATION / UNKNOWN.
- Awaits: USER_RUNS_LEGACY_RELATIONSHIP_SCHEMA_MAP.

## Track 3 — Headcount dependency map
- Deliverable: SCHEDULING-HEADCOUNT-PRODUCTION-DEPENDENCY-MAP.md (in this folder).
- Order: 20260717050000 -> 20260720143000 (if confirmed) -> 20260721180000 -> approved headcounts -> A2.
- 20260721090000 gated by Legacy remediation; not now.

## Stop conditions
USER_RUNS_FINAL_MAIN_GATES, USER_RUNS_LEGACY_RELATIONSHIP_SCHEMA_MAP, APPROVE_LEGACY_DATA_REMEDIATION, APPROVE_DB_MIGRATION_APPLY.
