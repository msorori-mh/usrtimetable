# STAGE-03B — Production Apply Runbook

Companion to `STAGE-03A-CONTROLLED-RECONCILIATION-PACKAGE.md`.
**Status:** READY FOR APPROVAL — do not execute until `REQUIRED_USER_APPROVALS` are signed.

Production: `emzytxqkxjjhsivqxdiu` · College ITCS `7168345f-cf9d-4789-b2ad-547abb687dc8`

Hard bans until explicitly lifted: no `db push` of unreviewed SQL, no history DELETE, no Legacy TA delete, no official schedule publish/replace, no invented headcounts.

---

## Global preflight (every step)

1. Confirm live `x-deployment-id` still matches intended release.
2. Confirm operator is `super_admin` / `can_manage_college` for ITCS.
3. Export before-counts JSON (cohorts, HC, offerings, DG, TA, templates).
4. Open a dated audit folder; record job IDs.
5. Stop on any unexpected count drift or RPC error.

---

## Step 1 — Source fixes merged and deployed

| Field | Value |
|---|---|
| Preflight | Diff main for readiness fail-closed, importer preview harness, scheduler input fail |
| Write set | application code only (separate PR); then Lovable/publish |
| Transaction | n/a |
| Expected | live fingerprints include fixes; harness green |
| Post-verify | `/data-readiness` + auto-schedule gate fail closed on forced query error |
| Rollback | redeploy previous deployment id |
| Stop | if publish fails or fingerprints missing |

---

## Step 2 — Migration / history reconciliation (optional)

| Field | Value |
|---|---|
| Preflight | Stage 02B history CSV (75 rows) present; object probes current |
| Write set | **history backfill only** for OBJECTS_PRESENT_HISTORY_MISSING (program/department, curriculum generator, capacity-split) if signed; never re-apply `20260721180000` |
| Transaction | single INSERT per missing version with exact name/statements evidence |
| Expected | history rows +N; objects unchanged |
| Post-verify | SELECT versions; `pg_proc`/`pg_trigger` unchanged md5 |
| Rollback | DELETE inserted history row under dual approval |
| Stop | if statements evidence incomplete |

`MUST_NOT_REAPPLY`: `20260721180000`
`NO_ACTION`: `20260724002013`/`…012` twin

---

## Step 3 — Headcounts

| Field | Value |
|---|---|
| Preflight | `OFFICIAL_COUNT_AVAILABLE > 0` under signed year policy; else **SKIP** |
| Write set | `upsert_scheduling_cohort_term_headcount` then `approve_scheduling_cohort_term_headcount` per cohort/term |
| Transaction | one cohort/term at a time (or documented batch job) |
| Expected | approved HC 5 → 64 |
| Post-verify | matrix query; each row has `source` non-empty |
| Rollback | revisions table / prior snapshot |
| Stop | if source file row cannot be cited |

Current package: **0 rows ready** → step is approval-gated no-op until sources arrive.

---

## Step 4 — Curriculum

| Field | Value |
|---|---|
| Preflight | offerings already 64/64 cells; run only on plan change |
| Write set | `generate_cohort_curriculum(p_cohort_id)` |
| Expected | offerings stable or intentional delta |
| Post-verify | no summer_training timetabled; project 0h excluded |
| Rollback | not destructive; restore from plan re-import if needed |
| Stop | unexpected offering drop |

`CURRICULUM_BATCH_COUNT` mandatory = 0.

---

## Step 5 — Delivery groups

| Field | Value |
|---|---|
| Preflight | approved HC for cohort; room types non-null for timetabled components; `resolve_scheduling_headcount` OK |
| Write set | `generate_cohort_delivery_groups(p_cohort_id)` × 48 |
| Expected | cells with DG 16 → 64; group count increases idempotently on rerun |
| Post-verify | same college; study_system isolation; no Legacy section rows created |
| Rollback | mark obsolete / documented inverse; no blind DELETE |
| Stop | any cohort fails room-type or headcount preflight |

---

## Step 6 — Time templates

| Field | Value |
|---|---|
| Preflight | list exact duplicate pair ids; sessions still 0 |
| Write set | deactivate 1 exact duplicate (keep canonical) after approval |
| Expected | exact duplicate pairs 1 → 0 |
| Post-verify | 67→66 active (or documented keep-both exception) |
| Rollback | reactivate |
| Stop | if any session references template |

Intentional overlaps: **retain** unless operator marks INVALID.

---

## Step 7 — Teaching assignments import

| Field | Value |
|---|---|
| Preflight | dry preview READY>0; Legacy count frozen 174; DG present for target cells |
| Write set | `commit_import_job_atomic` / `commit_teaching_assignments_v2_import` mode `insert_only` |
| Expected | V2 rows >0; Legacy 174 unchanged; excess Legacy dups unchanged |
| Post-verify | idempotent replay; zero silent overwrite; job id stored |
| Rollback | job-scoped archive / compensating import |
| Stop | any CO_TEACHING_HOURS_OVER_ALLOCATED or unexplained BLOCKED |

Source file: `b002982d-763d-4aa7-a7f3-fed38fca4da9.xlsx`.

---

## Step 8 — Readiness verification

| Field | Value |
|---|---|
| Preflight | steps 3–7 complete for pilot scope |
| Write set | none (read-only matrix) |
| Expected | READY cells ≥ agreed pilot N; 0 unexplained INVALID for pilot |
| Post-verify | auto-schedule gate enables only when critical gaps = 0 |
| Rollback | n/a |
| Stop | READY=0 after writes |

---

## Step 9 — Experimental schedule

| Field | Value |
|---|---|
| Preflight | READY pilot; no official version |
| Write set | create experimental `schedule_versions` + auto-schedule run |
| Expected | sessions >0 experimental only |
| Post-verify | conflicts reviewed; quality run stored |
| Rollback | archive/delete experimental version |
| Stop | hard conflicts unapproved |

---

## Step 10 — RBAC / RLS

| Field | Value |
|---|---|
| Preflight | accounts for super_admin, college_admin, read_only, anon |
| Write set | none |
| Expected | direct `schedule_versions.status` update denied; RPC transition enforced; cross-college denied |
| Post-verify | negative matrix recorded |
| Rollback | n/a |
| Stop | any bypass succeeds |

---

## Step 11 — Launch

| Field | Value |
|---|---|
| Preflight | steps 1–10 green; release lead approval |
| Write set | publish via `transition_schedule_version` only |
| Expected | published version; UI read-only |
| Post-verify | no second official; RLS holds |
| Rollback | lifecycle transition to previous status if supported; else incident process |
| Stop | quality/conflict gates fail |

---

## RELEASE_GATES checklist

- [ ] Approvals 1–8 from Stage 03A signed
- [ ] Headcount sources year-authorized
- [ ] Room types 233 cleared
- [ ] DG 48 generated with post-verify
- [ ] TA V2 imported; Legacy untouched
- [ ] READY pilot agreed
- [ ] RBAC negatives recorded
- [ ] Publish is a separate explicit gate

---

## PRODUCTION_WRITES_PLANNED / MIGRATIONS_PLANNED

| Kind | Planned in Stage 03B after approval | Now |
|---|---|---|
| Production data writes | headcounts, DG generate, TA V2 import, template deactivate, experimental schedule | **not executed** |
| Migrations DDL | deferred source packs only if signed | **not executed** |
| History backfill | optional documentation repair | **not executed** |
