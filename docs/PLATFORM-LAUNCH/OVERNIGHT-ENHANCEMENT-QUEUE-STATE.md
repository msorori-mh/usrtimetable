# Overnight Enhancement Queue State

Mission: `USRTIMETABLE-OVERNIGHT-ENHANCEMENT-QUEUE-02`  
Updated: 2026-07-31  
Protected version: `835e50fe-3ad2-4232-8c15-0f403c668a7f`  
Start main: `d60cfd5b554e28e6ac258c47b1824d5d6e410626` (post Phase 2; Q0.1–Q0.2 already merged)

## QUEUE 0 — Release Train resume

### Q0.1 TIMETABLE-PRINT-EXPORT-CENTER-01

| Field | Value |
| --- | --- |
| Status | COMPLETE_MERGED_PUBLISHED |
| Branch | `feat/timetable-print-export-center-01` |
| PR | https://github.com/msorori-mh/usrtimetable/pull/127 |
| HEAD | `17223e14ea321406d8278a698ddd13530cd1e311` |
| Tests | PASS (prior train) |
| CI | PASS |
| Merge | `1b6dc48cfcef3b6426b71b07e20d19a568fe6276` |
| Deployment ID | `41841b701846c8b46ff251e6509f7c5249f076bdd6b52873ca2f72e1024e2905` |
| Blocker | none |
| Next | closed |

### Q0.2 DATA-ONBOARDING-READINESS-WIZARD-01

| Field | Value |
| --- | --- |
| Status | COMPLETE_MERGED_PUBLISHED |
| Branch | `feat/data-onboarding-readiness-wizard-01` |
| PR | https://github.com/msorori-mh/usrtimetable/pull/128 |
| HEAD | `57a45287d7429fab16e8115ea4cbf6d3881aedac` |
| Tests | PASS (prior train) |
| CI | PASS |
| Merge | `d60cfd5b554e28e6ac258c47b1824d5d6e410626` |
| Deployment ID | `3ebe732a1aa1ef7c9be9bab9d9352a975b21990f7fa6a88af05f65824e36cc97` |
| Blocker | none |
| Next | closed |

### Q0.3 DEMO-OPERATIONAL-DATA-SEPARATION-01

| Field | Value |
| --- | --- |
| Status | SOURCE_READY_WAITING_FOR_EXPLICIT_MIGRATION_APPROVAL |
| Branch | `feat/demo-operational-data-separation-01` |
| PR | https://github.com/msorori-mh/usrtimetable/pull/129 |
| HEAD | `12a5c2b1d23535b1010ee5d2bd8723487fcb1554` |
| Tests | PASS |
| CI | PASS |
| Merge | NOT_MERGED |
| Deployment ID | NOT_PUBLISHED |
| Schema change | YES |
| Migration | `supabase/migrations/20260731120000_source_only_data_classification.sql` |
| SHA256 | `7597BAD8DD3FA07CC83E80A07AAE835DBAA9AA9EDD0FCF8687D64FE60AD1764B` |
| Apply package | `docs/PLATFORM-LAUNCH/apply-packages/DATA-CLASSIFICATION-APPLY.md` |
| Blocker | Explicit `APPROVE_DB_MIGRATION_APPLY` required |
| Next | Continue QUEUE 1 from `origin/main` without depending on unmerged Phase 3 |

## QUEUE 1 — in progress

See updates below as packages complete.
