# plan.md — USRTIMETABLE-LAUNCH-CLOSURE-SWARM-01

## PHASE-A1-SOURCE-CLOSURE-LEGACY-CLASSIFICATION-AND-SCHEDULING-HEADCOUNT-FOUNDATION-01 — COMPLETE

1. ~~G0 — reconcile~~
2. ~~Track 1 — PR #60 merged~~
3. ~~Track 2 — PR #61 merged~~
4. ~~Track 3 — post-merge verification (A1_SOURCE_COMPLETE)~~
5. ~~Track 4 — classification package~~ → **later FAILED in Production (false column assumption)**
6. ~~Track 5 — headcount foundation (PR #62 merged, source-only)~~

## PHASE-A1-POSTMERGE-GATES-AND-LEGACY-SCHEMA-MAP-RECOVERY-01 — CURRENT

1. **G0** — canonical state reconcile @ `6c4401bb`. ✅
2. **Track 1** — final-main local runtime gates ZIP → stop at `USER_RUNS_FINAL_MAIN_GATES`. ✅ prepared, awaiting operator run.
3. **Track 2** — Legacy relationship schema-map package (read-only) → stop at `USER_RUNS_LEGACY_RELATIONSHIP_SCHEMA_MAP`. ✅ prepared, awaiting Lovable run.
4. **Track 3** — Classification V2 DESIGN HOLD (no SQL until schema-map results). ✅ documented.
5. **Track 4** — headcount production dependency map. ✅ delivered.
6. **Next** — after results return: Classification V2 SQL (proven paths only) → remediation under APPROVE_LEGACY_DATA_REMEDIATION → migration apply sequencing under APPROVE_DB_MIGRATION_APPLY (20260717050000 → 20260721180000).
7. **Stop** — No A2, no DB writes, no migration apply, no deploy/publish.
