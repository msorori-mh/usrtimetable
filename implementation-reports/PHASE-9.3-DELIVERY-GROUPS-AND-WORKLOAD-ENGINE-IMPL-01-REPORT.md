# PHASE-9.3-DELIVERY-GROUPS-AND-WORKLOAD-ENGINE-IMPL-01

## 1. Decision

**PASS_WITH_NOTES — PHASE_9_3_DELIVERY_GROUPS_WORKLOAD_PR_READY**

Notes:

- Runtime DB proof (live unauthorized / cross-college RPC, idempotent DB rerun against applied schema) is **deferred** until migration apply.
- Migration is **CREATED — NOT APPLIED**.
- Repo-wide `eslint` baseline CRLF noise remains outside modified files; Phase 9.3 files were prettier-fixed and lint clean.

---

## 2. Baseline

| Field | Value |
|---|---|
| Expected baseline | `cdc11b5f5940bd365fcde18e2b56dcf9e28ee2dc` |
| G0 HEAD | `cdc11b5f5940bd365fcde18e2b56dcf9e28ee2dc` |
| G0 `origin/main` | `cdc11b5f5940bd365fcde18e2b56dcf9e28ee2dc` |
| Branch | `phase-9-3-delivery-groups-workload` |
| Worktree | `C:\projects\usrtimetable-phase9-3-delivery-groups` |
| Prior status | PASS_WITH_NOTES — PHASE_9_2_COMPLETE_POST_MERGE_VERIFIED |
| Supabase project | `emzytxqkxjjhsivqxdiu` (Lovable-only management) |

G0: clean worktree, HEAD = origin/main = expected baseline → proceed.

---

## 3. Schema audit (G1)

### delivery_groups (Phase 9.1)

| Item | Current |
|---|---|
| Columns | `id`, `college_id`, `cohort_id`, `plan_course_id`, `component_id`, `group_code`, `expected_students`, `capacity_limit`, `active`, timestamps |
| Unique | `dg_unique (component_id, cohort_id, group_code)` |
| Links | cohort → `academic_cohorts`; component → `plan_course_components`; plan_course → `plan_courses` |
| group_number | **missing** (free-text `group_code` only) |
| Capacity / students | `capacity_limit`, `expected_students` |
| Project / summer flags | via `plan_course_components.component_type` + load flags |
| teaching_assignments V2 | nullable `cohort_id`, `plan_course_component_id`, `delivery_group_id` |

### Gaps addressed in Phase 9.3 (source migration)

- `group_number` + unique `(cohort_id, component_id, group_number)`
- `excluded_from_standard_workload` on delivery groups
- `explicit_group_size` on plan_course_components
- `faculty_workload_policies` (locale-neutral `rank_code` + aliases)
- Generator RPC + workload view/RPC
- V2 assignment integrity via `ensure_ta_college` extension + unique index

**Not modified:** Phase 9.1 `20260716025117_…` and Phase 9.2 `20260716030000_…` / `20260716054608_…`.

---

## 4. Delivery group algorithm

RPC: `generate_cohort_delivery_groups(p_cohort_id uuid) → jsonb`

Flow:

1. Load cohort → auth.uid + `can_manage_college(uid, cohort.college_id)`.
2. Resolve components from compatibility `course_offerings` matching cohort college/term/program/level/study_system + `plan_course_components`.
3. Per component type apply G3 rules; upsert groups by `(cohort_id, component_id, group_number)`.
4. Non-destructive obsolete warnings; never delete groups.
5. Return summary counters + skipped/warnings/validation_errors.

---

## 5. Capacity resolution

| Component | Capacity source |
|---|---|
| theory | `required_room_type_id → room_types.default_capacity`; 1 group if students ≤ capacity else ceil |
| practical | same room-type capacity; ceil; `strict_capacity` = hard-limit semantics |
| tutorial | `explicit_group_size` if set, else room-type capacity |
| project | **requires** `explicit_group_size`; no guessing |
| any missing ref | `MISSING_CAPACITY` / `MISSING_PROJECT_GROUP_SIZE` validation error |

**Forbidden:** inventing default capacity 30 inside SQL generator.

---

## 6. Reconciliation / idempotency

- Unique identity: cohort + component + `group_number` (component implies course + type).
- Rerun updates safe fields (`expected_students`, `capacity_limit`, flags); never renumbers.
- No `DELETE FROM delivery_groups`.
- Obsolete linked → `OBSOLETE_GROUP_LINKED` warning.
- Obsolete unused → `OBSOLETE_GROUP_UNUSED` warning (retained in V1).

---

## 7. Project behavior

- Groups created when `weekly_contact_hours > 0` and `explicit_group_size` present.
- `excluded_from_standard_workload = true`.
- Schedulable / assignable; excluded from standard workload metric; counted in `project_supervision_hours`.

---

## 8. Summer training behavior

- No weekly `delivery_groups`.
- Summary: `skipped_non_weekly_component`.
- Weekly teaching assignment to `summer_training` rejected (`SUMMER_TRAINING_WEEKLY_ASSIGNMENT_FORBIDDEN`).

---

## 9. Workload calculation

- View: `v_instructor_delivery_workload`
- RPC: `compute_instructor_standard_workload(p_instructor_id, p_term_id)`
- Policy table: `faculty_workload_policies` (`rank_code` + `rank_aliases`; no Arabic-only hardcode; no seed/backfill)
- Reference codes (docs / TS defaults): assistant_professor 12h, associate_professor 9h, associate_dean 6h
- Outputs: `required_load_hours`, `standard_assigned_hours`, `project_supervision_hours`, `deficit_hours`, `overload_hours`, `status`
- Multi-instructor groups: use assignment `weekly_hours` when co-instructors exist; do not auto-full-count each instructor
- Uses component hours, not total course hours; ignores summer_training; project separate

---

## 10. Teaching assignments V2 readiness

- Existing nullable V2 FKs retained (legacy `course_offering_id` preserved).
- Extended `ensure_ta_college`: cohort/component/group/college consistency; summer weekly forbidden; cross-college forbidden.
- Unique index: `(college_id, delivery_group_id, instructor_id)` where delivery_group set.
- No operational data import in this phase.

---

## 11. Migration path / status

| Item | Value |
|---|---|
| Path | `supabase/migrations/20260716070000_delivery_groups_workload_engine.sql` |
| Status | **CREATED — NOT APPLIED** |
| Apply method | Lovable / Supabase management only (out of scope) |
| Backfill / seed / generator invoke | None |
| Generator auto-trigger | None |

Contains: additive columns/indexes/constraints, `faculty_workload_policies`, generator RPC, workload view/RPC, grants/revokes/comments, TA integrity via existing trigger function replace.

---

## 12. UI / service changes

| File | Role |
|---|---|
| `src/lib/academic-delivery/delivery-groups.ts` | Pure group-count + reconciliation |
| `src/lib/academic-delivery/workload.ts` | Pure workload + assignment validation |
| `src/lib/academic-delivery/delivery-group-generator-summary.ts` | Summary types/parser |
| `src/lib/academic-delivery/generate-delivery-groups.ts` | RPC service |
| `src/hooks/use-generate-delivery-groups.ts` | Explicit mutation hook |
| `src/routes/_authenticated/academic-cohorts.tsx` | Read-only cohorts + groups + confirmed generate |
| `src/routes/_authenticated/delivery-groups.tsx` | College-wide read-only groups |
| `src/components/app-layout.tsx` | Nav entries |
| `src/integrations/supabase/types.ts` | Columns + RPCs typed |
| `src/routeTree.gen.ts` | Routes registered |

Generate button: `useCanManageActiveCollege` only + AlertDialog confirmation. Import commit does **not** auto-call generator.

---

## 13. Schedule Builder compatibility

- No SB workspace/RPC redesign.
- `course_offerings` compatibility layer preserved (read-only offerings page unchanged in behavior).
- Generator scopes to one cohort’s offerings/components; does not mutate schedule_sessions except reading links for obsolete warnings.
- Legacy TA uniqueness / `course_offering_id` retained.

---

## 14. Harness / typecheck / build / lint

| Check | Result |
|---|---|
| `bun tests/harness/delivery-groups-workload-engine.harness.ts` | **PASS** (static SQL + pure logic; runtime DB deferred) |
| `bunx tsc --noEmit` | **PASS** |
| `bun run build` | **PASS** |
| eslint (Phase 9.3 touched files) | **PASS** after prettier LF fix |
| repo-wide lint | Baseline CRLF noise outside scope (not fixed) |

Harness coverage includes theory/practical/tutorial/project/summer, missing capacity, reconciliation increase/decrease, auth/cross-college static contracts, assignment mismatch, workload deficit/overload/project split, SB legacy presence.

---

## 15. Mandatory confirmations

| Constraint | Confirmed |
|---|---|
| No DB writes | YES |
| No migration apply | YES |
| No generator execution against production | YES |
| No deploy / publish | YES |
| No merge | YES |
| No stash/reset/clean/delete | YES |
| Worktree-only / no mainline touch | YES |
| Phase 9.1 / 9.2 applied migrations untouched | YES |

---

## 16. Next phase only

**PHASE-9.3-DELIVERY-GROUPS-AND-WORKLOAD-ENGINE-PR-REVIEW-01**

---

## Security Review

- Files changed: migration (source), academic-delivery lib, hooks, two routes, app-layout, supabase types, routeTree, harness, this report
- Did migrations change? **yes** (new source-only file; not applied)
- Did RLS change? **yes** (new `faculty_workload_policies` policies only)
- Did RPCs change? **yes** (new generator + workload; TA ensure function replaced)
- Authentication impact: **yes** (auth.uid gates on new RPCs)
- Authorization impact: **yes** (can_manage_college / can_view_college)
- Sensitive data exposure: **no**
- Privilege escalation risk: **no** (SECURITY DEFINER + search_path + revoke PUBLIC/anon)
- Production risk: **low** (not applied; no data mutation outside RPC bodies)
- Ready for merge: **yes** (after PR review)
- Ready for deploy: **no** (migration NOT APPLIED; Lovable apply separate)
