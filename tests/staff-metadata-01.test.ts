import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ACADEMIC_RANKS,
  EMPLOYMENT_TYPE_IMPORT_VALUES,
  EMPLOYMENT_TYPE_OPTIONS,
  UNKNOWN_EMPLOYMENT_TYPE,
  employmentTypeLabelAr,
  normalizeEmploymentType,
} from "../src/lib/instructor-metadata";
import { TEMPLATES } from "../src/lib/excel-import/templates";

const root = resolve(import.meta.dir, "..");

describe("STAFF-METADATA-01 instructor metadata truthfulness", () => {
  test("absent employment never becomes full_time", () => {
    expect(normalizeEmploymentType(undefined)).toBe(UNKNOWN_EMPLOYMENT_TYPE);
    expect(normalizeEmploymentType(null)).toBe(UNKNOWN_EMPLOYMENT_TYPE);
    expect(normalizeEmploymentType("")).toBe(UNKNOWN_EMPLOYMENT_TYPE);
    expect(normalizeEmploymentType("   ")).toBe(UNKNOWN_EMPLOYMENT_TYPE);
    expect(normalizeEmploymentType(undefined)).not.toBe("full_time");
  });

  test("explicit employment values are preserved verbatim", () => {
    for (const value of ["full_time", "part_time", "visiting", "contract"]) {
      expect(normalizeEmploymentType(value)).toBe(value);
      expect(normalizeEmploymentType(` ${value} `)).toBe(value);
    }
  });

  test("unknown renders as غير محدد and unrecognised values do not claim full-time", () => {
    expect(employmentTypeLabelAr(UNKNOWN_EMPLOYMENT_TYPE)).toBe("غير محدد (لم يُثبت بعد)");
    expect(employmentTypeLabelAr(null)).toBe("غير محدد (لم يُثبت بعد)");
    expect(employmentTypeLabelAr("weird")).toBe("غير محدد (لم يُثبت بعد)");
    expect(employmentTypeLabelAr("full_time")).toBe("متفرّغ");
  });

  test("unknown is the first shared option and part of import values", () => {
    expect(EMPLOYMENT_TYPE_OPTIONS[0]?.value).toBe(UNKNOWN_EMPLOYMENT_TYPE);
    expect(EMPLOYMENT_TYPE_IMPORT_VALUES).toContain(UNKNOWN_EMPLOYMENT_TYPE);
    expect(EMPLOYMENT_TYPE_IMPORT_VALUES).toContain("full_time");
  });

  test("ranks keep existing values and add مدرس / أستاذ دكتور", () => {
    for (const rank of ["معيد", "محاضر", "أستاذ مساعد", "أستاذ مشارك", "أستاذ"]) {
      expect(ACADEMIC_RANKS).toContain(rank);
    }
    expect(ACADEMIC_RANKS).toContain("مدرس");
    expect(ACADEMIC_RANKS).toContain("أستاذ دكتور");
  });

  test("instructors import template accepts unknown and free-text rank", () => {
    const cols = TEMPLATES.instructors!.columns;
    const emp = cols.find((c) => c.key === "employment_type")!;
    expect(emp.enumValues).toContain(UNKNOWN_EMPLOYMENT_TYPE);
    expect(emp.example).toBe("unknown");
    const rank = cols.find((c) => c.key === "academic_rank")!;
    expect(rank.enumValues).toBeUndefined();
  });

  test("import payload builder no longer hardcodes a full_time default", () => {
    const src = readFileSync(resolve(root, "src/lib/excel-import/validators.ts"), "utf8");
    expect(src.includes('v.employment_type ?? "full_time"')).toBe(false);
    expect(src.includes("normalizeEmploymentType(v.employment_type)")).toBe(true);
  });

  test("instructors page uses shared maps, unknown default and new labels", () => {
    const src = readFileSync(resolve(root, "src/routes/_authenticated/instructors.tsx"), "utf8");
    expect(src.includes("employment_type: UNKNOWN_EMPLOYMENT_TYPE")).toBe(true);
    expect(src.includes("حالة التفرغ/التعاقد")).toBe(false);
    expect(src.includes("<Label>الحالة</Label>")).toBe(true);
    expect(src.includes("employmentTypeLabelAr")).toBe(true);
    expect(src.includes("فئة المحاضر:")).toBe(true);
    expect(src.includes('employment_type: "full_time"')).toBe(false);
  });
});
