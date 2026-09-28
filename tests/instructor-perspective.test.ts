import { describe, expect, it } from "vitest";
import {
  buildExternalBusyGridSessions,
  buildInstructorAvailabilityOverlay,
  instructorSlotBlockReason,
  summarizeInstructorPlanningContext,
} from "@/lib/schedule-builder/instructor-perspective";

const windows = [
  {
    id: "available",
    instructor_id: "i1",
    day_of_week: 0,
    start_time: "08:00:00",
    end_time: "12:00:00",
    availability_type: "available",
    is_preference: false,
    notes: null,
  },
  {
    id: "blocked",
    instructor_id: "i1",
    day_of_week: 0,
    start_time: "10:00:00",
    end_time: "11:00:00",
    availability_type: "unavailable",
    is_preference: false,
    notes: null,
  },
  {
    id: "preferred",
    instructor_id: "i1",
    day_of_week: 1,
    start_time: "09:00:00",
    end_time: "11:00:00",
    availability_type: "available",
    is_preference: true,
    notes: null,
  },
] as const;

describe("instructor manual-builder context", () => {
  it("keeps availability informational until enforcement is enabled", () => {
    const advisory = buildInstructorAvailabilityOverlay({ enforced: false, windows });
    expect(advisory.available).toBeUndefined();
    expect(advisory.unavailable).toEqual([]);
    expect(advisory.preferred).toHaveLength(1);

    const enforced = buildInstructorAvailabilityOverlay({ enforced: true, windows });
    expect(enforced.available).toEqual([
      { day_of_week: 0, start_time: "08:00", end_time: "12:00" },
    ]);
    expect(enforced.unavailable).toEqual([
      { day_of_week: 0, start_time: "10:00", end_time: "11:00" },
    ]);
  });

  it("renders cross-college occupancy as immutable privacy-safe blocks", () => {
    const rows = buildExternalBusyGridSessions([
      {
        instructor_id: "i1",
        day_of_week: 2,
        start_time: "08:00:00",
        end_time: "10:00:00",
      },
    ]);
    expect(rows[0]).toMatchObject({
      session_type: "external_busy",
      title: "مشغول في كلية أخرى",
      readOnly: true,
    });
  });

  it("blocks external overlap and enforced hard-unavailable windows", () => {
    expect(
      instructorSlotBlockReason({
        dayOfWeek: 2,
        startTime: "09:00",
        endTime: "11:00",
        availabilityEnforced: false,
        availability: [],
        externalBusy: [
          {
            instructor_id: "i1",
            day_of_week: 2,
            start_time: "08:00",
            end_time: "10:00",
          },
        ],
      }),
    ).toContain("كلية أخرى");

    expect(
      instructorSlotBlockReason({
        dayOfWeek: 0,
        startTime: "10:00",
        endTime: "11:00",
        availabilityEnforced: true,
        availability: windows,
        externalBusy: [],
      }),
    ).toContain("محظور");
  });

  it("uses the strictest identity-alias policy for the preview", () => {
    const summary = summarizeInstructorPlanningContext(
      {
        local_record_ids: ["i1", "i2"],
        policy_records: [
          {
            id: "i1",
            availability_status: "available",
            max_hours_per_day: 8,
            target_attendance_days_per_week: 4,
            max_attendance_days_per_week: 5,
          },
          {
            id: "i2",
            availability_status: "available",
            max_hours_per_day: 6,
            target_attendance_days_per_week: 3,
            max_attendance_days_per_week: 4,
          },
        ],
        availability: [...windows],
        requests: [],
      },
      8,
    );
    expect(summary.dailyLimit).toBe(6);
    expect(summary.maxAttendanceDays).toBe(4);
    expect(summary.hardWindows).toBe(2);
  });
});
