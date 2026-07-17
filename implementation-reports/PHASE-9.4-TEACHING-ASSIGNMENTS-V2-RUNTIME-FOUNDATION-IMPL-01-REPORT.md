# PHASE-9.4-TEACHING-ASSIGNMENTS-V2-RUNTIME-FOUNDATION-IMPL-01

## 1. Decision

**PASS_WITH_NOTES — PHASE_9_4_TEACHING_ASSIGNMENTS_V2_RUNTIME_PR_READY**

Notes:

- Runtime DB proofs (live unauthorized / cross-college RPC, concurrent co-teach locking against applied schema) are **deferred** until migration apply.
- Migration is **CREATED — NOT APPLIED**.
- `package-lock.json` appeared from local `npm install` and was **not** committed.
- Build touched `routeTree.gen.ts` with line-ending-only noise; restored to HEAD and **not** committed.

---

## 2. Baseline

| Field | Value |
|---|---|
| Expected baseline | `97c0ea0e8f1d82c6aacc61ee2010625495bdb32d` |
| G0 HEAD | `97c0ea0e8f1d82c6aacc61ee2010625495bdb32d` |
| G0 `origin/main` | `97c0ea0e8f1d82c6aacc61ee2010625495bdb32d` |
| Branch | `phase-9-4-teaching-assignments-v2-runtime` |
| Worktree | `C:\projects\usrtimetable-phase9-4-teaching-assignments` |
| Prior status | PASS_WITH_NOTES — PHASE_9_3_DELIVERY_GROUPS_WORKLOAD_MERGED |
| Supabase project | `emzytxqkxjjhsivqxdiu` (Lovable-only management) |

G0: clean worktree, HEAD = origin/main = expected baseline → proceed.

---

## 3. Schema audit (G1)

### teaching_assignments (pre-9.4)

| Item | Current |
|---|---|
| PK | `id` |
| Legacy natural unique | `ta_unique (college, offering, instructor, session_type, section_number)` |
| V2 unique (9.3) | `(college, delivery_group, instructor)` where `delivery_group_id IS NOT NULL` |
| Legacy hours | `weekly_hours NOT NULL DEFAULT 3` |
| V2 hours | `assigned_component_hours` nullable |
| V2 FKs | `cohort_id`, `plan_course_component_id`, `delivery_group_id` |
| Compatibility | `course_offering_id` required |
| Status | **missing** before 9.4 |
| Optimistic concurrency | `updated_at` only; no expected-version gate |
| Instructor link | `instructor_id` + `ensure_ta_college` college match |
| Sessions | `schedule_sessions.teaching_assignment_id` nullable |
| Audit | client `logAudit` / table `audit_logs` (no TA DB trigger) |

### Gaps addressed in Phase 9.4

- Soft lifecycle `is_active`
- Active-only V2 uniqueness (reactivation-safe)
- Write/read RPCs with auth + college gates
- Workload preview RPC (no DML)
- Soft deactivate + hard-delete block when session-linked
- Optimistic concurrency on update/deactivate
- DB audit events for V2 mutations
- Import contract aligned to delivery_group + `assigned_component_hours`

**Not modified:** Phase 9.3 `20260716233716_…` source file.

---

## 4. Runtime contract (G2)

| RPC | Kind | Auth |
|---|---|---|
| `list_teaching_assignment_workspace` | read STABLE | `auth.uid` + `can_view_college` |
| `get_delivery_group_assignment_candidates` | read STABLE | `can_view_college` |
| `preview_instructor_workload_after_assignment` | read STABLE | `can_view_college` (no DML) |
| `compute_delivery_group_allocation` | read helper | `can_view_college` |
| `create_teaching_assignment_v2` | write | `can_manage_college` from delivery_group |
| `update_teaching_assignment_v2` | write | manage + `p_expected_updated_at` |
| `deactivate_teaching_assignment_v2` | write | manage + `p_expected_updated_at` |

All SECURITY DEFINER RPCs: `SET search_path = public`, REVOKE PUBLIC/anon, GRANT authenticated/service_role. College derived from delivery_group/cohort — client college not trusted for writes.

---

## 5. Lifecycle (G3)

- Create → `is_active = true`
- Operational remove → soft `deactivate` (history preserved)
- Reactivate → same natural key via `create_teaching_assignment_v2`
- Hard delete blocked when linked to `schedule_sessions`
- Session-linked instructor/delivery_group change forbidden
- Inactive excluded from workload view and allocation math

---

## 6. Single / co-teaching (G4)

| Mode | Hours rule |
|---|---|
| Sole instructor | `assigned_component_hours` or component `weekly_contact_hours` once |
| Co-teaching | explicit hours required for every active instructor; sum ≤ component hours |
| Project | assignable; counted in project hours only |
| Summer training | weekly assignment forbidden |
| Legacy DEFAULT 3 | never drives V2 math |

Workspace exposes: `component_hours`, `assigned_hours_total`, `remaining_hours`, `assignment_count`, `is_co_taught`, `allocation_status`.

---

## 7. Workload preview (G6)

`preview_instructor_workload_after_assignment` returns current/projected standard + project hours, deficit/overload before/after, status, `policy_missing`, warnings, assignment_conflicts. Uses `compute_instructor_standard_workload`. Overload = warning only; component over-allocation = hard conflict.

---

## 8. Authorization

- Read: `can_view_college`
- Mutate: `can_manage_college`
- Unauthenticated → `insufficient_privilege`
- Cross-college instructor/group → rejected
- UI: read-only hides write controls (`useCanManageActiveCollege` + RPC `can_manage`)

---

## 9. Integrity and concurrency

- Pre-DML validation via RPC + `ensure_ta_college`
- `SELECT … FOR UPDATE` on delivery_group and related active assignments
- Unique active `(college, delivery_group, instructor)`
- Optimistic concurrency: `STALE_ASSIGNMENT_UPDATE` when `updated_at` mismatches

---

## 10. Project / summer

- Project: allowed; standard load excluded; project hours separate
- Summer: rejected at validator, RPC, and trigger levels; excluded from workspace weekly list

---

## 11. Import alignment (G11) — no execution

`teaching_assignments_v2` template/validator/commit updated:

| Item | Contract |
|---|---|
| Required | cohort_code, course_code, component_type, delivery_group_code, employee_number |
| Optional | assigned_component_hours, study_system, is_active, notes, … |
| Natural key | cohort + course + component + delivery_group + instructor |
| Dependency | delivery_groups must exist (generator prior stage) |
| Co-teach | explicit hours required when >1 instructor per group in batch |
| Project | allowed |
| Summer | rejected |
| Idempotency | upsert by delivery_group + instructor |

No file imported. No operational data created.

---

## 12. Audit (G12)

Write RPCs insert into `audit_logs` with actions:

- `teaching_assignment_created`
- `teaching_assignment_reactivated`
- `teaching_assignment_hours_updated`
- `teaching_assignment_deactivated`

Details include assignment_id, delivery_group_id, instructor_id, component_type, old/new hours, reason (deactivate).

---

## 13. UI / service changes

| Path | Role |
|---|---|
| `src/lib/academic-delivery/teaching-assignments-v2.ts` | types + pure helpers |
| `src/lib/academic-delivery/teaching-assignments-v2-service.ts` | RPC wrappers only |
| `src/hooks/use-teaching-assignments-v2.ts` | workspace/preview/mutations |
| `src/routes/_authenticated/teaching-assignments.tsx` | V2 workspace UI |

No client direct writes to `teaching_assignments` for V2. No generator auto-run. No session creation.

---

## 14. Schedule Builder compatibility

- Legacy `course_offering_id` still required and populated via compatibility offering resolve
- No changes to schedule session save/validate/move RPCs
- No published/archived version changes
- Future SB can join: delivery_group → active teaching_assignments → instructor + assigned_component_hours
- Generation engine not integrated in this phase

---

## 15. Migration path / status

| Item | Value |
|---|---|
| Path | `supabase/migrations/20260717043000_teaching_assignments_v2_runtime_foundation.sql` |
| Timestamp | after `20260716233716` |
| Status | **CREATED — NOT APPLIED** |
| Backfill / seed / generator / sessions | None |
| Phase 9.3 migration | untouched |

Contains: `is_active`, indexes/constraints, workload view refresh (active-only), RPCs, audit inserts, grants/revokes, hard-delete guard trigger, extended `ensure_ta_college`.

---

## 16. Harness coverage / results

File: `tests/harness/teaching-assignments-v2-runtime.harness.ts` (registered in `tests/harness/run.mjs`)

| Class | Coverage |
|---|---|
| Static SQL | RPCs, auth, revoke/grant, locking, audit, lifecycle, no generator/sessions |
| Pure logic | sole/co-teach/project/summer/obsolete/mismatch/cross-college/preview/policy/overload |
| Import/UI static | template columns, DG dependency, co-teach split, readonly UI, no direct insert |
| SB static | queries present; no TA v2 write coupling |
| Runtime DB | **DEFERRED** until apply |

Result: **PASS** (with deferred runtime note).

---

## 17. Quality gates

| Gate | Result |
|---|---|
| Phase 9.4 harness | PASS |
| `tsc --noEmit` | PASS |
| `npm run build` | PASS |
| eslint (changed files) | PASS |
| `git diff --check origin/main...HEAD` | PASS (pre-commit) |

---

## 18. Confirmations

- no DB writes
- no migration apply
- no operational-data import
- no generator execution
- no session creation
- no deploy
- no publish
- no merge

---

## 19. Next phase only

**PHASE-9.4-TEACHING-ASSIGNMENTS-V2-RUNTIME-FOUNDATION-PR-REVIEW-01**
