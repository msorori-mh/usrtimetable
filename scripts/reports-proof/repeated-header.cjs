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
    for (const mode of ["report", "summary", "sheet", "readable", "instructor", "student"]) {
      for (const [paper, orientation, width] of [
        ["default", "portrait", 1440],
        ["A4", "portrait", 390],
        ["A4", "landscape", 1440],
        ["A3", "landscape", 1440],
      ]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(
          `http://127.0.0.1:4173/repeated-header.html?mode=${mode}${paper === "default" ? "" : `&paper=${paper}&orientation=${orientation}`}`,
        );
        await page
          .getByText(mode === "instructor" ? "ROW017" : "ROW139", {
            exact: mode !== "readable",
          })
          .first()
          .waitFor({ state: "attached" });
        if (mode === "student" || mode === "sheet" || mode === "readable") {
          const labels = await page
            .locator("thead tr")
            .evaluateAll((rows) =>
              rows.map((row) => [...row.querySelectorAll("th")].map((cell) => cell.textContent)),
            );
          if (
            !labels.some(
              (row) =>
                JSON.stringify(row.slice(0, 5)) ===
                JSON.stringify(["اليوم", "الزمن", "المقرر", "اسم المحاضر", "القاعة"]),
            )
          )
            throw Error("Student column order is incorrect");
        }
        await page.evaluate(() => document.fonts.ready);
        await page.waitForFunction(() =>
          [...document.images].every((image) => image.complete && image.naturalWidth > 0),
        );
        await page.emulateMedia({ media: "print" });
        if (mode === "readable") {
          const fontSize = await page
            .locator(".readable-schedule-table tbody td")
            .first()
            .evaluate((cell) => parseFloat(getComputedStyle(cell).fontSize));
          if (fontSize < 14.6) throw Error("Schedule text must be at least 11pt");
          if ((await page.getByText("CYB-L3-2024", { exact: true }).count()) !== 1)
            throw Error("Shared cohort must occur once in the repeating header, not per data row");
        }
        console.log(
          JSON.stringify({
            mode,
            paper,
            orientation,
            headers: await page.locator("thead").evaluateAll((nodes) =>
              nodes.map((node) => ({
                height: node.getBoundingClientRect().height,
                breakInside: getComputedStyle(node).breakInside,
              })),
            ),
          }),
        );
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
