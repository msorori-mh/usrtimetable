/**
 * Print button dispatch regression coverage (bounded print-button diagnosis).
 *
 * Proves: the button dispatches window.print() exactly once, reports "dispatched"
 * (never "printed"), reports an actionable Arabic message when print is missing or
 * throws, and that the application/fixture wire the shared handler rather than an
 * unobservable inline call.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import {
  PRINT_REQUEST_DISPATCHED_AR,
  PRINT_REQUEST_FAILED_AR,
  PRINT_REQUEST_UNAVAILABLE_AR,
  requestPrint,
} from "../src/lib/print-center/print-action.ts";

const root = resolve(import.meta.dirname, "..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

describe("print request dispatch", () => {
  it("calls window.print exactly once and reports dispatched", () => {
    let calls = 0;
    const win = {
      print() {
        calls += 1;
      },
    };
    const result = requestPrint(win);
    assert.equal(calls, 1);
    assert.deepEqual(result, { status: "dispatched" });
  });

  it("calls print with the window as receiver", () => {
    let receiver: unknown = null;
    const win = {
      print(this: unknown) {
        receiver = this;
      },
    };
    requestPrint(win);
    assert.equal(receiver, win);
  });

  it("reports unavailable (not success) when print is missing", () => {
    for (const win of [null, undefined, {}, { print: undefined }, { print: 42 }] as const) {
      const result = requestPrint(win as never);
      assert.equal(result.status, "unavailable");
      assert.equal((result as { message: string }).message, PRINT_REQUEST_UNAVAILABLE_AR);
    }
  });

  it("reports failed with the original error when print throws, and never throws itself", () => {
    const boom = new Error("blocked by host");
    const result = requestPrint({
      print() {
        throw boom;
      },
    });
    assert.equal(result.status, "failed");
    assert.equal((result as { message: string }).message, PRINT_REQUEST_FAILED_AR);
    assert.equal((result as { error: unknown }).error, boom);
  });

  it("never claims the document was printed (dialog outcome is unobservable)", () => {
    const result = requestPrint({ print() {} });
    assert.equal(result.status, "dispatched");
    for (const text of [
      PRINT_REQUEST_DISPATCHED_AR,
      PRINT_REQUEST_UNAVAILABLE_AR,
      PRINT_REQUEST_FAILED_AR,
    ]) {
      assert.ok(!/تمت الطباعة|طُبع/.test(text), `status text must not claim printing: ${text}`);
    }
    assert.match(PRINT_REQUEST_DISPATCHED_AR, /Ctrl\/Cmd \+ P/);
  });
});

describe("print button wiring", () => {
  const page = read("src/components/print-center/print-center-page.tsx");

  it("print centre button uses the shared handler, not an unobservable inline call", () => {
    assert.ok(page.includes("onClick={handlePrintClick}"), "button wired to shared handler");
    assert.ok(!page.includes("onClick={() => window.print()}"), "no bare inline window.print");
    assert.ok(page.includes("requestPrint("), "handler delegates to requestPrint");
    assert.ok(page.includes("toast.error(result.message)"), "failures surface an Arabic status");
  });

  it("still keeps window.print as the only print mechanism", () => {
    const action = read("src/lib/print-center/print-action.ts");
    assert.ok(action.includes(".print"), "requestPrint uses window.print");
    assert.ok(!/html2canvas|jspdf|fetch\(/.test(action), "no external renderer or service");
  });

  it("fixture exposes a real click target for browser dispatch proof", () => {
    const entry = read("scripts/print-proof/entry.tsx");
    assert.ok(entry.includes('data-testid="print-proof-print-button"'));
    assert.ok(entry.includes("requestPrint(window)"));
  });

  it("browser diagnosis evidence records a single dispatch per click", () => {
    const evidence = JSON.parse(read("docs/print-proof/PRINT-BUTTON-DIAGNOSIS.json")) as Record<
      string,
      {
        calls_from_click?: number;
        click_result?: { status?: string };
        throwing?: { status?: string };
      }
    >;
    const headless = evidence["headless=True"];
    assert.ok(headless, "headless run recorded");
    assert.equal(headless.calls_from_click, 1);
    assert.equal(headless.click_result?.status, "dispatched");
    assert.equal(headless.throwing?.status, "failed");
  });
});
