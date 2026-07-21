# plan.md — PHASE-A1-SOURCE-CLOSURE-LEGACY-CLASSIFICATION-AND-SCHEDULING-HEADCOUNT-FOUNDATION-01

1. **G0** — Reconcile origin/main, PR #60/#61, rebuild swarm control files.
2. **Track 1** — Review/test/merge PR #60 (no migration apply).
3. **Track 2** — Merge origin/main into PR #61 (merge, not rebase); review/test/merge #61.
4. **Track 3** — Post-merge verification on clean origin/main → `A1_SOURCE_COMPLETE` + `A1_PRODUCTION_REMEDIATION_PENDING`.
5. **Track 4** — Read-only legacy orphan classification package → stop at `APPROVE_LEGACY_DATA_REMEDIATION`.
6. **Track 5** — Scheduling headcount source foundation (model/RPC/UI/integration/tests) → Draft PR → merge source only → `SCHEDULING_HEADCOUNT_PRODUCTION = WAITING_APPROVE_DB_MIGRATION_APPLY`.
7. **Stop** — No A2, no DB writes, no migration apply, no deploy/publish.
