# LAUNCH-CLOSURE-03 — supplement: print / export rendering proof (fixture)

Stage: supplement to the active LAUNCH-CLOSURE-03 (no restart, no duplication).
Nothing here applies production SQL, deploys, mutates production data, or uses any credential.

## 1. What was proved, and what it is NOT

| # | Gate | Result | Evidence class |
|---|------|--------|----------------|
| 1 | Real `PrintSheet` renders the real Arabic RTL sheet in a real browser | PASS | fixture runtime (Chromium) |
| 2 | `@page` size/orientation honoured for A4/A3 × portrait/landscape | PASS | fixture runtime (`pdfinfo` geometry) |
| 3 | Long Arabic multi-page fixture (120 sessions, 8 sheets) paginates | PASS | fixture runtime |
| 4 | Table header row repeats on every page that carries rows | PASS | fixture runtime (per-page `pdftotext`) |
| 5 | No blank printed pages, no orphaned footer page | PASS after fix | fixture runtime |
| 6 | No ink at the page edge (clipping) and no horizontal overflow | PASS | fixture runtime (pixel scan + DOM metrics) |
| 7 | Arabic text is really embedded and extractable (no tofu) | PASS | fixture runtime |
| 8 | Short fixture prints exactly the published shape: practical Sunday 08–10, theory Monday 08–10 | PASS | fixture runtime (mirrors the root observation, does not replace it) |
| 9 | `downloadCSV` → real download event, real bytes, BOM, Arabic header, 120 rows | PASS | fixture runtime (saved file) |
| 10 | `downloadXLSX` → real .xlsx, parses, 120 data rows, Arabic intact | PASS | fixture runtime (saved file) |
| 11 | `exportRowsToXlsx` (admin export) → real .xlsx, parses, 120 data rows | PASS | fixture runtime (saved file) |
| 12 | No console/page errors during the whole run | PASS | fixture runtime |
| 13 | Source contracts for the shared page box / harness isolation | PASS | source assertions only |
| 14 | Authenticated production print + Excel download by a logged-in college admin | BLOCKED | reviewer/root only — agents have no session |
| 15 | Durable availability migration applied in production | HOLD | awaits root review (unchanged from LAUNCH-CLOSURE-03) |

Explicitly **not** claimed: the root browser's Excel download timeout is not reproduced here and is
not established as an application defect. Gates 1–12 are proof about **fixture** rendering through the
real components; they are not a substitute for the root-authenticated view.

## 2. Root cause found and fixed

**Orphaned footer page (reproduced, then fixed).** On A3 landscape the shorter page box pushed
`.print-center-footer` (page numbering + endorsement line) alone onto an otherwise empty printed
page — 16 physical pages for 8 sheets, half of them footer-only. The print block already prevented
breaking *inside* the footer but never prevented a break *before* it. Fix in `src/styles.css`:

```css
.print-center-footer { break-before: avoid; page-break-before: avoid; }
```

After the fix all four paper/orientation combinations report `0 blank pages` and every row-bearing
page carries the repeated header row.

**Page-box drift risk (prevented).** The `@page` rule was inlined in the print-centre component, so
any proof harness would have had to copy it and could silently drift. It now lives in
`src/lib/print-center/page-style.ts` (`printPageStyleCss`, `PRINT_PAGE_STYLE_ELEMENT_ID`) and both
the application and the proof harness inject the identical rule.

## 3. Changed files

- `src/lib/print-center/page-style.ts` (new) — single source of truth for the printed page box.
- `src/lib/print-center/index.ts` — re-export the helper.
- `src/components/print-center/print-center-page.tsx` — inject the shared rule instead of an inline copy.
- `src/styles.css` — footer `break-before: avoid` fix (print block only).
- `scripts/print-proof/{index.html,entry.tsx,fixture.ts,vite.config.mts}` (new) — isolated fixture app
  mounting the **real** `PrintSheet`, real `filterPrintSessions`/`groupPrintPages`/`buildExportRows`
  and the real `downloadCSV`/`downloadXLSX`/`exportRowsToXlsx`. No database, auth, router or Supabase import.
- `scripts/print-proof/run.py` (new) — Chromium runner: PDF per paper/orientation, PNG rasterisation,
  clipping/overflow/header/blank-page checks, real download capture and CSV/XLSX parsing.
- `tests/print-proof-harness.test.ts` (new) — 13 tests / 51 assertions guarding the contracts above.
- `tests/harness/print-center.harness.ts` — accepts the shared page-style helper as the injected rule.
- `docs/print-proof/` — evidence artifacts (2.7 MB): 5 PDFs, sample PNG pages per combination,
  the downloaded CSV and both XLSX files, and `RESULTS.json` (51 passed / 0 failed).

## 4. Commands and results

```
bunx vite build --config scripts/print-proof/vite.config.mts   → built (isolated fixture bundle)
python3 scripts/print-proof/run.py                             → PRINT_PROOF: 51 passed, 0 failed
bunx prettier --write <changed files>                          → unchanged (already formatted)
bunx tsgo --noEmit                                             → clean
bunx eslint <changed files>                                    → 0 errors (1 react-refresh warning in the fixture entry)
bun test                                                       → 160 pass / 0 fail, 531 assertions, 18 files
bun run test:harness                                           → HARNESS_SUMMARY: 68 passed, 0 failed
bun run build                                                  → success (nitro build emitted)
```

The fixture data is synthetic: college id `00000000-0000-4000-8000-00000000f170`, course codes
`FX-C*`, invented Arabic programme/instructor/room names. No real college, no TEST_ONLY row, and no
production table was read or written by this stage.

## 5. Remaining dependencies

1. Root/reviewer, authenticated: open the print centre for the published TEST-SIMP-03 schedule,
   print to PDF and download the Excel export; attach the file to close gates 14 (and to settle the
   earlier download timeout, which remains unexplained rather than diagnosed).
2. Root review of `docs/migrations-proposed/20260910T0025_availability_temporal_integrity_and_bulk_rpc.sql`
   with its preflight and rollback before any production application (gate 15).
3. No deployment in this stage.
