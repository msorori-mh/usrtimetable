import { afterEach, expect, test } from "bun:test";
import { reportAppError } from "../src/lib/error-reporting";

const g = globalThis as unknown as { window?: unknown };
const originalError = console.error;

afterEach(() => {
  delete g.window;
  console.error = originalError;
});

function fakeWindow(reporter?: unknown) {
  g.window = { location: { pathname: "/timetable/abc" }, __appErrorReporter: reporter };
}

test("logs with the route and forwards to the optional hook", () => {
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => void logged.push(args);
  const calls: unknown[][] = [];
  fakeWindow((...args: unknown[]) => void calls.push(args));
  const err = new Error("boom");
  reportAppError(err, { boundary: "root" });
  expect(logged.length).toBe(1);
  expect(logged[0][1]).toEqual({
    source: "react_error_boundary",
    route: "/timetable/abc",
    boundary: "root",
  });
  expect(calls.length).toBe(1);
  expect(calls[0][0]).toBe(err);
  expect(calls[0][2]).toEqual({
    mechanism: "react_error_boundary",
    handled: false,
    severity: "error",
  });
});

test("works without a hook and survives a throwing hook", () => {
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => void logged.push(args);
  fakeWindow(undefined);
  reportAppError(new Error("a"));
  fakeWindow(() => {
    throw new Error("hook broke");
  });
  expect(() => reportAppError(new Error("b"))).not.toThrow();
  expect(logged.length).toBe(3);
});

test("is a no-op during SSR (no window)", () => {
  let called = false;
  console.error = () => void (called = true);
  reportAppError(new Error("ssr"));
  expect(called).toBe(false);
});
