import { test, expect } from "bun:test";
import { assertComplete, chunkIds, readAllRows } from "../src/lib/supabase/read-all.ts";

function fakeTable(n: number) {
  const rows = Array.from({ length: n }, (_, i) => ({ id: i }));
  const calls: Array<[number, number]> = [];
  const page = async (from: number, to: number) => {
    calls.push([from, to]);
    return { data: rows.slice(from, to + 1), error: null };
  };
  return { rows, calls, page };
}

test("H-10: readAllRows returns every row past the 1000-row cap", async () => {
  const t = fakeTable(2500);
  const out = await readAllRows(t.page);
  expect(out.length).toBe(2500);
  expect(out.map((r) => r.id)).toEqual(t.rows.map((r) => r.id));
  expect(t.calls).toEqual([
    [0, 999],
    [1000, 1999],
    [2000, 2999],
  ]);
});

test("H-10: exact multiple of page size makes one extra empty request", async () => {
  const t = fakeTable(2000);
  expect((await readAllRows(t.page)).length).toBe(2000);
  expect(t.calls.length).toBe(3);
});

test("H-10: custom page size and empty table", async () => {
  const t = fakeTable(7);
  expect((await readAllRows(t.page, 3)).length).toBe(7);
  expect(t.calls).toEqual([
    [0, 2],
    [3, 5],
    [6, 8],
  ]);
  expect(await readAllRows(fakeTable(0).page)).toEqual([]);
});

test("H-10: page errors propagate and null data fails closed", async () => {
  const boom = { message: "boom" };
  await expect(readAllRows(async () => ({ data: null, error: boom }))).rejects.toBe(boom);
  await expect(readAllRows(async () => ({ data: null, error: null }))).rejects.toThrow();
});

test("assertComplete / chunkIds", () => {
  expect(() => assertComplete({ data: [1], count: 2 }, "x")).toThrow();
  expect(assertComplete({ data: [1, 2], count: 2 }, "x")).toEqual([1, 2]);
  expect(chunkIds([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
});
