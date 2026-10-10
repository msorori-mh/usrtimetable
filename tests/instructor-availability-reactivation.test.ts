import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../supabase/migrations");
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
    expect(latestGuard).toContain(
      "BEFORE INSERT OR UPDATE OF instructor_id, is_active ON public.teaching_assignments",
    );
  });

  test("historical edits without reactivation or instructor change pass", () => {
    expect(latestGuard).toContain(
      "NEW.instructor_id IS NOT DISTINCT FROM OLD.instructor_id AND NOT v_reactivate THEN RETURN NEW",
    );
  });

  test("teaching-eligible statuses come from one predicate", () => {
    expect(latestGuard).toContain("v_status <> 'available'");
    const policy = readFileSync(
      resolve(dir, "20261010200000_internal_scholarship_can_teach.sql"),
      "utf8",
    );
    expect(policy).toContain("SELECT p_status IN ('available', 'internal_scholarship');");
    for (const fn of [
      "public.guard_new_work_requires_available_instructor()",
      "public.create_version_scoped_replacement_assignment(uuid,uuid,uuid,numeric)",
      "public.get_delivery_group_assignment_candidates(uuid)",
      "faculty_private.apply_create_assignment(uuid,uuid,numeric,text)",
    ])
      expect(policy).toContain(fn);
    expect(policy).toContain("INTERNAL_SCHOLARSHIP_MIGRATION_ANCHOR_MISSING");
    expect(policy).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(policy).not.toMatch(/\bUPDATE\s+public\.instructors\b/i);
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
