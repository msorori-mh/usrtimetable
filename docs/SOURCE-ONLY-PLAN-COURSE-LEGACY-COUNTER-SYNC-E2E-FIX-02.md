# SOURCE-ONLY PLAN COURSE LEGACY COUNTER SYNC — E2E FIX 02

Baseline commit: `611a01f649c5e3f7690bd6095a8b42e623c1b1ef`.
No SQL, no migration, no schema/RLS/RBAC/auth change, no publish, no production data mutation by the worker.

## 1. Findings — who reads/writes the legacy counters

`plan_courses.lectures_per_week`, `labs_per_week`, `lecture_session_duration`, `lab_session_duration`
are still the scheduling source for downstream code, while the new model writes
`plan_course_components` only. Repo consumers (read-only unless noted):

| File | Role |
| --- | --- |
| `src/lib/reports/readiness.ts:210,294-320` | readiness metrics incl. blocker "بدون عدد محاضرات أسبوعية" |
| `src/routes/_authenticated/data-readiness.tsx:180,260-277` | same metrics in the readiness page |
| `src/routes/_authenticated/data-cleanup.tsx:111,323-330,841-843` | flags rows with zero counters / missing durations / room types |
| `src/lib/auto-scheduler/greedy.ts:237-252,426-441` | expands `n` sessions × `duration` hours into sessions |
| `src/lib/excel-import/templates.ts`, `validators.ts`, `src/lib/data-templates/catalog.ts` | import templates still carry the four columns |
| `src/components/study-plans/plan-courses-manager.tsx` | **only writer in the app** (this fix) |

Evidence of the blocker: for `TEST-E2E-C101` the UI created theory 2h + practical 2h components
while `lectures_per_week`/`labs_per_week` stayed at their DB defaults (0), so readiness stayed at 30 %.

## 2. Fix

`src/lib/academic-delivery/plan-course-editor.ts` (pure, no DB):

- `deriveLegacyCounters(components, currentRow)` — `theory` + `tutorial` weekly hours map to lectures,
  `practical` maps to labs; non-timetabled components contribute nothing.
- `pickSessionDuration(hours, current)` — keeps the stored duration when it divides the weekly hours
  exactly, otherwise tries 2, 3, 1. Invariant: `count × duration === weekly hours`; durations never
  become 0 (readiness treats 0 as missing). For 2 h / 2 h this yields **1 lecture and 1 lab per week**.
- `buildLegacyCounterUpdate` — payload restricted to the four legacy columns, nothing else.
- `countersDiffer` — suppresses no-op writes.
- `LEGACY_SYNC_PARTIAL_ERROR_AR` — explicit Arabic error naming the retry action.

`src/components/study-plans/plan-courses-manager.tsx`:

- Loads the four counters with the plan-course rows and shows them per row
  (`plan-course-counters-<id>`).
- `syncLegacyCounters(planCourseId)` re-reads components from the DB after the write, then updates
  `plan_courses` scoped by `id` + `college_id` + `study_plan_id`, fail-closed through
  `planCourseUpdateScope`.
- Chained after component generate, add, update and delete, so counters stay correct in all four paths.
- Explicit user action **«مزامنة بيانات الجدولة»** per plan course (`plan-course-sync-counters-<id>`)
  repairs pre-existing rows that have components but zero counters — no background production write.
- Partial failure (component write ok, counter write failed) throws the explicit Arabic error and
  invalidates the readiness/plan queries; success is never reported in that case.
- No privileged client, no RPC, no bypass; tenant/RLS boundaries and existing UX unchanged.

## 3. Tests / gates

- `tests/plan-course-legacy-counter-sync.test.ts` — sync math (2 h/2 h ⇒ 1/1), hour×duration
  invariant, tutorial folding, non-timetabled exclusion, delete/zero behaviour, payload restriction,
  no-op detection, Arabic error.
- `tests/harness/plan-course-legacy-counter-sync.harness.ts` (registered in `tests/harness/run.mjs`) —
  same math plus static assertions that all four mutations sync, the explicit action exists, the write
  is scoped by id + college + study plan, errors refetch, and no service-role client is used.

Gate results: prettier (changed files) ✓ · typecheck ✓ · lint (changed files) ✓ ·
`bun test` **73 pass / 0 fail** · harness **68 passed / 0 failed** · build OK.

## 4. Honest limitations

- Legacy counters remain a derived mirror; a stale row is only repaired when a user opens the manager
  and either edits components or presses «مزامنة بيانات الجدولة». There is no bulk/background repair.
- The two-step write (components, then counters) is not transactional. It is fail-loud, not atomic:
  on a counter-write failure the components stay saved and the user is told to retry the sync.
- Rows written by other paths (Excel import, direct SQL, older UI) are not touched by this fix.
- Mapping decisions are conventions, not schema facts: `tutorial` counts as lectures, `project` and
  `summer_training` count as neither, and odd weekly hours collapse into a single longer session.
- `required_room_type_for_lecture/lab` are left untouched; the data-cleanup room-type warnings are
  unchanged by design.
- Verified by unit/harness/static checks only — no production data was written or read by the worker.
