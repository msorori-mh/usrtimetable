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
- ITCS cutover runs only through public.itcs_cutover_execute (single transaction, Super Admin, composes Rev2/Rev3.1 RPCs and official transitions). Why: one fail-closed path with CAS and no trigger bypass.
- A shared (merged) lecture counts once in teaching load: a delivery group that is a merged member in the newest published timetable of its college and term (`schedule_version_delivery_private.shared_link_facts`) and has no session of its own carries no standard load. `public.delivery_group_shared_in_published` is the single test; `v_instructor_delivery_workload`, both assignment workspace functions and `preview_instructor_workload_after_assignment` all apply it next to `excluded_from_standard_workload` (`supabase/migrations/20261003010000_shared_lecture_counts_once.sql`). Why: version-level merges were invisible to the load readers, so one lecture was counted twice. Any new reader of standard load must use the same test.
- The assignment workspace shows a lecture merged in the published timetable once, on its anchor group, naming every attending cohort; the merged member is not a row of its own (`public.published_shared_lecture_members`, `public.operational_shared_lecture_group_ids`, `supabase/migrations/20261003020000_published_merges_in_assignment_workspace.sql`). Why: a version-level merge left the member as a separate row carrying a stale lecturer name.
