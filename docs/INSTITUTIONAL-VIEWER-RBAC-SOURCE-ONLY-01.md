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

## 2. Migrations (2 files, deliberately split)

| File | Content |
|---|---|
| `supabase/migrations/20260907011528_5aff0fb9-b1ca-461d-9396-b3a52b763f2d.sql` | **Only** `ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'institutional_viewer';` — the value cannot be used in the same transaction, so nothing else lives here. |
| `supabase/migrations/20260907011642_82a09c5b-0bb2-4101-8ed8-1e27db772d16.sql` | Uses the value after commit: adds `public.is_institutional_viewer(uuid)` (SECURITY DEFINER, `SET search_path = public, pg_temp`, `EXECUTE` revoked from `PUBLIC`/`anon`); widens `can_view_college` with `OR is_institutional_viewer(...)`; widens the **SELECT-only** policies that do not route through `can_view_college`: `colleges.col_select`, `profiles.prof_select`, `user_roles.ur_select`, `user_colleges.uc_select`, `audit_logs.al_select`; and hardens the single authenticated write policy `audit_logs.al_insert` with `AND NOT is_institutional_viewer(auth.uid())` so the role is strictly zero-write. |

Reviewed SELECT-policy inventory at design time: 62 SELECT policies in `public` — 54 route through `can_view_college` (covered automatically), 5 used `is_super_admin` (the 5 administrative ones above), 3 were `true`. No other SELECT surface needed changes.

## 3. Source files changed

| File | Change |
|---|---|
| `src/hooks/use-current-user.ts` | `AppRole` union + `isInstitutionalViewer` derived from `user_roles` (never `user_metadata`). |
| `src/lib/unauthorized-access.ts` | Central guards: `isInstitutionalReadOnlyViewer`, `resolveAdminReadablePageAccess`, `READ_ONLY_VIEW_BADGE_AR`. |
| `src/components/app-layout.tsx` | `Role` union + `ALL` include the role; every nav entry visible to it; Arabic role label. |
| `src/routes/_authenticated/universities.tsx` | Data visible; all forms / edit / delete controls hidden behind `viewOnly`; read-only badge. |
| `src/routes/_authenticated/colleges.tsx` | Same treatment. |
| `src/routes/_authenticated/users.tsx` | Opens via `resolveAdminReadablePageAccess`; read-only list; `adminListUserMeta` **not** called for the viewer; create-user / role management / college assignment / disable / reset hidden. |
| `src/routes/_authenticated/import.tsx` | Dedicated browse-safe branch: official import order + guide link, no file input, no preview, no commit. |
| `src/routes/_authenticated/auto-schedule.tsx` | Viewing notice; run button already `disabled={!canManage ...}`. |
| `src/routes/_authenticated/data-cleanup.tsx` | Already gated by `canManage`: diagnostics visible, all fix actions hidden. |
| `src/lib/users.functions.ts` | `ROLE` enum accepts the new role; college assignment required only for `college_admin`/`read_only`; endpoint stays `super_admin`-only (`eq("role","super_admin")`). |
| `src/integrations/supabase/types.ts` | Regenerated `app_role` enum value. |

Central-guard note: page access and write-control visibility flow through `useCanManageActiveCollege` and `src/lib/unauthorized-access.ts` only — no page invents its own role check, which is what keeps the surface hole-free.

## 4. Tests

- New: `tests/harness/institutional-viewer-rbac.harness.ts` (registered in `tests/harness/run.mjs`). Static/source proofs: role in union + generated types; **every** nav role list contains the role; `useCanManageActiveCollege` not widened; migration 1 is enum-only; migration 2 widens `can_view_college`, never `can_manage_college`, and contains **zero** viewer-granting write policies; admin pages use the central guard + badge + `viewOnly` branch; users page skips `adminListUserMeta`; server endpoints stay admin-only; import viewer branch has no upload/commit control.
- Updated for the widened nav (still asserting `read_only`/`college_admin` gain nothing): `unauthorized-access-ux`, `platform-product-closure`, `data-onboarding-readiness-wizard`, `core-workflow-simplification`.
- Results: `bunx tsgo --noEmit` clean · `bun test` 66/66 pass · harness suite 65 pass / 0 fail · build OK.
- **No live-database test is claimed.** Negative write proofs here are design/source proofs; a signed-in `institutional_viewer` session was not exercised.

## 5. Rollback

1. Revert the source commit (UI/type changes are inert without the enum value).
2. Restore the previous SQL definitions: `can_view_college` = `is_super_admin OR user_in_college`; recreate `col_select`, `prof_select`, `ur_select`, `uc_select`, `al_select`, `al_insert` without the `is_institutional_viewer` terms; `DROP FUNCTION public.is_institutional_viewer(uuid)`.
3. The enum value cannot be dropped in Postgres; leaving it unused is harmless. Remove any `user_roles` row carrying it first.

## 6. Follow-up before granting the role to a real person

Run a live acceptance pass as an actual `institutional_viewer` session: open every route, confirm all 8 colleges appear in the switcher, and confirm a direct Data API write and one mutating RPC both fail.

## 7. Disclosure — applied state

Both migration files were already **applied to the live database in the previous stage** of this conversation (verified: enum value present, `is_institutional_viewer` present, `can_view_college` widened, `can_manage_college` untouched, 0 unguarded write policies). This stage therefore added no new database change; the SQL above is the file-of-record for review and rollback. Baseline counts observed read-only: colleges 8, teaching_assignments 263, schedule_versions 3. No user or production row was created or modified in this stage.
