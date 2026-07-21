# BLOCKERS — USRTIMETABLE-LAUNCH-CLOSURE-SWARM-01

## Active

None blocking Track 1 start (PR #60 MERGEABLE CLEAN).

## Pending approvals (not blockers for source work)

| Gate | Status |
|------|--------|
| APPROVE_LEGACY_DATA_REMEDIATION | WAITING (after Track 4 package) |
| APPROVE_DB_MIGRATION_APPLY | WAITING (headcount + prior source migrations) |

## Hard stops (must never bypass)

- Any production DB write / DML / backfill / cleanup
- Migration apply on Production
- Deploy / Publish
- Start A2 before headcount source complete
- Force-push / rebase / delete branch or worktree
- Declaring A1 production-closed before approval gates
