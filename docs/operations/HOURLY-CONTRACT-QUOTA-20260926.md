# Hourly contract quota guard — 2026-09-26

## Decision and scope

The mathematics department in the College of Education assigns two hourly contractors to ITCS: أ. ماجد عبدالوهاب and د. زينب علي الرباحي. Their `employment_type=contract` and instructor type `con` are already correct; `max_weekly_hours=0` is **not a cap** for this category. Both profiles point to the Education college as home. The canonical `faculty_private.workload` reports `quota_applicable=false`, `required_load_hours=null`, and `status=not_applicable`. In the ITCS draft each teaches six weekly hours. Zainab has 19 assigned weekly hours across the connected colleges.

## Defect

`public.enforce_instructor_extra_hours_limit`, an AFTER trigger on `teaching_assignments`, checked `required_load_hours IS NULL` before recognizing hourly contractors. A new legitimate hourly assignment with the ITCS intake exception disabled failed with `INSTRUCTOR_QUOTA_REQUIRED`. It also enforced a +12 hours ceiling in ordinary cases. The human-approved institutional rule has no fixed teaching-hour quota for type `con`.

## Narrow change

The trigger still checks `allocation_pending` first, then returns for `quota_applicable=false`. All other category quota checks and existing published-source waiver logic remain intact. The BEFORE trigger `faculty_private.guard_assignment_request` still requires home-college approval for borrowed lecturers, and duplicate and status guards remain attached. No instructor profile, affiliation, assignment, session or published schedule is changed by the operation.

## Evidence and recovery

The existing function definition is pinned by an MD5 check before replacement and checked again after replacement. In a single `BEGIN/ROLLBACK` rehearsal, an AFTER trigger on a temporary table rejected Majed's test-only row before the change, then accepted test-only rows for both contractors after the change. The temporary table and function replacement were rolled back. Operation: `supabase/operations/20260926_hourly_contract_unlimited_quota.sql`. Exact-body rollback: `supabase/rollback/20260926_hourly_contract_unlimited_quota.sql`.

The earlier raw comparison of scheduled hours to `max_weekly_hours` reported 12 apparent overruns. Three rows belong to hourly contractors with `quota_applicable=false` (these two and د. عبدالرحمن زياد); nine are quota-applicable. Yasser's 17 versus 16 hours was explicitly approved by the schedule owner as an exception. A fresh quality snapshot and a decision on the remaining academic workload observations are separate timetable publication gates.
