import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

const require = createRequire(import.meta.url);
const { JSDOM } = await import(
  pathToFileURL(resolve(process.env.PASSWORD_QA_MODULES ?? "node_modules", "jsdom/lib/api.js")).href
);
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://example.invalid",
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const bundled = await build({
  entryPoints: ["src/components/admin/password-reset-dialog.tsx"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  jsx: "automatic",
  plugins: [
    {
      name: "presentation-boundaries",
      setup(b) {
        b.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, (a) => ({
          path: pathToFileURL(require.resolve(a.path)).href,
          external: true,
        }));
        b.onResolve({ filter: /^@\/components\/ui\// }, (a) => ({ path: a.path, namespace: "ui" }));
        b.onLoad({ filter: /.*/, namespace: "ui" }, () => ({
          contents: `import React from "react";
        const wrap=tag=>({children,onOpenChange,onInteractOutside,asChild,...props})=>React.createElement(tag,props,children);
        export const Button=wrap("button"), Input=wrap("input"), Label=wrap("label"),
          Dialog=wrap("section"), DialogContent=wrap("div"), DialogHeader=wrap("header"),
          DialogTitle=wrap("h2"), DialogDescription=wrap("p"), DialogFooter=wrap("footer");`,
          loader: "js",
        }));
      },
    },
  ],
});
const { PasswordResetDialog } = await import(
  "data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].text).toString("base64")
);
const target = { id: "test-user", email: "test@example.invalid", name: "Test user" };
async function mount(onReset) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      React.createElement(PasswordResetDialog, {
        target,
        onReset,
        onClose: () => root.unmount(),
      }),
    ),
  );
  const click = async (label) => {
    const button = [...container.querySelectorAll("button")].find((b) => b.textContent === label);
    assert.ok(button, label);
    await act(async () =>
      button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })),
    );
  };
  return {
    container,
    click,
    close: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

test("dialog confirms first, waits for save, displays the credential and reports clipboard failures honestly", async () => {
  let finish,
    calls = 0;
  const ui = await mount(() => {
    calls++;
    return new Promise((r) => {
      finish = r;
    });
  });
  assert.equal(calls, 0);
  assert.equal(ui.container.querySelector("input"), null);
  await ui.click("تأكيد إعادة التعيين");
  assert.equal(calls, 1);
  assert.ok([...ui.container.querySelectorAll("button")].every((b) => b.disabled));
  const secret = "SyntheticPasswordForTestOnly";
  await act(async () =>
    finish({ email: target.email, temporary_password: secret, action_link: null }),
  );
  assert.equal(ui.container.querySelector("input").value, secret);
  assert.match(ui.container.textContent, /تم تعيين هذه الكلمة بنجاح/);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async () => {
        throw Error("denied");
      },
    },
  });
  await ui.click("نسخ");
  assert.match(ui.container.querySelector('[role="status"]').textContent, /تعذر النسخ/);
  assert.doesNotMatch(ui.container.querySelector('[role="status"]').textContent, /تم النسخ/);
  let copied = "";
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (value) => {
        copied = value;
      },
    },
  });
  await ui.click("نسخ");
  assert.equal(copied, secret);
  assert.match(ui.container.querySelector('[role="status"]').textContent, /تم النسخ/);
  await ui.click("إغلاق");
  assert.equal(ui.container.innerHTML, "");
  ui.container.remove();
});

test("failed reset keeps confirmation visible without a fabricated password", async () => {
  const ui = await mount(async () => {
    throw Error("تعذر الحفظ");
  });
  await ui.click("تأكيد إعادة التعيين");
  assert.equal(ui.container.querySelector("input"), null);
  assert.match(ui.container.querySelector('[role="alert"]').textContent, /تعذر الحفظ/);
  await ui.close();
});

test("admin recovery is visibly labeled as a link, not a new password", async () => {
  const ui = await mount(async () => ({
    email: target.email,
    temporary_password: null,
    action_link: "https://example.invalid/recovery",
  }));
  await ui.click("تأكيد إعادة التعيين");
  assert.match(ui.container.querySelector("label").textContent, /رابط استعادة/);
  assert.equal(ui.container.querySelector("input").value, "https://example.invalid/recovery");
  await ui.close();
});
