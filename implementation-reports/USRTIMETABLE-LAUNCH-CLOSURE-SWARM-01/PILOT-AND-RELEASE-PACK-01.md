# PILOT AND RELEASE PACK 01 — USRTIMETABLE-LAUNCH-CLOSURE-SWARM-01 (TRACK 10)

**Status:** `PREPARATION_ONLY — NO EXECUTION`
**Produced by:** WAVE-03 AGENT-DATA-PILOT-RELEASE (docs-only, no runtime, no DB access)
**Base:** origin/main @ `b6a5a491f9f70f1cfba5dc5696fb33f64dbcee6b`

**Absolute non-actions:** no pilot execution, no deploy/publish, no import, no migration
apply, no DB writes. Everything executable here is gated (§10 and `APPROVAL-GATES.md`).

**Grounding artifacts:** `DATA-PREPARATION-PACK-01.md` (TRACK 9, same branch),
`MIGRATION-MAP.md`, `APPROVAL-GATES.md`,
`implementation-reports/IMPORT-TEMPLATES-FINAL-COMPATIBILITY-AUDIT-AND-REMEDIATION-01.md`,
`docs/IMPORT-ORDER-AND-DEPENDENCIES.md`, plus agent docs: `SCHEDULE-VERSION-LIFECYCLE-AGENT.md`,
`CONFLICT-AND-EXCEPTION-REPORTING-AGENT.md`, `DRAFT-LECTURER-REPORT-AGENT.md`,
`AVAILABILITY-ALL-ACTIVE-DAYS-BULK-ENTRY-01.md`,
`SCHEDULING-HEADCOUNT-PRODUCTION-DEPENDENCY-MAP.md`.

---

## 1. Pilot scope (deliberately minimal)

| Dimension | Pilot value | Notes |
|---|---|---|
| College | `7168345f-cf9d-4789-b2ad-547abb687dc8` | CONFIRMED pilot college id. All pilot data is college-scoped to this tenant. |
| Department | exactly 1 | Specific department TBD at gate review (UI foundation, not importable). |
| Program | exactly 1 | TBD at gate review. NOTE: `academic_programs` = 0 today — the pilot program must be created via UI foundation before any plan import. |
| Term | exactly 1 | One `academic_terms` row; `is_active` for the pilot term only. |
| Cohorts | 1–2 | `academic_cohorts` (V2); `study_system` ∈ {regular, parallel}. |
| Shared course | exactly 1 | Via `course_programs` (shared-course linkage) to exercise cross-program logic. |
| Headcount | approved values only | Inserted via headcount flow AFTER migration `20260721180000` is applied; `count_status` progression estimated → confirmed → locked. |
| Rooms | limited set | Only the rooms the pilot timetable needs (lecture hall + lab as required by the plan). |
| Instructors | limited set | Only instructors assigned in pilot TA V2 rows. |

Out of pilot scope: Legacy entities (sections, course_offerings, TA V1, section_groups),
evening/distance/other study systems, multi-college operation, schedule publish beyond the
pilot college.

## 2. Prerequisites (hard blockers before the pilot gate can even be reviewed)

1. **Migrations applied with remote evidence** (per MIGRATION-MAP expected order; gate
   `APPROVE_DB_MIGRATION_APPLY`):
   `20260717050000` → (`20260720143000` when confirmed) → `20260721180000` → approved cohort
   headcounts. Legacy hardening `20260721090000` is on the legacy-remediation chain, not the
   pilot chain, but must not be bypassed in the overall plan.
2. **Production data ready** (gate `APPROVE_REAL_DATA_IMPORT`): pilot-scope real data imported
   and verified per `DATA-PREPARATION-PACK-01.md` §6; preview error count = 0 for every file.
3. **Legacy safety**: the 174 TA V1 + 5 COS orphans remain untouched and unread by New Flow
   (no New Flow uses `section_id`; `section_id = 0` semantics reconciled — see TRACK 9 §9).
   Legacy remediation itself is a separate gated chain and is NOT a pilot prerequisite unless
   the schema map (V2) shows New Flow read paths touching those rows.
4. Pilot-scope access: at least one active-college manager account for college
   `7168345f-…` (`useCanManageActiveCollege` gates `/import` and operational surfaces).

## 3. Pilot runbook (step-by-step — execution gated by `APPROVE_PILOT_EXECUTION`)

Phase A — foundation (UI, no import):

1. Confirm pilot college `7168345f-cf9d-4789-b2ad-547abb687dc8` active; set as active college.
2. Create the pilot department and program via foundation UI (colleges/departments/programs
   are UI_MANAGED_NOT_IMPORTED).
3. Verify migration evidence: prerequisite migrations applied remotely (record evidence in
   the pilot log).

Phase B — data import (official order per `docs/IMPORT-ORDER-AND-DEPENDENCIES.md`):

4. Import `academic_terms` (1 row) → preview 0 errors → commit.
5. Import `rooms` (limited set) → preview 0 errors → commit.
6. Import `instructors` (limited set) → commit.
7. Import `daily_breaks` → commit.
8. Import `full_study_plan` (or `study_plan_courses`) for the pilot program → commit.
9. Import `course_programs` for the one shared course → commit.
10. Import `academic_cohorts` (1–2 rows) → commit.
11. If the plan has electives: `elective_slot_courses` then `cohort_elective_selections`.
12. Run generators: `generate_cohort_delivery_groups`, then `generate_cohort_curriculum`
    (delivery_groups and cohort curriculum are GENERATED_NOT_IMPORTED).
13. Import `teaching_assignments_v2` (resolves `delivery_group_code` against generated
    groups) → preview 0 errors → commit.

Phase C — readiness data:

14. Enter instructor availability (UI-managed, all-active-days bulk entry supported).
15. Insert approved cohort headcounts (post-`20260721180000`); set `count_status`
    progression as evidence accumulates.

Phase D — schedule build and review:

16. Create schedule version (draft) for the pilot term; run the schedule builder.
17. Review conflicts/exceptions report; resolve or accept-with-note each item.
18. Generate draft lecturer report; circulate to pilot department for confirmation.
19. Lock the schedule version per lifecycle (draft → reviewed → approved).
20. Acceptance review against §6; record evidence.

Phase E — publish decision (separate gate `APPROVE_DEPLOY_PUBLISH`):

21. Publish the pilot schedule to the pilot college audience only.
22. Run post-publish checks (§9).

## 4. E2E test list (must all pass inside the pilot window)

| # | Test | Pass condition |
|---|---|---|
| E1 | Import round-trip (each of the 11 active entities used in pilot) | Preview error count = 0; atomic commit succeeds; row counts match file |
| E2 | Unknown/duplicate header rejection | Deliberately corrupted template is blocked (`unknown_column` / `duplicate_header`) |
| E3 | Enum enforcement | `summer_training` component rejected; non-Pilot `study_system` rejected; capacity ≤ 0 rejected |
| E4 | Generator correctness | `generate_cohort_delivery_groups` + `generate_cohort_curriculum` produce expected groups/curriculum for 1–2 cohorts; counts verified against the study plan |
| E5 | TA V2 integrity | Every TA V2 row resolves cohort + course + component + delivery group + instructor; zero orphans; `section_id` untouched by New Flow |
| E6 | Headcount flow | Insert approved headcounts; `count_status` transitions respected; workload math uses them |
| E7 | Availability enforcement | Builder respects instructor availability and daily breaks |
| E8 | Shared course handling | The one shared course appears correctly for both programs; no double-booking |
| E9 | Schedule build | Draft schedule builds with 0 unresolvable conflicts (or every conflict dispositioned) |
| E10 | Conflict/exception report | Report lists all known conflicts; matches reviewer expectations |
| E11 | Draft lecturer report | Per-instructor loads match TA V2 assignments; department signs off |
| E12 | Tenant isolation | Pilot college user sees only college `7168345f-…` data; cross-college access denied |
| E13 | Role enforcement | `read_only`/non-manager blocked from import commit and publish actions |
| E14 | Lifecycle | Draft → reviewed → approved transitions enforce permissions; no direct publish from draft |
| E15 | Publish + visibility | Published schedule visible to intended pilot audience; legacy entities nowhere in New Flow UI |

## 5. Role matrix for the pilot

| Role | Responsibilities | Key permissions exercised |
|---|---|---|
| Pilot owner (user) | Gate approvals, acceptance sign-off, rollback go/no-go | All `APPROVE_*` gates |
| College manager (pilot college) | Foundation setup, imports (preview + commit), availability entry, headcount inserts, schedule build/review | `requireImportManager`, `useCanManageActiveCollege`, schedule lifecycle transitions |
| Department reviewer | Study plan correctness, draft lecturer report sign-off | Read/review on pilot program scope |
| Scheduler/operator | Run builder, disposition conflicts, prepare publish | Schedule version lifecycle (non-publish) |
| Read-only auditor | Verify isolation, reports, evidence capture | `read_only` role (must be blocked from mutations — E13) |
| Release owner | Deploy/publish execution after gate, post-deploy verification | `APPROVE_DEPLOY_PUBLISH` scope |

## 6. Acceptance criteria (pilot passes only if ALL hold)

1. All E2E tests E1–E15 pass with recorded evidence (screenshots/logs/checksums as applicable).
2. Zero unresolvable scheduling conflicts in the final approved pilot schedule.
3. Every imported row traceable to its file + preview log; no manual DML used anywhere.
4. Legacy data untouched: 174 TA V1 + 5 COS counts unchanged before/after pilot (checksum
   comparison per TRACK 9 §3 recipes).
5. New Flow sessions carry no real `section_id` linkage (the `section_id = 0` state is
   unchanged and unexplained-by-nobody is not acceptable — semantics documented).
6. Headcounts reflect only approved values; `count_status` audit trail complete.
7. Department reviewer and pilot owner sign off on the draft lecturer report and final
   timetable.
8. Rollback plan (§7) rehearsed at least as a dry-run on the schedule-version level.

## 7. Rollback plan

- **Schedule level:** unpublish / revert to previous schedule version (lifecycle supports
  draft rollback; published version can be superseded by a new version). No destructive
  deletes — versions are retained for audit.
- **Import level:** imports are atomic per job (`commit_import_job_atomic`); a failed commit
  leaves no partial state. A committed-but-wrong import is reversed by a follow-up gated
  correction, never by ad-hoc DML; if row-level reversal is needed, use the TRACK 9
  manifest+backup method (exact IDs from the job payload).
- **Data level (legacy/test):** only via `zz_backup_*` + exact-IDs manifests (TRACK 9 §3–§4),
  under their own gates — never improvised during the pilot.
- **Deploy level:** if publish exposes a defect, unpublish the pilot schedule and restore the
  pre-publish application state per release procedure (§8/§9); pilot college scope limits
  blast radius to one college.
- **Decision owner:** pilot owner (user) — go/no-go on every rollback.

## 8. Release checklist (pre-deploy — gate `APPROVE_DEPLOY_PUBLISH`)

- [ ] `APPROVE_PILOT_EXECUTION` granted and pilot completed with all acceptance criteria met.
- [ ] All prerequisite migrations applied with remote evidence (MIGRATION-MAP order).
- [ ] Production data ready: real import complete, preview logs clean, counts verified.
- [ ] Legacy state verified unchanged (checksums) unless separately gated remediation ran.
- [ ] Harnesses green (import-templates-final-audit, import-pipeline-safety, atomic,
      preapply, room-import-normalize, academic-delivery-v2-import-generator) on the release
      commit; `tsc --noEmit` and build green.
- [ ] Role/permission spot-check on production build (E12/E13 equivalent).
- [ ] Rollback plan current and owner confirmed.
- [ ] Support/contact path for pilot college defined during the publish window.

## 9. Post-deploy checklist

- [ ] Publish action evidenced (who/when/which schedule version).
- [ ] Pilot college audience sees the published schedule; non-pilot colleges unaffected.
- [ ] Conflict/exception and lecturer reports regenerated post-publish; deltas = 0 vs the
      approved pre-publish versions.
- [ ] Error monitoring watched for an agreed quiet window (suggested: 7 days, matching the
      backup-retention precedent).
- [ ] Legacy counts re-verified unchanged (174 TA V1, 5 COS, sections = 0).
- [ ] Evidence pack archived: import previews, commit logs, generator outputs, acceptance
      sign-offs, publish record.
- [ ] Retrospective notes captured; go/no-go for expanding beyond the pilot college
      documented as a NEW explicit user decision (no auto-expansion).

## 10. Gates and dependency notes

| Gate | Status | This pack's usage |
|---|---|---|
| `APPROVE_PILOT_EXECUTION` | PENDING | Unlocks runbook phases A–D (§3). Requires migrations applied + production data ready first (§2). |
| `APPROVE_DEPLOY_PUBLISH` | PENDING | Unlocks phase E + §8/§9. Requires pilot acceptance (§6) met. Also requires migrations + data readiness. |
| `APPROVE_DB_MIGRATION_APPLY` | PENDING | Prerequisite chain for both pilot and deploy (MIGRATION-MAP order). |
| `APPROVE_REAL_DATA_IMPORT` | PENDING | Prerequisite for pilot phase B. |
| `APPROVE_LEGACY_DATA_REMEDIATION` | PENDING | Separate chain; NOT a pilot prerequisite unless schema map V2 shows New Flow read-path exposure to the 174+5. |
| `APPROVE_TEST_DATA_CLEANUP` | PENDING | Separate chain (TRACK 9); not a pilot prerequisite. |

Dependency notes:

- Headcount inserts require migration `20260721180000`, which requires `20260717050000` —
  both NOT APPLIED today. The pilot cannot reach phase C without them.
- `academic_programs` = 0 in production: pilot phase A step 2 (UI program creation) is a
  hard prerequisite for every plan import (plan rows reference `academic_programs.code`).
- TA V2 import (step 13) depends on generated delivery groups (step 12) — never reorder.
- Legacy schema-map results (pending from user) may add constraints to E5/E15 and §6.4 if
  New Flow read paths turn out to touch legacy rows.

## 11. UNKNOWNs register

1. Specific pilot department/program/term/cohort identities — TBD at gate review with the user.
2. Approved headcount values — pending (gated insert flow; values must come from the user).
3. Relationship schema-map results (V2) — pending from user; may expand pilot safety checks.
4. Exact limited sets for rooms/instructors — sized at gate review against the pilot plan.
5. Publish audience/channel mechanics for the pilot college — confirm at release review.
