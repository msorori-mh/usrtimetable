#!/usr/bin/env python3
"""
LAUNCH-CLOSURE-03 print/export proof runner.

Serves the isolated fixture build (dist-print-proof) over http, then uses the
pre-installed Playwright Chromium to:
  1. render the REAL PrintSheet with the REAL print stylesheet,
  2. print to PDF in A4/A3 x portrait/landscape with `print_background` and CSS page size,
  3. rasterise every PDF page to PNG and check for clipping / repeated table headers,
  4. trigger the REAL downloadCSV / downloadXLSX / exportRowsToXlsx helpers and capture
     the actual downloaded bytes.

No database, no auth, no production data. Artifacts land in docs/print-proof/.
"""
import asyncio
import functools
import http.server
import json
import os
import re
import shutil
import socketserver
import subprocess
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DIST = ROOT / "dist-print-proof"
OUT = ROOT / "docs" / "print-proof"
PORT = 8791
results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'} — {name}{(' :: ' + detail) if detail else ''}", flush=True)


def serve():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(DIST))
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", PORT), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


async def main():
    from playwright.async_api import async_playwright

    if not (DIST / "index.html").exists():
        print("dist-print-proof missing — run the vite build first")
        return 1
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    httpd = serve()
    base = f"http://127.0.0.1:{PORT}/index.html"

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(
            viewport={"width": 1280, "height": 1800}, accept_downloads=True
        )
        page = await ctx.new_page()
        console_errors = []
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: console_errors.append(str(e)))

        # ---- 1. PDF rendering across paper sizes and orientations (long Arabic fixture)
        combos = [("A4", "portrait"), ("A4", "landscape"), ("A3", "portrait"), ("A3", "landscape")]
        for paper, orientation in combos:
            url = f"{base}?paper={paper}&orientation={orientation}&fixture=long"
            await page.goto(url, wait_until="domcontentloaded")
            await page.wait_for_function("() => document.documentElement.dataset.printProofReady === '1'")
            await page.wait_for_selector(".print-center-page table tbody tr")
            info = await page.evaluate("() => window.__printProof")
            pdf_path = OUT / f"timetable-{paper}-{orientation}.pdf"
            await page.pdf(
                path=str(pdf_path),
                prefer_css_page_size=True,
                print_background=True,
                display_header_footer=False,
            )
            size = pdf_path.stat().st_size
            check(f"PDF rendered {paper} {orientation} (fixture)", size > 20000, f"{size} bytes")

            # page count + geometry from pdfinfo
            out = subprocess.run(
                ["pdfinfo", str(pdf_path)], capture_output=True, text=True
            ).stdout
            pages = int(re.search(r"Pages:\s+(\d+)", out).group(1))
            dims = re.search(r"Page size:\s+([\d.]+) x ([\d.]+)", out)
            w, h = float(dims.group(1)), float(dims.group(2))
            landscape = w > h
            expected_landscape = orientation == "landscape"
            check(
                f"{paper} {orientation}: CSS @page size honoured",
                landscape == expected_landscape,
                f"{w:.0f}x{h:.0f}pt, {pages} pages",
            )
            check(f"{paper} {orientation}: fixture spans multiple pages", pages > 1, f"{pages} pages")

            # Arabic text is really in the PDF (not tofu/missing glyphs)
            txt = subprocess.run(
                ["pdftotext", "-layout", str(pdf_path), "-"], capture_output=True, text=True
            ).stdout
            check(
                f"{paper} {orientation}: Arabic content extractable",
                "المستوى" in txt and "الأحد" in txt,
                f"{len(txt)} chars",
            )
            # repeated table header on every page: "اليوم" header cell per page
            per_page_headers = 0
            for i in range(1, pages + 1):
                t = subprocess.run(
                    ["pdftotext", "-f", str(i), "-l", str(i), "-layout", str(pdf_path), "-"],
                    capture_output=True,
                    text=True,
                ).stdout
                if "اليوم" in t and "الوقت" in t:
                    per_page_headers += 1
            check(
                f"{paper} {orientation}: table header repeats on every page",
                per_page_headers == pages,
                f"{per_page_headers}/{pages} pages carry the header row",
            )

            # rasterise for visual inspection + clipping heuristic
            prefix = OUT / f"page-{paper}-{orientation}"
            subprocess.run(
                ["pdftoppm", "-png", "-r", "110", str(pdf_path), str(prefix)],
                check=True,
                capture_output=True,
            )
            pngs = sorted(OUT.glob(f"page-{paper}-{orientation}-*.png"))
            check(f"{paper} {orientation}: PNG page images produced", len(pngs) == pages, f"{len(pngs)} images")
            clipped = clipping_report(pngs)
            check(
                f"{paper} {orientation}: no ink touching the page edge (clipping check)",
                clipped == [],
                "; ".join(clipped) if clipped else "all pages keep a clear margin",
            )

            # nothing overflows its printed box horizontally in the live DOM
            overflow = await page.evaluate(
                """() => {
                  const bad = [];
                  for (const el of document.querySelectorAll('.print-center-page')) {
                    if (el.scrollWidth > el.clientWidth + 1) bad.push('page ' + el.scrollWidth + '>' + el.clientWidth);
                    for (const cell of el.querySelectorAll('td, th')) {
                      if (cell.scrollWidth > cell.clientWidth + 1) bad.push('cell:' + cell.textContent.slice(0, 20));
                    }
                  }
                  return bad;
                }"""
            )
            check(
                f"{paper} {orientation}: no horizontal overflow in cells or sheet",
                overflow == [],
                f"{len(overflow)} overflowing nodes" if overflow else "clean",
            )
            if (paper, orientation) == combos[0]:
                check(
                    "fixture pipeline: real filter/group/export produced pages and rows",
                    info["pageCount"] >= 4 and info["rowCount"] == info["sessionCount"],
                    f"sessions={info['sessionCount']} pages={info['pageCount']} rows={info['rowCount']}",
                )

        # ---- 2. Short fixture = the shape of the published TEST-SIMP-03 schedule
        await page.goto(f"{base}?paper=A4&orientation=portrait&fixture=short", wait_until="domcontentloaded")
        await page.wait_for_function("() => document.documentElement.dataset.printProofReady === '1'")
        rows_text = await page.eval_on_selector_all(
            ".print-center-page tbody tr", "els => els.map(e => e.innerText.replace(/\\s+/g, ' '))"
        )
        check(
            "short fixture prints exactly 2 rows (practical Sunday + theory Monday)",
            len(rows_text) == 2
            and any("الأحد" in r and "عملي" in r for r in rows_text)
            and any("الإثنين" in r and "نظري" in r for r in rows_text),
            " | ".join(rows_text),
        )
        short_pdf = OUT / "timetable-short-A4-portrait.pdf"
        await page.pdf(path=str(short_pdf), prefer_css_page_size=True, print_background=True)
        subprocess.run(
            ["pdftoppm", "-png", "-r", "110", str(short_pdf), str(OUT / "page-short-A4-portrait")],
            check=True,
            capture_output=True,
        )
        check("short fixture PDF produced", short_pdf.stat().st_size > 10000, f"{short_pdf.stat().st_size} bytes")

        # ---- 3. Real CSV / XLSX downloads through the existing helpers
        for fn, expected_ext, label in [
            ("exportCsv", ".csv", "downloadCSV (reports/export.ts)"),
            ("exportXlsx", ".xlsx", "downloadXLSX (reports/export.ts)"),
            ("exportAdminXlsx", ".xlsx", "exportRowsToXlsx (admin-export/to-xlsx.ts)"),
        ]:
            async with page.expect_download(timeout=20000) as dl_info:
                await page.evaluate(f"() => window.__printProof.{fn}()")
            dl = await dl_info.value
            target = OUT / (dl.suggested_filename)
            await dl.save_as(str(target))
            size = target.stat().st_size
            check(
                f"{label}: download event fired and file materialised",
                target.exists() and size > 200 and target.suffix == expected_ext,
                f"{dl.suggested_filename} ({size} bytes)",
            )

        csv_file = next(OUT.glob("*.csv"))
        raw = csv_file.read_bytes()
        text = raw.decode("utf-8-sig")
        lines = text.strip().split("\n")
        check("CSV starts with a UTF-8 BOM (Excel opens Arabic correctly)", raw[:3] == b"\xef\xbb\xbf")
        check("CSV header is the real Arabic header row", lines[0].startswith("اليوم,الوقت"), lines[0])
        check("CSV body row count matches the exported rows", len(lines) - 1 == 120, f"{len(lines) - 1} rows")
        check("CSV contains long Arabic course names intact", "أساسيات هندسة البرمجيات" in text)

        for xlsx_file in sorted(OUT.glob("*.xlsx")):
            probe = subprocess.run(
                [
                    "bun",
                    "-e",
                    "const X=require('xlsx');const wb=X.readFile(process.argv[1]);"
                    "const ws=wb.Sheets[wb.SheetNames[0]];"
                    "const rows=X.utils.sheet_to_json(ws,{header:1});"
                    "console.log(JSON.stringify({sheet:wb.SheetNames[0],rows:rows.length,"
                    "first:rows[0],sample:rows[1],rtl:!!(ws['!views']&&ws['!views'][0]&&ws['!views'][0].RTL)}));",
                    str(xlsx_file),
                ],
                capture_output=True,
                text=True,
                cwd=str(ROOT),
            )
            payload = json.loads(probe.stdout.strip().splitlines()[-1])
            check(
                f"XLSX {xlsx_file.name}: parses, has a sheet and 120 data rows",
                payload["rows"] == 121,
                f"sheet={payload['sheet']} rows={payload['rows']} header={payload['first'][:3]}",
            )
            check(
                f"XLSX {xlsx_file.name}: Arabic content preserved",
                any("ا" in str(c) for c in payload["sample"]),
                str(payload["sample"])[:120],
            )

        check("no console or page errors during the whole run", console_errors == [], "; ".join(console_errors[:3]))
        await browser.close()

    httpd.shutdown()
    failed = [n for n, ok, _ in results if not ok]
    summary = OUT / "RESULTS.json"
    summary.write_text(
        json.dumps(
            {
                "total": len(results),
                "passed": len(results) - len(failed),
                "failed": failed,
                "cases": [{"name": n, "pass": ok, "detail": d} for n, ok, d in results],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\nPRINT_PROOF: {len(results) - len(failed)} passed, {len(failed)} failed")
    print(f"artifacts: {OUT.relative_to(ROOT)}")
    return 1 if failed else 0


def clipping_report(pngs):
    """Flag a page whose ink reaches the outer 6px frame — i.e. content cut at the edge."""
    from PIL import Image

    bad = []
    for png in pngs:
        im = Image.open(png).convert("L")
        w, h = im.size
        px = im.load()
        margin = 6
        hit = False
        for x in range(w):
            for y in list(range(margin)) + list(range(h - margin, h)):
                if px[x, y] < 200:
                    hit = True
                    break
            if hit:
                break
        if not hit:
            for y in range(h):
                for x in list(range(margin)) + list(range(w - margin, w)):
                    if px[x, y] < 200:
                        hit = True
                        break
                if hit:
                    break
        if hit:
            bad.append(png.name)
    return bad


if __name__ == "__main__":
    os.chdir(ROOT)
    sys.exit(asyncio.run(main()))
