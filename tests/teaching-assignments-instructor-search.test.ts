import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  filterRowsByInstructorName,
  instructorNameMatches,
  normalizeArabicName,
} from "@/lib/teaching-assignments/instructor-name-search";

const row = (id: string, names: (string | null)[]) => ({
  delivery_group_id: id,
  instructors: names.map((n) => ({ instructor_name: n })),
});

const rows = [
  row("g1", ["أحمد محمد الشامي"]),
  row("g2", ["سَارَة العتيبي", "خالد"]),
  row("g3", []),
  row("g4", [null]),
];

describe("normalizeArabicName", () => {
  it("removes diacritics and tatweel, unifies alef/ya/ta-marbuta", () => {
    expect(normalizeArabicName("  أَحْمَد ")).toBe("احمد");
    expect(normalizeArabicName("عـلي")).toBe("علي");
    expect(normalizeArabicName("إبراهيم")).toBe("ابراهيم");
    expect(normalizeArabicName("موسى")).toBe("موسي");
    expect(normalizeArabicName("فاطمة")).toBe("فاطمه");
  });
});

describe("instructorNameMatches", () => {
  it("matches partial names tolerantly", () => {
    expect(instructorNameMatches("أحمد محمد الشامي", "احمد")).toBe(true);
    expect(instructorNameMatches("أحمد محمد الشامي", "الشامي")).toBe(true);
    expect(instructorNameMatches("سَارَة العتيبي", "ساره")).toBe(true);
    expect(instructorNameMatches("أحمد", "خالد")).toBe(false);
  });

  it("treats empty query as match-all", () => {
    expect(instructorNameMatches(null, "")).toBe(true);
    expect(instructorNameMatches(null, "   ")).toBe(true);
  });
});

describe("filterRowsByInstructorName", () => {
  it("keeps only groups containing a matching instructor", () => {
    expect(filterRowsByInstructorName(rows, "احمد").map((r) => r.delivery_group_id)).toEqual([
      "g1",
    ]);
    expect(filterRowsByInstructorName(rows, "ساره").map((r) => r.delivery_group_id)).toEqual([
      "g2",
    ]);
  });

  it("returns all rows for an empty query", () => {
    expect(filterRowsByInstructorName(rows, "")).toHaveLength(4);
  });

  it("returns no rows when nothing matches", () => {
    expect(filterRowsByInstructorName(rows, "غير موجود")).toEqual([]);
  });
});

describe("teaching-assignments page wiring", () => {
  const src = readFileSync("src/routes/_authenticated/teaching-assignments.tsx", "utf8");

  it("renders the instructor search input with a stable test id", () => {
    expect(src).toContain('data-testid="ta-v2-instructor-search"');
    expect(src).toContain("البحث باسم المحاضر");
    expect(src).toContain("اكتب اسم المحاضر...");
  });

  it("derives visible rows from filterRowsByInstructorName", () => {
    expect(src).toContain(
      "filterRowsByInstructorName(workspace.data?.rows ?? [], instructorSearch)",
    );
    expect(src).toContain("instructorSearchActive");
  });

  it("shows the no-matching-instructor message and export filter", () => {
    expect(src).toContain("لا توجد إسنادات مطابقة لاسم المحاضر المدخل.");
    expect(src).toContain('label: "اسم المحاضر"');
  });
});
