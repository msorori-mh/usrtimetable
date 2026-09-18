const { chromium } = require(`${process.env.REPORT_QA_MODULES}/@playwright/test`);
const assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://127.0.0.1:4173/verification.html?mode=qr");
    await page.locator('[data-verification-url*="?ref="] svg').waitFor();
    const qr = await page.locator("[data-verification-url]").getAttribute("data-verification-url");
    assert.equal(
      qr,
      "http://127.0.0.1:4173/verify-report?ref=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
    for (const param of [
      "",
      "?ref=invalid",
      "?ref=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "?ref=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ]) {
      await page.goto("http://127.0.0.1:4173/verification.html" + param);
      await page.getByRole("heading", { name: "التحقق من التقرير", exact: true }).waitFor();
      if (param.includes("aaaaaaaa"))
        await page.getByText("VERSION_PROOF", { exact: true }).waitFor();
      else
        await page
          .getByRole("heading", { name: "لا تتوفر بيانات تحقق عامة لهذا الرابط" })
          .waitFor();
      assert.equal(await page.locator("a,nav,aside").count(), 0);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
    }
    await page.goto(
      "http://127.0.0.1:4173/verification.html?ref=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&fail=1",
    );
    await page.getByRole("button", { name: "إعادة المحاولة" }).waitFor();
    assert.deepEqual(errors, []);
    console.log(
      "PASS: QR contains only verification reference; valid/unknown/malformed/offline pages, no internal links, mobile RTL",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
