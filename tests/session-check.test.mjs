import test from "node:test";
import assert from "node:assert/strict";
import { checkAuthenticatedSession, SessionCheckError } from "../src/lib/auth/check-session.ts";

const identity = { data: { user: { id: "synthetic-user" } }, error: null };
const services = (password = false) => ({
  getUser: async () => identity,
  accessStatus: async () => ({
    data: { session_valid: true, password_required: password, mfa_required: false },
    error: null,
    status: 200,
  }),
});
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("MFA remains required for a valid aal1 session and revoked sessions stay signed out", async () => {
  for (const valid of [true, false]) {
    const result = await checkAuthenticatedSession(
      {
        ...services(),
        accessStatus: async () => ({
          data: {
            session_valid: valid,
            password_required: false,
            mfa_required: true,
          },
          error: null,
        }),
      },
      new AbortController().signal,
    );
    assert.deepEqual(
      result,
      valid
        ? { kind: "ready", passwordRequired: false, mfaRequired: true }
        : { kind: "signed-out" },
    );
  }
});

test("access requires a remote identity and an complete boolean access status", async () => {
  for (const password of [true, false]) {
    assert.deepEqual(
      await checkAuthenticatedSession(services(password), new AbortController().signal),
      { kind: "ready", passwordRequired: password, mfaRequired: false },
    );
  }
  for (const value of [null, undefined, "false", 0, {}]) {
    await assert.rejects(
      checkAuthenticatedSession(
        { ...services(), accessStatus: async () => ({ data: value, error: null }) },
        new AbortController().signal,
      ),
      /INVALID_RESPONSE/,
    );
  }
});

test("missing or expired identities never request the password RPC", async () => {
  for (const result of [
    { data: { user: null }, error: null },
    { data: { user: null }, error: { status: 401 } },
    { data: { user: null }, error: { name: "AuthSessionMissingError", status: 400 } },
  ]) {
    assert.deepEqual(
      await checkAuthenticatedSession(
        {
          getUser: async () => result,
          accessStatus: () => assert.fail("Unexpected password RPC"),
        },
        new AbortController().signal,
      ),
      { kind: "signed-out" },
    );
  }
});

test("identity service failures stay retryable, without redirect or private error text", async () => {
  await assert.rejects(
    checkAuthenticatedSession(
      {
        ...services(),
        getUser: async () => ({
          data: { user: null },
          error: { status: 503, message: "PRIVATE TOKEN" },
        }),
      },
      new AbortController().signal,
    ),
    (error) => {
      assert.ok(error instanceof SessionCheckError);
      assert.match(error.message, /HTTP 503/);
      assert.doesNotMatch(error.message, /PRIVATE/);
      return true;
    },
  );
});

test("RPC failures retain only safe diagnostic codes and deny access", async () => {
  await assert.rejects(
    checkAuthenticatedSession(
      {
        ...services(),
        accessStatus: async () => ({
          data: false,
          status: 500,
          error: { code: "54001", message: "PRIVATE", details: "PRIVATE" },
        }),
      },
      new AbortController().signal,
    ),
    (error) => {
      assert.match(error.message, /54001.*HTTP 500/);
      assert.doesNotMatch(error.message, /PRIVATE/);
      return true;
    },
  );
});

test("stalled identity times out; a late response cannot proceed to the RPC", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let resolveIdentity;
  const pending = checkAuthenticatedSession(
    {
      getUser: () =>
        new Promise((resolve) => {
          resolveIdentity = resolve;
        }),
      accessStatus: () => assert.fail("Late identity must not proceed"),
    },
    new AbortController().signal,
    100,
  );
  const rejected = assert.rejects(pending, /التحقق من الهوية.*TIMEOUT/);
  await tick();
  t.mock.timers.tick(100);
  await rejected;
  resolveIdentity(identity);
  await tick();
});

test("stalled password check times out and aborts its request", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let requestSignal;
  let resolveRequirement;
  const pending = checkAuthenticatedSession(
    {
      ...services(),
      accessStatus: (signal) => {
        requestSignal = signal;
        return new Promise((resolve) => {
          resolveRequirement = resolve;
        });
      },
    },
    new AbortController().signal,
    100,
  );
  const rejected = assert.rejects(pending, /متطلبات الدخول.*TIMEOUT/);
  await tick();
  t.mock.timers.tick(100);
  await rejected;
  assert.equal(requestSignal.aborted, true);
  resolveRequirement({ data: false, error: null });
  await tick();
});

test("sign-out or unmount cancels an in-flight password check", async () => {
  const controller = new AbortController();
  let requestSignal;
  const pending = checkAuthenticatedSession(
    {
      ...services(),
      accessStatus: (signal) => {
        requestSignal = signal;
        return new Promise(() => {});
      },
    },
    controller.signal,
  );
  const rejected = assert.rejects(pending, /أُلغي/);
  await tick();
  controller.abort();
  await rejected;
  assert.equal(requestSignal.aborted, true);
});

test("a rejected service call is sanitized and a subsequent retry can succeed", async () => {
  await assert.rejects(
    checkAuthenticatedSession(
      {
        ...services(),
        getUser: () => {
          throw new Error("PRIVATE NETWORK MESSAGE");
        },
      },
      new AbortController().signal,
    ),
    (error) => {
      assert.doesNotMatch(error.message, /PRIVATE/);
      return true;
    },
  );
  assert.deepEqual(await checkAuthenticatedSession(services(), new AbortController().signal), {
    kind: "ready",
    passwordRequired: false,
    mfaRequired: false,
  });
});
