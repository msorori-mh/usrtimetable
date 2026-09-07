# INSTITUTIONAL-VIEWER-RBAC — SOURCE-ONLY 01

**Stage:** `SOURCE_ONLY_INSTITUTIONAL_VIEWER_RBAC_01`
**Scope:** source + tests + migration files only. No publish. No production user or data created/modified.
**Status:** `READY_FOR_DB_APPLY_REVIEW` — with one **disclosure** (see §7).

## 1. Role definition

New role `institutional_viewer` (Arabic label **«مشاهد مؤسسي»**):

- **Reads everything:** every existing route/page (university, colleges, users, settings, reports, import, data-cleanup, auto-schedule) and data for **all colleges** without any `user_colleges` row.
- **Writes nothing:** no insert/update/delete, no import, no cleanup, no scheduler run, no version create/status change/approve/publish, no user administration, no disable, no password reset — enforced server-side (RLS + RPC), not only in the UI.
- `can_manage_college` was **not** touched. No write policy and no mutating RPC references the role.
- `super_admin`, `college_admin`, `read_only` behaviour is unchanged.

## 2. Migrations (3 files, deliberately split)

| File                                                                          | Content                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/20260907011528_5aff0fb9-b1ca-461d-9396-b3a52b763f2d.sql` | **Only** `ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'institutional_viewer';` — the value cannot be used in the same transaction, so nothing else lives here.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `supabase/migrations/20260907011642_82a09c5b-0bb2-4101-8ed8-1e27db772d16.sql` | Uses the value after commit: adds `public.is_institutional_viewer(uuid)` (SECURITY DEFINER, `SET search_path = public, pg_temp`, `EXECUTE` revoked from `PUBLIC`/`anon`); widens `can_view_college` with `OR is_institutional_viewer(...)`; widens the **SELECT-only** policies that do not route through `can_view_college`: `colleges.col_select`, `profiles.prof_select`, `user_roles.ur_select`, `user_colleges.uc_select`, `audit_logs.al_select`; and hardens the single authenticated write policy `audit_logs.al_insert` with `AND NOT is_institutional_viewer(auth.uid())` so the role is strictly zero-write. |

Reviewed SELECT-policy inventory at design time: 62 SELECT policies in `public` — 54 route through `can_view_college` (covered automatically), 5 used `is_super_admin` (the 5 administrative ones above), 3 were `true`. No other SELECT surface needed changes.

### 2.1 Migration 3 — approved decisions (1) and (2) — **NOT APPLIED**

File of record: `docs/migrations-proposed/20260907013500_institutional_viewer_zero_write_enforcement.sql`.
It lives under `docs/` on purpose: `supabase/migrations/` is written only by the platform migration tool, and this stage is source-only, so nothing was submitted for execution.

- **Decision (1) — zero writes, multi-role safe, minimum blast radius.** A live catalog audit of **all 175 write policies** in `public` showed every one of them is gated by `can_manage_college(...)` or `is_super_admin(...)`, both FALSE for the institutional viewer and neither touched here. Exactly **three** write policies are satisfiable by a plain authenticated user on their own row: `profiles.prof_insert`, `profiles.prof_update`, and `audit_logs.al_insert`. Migration 3 therefore contains only two things: the helper `public.is_institutional_read_only_actor(uuid)` and those three policies re-created with their original conditions plus `AND NOT public.is_institutional_read_only_actor(auth.uid())`. No trigger, no `DO` loop, no RPC re-definition, no other policy — `al_select` and every other SELECT policy stay exactly as they are. The helper is `STABLE SECURITY DEFINER` with `search_path = public, pg_temp`, revoked from `PUBLIC`/`anon`, granted to `authenticated` and `service_role`, and TRUE only when the user carries `institutional_viewer` **and carries neither `super_admin` nor `college_admin`**. It mirrors `isInstitutionalReadOnlyViewer()` in `src/lib/unauthorized-access.ts` (`!isSuperAdmin && !isCollegeAdmin && isInstitutionalViewer`). Migration 3 also **replaces** migration 2's blanket `NOT is_institutional_viewer(auth.uid())` term in `al_insert`: that term was a multi-role regression, stripping audit writes from an administrator who happens to also hold the viewer role.
- **Decision (2) — read-only RPC allowlist (6 functions).** Audited every volatile/stable public function with `authenticated` EXECUTE against the live catalog. Proven side-effect free (zero `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE` in the body) and therefore allowed:
  1. `resolve_scheduling_headcount(uuid, uuid, uuid, uuid, uuid)`
  2. `list_scheduling_headcount_revisions(uuid)`
  3. `compute_instructor_standard_workload(uuid, uuid)`
  4. `get_delivery_group_assignment_candidates(uuid)`
  5. `list_schedule_builder_v2_work_items(uuid, uuid, uuid, uuid, text, text, uuid, text)`
  6. `list_teaching_assignment_workspace(uuid, uuid, uuid, uuid, text, uuid, text, text)`

  Nothing about these six functions needs changing. Verification against the **live definitions** shows the four schedule/workload functions authorise through `public.can_view_college(...)` in their access gate, and migration 2 (already applied) widened `can_view_college` to include `is_institutional_viewer(...)` — so the institutional viewer **already passes** those gates today. The `can_manage_college(...)` calls inside them appear only in the returned write-affordance flags (`'can_manage'`, `'assignable'`), which must stay FALSE for the viewer and are left alone. `resolve_scheduling_headcount` and `list_scheduling_headcount_revisions` already hold the correct EXECUTE grants. Re-creating or re-granting any of them would change nothing and only risk drift, so all RPC statements were removed from migration 3.

  Denied by their own unchanged gates: 18 RPCs via `can_manage_college`, 5 import RPCs via `import_manager_actor` (which calls `can_manage_college`), 1 via `is_super_admin`, and `lock_delivery_group_for_assignment` which has no `authenticated` EXECUTE grant. `validate_schedule_session_move` and `begin_schedule_quality_snapshot` stay denied on purpose: both are preflight steps of a mutating action. Postgres EXECUTE grants cannot distinguish app roles inside `authenticated`, so the deny side rests entirely on each RPC's own `can_manage_college` / `is_super_admin` gate — which the 175-policy audit and the per-function source audit both confirm is universal. No blanket enforcement layer is needed.

- `can_manage_college` is still untouched in all three files.

## 3. Source files changed

| File                                          | Change                                                                                                                                                                                      |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/hooks/use-current-user.ts`               | `AppRole` union + `isInstitutionalViewer` derived from `user_roles` (never `user_metadata`).                                                                                                |
| `src/lib/unauthorized-access.ts`              | Central guards: `isInstitutionalReadOnlyViewer`, `resolveAdminReadablePageAccess`, `READ_ONLY_VIEW_BADGE_AR`.                                                                               |
| `src/components/app-layout.tsx`               | `Role` union + `ALL` include the role; every nav entry visible to it; Arabic role label.                                                                                                    |
| `src/routes/_authenticated/universities.tsx`  | Data visible; all forms / edit / delete controls hidden behind `viewOnly`; read-only badge.                                                                                                 |
| `src/routes/_authenticated/colleges.tsx`      | Same treatment.                                                                                                                                                                             |
| `src/routes/_authenticated/users.tsx`         | Opens via `resolveAdminReadablePageAccess`; read-only list; `adminListUserMeta` **not** called for the viewer; create-user / role management / college assignment / disable / reset hidden. |
| `src/routes/_authenticated/import.tsx`        | Dedicated browse-safe branch: official import order + guide link, no file input, no preview, no commit.                                                                                     |
| `src/routes/_authenticated/auto-schedule.tsx` | Viewing notice; run button already `disabled={!canManage ...}`.                                                                                                                             |
| `src/routes/_authenticated/data-cleanup.tsx`  | Already gated by `canManage`: diagnostics visible, all fix actions hidden.                                                                                                                  |
| `src/lib/users.functions.ts`                  | `ROLE` enum accepts the new role; college assignment required only for `college_admin`/`read_only`; endpoint stays `super_admin`-only (`eq("role","super_admin")`).                         |
| `src/integrations/supabase/types.ts`          | Generated additions only: the `app_role` enum value and the `is_institutional_viewer` signature. Verified with `git show`: 1 added line in the latest touch, zero reformatted lines.        |

Central-guard note: page access and write-control visibility flow through `useCanManageActiveCollege` and `src/lib/unauthorized-access.ts` only — no page invents its own role check, which is what keeps the surface hole-free.

## 4. Tests

- New: `tests/harness/institutional-viewer-rbac.harness.ts` (registered in `tests/harness/run.mjs`). Static/source proofs: role in union + generated types; **every** nav role list contains the role; `useCanManageActiveCollege` not widened; migration 1 is enum-only; migration 2 widens `can_view_college`, never `can_manage_college`, and contains **zero** viewer-granting write policies; admin pages use the central guard + badge + `viewOnly` branch; users page skips `adminListUserMeta`; server endpoints stay admin-only; import viewer branch has no upload/commit control.
- Updated for the widened nav (still asserting `read_only`/`college_admin` gain nothing): `unauthorized-access-ux`, `platform-product-closure`, `data-onboarding-readiness-wizard`, `core-workflow-simplification`.
- Added for migration 3: not-applied marker; proof the executable SQL has **no `CREATE TRIGGER`, no `DO` loop, and no RPC definition/grant/revoke at all** (each of the six read RPCs, both preflight RPCs, and `can_manage_college` asserted absent by name); the helper's `STABLE`/`SECURITY DEFINER`/pinned-`search_path`/revoke-grant shape and its multi-role predicate, plus its UI mirror; proof that exactly three policies are dropped and re-created, each keeping its original condition and adding the exclusion, with no SELECT policy dropped; proof that `al_insert` no longer carries the blanket viewer ban; rollback coverage for all three policies with the helper dropped last; and documentation assertions that the four read gates already pass through `can_view_college` while `can_manage_college` survives only as a write-affordance flag.
- Results: `bunx tsgo --noEmit` clean · `bun test` 66/66 pass · harness suite 65 pass / 0 fail · build OK.
- **No live-database test is claimed.** Negative write proofs here are design/source proofs; a signed-in `institutional_viewer` session was not exercised.

## 5. Rollback

1. Revert the source commit (UI/type changes are inert without the enum value).
2. Restore the previous SQL definitions: `can_view_college` = `is_super_admin OR user_in_college`; recreate `col_select`, `prof_select`, `ur_select`, `uc_select`, `al_select`, `al_insert` without the `is_institutional_viewer` terms; `DROP FUNCTION public.is_institutional_viewer(uuid)`.
3. Migration 3 rollback SQL is a comment block at the foot of its own file: restore the pre-migration definitions of `prof_insert`, `prof_update`, and `al_insert` (`actor_id = auth.uid()`), then `DROP FUNCTION public.is_institutional_read_only_actor(uuid)` once nothing references it.
4. The enum value cannot be dropped in Postgres; leaving it unused is harmless. Remove any `user_roles` row carrying it first.

## 6. Follow-up before granting the role to a real person

Run a live acceptance pass as an actual `institutional_viewer` session: open every route, confirm all 8 colleges appear in the switcher, and confirm a direct Data API write and one mutating RPC both fail.

## 7. Disclosure — applied state

Migrations 1 and 2 were already **applied to the live database in the previous stage** of this conversation (verified: enum value present, `is_institutional_viewer` present, `can_view_college` widened, `can_manage_college` untouched, 0 unguarded write policies). **Migration 3 is not applied** and must be submitted through the platform migration tool before the role is granted to anyone. This stage therefore made no database change; the SQL above is the file-of-record for review and rollback. Baseline counts observed read-only: colleges 8, teaching_assignments 263, schedule_versions 3. No user or production row was created or modified in this stage.
