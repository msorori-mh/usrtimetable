import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ARTIFACTS = path.join(ROOT, "staging-e2e-artifacts");

function required(name) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const baseUrl = new URL(required("STAGING_BASE_URL"));
if (baseUrl.protocol !== "https:") throw new Error("STAGING_BASE_URL must use HTTPS");
if (["gomufadhala.com", "www.gomufadhala.com"].includes(baseUrl.hostname))
  throw new Error("Refusing to run staging smoke tests against the production hostname");

const modules = required("STAGING_E2E_MODULES");
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(modules, "@playwright/test"));
const email = required("STAGING_ADMIN_EMAIL");
const password = required("STAGING_ADMIN_PASSWORD");
const visited = [];
const pageErrors = [];

mkdirSync(ARTIFACTS, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ locale: "ar-SA" });
const page = await context.newPage();
page.on("pageerror", (error) => pageErrors.push(error.message));

async function open(route, expectedText) {
  const response = await page.goto(new URL(route, baseUrl).href, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  if (!response || response.status() >= 500)
    throw new Error(`${route} returned ${response?.status() ?? "no response"}`);
  if (new URL(page.url()).hostname !== baseUrl.hostname)
    throw new Error(`${route} redirected outside the staging hostname`);
  await page.getByText(expectedText, { exact: false }).first().waitFor({ timeout: 20_000 });
  visited.push(route);
}

try {
  await open("/", "منصة إدارة الجداول الجامعية");
  await open("/auth", "تسجيل الدخول");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await page.waitForTimeout(1_000);
  if (await page.locator('[data-testid="auth-mfa-step"]').isVisible())
    throw new Error("The staging smoke account requires MFA; use an isolated automation account");
  await page.waitForURL(/\/dashboard(?:[/?#]|$)/, { timeout: 30_000 });

  await open("/schedule-builder", "بناء الجدول");
  await page.getByRole("button", { name: "جدول الطلاب" }).waitFor();
  await page.getByRole("button", { name: "جدول المحاضر" }).waitFor();
  await page.getByRole("button", { name: "جدول المحاضر" }).click();
  await page.getByText("الإتاحة والطلبات والارتباطات", { exact: false }).first().waitFor();

  await open("/availability", "إتاحة الموارد وطلبات المحاضرين");
  await page.getByRole("tab", { name: "إتاحة المحاضرين" }).waitFor();
  await open("/constraint-settings", "سياسات الجدولة والجودة");
  await open("/scheduling-settings", "إعدادات الجدولة");

  if (pageErrors.length) throw new Error(`Browser page errors: ${pageErrors.join(" | ")}`);
  console.log(JSON.stringify({ decision: "PASS", mode: "read-only", visited }));
} catch (error) {
  await page.screenshot({ path: path.join(ARTIFACTS, "failure.png"), fullPage: true });
  throw error;
} finally {
  await browser.close();
}
