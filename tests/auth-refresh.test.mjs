import test from "node:test";
import assert from "node:assert/strict";
import { createAuthRefreshCoordinator } from "../src/lib/auth/refresh-on-auth-change.ts";

test("reconfirmed sign-in does not refetch every report query", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let refreshes = 0;
  let clears = 0;
  const sync = createAuthRefreshCoordinator({ clear: () => clears++, refresh: () => refreshes++ });
  sync.handle("INITIAL_SESSION", "user-a");
  for (let i = 0; i < 1000; i++) sync.handle("SIGNED_IN", "user-a");
  t.mock.timers.tick(1);
  assert.equal(refreshes, 0);
  assert.equal(clears, 0);
  sync.dispose();
});

test("real login refreshes once after the auth callback, updates still refresh", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let refreshes = 0;
  const sync = createAuthRefreshCoordinator({ clear: () => {}, refresh: () => refreshes++ });
  sync.handle("INITIAL_SESSION", null);
  sync.handle("SIGNED_IN", "user-a");
  sync.handle("SIGNED_IN", "user-a");
  assert.equal(refreshes, 0);
  t.mock.timers.tick(1);
  assert.equal(refreshes, 1);
  sync.handle("USER_UPDATED", "user-a");
  t.mock.timers.tick(1);
  assert.equal(refreshes, 2);
  sync.dispose();
});

test("sign-out and account switches clear cached data immediately", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let clears = 0;
  let refreshes = 0;
  const sync = createAuthRefreshCoordinator({ clear: () => clears++, refresh: () => refreshes++ });
  sync.handle("INITIAL_SESSION", "user-a");
  sync.handle("SIGNED_IN", "user-b");
  assert.equal(clears, 1);
  sync.handle("SIGNED_OUT", null);
  assert.equal(clears, 2);
  t.mock.timers.tick(1);
  assert.equal(refreshes, 1);
  sync.dispose();
});

test("token refresh does not launch reads and cleanup cancels pending refresh", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let refreshes = 0;
  const sync = createAuthRefreshCoordinator({ clear: () => {}, refresh: () => refreshes++ });
  sync.handle("INITIAL_SESSION", "user-a");
  sync.handle("TOKEN_REFRESHED", "user-a");
  t.mock.timers.tick(1);
  assert.equal(refreshes, 0);
  sync.handle("USER_UPDATED", "user-a");
  sync.dispose();
  t.mock.timers.tick(1);
  assert.equal(refreshes, 0);
});
