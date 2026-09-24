# PRINT-HEADER-05 — compact Arabic timetable header

Baseline: `5bb76aa71b34396a7bc3f33791a7cf679219004d`.

Scope: shared print header and isolated print-proof fixtures only. No database, SQL,
authentication, permissions, scheduling, export-data, uploaded-file or deployment changes.

## Result

The former ten-line identity stack and repeated standalone title were replaced with:

1. an RTL identity band: university logo and university/college at the right, a centered
   `الجدول الدراسي` title, and the existing verification QR at the left;
2. a balanced labelled details grid for department/program, level/study system, and
   term/year;
3. a subdued status/version/export-date row;
4. the existing group title retained in the repeating table header, so every continuation
   page remains identifiable.

All visibility switches, missing-value behavior, college fallback, QR URL/content,
draft/published behavior, eight timetable columns and student/instructor/room data paths are
unchanged. Long Arabic names wrap within bounded grid cells. Print output uses the existing
semantic palette, white surface, fine rules, and a restrained navy accent suitable for
grayscale.

## Changed files

- `src/components/print-center/print-sheet.tsx`
- `src/styles.css`
- `scripts/print-proof/shell-entry.tsx`
- `scripts/print-proof/run-shell.py`
- `tests/print-header-05.test.ts`
- `tests/launch-closure-01.test.ts` (updated wording assertions only)
- `docs/print-proof/full-shell/*` and `docs/print-proof/RESULTS.json` (regenerated evidence)
- `docs/PRINT-HEADER-05.md`

## Runtime evidence

The full-shell fixture mounts the real `AppLayout` and real `PrintSheet`, with inert
auth/data/navigation substitutes and no backend access. Its long case now includes long
Arabic college, department, program, level, term and version values.

Matrix: A4/A3 × portrait/landscape × desktop/mobile starting viewport × long/short = 16
PDFs. Assertions cover compact header structure, title/identity/details/metadata, retained
group title, bounds at real printable width, no app chrome, no overflow/clipping, all eight
columns, exact short-fixture rows, physical counters and blank-page detection.

- Full-shell proof: **273/273 PASS**
- Existing standalone print/export proof: **79/79 PASS**
- `bun test`: **200/200 PASS**, 675 assertions
- TypeScript: **PASS**
- Focused lint: **PASS** (one pre-existing fixture-only fast-refresh warning, zero errors)
- Static harness: **PASS**
- Preview build telemetry: **build OK**

Independently inspected renderings:

- `docs/print-proof/full-shell/shell-desktop-A4-portrait-short.pdf`
- `docs/print-proof/full-shell/shell-mobile-A4-landscape-short.pdf`
- `docs/print-proof/full-shell/shell-desktop-A4-portrait-long.pdf`
- `docs/print-proof/full-shell/shell-mobile-A4-landscape-long.pdf`
- corresponding first-page PNGs under `docs/print-proof/full-shell/`

The inspected pages show the official header only, centered title, QR fully inside the page,
long Arabic metadata contained in its grid, all eight columns intact, and correct physical
page counters.

## Residual gate

The prior user-produced Microsoft Print To PDF artifact remains **HOLD** for native-driver
orientation/clipping validation. Headless PDF evidence does not claim to validate that
specific native dialog or driver. No deployment was performed; root review remains required.