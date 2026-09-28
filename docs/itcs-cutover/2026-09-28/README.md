# Version-scoped timetable correction

The timetable execution manifest is operational data supplied through the authenticated Super Admin interface. It is deliberately not included in this public source repository.

This change preserves selected-version delivery facts while cloning, isolates draft lecturer replacements from published history, and selects the correct assignment in workload and cohort validation. Official home-college decisions and placements commit atomically. Deferred cohort validation prevents a partially approved split cohort from committing with different lecturers.

`public.itcs_cutover_execute` is the only cutover entrypoint. Publication requires the reviewed manifest, matching current revision, an official quality run with zero hard conflicts, coverage and student path checks, and unchanged historical session hashes. Source versions are archived only through official transitions after the corrected draft passes every gate. No trigger or RLS bypass is used.

Local verification passed: clone fact/provenance checks, four scoped assignment and cutover database integration tests, seven manifest tests, TypeScript, production build, scoped ESLint, and `git diff --check`. Tests cover atomic rollback, single-group rejection, complete batch approval, idempotence, workload lifecycle, historical preservation, and selected-version membership rather than mutable global partitions.

Before publication, a failed transaction leaves the source published timetable intact. After publication, restore through a new validated clone and official transitions; archived history is never directly republished.
