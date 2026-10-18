import { test, expect } from "bun:test";
import { withStableKeys } from "../src/hooks/stable-keys";

test("keys follow the item, not its position (L-14)", () => {
  const a = { code: "ROOM", s: "1" };
  const b = { code: "INSTR", s: "2" };
  const before = withStableKeys([a, b], (x) => `${x.code}:${x.s}`);
  const after = withStableKeys([b, a], (x) => `${x.code}:${x.s}`);
  expect(before.find((r) => r.item === a)!.key).toBe(after.find((r) => r.item === a)!.key);
});

test("duplicates get unique suffixed keys", () => {
  const rows = withStableKeys([{ k: "x" }, { k: "x" }, { k: "y" }], (r) => r.k);
  expect(rows.map((r) => r.key)).toEqual(["x", "x#1", "y"]);
  expect(new Set(rows.map((r) => r.key)).size).toBe(3);
});
