# JAWF-STUDENT-PARTITIONS-02 — explicit student partitions and shared-student conflicts

Baseline: `ad62a7834e0821a86d7a4f71b6fe31f21f62e69e` (clean worktree; continues the completed
JAWF-SESSION-DURATION-01 cadence fix, which is preserved, not reimplemented).

**No production DB change, no migration applied, no data written, no deployment by the agent.**
All SQL below is proposed for root review and apply through the existing authorized workflow.

## Approved model

Level 1 Jawf cohort `a54be564-b9cc-4c23-8b02-504453100123` (college `7168345f-…`, program
`dd991d15-…`, term `18dd364a-…`) = 120 students = 4 anonymous partitions of 30 (P1..P4, no PII).

| group                    | partitions |
| ------------------------ | ---------- |
| theory G1 (every course) | P1, P2     |
| theory G2 (every course) | P3, P4     |
| practical G1             | P1         |
| practical G2             | P2         |
| practical G3             | P3         |
| practical G4             | P4         |

Read from the live DB: the cohort has exactly **18** active non-obsolete delivery groups
(6 courses × theory G1/G2 = 12, plus JIS-L1-003 and JIS-L1-004 practical G1..G4 = 8 → 18 shown
minus obsolete G3/G5 rows, which are excluded).

## Diagnosis (live reads)

- `_sb_v2_delivery_group_overlap` blocked **any** overlapping session of the same cohort, so
  disjoint groups could never run in parallel.
- The only DB callers of that helper are `create_schedule_session_from_assignment_v2`,
  `validate_schedule_session_move`, `move_or_reschedule_schedule_session` — all pass the session's
  own delivery group + cohort, so fixing the single helper covers create, move and validate.
- No other DB function emits `cohort_conflict`/`delivery_group_conflict`.
- The client validator (`src/lib/conflict-engine/validator.ts`) and scorer produce only
  instructor/room/section/capacity/availability conflicts — no cohort or delivery-group rule —
  so they need no change; the scorer inherits server results.
- `src/lib/auto-scheduler/session-plan.ts` `isLocallyBlocked` mirrored the cohort-wide rule.

## Proposed SQL (files, not applied)

1. `docs/migrations-proposed/20260910T2100_cohort_student_partitions.sql`
   - `public.cohort_student_partitions` (college_id, cohort_id, partition_code, headcount, active),
     unique per cohort+code.
   - `public.delivery_group_partition_members` (college_id, cohort_id, delivery_group_id,
     partition_id), unique per group+partition, indexed.
   - GRANTs to `authenticated` + `service_role` only (no `anon`), RLS enabled, 4 policies each:
     read via `can_view_college`, every write via `can_manage_college`.
   - Triggers `trg_csp_cohort_college` and `trg_dgpm_consistency` reject cross-college and
     cross-cohort rows (`CROSS_COLLEGE_FORBIDDEN`, `COHORT_MISMATCH`).
   - `public.delivery_groups_share_students(uuid, uuid)` — STABLE SECURITY DEFINER,
     `search_path = public`, `REVOKE ALL … FROM PUBLIC` then EXECUTE to authenticated/service_role.
     Returns TRUE (conflict) for: null/equal groups, unknown groups, either side unmapped,
     coverage below the group's expected students, and any partition intersection. Returns FALSE
     only for different cohorts or proven disjoint complete mappings.
   - `_sb_v2_delivery_group_overlap` replaced: same peer query, but a peer in a _different_
     delivery group is skipped only when the helper proves the two groups share no students.
     Callers unchanged.
2. `docs/migrations-proposed/20260910T2100_jawf_level1_partition_data_apply.sql` — scoped,
   idempotent data apply for the one approved cohort: aborts unless the cohort matches all four
   ids, inserts P1..P4 (30 each), maps theory G1→P1,P2 / G2→P3,P4 and practical Gn→Pn for active
   non-obsolete groups of every course, then aborts if any active group is not fully covered.
   Touches no `schedule_sessions`.
3. `docs/migrations-proposed/20260910T2100_partitions_preflight_postverify_rollback.sql` —
   preflight (cohort identity, 18 active groups, tables absent, overlap-function md5, draft
   session count for version `9ed1e0a2-bd5c-4515-bd62-6ab5854062c7`), postverify (partition rows,
   per-group mapping counts, coverage, a real-id pairwise `share_students` probe, cross-cohort
   probe, security posture, RLS/policy counts, unchanged session count) and a commented rollback
   that restores the previous helper verbatim and drops the new objects.

## Source changes

- `src/lib/auto-scheduler/student-partitions.ts` (new) — pure shared-student semantics:
  `buildPartitionIndex`, `groupsShareStudents` (reasons: `same_group`, `different_cohort`,
  `unmapped`, `incomplete_coverage`, `overlapping_partitions`, `disjoint_partitions`),
  `makeSharedStudentsPredicate`. Mirrors the SQL helper exactly and is fail-closed.
- `src/lib/auto-scheduler/session-plan.ts`
  - `isLocallyBlocked` takes an optional `sharedStudents` predicate; without it (or when either
    side has no delivery group) the conservative cohort-wide rule is preserved. Room and
    instructor blockers are untouched.
  - `requiredCadenceForComponent` no longer invents cadence: missing, invalid or mismatched plan
    patterns return `durations: []`, `source: "blocked"` and an actionable Arabic note.
- `src/lib/auto-scheduler/v2.ts`
  - Loads the mapping (`delivery_group_partition_members` + partition headcount/active) for the
    cohorts in scope; any error, absent table or empty mapping falls back to cohort-wide blocking
    and, on error, adds `PARTITION_FALLBACK_WARNING_AR`. This is why the code works both before
    and after root applies the migration.
  - Passes the predicate to the local pre-filter; server RPC remains the only authority.
  - Blocked cadence components are reported as unplaced with the reason and skipped — never
    scheduled with a guessed pattern. Run summary adds `cadence_invention: "disabled"`,
    `student_partition_semantics` and `blocked_cadence_items`.
- Old draft sessions are never modified; nonconforming ones stay reported only.

## Tests and gates

- `tests/jawf-student-partitions-02.test.ts` (new, 26 tests): disjoint theory G1/G2 allowed;
  theory G1 vs practical G1/G2 blocked; theory G1 vs practical G3/G4 allowed; theory G2 mirror;
  same partition in two different courses blocked; separate partitions allowed; same group always
  blocked; mapped vs unmapped blocked; incomplete coverage blocked; inconsistent cohort rows fail
  closed; other cohort never shares; local pre-filter parity; room/instructor blockers unchanged;
  and source assertions on all three SQL files (grants, no `anon`, `can_view_college` /
  `can_manage_college`, cross-college trigger, fail-closed helper, revoked PUBLIC execute, scoped
  idempotent data apply, preflight/postverify/rollback present).
- `tests/jawf-session-duration-01.test.ts` updated for the tightened cadence (blocked, not derived).
- `bun test` → **239 pass / 0 fail, 816 assertions**.
- `bunx tsgo --noEmit` → clean. `bunx eslint` on changed files → clean.
- `node tests/harness/run.mjs` → 68 passed, 0 failed. Build → OK.

## Residual risks

- Cross-college read/write refusal and the pairwise SQL probe are asserted in source and scripted
  in postverify, but cannot be executed until root applies the migration — marked UNVERIFIED at
  runtime.
- Until the data apply runs, every pair stays conservatively blocked (safe direction).
- Coverage is validated by headcount sums, not by student identity (no PII by design).
