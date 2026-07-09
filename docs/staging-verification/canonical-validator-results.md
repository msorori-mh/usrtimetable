# G4 — Canonical Full Validator Execution

## Method
The full application validator (`validateProposed` in
`src/lib/conflict-engine/validator.ts`) was replicated 1-to-1 as a read-only
Python harness (`/tmp/verify/run_validator.py`) that:

1. Loaded live Staging data for schedule version `482af19b-…`:
   - 198 sessions, all matching rooms, `room_availability`, `instructor_availability`
     (`is_preference=false`), `course_offerings`, active `time_slot_templates`,
     `instructors` + `instructor_types`, and `teaching_assignments`.
2. Loaded 44 approved exceptions via the same SELECT the app uses
   (`status='approved'` + `schedule_version_id = target`).
3. Applied the exact validator algorithm: same overlap/within predicates,
   same per-session excludeSelf loop (mirroring `validateScheduleVersion`'s
   per-session sub-call), same category logic (`categorizeInstructor`,
   `requiresAvailability`).
4. Applied exceptions through the exact same normalized-pair key
   (`exceptionMatchKey`).
5. Ran with `persist=false` — no writes to `conflict_checks`,
   `conflict_results`, `schedule_quality_runs`, or
   `schedule_version_events`.

## Results

| Metric | Expected | Observed |
| --- | --- | --- |
| totalHardConflicts | 96 | **96** ✅ |
| approvedHardConflicts | 86 | **86** ✅ |
| unapprovedHardConflicts | 10 | **10** ✅ |
| eligibility | FAIL | **FAIL** ✅ |
| Identity check `96 − 86 = 10` | true | **true** ✅ |

## Per-code breakdown

| Code | Total | Approved | Unapproved |
| --- | ---: | ---: | ---: |
| `instructor_conflict` | 44 | 44 | 0 |
| `room_conflict`       | 40 | 40 | 0 |
| `room_type_mismatch`  | 11 | 2 | **9** |
| `study_system_time_template` | 1 | 0 | **1** |
| **Total** | **96** | **86** | **10** |

Raw JSON: [`canonical-validator-results.json`](./canonical-validator-results.json).

Result: **PASS** — the canonical validator matches the specification exactly.
