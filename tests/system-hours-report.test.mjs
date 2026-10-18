import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
globalThis.__systemHoursReact = React;
const fixture = {
  system: "all",
  view: "ranks",
  rank: "__all_ranks__",
  search: "",
  loading: false,
  error: null,
};
globalThis.__systemHoursFixture = fixture;
const fact = (id, rank, regular, parallel) => ({
  identity_id: id,
  instructor: `محاضر ${id}`,
  university_number: id,
  rank,
  regular,
  parallel,
  quota: 12,
  unknown: 0,
  project: 0,
  allocation_pending: false,
  classification_pending: false,
});
fixture.facts = [
  fact("a", "أستاذ مساعد", 2, 3),
  fact("b", "أستاذ مساعد", 4, 1),
  fact("c", "مدرس", 3, 2),
];
const mocks = {
  react: `const r=globalThis.__systemHoursReact; export const useState = initial => r.useState(initial === "all" ? globalThis.__systemHoursFixture.system : initial === "ranks" ? globalThis.__systemHoursFixture.view : initial === "__all_ranks__" ? globalThis.__systemHoursFixture.rank : initial === "" ? globalThis.__systemHoursFixture.search : initial);`,
  "@tanstack/react-query": `export const useQuery = ({queryKey}) => ({ data: queryKey[0] === "system-hours-terms" ? [{id:"term",name:"الفصل الأول"}] : globalThis.__systemHoursFixture.facts, error: globalThis.__systemHoursFixture.error, isFetching: globalThis.__systemHoursFixture.loading, refetch:async()=>({}) });`,
  "@tanstack/react-router": `export const Link=({children})=>children;`,
  "@/integrations/supabase/client": `export const supabase={};`,
  "@/lib/reports/queries/version-queries": `export const fetchAcademicTerms=()=>{throw Error("no live queries")};`,
  "@/components/reports/report-shell": `const h=globalThis.__systemHoursReact.createElement; export const ReportShell=props=>{globalThis.__systemHoursSnapshot=props;return h("main",null,props.filters,props.children)};`,
  "@/components/reports/report-filter-bar": `const h=globalThis.__systemHoursReact.createElement; export const ReportFilterBar=({basic})=>h("aside",null,basic); export const ReportFilterField=({children})=>h("label",null,children);`,
  "@/components/reports/report-section": `const h=globalThis.__systemHoursReact.createElement; export const ReportSection=({children})=>h("section",null,children);export const ReportDataTable=props=>{globalThis.__systemHoursTable=props;return h("table",null)};`,
  "@/components/ui/card": `export const Card=({children})=>children;`,
  "@/components/ui/select": `const h=globalThis.__systemHoursReact.createElement;export const Select=({children})=>children;export const SelectContent=({children})=>children;export const SelectItem=({value,children})=>h("option",{value},children);export const SelectTrigger=props=>h("button",props);export const SelectValue=()=>null;`,
};
const result = await build({
  entryPoints: ["src/components/reports/system-hours-report.tsx"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  jsx: "automatic",
  plugins: [
    {
      name: "system-hours-boundaries",
      setup(b) {
        b.onResolve({ filter: /.*/ }, ({ path }) =>
          mocks[path] !== undefined ? { path, namespace: "fixture" } : undefined,
        );
        b.onResolve({ filter: /^react\/jsx-runtime$/ }, ({ path }) => ({
          path: pathToFileURL(require.resolve(path)).href,
          external: true,
        }));
        b.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: mocks[path] }));
      },
    },
  ],
});
const { SystemHoursReport } = await import(
  "data:text/javascript;base64," + Buffer.from(result.outputFiles[0].text).toString("base64")
);
function render(patch = {}, kind = "contractual") {
  Object.assign(
    fixture,
    {
      system: "all",
      view: "ranks",
      rank: "__all_ranks__",
      search: "",
      loading: false,
      error: null,
    },
    patch,
  );
  const html = renderToStaticMarkup(
    React.createElement(SystemHoursReport, {
      collegeId: "college",
      collegeName: "كلية الاختبار",
      kind,
      initialTermId: "term",
    }),
  );
  return { html, shell: globalThis.__systemHoursSnapshot, table: globalThis.__systemHoursTable };
}
test("contractual hours default to rank totals and send identical rows/headers to screen, print and exports", () => {
  const { html, shell, table } = render();
  assert.equal(shell.rows.length, 2);
  assert.equal(shell.kpis[0].value, 3);
  assert.equal(shell.kpis[1].value, 15);
  assert.deepEqual(shell.rows, table.rows);
  assert.deepEqual(
    shell.headers,
    table.columns.map(({ key, label }) => ({ key, label })),
  );
  assert.match(html, /aria-label="الرتبة العلمية"/);
  assert.match(shell.filename, /ملخص بحسب الرتبة العلمية/);
});
test("rank, system and lecturer search filters are applied before aggregation", () => {
  const { shell } = render({ rank: "أستاذ مساعد", system: "parallel", search: "محاضر b" });
  assert.equal(shell.rows.length, 1);
  assert.equal(shell.rows[0].lecturer_count, 1);
  assert.equal(shell.rows[0].total, 1);
  assert.equal(shell.kpis[0].value, 1);
  assert.match(shell.filterSummary, /أستاذ مساعد/);
  assert.ok(!shell.headers.some((h) => h.key === "regular"));
});
test("lecturer detail remains available with the same rank filter and hours", () => {
  const { shell } = render({ rank: "أستاذ مساعد", view: "lecturers" });
  assert.equal(shell.rows.length, 2);
  assert.deepEqual(
    shell.rows.map((r) => r.instructor),
    ["محاضر a", "محاضر b"],
  );
  assert.equal(shell.kpis[1].value, 10);
  assert.ok(shell.headers.some((h) => h.key === "university_number"));
});
test("loading or failed responses cannot export stale totals", () => {
  for (const patch of [{ loading: true }, { error: new Error("denied") }]) {
    const { shell } = render(patch);
    assert.deepEqual(shell.rows, []);
  }
});
test("the overload report retains its lecturer layout and has no contractual rank controls", () => {
  const { html, shell } = render({}, "overload_system");
  assert.ok(shell.headers.some((h) => h.key === "quota"));
  assert.doesNotMatch(html, /aria-label="الرتبة العلمية"/);
  assert.doesNotMatch(shell.filename, /ملخص بحسب الرتبة العلمية/);
});
