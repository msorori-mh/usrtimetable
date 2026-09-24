const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

function load(path, dependencies) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: (name) => {
      if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  });
  return module.exports;
}
const workflow = load("src/lib/instructors/faculty-workflow.ts", {
  "@/integrations/supabase/client": { supabase: {} },
});
const policy = load("src/lib/instructors/college-correction.ts", {
  "./faculty-workflow": workflow,
});
const college = (id, university = "u") => ({ id, name: id, code: id, university_id: university });
const colleges = [college("A"), college("B"), college("foreign", "other")];
const profile = () => ({
  identity_id: "identity",
  university_number: "U-P-100",
  name: "Fixture lecturer",
  home_college_id: "A",
  home_college: "A",
  source_instructor_id: "source",
  decision_at: "2026-09-24T01:00:00Z",
  members: [
    {
      id: "source",
      college_id: "A",
      name: "Fixture lecturer",
      college: "A",
      recorded_quota: 12,
      recorded_release: 2,
    },
    {
      id: "alias",
      college_id: "B",
      name: "Fixture alias",
      college: "B",
      recorded_quota: 18,
      recorded_release: 0,
    },
  ],
});
const payloadInput = () => ({
  canCorrect: true,
  instructorId: "alias",
  profile: profile(),
  colleges,
  targetCollegeId: "B",
  evidence: "Correction of mistaken registration college",
  quotaConfirmed: false,
  confirmed: true,
});
const plain = (value) => JSON.parse(JSON.stringify(value));

test("correction retains the canonical source and decision token and never assumes quota approval", () => {
  const input = payloadInput();
  const payload = policy.collegeCorrectionPayload(input);
  assert.deepEqual(plain(payload), {
    p_identity_id: "identity",
    p_home_college_id: "B",
    p_source_instructor_id: "source",
    p_quota_confirmed: false,
    p_evidence: input.evidence,
    p_expected_decision_at: input.profile.decision_at,
  });
  assert.deepEqual(
    plain(policy.collegeCorrectionTargets(input.profile, colleges)).map((c) => c.id),
    ["B"],
  );
  assert.equal(
    policy.collegeCorrectionPayload({ ...input, quotaConfirmed: true }).p_quota_confirmed,
    true,
  );
});

test("invalid scope, identity, destination, source, evidence and missing approval fail closed", () => {
  for (const override of [
    { canCorrect: false },
    { instructorId: "unrelated" },
    { targetCollegeId: "A" },
    { targetCollegeId: "foreign" },
    { targetCollegeId: "missing" },
    { confirmed: false },
    { evidence: "short" },
    { colleges: [] },
    { profile: { ...profile(), source_instructor_id: "unrelated" } },
    {
      profile: {
        ...profile(),
        members: [{ ...profile().members[0], recorded_quota: null }, profile().members[1]],
      },
      quotaConfirmed: true,
    },
  ])
    assert.throws(() => policy.collegeCorrectionPayload({ ...payloadInput(), ...override }));
});

function text(node) {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (!node) return "";
  if (Array.isArray(node)) return node.map(text).join(" ");
  return text(node.props?.children);
}
function find(node, predicate) {
  if (!node || typeof node !== "object") return null;
  if (predicate(node)) return node;
  for (const child of [node.props?.children].flat(Infinity)) {
    const result = find(child, predicate);
    if (result) return result;
  }
  return null;
}
function harness() {
  const state = [],
    calls = [],
    notices = [],
    busy = [];
  let cursor = 0,
    mutationOptions,
    pending = Promise.resolve(),
    invalidations = 0,
    closed = 0;
  const user = { data: { isSuperAdmin: true } };
  const homes = {
    data: [profile()],
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: () => {
      homes.error = null;
    },
  };
  const collegeQuery = {
    data: colleges,
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: () => {
      collegeQuery.error = null;
    },
  };
  const mutation = {
    isPending: false,
    mutate: () => {
      mutation.isPending = true;
      pending = (async () => {
        mutationOptions.onMutate?.();
        try {
          await mutationOptions.mutationFn();
          mutationOptions.onSuccess?.();
        } catch (error) {
          mutationOptions.onError?.(error);
        } finally {
          mutation.isPending = false;
          mutationOptions.onSettled?.();
        }
      })();
    },
  };
  let rpcError = null;
  const jsx = (type, props) => ({ type, props });
  const component = load("src/components/faculty-college-transfer.tsx", {
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
    },
    "@tanstack/react-query": {
      useQuery: () => homes,
      useQueryClient: () => ({
        invalidateQueries: () => {
          invalidations++;
        },
      }),
      useMutation: (options) => {
        mutationOptions = options;
        return mutation;
      },
    },
    "@/hooks/use-current-user": { useCurrentUser: () => user },
    "@/hooks/use-colleges": { useAccessibleColleges: () => collegeQuery },
    "@/lib/instructors/faculty-workflow": {
      ...workflow,
      facultyWorkflow: {
        rpc: async (name, args) => {
          calls.push({ name, args });
          return { error: rpcError };
        },
      },
    },
    "@/lib/instructors/college-correction": policy,
    "@/components/ui/button": { Button: "button" },
    sonner: { toast: { success: (message) => notices.push(message) } },
  }).FacultyCollegeTransfer;
  const render = () => {
    cursor = 0;
    return component({
      instructorId: "alias",
      collegeId: "B",
      onTransferred: () => closed++,
      onBusyChange: (value) => busy.push(value),
    });
  };
  const button = () =>
    find(render(), (n) => n.type === "button" && /تأكيد نقل|جارٍ نقل/.test(text(n)));
  const field = (label) => find(render(), (n) => n.props?.["aria-label"] === label);
  const confirmation = () =>
    find(
      find(render(), (n) => n.type === "label" && text(n).includes("راجعت البيانات")),
      (n) => n.type === "input",
    );
  const fill = () => {
    field("الكلية الصحيحة للمحاضر").props.onChange({ target: { value: "B" } });
    field("سبب تصحيح كلية المحاضر").props.onChange({
      target: { value: "Correction of mistaken registration college" },
    });
    confirmation().props.onChange({ target: { checked: true } });
  };
  return {
    render,
    button,
    field,
    confirmation,
    fill,
    homes,
    collegeQuery,
    user,
    calls,
    notices,
    busy,
    mutation,
    flush: () => pending,
    failWith: (error) => (rpcError = error),
    invalidations: () => invalidations,
    closed: () => closed,
  };
}

test("UI requires review and submits the existing audited operation only once", async () => {
  const app = harness();
  assert.equal(app.button().props.disabled, true);
  app.button().props.onClick();
  await app.flush();
  assert.equal(app.calls.length, 0);
  app.fill();
  assert.equal(app.button().props.disabled, false);
  assert.match(text(app.render()).replace(/\s+/g, " "), /النقل من A إلى B/);
  app.button().props.onClick();
  assert.equal(app.button().props.disabled, true);
  app.button().props.onClick();
  await app.flush();
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0].name, "reconcile_faculty_home");
  assert.equal(app.calls[0].args.p_source_instructor_id, "source");
  assert.equal(app.calls[0].args.p_quota_confirmed, false);
  assert.equal(app.invalidations(), 1);
  assert.equal(app.closed(), 1);
  assert.deepEqual(app.busy, [true, false]);
});

test("UI requires new confirmation when destination, reason or saved decision changes", () => {
  for (const change of [
    (app) => app.field("الكلية الصحيحة للمحاضر").props.onChange({ target: { value: "" } }),
    (app) =>
      app
        .field("سبب تصحيح كلية المحاضر")
        .props.onChange({ target: { value: "Different correction reason" } }),
    (app) => (app.homes.data[0].decision_at = "2026-09-24T02:00:00Z"),
    (app) => (app.homes.data[0].members[0].recorded_quota = 15),
  ]) {
    const app = harness();
    app.fill();
    change(app);
    assert.equal(app.confirmation().props.checked, false);
    assert.equal(app.button().props.disabled, true);
  }
});

test("UI blocks stale/error reads and hides correction from non-admin roles", () => {
  const app = harness();
  app.fill();
  app.homes.isFetching = true;
  assert.equal(app.button().props.disabled, true);
  app.homes.isFetching = false;
  app.homes.error = new Error("offline");
  assert.equal(app.button(), null);
  assert.match(text(app.render()), /تعذر التحقق/);
  app.homes.error = null;
  app.collegeQuery.error = new Error("offline");
  assert.equal(app.button(), null);
  app.collegeQuery.error = null;
  app.homes.data = [];
  assert.equal(app.button(), null);
  app.user.data.isSuperAdmin = false;
  assert.equal(app.render(), null);
});

test("stale decision failure keeps user inputs, cancels confirmation, and does not claim success", async () => {
  const app = harness();
  app.fill();
  app.failWith({ message: "STALE_FACULTY_DECISION" });
  app.button().props.onClick();
  await app.flush();
  assert.equal(app.closed(), 0);
  assert.equal(app.notices.length, 0);
  assert.equal(app.invalidations(), 0);
  assert.equal(app.field("الكلية الصحيحة للمحاضر").props.value, "B");
  assert.match(text(app.render()), /تغيّرت بيانات التسوية/);
  assert.equal(app.confirmation().props.checked, false);
});
