# PLATFORM-PR95-MERGE-PUBLISH-LIVE-CLOSURE-01 — FINAL REPORT

## Decision

**HOLD_WITH_ONE_EXACT_UNRESOLVABLE_BLOCKER**

Exact blocker:

`B-LOVABLE-PUBLISH-UNAVAILABLE` — PR #95 is merged and `runtime-gates` on `main` is green, but the agent browser has no Lovable project session (`You don't have access` → Google OAuth). Live remains pre-PR#95 deployment `71b93a56…` (`LIVE_HAS_PR95_MARKERS=false`) while `MAIN_SHA=ee1f9e25…`. Live Import V2 preview of the real workbook therefore cannot be closed on the published PR#95 UI; under the admin API session, `IMPORT_READY_ROWS=0` after official CS/CIS/IT plan load (scoped course/level/term mismatches + non-inventable program aliases).

## Identifiers

| Field | Value |
|---|---|
| Mission | `PLATFORM-PR95-MERGE-PUBLISH-LIVE-CLOSURE-01` |
| PR95_STATE | `MERGED` |
| PR95_MERGE_COMMIT | `26fa5121667e19dc20544e197ef2b17d6d74cdb4` |
| MAIN_SHA | `ee1f9e25c6f1dd8d224d7333f8f3e90ccdfc96ff` |
| LIVE_SHA | `71b93a56c607f018aaa88654429307e5b24593cade6b2027ca026142c78d459c` |
| runtime-gates (main) | PASS `30308698816` |

## Metrics

| Metric | Value |
|---|---|
| PR95_STATE | MERGED |
| PR95_MERGE_COMMIT | `26fa5121667e19dc20544e197ef2b17d6d74cdb4` |
| MAIN_SHA | `ee1f9e25c6f1dd8d224d7333f8f3e90ccdfc96ff` |
| LIVE_SHA | `71b93a56c607f018aaa88654429307e5b24593cade6b2027ca026142c78d459c` |
| IMPORT_SOURCE_ROWS | 131 |
| IMPORT_READY_ROWS | 0 |
| IMPORTED_ASSIGNMENTS | 0 |
| BLOCKED_ROWS | 252 (expanded outcomes; see hist) |
| READINESS_RESULT | NOT_CLOSED |
| SCHEDULE_VERSION | NOT_CREATED |
| SCHEDULED_SESSIONS | NOT_RUN |
| UNSCHEDULED_SESSIONS | NOT_RUN |
| CONFLICT_RESULTS | NOT_RUN |
| QUALITY_RESULT | NOT_RUN |
| FINAL_DECISION | HOLD_WITH_ONE_EXACT_UNRESOLVABLE_BLOCKER |

### Import preview histogram (admin session, post catalog load)

- `ERROR:course_not_found` 164 (program/level/term scoped)
- `ERROR:unknown_program` 19 (campus aliases — not inventable)
- `AMBIGUOUS:ambiguous_component` 24 / `ambiguous_instructor` 17
- `BLOCKED:delivery_groups` 22
- matched / READY: 0

## What completed

| Step | Result |
|---|---|
| PR #95 state | Already MERGED (merge commit `26fa512`) |
| main sync + whitespace fix for gates | `ee1f9e2`; gates PASS |
| Lovable Publish | BLOCKED — no agent Lovable auth |
| Live fingerprint vs MAIN | FAIL |
| Admin session | Valid (`msorori201201@gmail.com` / super_admin) |
| Official CS/CIS/IT `full_study_plan` upsert | 144 rows committed; levels 16; plans 4; components 308 |
| Cohorts + curriculum + DGs | 64 cohorts; 181 delivery_groups |
| TA V2 preview (real workbook) | SOURCE 131 / READY 0 |
| Schedule E2E | NOT_RUN (no READY import) |

## Security Review

| Item | Value |
|---|---|
| Files changed | FINAL-REPORT / FINAL-OPERATIONAL-RUNLOG only (docs) |
| Migrations changed? | no |
| RLS / RPCs changed? | no |
| Authentication impact | no |
| Authorization impact | no |
| Sensitive data exposure | no |
| Privilege escalation risk | no |
| Production risk | low — catalog/cohort operational writes under super_admin; no official schedule publish; no migrations |
| Ready for merge | PR #95 already merged |
| Ready for deploy | code ready; Lovable publish blocked |

## Verification

- Source/CI: PASS on `ee1f9e2`
- Live publish: FAIL match to MAIN
- Import READY: 0

## Migration status

None.

## Production impact

- Operational DB writes: CS/CIS/IT study plans, levels, plan courses/components, additional cohorts, delivery groups.
- No official schedule published/replaced.
- No deletions of official data.
- Temp `_tmp-*` scripts not committed.

## Remaining risks

Until Lovable Publish succeeds for current `main`, live UI lacks PR #95. Until course/level/term name matches (or confirmed aliases) yield READY rows, Import V2 + experimental schedule cannot close.

## Recommended next step

1. Publish once from authenticated Lovable project `c14ffafc-2bc4-44f0-aef6-c8785e7ca67b` for `main` `ee1f9e2` (no migrations).
2. Confirm live markers / new `x-deployment-id`.
3. Resume Import V2 with confirmed course aliases only — do not invent campus program labels.
