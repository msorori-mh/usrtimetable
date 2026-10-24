# ITCS Last and Final conflict validation

The production draft `0f11c15c-f7ce-4dd3-8974-e856f039d3e7` timed out because
whole-version validation took 8.203 seconds against an 8-second authenticated
statement timeout. The student-overlap pass alone took 3.910 seconds: it decoded
the entire membership snapshot and computed coverage again for each pair.

Migration `20261024215955_batch_version_student_overlap` aggregates memberships
and coverage once per delivery group. It preserves the existing conservative
pairwise decision for missing mappings, partial coverage, shared cohorts and
disjoint student partitions. Function permissions and all other rules are retained.
The migration has been applied to Supabase project `rizetlcibquhnfmybvoh`.

The same draft also had four `student_mapping_incomplete` results. Its shared
AI first-year theory lecture retained partner group facts and the shared link,
but neither group's partner partition snapshot was present. The existing global
memberships were verified against confirmed cohort counts and the draft facts:
regular 33 + 32 = 65, parallel 25. The guarded one-off repair
`supabase/seeds/last-final-restore-ai-partitions.sql` copied those three existing
memberships into this draft, incremented its eligibility revision and recorded
a maintenance audit entry. It does not change published snapshots or session data.
It is a one-off operation with compare-and-swap guards, not a replayable migration.

Verification:

- PGlite regression compares old and new overlap results for missing mappings,
  disjoint cohorts and partitions, incomplete coverage, merged cohorts, duplicate
  partition rows, unknown counts, null groups, replaced sessions, adjacent times,
  different days and versions. It also verifies private execution and rollback.
- Production `validate_schedule_version` passed as `authenticated` with an explicit
  `statement_timeout='8s'`; measured execution was 6.012 seconds after the repair.
- Result: 274 sessions, zero unapproved hard conflicts, zero warnings, two
  pre-existing approved exceptions, eligibility revision 316.
- Session snapshot stayed `9188e77fbf4d28389d006275c1cca79b`; published source snapshot
  stayed `85f5bb568b14a08bee1852c74015a79b`.
- Assignment integrity check found zero missing/inactive/mismatched assignments.
- Rollback inventory, formatting and diff whitespace checks passed.

Quality was subsequently evaluated through the application for revision 316:
zero unapproved hard conflicts and 56 soft observations (36 workload balance,
19 instructor gaps, one distribution balance). The weighted quality score is
0/100; these soft observations do not block publication. Coverage is 274/274
groups and 626/626 contact hours.

The application's publish action initially failed closed because this version's
scoped assignments had no publish expectation. This is an ordinary cloned draft,
not a registered proposal/cutover (no cutover run exists for it). Using the
official lifecycle and seal functions in one transaction, it was returned to
draft, sealed against the verified 274-session snapshot, and reviewed and approved
again. No guard was disabled and no expectation row was inserted directly.

The authenticated application's publish action then succeeded at 01:09 Riyadh time
on 25 October 2026. `Last and Final` is published and the previous
`Final ITCS TimeTable 2026` was archived automatically. Both session snapshots
remain unchanged. Every check on PR #421 passed before the publication evidence
was added to this document.
