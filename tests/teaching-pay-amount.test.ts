import { test, expect } from "bun:test";
import { payAmountCents } from "../src/lib/reports/teaching-pay.ts";

/** Reference: Postgres numeric round(h*r, 2), half away from zero, via BigInt on decimal strings. */
function refCents(hStr: string, rStr: string): number {
  const toHundredths = (s: string) => BigInt(s.replace(".", ""));
  const p = toHundredths(hStr) * toHundredths(rStr); // 1/10000
  const q = p / 100n;
  const rem = p % 100n;
  return Number(rem >= 50n ? q + 1n : q);
}

test("H-9: 0.25 x 19.90 matches Postgres (4.98)", () => {
  expect(payAmountCents(0.25, 19.9)).toBe(498);
  expect(refCents("0.25", "19.90")).toBe(498);
});

test("H-9: exhaustive grid (hours 0..40 step 0.25 x rates 0.01..50.00) has zero mismatches", () => {
  let mismatches = 0;
  for (let hq = 0; hq <= 160; hq++) {
    const hStr = (hq / 4).toFixed(2);
    const h = Number(hStr);
    for (let rc = 1; rc <= 5000; rc++) {
      const rStr = (rc / 100).toFixed(2);
      const r = Number(rStr);
      if (payAmountCents(h, r) !== refCents(hStr, rStr)) mismatches++;
    }
  }
  expect(mismatches).toBe(0);
});

test("H-9: arbitrary 2-decimal hours and large rates", () => {
  const cases: Array<[string, string]> = [
    ["1.33", "37.45"], ["999.99", "100000000.00"], ["0.01", "0.01"], ["12.35", "19.99"], ["7.77", "33.33"],
  ];
  for (const [h, r] of cases) expect(payAmountCents(Number(h), Number(r))).toBe(refCents(h, r));
});
