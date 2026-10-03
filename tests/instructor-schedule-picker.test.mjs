import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Render the actual report route; only authenticated data and presentation
// boundaries are mocked. The roster helper and report computations remain real.
const require = createRequire(import.meta.url);
globalThis.__instructorPickerReact = React;
const fixture = {
  scope: "all",
  isSuperAdmin: true,
  collegeId: "current",
  directoryCollegeId: "current",
};
globalThis.__instructorPickerFixture = fixture;
const faculty = (id, overrides = {}) => ({
  id,
  identity_id: id,
  record_ids: [id],
  university_number: `U-${id}`,
  full_name: `${id} lecturer`,
  college_id: "current",
  home_college_id: "current",
  home_college_name: "Current college",
  instructor_type_code: "faculty",
  employment_type: "permanent",
  recorded_quota: 12,
  recorded_release: 0,
  authoritative_quota: 12,
  ...overrides,
});
fixture.instructors = [
  faculty("local"),
  faculty("guest", {
    college_id: "other",
    home_college_id: "other",
    home_college_name: "Other college",
    record_ids: ["guest", "guest-alias"],
  }),
  faculty("unrelated", { college_id: "other", home_college_id: "other" }),
  faculty("outside-university", { college_id: "foreign", home_college_id: "foreign" }),
];
const mocks = {
  "@tanstack/react-router": `export const createFileRoute = () => options => ({ options });`,
  "@tanstack/react-query": `export function useQuery({ queryKey }) {
    const f = globalThis.__instructorPickerFixture;
    return { data: queryKey[0] === "university-instructor-schedule-directory" ? {
      collegeId: f.directoryCollegeId, canViewAcrossColleges: true,
      instructors: f.instructors, currentInstructorIdentityIds: ["local", "guest"],
      colleges: [{ id: "current", name: "Current college", university_id: "university" }],
      terms: [], versions: []
    } : [], isLoading: false, isSuccess: true, error: null, refetch: async () => ({}) };
  }`,
  react: `const r = globalThis.__instructorPickerReact;
    export const useEffect = r.useEffect, useMemo = r.useMemo;
    export const useState = initial => r.useState(initial === "all"
      ? globalThis.__instructorPickerFixture.scope : initial);`,
  "@/hooks/use-current-user": `export const useCurrentUser = () => ({
    data: { id: "synthetic-user", isSuperAdmin: globalThis.__instructorPickerFixture.isSuperAdmin },
    isLoading: false, error: null
  });`,
  "@/hooks/reports/useReportContext": `export const useReportContext = () => ({
    collegeId: globalThis.__instructorPickerFixture.collegeId, versionId: null,
    isLoading: false, error: null, filterSummary: "Synthetic report context"
  });`,
  "@/components/reports/report-shell": `const h = globalThis.__instructorPickerReact.createElement;
    export const ReportShell = ({ filters, children, shareParams }) =>
      h("main", { "data-scope": shareParams.instructorScheduleScope }, filters, children);`,
  "@/components/reports/report-filters": `const h = globalThis.__instructorPickerReact.createElement;
    export const ReportFilters = ({ children }) => h("div", null, children);
    export const ReportFilterField = ({ htmlFor, children }) =>
      h("section", { "data-field": htmlFor }, children);`,
  "@/components/ui/select": `const h = globalThis.__instructorPickerReact.createElement;
    export const Select = ({ value, children }) => h("div", { "data-selected": value }, children);
    export const SelectContent = ({ children }) => h("div", null, children);
    export const SelectItem = ({ value, children }) => h("option", { value }, children);
    export const SelectTrigger = ({ id, children }) => h("button", { id }, children);
    export const SelectValue = ({ placeholder }) => h("span", null, placeholder);`,
  "@/components/reports/report-timetable-view": `export const ReportTimetableView = () => null;`,
  "@/components/reports/instructor-college-hours": `export const InstructorCollegeHours = () => null;`,
  "@/components/reports/instructor-batch-print": `const h = globalThis.__instructorPickerReact.createElement;
    export const InstructorBatchPrint = ({ items }) =>
      h("button", { "data-batch": items.map((item) => item.id).join(",") });`,
  "@/components/reports/repeating-print-header": `export const RepeatingPrintHeader = () => null;`,
  "@/components/reports/report-official-header": `export const ReportOfficialHeader = () => null;`,
  "@/lib/schedule-versions/lifecycle": `export const STATUS_LABEL_AR = {};`,
  "@/lib/reports/queries/university-instructor-schedule": `const unexpected = () => {
    throw new Error("SSR must not make live queries");
  }; export const fetchUniversityScheduleDirectory = unexpected,
    fetchInstructorTeachingCollegeIds = unexpected, fetchUniversityInstructorSchedule = unexpected;`,
};
const bundle = await build({
  entryPoints: ["src/routes/_authenticated/reports.instructor-schedule.tsx"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  jsx: "automatic",
  plugins: [
    {
      name: "instructor-picker-boundaries",
      setup(b) {
        b.onResolve({ filter: /.*/ }, ({ path }) =>
          mocks[path] !== undefined ? { path, namespace: "picker-fixture" } : undefined,
        );
        b.onResolve({ filter: /^react\/jsx-runtime$/ }, ({ path }) => ({
          path: pathToFileURL(require.resolve(path)).href,
          external: true,
        }));
        b.onLoad({ filter: /.*/, namespace: "picker-fixture" }, ({ path }) => ({
          contents: mocks[path],
        }));
      },
    },
  ],
});
const { Route } = await import(
  "data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64")
);
const render = (overrides = {}) => {
  Object.assign(
    fixture,
    { scope: "all", isSuperAdmin: true, collegeId: "current", directoryCollegeId: "current" },
    overrides,
  );
  return renderToStaticMarkup(React.createElement(Route.options.component));
};
const field = (html, id) =>
  html.match(new RegExp(`<section data-field="${id}">([\\s\\S]*?)</section>`))?.[1] ?? "";
const values = (html) => [...html.matchAll(/<option value="([^"]+)"/g)].map((match) => match[1]);

test("actual lecturer picker uses the current roster in both schedule scopes", () => {
  for (const scope of ["all", "current"]) {
    const picker = field(render({ scope }), "is-instructor");
    assert.deepEqual(values(picker), ["guest", "local"]);
    assert.match(picker, /guest lecturer/);
    assert.match(picker, /local lecturer/);
    assert.doesNotMatch(picker, /unrelated lecturer|outside-university lecturer/);
    assert.equal(values(picker).filter((id) => id === "guest").length, 1);
    assert.ok(!values(picker).includes("guest-alias"));
  }
});

test("actual scope selector contains exactly all colleges and current college", () => {
  const html = render();
  assert.deepEqual(values(field(html, "is-schedule-scope")), ["all", "current"]);
  assert.doesNotMatch(html, /value="home"|is-home-college|كلية انتمائه فقط/);
});

test("college users keep the current roster and current scope without an all-colleges selector", () => {
  const html = render({ isSuperAdmin: false });
  assert.deepEqual(values(field(html, "is-instructor")), ["guest", "local"]);
  assert.equal(field(html, "is-schedule-scope"), "");
  assert.match(html, /data-scope="current"/);
});

test("a directory cached for the previous active college exposes no lecturer choices", () => {
  const html = render({ collegeId: "next-college" });
  assert.deepEqual(values(field(html, "is-instructor")), []);
  assert.doesNotMatch(html, /local lecturer|guest lecturer|unrelated lecturer/);
  assert.equal(field(html, "is-schedule-scope"), "");
});

test("the print-all action covers exactly the lecturers the picker offers", () => {
  assert.match(render({ scope: "all" }), /data-batch="guest,local"/);
  assert.match(render({ isSuperAdmin: false }), /data-batch="guest,local"/);
});
