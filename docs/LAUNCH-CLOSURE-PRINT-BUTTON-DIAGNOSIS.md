# Print button diagnosis (bounded stage)

Baseline: `a16d39a0` (root doc `docs/LAUNCH-CLOSURE-ROOT-20260910.md` preserved, untouched).
No production SQL, no deploy, no credentials, no data writes.

## Reported symptom

Root: on deployed `fc339ae7`, Excel and CSV downloads succeed (user-reported, file bytes not
root-inspected), but clicking **طباعة** appears to do nothing.

## Evidence-backed diagnosis

Reproduced with the existing isolated print-proof fixture (real `PrintSheet`, real print
stylesheet, real handler code path), served over `http://127.0.0.1`, driven by the repo's
Playwright Chromium. Runner: `scripts/print-proof/check-print-button.py`.
Raw output committed at `docs/print-proof/PRINT-BUTTON-DIAGNOSIS.json`.

| # | Observation | Result |
|---|---|---|
| 1 | `typeof window.print` in the browser | `"function"` |
| 2 | Instrumented click → `window.print` invocations | `1` (dispatch reaches the API) |
| 3 | Handler result for that click | `dispatched` |
| 4 | `window.print` made to throw → handler result | `failed` + Arabic actionable message |
| 5 | `window.print` removed → handler result | `unavailable` + Arabic actionable message |
| 6 | Native, uninstrumented `window.print()` | returned in ~5 ms, no error, **no visible dialog** |
| 7 | Page console/runtime errors during all of the above | none |

**Conclusion:** the button dispatch is correct — `window.print()` is called exactly once per
click and does not throw. Observation 6 is the actual cause of "nothing happens": in a browser
whose host supplies no print dialog (headless Chromium here; a remote/cloud browser with the
native dialog blocked in root's case) `window.print()` returns immediately and silently. This is
an environment/host limitation, **not** an application defect in the print pipeline.

Honest limits of this evidence:
- A **headed** browser could not be launched in this sandbox (no display; `chromium.launch(headless=False)`
  fails at startup). So a real on-screen print dialog is **not** proven here — only that the app
  reaches `window.print()` without error.
- Headless PDF rendering (previous stage) is explicitly **not** used as proof of the button.
- Root's cloud-browser download success remains user-reported; file contents unverified by root.

## Change made (narrow UX fix only)

`window.print()` stays the one and only print mechanism. Added an honest, testable status so a
blocked or throwing print is no longer silent:

- `src/lib/print-center/print-action.ts` (new): `requestPrint(win)` → `dispatched` |
  `unavailable` | `failed`. Never throws. Never claims the document was printed, so a cancelled
  dialog is never reported as success.
- `src/components/print-center/print-center-page.tsx`: button calls `handlePrintClick`; error
  toast on `unavailable`/`failed`, and an informational Arabic note on `dispatched` telling the
  user to use `Ctrl/Cmd + P` if no dialog appears.
- `src/lib/print-center/index.ts`: re-export.
- `scripts/print-proof/entry.tsx`: fixture click target (`data-testid="print-proof-print-button"`)
  using the same handler, for browser dispatch proof.
- `tests/print-button-dispatch.test.ts` (new): dispatch count, receiver, missing/throwing paths,
  no-fake-success wording, wiring assertions, evidence-JSON assertions.

## Downloadable PDF option (not implemented — needs your decision)

If a reliably printable artefact is required without a host print dialog, the verified options are:

1. **Keep `window.print()` + guidance (current).** Zero architecture change; Chromium's own engine
   produces correct Arabic RTL vector output with the working `@page` counters. Depends on the
   user's browser exposing a dialog.
2. **Server-side render to PDF.** Would require a headless browser in the server runtime; the
   deployment target is a Worker runtime where Puppeteer/Chromium is not available. Would mean an
   external rendering service — new data egress and secrets. Not recommended without your approval.
3. **Client-side jsPDF/html2canvas.** Rejected on quality grounds: rasterised Arabic text, clipping
   and lost page-break/counter fidelity. Explicitly not rushed in.

No option beyond (1) was implemented in this stage.

## Gates

| Gate | Command | Result |
|---|---|---|
| Format | `bunx prettier --write` (changed files only) | PASS |
| Tests | `bun test` | PASS — 172 tests, 547 checks |
| Typecheck | `bunx tsgo --noEmit` | PASS |
| Lint | focused `eslint` on changed files | PASS |
| Harness | `bun run test:harness` | PASS |
| Build | `bun run build` | PASS |
| Browser dispatch proof | `scripts/print-proof/check-print-button.py` | PASS (headless only) |
| Headed print dialog | n/a — no display in this environment | BLOCKED (environment) |
| Root inspection of exported file bytes | root action | OPEN |

Not deployed. Awaiting root review.
