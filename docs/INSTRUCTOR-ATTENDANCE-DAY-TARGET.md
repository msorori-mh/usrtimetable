# Explicit instructor attendance-day target

Department heads and similar roles must be present on campus a fixed number of days per
week, which conflicts with the general preference to compress an instructor's teaching
into as few days as possible.

## Model

`instructors.target_attendance_days_per_week` (`smallint`, nullable, CHECK 1..6).

- `NULL` (default, all existing rows): unchanged behaviour — generic instructor day
  compression applies.
- Set: the value is the explicit weekly attendance-day target for that instructor.

Currently set to `5` for: د. رمزي الجابري، د. خالد البراحي، د. أسامه عبدالجليل سيف،
د. مبارك السفياني.

## Priority

1. Hard constraints stay authoritative: `instructor_availability` (رمزي غير متاح السبت،
   مبارك غير متاح الأحد), room/instructor/student conflicts, capacity, room type,
   daily-hour caps. A target never unlocks a blocked slot.
2. Student attendance-day rules (`excessDaysOverFive`, `excessDaysOverFour`,
   `excessDaysOverThree`) are unchanged and still rank above the target.
3. `instructorTargetDayDeviation` — `sum(|attended days - target|)` over instructors that
   declare a target — ranks next, above generic gap/attendance-day compression.
4. Generic instructor gap and day compression follow.

## Engine wiring

- `measureAttendance(events, weight, instructorTarget)` in
  `src/lib/auto-scheduler/attendance-objective.ts` computes the deviation and exposes it
  as `instructorTargetDayDeviation`; the comparison `vector` includes it directly after
  the student day terms.
- `measure()` in `src/lib/auto-scheduler/compact.ts` supplies the lookup from the
  snapshot's instructor rows, so compaction, relayout and V2 generation ranking
  (`rankGenerationCandidates`) share one objective.
- `better()` treats the deviation as a protected metric: no accepted move may increase it.

## Deliberate non-goals

The target only steers placement of real work during normal placement/replacement. The
engine never invents filler sessions and never splits a session just to occupy an extra
day; if the instructor's actual workload cannot span five days, the deviation simply
remains greater than zero.

## Tests

`tests/instructor-attendance-target.test.ts` — deviation in both directions, range
validation, preference for the five-day layout, student rules staying on top, protected
metric behaviour, and snapshot wiring.
