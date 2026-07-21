# RUNLOG — USRTIMETABLE-LAUNCH-CLOSURE-SWARM-01

State source of truth: this folder (origin/main). Sandbox copies are ephemeral and never authoritative. If this folder is missing remotely, automation must HOLD.

## 2026-07-22 — USRTIMETABLE-SWARM-STATE-RECOVERY-AND-RESUME-01

- Canonical state files found remotely (created by the previous recovery run) — loaded as truth, NOT rebuilt from memory. Tag: RECONSTRUCTED_FROM_REPO_EVIDENCE retained.
- New user-confirmed facts merged into STATE.json:
  - course_offerings.term_id -> academic_terms.id, FK validated=true, delete behavior=RESTRICT.
  - 20260715120000_approve_capacity_split_proposal.sql added to source-only NOT APPLIED list (now 7 migrations).
- Resumed pending safe work only (all already prepared, verified still valid):
  1. Final-main local gates package for main@91b5f65e — ready (ZIP export cached; awaiting USER_RUNS_FINAL_MAIN_GATES).
  2. Legacy Relationship Schema Map read-only package — ready (awaiting USER_RUNS_LEGACY_RELATIONSHIP_SCHEMA_MAP).
  3. Headcount production dependency map — canonical copy in this folder.
- Explicitly NOT done: no final classification SQL, no A2, no migration apply, no production data modification, no duplicate PRs.

## 2026-07-22 — USRTIMETABLE-SWARM-STATE-RECOVERY-AND-NEXT-SAFE-ACTIONS-01

- STOP CONDITION on lost Sandbox STATE.json lifted by explicit user authorization.
- State rebuilt from GitHub evidence + user-confirmed facts only. No undocumented memory used.
- Verified via GitHub API: PR #60 MERGED (17:59:41Z), PR #61 MERGED (18:08:14Z), PR #62 MERGED (18:43:41Z, merge commit 91b5f65).
- All 6 then-known source-only migrations present in supabase/migrations; none confirmed applied remotely.
- DRIFT NOTE: origin/main advanced to 6c4401bb (4 lovable-dev commits after 91b5f65, latest "Held classification due to schema"). User to confirm gates target SHA.
- TRACK 1: actual gates run NOT possible from agent environment (private repo). No PASS claimed. Built USRTIMETABLE-FINAL-MAIN-91B5F65-LOCAL-GATES.zip.
- TRACK 2: built PHASE-A1-LEGACY-RELATIONSHIP-SCHEMA-MAP read-only package (10 statements, all SelectStmt — verified with pglast parser). Not executed by the agent.
- TRACK 3: wrote SCHEDULING-HEADCOUNT-PRODUCTION-DEPENDENCY-MAP.md.
- No DB writes, no migration apply, no backfill/cleanup, no A2, no deploy/publish, no duplicate PRs, no branch/worktree deletion.

## 2026-07-21 (prior run, preserved)

- A1 source closure: PRs #60/#61 merged; A1.3b remediation plan + A1.3c hardening draft delivered (design only).
- PR #62 scheduling headcount foundation merged (source-only, NOT APPLIED).
- LEGACY_ORPHAN_CLASSIFICATION_V1 rejected: assumed delivery_groups.course_offering_id (absent in Production).
