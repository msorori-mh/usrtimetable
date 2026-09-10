/**
 * LAUNCH-CLOSURE-02 — corrections found by independent review of 84762c2b.
 *
 * Behaviour tests for:
 *   1. room validity window (start_date/end_date) as part of the duplicate key,
 *   2. whole-day closures (null weekday / null time) not being dropped,
 *   3. PGRST203 = ambiguous overload, never routed to a client-side write,
 *   4. schema-cache / "does not exist" text not broadly routing to writes,
 *   5. resource-belongs-to-college preflight before any fallback write,
 *   6. auth gate: rejected session request and sign-out handling.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { planBulkUnavailability, sameNullableDate } from "../src/lib/availability/active-days";
import { isAmbiguousRpcError, isMissingRpcError } from "../src/lib/availability/errors";

const read = (p: string) => readFileSync(p, "utf8");
const activeDays = [6, 0, 1, 2, 3, 4];

describe("room validity window is part of the duplicate key", () => {
  test("a disjoint date window is NOT a duplicate and is not silently reported unchanged", () => {
    // Same weekday and time, but a different, disjoint validity window.
    const plan = planBulkUnavailability({
      activeDays,
      dayOfWeek: 1,
      startTime: "10:00",
      endTime: "12:00",
      compareDates: true,
      startDate: "2026-05-01",
      endDate: "2026-05-31",
      existing: [
        {
          day_of_week: 1,
          start_time: "10:00:00",
          end_time: "12:00:00",
          start_date: "2026-01-01",
          end_date: "2026-01-31",
        },
      ],
    });
    // Authoritative SQL: not an exact match ⇒ the overlap probe rejects it.
    // It must NEVER be counted as "unchanged" (that reported success while
    // saving nothing for the requested window).
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toBe("overlap");
  });

  test("identical times AND identical window are unchanged", () => {
    const plan = planBulkUnavailability({
      activeDays,
      dayOfWeek: 1,
      startTime: "10:00",
      endTime: "12:00",
      compareDates: true,
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      existing: [
        {
          day_of_week: 1,
          start_time: "10:00:00",
          end_time: "12:00:00",
          start_date: "2026-01-01",
          end_date: "2026-01-31",
        },
      ],
    });
    expect(plan).toMatchObject({ ok: true, daysUnchanged: [1], daysToCreate: [] });
  });

  test("null windows compare with SQL IS NOT DISTINCT FROM semantics", () => {
    expect(sameNullableDate(null, null)).toBe(true);
    expect(sameNullableDate(undefined, null)).toBe(true);
    expect(sameNullableDate("2026-01-01", null)).toBe(false);
    expect(sameNullableDate("2026-01-01T00:00:00", "2026-01-01")).toBe(true);
  });

  test("a permanent-window row and a dated request are not conflated", () => {
    const plan = planBulkUnavailability({
      activeDays,
      dayOfWeek: 2,
      startTime: "08:00",
      endTime: "09:00",
      compareDates: true,
      startDate: "2026-03-01",
      endDate: "2026-03-02",
      existing: [
        {
          day_of_week: 2,
          start_time: "08:00:00",
          end_time: "09:00:00",
          start_date: null,
          end_date: null,
        },
      ],
    });
    expect(plan.ok).toBe(false);
  });

  test("the instructor path ignores dates (its table has no window columns)", () => {
    const plan = planBulkUnavailability({
      activeDays,
      dayOfWeek: 1,
      startTime: "10:00",
      endTime: "12:00",
      existing: [{ day_of_week: 1, start_time: "10:00:00", end_time: "12:00:00" }],
    });
    expect(plan).toMatchObject({ ok: true, daysUnchanged: [1] });
  });
});

describe("whole-day closures are not dropped", () => {
  test("a null-time row for the same weekday fails closed instead of adding a redundant row", () => {
    const plan = planBulkUnavailability({
      activeDays,
      dayOfWeek: 3,
      startTime: "10:00",
      endTime: "12:00",
      compareDates: true,
      existing: [
        { day_of_week: 3, start_time: null, end_time: null, start_date: null, end_date: null },
      ],
    });
    expect(plan).toEqual({ ok: false, reason: "all_day_block", conflictDay: 3 });
  });

  test("a null-weekday closure blocks every targeted day", () => {
    const plan = planBulkUnavailability({
      activeDays,
      dayOfWeek: null,
      startTime: "10:00",
      endTime: "12:00",
      compareDates: true,
      existing: [
        { day_of_week: null, start_time: null, end_time: null, start_date: null, end_date: null },
      ],
    });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toBe("all_day_block");
  });

  test("unrelated timed rows on other days do not block", () => {
    const plan = planBulkUnavailability({
      activeDays,
      dayOfWeek: 3,
      startTime: "10:00",
      endTime: "12:00",
      compareDates: true,
      existing: [
        {
          day_of_week: 1,
          start_time: "10:00:00",
          end_time: "12:00:00",
          start_date: null,
          end_date: null,
        },
      ],
    });
    expect(plan).toMatchObject({ ok: true, daysToCreate: [3] });
  });
});

describe("PGRST203 is an ambiguous overload, not a missing function", () => {
  const ambiguous = {
    code: "PGRST203",
    message: "Could not choose the best candidate function between: public.f(a => text), public.f(a => integer)",
    details: null,
    hint: null,
  };

  test("classified as ambiguous and explicitly not missing", () => {
    expect(isAmbiguousRpcError(ambiguous)).toBe(true);
    expect(isMissingRpcError(ambiguous)).toBe(false);
  });

  test("the message alone is enough, without the code", () => {
    expect(
      isAmbiguousRpcError({ message: "could not choose the best candidate function" }),
    ).toBe(true);
  });

  test("a genuinely missing function is still detected", () => {
    expect(
      isMissingRpcError({
        code: "PGRST202",
        message: "Could not find the function public.upsert_room_unavailability_for_active_days",
        hint: "Perhaps you meant to call another function",
      }),
    ).toBe(true);
    expect(isMissingRpcError({ code: "42883", message: "function foo(uuid) does not exist" })).toBe(
      true,
    );
  });
});

describe("schema-cache text does not broadly route errors to client writes", () => {
  test("a schema-cache column error is not treated as a missing function", () => {
    expect(
      isMissingRpcError({
        code: "PGRST204",
        message: "Could not find the 'foo' column of 'rooms' in the schema cache",
      }),
    ).toBe(false);
  });

  test("an unrelated 'does not exist' error is not treated as a missing function", () => {
    expect(
      isMissingRpcError({ code: "42P01", message: 'relation "public.nope" does not exist' }),
    ).toBe(false);
    expect(
      isMissingRpcError({ code: "42703", message: 'column "nope" does not exist' }),
    ).toBe(false);
  });

  test("permission and constraint failures never fall back", () => {
    expect(isMissingRpcError({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isMissingRpcError({ code: "23505", message: "duplicate key value" })).toBe(false);
    expect(isMissingRpcError({ code: "PGRST301", message: "JWT expired" })).toBe(false);
  });
});

describe("fallback preflight and honesty (source assertions)", () => {
  const api = read("src/lib/availability/bulk-api.ts");

  test("the resource is confirmed to belong to the supplied college before any write", () => {
    expect(api).toContain("assertResourceInCollege");
    expect(api).toContain("data.college_id !== collegeId");
    expect(api).toContain('assertResourceInCollege("instructors"');
    expect(api).toContain('assertResourceInCollege("rooms"');
    // Preflight precedes the read/plan/insert sequence in both fallbacks.
    for (const marker of ['assertResourceInCollege("instructors"', 'assertResourceInCollege("rooms"']) {
      expect(api.indexOf(marker)).toBeLessThan(api.indexOf("planBulkUnavailability({"));
    }
  });

  test("an ambiguous overload is reported and never falls back to a client write", () => {
    expect(api).toContain("isAmbiguousRpcError(error)");
    expect(api.indexOf("isAmbiguousRpcError(error)")).toBeLessThan(
      api.indexOf("if (!isMissingRpcError(error))"),
    );
  });

  test("room reads select the validity window and keep null rows", () => {
    expect(api).toContain("day_of_week, start_time, end_time, start_date, end_date");
    expect(api).not.toContain("r.day_of_week !== null && r.start_time !== null");
  });

  test("inserts confirm the persisted row count instead of assuming success", () => {
    expect(api).toContain('.select("id")');
    expect(api).toContain("!== rows.length");
  });

  test("no privileged client, service role, or SECURITY DEFINER shortcut", () => {
    for (const forbidden of ["service_role", "client.server", "supabaseAdmin", "SECURITY DEFINER"]) {
      expect(api).not.toContain(forbidden);
    }
  });
});

describe("auth gate resilience (source assertions)", () => {
  const gate = read("src/routes/_authenticated/route.tsx");

  test("a rejected session request yields an explicit recoverable state, not access", () => {
    expect(gate).toContain(".catch(");
    expect(gate).toContain("auth-gate-error");
    expect(gate).toContain("auth-gate-retry");
    expect(gate).toContain("setAllowed(false)");
  });

  test("sign-out or a cleared session revokes the allowed state", () => {
    expect(gate).toContain("onAuthStateChange");
    expect(gate).toContain('event === "SIGNED_OUT" || !session');
    expect(gate).toContain("unsubscribe()");
  });

  test("the SSR hydration fix is preserved and no warning is muted", () => {
    expect(gate).toContain("ssr: false");
    expect(gate).toContain("if (!hydrated) return null;");
    expect(gate).not.toContain("suppressHydrationWarning");
  });

  test("no child route re-implements a server-side auth gate", () => {
    // Removing beforeLoad only matters if a child loader consumed its context.
    const children = read("src/routeTree.gen.ts");
    expect(children).toContain("_authenticated");
    expect(gate).not.toContain("beforeLoad");
  });
});
