# ITCS-ISO — version scoped level-one delivery

Target: draft `d68d8d22-9a6d-4f21-935f-cebf18bb969b` only. Preserve published V2
`30f8a76d-1cb9-4944-a5d7-483dcaea7692` and its 275 sessions. The user
authorized new counts 140/100/125/59/42, the six new groups and their former
instructors. Publishing the draft is a separate decision.

## Live baseline, 25 September 2026

- ITCS term `18dd364a-76d7-40b8-a217-fa929c082a7f` now has exactly V2
  published and the latest draft, 275 sessions in each.
- Five first-year cohort counts in the live database: 110/75/120/75/40,
  totaling 420. Requested values total 466.
- The redivision map covers 44 active existing groups, 15 proposed student
  partitions, six new groups, six assignments and six sessions. Of those 44
  existing groups, 41 are used by both retained versions. The approved
  scheduling headcounts, partitions, group memberships, shared links,
  assignments and offering counts are global, not schedule-version keyed.
- Current draft physics G1 was moved to Monday 08:00–11:00 in R13; Dr.
  Abdelnasser is unavailable Sunday. R13 and R14 operate 08:00–14:00.
- Main repository at start: `e58858026e540e053b6e9869deaaeefe921911f6`.
  Its last five commits since `5c200ed5` do not change the delivery model.

## Stage 1 — immutable published baseline

Review `docs/migrations-proposed/20260925_itcs_v2_delivery_baseline.sql` in an
isolated PostgreSQL environment. It creates one tenant scoped, read only
  baseline row per affected V2 cohort. Each row stores the cohort, approved
  headcounts, partitions, groups, membership, complete shared-lecture stars
  and partner groups, assignments, offerings, a cohort session digest and a
  full published-version session digest. It locks its source
tables during capture and aborts if the version/status/275 session count, the
five cohort counts or their approved headcounts changed. No application read
path is switched in this stage, and no global headcount or draft session is
edited.

Exit gate: run migration on a matching database, compare five payload digests
with fresh source reads, verify an authenticated ITCS viewer may SELECT, other
college users cannot, and UPDATE/DELETE are rejected; verify original V2 and
draft rows unchanged. Leave this stage unmerged and unapplied if these checks
cannot run.

## Stage 2 — version scoped source of truth

Add relational facts keyed by `(schedule_version_id, cohort_id)` and
`(schedule_version_id, delivery_group_id)` for the draft's cohort and group
  sizes, student partitions, group membership and shared lecture sizes. Freeze
  shared partners outside the five edited cohorts as versioned partner facts.
  Seed V2 and the draft from Stage 1 first; Stage 3 applies the approved
  redivision map only to the draft. An explicit scope
row makes a missing fact an error; do not fall back to global values within a
scoped cohort. Keep existing legacy reads for other versions/cohorts.

The proposed SQL supplies tenant checked single and batch reads. The initial
workspace session and hydrated timetable report readers overlay selected
version headcounts and group sizes; the SQL migration must precede app
deployment. Update all remaining versioned readers and writers together:
group derivation freshness,
student overlap and shared lecture guards, session insert/move, workload and
coverage checks, automatic scheduling, timetable/report queries and print
views. Every read that displays group or cohort size must receive the selected
version ID. Published V2 must resolve its frozen baseline; the draft resolves
new facts. Reject cross-college and cross-version references at the database
boundary, and keep RLS for college view/manage roles. Do not disable existing
triggers or bypass foreign keys.

Stage 2b proposal: `docs/migrations-proposed/20260925_itcs_version_scoped_memberships.sql`
captures shared partner partition memberships before any draft data change.
Its selected-version RPC returns cohort identities, partition sizes and the
effective group size, including shared-lecture members. The branch now uses
this RPC for client student-conflict checks, generation partition checks and
student print copies. The disposable database fixture deliberately changes
draft partitions and global partner metadata, then verifies V2 still resolves
its original membership. Stage 2b was applied with the later server changes
and atomic draft reconciliation; its client code awaits the PR deployment.
The fixture also removes a draft shared member partition inside a rollback
transaction and confirms the missing member cohort remains visible and the
server overlap check still blocks the collision.

Stage 2h fixes the delivery-coverage and missing-groups RPCs to use the
selected-version group catalogue. The first live report check exposed V2
incorrectly counting six draft-only groups (275/281). The replacement passed
a rollback-only live rehearsal and authenticated role check before commit.
The live report now shows V2 275/275 groups and 627/627 hours; the draft shows
281/281 and 642/642. Both missing-group lists are empty. See
`docs/migrations-proposed/20260925_itcs_version_scoped_delivery_coverage.sql`.
The draft compaction snapshot now overlays versioned group sizes, partition
headcounts, member rows and session headcounts before evaluating candidate
moves; it no longer loads global member/partition views for this calculation.

Stage 2c proposal: `docs/migrations-proposed/20260925_itcs_version_scoped_overlap.sql`
changes the server overlap checker used by session creation and relayout to
resolve student membership and shared lecture sizes from the selected version.
It retains conservative overlap when a mapping is incomplete; the fixture
checks a shared collision and an unrelated cohort on the draft. This function
was installed with the complete server guard rollout.

Stages 2d–2g add version-scoped freshness, the assignment/session guards,
an exact six-assignment faculty exception and a selected-version group
catalogue for reports. The exception matches each new assignment to its
lecturer's published V2 assignment for the same offering and component. It
neither fills missing home-college data nor fabricates a quota; other
assignments keep the usual approval and hours checks. The complete 2b–2f
plus Stage 3 transaction passed a live rollback-only rehearsal. That
rehearsal added the six groups, assignments and sessions, ran postconditions,
and returned the live draft to 275 sessions / 420 students. The 2g catalogue
passed the PostgreSQL fixture and was applied with the reconciliation.

Exit gate: old and new versions give distinct 420/466 results while their
session IDs/placements and V2 baseline digest stay unchanged; unauthorized
writes and incomplete facts fail closed. Test other colleges' timetables and
Legacy schedule reads for regression.

## Stage 3 — one atomic draft reconciliation

Recheck the live version IDs/statuses, 275 sessions, baseline digests and source
instructor/room availability. Apply only the draft facts for the five cohort
counts and 15 partitions; update 44 group definitions and membership facts;
add six groups, copy six teaching assignments to the same instructors as the
corresponding old sessions, then add six sessions from the reviewed placement
map in `docs/scheduler-repair/itcs-level-one-draft-reconciliation-plan.json`.
All writes and postconditions belong to one transaction. The new draft
should contain 281 sessions and an estimated 642 weekly hours.

Check theory ends by 14:00 in ITCS; R13/R14 close at 14:00; the labs accept
14:00–16:00 practical work; Dr. Abdelnasser has no Sunday sessions. Recompute
merged Arabic sizes (187/192, 142/192, 84/192) and AI+CIS (67/75), student
overlap, instructors, rooms, assignment loads and cross-college conflicts.
The ITCS priority exception does not move another college's session: schedule
that actual move before teaching. Do not publish in this stage.

Exit gate: server checks and reports PASS, V2 published facts and sessions
unchanged, draft 281 sessions with all five counts and six assignments, and a
reviewable readiness report. Any failed assertion rolls back the whole stage.

## Current decision

`PASS` for the database reconciliation on 25 September 2026. Stage 1 and
02a were first applied in separate transactions. Stages 02b–02g and Stage 3
were then rehearsed together in a rollback-only transaction and committed
together after all nine repository workflows passed at
`5f4f4a34b272bbfbffda4cf0b15ea70701bef0bb`. The SQL service returned
a cancelled response after the commit, so the result was independently
verified by fresh reads. Draft `d68d8d22-9a6d-4f21-935f-cebf18bb969b` has
466 versioned students, 281 sessions, 53 group facts, 15 partitions, and
six exact lecturer assignments. Published V2 retains 420 students, 275
sessions, 47 group facts and all five unchanged full-session digests. The
global master counts remain 420 to protect V2. The six new draft sessions
are in R13, R-04, LAB-01 and LAB-04; Dr. Abdelnasser's new physics session
is Monday 11:00–14:00 in R13, with no Sunday session in the draft. Server
preflight and postconditions reject new room/instructor collisions, an
out-of-capacity room, stale groups and a changed published baseline.

`PASS` for application rollout and selected-version report verification.
PR #303 merged to main as `ccce07a7695992ed8a28c5cc9e362fcbcdd75203` after
all nine workflows passed, and the connected app was deployed. An authenticated
read of the live timetable's parallel IT level-one student print shows new
G2/G3 sessions, the former lecturers, R13 on Monday/Tuesday/Wednesday,
and Monday physics without a Sunday physics session. The report selector
shows separate draft and published versions and the repaired coverage above.
The schedule draft remains a draft; V2 is still published. The SQL was applied
directly rather than through `supabase_migrations.schema_migrations`; record a
tracked schema migration strategy before reusing these application changes in
a fresh environment. Do not replay the one-shot Stage 3 transaction.
