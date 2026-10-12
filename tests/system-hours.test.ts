import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSystemHoursRows,
  parseSystemHours,
  systemHoursHeaders,
  type SystemHoursFact,
} from "../src/lib/reports/system-hours.ts";

const fact: SystemHoursFact = {
  identity_id: "one",
  instructor: "محاضر",
  university_number: "100",
  rank: null,
  quota: 12,
  regular: 15,
  parallel: 6,
  unknown: 0,
  project: 4,
  allocation_pending: false,
};
const row = (
  patch: Partial<SystemHoursFact> = {},
  kind: "overload_system" | "contractual" = "overload_system",
  system: "all" | "regular" | "parallel" = "all",
) => buildSystemHoursRows([{ ...fact, ...patch }], kind, system)[0];

test("regular consumes quota first; parallel is not charged a second quota", () => {
  assert.deepEqual([row().regular, row().parallel, row().total], [3, 6, 9]);
});
test("unused regular quota carries into parallel", () => {
  assert.deepEqual(
    [row({ regular: 8 }).regular, row({ regular: 8 }).parallel, row({ regular: 8 }).total],
    [0, 2, 2],
  );
});
test("zero quota is valid; missing quota stays unresolved", () => {
  assert.equal(row({ quota: 0 }).total, 21);
  assert.equal(row({ quota: null }).total, null);
});
test("under-quota members are omitted from overload", () => {
  assert.equal(row({ regular: 5, parallel: 6 }), undefined);
});
test("contract hours have no quota deduction, even without a quota", () => {
  assert.deepEqual(
    [
      row({ quota: null }, "contractual").regular,
      row({}, "contractual").parallel,
      row({}, "contractual").total,
    ],
    [15, 6, 21],
  );
});
test("system filters preserve the full quota calculation and match export headers", () => {
  assert.equal(row({ regular: 8 }, "overload_system", "parallel").total, 2);
  assert.equal(row({}, "contractual", "regular").total, 15);
  assert.ok(!systemHoursHeaders("contractual", "regular").some((h) => h.key === "parallel"));
});
test("unknown system does not get silently assigned to regular or parallel", () => {
  assert.equal(row({ unknown: 3 }).total, null);
  assert.equal(row({ unknown: 3 }, "contractual").total, 24);
  assert.equal(row({ unknown: 3 }, "contractual", "regular").total, 15);
});
test("unallocated co-teaching remains visible without invented totals", () => {
  for (const kind of ["contractual", "overload_system"] as const) {
    assert.equal(row({ allocation_pending: true }, kind).total, null);
  }
});
test("project supervision is excluded; fractional hours retain precision", () => {
  assert.equal(row({ project: 100 }).total, 9);
  assert.equal(row({ regular: 12.25, parallel: 1.5 }).total, 1.75);
});
const scope = { collegeId: "c", termId: "t", kind: "contractual" as const };
const payload = { college_id: "c", term_id: "t", kind: "contractual", rows: [fact] };
test("parser rejects scope drift, duplicate identities and incomplete facts", () => {
  assert.equal(parseSystemHours(payload, scope).length, 1);
  for (const bad of [
    null,
    {},
    { ...payload, college_id: "other" },
    { ...payload, rows: [fact, fact] },
    { ...payload, rows: [{ ...fact, regular: -1 }] },
    { ...payload, rows: [{ ...fact, parallel: "6" }] },
    { ...payload, rows: [{ ...fact, allocation_pending: undefined }] },
  ]) {
    assert.throws(() => parseSystemHours(bad, scope));
  }
});
