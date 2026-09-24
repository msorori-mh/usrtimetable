import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { transformSync } from "esbuild";
const source = transformSync(
  fs.readFileSync(new URL("../src/lib/active-college-store.ts", import.meta.url), "utf8"),
  { loader: "ts", format: "cjs" },
).code;
const storage = () => {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
};
const key = "active-college-id";
function tab(shared, session = storage()) {
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    window: { localStorage: shared, sessionStorage: session },
  });
  return { ...module.exports, session };
}
test("changing another college cannot replace an initialized tab or its save scope", () => {
  const shared = storage(),
    a = tab(shared),
    b = tab(shared);
  a.setActiveCollegeId("ITCS");
  assert.equal(b.getActiveCollegeId(), "ITCS");
  let notified = 0;
  a.subscribeActiveCollegeId(() => notified++);
  b.setActiveCollegeId("ADMIN");
  assert.equal(a.getActiveCollegeId(), "ITCS");
  assert.equal(b.getActiveCollegeId(), "ADMIN");
  assert.equal(notified, 0);
  assert.equal(
    a.buildCollegeScopedSavePayload(a.getActiveCollegeId(), { version: "draft" }).college_id,
    "ITCS",
  );
  assert.equal(a.collegeScopedQueryKey("sessions", a.getActiveCollegeId())[1], "ITCS");
});
test("a reload retains the tab choice while a fresh tab inherits the last selected college", () => {
  const shared = storage(),
    a = tab(shared);
  a.setActiveCollegeId("ITCS");
  tab(shared).setActiveCollegeId("ADMIN");
  assert.equal(tab(shared, a.session).getActiveCollegeId(), "ITCS");
  assert.equal(tab(shared).getActiveCollegeId(), "ADMIN");
});
test("explicit same-tab switches notify all subscribers and unsubscribe removes listeners", () => {
  const a = tab(storage());
  let first = 0,
    second = 0;
  const remove = a.subscribeActiveCollegeId(() => first++);
  a.subscribeActiveCollegeId(() => second++);
  a.setActiveCollegeId("ITCS");
  remove();
  a.setActiveCollegeId("ADMIN");
  assert.equal(first, 1);
  assert.equal(second, 2);
  assert.equal(a.getActiveCollegeId(), "ADMIN");
});
test("storage denial does not lose the in-memory scope or notifications", () => {
  const denied = {
    getItem() {
      throw Error("denied");
    },
    setItem() {
      throw Error("denied");
    },
  };
  const a = tab(denied, denied);
  assert.equal(a.getActiveCollegeId(), null);
  let calls = 0;
  a.subscribeActiveCollegeId(() => calls++);
  a.setActiveCollegeId("ITCS");
  assert.equal(a.getActiveCollegeId(), "ITCS");
  assert.equal(calls, 1);
});
test("server reads do not initialize or expose browser scope", () => {
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports });
  assert.equal(module.exports.getActiveCollegeId(), null);
  module.exports.setActiveCollegeId("ITCS");
  assert.equal(module.exports.getActiveCollegeId(), null);
});
