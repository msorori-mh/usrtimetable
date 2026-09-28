import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateInstructorSlotAvailability } from "@/lib/scheduling/instructor-slot-availability";

const slot = (overrides: Partial<Parameters<typeof evaluateInstructorSlotAvailability>[0]> = {}) =>
  evaluateInstructorSlotAvailability({
    enforce: true,
    startTime: "10:00",
    endTime: "12:00",
    windows: [],
    ...overrides,
  });

describe("canonical instructor availability semantics", () => {
  it("does not enforce saved windows while the college switch is disabled", () => {
    assert.deepEqual(
      slot({
        enforce: false,
        windows: [{ start_time: "08:00", end_time: "16:00", availability_type: "unavailable" }],
      }),
      { available: true, reason: "enforcement_disabled" },
    );
  });

  it("keeps permanent instructors available by default outside hard blacklist windows", () => {
    assert.deepEqual(slot(), { available: true, reason: "available" });
    assert.deepEqual(
      slot({
        windows: [{ start_time: "11:00", end_time: "13:00", availability_type: "unavailable" }],
      }),
      { available: false, reason: "blocked_window" },
    );
  });

  it("treats positive hard windows as a whitelist when they are present", () => {
    const windows = [{ start_time: "08:00", end_time: "11:00", availability_type: "available" }];
    assert.deepEqual(slot({ startTime: "09:00", endTime: "11:00", windows }), {
      available: true,
      reason: "available",
    });
    assert.deepEqual(slot({ windows }), {
      available: false,
      reason: "outside_available_window",
    });
  });

  it("requires an explicit positive window for external instructors", () => {
    assert.deepEqual(slot({ requiresExplicitPositiveWindow: true }), {
      available: false,
      reason: "explicit_availability_required",
    });
    assert.deepEqual(
      slot({
        requiresExplicitPositiveWindow: true,
        windows: [{ start_time: "08:00", end_time: "16:00", availability_type: "available" }],
      }),
      { available: true, reason: "available" },
    );
  });

  it("ignores preference rows during hard validation", () => {
    assert.deepEqual(
      slot({
        requiresExplicitPositiveWindow: true,
        windows: [
          {
            start_time: "08:00",
            end_time: "16:00",
            availability_type: "available",
            is_preference: true,
          },
        ],
      }),
      { available: false, reason: "explicit_availability_required" },
    );
  });
});
