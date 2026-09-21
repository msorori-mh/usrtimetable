#!/usr/bin/env python3
"""
LAUNCH-CLOSURE-04 FULL-SHELL print proof runner.

The LAUNCH-CLOSURE-03 runner mounted `PrintSheet` on its own, so it could not see the
defects a real print exposed: the mobile AppLayout header / brand mark / college badge
printed over the official sheet header, and the viewport-sized flex shell clipped the QR
code and the right edge of the heading. This runner verifies the platform-wide A4
portrait page box at desktop and mobile starting viewports.

This runner loads `shell.html` — the REAL `AppLayout` wrapping the REAL `PrintSheet` with
the REAL print stylesheet — and, for A4 portrait x desktop/mobile starting
viewport x long/short fixture, asserts on the produced PDF and the print-media DOM:

  * no app chrome is printed (mobile header, sidebar, context bar/college badge, toaster)
  * the official PrintSheet header IS printed
  * QR code, heading and footer stay inside the page box (no clipping)
  * all 8 columns and every fixture row survive
  * physical page counters are sequential and correct; no blank pages

No database, no auth, no production data, no user file is modified.
Artifacts land in docs/print-proof/full-shell/.
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
OUT = ROOT / "docs" / "print-proof" / "full-shell"
PORT = 8793

PLATFORM_NAME = "منصة إدارة الجداول الجامعية"
COLUMN_LABELS = [
    "اليوم",
    "الوقت",
    "رمز المقرر",
    "اسم المقرر",
    "المحاضرة",
    "المدرس",
    "القاعة",
    "المجموعة",
]

results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'} — {name}{(' :: ' + detail) if detail else ''}", flush=True)


def strip_format_chars(text: str) -> str:
    return re.sub(r"[\u200e\u200f\u202a-\u202e\u2066-\u2069]", "", text)


def normalize_ar(text: str) -> str:
    """pdftotext drops/repositions Arabic diacritics (e.g. the legacy shadda in Arabic labels),
    so label assertions compare undiacritised text."""
    return re.sub(r"[\u064b-\u0652\u0670]", "", strip_format_chars(text))


# Printable content width in CSS px for A4 portrait, given the @page
# margin of 1.2cm x 1.5cm. The DOM must be measured at this width: a 390px mobile
# viewport lays the table out at 390px even under print emulation, which reports
# overflow that the real paged output does not have.
MM_PER_IN = 25.4
PAPER_MM = {"A4": (210.0, 297.0)}


def content_px(paper: str, orientation: str) -> int:
    w_mm, h_mm = PAPER_MM[paper]
    return int(round((w_mm - 2 * 15.0) / MM_PER_IN * 96))


def serve():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(DIST))
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", PORT), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def pdftotext(pdf, first=None, last=None, layout=True):
    cmd = ["pdftotext"]
    if layout:
        cmd.append("-layout")
    if first:
        cmd += ["-f", str(first), "-l", str(last or first)]
    cmd += [str(pdf), "-"]
    return strip_format_chars(subprocess.run(cmd, capture_output=True, text=True).stdout)


def clipping_report(pngs):
    """Flag a page whose ink reaches the outer frame — i.e. content cut at the edge."""
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


DOM_PROBE = """() => {
  const chrome = [];
  const sel = 'aside, [data-app-chrome], [data-sonner-toaster], .report-no-print';
  for (const el of document.querySelectorAll(sel)) {
    const cs = getComputedStyle(el);
    if (cs.display !== 'none') {
      chrome.push((el.tagName + (el.dataset.appChrome ? '[' + el.dataset.appChrome + ']' : '')));
    }
  }
  const sheets = [...document.querySelectorAll('.print-center-page')];
  const overflow = [];
  const outside = [];
  const headerDetails = [];
  for (const sheet of sheets) {
    if (sheet.scrollWidth > sheet.clientWidth + 1) {
      overflow.push('sheet ' + sheet.scrollWidth + '>' + sheet.clientWidth);
    }
    const box = sheet.getBoundingClientRect();
    const parts = {
      qr: sheet.querySelector('[aria-label="رابط الطباعة"]'),
      heading: sheet.querySelector('.print-center-header h2'),
      footer: sheet.querySelector('.print-center-footer'),
      logo: sheet.querySelector('.print-center-header img'),
    };
    for (const [key, el] of Object.entries(parts)) {
      if (!el) { outside.push(key + ':missing'); continue; }
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) { outside.push(key + ':zero-size'); continue; }
      if (r.left < box.left - 1 || r.right > box.right + 1) {
        outside.push(key + ':' + Math.round(r.left) + '..' + Math.round(r.right)
          + ' vs ' + Math.round(box.left) + '..' + Math.round(box.right));
      }
    }
    for (const cell of sheet.querySelectorAll('td, th')) {
      if (cell.scrollWidth > cell.clientWidth + 1) overflow.push('cell:' + cell.textContent.slice(0, 18));
    }
    const header = sheet.querySelector('.print-center-header');
    const identity = sheet.querySelector('.print-header-identity-band');
    const details = [...sheet.querySelectorAll('.print-header-field')];
    const meta = [...sheet.querySelectorAll('.print-header-meta > span')];
    headerDetails.push({
      compact: header?.dataset.printHeader === 'compact',
      identityDisplay: identity ? getComputedStyle(identity).display : null,
      fieldCount: details.length,
      metaCount: meta.length,
      headerHeight: header ? Math.round(header.getBoundingClientRect().height) : 0,
      hasTimetableTitle: sheet.querySelector('.print-header-title-block h2')?.textContent.trim() === 'الجدول الدراسي',
      hasGroupTitle: !!sheet.querySelector('.print-center-context-row'),
    });
  }
  const headerVisible = sheets.every((s) => {
    const h = s.querySelector('.print-center-header');
    return h && getComputedStyle(h).display !== 'none';
  });
  const columns = [...document.querySelectorAll('.print-center-page thead tr')]
    .filter((tr) => !tr.classList.contains('print-center-context-row'))
    .map((tr) => [...tr.children].map((th) => th.textContent.trim()));
  const rows = [...document.querySelectorAll('.print-center-page tbody tr')]
    .map((tr) => tr.innerText.replace(/\\s+/g, ' ').trim());
  return { chrome, overflow, outside, headerVisible, headerDetails, columns, rows, sheets: sheets.length };
}"""


async def main():
    from playwright.async_api import async_playwright

    if not (DIST / "shell.html").exists():
        print("dist-print-proof/shell.html missing — run the fixture vite build first")
        return 1
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    httpd = serve()
    base = f"http://127.0.0.1:{PORT}/shell.html"

    viewports = [("desktop", {"width": 1280, "height": 1800}), ("mobile", {"width": 390, "height": 844})]
    combos = [("A4", "portrait")]
    cases = [(p, o, f) for p, o in combos for f in ("long", "short")]

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        console_errors = []
        for vp_name, vp in viewports:
            ctx = await browser.new_context(viewport=vp)
            page = await ctx.new_page()
            page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: console_errors.append(str(e)))

            for paper, orientation, fixture in cases:
                tag = f"{vp_name} {paper} {orientation} {fixture}"
                url = f"{base}?paper={paper}&orientation={orientation}&fixture={fixture}"
                await page.goto(url, wait_until="domcontentloaded")
                await page.wait_for_function(
                    "() => document.documentElement.dataset.printProofReady === '1'"
                )
                await page.wait_for_selector(".print-center-page tbody tr")
                await page.wait_for_selector('[aria-label="رابط الطباعة"] svg')

                # ---- app chrome must exist on screen (proving the real shell is mounted)
                on_screen = await page.evaluate(
                    """() => ({
                      mobileHeader: !!document.querySelector('[data-app-chrome="mobile-header"]'),
                      contextBar: !!document.querySelector('[data-app-chrome="context-bar"]'),
                      shell: !!document.querySelector('[data-app-shell="root"]'),
                      sidebar: !!document.querySelector('aside'),
                    })"""
                )
                check(
                    f"{tag}: real app shell is mounted (sidebar + mobile header + context bar)",
                    all(on_screen.values()),
                    json.dumps(on_screen),
                )

                # ---- print-media DOM, measured at the printable content width
                await page.emulate_media(media="print")
                dom = await page.evaluate(DOM_PROBE)
                check(f"{tag}: no app chrome printed", dom["chrome"] == [], "; ".join(dom["chrome"]) or "clean")
                check(f"{tag}: official sheet header printed", dom["headerVisible"] is True, f"{dom['sheets']} sheets")
                check(
                    f"{tag}: compact identity/title/details/meta header structure",
                    dom["headerDetails"]
                    and all(
                        h["compact"]
                        and h["identityDisplay"] == "grid"
                        and h["fieldCount"] >= 4
                        and h["metaCount"] == 3
                        and h["hasTimetableTitle"]
                        and h["hasGroupTitle"]
                        for h in dom["headerDetails"]
                    ),
                    json.dumps(dom["headerDetails"], ensure_ascii=False),
                )
                check(
                    f"{tag}: QR / logo / heading / footer inside the page box",
                    dom["outside"] == [],
                    "; ".join(dom["outside"]) or "all inside",
                )
                check(
                    f"{tag}: all 8 columns present in every sheet",
                    dom["columns"] and all(c == COLUMN_LABELS for c in dom["columns"]),
                    f"{len(dom['columns'])} header rows, first={dom['columns'][0] if dom['columns'] else None}",
                )
                if fixture == "short":
                    check(
                        f"{tag}: exactly the 2 fixture rows (practical Sunday + theory Monday)",
                        len(dom["rows"]) == 2
                        and any("الأحد" in r and "عملي" in r for r in dom["rows"])
                        and any("الاثنين" in r and "نظري" in r for r in dom["rows"]),
                        " | ".join(dom["rows"])[:160],
                    )

                page_px = content_px(paper, orientation)
                await page.set_viewport_size({"width": page_px, "height": vp["height"]})
                paged = await page.evaluate(DOM_PROBE)
                check(
                    f"{tag}: no horizontal overflow at the {page_px}px printable width",
                    paged["overflow"] == [],
                    "; ".join(paged["overflow"][:3]) or "clean",
                )
                check(
                    f"{tag}: QR / logo / heading / footer inside the page box at printable width",
                    paged["outside"] == [] and paged["chrome"] == [],
                    "; ".join(paged["outside"] + paged["chrome"]) or "all inside",
                )
                check(
                    f"{tag}: compact header stays at or below 200px at printable width",
                    paged["headerDetails"]
                    and all(0 < h["headerHeight"] <= 200 for h in paged["headerDetails"]),
                    str([h["headerHeight"] for h in paged["headerDetails"]]),
                )
                await page.set_viewport_size(vp)
                await page.emulate_media(media=None)

                # ---- real PDF
                pdf_path = OUT / f"shell-{vp_name}-{paper}-{orientation}-{fixture}.pdf"
                await page.pdf(
                    path=str(pdf_path),
                    prefer_css_page_size=True,
                    print_background=True,
                    display_header_footer=False,
                )
                info = subprocess.run(["pdfinfo", str(pdf_path)], capture_output=True, text=True).stdout
                pages = int(re.search(r"Pages:\s+(\d+)", info).group(1))
                dims = re.search(r"Page size:\s+([\d.]+) x ([\d.]+)", info)
                w, h = float(dims.group(1)), float(dims.group(2))
                check(
                    f"{tag}: CSS @page size/orientation honoured",
                    w < h,
                    f"{w:.0f}x{h:.0f}pt, {pages} pages",
                )

                txt = pdftotext(pdf_path)
                norm = normalize_ar(txt)
                check(
                    f"{tag}: app chrome text absent from the PDF",
                    normalize_ar(PLATFORM_NAME) not in norm
                    and "التنقل" not in norm
                    and normalize_ar("المسار التشغيلي") not in norm,
                    "no shell strings" if normalize_ar(PLATFORM_NAME) not in norm else "platform name leaked",
                )
                check(
                    f"{tag}: official header content present in the PDF",
                    "جامعة إقليم سبأ" in norm and "تاريخ التصدير" in norm,
                    f"{len(txt)} chars extractable",
                )
                missing = [lbl for lbl in COLUMN_LABELS if normalize_ar(lbl) not in norm]
                check(
                    f"{tag}: all 8 column headings present in the PDF",
                    missing == [],
                    ", ".join(missing) or "all present",
                )

                data_pages, empty_pages, phys = 0, 0, {}
                for i in range(1, pages + 1):
                    t = pdftotext(pdf_path, i)
                    if "FX-C" in t or "TEST-E2E-C101" in t:
                        data_pages += 1
                    elif not t.strip():
                        empty_pages += 1
                    m = re.search(r"صفحة\s*(\d+)\s*من\s*(\d+)", pdftotext(pdf_path, i, layout=False))
                    phys[i] = (int(m.group(1)), int(m.group(2))) if m else None
                check(f"{tag}: no blank printed pages", empty_pages == 0, f"{empty_pages} blank of {pages}")
                check(
                    f"{tag}: physical counters correct and sequential",
                    all(phys[i] == (i, pages) for i in range(1, pages + 1)),
                    str([phys[i] for i in (1, pages)]),
                )
                if fixture == "short":
                    rows_in_pdf = txt.count("TEST-E2E-C101") + txt.count("FX-C")
                    check(
                        f"{tag}: both fixture rows land in the PDF",
                        rows_in_pdf >= 2 and pages == 1,
                        f"{rows_in_pdf} row markers on {pages} page(s)",
                    )

                prefix = OUT / f"png-{vp_name}-{paper}-{orientation}-{fixture}"
                subprocess.run(
                    ["pdftoppm", "-png", "-r", "110", str(pdf_path), str(prefix)],
                    check=True,
                    capture_output=True,
                )
                pngs = sorted(OUT.glob(f"png-{vp_name}-{paper}-{orientation}-{fixture}-*.png"))
                clipped = clipping_report(pngs)
                check(
                    f"{tag}: no ink touching the page edge (clipping check)",
                    len(pngs) == pages and clipped == [],
                    "; ".join(clipped) if clipped else f"{len(pngs)} pages keep a clear margin",
                )

            await ctx.close()

        check("no console or page errors during the whole run", console_errors == [], "; ".join(console_errors[:3]))
        await browser.close()

    httpd.shutdown()
    failed = [n for n, ok, _ in results if not ok]
    (OUT / "RESULTS.json").write_text(
        json.dumps(
            {
                "harness": "LAUNCH-CLOSURE-04 full-shell print proof",
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
    print(f"\nFULL_SHELL_PRINT_PROOF: {len(results) - len(failed)} passed, {len(failed)} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    os.chdir(ROOT)
    sys.exit(asyncio.run(main()))
