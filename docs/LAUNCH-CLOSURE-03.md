# LAUNCH-CLOSURE-03 — durable server-side availability integrity (APPLIED BY ROOT)

- Baseline: `8b0797fdb20fba512cf396fb386aef81ce99c2f0` (verified HEAD, clean tree at start)
- Stage HEAD at hand-off for review: `db4bb418bf44dfac5b22302f8943e2e8c4b42187`
- Production SQL applied: **YES — by root, not by this agent** (see §1a for exact provenance).
  The database is therefore **no longer source-only** with respect to this artifact.
- Deployment: **NO**. Production data mutated: **NO** (row counts unchanged, 0 instructor /
  1 room, verified by root pre- and post-apply).
- Credentials: none created, reset, or read from history in this stage.
- This agent has **not** re-applied and must not re-apply the SQL.

## 1a. Provenance of the production application (recorded from root, agent-unverified)

| Item                | Value                                                                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Artifact applied    | `docs/migrations-proposed/20260910T0025_availability_temporal_integrity_and_bulk_rpc.sql`, **verbatim**, as reviewed at `db4bb418`      |
| Applied by          | Root operator                                                                                                                          |
| Mechanism           | Configured Lovable `query_database` — **direct SQL execution**, one transaction, succeeded, no rows returned                            |
| Migration history   | **NOT registered.** This was not a `supabase/migrations/` file and no history row was created                                            |
| Root preflight      | read-only: instructor_rows 0, room_rows 1, invalid_room_rows 0, `btree_gist` available, 0 function/constraint name collisions; overlaps arithmetically impossible at 0/1 rows |
| Root post-verify    | counts unchanged (0 / 1); exactly 2 exclusion constraints present; both RPCs `prosecdef=false` (SECURITY INVOKER); `anon` EXECUTE false, `authenticated` EXECUTE true; all 11 policies on `instructor_availability`, `room_unavailability`, `audit_logs` byte-identical pre/post |
| Rollback reference  | `docs/migrations-proposed/20260910T0025_rollback.sql` (drops created objects only; deletes no data)                                      |

### Recommended history reconciliation (do not blindly replay old files)

The live schema now contains objects that no file in `supabase/migrations/` accounts for.
To reconcile without risk:

1. Do **not** replay the July migration files or any earlier availability migration — they
   predate this design and would fight the new constraints/functions.
2. Register this change as an already-applied migration: copy the applied artifact **byte for
   byte** into a new `supabase/migrations/<timestamp>_availability_temporal_integrity_and_bulk_rpc.sql`
   and mark it applied (`supabase migration repair --status applied <timestamp>`), so no
   environment tries to execute it a second time.
3. Because every statement in the artifact is guarded (`IF NOT EXISTS` / `CREATE OR REPLACE`
   / conditional constraint creation) and proven idempotent on a disposable cluster, an
   accidental re-execution is a no-op — but repair, not re-execution, is the supported path.
4. Verify afterwards that `supabase migration list` shows local and remote in sync, and keep
   the rollback file paired with the registered migration.

## 1. Artifact paths

| Purpose                               | Path                                                                                      |
| ------------------------------------- | ----------------------------------------------------------------------------------------- |
| Executable migration                  | `docs/migrations-proposed/20260910T0025_availability_temporal_integrity_and_bulk_rpc.sql` |
| Preflight (read-only)                 | `docs/migrations-proposed/20260910T0025_preflight.sql`                                    |
| Rollback                              | `docs/migrations-proposed/20260910T0025_rollback.sql`                                     |
| Disposable-DB proof harness           | `scripts/local-db/availability-temporal-integrity-proof.sh`                               |
| Proof fixture / cases                 | `scripts/local-db/availability-fixture.sql`, `scripts/local-db/availability-cases.sql`    |
| Rejected LC-02 proposal (neutralised) | `docs/migrations-proposed/20260910T0000_availability_bulk_rpc_and_overlap_integrity.sql`  |

The `supabase/migrations/` directory is managed by the platform migration tool and the
Supabase CLI is not installed in this environment, so `migration new` was unavailable and
the executable SQL is staged under `docs/migrations-proposed/`. This is a tooling
restriction, not a bypass: the file is a single self-contained migration and is applied
verbatim through the migration tool when root approves.

## 2. Review defects from LAUNCH-CLOSURE-02, and how each is fixed

| #   | Review finding                                                                                                           | Resolution                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | `timerange` is not a built-in Postgres type and was never defined                                                        | Removed. Time-of-day spans use built-in `tsrange` anchored on `2000-01-01`; `NULL` time normalises to `00:00–24:00` (whole day)                                                       |
| D2  | Room equality on `start_date`/`end_date` mishandles overlapping unequal date windows                                     | Replaced with `daterange` overlap (`_avail_date_span`, `&&`); `NULL` bounds are unbounded                                                                                             |
| D3  | Whole-day / all-week closures were handled by a partial unique index that could not conflict with timed or all-week rows | Unique index removed. Weekday becomes `int4range` (`NULL` weekday = `[0,6]`), so all-week vs single-day and whole-day vs timed rows genuinely overlap inside one exclusion constraint |
| D4  | Instructor constraint improperly covered preferred/available classes                                                     | Constraint is partial: `WHERE availability_type = 'unavailable' AND is_preference = false`                                                                                            |

Extra hardening: `validate_room_unavailability_window` (BEFORE INSERT/UPDATE trigger) rejects
half-specified times, inverted times, and inverted date windows on **every** write path.
Both bulk RPCs are `SECURITY INVOKER`; `EXECUTE` is revoked from `PUBLIC, anon` and granted
to `authenticated` only. No policy, table grant, or RLS change; `can_manage_college` remains
the authorisation source.

## 3. Runtime proof on an isolated disposable database

`bash scripts/local-db/availability-temporal-integrity-proof.sh` — PostgreSQL **17.9**, a
fresh `initdb` cluster in a temp directory, project `PG*` env vars unset. Final line:

```
RESULT: all cases PASS on the disposable database
```

40 cases, all PASS, including:

- migration applies cleanly; **second apply is idempotent**
- `timerange` confirmed absent (the rejected proposal is literally unparseable)
- temporal semantics: whole-day vs timed overlap, adjacency is _not_ overlap, `NULL`
  weekday spans every weekday, **unequal overlapping date windows conflict (D2)**,
  disjoint date windows do not, `NULL` date bounds unbounded
- instructor bulk save creates 6 days, rows read back (persistence), repeat is
  `0 created / 6 unchanged` (idempotent), overlap rejected `23P01` with no partial write,
  inverted time `22023`, soft preference overlapping a hard block still allowed
- room: disjoint May window accepted; overlapping unequal window `23P01`; whole-day vs
  timed `23P01`; all-week vs whole-day `23P01`; half-specified/inverted time/date `22023`
- cross-college RPC refused — code `22023` ("not found") because under `SECURITY INVOKER`
  RLS hides the other college's resource before the `can_manage_college` check is reached.
  This is fail-closed **and** non-disclosing; the test accepts `22023` or `42501`.
- read-only viewer: RPC `42501`, direct insert `42501`, reads still allowed
- anon: no `EXECUTE` (`42501`), direct insert blocked (`P0001` from the cross-college
  integrity trigger, which runs first), reads return nothing
- **two-connection concurrency (case 6.1/6.2)**: two live sessions insert the same room
  window; the second commit fails with
  `23P01 conflicting key value violates exclusion constraint "room_unavailability_no_overlap"`
  and exactly one row survives. This is the case no client-side check can cover.
- rollback removes every created object and destroys no data (12 rows still present)
- preflight executes clean against a real database

## 4. Preflight against production (read-only SELECTs only)

`psql -f docs/migrations-proposed/20260910T0025_preflight.sql`:

- `P0 btree_gist available = t` (extension not yet installed)
- function-signature collisions: **0 rows**
- constraint-name collisions: **0 rows**
- invalid existing room windows (half-specified / inverted time / inverted date): **0 rows**
- instructor overlap pairs: **0 rows**; room overlap pairs: **0 rows**
- policies intact: 8 policies (`ia_*`, `ru_*`) on `authenticated`
- row counts: `instructor_availability = 0`, `room_unavailability = 1`

Conclusion: the migration can be applied with no data remediation. Nothing was written.

## 5. Client mapping of durable failures

`src/lib/availability/errors.ts` adds `isOverlapConflictError` and
`availabilityWriteMessage`, mapping `23P01` / `23505` / exclusion-constraint text to the
Arabic overlap message, `invalid_time_range` / `invalid_date_range` to their own messages,
and `42501` to a denial message — each with the raw server text kept in parentheses.
`src/lib/availability/bulk-api.ts` routes all four write-failure paths (both RPC paths and
both direct-insert paths) through it. Unrelated errors pass through unchanged and are never
reported as conflicts. `[object Object]` remains impossible.

## 6. Gate matrix — source assertion vs runtime vs rendered proof

| #   | Gate                                                                 | Kind                                       | Result                                                                                                             |
| --- | -------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| 1   | Baseline verified, tree clean                                        | repo                                       | PASS                                                                                                               |
| 2   | Migration syntax + executability                                     | runtime (disposable DB)                    | PASS                                                                                                               |
| 3   | Idempotent re-apply                                                  | runtime                                    | PASS                                                                                                               |
| 4   | Temporal semantics D1–D4                                             | runtime                                    | PASS                                                                                                               |
| 5   | Duplicates / idempotency / invalid inputs                            | runtime                                    | PASS                                                                                                               |
| 6   | Cross-college rejection                                              | runtime                                    | PASS (fail-closed `22023`)                                                                                         |
| 7   | authenticated allowed, viewer + anon denied                          | runtime                                    | PASS                                                                                                               |
| 8   | Two-connection overlap race rejected at rest                         | runtime                                    | PASS (`23P01`)                                                                                                     |
| 9   | Rollback correct, no data loss                                       | runtime                                    | PASS                                                                                                               |
| 10  | Production preflight zero invalid/overlap/collision                  | runtime (read-only, prod)                  | PASS                                                                                                               |
| 11  | Least privilege, no SECURITY DEFINER, RLS untouched                  | source assertion + runtime privilege cases | PASS                                                                                                               |
| 12  | Arabic mapping of `23P01`/`23505` and friends                        | unit tests                                 | PASS                                                                                                               |
| 13  | `bun test`                                                           | 147 pass / 0 fail, 480 assertions          | PASS                                                                                                               |
| 14  | Harness `node tests/harness/run.mjs`                                 | 68 passed / 0 failed                       | PASS                                                                                                               |
| 15  | `tsgo --noEmit` typecheck                                            | clean                                      | PASS                                                                                                               |
| 16  | Focused lint + prettier on changed files                             | clean                                      | PASS                                                                                                               |
| 17  | `bun run build`                                                      | succeeded (nitro/worker output generated)  | PASS                                                                                                               |
| 18  | Production application of the migration                              | runtime (prod, performed by root)          | PASS — applied verbatim by root via direct SQL; post-verify recorded in §1a. Not agent-performed, not agent-verified |
| 18b | Migration-history registration of the applied artifact                | repo / CLI                                 | OPEN — direct SQL only; reconcile per §1a                                                                          |
| 18c | Proof runner makes no system modifications                            | runtime (sandbox)                          | PASS — see §9                                                                                                      |
| 19  | Authenticated production save of an unavailability window, read back | runtime E2E                                | BLOCKED — needs the root-authenticated tester to perform it; no session or credentials are available to this agent |
| 20  | Rendered PDF proof of the printed timetable                          | rendered artifact                          | BLOCKED — see §7                                                                                                   |
| 21  | Deployment / publish                                                 | —                                          | NOT PERFORMED                                                                                                      |

Repository-wide `eslint .` reports pre-existing prettier-rule noise across unrelated
legacy files (unchanged by this stage); the changed files are clean.

## 7. Print-proof supplement (honest status)

Root-provided runtime observations, recorded as **reviewer evidence, not agent-verified**:
schedule `5b838e0c-5cad-4822-a8bb-73d9641bbcd9` in TEST-SIMP-03 was already published on
Sept 8, and the print screen correctly renders two rows — practical Sunday 08:00–10:00 and
theory Monday 08:00–10:00 — once program / level / system are chosen. The RTL print styling
and page-break fixes from LAUNCH-CLOSURE-01 remain in place and are covered by source tests
only. What is still missing is a **rendered PDF artifact** produced from that published
schedule and visually checked for clipping, page breaks, and header identification. That
requires an authenticated browser print-to-PDF in the root tester's session; this agent has
no production session and must not create or reuse credentials, so gate 20 stays BLOCKED
rather than being claimed from source.

## 8. Remaining dependencies before launch

1. Root review of the migration, then apply it through the migration tool (preflight is
   already clean, so no data remediation step is needed).
2. After application: one authenticated save of a lecturer unavailability window in
   TEST-SIMP-03, re-read to confirm persistence, and one deliberate overlapping save to
   confirm the Arabic conflict message (gate 19).
3. Export the published timetable to PDF and attach it as the gate 20 artifact.
4. Only then deploy; rollback reference is
   `docs/migrations-proposed/20260910T0025_rollback.sql` (restores pre-migration behaviour
   without deleting data; the client-side validation path resumes, which does _not_ prevent
   concurrent overlaps).
