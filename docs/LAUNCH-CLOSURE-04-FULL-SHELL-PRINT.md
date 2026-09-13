# LAUNCH-CLOSURE-04 — full-shell print/export closure

Baseline: `1210f22bd69548fb1d75630514bc51bdf5a97fe2` (clean working tree at start).
Scope: source + local runtime proof only. No database change, no SQL, no credentials, no
external PDF service, no deployment by the agent, no modification of any user-supplied file.

## 1. Actual user artifacts (recorded, not modified)

| Artifact | SHA-256                                                            | Root finding                                                                                                                                                                                                                                                                              |
| -------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CSV      | `24af512cbdb2f0f3119c92a38dd414fb0584cd44bce5fee85dd895a4878cb625` | exact equality, 8 columns / 2 rows — export data **PASS**                                                                                                                                                                                                                                 |
| XLSX     | `d54657db434abcb1a8ce2ad5324e20866878ee3fd5959bc2ccc0ae3add58a8e9` | same 2 rows (practical Sunday 08–10, theory Monday 08–10, `TEST-E2E-C101`) matching published version `5b838e0c-5cad-4822-a8bb-73d9641bbcd9` — **PASS**                                                                                                                                   |
| PDF      | `65f6820d85e8218e05f244a91293328d68695a9190ddf53d8c07f4786ffc54a7` | Microsoft Print To PDF, A4 portrait 595.32×841.92, `/Rotate 0`, content drawn sideways; mobile app header/logo/menu + college badge printed instead of only the official sheet header; QR partially clipped on the outer edge; right edge of the heading clipped; footer `1 of 1` visible |

The uploaded PDF was **not** rotated, re-saved or altered. Sideways drawing is **not**
asserted to be an application defect: it is consistent with a Microsoft Print To PDF
driver / page-setup mismatch and needs separate native validation on the user's machine.

## 2. Root cause of the chrome + clipping defects (source finding confirmed)

`src/styles.css` `@media print` hid only `aside`, `.report-no-print` and the toaster.

1. The mobile app header (`AppLayout`, `md:hidden`) and the page context bar
   (breadcrumb + college badge) are **not** inside `<aside>`, so both printed above the
   official `PrintSheet` header.
2. The shell is a flex row (`min-h-screen`, `flex-1` `<main>`). Nothing released those
   constraints for paged media, so the sheet was laid out at the **screen viewport
   width**. On a narrow (mobile) viewport that pushed the QR code past the printable box
   (clipped on the outer edge) and cut the right edge of the heading.

The previous proof mounted `PrintSheet` standalone, so it could not observe either defect.

## 3. Source diff (narrow, print-only + tagging)

`src/components/app-layout.tsx` — attributes only, zero screen-behaviour change:

- root wrapper: `data-app-shell="root"`
- mobile header: `data-app-chrome="mobile-header"` (still `md:hidden`)
- page context bar: `data-app-chrome="context-bar"` (keeps `data-testid="page-context-bar"`)

`src/styles.css` (inside the existing `@media print` block only):

- `[data-app-chrome]` added to the hide list next to `aside` / `.report-no-print` / toaster
- `html, body` and `[data-app-shell="root"]`: width/height/min-height/overflow/margin released
- `main`: `display:block`, `flex:none`, width/max-width/height released, padding and margin zeroed
- `.report-print-root`, `.print-center-body`: width/max-width/overflow released
- `.print-center-header`: identification block may shrink (`min-width:0`, `flex:1 1 auto`);
  QR/logo keep intrinsic size (`flex:0 0 auto`, `max-width:100%`) so they stay inside the box

Data filtering, role/scoping logic, the official header, export helpers and the screen UI
are untouched. No component was rewritten.

## 4. Full-shell runtime proof (new)

Fixture mounts the **REAL** `AppLayout` (real wrappers, real mobile header, real context
bar) around the **REAL** `PrintSheet` with the **REAL** print stylesheet and `@page` rule.
Only auth, data and navigation are inert stand-ins — no backend, no production data.

- `scripts/print-proof/shell.html`, `scripts/print-proof/shell-entry.tsx`
- `scripts/print-proof/mocks/{supabase-client.ts,use-current-user.ts,use-colleges.ts,react-router.tsx}`
- `scripts/print-proof/vite.config.mts` — second entry + fixture aliases
- `scripts/print-proof/run-shell.py` — Playwright/Chromium runner
- artifacts: `docs/print-proof/full-shell/` (PDFs, per-page PNGs, `RESULTS.json`)

Matrix: A4 + A3 × portrait + landscape × desktop (1280) **and** mobile (390) starting
viewport × long fixture and the 2-row short fixture = 16 rendered PDFs.

Per case, asserted on the produced PDF and on the print-media DOM:

- the real shell **is** mounted on screen (sidebar, mobile header, context bar all present)
- nothing tagged `[data-app-chrome]`, `aside`, `.report-no-print` or the toaster is printed;
  the platform name and nav strings are absent from the extracted PDF text
- the official `PrintSheet` header **is** printed (university name, export date)
- QR, logo, heading and footer all lie inside the sheet box, measured both at the browser
  viewport and again at the true printable content width for that paper/orientation
- no horizontal overflow of the sheet or of any cell at the printable width
- all 8 columns in every sheet and in the PDF text (Arabic compared undiacritised, because
  `pdftotext` drops Arabic diacritics)
- the short fixture prints exactly its 2 rows (practical Sunday + theory Monday)
- CSS `@page` size/orientation honoured; physical `صفحة X من Y` counters correct and
  strictly sequential; no blank pages; no ink touching the page edge (raster clipping check)

Result: **241 checks, 241 pass, 0 fail** (`docs/print-proof/full-shell/RESULTS.json`).
The earlier standalone proof still passes unchanged: **79/79**.

Visual inspection of the rendered pages (mobile A4 portrait short, desktop A3 landscape
long): official header only, QR fully inside the top outer corner, heading complete on both
edges, table borders and footer intact, physical counter at the bottom of every page.

## 5. Gates

| Gate                                                             | Result                                                                                                                                                                  |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full-shell print proof (16 PDFs, both viewports)                 | PASS 241/241                                                                                                                                                            |
| Standalone print/export proof (regression)                       | PASS 79/79                                                                                                                                                              |
| Export data equality vs published version (root, user artifacts) | PASS                                                                                                                                                                    |
| `bun test`                                                       | see run log in this stage                                                                                                                                               |
| typecheck / lint / build                                         | PASS                                                                                                                                                                    |
| **Actual user PDF (Microsoft Print To PDF)**                     | **HOLD** — sideways drawing and the clipping seen in that specific file require a fresh native print after this fix, on the user's machine/driver. Not claimed as PASS. |
| Deployment                                                       | not performed by the agent — root reviews, then publishes                                                                                                               |

## 6. Residual risks

1. The sideways rendering in the uploaded PDF cannot be reproduced headlessly; it is most
   likely driver/page-setup (paper size + orientation in the native print dialog). Needs a
   native re-print to confirm, ideally with the paper/orientation selector in the print
   centre matched to the dialog.
2. Headless Chromium print output is evidence for layout, not for the native print dialog
   behaviour of a specific OS/driver.
3. The fixture stubs auth/data/navigation; role-scoped filtering itself is covered by the
   existing print-centre unit tests, not by this shell proof.
