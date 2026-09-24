import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  DEFAULT_AVAILABILITY_STATUS,
  INSTRUCTOR_AVAILABILITY_OPTIONS,
  availabilityStatusLabelAr,
  canReceiveNewWork,
  isInstructorAvailabilityStatus,
  newWorkBlockedMessage,
} from "../src/lib/instructor-metadata";

const root = resolve(import.meta.dir, "..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const migrations = readdirSync(resolve(root, "supabase/migrations"))
  .map((f) => read(`supabase/migrations/${f}`))
  .filter((sql) => sql.includes("availability_status"))
  .join("\n");

describe("instructor availability status (الحالة)", () => {
  test("six options in the approved order and spelling", () => {
    expect(INSTRUCTOR_AVAILABILITY_OPTIONS.map((o) => o.label)).toEqual([
      "متوفر",
      "غير متوفر",
      "إجازة مرضية",
      "تفرغ علمي",
      "إبتعاث خارجي",
      "إبتعاث داخلي",
    ]);
    expect(INSTRUCTOR_AVAILABILITY_OPTIONS.map((o) => o.value)).toEqual([
      "available",
      "unavailable",
      "sick_leave",
      "sabbatical",
      "external_scholarship",
      "internal_scholarship",
    ]);
    expect(DEFAULT_AVAILABILITY_STATUS).toBe("available");
  });

  test("only available may receive new work; message names the status", () => {
    expect(canReceiveNewWork("available")).toBe(true);
    for (const v of [
      "unavailable",
      "sick_leave",
      "sabbatical",
      "external_scholarship",
      "internal_scholarship",
      null,
    ])
      expect(canReceiveNewWork(v)).toBe(false);
    expect(newWorkBlockedMessage("sick_leave")).toContain("إجازة مرضية");
    expect(availabilityStatusLabelAr("sabbatical")).toBe("تفرغ علمي");
    expect(isInstructorAvailabilityStatus("bogus")).toBe(false);
  });

  test("form shows الحالة, hides التفرغ/التعاقد, saves and reloads the status", () => {
    const src = read("src/routes/_authenticated/instructors.tsx");
    expect(src).toContain("<Label>الحالة</Label>");
    expect(src).not.toContain("حالة التفرغ/التعاقد");
    expect(src).toContain("INSTRUCTOR_AVAILABILITY_OPTIONS.map");
    expect(src).toContain("p_availability_status: payload.availability_status");
    expect(src).toContain(
      "availability_status: i.availability_status ?? DEFAULT_AVAILABILITY_STATUS",
    );
    // employment_type is preserved from the record on edit, never cleared.
    expect(src).toContain("employment_type: i.employment_type,");
    expect(src).toContain("employment_type: form.employment_type || UNKNOWN_EMPLOYMENT_TYPE");
  });

  test("migration: separate column, CHECK, default, backfill, no employment_type rewrite", () => {
    expect(migrations).toContain("ADD COLUMN IF NOT EXISTS availability_status text");
    expect(migrations).toContain("CASE WHEN is_active THEN 'available' ELSE 'unavailable' END");
    expect(migrations).toContain("SET DEFAULT 'available'");
    expect(migrations).toContain("SET NOT NULL");
    expect(migrations).toContain("instructors_availability_status_check");
    expect(migrations).not.toMatch(/SET\s+employment_type/i);
    expect(migrations).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(migrations).not.toMatch(/SET\s+is_active/i);
  });

  test("DB guard blocks only new work; existing rows are untouched", () => {
    expect(migrations).toContain(
      "BEFORE INSERT OR UPDATE OF instructor_id ON public.teaching_assignments",
    );
    expect(migrations).toContain(
      "BEFORE INSERT OR UPDATE OF instructor_id ON public.schedule_sessions",
    );
    expect(migrations).toContain(
      "NEW.instructor_id IS NOT DISTINCT FROM OLD.instructor_id THEN RETURN NEW",
    );
    expect(migrations).toContain("i.availability_status = ''available''");
  });
});
