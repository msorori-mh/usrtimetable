import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const HARDENING =
  "docs/migrations-proposed/20260910T0800_availability_helper_search_path_hardening.sql";
const PROBE = "scripts/local-db/btree-gist-relocation-probe.sql";
const PROOF = "scripts/local-db/availability-temporal-integrity-proof.sh";
const REPORT = "docs/LAUNCH-CLOSURE-SECURITY.md";

const read = (p: string) => readFileSync(p, "utf8");

describe("LAUNCH-CLOSURE-SECURITY hardening migration", () => {
  const sql = read(HARDENING);

  it("pins exactly the four availability helpers to pg_catalog", () => {
    const alters = sql.match(/^ALTER FUNCTION .*SET search_path = pg_catalog;$/gm) ?? [];
    expect(alters).toHaveLength(4);
    for (const fn of [
      "public._avail_time_span(time, time)",
      "public._avail_day_span(smallint)",
      "public._avail_date_span(date, date)",
      "public.validate_room_unavailability_window()",
    ]) {
      expect(sql).toContain(`ALTER FUNCTION ${fn} SET search_path = pg_catalog;`);
    }
  });

  it("does not include pg_temp in the pinned search_path", () => {
    expect(sql).not.toMatch(/search_path = pg_catalog, *pg_temp/);
  });

  it("uses ALTER FUNCTION only, never redefining the helpers", () => {
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION/);
    expect(sql).not.toMatch(/DROP FUNCTION/);
  });

  it("changes no grant, policy, table, row or role", () => {
    for (const forbidden of [
      /\bGRANT\b/,
      /\bREVOKE\b/,
      /CREATE POLICY/i,
      /DROP POLICY/i,
      /ALTER TABLE/i,
      /\bINSERT INTO\b/i,
      /\bUPDATE\b\s+public\./i,
      /\bDELETE FROM\b/i,
      /\bTRUNCATE\b/i,
      /CREATE ROLE/i,
    ]) {
      expect(sql).not.toMatch(forbidden);
    }
  });

  it("never relocates btree_gist as part of the applied migration", () => {
    expect(sql).not.toMatch(/ALTER EXTENSION/);
  });

  it("self-verifies pinning, immutability and the exclusion constraints", () => {
    expect(sql).toContain("search_path hardening incomplete");
    expect(sql).toContain("span helper lost IMMUTABLE volatility");
    expect(sql).toContain("availability exclusion constraints");
    expect(sql).toMatch(/^BEGIN;$/m);
    expect(sql.trim().endsWith("COMMIT;")).toBe(true);
  });
});

describe("btree_gist relocation probe", () => {
  const sql = read(PROBE);

  it("relocates and then reverts, so it leaves no lasting change", () => {
    expect(sql).toContain("ALTER EXTENSION btree_gist SET SCHEMA extensions");
    expect(sql).toContain("ALTER EXTENSION btree_gist SET SCHEMA public");
  });

  it("asserts existing exclusion constraints survive relocation", () => {
    expect(sql).toContain("relocation dropped an exclusion constraint");
    expect(sql).toContain("instructor_availability_no_overlap");
    expect(sql).toContain("room_unavailability_no_overlap");
  });

  it("also probes forward compatibility of new GiST exclusion DDL", () => {
    expect(sql).toMatch(/EXCLUDE USING gist/);
    expect(sql).toContain("new_ddl_ok");
  });
});

describe("proof harness hooks", () => {
  const sh = read(PROOF);

  it("applies extra SQL before the behaviour cases, and checks idempotency", () => {
    expect(sh).toContain("AVAIL_PROOF_EXTRA_SQL");
    expect(sh).toContain("extra SQL applied and is idempotent");
    expect(sh.indexOf("AVAIL_PROOF_EXTRA_SQL")).toBeLessThan(sh.indexOf("== behaviour cases"));
  });

  it("asserts pinning, immutability and SECURITY INVOKER after the extra SQL", () => {
    expect(sh).toContain("CASE 8.1 four helpers pinned to search_path=pg_catalog => PASS");
    expect(sh).toContain("CASE 8.2 span helpers remain IMMUTABLE (index-safe) => PASS");
    expect(sh).toContain("CASE 8.3 helpers remain SECURITY INVOKER => PASS");
    expect(sh).toContain("CASE 8.4 probe reverted btree_gist to public => PASS");
  });

  it("still refuses to touch the project database", () => {
    expect(sh).toContain("unset PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE");
  });
});

describe("security report", () => {
  const md = read(REPORT);

  it("records the exact applied migration version and tracked file", () => {
    expect(md).toContain("20260910075951");
    expect(md).toContain(
      "supabase/migrations/20260910075951_851a8f41-edfa-44c7-8054-1bde02522935.sql",
    );
  });

  it("records the pre/post row, policy and fingerprint evidence", () => {
    expect(md).toContain("6816e8d9bff53ae162016e3b75fdb117");
    expect(md).toMatch(/`instructor_availability` rows\s*\|\s*0\s*\|\s*0\s*\|/);
    expect(md).toMatch(/`room_unavailability` rows\s*\|\s*1\s*\|\s*1\s*\|/);
    expect(md).toMatch(/Availability \+ audit policies\s*\|\s*10\s*\|\s*10\s*\|/);
  });

  it("states the audited definer population and that no grant was revoked", () => {
    expect(md).toContain("**81**");
    expect(md).toContain("**40**");
    expect(md).toContain("no EXECUTE\ngrant was revoked");
  });

  it("keeps btree_gist relocation as a documented, unapplied residual", () => {
    expect(md).toContain("accepted documented residual");
  });

  it("does not claim a frontend deployment", () => {
    expect(md).toContain("**Not performed**");
  });
});
