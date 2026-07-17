# PHASE-9.4-TEACHING-ASSIGNMENTS-V2-RUNTIME-FOUNDATION-REMEDIATION-01

## 1. Decision

**PASS — PHASE_9_4_REMEDIATION_COMPLETE_PR_UPDATED**

(Finalized after commit + non-force push to PR #32.)

## 2. Previous head

| Item | Value |
|---|---|
| Previous PR head | `b77c046b91478a2c565d1bd604cc3173ac56def9` |
| Base main | `97c0ea0e8f1d82c6aacc61ee2010625495bdb32d` |
| Local branch | `phase-9-4-teaching-assignments-remediation-01` |
| Remote PR branch | `phase-9-4-teaching-assignments-v2-runtime` |
| PR | https://github.com/msorori-mh/usrtimetable/pull/32 |

G0 identity gate passed before edits (clean worktree; local HEAD = remote PR = expected SHA; PR OPEN non-draft; base main).

## 3. Files changed

- `supabase/migrations/20260717043000_teaching_assignments_v2_runtime_foundation.sql`
- `src/lib/academic-delivery/teaching-assignments-v2.ts`
- `src/lib/academic-delivery/teaching-assignments-v2-service.ts`
- `src/lib/academic-delivery/workload.ts`
- `src/lib/excel-import/commit.ts`
- `src/lib/excel-import/validators.ts`
- `src/routes/_authenticated/teaching-assignments.tsx`
- `src/components/timetable/session-dialog.tsx`
- `src/integrations/supabase/types.ts`
- `tests/harness/teaching-assignments-v2-runtime.harness.ts`
- `implementation-reports/PHASE-9.4-TEACHING-ASSIGNMENTS-V2-RUNTIME-FOUNDATION-REMEDIATION-01-REPORT.md`

Not committed: `node_modules/`, `package-lock.json` (absent), `src/routeTree.gen.ts` (build-time CRLF noise only).

## 4. Workspace SQL compilation fix

`list_teaching_assignment_workspace` no longer does `SELECT * FROM compute_delivery_group_allocation` then `alloc_raw->>'…'` on a record.

It now selects an explicit jsonb scalar:

`SELECT public.compute_delivery_group_allocation(dg.id) AS allocation_json`

then reads fields from `alloc_src.allocation_json`. Static ASSERT comment added. NULL-safe numeric/boolean defaults applied.

## 5. Inactive delivery-group protection

- `ensure_ta_college` rejects active assignments when `delivery_groups.active = false` with `DELIVERY_GROUP_INACTIVE_ASSIGNMENT_FORBIDDEN` (obsolete remains distinct).
- `assert_delivery_group_assignable` used by create/update/import.
- Preview + candidates + workspace conflicts expose inactive.
- UI hides create/edit/reactivate actions for inactive/obsolete groups.
- Import validator rejects inactive groups.
- Historical inactive/obsolete rows untouched (deactivate of assignments still allowed).

## 6. Inactive assignment / session protection

`ensure_ss_college` replaced in Phase 9.4 migration only (Phase 9.3 file untouched):

- New / changed `teaching_assignment_id` requires `is_active = true` else `INACTIVE_ASSIGNMENT_SESSION_FORBIDDEN`.
- New / changed delivery_group link rejects obsolete and inactive DG.
- Unrelated UPDATEs on historical sessions with same TA id are not rejected.
- Session dialog selector filters `is_active = true`.

## 7. Import direct-DML removal

`commitTeachingAssignmentsV2` no longer `.insert` / `.update` / `.upsert` on `teaching_assignments`.

It prepares rows in TypeScript and calls `commitTeachingAssignmentsV2Import` → RPC `commit_teaching_assignments_v2_import`.

Legacy `teaching_assignments` import path unchanged (out of V2 scope).

## 8. Import atomic RPC and lock order

`commit_teaching_assignments_v2_import(p_rows jsonb, p_mode text)`:

- SECURITY DEFINER + `auth.uid` + `can_manage_college` (college derived from delivery_group; client college not trusted).
- Pre-validates all rows before any DML; validation failure → `status=failed`, zero counters, zero audit.
- Locks distinct `delivery_group_id` ASC via `lock_delivery_group_for_assignment`.
- Lock order: delivery_group → active assignment rows (`ORDER BY ta.id`) → target row.
- Atomic all-or-nothing apply; per-row audit; no sessions / generator.

## 9. Concurrency protection

Shared helpers:

- `lock_delivery_group_for_assignment`
- `validate_assignment_allocation_locked`
- `assert_delivery_group_assignable`

Used by create / update / deactivate / import. Optimistic `p_expected_updated_at` retained. Runtime race proof deferred until migration apply (static locking contract asserted in harness).

## 10. Internal helper ACL

- `resolve_offering_for_delivery_group`: SECURITY INVOKER; REVOKE PUBLIC/anon/authenticated; no client GRANT.
- `assert_delivery_group_assignable`, `lock_delivery_group_for_assignment`, `validate_assignment_allocation_locked`: SECURITY INVOKER; REVOKE PUBLIC/anon/authenticated; no client GRANT.

## 11. Audit unification

Import emits the same actions as UI RPCs:

- `teaching_assignment_created`
- `teaching_assignment_reactivated`
- `teaching_assignment_hours_updated`
- `teaching_assignment_deactivated` (when import sets inactive)

Actor = `auth.uid()`; `import_batch_id` in details; unchanged rows emit no mutation audit; failed validation → zero audit.

## 12. Lifecycle behavior

Create / reactivate / update hours / soft deactivate unchanged in intent; inactive/obsolete DG blocked for active writes; soft deactivate still allowed.

## 13. Co-teaching behavior

Sole fallback and 2+1 / over-allocation rules retained; allocation rechecked after locks in RPC + import paths.

## 14. UI / import behavior

- Inactive/obsolete groups: no assign/edit action buttons.
- Workspace conflicts include `INACTIVE_DELIVERY_GROUP`.
- Import surfaces validation errors; non-`ok` batch is not treated as success.
- Types include `commit_teaching_assignments_v2_import`.

## 15. Migration path — NOT APPLIED

File: `supabase/migrations/20260717043000_teaching_assignments_v2_runtime_foundation.sql`

Status remains **CREATED — NOT APPLIED**.

No Supabase CLI, no db push/reset/repair/seed, no RPC execution against DB, no backfill/fixture/operational data.

## 16. Schedule Builder compatibility

No Schedule Builder redesign. Session save/validate/move RPC signatures not rewritten. Session dialog only filters active assignments for selection. Legacy `course_offering_id` still populated via resolve helper.

## 17. Harness / typecheck / build / eslint

| Gate | Result |
|---|---|
| Phase 9.4 harness | PASS |
| `npx tsc --noEmit` | PASS |
| `npm run build` | PASS |
| eslint (substantive changed files) | PASS |
| `git diff --check origin/main...HEAD` | PASS |
| package-lock.json | not created |
| Full harness suite other files | pre-existing failures unrelated (missing local reports / UI markers) — not Phase 9.4 scope |

session-dialog retained pre-existing `@typescript-eslint/no-explicit-any` issues outside the `is_active` filter change; not expanded.

## 18. Safety confirmations

| Constraint | Status |
|---|---|
| no DB writes | confirmed |
| no migration apply | confirmed |
| no operational-data import | confirmed |
| no RPC execution against DB | confirmed |
| no generator | confirmed |
| no sessions created | confirmed |
| no deploy | confirmed |
| no publish | confirmed |
| no merge | confirmed |
| no force-push | confirmed |
| no stash/reset/clean | confirmed |

## 19. Next phase

**PHASE-9.4-TEACHING-ASSIGNMENTS-V2-RUNTIME-FOUNDATION-PR-REREVIEW-01**

Do not apply Migration until re-review PASS.

---

## Security Review

- Files changed: listed in §3
- Did migrations change? **yes** (unapplied Phase 9.4 source only)
- Did RLS change? **no**
- Did RPCs change? **yes** (workspace fix, helpers, ensure_ss_college, import batch, ACL)
- Authentication impact: **yes** (auth.uid retained; import gated)
- Authorization impact: **yes** (resolve_offering revoked from clients; import can_manage)
- Sensitive data exposure: **no** (reduced vs prior ungated resolve)
- Privilege escalation risk: **no**
- Production risk: **low** (migration still not applied)
- Ready for merge: **no** (await re-review)
- Ready for deploy: **no**
