# Academic staffing — stage 1 readiness and development gate

Approved scope: implement the adopted academic staffing design in stages and keep
the exact Arabic notice `جاري التطوير` until completeness and calculation validity
are proven. This change implements the first stage: a live readiness matrix in the
executive dashboard, not an approved hiring calculator.

## Behavior

- President, dean and academic-affairs executive dashboards share the same entry,
  theme, notice and staffing detail tab. The dean retains the existing single-college scope.
- Reuse the authorized `leadership_overview` response and its viewer/period query key.
  No new requests are introduced on page load or opening the staffing tab.
- Show period definition, program/group observations, incomplete quota/shared-load
  records, rank classification and allocation problems for the selected colleges.
- The notice remains available during initial loading, empty or failed overview
  reads. Stale snapshots are labeled, not promoted to verified evidence.
- Keep existing personal quota deficit and teaching coverage separate from hiring need.
  `full_time` does not certify permanent appointment; published schedules and zero
  visible defects do not certify curricular or staff completeness.
- Required evidence covers curriculum, appointment/identity, quota/availability,
  eligibility, core/service scope, vacancies, cohort growth and calculation validation.
- Current hiring gaps, proposed positions and recommendations remain null. No
  fake zero, staffing percentage, forecast numbers, or client-side approval toggle.
- CSV/XLSX adds readiness descriptions and the development notice. Existing metrics
  remain intact. The visible entry and official print note preserve the notice in print.

## Release boundary

`buildStaffingReadiness` is a source-observation adapter, not a certification engine.
Its input contract deliberately has no way to mark hiring recommendations approved.
A subsequent stage must introduce a server-verified, versioned and period-bound
source/evidence contract, the approved calculation engine, and role/scope tests
before replacing the development state. Simply filling existing counts is insufficient.
Future work includes core/service classification, specialization-compatible capacity,
two-term position analysis, funded vacancies, cohort forecasts and allocation scenarios.

## Security and production review

- Files: staffing observation model/panel/tests, executive route/detail-tab union/CSS,
  leadership CI workflow and this implementation note.
- Migrations: no. RLS: no. RPC contracts: no.
- Authentication: unchanged. Authorization: unchanged; executive route guard,
  server-scoped response, scoped details and viewer-specific caching are reused.
- No new personal data fields, external calls, writes or stored approvals.
- React escapes labels; malformed/incomplete observations do not become approvals.
- Privilege escalation risk: no access expansion introduced.
- Production impact: low, read-only UI and export additions; existing data unchanged.
- Rollback: revert the feature commit; there are no data migrations to reverse.

## Acceptance

Focused tests exercise publication/full coverage without certification, empty/null
input, approved zero quota, ambiguous periods, unclassified ranks, inconsistent
counts, temporary coverage, the entry action, export gating, scoped/escaped markup,
stale snapshots and route integration. Existing executive role and report tests must
also pass. Merge/deploy readiness requires passing checks on the actual PR head;
the deployed notice and matrix must be verified in the live browser.

Local validation on baseline `3a7870e4bae7bb6bc0a0814d58385548bcd7e67a`:
69 focused staffing/executive/report tests passed, TypeScript completed without
errors, production build completed, and `git diff --check` passed.
