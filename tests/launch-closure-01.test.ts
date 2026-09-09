import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  isMissingRpcError,
  normalizeWriteError,
  readableWriteError,
} from "../src/lib/availability/errors";
import { planBulkUnavailability } from "../src/lib/availability/active-days";

const root = resolve(import.meta.dir, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("LAUNCH-CLOSURE-01 gap 1 — availability write error normalization", () => {
  // PostgrestError subclasses Error, but printing only `.message` drops `hint`/`details`,
  // where PostgREST puts the actionable cause. A bare object must also stay readable.
  test("a PostgREST-shaped rejection keeps code/hint/details and never renders as [object Object]", () => {
    const postgrest = {
      message:
        "Could not find the function public.upsert_instructor_unavailability_for_active_days",
      code: "PGRST202",
      details: "Searched for the function in the schema cache",
      hint: null,
    };
    const readable = readableWriteError(postgrest);
    expect(readable).not.toContain("[object Object]");
    expect(readable).toContain("Could not find the function");
    expect(normalizeWriteError(postgrest).code).toBe("PGRST202");
  });

  test("shapes with no known keys still avoid [object Object]", () => {
    for (const value of [{}, { weird: 1 }, [], null, undefined, 0]) {
      expect(readableWriteError(value)).not.toContain("[object Object]");
      expect(readableWriteError(value).length).toBeGreaterThan(0);
    }
  });

  test("Error instances keep their message and code", () => {
    const e = Object.assign(new Error("boom"), { code: "42501" });
    expect(normalizeWriteError(e)).toMatchObject({ message: "boom", code: "42501" });
  });

  test("missing-RPC detection matches PostgREST codes and messages only", () => {
    expect(isMissingRpcError({ code: "PGRST202", message: "x" })).toBe(true);
    expect(isMissingRpcError({ code: "PGRST203", message: "x" })).toBe(true);
    expect(isMissingRpcError({ code: "42883", message: "x" })).toBe(true);
    expect(isMissingRpcError({ message: "Could not find the function foo" })).toBe(true);
    // A permission denial must NOT be mistaken for a missing function, otherwise
    // the fallback would mask an RLS rejection.
    expect(isMissingRpcError({ code: "42501", message: "permission denied for table x" })).toBe(
      false,
    );
    expect(isMissingRpcError({ code: "23505", message: "duplicate key value" })).toBe(false);
  });
});

describe("LAUNCH-CLOSURE-01 gap 1 — bulk plan is all-or-nothing", () => {
  const activeDays = [6, 0, 1, 2, 3, 4];

  test("all active days with no existing rows creates one row per working day", () => {
    const plan = planBulkUnavailability({
      activeDays,
      dayOfWeek: null,
      startTime: "10:00",
      endTime: "12:00",
      existing: [],
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.daysToCreate).toEqual(activeDays);
    expect(plan.daysUnchanged).toEqual([]);
    expect(plan.daysTargeted).toEqual(activeDays);
    expect(plan.daysToCreate).not.toContain(5); // Friday is never targeted
  });

  test("an identical existing window is unchanged, not duplicated", () => {
    const plan = planBulkUnavailability({
      activeDays,
      dayOfWeek: null,
      startTime: "10:00",
      endTime: "12:00",
      existing: [{ day_of_week: 1, start_time: "10:00:00", end_time: "12:00:00" }],
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.daysUnchanged).toEqual([1]);
    expect(plan.daysToCreate).not.toContain(1);
    expect(plan.daysToCreate.length).toBe(activeDays.length - 1);
  });

  test("one overlapping day rejects the whole request (no partial write)", () => {
    const plan = planBulkUnavailability({
      activeDays,
      dayOfWeek: null,
      startTime: "10:00",
      endTime: "12:00",
      existing: [{ day_of_week: 2, start_time: "11:00:00", end_time: "13:00:00" }],
    });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toBe("overlap");
    expect(plan).toMatchObject({ conflictDay: 2 });
  });

  test("invalid time range is rejected before any day is planned", () => {
    const plan = planBulkUnavailability({
      activeDays,
      dayOfWeek: null,
      startTime: "12:00",
      endTime: "10:00",
      existing: [],
    });
    expect(plan).toEqual({ ok: false, reason: "invalid_time" });
  });

  test("a single explicit day targets only that day", () => {
    const plan = planBulkUnavailability({
      activeDays,
      dayOfWeek: 3,
      startTime: "08:00",
      endTime: "09:00",
      existing: [],
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.daysTargeted).toEqual([3]);
    expect(plan.daysToCreate).toEqual([3]);
  });

  test("an out-of-range explicit day is rejected", () => {
    expect(
      planBulkUnavailability({
        activeDays,
        dayOfWeek: 9,
        startTime: "08:00",
        endTime: "09:00",
        existing: [],
      }),
    ).toEqual({ ok: false, reason: "invalid_time" });
  });
});

describe("LAUNCH-CLOSURE-01 gap 1 — write path keeps tenant scope and honest results", () => {
  const api = read("src/lib/availability/bulk-api.ts");
  const ui = read("src/routes/_authenticated/availability.tsx");

  test("RPC stays the primary path and the fallback runs only for a missing function", () => {
    expect(api).toContain("upsert_instructor_unavailability_for_active_days");
    expect(api).toContain("upsert_room_unavailability_for_active_days");
    expect(api).toContain(
      "if (!isMissingRpcError(error)) throw new Error(readableWriteError(error))",
    );
  });

  test("fallback reads and writes are college scoped and never privileged", () => {
    for (const fragment of [
      '.eq("college_id", input.collegeId)',
      '.eq("instructor_id", input.instructorId)',
      '.eq("room_id", input.roomId)',
      "college_id: input.collegeId",
    ]) {
      expect(api).toContain(fragment);
    }
    expect(api).not.toContain("client.server");
    expect(api).not.toContain("supabaseAdmin");
    expect(api).not.toContain("SERVICE_ROLE");
  });

  test("fallback inserts every planned day in one statement", () => {
    expect(api).toContain('.from("instructor_availability").insert(rows)');
    expect(api).toContain('.from("room_unavailability").insert(rows)');
  });

  test("deletes are college scoped and cannot report success on zero rows", () => {
    expect(ui).toContain('.eq("college_id", active.id)');
    expect(ui).toContain("لم يُحذف أي سجل");
    expect(ui.includes("String(e)")).toBe(false);
    expect(ui).toContain("readableWriteError");
  });

  test("a failed save refetches instead of leaving stale UI", () => {
    expect(ui).toContain('qc.invalidateQueries({ queryKey: ["iu", active?.id, instructorId] })');
    expect(ui).toContain('qc.invalidateQueries({ queryKey: ["ru", active?.id, roomId] })');
  });
});

describe("LAUNCH-CLOSURE-01 gap 2 — hydration-safe authenticated gate", () => {
  const gate = read("src/routes/_authenticated/route.tsx");

  test("the subtree stays client-only and the first render matches the empty SSR shell", () => {
    expect(gate).toContain("ssr: false");
    expect(gate).toContain("if (!hydrated) return null;");
    expect(gate).toContain("setHydrated(true)");
  });

  test("the redirect is a post-hydration navigation, not a beforeLoad throw", () => {
    expect(gate).not.toContain("beforeLoad");
    expect(gate).not.toContain("throw redirect");
    expect(gate).toContain('navigate({ to: "/auth", replace: true })');
  });

  test("no hydration warning is suppressed and no error is hidden", () => {
    expect(gate).not.toContain("suppressHydrationWarning");
    expect(gate).not.toContain("typeof window");
  });

  test("the session check still uses getUser, so the guard is not weakened", () => {
    expect(gate).toContain("supabase.auth.getUser()");
    expect(gate).toContain("if (error || !data.user)");
  });
});

describe("LAUNCH-CLOSURE-01 gap 3 — approved timetable print flow", () => {
  const published = read("src/routes/_authenticated/published-schedules.tsx");
  const css = read("src/styles.css");
  const sheet = read("src/components/print-center/print-sheet.tsx");

  test("published schedules link straight to the printable timetable", () => {
    expect(published).toContain('to="/timetable/$versionId/print"');
    expect(published).toContain('data-testid="published-print-link"');
    expect(published).toContain("طباعة وتصدير");
  });

  test("print CSS releases scroll containers that used to clip wide sheets", () => {
    expect(css).toContain('.report-print-body [class*="overflow-auto"]');
    expect(css).toContain('.print-center-page [class*="overflow-auto"]');
    expect(css).toContain("overflow: visible !important");
    expect(css).toContain("max-height: none !important");
  });

  test("print CSS repeats headers, avoids row splits and wraps long Arabic names", () => {
    expect(css).toContain("display: table-header-group");
    expect(css).toContain("break-inside: avoid");
    expect(css).toContain("word-break: break-word");
    expect(css).toContain("page-break-after: avoid");
  });

  test("each printed sheet still carries the identification a distributed copy needs", () => {
    for (const fragment of [
      "USR_UNIVERSITY_NAME_AR",
      "القسم:",
      "البرنامج:",
      "المستوى:",
      "النظام الدراسي:",
      "الفصل / العام:",
      "حالة النسخة:",
      "رقم / اسم النسخة:",
      "تاريخ التصدير:",
      "صفحة {meta.pageIndex} من {meta.pageCount}",
    ]) {
      expect(sheet).toContain(fragment);
    }
  });

  test("draft sheets stay watermarked so only approved copies look official", () => {
    expect(sheet).toContain('meta.versionStatus === "draft"');
    expect(sheet).toContain("PRINT_DRAFT_WATERMARK_AR");
    expect(sheet).toContain("PRINT_PUBLISHED_ENDORSEMENT_AR");
    expect(sheet).toContain("PRINT_DEMO_FOOTER_WARNING_AR");
  });
});
