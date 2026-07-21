# DECISIONS — USRTIMETABLE-LAUNCH-CLOSURE-SWARM-01

## D-001 — Production facts source
Adopt Lovable `PASS_WITH_FINDINGS — PHASE_A1_PRODUCTION_READONLY_VERIFIED` as confirmed production facts. Do not invent live counts.

## D-002 — A1 source closure order
Merge PR #60 (legacy write blocking) before PR #61 (reports remediation). After #60, merge `origin/main` into #61 with merge commit (no rebase).

## D-003 — A1 status semantics
After source merges + post-merge gates: `A1_SOURCE_COMPLETE` + `A1_PRODUCTION_REMEDIATION_PENDING`. Do not declare production A1 closed.

## D-004 — Legacy data remediation gate
Classification package is read-only. Stop at `APPROVE_LEGACY_DATA_REMEDIATION`. No writes to 174 TA / 5 COS.

## D-005 — Scheduling headcount before A2
A2 must not start until scheduling headcount source foundation is complete and quality gates pass. Migration remains NOT APPLIED until `APPROVE_DB_MIGRATION_APPLY`.

## D-006 — Headcount authority
Scheduling uses approved `scheduling_headcount` per cohort×term (with optional offering/component override). Never silent fallback to registered student totals or university-wide ratios.
