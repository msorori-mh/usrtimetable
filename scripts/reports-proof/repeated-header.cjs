/* Synthetic fixtures only. Verify the physical PDFs, not only the DOM. */
const { chromium } = require(`${process.env.REPORT_QA_MODULES}/@playwright/test`);
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
(async () => {
  fs.mkdirSync("repeated-header-proof", { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    for (const mode of ["report", "summary", "sheet"]) {
      for (const [paper, orientation, width] of [
        ["A4", "portrait", 390],
        ["A4", "landscape", 1440],
        ["A3", "landscape", 1440],
      ]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(
          `http://127.0.0.1:4173/repeated-header.html?mode=${mode}&paper=${paper}&orientation=${orientation}`,
        );
        await page.getByText("ROW139", { exact: true }).waitFor();
        await page.evaluate(() => document.fonts.ready);
        await page.waitForFunction(() =>
          [...document.images].every((image) => image.complete && image.naturalWidth > 0),
        );
        await page.emulateMedia({ media: "print" });
        await page.pdf({
          path: `repeated-header-proof/${mode}-${paper}-${orientation}.pdf`,
          preferCSSPageSize: true,
          printBackground: true,
        });
        await page.emulateMedia({ media: "screen" });
      }
    }
    if (errors.length) throw Error(JSON.stringify(errors));
    execFileSync("python", ["scripts/reports-proof/verify-repeated-header.py"], {
      stdio: "inherit",
    });
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
