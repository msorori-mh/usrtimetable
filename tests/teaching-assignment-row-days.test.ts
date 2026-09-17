import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  assignmentRowDaysLabel,
  currentScheduleVersionId,
  deliveryGroupDayMap,
} from "@/lib/teaching-assignments/assignment-row-days";

describe("currentScheduleVersionId", () => {
  it("prefers the newest published version", () => {
    expect(
      currentScheduleVersionId(
        [{ id: "pub-new" }, { id: "pub-old" }] as never,
        [{ id: "draft" }] as never,
      ),
    ).toBe("pub-new");
  });

  it("falls back to the newest working version, then null", () => {
    expect(currentScheduleVersionId([], [{ id: "draft" }] as never)).toBe("draft");
    expect(currentScheduleVersionId([], [])).toBeNull();
  });
});

describe("deliveryGroupDayMap", () => {
  it("collects unique days per group in Arabic week order", () => {
    const map = deliveryGroupDayMap([
      { delivery_group_id: "g1", day_of_week: 2 },
      { delivery_group_id: "g1", day_of_week: 6 },
      { delivery_group_id: "g1", day_of_week: 2 },
      { delivery_group_id: null, day_of_week: 1 },
      { delivery_group_id: "g2", day_of_week: null },
    ]);
    expect(map.get("g1")).toEqual([6, 2]);
    expect(map.has("g2")).toBe(false);
  });
});

describe("assignmentRowDaysLabel", () => {
  it("shows Arabic day names joined by an Arabic comma", () => {
    expect(assignmentRowDaysLabel([6, 1])).toBe("السبت، الاثنين");
    expect(assignmentRowDaysLabel([5])).toBe("الجمعة");
  });

  it("shows غير مسكن when no session exists", () => {
    expect(assignmentRowDaysLabel(undefined)).toBe("غير مسكن");
    expect(assignmentRowDaysLabel([])).toBe("غير مسكن");
  });
});

describe("teaching-assignments day column wiring", () => {
  const src = readFileSync("src/routes/_authenticated/teaching-assignments.tsx", "utf8");

  it("renders the day column next to program and study system", () => {
    expect(src).toContain(">اليوم</th>");
    expect(src).toContain('data-testid="ta-v2-row-day"');
    expect(src).toContain(">البرنامج</th>");
    expect(src).toContain(">نظام الدراسة</th>");
  });

  it("derives days from the current version sessions and stays search-compatible", () => {
    expect(src).toContain("currentScheduleVersionId");
    expect(src).toContain("deliveryGroupDayMap");
    expect(src).toContain("assignmentRowDaysLabel(sessionDays?.get(row.delivery_group_id))");
    expect(src).toContain(
      "filterRowsByInstructorName(workspace.data?.rows ?? [], instructorSearch)",
    );
  });
});
