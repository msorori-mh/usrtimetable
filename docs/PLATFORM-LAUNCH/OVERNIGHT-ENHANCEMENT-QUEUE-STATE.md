# Overnight Enhancement Queue State

Mission: `USRTIMETABLE-OVERNIGHT-ENHANCEMENT-QUEUE-02`
Updated: 2026-07-31
Protected version: `835e50fe-3ad2-4232-8c15-0f403c668a7f`
START_MAIN_SHA: `d60cfd5b554e28e6ac258c47b1824d5d6e410626`
END_MAIN_SHA (deployed track): `29a86f2af02d2854202f8bf395e7cb9cc1f3ad4a`

## QUEUE 0

| Package              | Status            | PR   | Merge   | Deploy    | Blocker                    |
| -------------------- | ----------------- | ---- | ------- | --------- | -------------------------- |
| Print/Export         | COMPLETE          | #127 | 1b6dc48 | 41841b70… | none                       |
| Onboarding/Readiness | COMPLETE          | #128 | d60cfd5 | 3ebe732a… | none                       |
| Demo/Operational     | WAITING_MIGRATION | #129 | NOT     | NOT       | APPROVE_DB_MIGRATION_APPLY |

## QUEUE 1 Quality Analytics

COMPLETE_MERGED_PUBLISHED — PR #130 — merge 29a86f2 — deploy 44044641… — live YES

## QUEUE 2 Version Comparison

PR_READY_CI_GREEN — PR #131 — NOT merged (no two live versions / no production clone)

## QUEUE 3 Smart Suggestions

PR_READY_CI_GREEN — PR #132 — NOT merged (overnight leave Ready; preview-only)

## QUEUE 4 Drag-Drop Safety Undo

PR_READY_CI_GREEN — PR #133 — NOT merged
DRAG_DROP_UNDO_STATUS=READY_CI_GREEN_PENDING_CONTROLLED_LIVE_WRITE_REVIEW
DRAG_DROP_UNDO_PR=133
Blocker: CONTROLLED_LIVE_DRAG_DROP_WRITE_TEST_REQUIRES_OWNER_APPROVAL
No Publish · No live write test · JSX parse failure RESOLVED · unit 5/5 · runtime-gates PASS

## QUEUE 5 Advanced Reports

PR_READY_CI_GREEN — PR #134 — based on origin/main (29a86f2), NOT on #133 — NOT merged (catalog only)

## QUEUE 6 Student/Instructor Portal

PR_IN_PROGRESS — feat/student-instructor-portal-foundation-01 — source foundation only · no role migration · no production accounts

## QUEUE 7 System Health Backup

PR_READY_CI_GREEN — PR #135 — NOT merged (read-only health + runbook; no backup execution)
