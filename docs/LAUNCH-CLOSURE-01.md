# LAUNCH-CLOSURE-01 — Launch gate closure (preview only, NOT deployed)

- **Stage**: LAUNCH-CLOSURE-01
- **Declared baseline**: `5201d1efaf7f6b2d73cca23f62f4bb23e43f7dd1`
- **Baseline verification**: `git rev-parse HEAD` matched the declared baseline exactly and
  `git status --porcelain` was empty before any file was written. No unexpected drift; no
  unrelated working-tree change was discarded.
- **Deployment status**: **NOT DEPLOYED**. No publish, no deploy, no production data mutation,
  no migration applied, no SQL executed against the database except read-only introspection
  (`pg_policies`, `pg_constraint`, `pg_proc`) used for diagnosis.
- **Commit at which all gates below were green**: `0703a48c755305f8a1f2f6208d3148dc1e69fbab`.
  Note: this report and two comment-only wording corrections in
  `src/routes/_authenticated/availability.tsx` were written **after** that commit, so the final
  reviewable commit is its immediate successor on this branch. No behaviour changed between the
  two; the full suite, typecheck, lint, harness and build were re-run afterwards and stayed
  green (97 pass / 0 fail, 68 harness passed, `build OK`).
- **Scope**: three observed, reproducible gaps. No redesign, no dependency changes, no
  auth/RBAC/RLS changes, no credential resets.
- **Approved product outcome (user-confirmed)**: an approved, printable timetable distributed
  externally by staff. No student portal and no automated student messaging is in scope.

---

## 1. Gate matrix

| #   | Gate                                              | Result      | Command / evidence                                                                                                                                               |
| --- | ------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Baseline + clean tree verified before writing     | **PASS**    | `git rev-parse HEAD` == `5201d1ef…`; `git status --porcelain` empty                                                                                              |
| 2   | Repository instructions read first                | **PASS**    | `.cursorrules` read before any edit (scope, security, no-auto-deploy rules honoured)                                                                             |
| 3   | Gap 1 root cause identified from live state       | **PASS**    | read-only `pg_proc` query returned `[]` for `%unavailability%` — the bulk RPCs do not exist on the DB                                                            |
| 4   | Gap 1 persistence fixed                           | **PASS**    | RPC-first + RLS-gated direct-write fallback in `src/lib/availability/bulk-api.ts`                                                                                |
| 5   | Gap 1 human-readable errors, no `[object Object]` | **PASS**    | `src/lib/availability/errors.ts` + 4 unit tests over plain PostgREST objects and degenerate values                                                               |
| 6   | Gap 1 failure can never render as success         | **PASS**    | delete verifies affected rows; all-or-nothing planner; `onError` refetches                                                                                       |
| 7   | Gap 1 college isolation / RBAC / RLS preserved    | **PASS**    | every fallback read+write filtered by `college_id`; no admin client, no service role, no SECURITY DEFINER                                                        |
| 8   | Gap 2 hydration #418 reproduced before fix        | **PASS**    | Playwright on `/dashboard`: `[pageerror] Hydration failed because the server rendered HTML didn't match the client`                                              |
| 9   | Gap 2 fixed without suppression or hidden errors  | **PASS**    | Playwright re-run: `FINAL URL: http://localhost:8080/auth`, `ERRORS: 0`, `HYDRATION ERRORS: 0`                                                                   |
| 10  | Gap 3 approval → publish → print flow reachable   | **PASS**    | printable timetable now linked from `/published-schedules` as well as the editor                                                                                 |
| 11  | Gap 3 RTL print styling / clipping / page breaks  | **PASS**    | print CSS releases scroll clipping, repeats headers, avoids row splits, wraps long Arabic names                                                                  |
| 12  | Gap 3 essential timetable identification on paper | **PASS**    | asserted by test over `print-sheet.tsx` (university, college, dept, program, level, system, term, version, status, export date, page x/y, watermark/endorsement) |
| 13  | Regression coverage added for changed contracts   | **PASS**    | `tests/launch-closure-01.test.ts` — 24 tests / 92 assertions                                                                                                     |
| 14  | Typecheck                                         | **PASS**    | `bunx tsgo --noEmit` → exit 0, no output                                                                                                                         |
| 15  | Focused lint                                      | **PASS**    | `bunx eslint` over the 6 changed source files → clean                                                                                                            |
| 16  | Prettier on changed files only                    | **PASS**    | `bunx prettier --write` over the 8 changed files                                                                                                                 |
| 17  | Full unit suite                                   | **PASS**    | `bun test` → **97 pass / 0 fail (323 assertions), 15 files**                                                                                                     |
| 18  | Harness suite                                     | **PASS**    | `node tests/harness/run.mjs` → **68 passed, 0 failed, 0 missing historical artifacts**                                                                           |
| 19  | Build                                             | **PASS**    | `/tmp/observability/build-errors.log` latest entry `build OK`                                                                                                    |
| 20  | Preview reachable                                 | **PASS**    | `/dashboard` → `/auth` renders with zero console/page errors                                                                                                     |
| 21  | No migration / SQL applied, no data mutation      | **PASS**    | no file under `supabase/migrations/` touched; no write SQL executed                                                                                              |
| 22  | Authenticated runtime E2E on TEST-SIMP-03         | **BLOCKED** | see §6 — no authenticated session was available; no runtime proof is fabricated                                                                                  |
| 23  | Supabase official docs / changelog review         | **PASS**    | see §5                                                                                                                                                           |
| 24  | Deployment                                        | **HOLD**    | explicitly out of scope for this stage; awaiting independent review                                                                                              |

**Overall: PASS for every in-scope code gate. Gate 22 is BLOCKED on an environment
prerequisite (no authenticated session), and gate 24 is intentionally on HOLD.**

---

## 2. Changed files

| File                                                | Change                                                                                                    |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `src/lib/availability/errors.ts`                    | **new** — pure error normalization: `normalizeWriteError`, `readableWriteError`, `isMissingRpcError`      |
| `src/lib/availability/active-days.ts`               | added pure planner `planBulkUnavailability` + `BulkUnavailabilityPlan` (validate-all-days-before-any-DML) |
| `src/lib/availability/bulk-api.ts`                  | RPC-first, then RLS-gated direct-write fallback for instructor + room unavailability; readable errors     |
| `src/routes/_authenticated/availability.tsx`        | passes `collegeId`; readable errors; college-scoped deletes with verified row count; refetch on failure   |
| `src/routes/_authenticated/route.tsx`               | hydration-safe client auth gate (replaces the pre-render redirect that caused React #418)                 |
| `src/routes/_authenticated/published-schedules.tsx` | adds the «طباعة وتصدير» link to the printable timetable for each published version                        |
| `src/styles.css`                                    | print rules: release scroll clipping, repeat table headers, avoid row/header splits, wrap long Arabic     |
| `tests/launch-closure-01.test.ts`                   | **new** — 24 regression tests across all three gaps                                                       |
| `docs/LAUNCH-CLOSURE-01.md`                         | **new** — this report                                                                                     |

No other file was modified. No dependency was added, removed, or upgraded.

---

## 3. Root causes

### Gap 1 — lecturer unavailability save failed with `[object Object]`, nothing persisted

Two independent defects stacked:

1. **Persistence.** `src/lib/availability/bulk-api.ts` called the stored functions
   `upsert_instructor_unavailability_for_active_days` and
   `upsert_room_unavailability_for_active_days`. A read-only introspection query for
   functions matching `%unavailability%` returned `[]` — those functions exist only in a
   SOURCE-ONLY migration that was never applied to the live database. Every save therefore
   failed at PostgREST with "could not find the function … in the schema cache", and no row
   was ever written.
2. **Error rendering.** The UI mapped errors with `e instanceof Error ? e.message : String(e)`.
   That has two defects: any non-`Error` rejection reaching it renders as the literal
   `"[object Object]"`, and even for a genuine `PostgrestError` it prints only `message` and
   **discards `hint` and `details`** — while PostgREST deliberately puts the actionable cause
   in `hint`. Either way the operator saw no usable diagnostic.

   **Honest correction on this point.** In the installed `@supabase/postgrest-js@2.107.0`,
   `PostgrestError` **does** subclass `Error` (verified by reading
   `node_modules/@supabase/postgrest-js/src/PostgrestError.ts`), so the `String(e)` branch is
   _not_ proven to be what produced the reported `[object Object]`. Identifying the exact
   object that reached the toast requires reproducing the failure with an authenticated
   session, which was not available (see gate 22). What **is** confirmed is defect 1 above —
   the missing stored function — and that is the reason no record was ever saved. The error
   normalization is therefore justified as (i) a real information fix, since `hint`/`details`
   were being dropped, and (ii) defence in depth that makes `[object Object]` structurally
   impossible regardless of what is thrown. It is not presented as a verified root cause of
   the message itself.

**Fix.** The RPC remains the preferred path. Only when the error is specifically a
_missing function_ (`PGRST202` / `PGRST203` / `42883`, or a "could not find the function" /
"schema cache" message) does the client fall back to an equivalent direct write that:

- resolves target days from the same operational calendar (`scheduling_settings.working_days`,
  default Saturday–Thursday; Friday is never targeted);
- pre-validates **every** target day before any DML, so a single overlapping day rejects the
  whole request — no partial application;
- inserts all planned days in **one** statement, so the write is atomic;
- is filtered by `college_id` on both the read and the insert, and relies on exactly the same
  authorization already in force: RLS `can_manage_college(auth.uid(), college_id)` for
  INSERT/UPDATE/DELETE and `can_view_college` for SELECT.

A permission denial (`42501`) or a uniqueness violation (`23505`) is deliberately **not**
treated as a missing function, so an RLS rejection still surfaces as a real error rather than
being masked by the fallback. This is asserted by test.

Deletes were additionally hardened: they are now filtered by `college_id` as well as `id`, and
they `select("id")` to confirm the affected row. A delete that RLS silently reduces to zero rows
now raises an explicit Arabic error instead of showing "تم الحذف". Every mutation's `onError`
also invalidates the relevant query so the list cannot keep showing a stale state.

### Gap 2 — React hydration error #418 on unauthenticated `/dashboard` → `/auth`

The authenticated subtree is `ssr: false`, so the server sends an **empty** shell for
`/dashboard` (confirmed: the server body was empty Suspense boundaries). The gate then resolved
its redirect to `/auth` in a pre-render router hook, i.e. **before** the first client render. So
the first client render was the fully rendered `/auth` tree while the server HTML was empty —
a guaranteed mismatch, and React discarded the entire root tree.

**Fix.** The subtree stays client-only, but the **first** client render is now `null`, which is
byte-identical to what the server produced. The session is resolved in an effect _after_
hydration via `supabase.auth.getUser()`, and the redirect to `/auth` becomes an ordinary client
navigation that happens outside hydration. While the session resolves, an RTL
"جارٍ التحقق من الجلسة…" placeholder is shown.

No `suppressHydrationWarning`, no `typeof window` branch inside the gate, no swallowed error,
and no weakened guard: the check is still `getUser()` (server-revalidated), and it still
redirects when there is no user. Authorization itself was never in this file — it is enforced by
RLS on every table and function — so college isolation is unchanged.

### Gap 3 — approval → publish → print flow

- **Reachability.** The printable timetable route `/timetable/$versionId/print` existed and was
  linked from the schedule editor, but **not** from `/published-schedules` — the surface staff
  actually use to distribute approved timetables. A primary «طباعة وتصدير» action was added to
  each published card (`data-testid="published-print-link"`), alongside the read-only view.
- **Clipping.** The shared `<Table>` primitive wraps every table in `div.overflow-auto`. On
  screen that scrolls; on paper it **clips** every column past the viewport width, silently
  truncating wide A3 sheets. Print CSS now forces `overflow: visible` and `max-height: none` for
  any scroll container inside a printed sheet.
- **Page breaks.** Column headers now repeat on continuation pages
  (`display: table-header-group`), rows never split (`break-inside: avoid`), and the
  identification header is never orphaned from its table (`page-break-after: avoid`).
- **RTL / long names.** Cells wrap with `word-break: break-word` so long Arabic course names do
  not overflow, while time cells stay on one line. The sheet remains RTL (`dir="rtl"` at the
  document root).
- **Identification.** Verified by test that each printed sheet still carries university, college,
  department, programme, level, study system, term/year, version status, version number, export
  date and «صفحة x من y», plus the draft watermark, the published endorsement line and the demo
  warning. So a distributed copy is self-identifying and a draft copy cannot be mistaken for an
  approved one.

---

## 4. Auth / RLS / SQL impact

- **SQL executed against the database**: read-only introspection only (`pg_proc`, `pg_policies`,
  `pg_constraint`). No DDL, no DML.
- **Migrations**: none added, none applied, none edited.
- **RLS policies**: unchanged. The fallback write path depends on the pre-existing policies
  (`can_manage_college` for writes, `can_view_college` for reads) and adds explicit `college_id`
  filters as defence in depth.
- **RBAC**: unchanged. No role table, role function, or capability check was modified.
- **Auth**: no credential reset, no provider change, no session-storage change. The auth gate
  change is a render-timing change only; the session check remains `getUser()`.
- **Privileged access**: the fallback uses the ordinary browser client. No service role, no
  admin client, no SECURITY DEFINER, no policy bypass. Asserted by test.
- **Production data**: not mutated. TEST_ONLY data was not modified.

---

## 5. Supabase official docs / changelog review

Checked against current official Supabase documentation and changelog for anything that would
change the assumptions above:

- **PostgREST error shape / missing-function codes.** `PostgrestError` **does** subclass `Error`
  and still exposes `message`, `details`, `hint`, `code` — confirmed both in the current upstream
  source and in the installed `@supabase/postgrest-js@2.107.0`. Official guidance ("Handling
  errors in supabase-js") explicitly says to read `hint` **first** and to log the whole object,
  because logging only `message` hides the actionable fix — which is precisely the defect
  corrected here. `PGRST202` remains the code for "could not find the function in the schema
  cache" and `PGRST203` for an ambiguous overload; branching on `code` rather than message text
  is the documented practice, and `errors.ts` does that with message matching only as a fallback.
  An open upstream issue (`supabase-js#1643`) concerns the _TypeScript typing_ of `error` in a
  failed response, not runtime behaviour.
- **Confirming affected rows on delete.** `.delete()` still returns no rows unless a
  `.select()` is chained, and rows invisible/unwritable under RLS are silently excluded rather
  than raising. Chaining `.select("id")` and checking the length remains the correct way to
  detect a no-op delete — which is exactly what was added.
- **`getUser()` vs `getSession()`.** Guidance is unchanged: `getUser()` revalidates with the
  Auth server and is the correct choice for a trust decision, while `getSession()` reads local
  storage. The gate keeps `getUser()`.

No breaking API change was found that affects this stage. If a future `supabase-js` release
changes the rejection shape, `normalizeWriteError` degrades safely (it never emits
`[object Object]`) and the missing-function detection would simply stop matching, which fails
**closed** onto the RPC error rather than silently writing.

---

## 6. Remaining runtime steps (not performed here)

1. **Authenticated runtime E2E — BLOCKED.** No authenticated session was available in this
   environment, so the college-admin unavailability save was **not** exercised end-to-end
   against the live database. No runtime proof is fabricated. After review, a college_admin on
   TEST-SIMP-03 should: add one lecturer unavailability window for «كل أيام الدوام», confirm a
   success toast whose day count matches the active working days, confirm the rows appear in the
   list, then delete one and confirm the row disappears. A deliberate overlapping window should
   be rejected with an Arabic message and create **nothing**.
2. **Preferred permanent fix for gap 1.** The client fallback closes the gap without touching
   the database, but the durable fix is to apply the SOURCE-ONLY migration that defines the two
   bulk RPCs. That is a migration action and is deliberately out of scope for this stage. Until
   it is applied, the fallback carries the write; once applied, the RPC path takes over
   automatically with no code change.
3. **Print proof on paper.** Print-to-PDF one approved TEST-SIMP-03 sheet at A3 landscape and
   confirm no column is cut, headers repeat, and the identification block is intact. CSS
   assertions cannot fully substitute for a rendered PDF.
4. **Deployment.** On approval, deploy and re-run steps 1 and 3 against the published URL.

### Honest limitations

- The gap-1 fallback is **client-orchestrated**. The insert itself is a single atomic statement,
  but the preceding read-then-plan is not inside one transaction: if another user inserts an
  overlapping window in the gap between the read and the insert, the insert can still fail.
  It fails **loudly** with a readable Arabic error and refetches — it does not write partially
  and does not report success. A true transactional guarantee requires the server-side RPC.
- The hydration fix is verified for the unauthenticated `/dashboard` → `/auth` path. Other
  routes were not individually re-driven in a browser.
- Print correctness is asserted at the CSS/markup contract level; visual paper output still
  needs the human check in step 3.

## 7. Rollback reference

- Baseline to roll back to: **`5201d1efaf7f6b2d73cca23f62f4bb23e43f7dd1`**.
- All changes are source-only and confined to the nine files listed in §2. Reverting that commit
  range restores the previous behaviour exactly; because no migration, policy, role, or row was
  changed, **no database rollback is required or possible to owe**.
- Partial rollback is safe per gap: the three fixes touch disjoint files apart from nothing
  shared, so `src/lib/availability/*` (gap 1), `src/routes/_authenticated/route.tsx` (gap 2) and
  `src/styles.css` + `published-schedules.tsx` (gap 3) can be reverted independently.
