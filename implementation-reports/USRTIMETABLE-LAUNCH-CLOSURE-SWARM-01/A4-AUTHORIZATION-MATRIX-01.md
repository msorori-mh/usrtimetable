# A4 — AUTHORIZATION MATRIX 01 (TRACK 6)

**Swarm:** USRTIMETABLE-AUTONOMOUS-SOURCE-CLOSURE-WAVE-03 · **Agent:** A4 · **Baseline:** `b6a5a491f9f70f1cfba5dc5696fb33f64dbcee6b` (origin/main)
**Type:** Documentation/design only. No DB writes, no migration apply, no product source changes.

---

## 0. Ground rules (binding for every cell below)

1. **Sidebar/nav hiding is NOT authorization.** `src/hooks/use-can-manage.ts` (`useCanManageActiveCollege`) and nav entries in `src/components/app-layout.tsx` are UX conveniences only. A hidden button that a user can still invoke via direct API call is an authorization hole. Every ALLOW/DENY below names a server-side enforcement point: an **RLS policy**, an **RPC-internal check**, or **both**.
2. **Roles:** `public.app_role = ('super_admin','college_admin','read_only')` — `supabase/migrations/20260604222655_952c4a6f-…sql`. Role rows live in `public.user_roles`; college assignment in `public.user_colleges`. Bootstrap: first user becomes `super_admin`, every later user `read_only` (`handle_new_user`, `20260604222725_e869fc5e-…sql`).
3. **Helper functions (all SECURITY DEFINER, STABLE):**
   - `has_role(user, role)`, `is_super_admin(user)`, `user_in_college(user, college)` — `20260604222725_e869fc5e-…sql`.
   - `can_view_college = is_super_admin OR user_in_college` and `can_manage_college = is_super_admin OR (has_role 'college_admin' AND user_in_college)` — `20260604225017_41baaa6b-…sql`.
   - Consequence: `read_only` and `college_admin` are identical for SELECT; they differ **only** through `can_manage_college` on writes.
4. **Applied-state caveat:** several enforcing migrations are *source-only / NOT APPLIED* (see `implementation-reports/USRTIMETABLE-LAUNCH-CLOSURE-SWARM-01/STATE.json` → `source_only_migrations_not_applied`, and file headers). Per swarm rule, *no migration is considered applied without remote evidence*. Cells citing a source-only migration are marked **(SOURCE-ONLY — applied state UNKNOWN)** and the runtime cell degrades to the older applied policy, which is stated explicitly.

## 1. Matrix legend

- **ALLOW / DENY** = required end state.
- **Enforcement** = RLS policy / RPC check / both / trigger / grant-revoke.
- **Evidence** = file that implements it today, or `GAP — to implement` with the planned enforcement point.

---

## 2. Direct RPC access

| RPC (purpose) | super_admin | college_admin (own college) | college_admin (other college) | read_only | Enforcement | Evidence |
|---|---|---|---|---|---|---|
| `transition_schedule_version` (lifecycle) | ALLOW | ALLOW | DENY | DENY | RPC check `can_manage_college` + `FOR UPDATE` lock | `20260718120000_source_only_atomic_schedule_version_lifecycle.sql` (SOURCE-ONLY — applied state UNKNOWN) |
| `begin_schedule_quality_snapshot` / `persist_schedule_quality_run` | ALLOW | ALLOW | DENY | DENY | RPC check `can_manage_college`; `schedule_quality_runs` INSERT/UPDATE/DELETE revoked from `authenticated` | same file (SOURCE-ONLY) |
| `validate_schedule_session_move` | ALLOW | ALLOW | DENY (`FORBIDDEN_COLLEGE`) | DENY | RPC check `can_manage_college` | `20260714010000_schedule_session_move_rpc.sql` |
| `move_or_reschedule_schedule_session` (validate+save, atomic) | ALLOW | ALLOW | DENY | DENY | RPC check `can_manage_college`; `VERSION_LOCKED`/`SESSION_LOCKED`; optimistic `updated_at`; audit insert | `20260714010000_schedule_session_move_rpc.sql` |
| `create_import_preview_manifest` / `claim_import_job_manifest` / `finalize_import_job` / `fail_import_job` | ALLOW | ALLOW | DENY | DENY | RPC check via `import_manager_actor` → `can_manage_college`; `import_jobs`/`import_errors` writes revoked from `authenticated` (RPC-only) | `20260718180000_import_manifest_contract.sql`; atomic commit body `20260718210000_source_only_atomic_import_job_commit.sql` (applied state UNKNOWN) |
| `generate_cohort_delivery_groups` | ALLOW | ALLOW | DENY | DENY | RPC check `can_manage_college(uid, cohort.college_id)` | `20260716233716_73dc0ba0-…sql` (APPLIED per Phase 9.3 report) |
| `compute_instructor_standard_workload` (read) | ALLOW | ALLOW | DENY | DENY* | RPC + `can_view/manage` gate | `20260716233716_73dc0ba0-…sql` (*read_only currently not granted a manage path; confirm read intent — see GAP-7) |
| `upsert_scheduling_cohort_term_headcount` | ALLOW | ALLOW | DENY | DENY | RPC SECURITY DEFINER + `can_manage_college`; table writes revoked from `authenticated` | `20260721180000_source_only_scheduling_headcount_foundation.sql` (SOURCE-ONLY, NOT APPLIED) |
| `approve_scheduling_cohort_term_headcount` (headcount approval) | ALLOW | ALLOW | DENY | DENY | RPC check; approval requires `source`; over-eligible requires notes | same (SOURCE-ONLY, NOT APPLIED) |
| `upsert/archive_scheduling_headcount_override` | ALLOW | ALLOW | DENY | DENY | RPC check `can_manage_college` | same (SOURCE-ONLY, NOT APPLIED) |
| `resolve_scheduling_headcount` (read, fail-closed) | ALLOW | ALLOW | DENY | ALLOW (read) | RPC; returns blocker `SCHEDULING_HEADCOUNT_MISSING` when no approved headcount; no Legacy fallback | same (SOURCE-ONLY, NOT APPLIED) |
| `list_scheduling_headcount_revisions` (read) | ALLOW | ALLOW | DENY | ALLOW (read) | RPC + college scope | same (SOURCE-ONLY, NOT APPLIED) |
| `approve_capacity_split_proposal` | ALLOW | ALLOW | DENY | DENY | RPC check | `20260715120000_approve_capacity_split_proposal.sql` (SOURCE-ONLY, NOT APPLIED) |
| `generate_cohort_curriculum` | ALLOW | ALLOW | DENY | DENY | RPC check | `20260716030000_generate_cohort_curriculum.sql`; hardened `20260718183000_forward_harden_cohort_curriculum_runtime.sql` (SOURCE-ONLY, NOT APPLIED) |

**Finding F-1:** RPCs are consistently gated by `can_manage_college` inside the function body with `SET search_path` and `REVOKE … FROM PUBLIC, anon`. The RPC layer is the strongest enforcement surface in the codebase.

---

## 3. Direct table access (PostgREST)

All academic tables: `GRANT SELECT,INSERT,UPDATE,DELETE TO authenticated` + RLS enabled; policy pattern = `can_view_college` for SELECT, `can_manage_college` for INSERT/UPDATE/DELETE.

| Table | super_admin | college_admin own | college_admin other | read_only (assigned) | read_only (unassigned) | Enforcement | Evidence |
|---|---|---|---|---|---|---|---|
| `universities` | ALLOW R/W | SELECT | SELECT | SELECT | SELECT | RLS `uni_*` (`is_super_admin` writes) | `20260604222725_e869fc5e-…sql` |
| `colleges` | ALLOW R/W | SELECT own | DENY | SELECT own | DENY | RLS `col_*` | same |
| `profiles` | ALLOW R/W all | self only | self only | self only | self only | RLS `prof_*` | same |
| `user_roles` | ALLOW R/W | SELECT self | SELECT self | SELECT self | SELECT self | RLS `ur_*` (writes super_admin only) | same |
| `user_colleges` | ALLOW R/W | SELECT self | SELECT self | SELECT self | SELECT self | RLS `uc_*` | same |
| `departments`, `academic_programs`, `study_plans`, `academic_levels`, `courses`, `plan_courses`, `academic_terms`, `sections`(Legacy, see §7) | ALLOW R/W | ALLOW R/W | DENY | SELECT only | DENY | RLS `*_select`=can_view / writes=can_manage + `ensure_*_college` triggers | `20260604225017_41baaa6b-…sql` |
| `audit_logs` | SELECT all; INSERT self | SELECT own college; INSERT self | DENY | SELECT own college; **INSERT self (append)** | INSERT self only (no visible rows) | RLS `al_select`, `al_insert(actor_id=auth.uid())`; UPDATE/DELETE **never granted** to `authenticated` | `20260604222655` + `20260604222725` |
| `delivery_groups`, `teaching_assignments` (V2), `academic_cohorts`, `cohort_elective_selections` | ALLOW R/W | ALLOW R/W | DENY | SELECT only | DENY | RLS can_view/can_manage pattern + `ensure_ta_college` trigger | `20260716025117_…sql`, `20260716233716_…sql` |
| `schedule_versions` | ALLOW | ALLOW (name/notes cols only; status via RPC) | DENY | SELECT | DENY | `REVOKE UPDATE`, `GRANT UPDATE (name, notes)`; immutability triggers (`published`/`archived` immutable, delete blocked) | `20260718120000` (SOURCE-ONLY) |
| `schedule_quality_runs` | ALLOW via RPC | ALLOW via RPC | DENY | SELECT* | DENY | INSERT/UPDATE/DELETE revoked from `authenticated` (RPC-only writes) | `20260718120000` (SOURCE-ONLY) |
| `import_jobs`, `import_errors` | ALLOW via RPC | ALLOW via RPC | DENY | SELECT* | DENY | INSERT/UPDATE/DELETE revoked from `authenticated` | `20260718180000` |
| `scheduling_cohort_term_headcounts`, `…_overrides`, `…_revisions` | ALLOW via RPC | ALLOW via RPC | DENY | SELECT | DENY | writes revoked from `authenticated`/`anon`/`PUBLIC`; RLS can_view/can_manage | `20260721180000` (SOURCE-ONLY, NOT APPLIED) |
| `faculty_workload_policies` | ALLOW R/W | ALLOW R/W | DENY | SELECT | DENY | RLS policies | `20260716233716` |

*SELECT for read_only on RPC-managed tables follows the table's own SELECT RLS (can_view); verify per-table when the source-only migrations are applied.

**Finding F-2 (read_only append to audit_logs):** `al_insert` allows ANY authenticated user (including `read_only`) to INSERT audit rows with `actor_id = auth.uid()`. Acceptable as append-only self-attribution, but it means `read_only` is not strictly read-only at the DB layer. Decision needed: keep (harmless, aids RPC auditing) or restrict INSERT to RPC-owned paths via trigger. → **GAP-6** (planned enforcement: trigger `audit_insert_rpc_only` — approval-gated, not AUTO_SAFE).

---

## 4. Cross-college denial

| Dimension | Required | Enforcement today | Evidence / Gap |
|---|---|---|---|
| Row visibility | college_admin / read_only see only `user_colleges` rows | RLS `can_view_college` on every tenant table | `20260604225017` et seq. — IMPLEMENTED |
| Row mutation | writes only to own college | RLS `can_manage_college` + RPC checks | IMPLEMENTED (applied tables) |
| FK integrity (child row pointing at another college's parent) | hard reject | `ensure_*_college` triggers on programs/plans/levels/courses/plan_courses/sections; `ensure_ta_college` for TA V2 | `20260604225017`, `20260716233716` — IMPLEMENTED |
| Composite tenant FKs `(id, college_id)` | hard reject at FK layer | **GAP — to implement at runtime** — migration exists source-only | `20260717050000_source_only_harden_cross_college_references.sql` (NOT APPLIED; prerequisite #1 for headcount apply). Planned enforcement: composite UNIQUE keys + composite FKs (21 reference mappings). |
| RPC college parameter spoofing | reject | RPCs re-derive college from the entity row or call `can_manage_college(actor, p_college_id)` and verify row ownership (`WHERE id=… AND college_id=p_college_id`) | e.g. `transition_schedule_version`, import claim — IMPLEMENTED |

---

## 5. Regular (منتظم) / Parallel (موازي) isolation

**Key fact: study-system is NOT an RLS/role dimension.** `study_system` (`regular`/`parallel`/`both`) is carried on `course_offerings`, `time_slot_templates`, `schedule_sessions`, cohorts. Isolation is enforced in *generation and conflict logic*, not authorization.

| Cell | Required | Enforcement today | Evidence / Gap |
|---|---|---|---|
| Time-slot template scoping per study system | sessions must fit own system's templates | conflict check `study_system_time_template` (hard) in move RPC | `20260714010000` — IMPLEMENTED |
| Generator scoping | delivery groups generated per cohort (cohort carries study system) | `generate_cohort_delivery_groups` matches offerings by `study_system` | `20260716233716`, Phase 9.3 report §4 — IMPLEMENTED |
| Shared lecture groups mixing regular+parallel | **never combined by default** | n/a — shared groups not implemented | `implementation-reports/SYSTEM-AUDIT-DELTA-REFRESH-TERMINOLOGY-AND-SHARED-DELIVERY-LOCK-01.md` — explicit rule; A2 must encode it |
| Cross-system read visibility | same college → visible (no authz boundary) | by design (RLS college-scoped) | OK — documented so no one mistakes it for a breach |
| Cross-system scheduling conflict (student in both systems) | conflict detection, not authz | conflict engine (`conflict_checks`, move collector) | `20260715013500_ss_template_conflicts.sql` et seq. |
| **GAP** | No automated authz-style test proving a parallel cohort's DG/TA cannot be attached to a regular cohort's session | **GAP — to implement**: `ensure_ta_college`-style trigger extension or CHECK on session↔DG study_system match | Planned enforcement point: DB trigger on `schedule_sessions` (approval-gated migration) |

---

## 6. Lifecycle transitions (DRAFT → UNDER_REVIEW → APPROVED → PUBLISHED → ARCHIVED)

Runtime statuses are lowercase: `draft → review → approved → published → archived`, with rollback `review→draft`, `approved→review`. All transitions via `transition_schedule_version` only (direct status UPDATE revoked).

| Transition | super_admin | college_admin own | college_admin other | read_only | Preconditions (fail-closed) | Evidence |
|---|---|---|---|---|---|---|
| draft → review | ALLOW | ALLOW | DENY | DENY | `NO_SESSIONS` blocker; quality run required, fresh revision, no unapproved hard conflicts | `20260718120000` (SOURCE-ONLY) |
| review → approved | ALLOW | ALLOW | DENY | DENY | same quality gates | same |
| approved → published | ALLOW | ALLOW | DENY | DENY | same quality gates | same |
| published → archived | ALLOW | ALLOW | DENY | DENY | none beyond lock | same |
| review → draft (rollback) | ALLOW | ALLOW | DENY | DENY | event logged `rolled_back_to_draft` | same |
| approved → review (rollback) | ALLOW | ALLOW | DENY | DENY | event logged | same |
| any direct UPDATE of `status` | DENY | DENY | DENY | DENY | `REVOKE UPDATE`; `GRANT UPDATE(name,notes)` only | same |
| edit/delete published/archived version | DENY | DENY | DENY | DENY | immutability triggers `IMMUTABLE_SCHEDULE_VERSION` | same |
| move session in published/archived version | DENY | DENY | DENY | DENY | `VERSION_LOCKED` in move RPC | `20260714010000` |

**Finding F-3 (separation of duties GAP):** one `college_admin` can execute the *entire* chain draft→…→published; approver == submitter is permitted and publish is not super_admin-gated. For launch this may be acceptable for a single-college pilot, but the matrix records it as **GAP-5 — to decide**: either (a) document as accepted risk for pilot, or (b) add `p_publish_actor_must_differ` / super_admin publish gate (approval-gated migration to `transition_schedule_version`).

---

## 7. Shared delivery (المجموعات المشتركة للمحاضرات) permissions

Shared lecture groups are **NOT IMPLEMENTED** (A2 not started; runtime fail-closed). `shared-courses.tsx` is *catalog sharing* only and combines nothing at delivery time.

| Operation | super_admin | college_admin | read_only | Enforcement (planned) | Evidence |
|---|---|---|---|---|---|
| Create/link shared lecture group | ALLOW | ALLOW (own college, participating cohorts only) | DENY | GAP — to implement in A2: RPC check `can_manage_college` + participating-cohort validation | `SYSTEM-AUDIT-…-SHARED-DELIVERY-LOCK-01.md` (design lock) |
| Assign instructor to shared group | ALLOW | ALLOW | DENY | GAP — A2 RPC; must not double-count workload | Phase 9.3 workload rules §9 |
| Session projection to each participating cohort | system-only | system-only | read | GAP — A2: one authoritative session, fan-out read projection | design lock doc |
| Mix regular + parallel in one shared group | DENY | DENY | DENY | GAP — A2 CHECK/trigger | design lock doc (explicit rule) |
| Capacity check (sum of participating headcounts) | enforced | enforced | n/a | GAP — A2: sum `resolve_scheduling_headcount` over participants, fail-closed | `SCHEDULING-HEADCOUNT-PRODUCTION-DEPENDENCY-MAP.md` §3 step 5 |

---

## 8. Headcount approvals

| Operation | super_admin | college_admin own | read_only | Enforcement | Evidence |
|---|---|---|---|---|---|
| Upsert draft headcount | ALLOW | ALLOW | DENY | RPC `upsert_scheduling_cohort_term_headcount` + `can_manage_college`; table writes revoked | `20260721180000` (SOURCE-ONLY, NOT APPLIED) |
| Approve headcount | ALLOW | ALLOW | DENY | RPC `approve_…`; source required; over-eligible requires notes; writes `scheduling_headcount_revisions` + `audit_logs` | same |
| Override create/archive | ALLOW | ALLOW | DENY | RPC pair; partial unique index on active grain | same |
| Read resolved headcount | ALLOW | ALLOW | ALLOW | RPC `resolve_scheduling_headcount`; fail-closed `SCHEDULING_HEADCOUNT_MISSING` | same |
| Invented/default headcount fallback | DENY (all roles) | DENY | DENY | fail-closed by design; no Legacy expected-student fallback | dependency map §1 |

---

## 9. Legacy writes (blocked per A1.3)

Legacy tables: `sections`, `course_offering_sections`.

| Operation | super_admin | college_admin | read_only | Enforcement today | Evidence / Gap |
|---|---|---|---|---|---|
| UI write path | BLOCKED | BLOCKED | BLOCKED | A1.3a client/import-client blocking (PR #60, merged) | `implementation-reports/A1-3B-LEGACY-ORPHAN-REMEDIATION-PLAN-01.md`, `A1-3C-LEGACY-DB-HARDENING-DESIGN-01.md` |
| Direct table INSERT/UPDATE/DELETE (runtime, today) | **POSSIBLE via RLS policy** | **POSSIBLE via RLS policy** | DENY | **GAP — runtime DB block NOT yet applied.** Today `sec_insert/update/delete` (can_manage) still permit Legacy writes at DB level | `20260604225017` (old policies) vs `20260721090000_source_only_legacy_write_hardening.sql` (SOURCE-ONLY, NOT APPLIED, gated on A1.3b remediation + APPROVE_DB_MIGRATION_APPLY) |
| DB-level block (target) | DENY (except operator GUC window `app.legacy_write_allow=on`, direct SQL only) | DENY | DENY | trigger `legacy_write_blocked` + `REVOKE INSERT,UPDATE,DELETE` from PUBLIC/anon/authenticated | `20260721090000` — planned enforcement; apply order strictly A1.3b → A1.3c |
| Legacy reads (history/reports) | ALLOW | ALLOW | ALLOW (own college) | SELECT retained | same |

---

## 10. Import commit

| Step | super_admin | college_admin own | read_only | Enforcement | Evidence |
|---|---|---|---|---|---|
| Preview (create job) | ALLOW | ALLOW | DENY | `create_import_preview_manifest` → `import_manager_actor` | `20260718180000` |
| Claim (commit start) | ALLOW | ALLOW (creator only) | DENY | manifest re-check `md5(payload)`, `created_by = actor`, status `preview→committing` | same |
| Finalize / fail | ALLOW | ALLOW (creator only) | DENY | status machine `committing→committed|failed`; row-count validation | same |
| Direct writes to `import_jobs`/`import_errors` | DENY (RPC-only) | DENY | DENY | `REVOKE INSERT,UPDATE,DELETE` from `authenticated` | same |
| Import path touching Legacy sections helpers | n/a | n/a | n/a | GAP — follow-up (a) in A1.3c: replace `_import_apply_sections`/`_import_apply_section_groups`/TA V1 branch with `LEGACY_WRITE_BLOCKED` raisers | `20260721090000` §4a + `20260718210000` |

---

## 11. Schedule Builder mutations (summary)

| Mutation | super_admin | college_admin own | read_only | Enforcement | Evidence |
|---|---|---|---|---|---|
| Move/reschedule session | ALLOW | ALLOW | DENY | `move_or_reschedule_schedule_session` RPC (role + version lock + session lock + conflict fail-closed + audit) | `20260714010000` |
| Validate proposed move (read) | ALLOW | ALLOW | DENY | `validate_schedule_session_move` | same |
| Conflict exception approve | ALLOW | ALLOW | DENY | `schedule_version_conflict_exceptions` writes + eligibility invalidation triggers | `20260709193500_schedule_version_conflict_exceptions.sql`, `20260718120000` |
| Auto-schedule run | ALLOW | ALLOW | DENY | route `/auto-schedule`; server path must route through can_manage RPCs | `src/routes/_authenticated/auto-schedule.tsx` (UI gate only — verify server path, GAP-8) |
| Quality score run | ALLOW | ALLOW | DENY | `begin/persist_schedule_quality_run` pair, revision-pinned | `20260718120000` (SOURCE-ONLY) |

---

## 12. Gap register (consolidated)

| # | Gap | Planned enforcement point | Gate |
|---|---|---|---|
| GAP-1 | Composite tenant FKs not applied (21 cross-college reference mappings) | apply `20260717050000` | APPROVE_DB_MIGRATION_APPLY (approval-gated) |
| GAP-2 | Legacy DB write block not applied | A1.3b remediation, then `20260721090000` | APPROVE_LEGACY_DATA_REMEDIATION + APPROVE_DB_MIGRATION_APPLY |
| GAP-3 | Headcount foundation not applied | apply `20260721180000` after GAP-1 | APPROVE_DB_MIGRATION_APPLY |
| GAP-4 | Study-system match trigger on sessions (regular/parallel hard isolation at write time) | new trigger migration | approval-gated |
| GAP-5 | No separation of duties in lifecycle (submitter can approve+publish) | decide: accept for pilot OR RPC change | decision; RPC change approval-gated |
| GAP-6 | `read_only` can append to `audit_logs` | decide: accept append-only OR insert-restrict trigger | decision; trigger approval-gated |
| GAP-7 | `compute_instructor_standard_workload` read access for read_only unclear | confirm grant + view RLS when applied | AUTO_SAFE-verification |
| GAP-8 | Auto-schedule server path authorization not independently verified in this pass (UI gate seen) | trace server dispatcher RPCs for `can_manage_college` | AUTO_SAFE-verification |
| GAP-9 | Shared delivery groups: entire surface | A2 implementation per design lock | approval-gated (A2 program) |

## 13. AUTO_SAFE vs approval-gated (this track)

- **AUTO_SAFE later (docs/design/read-only verification):** GAP-7/GAP-8 verification queries; matrix test plan; audit viewer + readiness dashboard read-only implementations (see sibling docs).
- **Approval-gated:** every GAP whose fix is a migration, RPC change, trigger, or grant change (GAP-1…GAP-6, GAP-9), all under `APPROVE_DB_MIGRATION_APPLY` / named approvals in `STATE.json`.
