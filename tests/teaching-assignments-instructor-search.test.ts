import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  filterRowsByInstructorName,
  instructorNameMatches,
  normalizeArabicName,
  summarizeInstructorAssignedHours,
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

describe("summarizeInstructorAssignedHours", () => {
  it("sums explicit split hours and sole-instructor fallback for the searched lecturer", () => {
    const summary = summarizeInstructorAssignedHours(
      [
        {
          component_hours: 3,
          instructors: [
            {
              instructor_name: "أحمد محمد",
              assigned_component_hours: null,
              is_active: true,
            },
          ],
        },
        {
          component_hours: 4,
          instructors: [
            {
              instructor_name: "أحمد محمد",
              assigned_component_hours: 1.5,
              is_active: true,
            },
            {
              instructor_name: "سارة علي",
              assigned_component_hours: 2.5,
              is_active: true,
            },
          ],
        },
        {
          component_hours: 2,
          instructors: [
            {
              instructor_name: "أحمد محمد",
              assigned_component_hours: 2,
              is_active: false,
            },
          ],
        },
      ],
      "احمد",
    );

    expect(summary.totalHours).toBe(4.5);
    expect(summary.matchedInstructors).toEqual(["أحمد محمد"]);
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
    expect(src).toContain("filterRowsByInstructorName(courseRows, instructorSearch)");
    expect(src).toContain("instructorSearchActive");
  });

  it("shows the instructor assigned-hours summary while searching", () => {
    expect(src).toContain('data-testid="ta-v2-instructor-hours-summary"');
    expect(src).toContain("إجمالي الساعات المسندة");
    expect(src).toContain("summarizeInstructorAssignedHours");
  });

  it("shows the no-matching-instructor message and export filter", () => {
    expect(src).toContain("لا توجد مجموعات مطابقة لبحث المقرر أو المحاضر.");
    expect(src).toContain('label: "اسم المحاضر"');
  });

  it("shows program and study system from row and shared-cohort context", () => {
    expect(src).toContain(">البرنامج</th>");
    expect(src).toContain(">نظام الدراسة</th>");
    expect(src).toContain("assignmentRowAcademicContext");
    expect(src).toContain('data-testid="ta-v2-row-program"');
    expect(src).toContain('data-testid="ta-v2-row-study-system"');
  });
});
