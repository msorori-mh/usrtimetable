# PHASE-9.3-DELIVERY-GROUPS-AND-WORKLOAD-ENGINE-REMEDIATION-01

## 1. Decision

**PASS — PHASE_9_3_REMEDIATION_COMPLETE_PR_UPDATED**

## 2. Baseline and previous head

| Ref | SHA |
|---|---|
| Previous PR head | `186b0cc88999225639d63a2008d1c92c8ffd6cd6` |
| Baseline `origin/main` | `cdc11b5f5940bd365fcde18e2b56dcf9e28ee2dc` |
| Branch | `phase-9-3-delivery-groups-workload` |
| PR | https://github.com/msorori-mh/usrtimetable/pull/31 |

G0 identity gate: clean worktree, branch correct, local = remote = PR head, PR open/non-draft, base `main`. `origin/main` unchanged from baseline (no merge/rebase).

## 3. Files modified

| Path | Change |
|---|---|
| `supabase/migrations/20260716233716_73dc0ba0-e4ba-43be-8628-ef2c36564a62.sql` | Canonical Phase 9.3 SQL (applied payload; original source version `20260716070000`) |
| `src/lib/academic-delivery/workload.ts` | Co-teaching + plan/course pure validators |
| `src/lib/academic-delivery/delivery-groups.ts` | Obsolete lifecycle + offering resolve/dedupe |
| `src/lib/academic-delivery/delivery-group-generator-summary.ts` | `status` contract + helpers |
| `src/hooks/use-generate-delivery-groups.ts` | No success toast on validation failure |
| `src/routes/_authenticated/academic-cohorts.tsx` | Summary panel + obsolete badge |
| `src/routes/_authenticated/delivery-groups.tsx` | Obsolete badge (read-only) |
| `src/integrations/supabase/types.ts` | `is_obsolete`, `assigned_component_hours`, view/RPC types |
| `tests/harness/delivery-groups-workload-engine.harness.ts` | Remediation coverage |
| `implementation-reports/PHASE-9.3-DELIVERY-GROUPS-AND-WORKLOAD-ENGINE-REMEDIATION-01-REPORT.md` | This report |

## 4. Workload isolation fix

**Choice: `security_invoker = true` on `v_instructor_delivery_workload`.**

Reason: source tables (`teaching_assignments`, `instructors`, `delivery_groups`, `plan_course_components`, `academic_cohorts`) already have college-scoped RLS via `can_view_college`. Invoker mode makes PostgREST SELECT respect caller RLS instead of view-owner bypass.

Also:

- `REVOKE ALL … FROM PUBLIC, anon`
- `GRANT SELECT` only to `authenticated`, `service_role`
- RPC `compute_instructor_standard_workload` remains `SECURITY DEFINER` with `SET search_path = public`, `auth.uid()` null reject, and `can_view_college` / `can_manage_college` **before** aggregate read

## 5. Co-teaching hours contract

- Added nullable V2 column `teaching_assignments.assigned_component_hours` (no backfill).
- Legacy `weekly_hours NOT NULL DEFAULT 3` retained for Schedule Builder compatibility and is **ignored** by V2 workload math.
- Sole instructor: `COALESCE(assigned_component_hours, weekly_contact_hours)`.
- Multi-instructor: only explicit `assigned_component_hours`; missing split → `CO_TEACHING_HOURS_SPLIT_REQUIRED`; sum > component hours → `CO_TEACHING_HOURS_OVER_ALLOCATED`.
- Project hours separate; summer excluded; NULL does not become DEFAULT 3.

## 6. Plan/course integrity

`ensure_ta_college` (V2 when `delivery_group_id` present) now enforces:

- `OFFERING_PLAN_COURSE_MISMATCH`
- `COMPONENT_PLAN_COURSE_MISMATCH`
- `OFFERING_COHORT_CONTEXT_MISMATCH` (college/term/program/level/study_system)
- Existing cohort/component/college checks retained

Legacy rows without V2 links remain untouched.

## 7. Atomic / partial generator contract

Adopted **atomic pre-validate**:

1. Materialize one row per `plan_course_component` (`DISTINCT ON (pcc.id)`).
2. Pass 1 validates all components with **zero DML**.
3. Any `validation_errors` → return `status: VALIDATION_FAILED`, zero create/update/obsolete counters, empty warnings/skips from DML.
4. Pass 2 runs DML only when validation is clean → `SUCCESS` or `NO_CHANGES`.

`PARTIAL` is reserved/not used for this phase (not intentional).

## 8. Obsolete group lifecycle

- Column `delivery_groups.is_obsolete BOOLEAN NOT NULL DEFAULT FALSE` (safe for existing rows; no backfill).
- Surplus groups marked obsolete, never deleted.
- Reactivation clears `is_obsolete` on the same `(cohort, component, group_number)` natural key.
- New teaching assignments / new session links to obsolete groups blocked.
- Existing linked history retained with warnings.
- UI shows obsolete badge and “no new assignments/sessions” note.

## 9. Duplicate offering handling

- Generation key: cohort + plan_course + component.
- Multiple compatibility offerings for the same component: deterministic pick (`created_at DESC`, `id ASC`) via `DISTINCT ON`; one generation pass only.
- Conflicting `plan_course_id` values for one generation key → `AMBIGUOUS_COMPATIBILITY_OFFERINGS` (helper `resolve_compatibility_offering_set` + pure TS mirror).
- Unique index `dg_cohort_component_group_number_uniq` remains concurrency backstop.

## 10. UI behavior

- Generate remains explicit + `canManage` gated + AlertDialog confirm.
- `toast.success` only when `status` is success-class and `validation_errors` empty.
- Validation failure → `toast.error` (no false success).
- Warnings may accompany success via `toast.warning`.
- Structured summary panel shows status / errors / warnings.
- No Schedule Builder changes; no manual DG CRUD.

## 11. Migration path — canonical after Lovable apply

- Original implementation source version: `20260716070000`
- Canonical repository/history version: `20260716233716`
- File: `supabase/migrations/20260716233716_73dc0ba0-e4ba-43be-8628-ef2c36564a62.sql`
- Applied payload SHA-256: `AAF86E1C625F671C336EF5367A6F3013A3C0ACDADC8583E72491A8EBA9700445`
- Payload unchanged; migration not reapplied in remediation.
- Duplicate source `20260716070000_delivery_groups_workload_engine.sql` removed to prevent future pending/reapply risk.

No Supabase CLI, no db push/reset/seed/repair, no generator execution, no live DML.

## 12. Harness / typecheck / build / eslint

| Check | Result |
|---|---|
| Phase 9.3 harness | **PASS** |
| `tsc --noEmit` | **PASS** |
| `npm run build` | **PASS** |
| eslint (changed files) | **PASS** |
| `git diff --check` | **PASS** |

Runtime DB tests remain deferred until migration-apply-verify.

## 13. Schedule Builder compatibility

- No SB workspace/query/move RPC contract changes.
- Generator does not create sessions.
- Legacy `course_offering_id` / `weekly_hours` retained.
- Static harness asserts SB routes/workspace preserved.

## 14. Confirmations

| Constraint | Confirmed |
|---|---|
| No DB writes | Yes |
| No migration apply | Yes |
| No `generate_cohort_delivery_groups` against DB | Yes |
| No deploy / publish | Yes |
| No merge | Yes |
| No stash/reset/clean/delete | Yes |
| No rebase / force-push | Yes |
| Phase 9.1 / 9.2 migrations untouched | Yes |
| Worktree only | Yes |

## 15. Next stage only

**PHASE-9.3-DELIVERY-GROUPS-AND-WORKLOAD-ENGINE-PR-REREVIEW-01**

## Security Review

| Item | Value |
|---|---|
| Files changed | listed in §3 |
| Did migrations change? | yes (unapplied 9.3 source only) |
| Did RLS change? | yes (`faculty_workload_policies`; view invoker) |
| Did RPCs change? | yes (generator, workload, offering helper; `ensure_ta_college` / `ensure_ss_college`) |
| Authentication impact | yes (`auth.uid` gates) |
| Authorization impact | yes (college gates + invoker RLS) |
| Sensitive data exposure | mitigated (view invoker + revoke PUBLIC/anon) |
| Privilege escalation risk | low |
| Production risk | low until apply; apply still blocked pending re-review |
| Ready for merge | no (await re-review) |
| Ready for deploy | no |
| Ready for migration apply | no until PR-REREVIEW passes |

---

## Final report checklist

1. Summary: Remediation complete; PR updated; migration still NOT APPLIED.  
2. Files modified: §3.  
3. Security Review: above.  
4. Verification: harness/typecheck/build/eslint/diff-check PASS.  
5. Migration status: CREATED — NOT APPLIED.  
6. Production impact: none (source-only).  
7. Remaining risks: live DB authorization/atomicity still deferred to apply-verify.  
8. Recommended next step: PHASE-9.3-DELIVERY-GROUPS-AND-WORKLOAD-ENGINE-PR-REREVIEW-01.
