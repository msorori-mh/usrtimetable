import { describe, expect, it } from "bun:test";
import {
  orderWeekDaysRtl,
  rtlDayRank,
  weeklyGridHourSlots,
  weeklyGridWindow,
} from "../src/lib/reports/weekly-grid-window";

describe("weekly grid week order (RTL)", () => {
  it("starts at Saturday and ends at Thursday, without Friday", () => {
    expect(orderWeekDaysRtl([0, 1, 2, 3, 4, 6])).toEqual([6, 0, 1, 2, 3, 4]);
    expect(orderWeekDaysRtl([2, 6, 0])).toEqual([6, 0, 2]);
    expect(orderWeekDaysRtl([0, 1, 2, 3, 4, 6])).not.toContain(5);
  });

  it("ranks Saturday first and Friday last", () => {
    expect(rtlDayRank(6)).toBe(0);
    expect(rtlDayRank(4)).toBe(5);
    expect(rtlDayRank(5)).toBeGreaterThan(rtlDayRank(4));
  });
});

describe("weekly grid hour window from scheduling settings", () => {
  it("uses the college day start/end (08:00–14:00), not 07:00–15:00", () => {
    const w = weeklyGridWindow({
      working_days: [0, 1, 2, 3, 4, 6],
      day_start_time: "08:00:00",
      day_end_time: "14:00:00",
    });
    expect(w.startHour).toBe(8);
    expect(w.endHour).toBe(14);
    expect(w.source).toBe("settings");
    expect(w.workingDays).toEqual([6, 0, 1, 2, 3, 4]);
    const labels = weeklyGridHourSlots(w).map((s) => s.label);
    expect(labels[0]).toBe("08:00");
    expect(labels).not.toContain("07:00");
    expect(labels).not.toContain("15:00");
    expect(labels).toHaveLength(6);
  });

  it("rounds a partial end hour up and keeps the window inside settings", () => {
    const w = weeklyGridWindow({ day_start_time: "08:30:00", day_end_time: "13:30:00" });
    expect(w.startHour).toBe(8);
    expect(w.endHour).toBe(14);
  });

  it("falls back to 08–14 when settings are missing or invalid", () => {
    expect(weeklyGridWindow(null)).toMatchObject({ startHour: 8, endHour: 14, source: "fallback" });
    expect(
      weeklyGridWindow({ day_start_time: "14:00:00", day_end_time: "08:00:00" }).source,
    ).toBe("fallback");
  });
});

describe("report grid wiring", () => {
  const fs = require("node:fs") as typeof import("node:fs");
  const grid = fs.readFileSync("src/components/reports/timetable-grid-report.tsx", "utf8");
  const view = fs.readFileSync("src/components/reports/report-timetable-view.tsx", "utf8");
  const printFilters = fs.readFileSync("src/lib/print-center/filters.ts", "utf8");

  it("grid renders RTL and takes days/hours from the shared helper", () => {
    expect(grid).toContain('dir="rtl"');
    expect(grid).toContain("weeklyGridHourSlots");
    expect(grid).toContain("WEEK_DAY_LABELS_AR");
    expect(grid).not.toContain("Math.max(7,");
  });

  it("the report view reads the college scheduling settings", () => {
    expect(view).toContain("useWeeklyGridWindow");
    expect(view).toContain("workingDays={window.workingDays}");
  });

  it("print output sorts by the same RTL week order", () => {
    expect(printFilters).toContain("rtlDayRank");
  });
});
