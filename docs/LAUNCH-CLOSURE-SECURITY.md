# LAUNCH-CLOSURE-SECURITY — security review, per-function audit matrix and applied hardening

Baseline: `ea0ab1dbb062dcb292c2c1cee10e2c75e09a30a8` (production identical at start).
Database workflow: **Lovable-native tracked migration only.** The separate root Supabase
connector was denied previously and was neither used nor retried.
No frontend deployment was performed by the agent. No auth resets, no secrets, no real-data
mutations.

---

## 1. Applied change (one tracked migration)

| Item | Value |
| --- | --- |
| Migration version | `20260910075951` |
| Tracked file | `supabase/migrations/20260910075951_851a8f41-edfa-44c7-8054-1bde02522935.sql` |
| Proposed artifact (identical body) | `docs/migrations-proposed/20260910T0800_availability_helper_search_path_hardening.sql` |
| Previous tracked version | `20260910011503` |
| Statements | 4 × `ALTER FUNCTION … SET search_path = pg_catalog` + 3 self-verifying assertion blocks |

Functions hardened (all four were `SECURITY INVOKER` with **no** fixed `search_path`):

| Function | Volatility | Definer? | search_path before | after |
| --- | --- | --- | --- | --- |
| `public._avail_time_span(time, time)` | IMMUTABLE | no | *(unset)* | `pg_catalog` |
| `public._avail_day_span(smallint)` | IMMUTABLE | no | *(unset)* | `pg_catalog` |
| `public._avail_date_span(date, date)` | IMMUTABLE | no | *(unset)* | `pg_catalog` |
| `public.validate_room_unavailability_window()` | VOLATILE (trigger) | no | *(unset)* | `pg_catalog` |

**Compatibility verified before applying.** `pg_get_functiondef` was read from production for
all four. Every identifier they resolve is a pg_catalog built-in — `tsrange`, `daterange`,
`int4range`, `coalesce`, the date/time/int casts, the `date + time` operator, `to_char`, and
plpgsql `RAISE`. None touches `public`, `extensions`, or any user table, so `pg_catalog` alone
is sufficient. `pg_temp` was deliberately **excluded** so no session-local temporary object can
shadow a built-in while an index expression is evaluated.

`ALTER FUNCTION … SET` writes only `pg_proc.proconfig`. It changes **no OID**, no volatility, no
signature, no body and no ACL — so the two GiST exclusion constraints that embed these
functions in index expressions keep working with no index rebuild and no constraint recreation.

### Pre/post state (independently re-read after apply)

| Metric | Before | After |
| --- | --- | --- |
| `instructor_availability` rows | 0 | 0 |
| `room_unavailability` rows | 1 | 1 |
| Availability + audit policies | 10 | 10 |
| Availability exclusion constraints | 2 | 2 |
| Full `public` policy fingerprint (md5) | `6816e8d9bff53ae162016e3b75fdb117` | `6816e8d9bff53ae162016e3b75fdb117` |
| `SECURITY DEFINER` functions with unpinned search_path | 4 helpers were INVOKER-unpinned; 0 definer-unpinned | 0 |
| `SECURITY DEFINER` functions executable by `anon` | 0 | 0 |
| Helper volatility / definer flag | IMMUTABLE×3, INVOKER×4 | unchanged |

Post-apply index definitions re-read and confirmed unchanged (both still reference
`_avail_time_span` / `_avail_day_span` / `_avail_date_span` in their expressions).

### Proof before applying

`scripts/local-db/availability-temporal-integrity-proof.sh` on a **disposable PostgreSQL 17.9
cluster** (new `AVAIL_PROOF_EXTRA_SQL` hook applies the hardening *before* the case suite, so
every case runs against the hardened state):

```
RESULT: all cases PASS on the disposable database
```

44 PASS: the original 40 cases (object shape/privileges, temporal semantics, instructor writes,
room date-window/whole-day/all-week writes, read-only-viewer and anon denial), the real
two-connection concurrency race (`23P01`, exactly one row survived), both bulk RPCs, the
rollback script, the preflight script, plus 4 new cases — helpers pinned to `pg_catalog`, span
helpers still IMMUTABLE, helpers still `SECURITY INVOKER`, relocation probe reverted.

---

## 2. `btree_gist` in `public` — assessment, and why it was NOT relocated

| Property | Finding |
| --- | --- |
| Current schema | `public` |
| `extrelocatable` | `true` |
| Dependents | Supplies the `=` GiST operator classes used by both availability exclusion constraints |
| Other extensions | `pg_stat_statements`, `pgcrypto`, `uuid-ossp` already live in `extensions`; `plpgsql`/`supabase_vault` are non-relocatable |

Runtime probe (`scripts/local-db/btree-gist-relocation-probe.sql`, disposable cluster only):

```
PROBE relocation: existing_constraints_preserved=t new_ddl_ok=t new_ddl_err=none
PROBE relocation: reverted to public, extension schema now public
```

So relocation is mechanically reversible and does not break stored opclass references (index
definitions store opclass OIDs, not names). **It was still not applied**, because the probe
cluster's `search_path` defaults are not proof of the production role/migration search_path
used by *future* DDL that adds a GiST exclusion constraint. Relocating would make that a latent
break with no security gain beyond an advisor `WARN`, and the change is not unambiguously safe —
so per the stop-on-ambiguity instruction it is recorded as an **accepted documented residual**
rather than applied. No privileges were broadened either way.

---

## 3. Per-function audit matrix — every exposed `SECURITY DEFINER` function

Population read from `pg_proc` on production (not from source files):

| Measure | Count |
| --- | --- |
| `SECURITY DEFINER` functions in `public` | **81** |
| …with a fixed `search_path` | **81** (0 unpinned) |
| …with default (PUBLIC) ACL | **0** |
| …executable by `anon` | **0** |
| …executable by `authenticated` | **40** ← the advisor's 40 entries |
| …restricted to `postgres`/`service_role` only | **41** |
| Private `_`-prefixed implementations executable by `authenticated` | **0** |

**All 41 restricted functions** are private implementation internals (`_import_apply_*`,
`_import_dispatch`, `_import_find_or_create_*`, `_ss_*`, `_sb_v2_*`,
`_collect_schedule_session_move_conflicts`, …). Their ACL is already
`postgres=X | service_role=X` — no client role can call them. **No action required.**

The 40 `authenticated`-callable functions, classified by guard (bodies read via
`pg_get_functiondef`):

| Class | Functions | Guard | Verdict |
| --- | --- | --- | --- |
| RLS/RBAC predicate helper (read-only boolean) | `can_manage_college`, `can_view_college`, `has_role`, `is_super_admin`, `is_institutional_viewer`, `is_institutional_read_only_actor`, `user_in_college` | Parameterised membership/role lookup only; no write, no privilege grant. `SECURITY DEFINER` is *required* so RLS policies avoid recursion on `user_roles`/`user_colleges`. | **Legitimate — keep.** Revoking breaks every policy. |
| Guarded mutating RPC | `approve_capacity_split_proposal`, `approve_scheduling_cohort_term_headcount`, `archive_scheduling_headcount_override`, `begin_schedule_quality_snapshot`, `commit_import_job_atomic`, `commit_teaching_assignments_v2_import`, `create_schedule_session_from_assignment_v2`, `create_teaching_assignment_v2`, `update_teaching_assignment_v2`, `deactivate_teaching_assignment_v2`, `generate_cohort_curriculum`, `generate_cohort_delivery_groups`, `move_or_reschedule_schedule_session`, `persist_schedule_quality_run`, `purge_disposable_draft_schedule_version`, `resolve_scheduling_headcount`, `transition_schedule_version`, `upsert_scheduling_cohort_term_headcount`, `upsert_scheduling_headcount_override` | Body contains an explicit `auth.uid()` + `can_manage_college` / `has_role` / `is_super_admin` check before any DML. | **Legitimate — keep.** |
| Guarded read/compute RPC | `compute_delivery_group_allocation`, `compute_instructor_standard_workload`, `get_delivery_group_assignment_candidates`, `list_schedule_builder_v2_work_items`, `list_scheduling_headcount_revisions`, `list_teaching_assignment_workspace`, `preview_instructor_workload_after_assignment`, `validate_schedule_session_move` | Same explicit college/role guard; returns data only for the caller's college. | **Legitimate — keep.** |
| Integrity trigger | `enforce_academic_term_delete_integrity`, `enforce_room_delete_integrity` | Trigger functions; only reachable via DML on their own table, which RLS already gates. `authenticated` EXECUTE is inert for triggers. | **Legitimate — keep.** |
| Import lifecycle RPC (initially flagged) | `create_import_preview_manifest`, `claim_import_job_manifest`, `finalize_import_job`, `fail_import_job` | No literal guard string in the body — they delegate to `public.import_manager_actor(p_college_id)`, which raises `28000` when `auth.uid()` is NULL and `42501` when `NOT can_manage_college(auth.uid(), p_college_id)`. Each then re-scopes by `college_id` **and** `created_by = actor` **and** a status/manifest-md5 precondition under `FOR UPDATE`. | **Legitimate — keep.** False positive of the name-pattern scan; confirmed by reading `import_manager_actor`. |

**No unguarded, directly-callable private implementation is exposed.** Therefore **no EXECUTE
grant was revoked** — there was no actual unsafe grant to fix. No production mutator was invoked
to probe, and no legitimate helper was arbitrarily revoked. This is a real negative finding
backed by `pg_proc`/`has_function_privilege` reads and body inspection, not a source-only PASS.

---

## 4. Residual risk assessment

| # | Residual | Severity | Rationale / mitigation |
| --- | --- | --- | --- |
| R1 | Advisor `WARN 0029` will keep reporting 40 `authenticated`-callable `SECURITY DEFINER` functions | Accepted | Each is guarded (matrix §3). This is architecturally required: RLS predicate helpers must be definer to avoid recursion, and the mutating RPCs are the authorization boundary itself. Revoking would break login-scoped reads, imports and scheduling. |
| R2 | `btree_gist` in `public` (`WARN 0014`) | Low, accepted | §2. Relocation proven reversible but not unambiguously safe for future GiST DDL; no privilege exposure — the extension grants nothing to `anon`/`authenticated` beyond operator classes. |
| R3 | Anonymous surface | None found | 0 `SECURITY DEFINER` functions executable by `anon`; 0 default-PUBLIC ACLs. |
| R4 | Runtime role matrix (anon / read-only viewer / own-college / cross-college) proven on the disposable cluster, not against production | Accepted | Cases 3.9, 3.10, 5.1–5.6 cover all four roles against the identical schema. Proving them in production would require mutating real data, which is out of scope by instruction. |
| R5 | `pg_temp` excluded from the four helpers' search_path | Intentional | These bodies never use temp objects; exclusion removes a shadowing vector. |
| R6 | Older advisor notes about legacy definer functions lacking search_path | Closed | Production now reports **0** unpinned `SECURITY DEFINER` functions. |

---

## 5. Gates

| Gate | Result |
| --- | --- |
| Disposable-DB proof (40 original + 4 new cases, concurrency, RPCs, rollback, preflight) | PASS — 44/44 |
| `btree_gist` relocation probe | PASS (proven, deliberately not applied) |
| Native tracked migration `20260910075951` | Applied, self-verifying assertions passed |
| Independent post-verify (rows / policies / fingerprint / constraints / index defs) | PASS, all unchanged |
| Prettier / typecheck / lint / `bun test` / harness / build | See §6 |
| Frontend deployment | **Not performed** (per instruction) |

## 6. Files changed

- `docs/migrations-proposed/20260910T0800_availability_helper_search_path_hardening.sql` (new)
- `supabase/migrations/20260910075951_851a8f41-edfa-44c7-8054-1bde02522935.sql` (native, tracked)
- `scripts/local-db/btree-gist-relocation-probe.sql` (new, disposable cluster only)
- `scripts/local-db/availability-temporal-integrity-proof.sh` (`AVAIL_PROOF_EXTRA_SQL` /
  `AVAIL_PROOF_PROBE_SQL` hooks + cases 8.1–8.4)
- `tests/launch-closure-security.test.ts` (new)
- `docs/LAUNCH-CLOSURE-SECURITY.md` (this report)

No application source, RLS policy, role, grant or row was changed.
