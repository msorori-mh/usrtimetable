# Guidance for every workspace working on this repository

## College of IT & Computer Science (ITCS): teaching hours

- This rule applies only to college code `ITCS`. Its lecture rooms are available through 14:00; theoretical lectures and tutorials must **end by 14:00**.
- From 14:00 to 16:00, only practical/lab sessions may use the college laboratories. An open lab does not make a theoretical lecture permissible at that time.
- Keep the college's general scheduling end time at 16:00 so practical labs remain schedulable. Do not apply this ITCS rule to other colleges.
- Server enforcement is `public._ss_itcs_theory_hours` inside `public._ss_gather`; see `supabase/migrations/20260924090000_itcs_theory_to_14.sql`. The hard conflict `itcs_theory_after_14` cannot be approved as an exception. Regression checks are in `tests/itcs-theory-room-policy.sql`.

## Published timetable requiring correction (observed 2026-09-24)

The published ITCS version `30f8a76d-1cb9-4944-a5d7-483dcaea7692` had 275 sessions and two pre-existing theoretical sessions extending beyond 14:00:

| Session | Day | Recorded time | Session ID |
| --- | --- | --- | --- |
| الذكاء الاصطناعي | Thursday | 14:00–16:00 | `e6a25dcc-f7b4-4385-af71-1567e22bb923` |
| مبادئ إدارة الأعمال | Tuesday | 13:00–16:00 | `8c2b22b3-8e30-4c11-9fcb-40bec48bb5b9` |

The server rule prevents new conflicting placements; it does not rewrite this published timetable. Re-check the live data before acting, then use the approved real timetable to correct the two sessions in a validated draft. Do not invent times or rooms, delete sessions to hide the conflict, or silently republish an older version.

- Version-scoped teaching assignments: a replacement assignment for one draft lives in `assignment_version_private.scope` and is counted only by `validate_version_assignment_allocation`; old assignments stay active for published history. Why: replacing a lecturer in a draft must not rewrite or over-count the published timetable.
