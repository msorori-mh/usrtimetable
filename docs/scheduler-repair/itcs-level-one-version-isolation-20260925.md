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
its original membership. Stage 2b has not been applied to the live database
and its client code has not been deployed.

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

`PASS` for Stage 1 and the schema/seed portion of Stage 2 on the live
database, 25 September 2026. Both SQL files under
`docs/migrations-proposed` were executed as separate transactions after
successful rollback-only runs against the same database. Postverification
found five immutable baseline rows, all five full V2 digests matching 275
published sessions, ten version/cohort scope rows, 94 group facts, 26
partition facts, 156 memberships, 12 shared links and 14 frozen partner
group facts. V2 and the draft still each have 275 sessions and 420 scoped
students, and the five global enrollment counts still sum to 420. A real
ITCS viewer read the new data as `authenticated`; an authenticated user
outside the college received no baseline rows and a forbidden RPC response.
The focused disposable PostgreSQL checks and general repository CI passed.
Read-only live preflight also matched all 44 source group IDs and old sizes,
all six source assignments and all six draft source sessions. The six planned
rooms are active, correctly coded and large enough; the three legacy short
labels were corrected to `R-04`, `LAB-01` and `LAB-04` in the reviewed map.
None of the six new placements overlaps an existing draft room/instructor,
or a published/approved instructor assignment at another college with an
overlapping term date range. R13 and R14 are active 08:00–14:00 on the six
teaching days. Dr. Abdelnasser has zero Sunday sessions in the retained
draft; existing theory and R13/R14 sessions also meet the 14:00 closing
time. This is a point-in-time preflight and must be rerun at the draft write.

`HOLD` for the remaining Stage 2 application/server integration and Stage 3
draft reconciliation. Server freshness, assignment and shared lecture
guards, generation writes, group editors and other report paths still
need version-aware integration. The existing global instructor-hour cap
needs a narrowly scoped implementation of the authorized exception for
these assignments. Do not update draft counts or add six sessions yet.
Because the two schema transactions were applied directly while this
branch remains a draft PR, reconcile them with the tracked migration
history before merging or deploying the application code.
