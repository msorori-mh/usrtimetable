import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_AVAILABILITY_STATUS,
  INSTRUCTOR_AVAILABILITY_OPTIONS,
  availabilityStatusLabelAr,
  canReceiveNewWork,
  isInstructorAvailabilityStatus,
  newWorkBlockedMessage,
} from "../src/lib/instructor-metadata";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const migrationFiles = readdirSync(resolve(root, "supabase/migrations"));
const availabilityStatusMigration = read(
  "supabase/migrations/20260923202810_590c6d57-0224-4ed3-8e4e-404ae78ab73c.sql",
);
const migrations = migrationFiles
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

  test("available and internal scholarship may receive new work; message names the status", () => {
    expect(canReceiveNewWork("available")).toBe(true);
    expect(canReceiveNewWork("internal_scholarship")).toBe(true);
    for (const v of ["unavailable", "sick_leave", "sabbatical", "external_scholarship", null])
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
    expect(availabilityStatusMigration).toContain(
      "ADD COLUMN IF NOT EXISTS availability_status text",
    );
    expect(availabilityStatusMigration).toContain(
      "CASE WHEN is_active THEN 'available' ELSE 'unavailable' END",
    );
    expect(availabilityStatusMigration).toContain("SET DEFAULT 'available'");
    expect(availabilityStatusMigration).toContain("SET NOT NULL");
    expect(availabilityStatusMigration).toContain("instructors_availability_status_check");
    expect(availabilityStatusMigration).not.toMatch(/SET\s+employment_type/i);
    expect(availabilityStatusMigration).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(availabilityStatusMigration).not.toMatch(/SET\s+is_active/i);
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
