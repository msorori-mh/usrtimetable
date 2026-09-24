# AVAILABILITY-ALL-ACTIVE-DAYS-BULK-ENTRY-01

**Decision:** `PASS — AVAILABILITY_ALL_ACTIVE_DAYS_READY` (pending gates/PR)

**Branch:** `codex/availability-all-active-days`

## Domain separation (mandatory)

| Layer                      | Source of truth                                                                             | Role on this screen                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Operational calendar**   | `scheduling_settings.working_days` (+ day start/end) — «أيام وفترات الدوام»                 | Sole source for expanding «كل أيام الدوام». Not stored as unavailability.                                  |
| **Unavailability**         | `instructor_availability` (`unavailable` + `is_preference=false`) and `room_unavailability` | **Only** purpose of `/availability`. Always Hard. Default: active resources available during working days. |
| **Preferences (Soft)**     | Soft rows / scorer path (`is_preference=true`)                                              | **Out of scope.** Separate future/independent path. Not offered in UI.                                     |
| **Structural constraints** | `/constraint-settings`                                                                      | **Not duplicated.** Max hours, breaks, back-to-back, etc. stay there.                                      |

`operational calendar ≠ unavailability ≠ preferences ≠ structural constraints`

## What shipped

1. First day option: **كل أيام الدوام** (UI sentinel `all_active_days` — never persisted).
2. Server expands to one row per active working day from `scheduling_settings`.
3. Preview: «سيتم تطبيق فترة عدم التوفر على X أيام».
4. Day dropdown = active `working_days` from settings (+ «كل أيام الدوام»), not a hardcoded Sun–Sat list.
5. Atomic SECURITY DEFINER RPCs (source-only migration **NOT APPLIED**):
   - `upsert_instructor_unavailability_for_active_days`
   - `upsert_room_unavailability_for_active_days`
6. Pre-validate all days before DML; overlap/invalid time → full reject with day reason.
7. Duplicate exact matches → `days_created` / `days_unchanged` (no misleading success).
8. UI tabs: instructor unavailability + room unavailability only (no room availability tab).
9. Conflict engine: hard unavailability is blacklist; sessions outside blocks remain allowed when no positive whitelist windows exist.
10. Focused harness: `tests/harness/availability-all-active-days.harness.ts`

## Active-day resolution

- Read `scheduling_settings.working_days` for the resource’s college.
- Fallback if empty/missing: `[6,0,1,2,3,4]` (Sat–Thu). Friday (5) only if enabled.
- Single-day selection still supported (`p_day_of_week = 0..6`).

## Coverage

| Flow                           | Covered                               |
| ------------------------------ | ------------------------------------- |
| Instructor hard unavailability | Yes (RPC + UI)                        |
| Room hard unavailability       | Yes (RPC + UI)                        |
| Room availability whitelist UI | **Removed** (rooms default available) |
| Soft preferences               | Not on this screen                    |
| Structural constraints         | Untouched                             |

## Atomic behavior

Single Postgres function call = one transaction. Pre-validation loop then insert loop. Any overlap/auth/time error raises → full rollback. No partial success.

## Duplicate / overlap

- Exact match (same resource, day, times, hard unavailable): count as unchanged, no insert.
- Overlapping different window on any targeted day: reject entire operation; UI shows conflicting day.

## Migration

- Path: `supabase/migrations/20260720120000_source_only_availability_all_active_days.sql`
- Status: **NOT APPLIED** (source-only)
- No production DB writes in this phase

## Security Review

- Files changed: availability UI, bulk API helpers, conflict validator semantics, source-only migration, harness, nav label, report
- Migrations changed? **yes** (source-only file added; not applied)
- RLS changed? **no**
- RPCs changed? **yes** (new DEFINER RPCs in source)
- Authentication impact: **yes** (`auth.uid()` required)
- Authorization impact: **yes** (`can_manage_college`; college from resource)
- Sensitive data exposure: **no**
- Privilege escalation risk: **no** (PUBLIC/anon revoked; authenticated execute only)
- Production risk: **low** (until migration applied)
- Ready for merge: **yes** (after gates)
- Ready for deploy: **no** (migration not applied; no deploy)

## Verification

- Focused harness: **PASS** (`availability-all-active-days.harness.ts`)
- TypeScript (`tsc --noEmit`): **PASS**
- Build: **PASS**
- Scoped ESLint (feature files): **PASS**; pre-existing `no-explicit-any` at `validator.ts:232` unrelated
- `git diff --check`: **PASS**
- DB write / migration apply / deploy / publish: **not executed** (source-only)

## Production impact

- Source-only until migration applied.
- After apply: create path for day-based unavailability goes through RPCs; UI no longer offers Soft/available/room-availability whitelist.

## Remaining risks

- Legacy positive hard `available` windows (imports) still act as whitelist for that day — intentional backward compatibility.
- External/other-college “availability required when empty” rule unchanged.
- Date-only room unavailability (`_none`) still uses direct insert (legacy path).

## Recommended next step

1. Merge source-only PR after gates.
2. Separately schedule controlled migration apply.
3. Optional: Soft preferences UI on a dedicated screen.
