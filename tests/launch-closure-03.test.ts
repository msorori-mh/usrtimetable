/**
 * LAUNCH-CLOSURE-03 — durable server-side availability correctness.
 *
 * Two kinds of test live here, and they are labelled so no reader mistakes one for the
 * other:
 *   A. BEHAVIOUR tests of the client error mapping (23P01 / 23505 -> Arabic).
 *   B. SOURCE ASSERTIONS on the prepared migration/preflight/rollback artifacts. These
 *      prove the shape of the SQL, NOT that it runs. Runtime proof comes from
 *      scripts/local-db/availability-temporal-integrity-proof.sh, which applies the
 *      migration to a disposable Postgres and exercises 40 cases including a real
 *      two-connection race.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  INVALID_DATE_RANGE_AR,
  INVALID_TIME_RANGE_AR,
  OVERLAP_CONFLICT_AR,
  WRITE_DENIED_AR,
  availabilityWriteMessage,
  isAmbiguousRpcError,
  isMissingRpcError,
  isOverlapConflictError,
} from "../src/lib/availability/errors";

/** Mirrors supabase-js `PostgrestError`: a real Error subclass carrying extra fields. */
class FakePostgrestError extends Error {
  code: string;
  details: string | null;
  hint: string | null;
  constructor(message: string, code: string, details: string | null = null, hint: string | null = null) {
    super(message);
    this.name = "PostgrestError";
    this.code = code;
    this.details = details;
    this.hint = hint;
  }
}

const MIGRATION = readFileSync(
  "docs/migrations-proposed/20260910T0025_availability_temporal_integrity_and_bulk_rpc.sql",
  "utf8",
);
const PREFLIGHT = readFileSync("docs/migrations-proposed/20260910T0025_preflight.sql", "utf8");
const ROLLBACK = readFileSync("docs/migrations-proposed/20260910T0025_rollback.sql", "utf8");
const REJECTED = readFileSync(
  "docs/migrations-proposed/20260910T0000_availability_bulk_rpc_and_overlap_integrity.sql",
  "utf8",
);
const PROOF = readFileSync("scripts/local-db/availability-temporal-integrity-proof.sh", "utf8");

describe("A. behaviour — Arabic mapping of durable integrity failures", () => {
  test("23P01 exclusion violation maps to the Arabic overlap message", () => {
    const err = new FakePostgrestError(
      'conflicting key value violates exclusion constraint "room_unavailability_no_overlap"',
      "23P01",
      "Key conflicts with existing key.",
    );
    expect(isOverlapConflictError(err)).toBe(true);
    const msg = availabilityWriteMessage(err);
    expect(msg.startsWith(OVERLAP_CONFLICT_AR)).toBe(true);
    // The raw server text is preserved for diagnosis.
    expect(msg).toContain("room_unavailability_no_overlap");
    expect(msg).not.toContain("[object Object]");
  });

  test("23505 unique violation maps to the same Arabic overlap message", () => {
    const err = new FakePostgrestError("availability_overlap: day=1", "23505");
    expect(isOverlapConflictError(err)).toBe(true);
    expect(availabilityWriteMessage(err).startsWith(OVERLAP_CONFLICT_AR)).toBe(true);
  });

  test("a plain-object rejection with exclusion text is still recognised", () => {
    const err = { message: "new row violates exclusion constraint", code: null };
    expect(isOverlapConflictError(err)).toBe(true);
  });

  test("an overlap conflict is never treated as a missing or ambiguous RPC", () => {
    const err = new FakePostgrestError("conflicting key value violates exclusion constraint", "23P01");
    expect(isMissingRpcError(err)).toBe(false);
    expect(isAmbiguousRpcError(err)).toBe(false);
  });

  test("invalid time and date ranges get their own Arabic messages", () => {
    const t = new FakePostgrestError("invalid_time_range: end_time must be after start_time", "22023");
    const d = new FakePostgrestError("invalid_date_range: end_date must not be before start_date", "22023");
    expect(availabilityWriteMessage(t).startsWith(INVALID_TIME_RANGE_AR)).toBe(true);
    expect(availabilityWriteMessage(d).startsWith(INVALID_DATE_RANGE_AR)).toBe(true);
  });

  test("a permission failure is reported as a denial, not as a conflict", () => {
    const err = new FakePostgrestError("college access denied", "42501");
    expect(isOverlapConflictError(err)).toBe(false);
    expect(availabilityWriteMessage(err).startsWith(WRITE_DENIED_AR)).toBe(true);
  });

  test("an unrelated error is passed through unchanged, never as an overlap", () => {
    const err = new FakePostgrestError("connection reset", "08006");
    expect(isOverlapConflictError(err)).toBe(false);
    expect(availabilityWriteMessage(err)).toContain("connection reset");
    expect(availabilityWriteMessage(err)).not.toContain(OVERLAP_CONFLICT_AR);
  });

  test("the save paths route write failures through the Arabic mapper", () => {
    const src = readFileSync("src/lib/availability/bulk-api.ts", "utf8");
    // both RPC error paths and both direct-insert paths
    const mapped = src.split("availabilityWriteMessage(").length - 1;
    expect(mapped).toBeGreaterThanOrEqual(4);
  });
});

describe("B. source assertions — the prepared migration artifacts", () => {
  test("D1: no `timerange` anywhere; time spans use built-in tsrange", () => {
    expect(MIGRATION).not.toContain("timerange(");
    expect(MIGRATION).toContain("RETURNS tsrange");
    expect(MIGRATION).toContain("'2000-01-01'::date + coalesce(p_end,   '24:00:00'::time)");
  });

  test("D2: the room validity window is compared with daterange overlap, not equality", () => {
    expect(MIGRATION).toContain("public._avail_date_span(start_date, end_date) WITH &&");
    expect(MIGRATION).not.toContain("coalesce(start_date, '-infinity'::date) WITH =");
  });

  test("D3: weekday is a range so NULL weekday overlaps a single weekday, and no partial unique index is used", () => {
    expect(MIGRATION).toContain("public._avail_day_span(day_of_week) WITH &&");
    expect(MIGRATION).toContain("int4range(0, 6, '[]')");
    expect(MIGRATION).not.toContain("CREATE UNIQUE INDEX");
  });

  test("D3: NULL times normalise to the whole day inside the constraint expression", () => {
    expect(MIGRATION).toContain("public._avail_time_span(start_time, end_time) WITH &&");
    expect(MIGRATION).toContain("coalesce(p_start, '00:00:00'::time)");
  });

  test("D4: the instructor constraint is partial to hard unavailability only", () => {
    expect(MIGRATION).toContain(
      "WHERE (availability_type = 'unavailable' AND is_preference = false)",
    );
  });

  test("no SECURITY DEFINER and no service-role/RLS bypass is introduced", () => {
    expect(MIGRATION).not.toContain("SECURITY DEFINER");
    expect(MIGRATION).toContain("SECURITY INVOKER");
    expect(MIGRATION).not.toContain("BYPASSRLS");
    expect(MIGRATION).not.toContain("service_role_key");
  });

  test("least privilege: EXECUTE revoked from PUBLIC/anon, granted to authenticated only", () => {
    for (const fn of [
      "upsert_instructor_unavailability_for_active_days",
      "upsert_room_unavailability_for_active_days",
    ]) {
      expect(MIGRATION).toContain(`REVOKE ALL ON FUNCTION public.${fn}`);
      expect(MIGRATION).toContain(`GRANT EXECUTE ON FUNCTION public.${fn}`);
    }
    expect(MIGRATION).toContain("FROM PUBLIC, anon");
  });

  test("college isolation and existing RLS are preserved, not rewritten", () => {
    expect(MIGRATION).toContain("can_manage_college");
    expect(MIGRATION).not.toContain("CREATE POLICY");
    expect(MIGRATION).not.toContain("DROP POLICY");
    expect(MIGRATION).not.toContain("DISABLE ROW LEVEL SECURITY");
    expect(MIGRATION).not.toMatch(/GRANT [^;]*ON (TABLE )?public\.(instructor_availability|room_unavailability)/);
  });

  test("a validation trigger covers every write path on room_unavailability", () => {
    expect(MIGRATION).toContain("CREATE TRIGGER trg_ru_validate_window");
    expect(MIGRATION).toContain("BEFORE INSERT OR UPDATE ON public.room_unavailability");
    expect(MIGRATION).toContain("invalid_time_range");
    expect(MIGRATION).toContain("invalid_date_range");
  });

  test("the migration destroys no data", () => {
    for (const forbidden of ["DROP TABLE", "TRUNCATE", "DELETE FROM", "DROP COLUMN", "DROP SCHEMA"]) {
      expect(MIGRATION).not.toContain(forbidden);
    }
  });

  test("re-applying the migration is safe (idempotent object creation)", () => {
    expect(MIGRATION).toContain("CREATE EXTENSION IF NOT EXISTS btree_gist");
    expect(MIGRATION).toContain("FROM pg_constraint");
    expect(MIGRATION).toContain("DROP TRIGGER IF EXISTS trg_ru_validate_window");
  });

  test("preflight checks for invalid rows, overlaps and name collisions", () => {
    expect(PREFLIGHT).toContain("P1 function signatures");
    expect(PREFLIGHT).toContain("P1b constraint name collision");
    expect(PREFLIGHT).toContain("P3 instructor overlaps");
    expect(PREFLIGHT).toContain("P4 room overlaps");
    // preflight must be read-only
    for (const forbidden of ["INSERT ", "UPDATE ", "DELETE ", "ALTER ", "CREATE ", "DROP "]) {
      expect(PREFLIGHT.includes(forbidden)).toBe(false);
    }
  });

  test("rollback removes every created object and deletes no data", () => {
    for (const obj of [
      "room_unavailability_no_overlap",
      "instructor_availability_no_overlap",
      "trg_ru_validate_window",
      "_avail_time_span",
      "_avail_day_span",
      "_avail_date_span",
      "upsert_room_unavailability_for_active_days",
      "upsert_instructor_unavailability_for_active_days",
    ]) {
      expect(ROLLBACK).toContain(obj);
    }
    for (const forbidden of ["DROP TABLE", "TRUNCATE", "DELETE FROM"]) {
      expect(ROLLBACK).not.toContain(forbidden);
    }
  });

  test("the rejected LAUNCH-CLOSURE-02 proposal is neutralised, not left runnable", () => {
    expect(REJECTED).toContain("SUPERSEDED / REJECTED IN REVIEW — DO NOT RUN");
    expect(REJECTED).not.toContain("ALTER TABLE public.instructor_availability");
    expect(REJECTED).not.toContain("EXCLUDE USING gist");
  });

  test("the proof harness is isolated from the project database and tests the race", () => {
    expect(PROOF).toContain("unset PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE");
    expect(PROOF).toContain("initdb");
    expect(PROOF).toContain("mkfifo");
    expect(PROOF).toContain("23P01");
    expect(PROOF).toContain("20260910T0025_rollback.sql");
    expect(PROOF).toContain("20260910T0025_preflight.sql");
  });
});
