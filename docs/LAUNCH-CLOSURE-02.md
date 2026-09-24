# LAUNCH-CLOSURE-02 — corrections after independent review of `84762c2b`

Preview only. **Nothing deployed. No production SQL applied. No production data mutated.**
No credential was reset and no user was impersonated during this stage.

## 1. What the review was right about

| #   | Review finding                                                                 | Verdict                     | Correction                                                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------ | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Report claimed persistence / concurrency / print PASS without runtime evidence | **Confirmed**               | Gate matrix in §5 now separates _source assertion_, _authenticated integration_, and _rendered PDF proof_. The unproven gates are marked BLOCKED, not PASS.                                                                                                                         |
| 2   | Room fallback compared only weekday + time, ignoring `start_date` / `end_date` | **Confirmed defect**        | Validity window is now part of the duplicate key (`IS NOT DISTINCT FROM` semantics). Two disjoint date windows are no longer treated as duplicates, so the save can no longer report "unchanged" while the requested window is not stored.                                          |
| 3   | Rows with null weekday / null time were dropped from the comparison            | **Confirmed defect**        | Whole-day closures are read and evaluated. The planner fails closed with `all_day_block` and an explicit Arabic message instead of inserting a redundant window under an existing full-day closure.                                                                                 |
| 4   | `PGRST203` is an ambiguous overload, not a missing function                    | **Confirmed defect**        | `PGRST203` removed from the missing-function set; new `isAmbiguousRpcError` reports it as a hard error with an Arabic explanation and performs **no** write.                                                                                                                        |
| 5   | Schema-cache text broadly routed other errors to client writes                 | **Confirmed defect**        | The `schema cache` substring and the bare `does not exist` substring no longer trigger the fallback. Detection is now: code `PGRST202`/`42883`, or the message "could not find the function", or a `function ... does not exist` pattern; any other code short-circuits to `false`. |
| 6   | Resource ownership not verified before fallback                                | **Confirmed defect**        | `assertResourceInCollege` runs before any read/plan/insert in both fallbacks: the instructor/room must exist, belong to the **supplied** college, and be active — mirroring the RPC preflight.                                                                                      |
| 7   | Do not claim concurrent overlap is rejected                                    | **Confirmed overstatement** | Retracted; see §3 with the constraint evidence.                                                                                                                                                                                                                                     |

## 2. Authoritative semantics used

Source of truth: `supabase/migrations/20260720120000_source_only_availability_all_active_days.sql`
(source-only, **not** deployed). The client fallback now reproduces it:

- "unchanged" = exact row match; for rooms this includes `start_date` and `end_date`.
- overlap probe = same weekday, non-null times, times overlap, **date window not considered** — so an overlapping time rejects the whole request.
- all target days validated before any DML; one overlap rejects every day.
- authorization unchanged: RLS `can_manage_college(auth.uid(), college_id)`. No service role, no `SECURITY DEFINER`, no privileged client.

Documented deliberate divergence: the SQL cannot see whole-day closures (null time / null weekday) in its comparison. The client refuses instead of writing a meaningless row.

## 3. Database facts (read-only inspection, 2026-09-10)

```
constraints on public.instructor_availability:
  PRIMARY KEY (id)
  CHECK (end_time > start_time)
  CHECK (day_of_week >= 0 AND day_of_week <= 6)
constraints on public.room_unavailability:
  PRIMARY KEY (id)
  CHECK (day_of_week >= 0 AND day_of_week <= 6)
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE RESTRICT
triggers: trg_ia_college → ensure_ia_college(), trg_ru_college → ensure_ru_college()
functions named upsert_%unavailability_for_active_days: none
```

Consequences, stated plainly:

- **Cross-college consistency IS enforced in the database.** `ensure_ia_college` / `ensure_ru_college` raise `instructor/college mismatch` / `room/college mismatch` when `college_id` disagrees with the parent row. This is trigger evidence, not an assumption.
- **Overlap uniqueness is NOT enforced at rest.** There is no unique or exclusion constraint on either table, so two concurrent saves can both pass validation and both insert. This is true of the RPC path as well; it is not a fallback-only weakness. The earlier claim is withdrawn.
- `room_unavailability` also lacks the `end_time > start_time` check its sibling table has, and permits null weekday/time (whole-day closures).

Durable correction requires server-side objects and is therefore **proposed, not applied**:
`docs/migrations-proposed/20260910T0000_availability_bulk_rpc_and_overlap_integrity.sql`
(preflight queries, the two functions, GiST exclusion constraints, partial unique index for all-day closures, post-apply tests with expected error codes, and rollback).

## 4. Auth gate (gap 2 follow-up)

- A **rejected** `getUser()` promise (transport failure) previously produced an unhandled rejection and a permanent "verifying session" screen. It now yields an explicit recoverable state (`auth-gate-error`) with retry and a sign-in link. A transport failure never grants access and never silently redirects.
- `onAuthStateChange` now revokes the allowed state and navigates to `/auth` on `SIGNED_OUT` or a cleared session. Nothing is ever _granted_ from an auth event, so the guard is only tightened.
- SSR hydration fix preserved: `ssr: false`, first client render is `null`, no `suppressHydrationWarning`, no `beforeLoad` throw.
- Child-loader implication of removing `beforeLoad`: **none found.** No route file under `src/routes/_authenticated/` declares `loader:`, `beforeLoad`, or consumes route context from the layout (grep evidence). Authorization for every child query remains RLS-side.

## 5. Gate matrix

Evidence classes: **S** = source/unit assertion, **I** = authenticated integration against live data, **R** = rendered output (PDF/print) proof.

| #   | Gate                                                                           | Class                   | Result             | Evidence                                                                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------ | ----------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Prettier (changed files only)                                                  | S                       | PASS               | `bunx prettier --write` on the 6 changed files                                                                                                                                                                                                                         |
| 2   | Typecheck                                                                      | S                       | PASS               | `bunx tsgo --noEmit` — no output                                                                                                                                                                                                                                       |
| 3   | Focused lint                                                                   | S                       | PASS               | `bunx eslint src/lib/availability src/routes/_authenticated/route.tsx` — no output                                                                                                                                                                                     |
| 4   | Unit/behaviour tests                                                           | S                       | PASS               | `bun test` → **124 pass / 0 fail, 396 expect() calls, 16 files**                                                                                                                                                                                                       |
| 5   | Harness suite                                                                  | S                       | PASS               | `node tests/harness/run.mjs` → **68 passed, 0 failed**                                                                                                                                                                                                                 |
| 6   | Build                                                                          | S                       | PASS               | build log entry `build OK`                                                                                                                                                                                                                                             |
| 7   | Date-window duplicate semantics                                                | S                       | PASS               | `tests/launch-closure-02.test.ts` — disjoint window is not "unchanged"                                                                                                                                                                                                 |
| 8   | Whole-day closure handling                                                     | S                       | PASS               | same file — `all_day_block` for null time and null weekday                                                                                                                                                                                                             |
| 9   | PGRST203 not routed to a write                                                 | S                       | PASS               | same file — ambiguous ⇒ hard error                                                                                                                                                                                                                                     |
| 10  | Narrow missing-function detection                                              | S                       | PASS               | same file — `PGRST204`, `42P01`, `42703`, `42501`, `23505`, `PGRST301` all `false`                                                                                                                                                                                     |
| 11  | College-ownership preflight before write                                       | S                       | PASS               | same file — preflight precedes plan and insert in both fallback bodies                                                                                                                                                                                                 |
| 12  | Cross-college FK/trigger consistency                                           | I (DB introspection)    | PASS               | trigger + function bodies quoted in §3                                                                                                                                                                                                                                 |
| 13  | Overlap rejection under concurrency                                            | I                       | **BLOCKED**        | no DB constraint exists; cannot be proven and is not claimed. Requires PART B of the proposal                                                                                                                                                                          |
| 14  | Actual persistence by a college admin (instructor + room save)                 | I                       | **BLOCKED**        | not executed. The reviewer's authenticated session confirmed the lecturer currently has **zero** unavailability rows, i.e. the pre-fix defect state; no write was performed by anyone, so the corrected save path is still unproven at runtime                         |
| 15  | Print screen renders the approved schedule                                     | I (reviewer, read-only) | **PASS (partial)** | schedule `5b838e0c-5cad-4822-a8bb-73d9641bbcd9`, published Sept 8, shows both sessions — practical Sunday 08:00–10:00 and theory Monday 08:00–10:00 — once program/level/system are selected. Covers "approved → publish → print reaches the screen with correct data" |
| 16  | Rendered PDF proof (RTL, repeated headers, page breaks, no clipping)           | R                       | **BLOCKED**        | the print CSS is asserted in source only; no exported PDF was inspected                                                                                                                                                                                                |
| 17  | `normalizeWriteError` keeps `code`/`details`/`hint` on real `Error` subclasses | S                       | PASS               | `tests/launch-closure-02.test.ts` — `FakePostgrestError extends Error` with all three fields survives normalization and appears in the flat toast text                                                                                                                 |
| 18  | Deployment                                                                     | —                       | **HOLD**           | intentionally not deployed                                                                                                                                                                                                                                             |

### Correction to the previous report text

The `errors.ts` header previously asserted that `PostgrestError` is **not** an `Error` instance. That is wrong and has been removed. More importantly, the `instanceof Error` branch of `normalizeWriteError` **discarded `details` and `hint`** and read `code` only when it was already a string — so a genuine `PostgrestError` lost exactly the diagnostics the report claimed were preserved. Both branches now read the same field set through `pickString`, and gate 17 tests a real `Error` subclass rather than a plain object.

## 6. Changed files

```
src/lib/availability/active-days.ts        planner: date window, whole-day closures, sameNullableDate
src/lib/availability/errors.ts             PGRST203 reclassified; narrow missing-function detection;
                                           Error-subclass branch now preserves code/details/hint;
                                           inaccurate "not an Error" comment removed
src/lib/availability/bulk-api.ts           ownership preflight, window-aware room path, ambiguity guard,
                                           insert row-count confirmation, Arabic failure messages
src/routes/_authenticated/route.tsx        rejected-session recovery UI, sign-out revocation
tests/launch-closure-01.test.ts            updated to the corrected PGRST203 expectation and new code shape
tests/launch-closure-02.test.ts            new: 27 behaviour/contract tests for this stage
docs/migrations-proposed/20260910T0000_availability_bulk_rpc_and_overlap_integrity.sql   new proposal
docs/LAUNCH-CLOSURE-02.md                  this report
```

No credential was reset, no password from project history was used, and no user was impersonated. The reviewer's runtime observations in gates 14–15 were read-only.

Auth / RLS / SQL impact: **none applied.** No policy, grant, trigger, function, or row was changed. No migration was executed.

Rollback reference: baseline `5201d1efaf7f6b2d73cca23f62f4bb23e43f7dd1` (LAUNCH-CLOSURE-01 entry point); the previous reviewed commit is `84762c2b`.

## 7. Concrete remaining dependencies

1. **Apply PART A of the proposal** (the two reviewed functions) so writes are atomic server-side. Until then the client fallback is the only path, and it cannot be transactional.
2. **Apply PART B** (exclusion constraints + partial unique index + time-order check) to make overlap uniqueness durable. Blocked on the preflight overlap queries returning zero rows on production.
3. **Map `23P01` / `23505` to the Arabic overlap message** in the client before PART B lands, otherwise users see a raw Postgres error.
4. **Authenticated write run** for gate 14: a college admin saves one lecturer unavailability window and then re-reads it, confirming the row exists, that the date window is stored as requested, and that a failure never shows success. The lecturer in TEST-SIMP-03 has zero rows today, so this is a clean starting point.
5. **Rendered PDF proof** for gate 16, exporting schedule `5b838e0c-5cad-4822-a8bb-73d9641bbcd9` (already published) and inspecting RTL, repeated headers, no clipped columns, and the identification block. Gate 15 already confirms the on-screen data is correct.
