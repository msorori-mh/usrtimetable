/* Browser proof runs against real report components and synthetic data only. */
const { chromium, expect } = require(`${process.env.REPORT_QA_MODULES}/@playwright/test`);
const fs = require("node:fs");
(async () => {
  const out = "reports-proof-output";
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    for (let i = 0; ; i++) {
      try {
        await page.goto("http://127.0.0.1:4173/");
        break;
      } catch (e) {
        if (i >= 20) throw e;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    await page.getByRole("heading", { name: "الجدول الأسبوعي — أ. محاضر الاختبار" }).waitFor();
    await page.screenshot({ path: `${out}/desktop.png`, fullPage: true });
    await page.locator(".report-timetable-grid:visible button").first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "قائمة", exact: true }).click();
    await expect(page.locator(".report-data-table:visible .report-no-print tbody tr")).toHaveCount(
      18,
    );
    await page.getByRole("button", { name: "أسبوعي", exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${out}/mobile.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.getByRole("button", { name: "تبديل مثال الاختبار" }).click();
    await expect(page.locator(".report-data-table:visible .report-no-print tbody tr")).toHaveCount(
      25,
    );
    await page.getByRole("button", { name: "التالي", exact: true }).click();
    await expect(page.getByText("صفحة 2 من 3", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "التفاصيل", exact: true }).first().click();
    await expect(page.getByText("بطاقة العضو").first()).toBeVisible();
    await page.emulateMedia({ media: "print" });
    await expect(page.locator(".report-data-table .print\\:block tbody tr")).toHaveCount(67);
    await page.pdf({
      path: `${out}/table.pdf`,
      format: "A4",
      landscape: true,
      printBackground: true,
    });
    await page.emulateMedia({ media: "screen" });
    await page.getByRole("button", { name: "تبديل مثال الاختبار" }).click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.pdf({
      path: `${out}/timetable.pdf`,
      format: "A4",
      landscape: true,
      printBackground: true,
    });
    expect(errors).toEqual([]);
    fs.writeFileSync(
      `${out}/result.json`,
      JSON.stringify({ passed: true, printRows: 67, errors }, null, 2),
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
