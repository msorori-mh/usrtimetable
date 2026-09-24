import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  assignmentRowDaysLabel,
  currentScheduleVersionId,
  deliveryGroupDayMap,
  sessionsForActiveAssignments,
  summarizeInstructorAttendanceDays,
} from "@/lib/teaching-assignments/assignment-row-days";

describe("currentScheduleVersionId", () => {
  it("skips an empty newest working version and picks the newest populated working version", () => {
    expect(
      currentScheduleVersionId(
        [{ id: "published" }] as never,
        [{ id: "empty-new" }, { id: "populated-working" }] as never,
        new Set(["populated-working", "published"]),
      ),
    ).toBe("populated-working");
  });

  it("falls back to populated published versions, then null", () => {
    expect(
      currentScheduleVersionId(
        [{ id: "published" }] as never,
        [{ id: "empty-working" }] as never,
        new Set(["published"]),
      ),
    ).toBe("published");
    expect(currentScheduleVersionId([], [], new Set())).toBeNull();
  });
});

describe("sessionsForActiveAssignments", () => {
  it("keeps only sessions linked to active teaching assignments", () => {
    const sessions = [
      {
        schedule_version_id: "v1",
        delivery_group_id: "g1",
        day_of_week: 1,
        teaching_assignment_id: "active",
      },
      {
        schedule_version_id: "v1",
        delivery_group_id: "g2",
        day_of_week: 2,
        teaching_assignment_id: "inactive",
      },
      {
        schedule_version_id: "v1",
        delivery_group_id: "g3",
        day_of_week: 3,
        teaching_assignment_id: null,
      },
    ];
    expect(sessionsForActiveAssignments(sessions, new Set(["active"]))).toEqual([sessions[0]]);
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
    expect(src).toContain("loadAssignmentSchedule");
    expect(src).toContain("assignmentRowDaysLabel(sessionDays?.get(row.delivery_group_id))");
    expect(src).toContain(
      "filterRowsByInstructorName(workspace.data?.rows ?? [], instructorSearch)",
    );
  });
});

describe("summarizeInstructorAttendanceDays", () => {
  const days = new Map<string, number[]>([
    ["g1", [6, 1]],
    ["g2", [1]],
    ["g3", [2]],
  ]);
  const rows = [
    {
      delivery_group_id: "g1",
      instructors: [{ instructor_name: "أحمد محمد" }],
    },
    {
      delivery_group_id: "g2",
      instructors: [{ instructor_name: "أَحمد محمد" }],
    },
    {
      delivery_group_id: "g4",
      instructors: [{ instructor_name: "أحمد محمد" }],
    },
    { delivery_group_id: "g3", instructors: [{ instructor_name: "سارة علي" }] },
    {
      delivery_group_id: "g3",
      instructors: [{ instructor_name: "أحمد محمد", is_active: false }],
    },
  ];

  it("counts each day once even with several lectures that day, ignoring unscheduled groups", () => {
    const summary = summarizeInstructorAttendanceDays(rows, "احمد", days);
    expect(summary.perInstructor).toEqual([{ name: "أحمد محمد", days: 2 }]);
    expect(summary.totalDays).toBe(2);
  });

  it("aggregates several matched instructors and stays empty without a query", () => {
    expect(summarizeInstructorAttendanceDays(rows, "ا", days).totalDays).toBe(3);
    expect(summarizeInstructorAttendanceDays(rows, "", days)).toEqual({
      totalDays: 0,
      perInstructor: [],
    });
    expect(summarizeInstructorAttendanceDays(rows, "احمد", undefined).totalDays).toBe(0);
  });
});

describe("attendance days card wiring", () => {
  const src = readFileSync("src/routes/_authenticated/teaching-assignments.tsx", "utf8");

  it("renders the attendance days element in the instructor summary card", () => {
    expect(src).toContain('data-testid="ta-v2-instructor-attendance-days"');
    expect(src).toContain('data-testid="ta-v2-instructor-attendance-days-value"');
    expect(src).toContain('<span dir="ltr" data-testid="ta-v2-instructor-attendance-days-value">');
    expect(src).toContain(">عدد أيام الحضور</p>");
    expect(src).toContain("summarizeInstructorAttendanceDays");
    expect(src).not.toContain("`أيام الحضور: ${attendanceDaysSummary.totalDays");
  });
});
