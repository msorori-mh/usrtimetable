const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

function harness({ fonts = Promise.resolve(), printThrows = false } = {}) {
  const state = [],
    effects = [],
    listeners = new Map(),
    errors = [],
    printedTitles = [];
  let cursor = 0,
    effectCursor = 0,
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
      useRef: (initial) => {
        const i = cursor++;
        if (!(i in state)) state[i] = { current: initial };
        return state[i];
      },
      useEffect: (run, deps) => {
        const i = effectCursor++;
        const previous = effects[i];
        if (!previous || deps.some((dep, index) => dep !== previous.deps[index])) {
          previous?.cleanup?.();
          effects[i] = { deps, run };
        }
      },
      useMemo: (fn) => fn(),
    },
    "@/hooks/use-colleges": { useActiveCollege: () => ({ active: { name: "Synthetic college" } }) },
    "@/components/reports/report-official-header": { headerMetaFromContext: () => ({}) },
    "@/lib/reports/preferences": { ReportScopeError: class extends Error {} },
    "@/lib/print-center": { printPageStyleCss: () => "" },
    sonner: { toast: { error: (message) => errors.push(message) } },
  };
  const dispatch = (event) => {
    for (const callback of [...(listeners.get(event) ?? [])]) callback();
  };
  const window = {
    location: { href: "https://example.test/reports/schedule" },
    addEventListener: (event, callback) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(callback);
    },
    removeEventListener: (event, callback) => listeners.get(event)?.delete(callback),
    print: () => {
      dispatch("beforeprint");
      prints++;
      printedTitles.push(document.title);
      if (printThrows) throw new Error("unavailable");
    },
  };
  for (const [name, path] of [
    ["@/lib/reports/schedule-filename", "src/lib/reports/schedule-filename.ts"],
    ["@/hooks/use-report-document-title", "src/hooks/use-report-document-title.ts"],
  ]) {
    const dependency = { exports: {} };
    vm.runInNewContext(
      ts.transpileModule(fs.readFileSync(path, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText,
      {
        module: dependency,
        exports: dependency.exports,
        document,
        window,
        require: (id) => dependencies[id],
      },
    );
    dependencies[name] = dependency.exports;
  }
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
    window,
    URL,
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
      effectCursor = 0;
      const tree = module.exports.ReportShell({ ...props, ...overrides });
      for (const effect of effects) {
        if (effect.run) {
          effect.cleanup = effect.run();
          effect.run = null;
        }
      }
      return tree;
    },
    nativePrint: () => window.print(),
    unmount: () => effects.forEach((effect) => effect.cleanup?.()),
    afterPrint: () => dispatch("afterprint"),
    listenerCount: (event) => listeners.get(event)?.size ?? 0,
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
const clickPrint = (app, props = {}) => {
  const pending = button(app.render(props)).props.onClick();
  // React commits the state queued by the click before the asynchronous print dispatch.
  app.render(props);
  return pending;
};

test("print keeps complete data through background errors until afterprint", async () => {
  const app = harness();
  await clickPrint(app);
  assert.equal(app.prints(), 1);
  const tree = app.render({ rows: [], printContent: null, error: new Error("refetch failed") });
  assert.equal(snapshot(tree).props.children.props.children, "Complete printable rows");
  assert.equal(app.document.title, "Report");
  app.afterPrint();
  assert.equal(snapshot(app.render()), null);
  assert.equal(app.document.title, "Original");
});

test("reports without a dedicated print component also retain their complete body", async () => {
  const app = harness();
  await clickPrint(app, { printContent: null });
  const tree = app.render({ printContent: null, rows: [], error: new Error("offline") });
  assert.ok(find(snapshot(tree), (node) => node.props?.children === "Complete rows"));
  app.afterPrint();
});

test("stalled fonts fall back after two seconds instead of blocking print", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const app = harness({ fonts: new Promise(() => {}) });
  const pending = clickPrint(app);
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
  await clickPrint(blocked, { error: new Error("offline") });
  assert.equal(blocked.prints(), 0);
  const failed = harness({ printThrows: true });
  await clickPrint(failed);
  assert.equal(snapshot(failed.render()), null);
  assert.equal(failed.document.title, "Original");
  assert.equal(failed.errors.length, 1);
});

test("print preview receives the selected filename and keeps it after closing", async () => {
  const app = harness();
  const names = [
    "أحمد البدوي",
    "تقنية المعلومات — المستوى الثاني — انتظام",
    "علوم الحاسوب — المستوى الثالث — موازي",
  ];
  for (const name of names) {
    await clickPrint(app, { printFilename: name });
    assert.equal(app.printedTitles.at(-1), name);
    assert.equal(app.document.title, name);
    app.afterPrint();
    assert.equal(snapshot(app.render({ printFilename: name })), null);
    assert.equal(app.document.title, name);
  }
  assert.deepEqual(app.printedTitles, names);
});

test("print failure clears the snapshot and keeps the current schedule filename", async () => {
  const app = harness({ printThrows: true });
  const name = "الجدول المعتمد — جدول المحاضر — عيسى";
  await clickPrint(app, { printFilename: name });
  assert.deepEqual(app.printedTitles, [name]);
  assert.equal(app.document.title, name);
  assert.equal(snapshot(app.render({ printFilename: name })), null);
});

test("native print uses the latest selection without clicking the report button", () => {
  const app = harness();
  const names = ["أمل شايف", "تقنية المعلومات — المستوى الثاني — موازي", "عبدالرحمن عمر سلام"];
  for (const name of names) {
    app.render({ printFilename: name });
    assert.equal(app.document.title, name);
    // Router metadata must not replace the selected report's PDF filename.
    app.document.title = "Generic route title";
    app.nativePrint();
    assert.equal(app.printedTitles.at(-1), name);
    app.afterPrint();
    assert.equal(app.document.title, name);
  }
  app.unmount();
  assert.equal(app.document.title, "Original");
  app.document.title = "Next page";
  app.nativePrint();
  assert.equal(app.printedTitles.at(-1), "Next page");
});

test("leaving a report does not overwrite the next route title", () => {
  const app = harness();
  app.render({ printFilename: "أمل شايف" });
  app.document.title = "Dashboard";
  app.unmount();
  assert.equal(app.document.title, "Dashboard");
});

test("selection changes during font loading keep the original content and filename together", async () => {
  let ready;
  const app = harness({
    fonts: new Promise((resolve) => {
      ready = resolve;
    }),
  });
  const original = {
    printFilename: "أمل شايف",
    printContent: { type: "table", props: { children: "Amal schedule" } },
  };
  const next = {
    printFilename: "أنوار عويضان",
    printContent: { type: "table", props: { children: "Anwar schedule" } },
  };
  const pending = clickPrint(app, original);
  const tree = app.render(next);
  assert.equal(snapshot(tree).props.children.props.children, "Amal schedule");
  ready();
  await pending;
  assert.deepEqual(app.printedTitles, [original.printFilename]);
  app.afterPrint();
  assert.equal(snapshot(app.render(next)), null);
  assert.equal(app.document.title, next.printFilename);
});

test("closing preview restores the latest selection without a stale afterprint listener", async () => {
  const app = harness();
  await clickPrint(app, { printFilename: "أمل شايف" });
  app.render({ printFilename: "أنوار عويضان" });
  assert.equal(app.document.title, "أمل شايف");
  app.afterPrint();
  app.render({ printFilename: "أنوار عويضان" });
  assert.equal(app.document.title, "أنوار عويضان");
  assert.equal(app.listenerCount("afterprint"), 0);
  app.afterPrint();
  assert.equal(app.document.title, "أنوار عويضان");
});

test("leaving during preview removes print listeners and cannot overwrite the next route", async () => {
  const app = harness();
  await clickPrint(app, { printFilename: "أمل شايف" });
  app.unmount();
  assert.equal(app.listenerCount("beforeprint"), 0);
  assert.equal(app.listenerCount("afterprint"), 0);
  app.document.title = "Dashboard";
  app.afterPrint();
  assert.equal(app.document.title, "Dashboard");
});

test("leaving while fonts are pending cancels dispatch even if the font promise never resolves", async () => {
  const app = harness({ fonts: new Promise(() => {}) });
  const pending = clickPrint(app, { printFilename: "أمل شايف" });
  app.unmount();
  app.document.title = "Dashboard";
  await pending;
  assert.equal(app.prints(), 0);
  assert.equal(app.listenerCount("beforeprint"), 0);
  assert.equal(app.listenerCount("afterprint"), 0);
  assert.equal(app.document.title, "Dashboard");
});

test("repeated clicks cannot overlap a pending or open print preview", async () => {
  let ready;
  const app = harness({
    fonts: new Promise((resolve) => {
      ready = resolve;
    }),
  });
  const original = { printFilename: "أمل شايف" };
  const next = { printFilename: "أنوار عويضان" };
  const pending = clickPrint(app, original);
  await clickPrint(app, next);
  assert.equal(app.prints(), 0);
  ready();
  await pending;
  await clickPrint(app, next);
  assert.deepEqual(app.printedTitles, [original.printFilename]);
  app.afterPrint();
  app.render(next);
  await clickPrint(app, next);
  assert.deepEqual(app.printedTitles, [original.printFilename, next.printFilename]);
  app.afterPrint();
  app.render(next);
  assert.equal(app.listenerCount("afterprint"), 0);
});
