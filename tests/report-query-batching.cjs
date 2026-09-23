const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const test = require("node:test");
const ts = require("typescript");

const uuid = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
function fixture(count = 275, failBatch = 0) {
  const calls = [];
  const sessions = Array.from({ length: count }, (_, i) => ({
    id: uuid(i + 10000),
    cohort_id: uuid(i),
    delivery_group_id: uuid(i),
  }));
  const groups = sessions.map((s) => ({
    id: s.delivery_group_id,
    cohort_id: s.cohort_id,
    college_id: "college",
    group_code: `G${s.delivery_group_id}`,
    active: true,
    is_obsolete: false,
  }));
  const cohorts = sessions.map((s) => ({
    id: s.cohort_id,
    code: `C${s.id}`,
    college_id: "college",
  }));
  const tables = { delivery_groups: groups, academic_cohorts: cohorts };
  const supabase = {
    from(table) {
      const request = { table, filters: [], equal: [], from: 0, to: Infinity };
      const q = {
        select() {
          return q;
        },
        in(key, values) {
          request.filters.push([key, values]);
          return q;
        },
        eq(key, value) {
          request.equal.push([key, value]);
          return q;
        },
        order() {
          return q;
        },
        range(from, to) {
          request.from = from;
          request.to = to;
          return q;
        },
        then(resolve, reject) {
          calls.push(request);
          const tooLong = request.filters.some(
            ([, ids]) =>
              new URLSearchParams({ id: `in.(${ids.join(",")})` }).toString().length > 8000,
          );
          const error =
            tooLong || (failBatch && calls.length === failBatch) ? new Error("read failed") : null;
          const data = (tables[table] || [])
            .filter(
              (row) =>
                request.filters.every(([key, ids]) => ids.includes(row[key])) &&
                request.equal.every(([key, value]) => row[key] === value),
            )
            .slice(request.from, request.to + 1);
          return Promise.resolve({ data: error ? null : data, error }).then(resolve, reject);
        },
      };
      return q;
    },
  };
  const exports = {};
  const load = (path) => {
    const result = ts.transpileModule(fs.readFileSync(path, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    });
    const target = {};
    vm.runInNewContext(result.outputText, {
      exports: target,
      require: () => ({
        supabase,
        fetchSharedLectures: async () => [],
        attachIntakePresentation: async (rows) => rows,
        assembleWorkspaceSessionRows: (rows) => rows,
        wholeCohortGroupLabels: () => new Map(),
        readAllReportRows: async (page) => {
          const r = await page(0, 499);
          if (r.error) throw r.error;
          return r.data;
        },
      }),
    });
    Object.assign(exports, target);
  };
  load("src/lib/schedule-builder/queries.ts");
  load("src/lib/reports/queries/session-queries.ts");
  return { calls, sessions, ...exports };
}

test("full 275-session report hydrates all group scopes with bounded requests", async () => {
  const f = fixture();
  const rows = await f.hydrateWorkspaceSessions(f.sessions);
  assert.equal(rows.length, 275);
  const reads = f.calls.filter((c) => c.table === "delivery_groups");
  assert.deepEqual(
    reads.map((c) => c.filters[0][1].length),
    [100, 100, 75],
  );
});

test("report labels retain every cohort and group and tenant filter in all batches", async () => {
  const f = fixture(1205);
  const labels = await f.fetchCohortDeliveryGroupLabels("college", f.sessions);
  assert.equal(labels.cohorts.size, 1205);
  assert.equal(labels.deliveryGroups.size, 1205);
  assert.equal(labels.deliveryGroups.get(uuid(1204)), `G${uuid(1204)}`);
  assert.ok(
    f.calls.every((c) =>
      c.equal.some(([key, value]) => key === "college_id" && value === "college"),
    ),
  );
  assert.ok(f.calls.every((c) => c.filters.every(([, ids]) => ids.length <= 100)));
});

test("batch failure is propagated instead of returning partial report data", async () => {
  for (const method of ["hydrateWorkspaceSessions", "fetchCohortDeliveryGroupLabels"]) {
    const f = fixture(275, 2);
    await assert.rejects(
      () =>
        method === "hydrateWorkspaceSessions"
          ? f[method](f.sessions)
          : f[method]("college", f.sessions),
      /read failed/,
    );
  }
});

test("empty input has no group or label requests; duplicate IDs are read once", async () => {
  const empty = fixture(0);
  await empty.fetchCohortDeliveryGroupLabels("college", []);
  assert.equal(empty.calls.length, 0);
  const f = fixture(1);
  await f.hydrateWorkspaceSessions(Array(275).fill(f.sessions[0]));
  assert.equal(f.calls.filter((c) => c.table === "delivery_groups").length, 1);
  assert.equal(f.calls.find((c) => c.table === "delivery_groups").filters[0][1].length, 1);
});
