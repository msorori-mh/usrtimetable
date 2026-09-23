const fs = require("fs"),
  vm = require("vm"),
  assert = require("assert/strict");
const ts = require("typescript");
for (const p of [
  "src/lib/schedule-builder/workspace.ts",
  "src/lib/schedule-builder/queries.ts",
  "src/routes/_authenticated/schedule-builder.tsx",
]) {
  const result = ts.transpileModule(fs.readFileSync(p, "utf8"), {
    fileName: p,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  assert.equal(
    (result.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error).length,
    0,
    p,
  );
  if (p.endsWith("workspace.ts")) {
    const exports = {};
    const ctx = vm.createContext({
      exports,
      require: () => ({ SESSION_TYPE_LABELS: {}, SESSION_STUDY_SYSTEM_LABELS: {} }),
    });
    vm.runInContext(result.outputText, ctx);
    global.work = exports;
  }
}
const { filterWorkspaceSessions, buildFilterOptions, EMPTY_WORKSPACE_FILTERS } = work;
const shared = {
  id: "shared",
  program_id: "a",
  program_name: "A",
  level_id: "a1",
  level_name: "One",
  session_type: "lecture",
  academic_memberships: [
    { program_id: "a", program_name: "A", level_id: "a1", level_name: "One" },
    { program_id: "b", program_name: "B", level_id: "b3", level_name: "Three" },
  ],
};
const plain = {
  id: "plain",
  program_id: "b",
  program_name: "B",
  level_id: "b1",
  level_name: "One",
  session_type: "lecture",
};
let cases = 0;
for (const program of ["all", "a", "b", "other"])
  for (const level of ["all", "a1", "b3", "b1", "other"]) {
    const result = filterWorkspaceSessions([shared, plain], {
      ...EMPTY_WORKSPACE_FILTERS,
      program,
      level,
    });
    const expected = [shared, plain].filter((s) =>
      (s.academic_memberships || [s]).some(
        (m) =>
          (program === "all" || m.program_id === program) &&
          (level === "all" || m.level_id === level),
      ),
    );
    assert.deepEqual(
      Array.from(result, (s) => s.id),
      expected.map((s) => s.id),
    );
    cases++;
  }
assert.deepEqual(
  Array.from(buildFilterOptions([shared, plain], "a").levels, (x) => x.id),
  ["a1"],
);
assert.deepEqual(
  Array.from(buildFilterOptions([shared, plain], "b").levels, (x) => x.id),
  ["b3", "b1"],
);
assert.equal(
  filterWorkspaceSessions([shared], { ...EMPTY_WORKSPACE_FILTERS, program: "a", level: "b3" })
    .length,
  0,
);
console.log(
  "PASS: " +
    cases +
    " program/level combinations, scoped levels, shared session uniqueness; TS/TSX syntax for 3 files.",
);
