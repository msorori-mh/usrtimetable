import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const dir = resolve(import.meta.dir, "../supabase/migrations");
const files = readdirSync(dir).sort();
const latestGuard = files
  .map((f) => readFileSync(resolve(dir, f), "utf8"))
  .filter((s) => s.includes("FUNCTION public.guard_new_work_requires_available_instructor()"))
  .pop()!;

describe("strict availability policy: reactivation + clone", () => {
  test("false→true reactivation of an assignment is checked against status", () => {
    expect(latestGuard).toContain("(to_jsonb(OLD)->>'is_active')::boolean IS NOT TRUE");
    expect(latestGuard).toContain("(to_jsonb(NEW)->>'is_active')::boolean IS TRUE");
    expect(latestGuard).toContain("إعادة تفعيل إسناد تدريسي");
    expect(latestGuard).toContain("instructor_availability_label_ar(v_status)");
    expect(latestGuard).toContain("BEFORE INSERT OR UPDATE OF instructor_id, is_active ON public.teaching_assignments");
  });

  test("historical edits without reactivation or instructor change pass", () => {
    expect(latestGuard).toContain(
      "NEW.instructor_id IS NOT DISTINCT FROM OLD.instructor_id AND NOT v_reactivate THEN RETURN NEW",
    );
  });

  test("available instructors are allowed; only non-available is rejected", () => {
    expect(latestGuard).toContain("v_status <> 'available'");
  });

  test("clone stays protected: session insert guard has no clone exemption", () => {
    expect(latestGuard).not.toMatch(/clone/i);
    const all = files.map((f) => readFileSync(resolve(dir, f), "utf8")).join("\n");
    expect(all).toContain("BEFORE INSERT OR UPDATE OF instructor_id ON public.schedule_sessions");
  });

  test("no data rewrite: no DELETE, no employment_type/is_active writes", () => {
    expect(latestGuard).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(latestGuard).not.toMatch(/SET\s+employment_type/i);
    expect(latestGuard).not.toMatch(/SET\s+is_active/i);
  });
});
