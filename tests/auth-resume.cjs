const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

async function mount({ mfaRequired, levelError = null, needsFactor = mfaRequired }) {
  const navigations = [],
    updates = [],
    errors = [],
    effects = [];
  let component;
  const module = { exports: {} };
  const jsx = (type, props) => ({ type, props });
  const supabase = {
    auth: {
      getUser: async () => ({ data: { user: { id: "synthetic-user" } }, error: null }),
      mfa: {
        getAuthenticatorAssuranceLevel: async () => ({
          data: { currentLevel: needsFactor ? "aal1" : "aal2", nextLevel: "aal2" },
          error: levelError,
        }),
        listFactors: async () => ({
          data: { totp: [{ id: "synthetic-factor", status: "verified" }] },
          error: null,
        }),
      },
    },
  };
  class SessionCheckError extends Error {}
  const dependencies = {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    react: {
      useCallback: (fn) => fn,
      useEffect: (fn) => effects.push(fn),
      useState: (initial) => [initial, (value) => updates.push(value)],
    },
    "@tanstack/react-router": {
      createFileRoute: () => (options) => {
        component = options.component;
        return options;
      },
      useNavigate: () => (target) => navigations.push(target),
    },
    "@/integrations/supabase/client": { supabase },
    "@/lib/auth/check-session": {
      SessionCheckError,
      boundedSessionRequest: (operation) => operation(),
    },
    "@/lib/auth/session-service": {
      checkCurrentSession: async () => ({ kind: "ready", passwordRequired: false, mfaRequired }),
    },
    sonner: { toast: { error: (message) => errors.push(message), info() {}, success() {} } },
  };
  const code = ts.transpileModule(fs.readFileSync("src/routes/auth.tsx", "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    AbortController,
    require: (name) => dependencies[name] ?? {},
  });
  component();
  const cleanups = effects.map((effect) => effect());
  await new Promise((resolve) => setImmediate(resolve));
  cleanups.forEach((cleanup) => cleanup?.());
  return { navigations, updates, errors };
}

test("restored session resumes the second factor instead of opening an empty dashboard", async () => {
  const result = await mount({ mfaRequired: true });
  assert.equal(result.navigations.length, 0);
  assert.ok(result.updates.includes("synthetic-factor"));
});

test("MFA service failure never navigates to protected reports", async () => {
  const result = await mount({ mfaRequired: true, levelError: { message: "offline" } });
  assert.equal(result.navigations.length, 0);
  assert.equal(result.errors.length, 1);
});

test("fully verified restored session navigates normally", async () => {
  const result = await mount({ mfaRequired: false });
  assert.equal(result.navigations.length, 1);
  assert.equal(result.navigations[0].to, "/dashboard");
});

test("voluntarily enrolled MFA is still requested even without an admin policy", async () => {
  const result = await mount({ mfaRequired: false, needsFactor: true });
  assert.equal(result.navigations.length, 0);
  assert.ok(result.updates.includes("synthetic-factor"));
});
