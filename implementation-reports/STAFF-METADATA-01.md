# STAFF-METADATA-01 — Truthful instructor metadata (source-only)

Baseline: `acbd9241cc8ac3e88bcb4a8e31e9f81d159b682a` (clean tree; pending JAWF partition/cadence
work untouched).

No schema change, no SQL, no data mutation, no deployment. Scheduling policies, hours and
permissions unchanged.

## Problem

`instructors.employment_type` is `text NOT NULL default 'full_time'`, and both the UI form and the
import payload builder defaulted blanks to `full_time`. That turned "not confirmed" into a false
full-time fact. The user supplies permanent (مثبت) / outside-college affiliation, rank and teaching
systems — never full-time status.

## Changes

- `src/lib/instructor-metadata.ts` (new, shared): `UNKNOWN_EMPLOYMENT_TYPE = "unknown"`,
  `EMPLOYMENT_TYPE_OPTIONS` (unknown → «غير محدد (لم يُثبت بعد)» first, then متفرّغ / غير متفرّغ /
  زائر / متعاقد), `EMPLOYMENT_TYPE_IMPORT_VALUES`, `employmentTypeLabelAr` (missing/unrecognised →
  غير محدد, never full-time), `normalizeEmploymentType` (blank → unknown, explicit preserved),
  `ACADEMIC_RANKS` = existing ranks + `مدرس` + `أستاذ دكتور`.
- `src/routes/_authenticated/instructors.tsx`: new-instructor form defaults employment to
  `unknown`; field relabelled «حالة التفرغ/التعاقد» with a hint; list rows render the employment
  label through the shared map and now also show «فئة المحاضر» (from `instructor_type_id` via the
  existing `categorizeInstructor`); ranks come from the shared list; edit path still loads the
  stored explicit value verbatim; loose `any` types in this file replaced by `InstructorTypeRow`.
- `src/lib/excel-import/validators.ts`: `buildDbPayload("instructors")` now uses
  `normalizeEmploymentType(v.employment_type)` instead of `?? "full_time"`.
- `src/lib/excel-import/templates.ts`: instructors `employment_type` enum = shared values
  (includes `unknown` and `contract`), example `unknown`. `academic_rank` remains free text, so
  `مدرس` and `أستاذ دكتور` are accepted as supplied.
- `src/lib/data-templates/catalog.ts`: instructors sheet documentation/allowed list and sample row
  updated to `unknown | full_time | part_time | visiting | contract`.
- `tests/staff-metadata-01.test.ts` (new): absent/blank never becomes `full_time`; explicit values
  preserved; unknown/unrecognised render «غير محدد»; unknown first in shared options and present in
  import values; existing ranks retained plus the two new ones; template accepts `unknown` and
  keeps rank free-text; validator no longer hardcodes the full-time default; page uses shared maps,
  unknown default, new label and category line.

Not invented: no degree, hours, or system fields were fabricated. Teaching systems remain in notes
pending native schema, as root stated.

## Verification

- `bun test` — 247 pass / 0 fail, 853 expect calls.
- `bunx tsgo --noEmit` — clean.
- ESLint on all changed source files — clean (also cleared 3 pre-existing `any` errors in the
  instructors page).
- `node tests/harness/run.mjs` — 68 passed, 0 failed.
- Build log — `build OK`.

Root review pending; no publish performed by the agent.
