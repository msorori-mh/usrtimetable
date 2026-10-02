const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

function harness({ fonts = Promise.resolve(), printThrows = false } = {}) {
  const state = [],
    listeners = new Map(),
    errors = [],
    printedTitles = [];
  let cursor = 0,
    prints = 0;
  const document = { title: "Original", fonts: { ready: fonts } };
  const module = { exports: {} };
  const jsx = (type, props) => ({ type, props });
  const dependencies = {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    react: {
      useState: (initial) => {
        const i = cursor++;
        if (!(i in state)) state[i] = initial;
        return [
          state[i],
          (value) => {
            state[i] = value;
          },
        ];
      },
      useEffect() {},
      useMemo: (fn) => fn(),
    },
    "@/hooks/use-colleges": { useActiveCollege: () => ({ active: { name: "Synthetic college" } }) },
    "@/components/reports/report-official-header": { headerMetaFromContext: () => ({}) },
    "@/lib/reports/preferences": { ReportScopeError: class extends Error {} },
    "@/lib/print-center": { printPageStyleCss: () => "" },
    sonner: { toast: { error: (message) => errors.push(message) } },
  };
  const code = ts.transpileModule(
    fs.readFileSync("src/components/reports/report-shell.tsx", "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    document,
    window: {
      addEventListener: (event, callback) => listeners.set(event, callback),
      removeEventListener: (event) => listeners.delete(event),
      print: () => {
        prints++;
        printedTitles.push(document.title);
        if (printThrows) throw new Error("unavailable");
      },
    },
    requestAnimationFrame: (callback) => callback(),
    setTimeout,
    clearTimeout,
    require: (name) => dependencies[name] ?? {},
  });
  const props = {
    title: "Report",
    filename: "report",
    rows: [{ id: 1 }],
    headers: [],
    children: jsx("table", { children: "Complete rows" }),
    printContent: jsx("table", { children: "Complete printable rows" }),
  };
  return {
    render: (overrides = {}) => {
      cursor = 0;
      return module.exports.ReportShell({ ...props, ...overrides });
    },
    afterPrint: () => listeners.get("afterprint")?.(),
    prints: () => prints,
    printedTitles,
    document,
    errors,
  };
}

function find(node, predicate) {
  if (!node || typeof node !== "object") return null;
  if (predicate(node)) return node;
  for (const child of [node.props?.children].flat(Infinity)) {
    const found = find(child, predicate);
    if (found) return found;
  }
  return null;
}
const button = (tree) => find(tree, (node) => node.props?.["aria-label"] === "طباعة التقرير");
const snapshot = (tree) =>
  find(tree, (node) => node.props?.["data-testid"] === "report-print-snapshot");

test("print keeps complete data through background errors until afterprint", async () => {
  const app = harness();
  await button(app.render()).props.onClick();
  assert.equal(app.prints(), 1);
  const tree = app.render({ rows: [], printContent: null, error: new Error("refetch failed") });
  assert.equal(snapshot(tree).props.children.props.children, "Complete printable rows");
  assert.equal(app.document.title, "Report");
  app.afterPrint();
  assert.equal(app.document.title, "Original");
  assert.equal(snapshot(app.render()), null);
});

test("reports without a dedicated print component also retain their complete body", async () => {
  const app = harness();
  await button(app.render({ printContent: null })).props.onClick();
  const tree = app.render({ printContent: null, rows: [], error: new Error("offline") });
  assert.ok(find(snapshot(tree), (node) => node.props?.children === "Complete rows"));
  app.afterPrint();
});

test("stalled fonts fall back after two seconds instead of blocking print", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const app = harness({ fonts: new Promise(() => {}) });
  const pending = button(app.render()).props.onClick();
  assert.equal(app.prints(), 0);
  t.mock.timers.tick(2000);
  await pending;
  assert.equal(app.prints(), 1);
  // Returning from print is not proof the preview has closed.
  t.mock.timers.tick(60_000);
  assert.ok(snapshot(app.render()));
  app.afterPrint();
});

test("incomplete reports cannot print and print failures clear the snapshot", async () => {
  const blocked = harness();
  await button(blocked.render({ error: new Error("offline") })).props.onClick();
  assert.equal(blocked.prints(), 0);
  const failed = harness({ printThrows: true });
  await button(failed.render()).props.onClick();
  assert.equal(snapshot(failed.render()), null);
  assert.equal(failed.document.title, "Original");
  assert.equal(failed.errors.length, 1);
});

test("print preview receives the selected schedule filename before printing and restores it after closing", async () => {
  const app = harness();
  const names = [
    "الفصل الأول 2026 — الجدول الفردي — أحمد البدوي — جميع الكليات",
    "الفصل الأول 2026 — جداول الطلاب — تقنية المعلومات — المستوى الثاني — انتظام",
    "الفصل الثاني 2026 — جداول الطلاب — علوم الحاسوب — المستوى الثالث — موازي",
  ];
  for (const name of names) {
    await button(app.render({ printFilename: name })).props.onClick();
    assert.equal(app.printedTitles.at(-1), name);
    assert.equal(app.document.title, name);
    app.afterPrint();
    assert.equal(app.document.title, "Original");
    assert.equal(snapshot(app.render()), null);
  }
  assert.deepEqual(app.printedTitles, names);
});

test("a descriptive schedule filename is restored if printing throws", async () => {
  const app = harness({ printThrows: true });
  const name = "الجدول المعتمد — جدول المحاضر — عيسى";
  await button(app.render({ printFilename: name })).props.onClick();
  assert.deepEqual(app.printedTitles, [name]);
  assert.equal(app.document.title, "Original");
  assert.equal(snapshot(app.render()), null);
});
