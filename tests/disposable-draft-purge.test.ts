import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertDisposablePurgeEligibility,
  canMarkDisposableTestClone,
  PROTECTED_ACCEPTED_SCHEDULE_VERSION_ID,
  PURGE_RPC_NAME,
} from "../src/lib/schedule-versions/disposable-purge";

const migration = readFileSync(
  join(
    import.meta.dir,
    "../supabase/migrations/20260730120000_source_only_disposable_draft_purge.sql",
  ),
  "utf8",
);

describe("disposable draft purge contract", () => {
  test("allows explicitly marked disposable draft", () => {
    expect(
      assertDisposablePurgeEligibility({
        versionId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        status: "draft",
        disposableTest: true,
      }),
    ).toEqual({ ok: true });
  });

  test("rejects unmarked draft", () => {
    expect(
      assertDisposablePurgeEligibility({
        versionId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        status: "draft",
        disposableTest: false,
      }),
    ).toEqual({ ok: false, reason: "PURGE_NOT_DISPOSABLE" });
  });

  test("rejects approved published and archived", () => {
    for (const status of ["approved", "published", "archived", "review"] as const) {
      expect(
        assertDisposablePurgeEligibility({
          versionId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          status,
          disposableTest: true,
        }).ok,
      ).toBe(false);
    }
  });

  test("always rejects protected accepted version", () => {
    expect(
      assertDisposablePurgeEligibility({
        versionId: PROTECTED_ACCEPTED_SCHEDULE_VERSION_ID,
        status: "draft",
        disposableTest: true,
      }),
    ).toEqual({ ok: false, reason: "PURGE_PROTECTED_VERSION" });
  });

  test("only super_admin may mark disposable clones", () => {
    expect(canMarkDisposableTestClone(true)).toBe(true);
    expect(canMarkDisposableTestClone(false)).toBe(false);
  });

  test("SQL RPC rejects college_admin read_only anon and public execute", () => {
    expect(migration).toContain("PURGE_SUPER_ADMIN_REQUIRED");
    expect(migration).toContain("AUTHENTICATION_REQUIRED");
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.purge_disposable_draft_schedule_version(uuid)",
    );
    expect(migration).toContain("FROM PUBLIC, anon, authenticated");
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.purge_disposable_draft_schedule_version\(uuid\)\s+TO authenticated/,
    );
    expect(migration).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.purge_disposable_draft_schedule_version\(uuid\)\s+TO anon/,
    );
    expect(migration).toContain("is_super_admin(v_actor)");
  });

  test("SQL purge deletes dependents scoped to version and rolls back on orphan/cross-college", () => {
    expect(migration).toContain("PURGE_CROSS_COLLEGE_DEPENDENT");
    expect(migration).toContain("PURGE_ORPHAN_ROWS_REMAIN");
    expect(migration).toContain("already_absent");
    expect(migration).toContain("DELETE FROM public.schedule_sessions");
    expect(migration).toContain("DELETE FROM public.schedule_quality_runs");
    expect(migration).toContain("DELETE FROM public.schedule_versions");
    expect(migration).toContain("college_id = v_college_id");
    expect(migration).toContain("id <> v_protected");
    expect(migration).toContain(PROTECTED_ACCEPTED_SCHEDULE_VERSION_ID);
    expect(migration).toContain(`CREATE OR REPLACE FUNCTION public.${PURGE_RPC_NAME}`);
    expect(migration).toContain("SET search_path = public, pg_temp");
  });

  test("SQL does not auto-mark all clones disposable", () => {
    expect(migration).toContain("DEFAULT false");
    expect(migration).toContain("DISPOSABLE_TEST_SUPER_ADMIN_REQUIRED");
  });
});
