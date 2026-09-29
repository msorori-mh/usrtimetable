# University executive report — 29 September 2026

## Scope and baseline

The university leadership needs one report containing a college comparison and each college's departments, weekly teaching demand, teaching staff, halls and laboratories, seat stock, and occupied/free weekly room time.

Baseline: `origin/main` at `cb30b396`. Isolated branch: `feat/university-executive-report-20260929`. The original checkout and its unrelated untracked migration work were left intact.

## Delivered code

- `/reports/university-overview`, linked from the reports hub and leadership dashboard.
- RTL university summary, college comparison, expanded department/resource/staff details, academic-period and college filters, Arabic search, presentation navigation, printable details, and CSV/Excel summary export.
- Published schedules are authoritative by default for other colleges. Presentation mode may select the newest non-disposable ITCS working version only if all current demand groups and weekly hours are complete. Its draft/review/approved status remains visible; completeness is not schedule validation or publication approval. Published-only mode is available.
- Existing `leadership_overview` and `leadership_metric_details` RPCs determine the authorized colleges and period. Supplemental reads remain under existing RLS and paginate beyond 1,000 records. No database, role, scheduling, assignment or RLS changes.
- Teaching belongs to the beneficiary college; physical room occupancy belongs to its owner. Shared groups are counted once. Staff totals use home-college affiliation and the server's university unique count.
- Room capacity derives from actual configured availability. Occupancy uses interval union. Seats and weekly hours are distinct. Missing schedules, incomplete reads and invalid availability do not become fabricated zero/free capacity. Unmapped hours remain visible.

## Evidence

- **PASS:** 103 tests across leadership, academic affairs, room capacity, decision presentation, metric drilldown and the new report.
- **PASS:** TypeScript `tsc --noEmit`.
- **PASS:** focused ESLint for all new TypeScript/TSX files and the new test.
- **PASS:** production build, client and server, using the versions/integrities recorded in `bun.lock`.
- **PASS:** `git diff --check`.
- CI leadership workflow includes the new report's tests and test-path trigger.

Local Bun could not parse its configuration in this execution environment. A temporary npm lock was derived from the unchanged Bun lock and installed with `npm ci --legacy-peer-deps --ignore-scripts`. The temporary npm lock was removed. No dependency declarations, lockfile, release-age guard or guard exclusions were changed.

## Remaining release verification

At this commit, merge, production deployment and authenticated live UI verification are pending. The production browser currently displays the sign-in screen; no live report values have been asserted. Local browser preview was blocked by the browser environment. Server-rendered markup is covered by automated tests, but this does not substitute for authenticated visual verification.

The page displays only data visible to the current account. Free weekly hours may be spread across incompatible days/time windows and do not imply a contiguous teaching slot. No individual personnel decisions are made by this report.
