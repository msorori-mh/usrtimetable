/**
 * Track C client contracts (Q-2, H-6/M-19, H-8, L-11, M-12). Pure modules only.
 */
import { describe, expect, test } from "bun:test";
import {
  mapServerValidation,
  parseHardConflictDetails,
  sessionWriteErrorMessageAr,
} from "../src/lib/conflict-engine/server-conflicts";
import {
  dedupeConflicts,
  effectiveExpectedStudents,
} from "../src/lib/conflict-engine/conflict-dedupe";
import {
  buildManualSessionPayload,
  MANUAL_SESSION_FIELDS,
} from "../src/lib/schedule-versions/session-payload";
import {
  isScheduleVersionWriteLocked,
  isSessionDialogReadOnly,
} from "../src/lib/schedule-builder/access";
import {
  canEnterEditMode,
  isScheduleVersionEditableStatus,
} from "../src/lib/schedule-builder/edit-access";
import type { Conflict } from "../src/lib/conflict-engine/validator";

describe("Q-2: the UI shows the server-computed gate counts", () => {
  test("maps validate_schedule_version payload", () => {
    const v = mapServerValidation({
      version_id: "v",
      session_count: 3,
      hard_count: 1,
      approved_count: 1,
      waived_count: 1,
      total_hard_count: 2,
      soft_count: 1,
      conflicts: [
        {
          code: "room_conflict",
          severity: "hard",
          schedule_session_id: "a",
          related_session_id: "b",
          approved_exception: false,
        },
        {
          code: "instructor_conflict",
          severity: "hard",
          schedule_session_id: "a",
          approved_exception: true,
          exception_id: "e",
        },
        {
          code: "delivery_group_conflict",
          severity: "soft",
          schedule_session_id: "c",
          related_session_id: "d",
          waived: true,
          approved_exception: false,
        },
      ],
    });
    expect(v.hardCount).toBe(1);
    expect(v.hardConflicts.map((c) => c.code)).toEqual(["room_conflict"]);
    expect(v.approvedExceptions.map((c) => c.exception_id)).toEqual(["e"]);
    expect(v.warnings[0].metadata?.waived).toBe(true);
    expect(v.hardConflicts[0].message_ar).toContain("القاعة");
    expect(v.warnings[0].message_ar).toContain("طلاب");
  });

  test("structured SCHEDULE_HARD_CONFLICTS details are parsed into conflicts", () => {
    const list = parseHardConflictDetails(
      JSON.stringify([
        { code: "itcs_theory_after_14", severity: "hard", schedule_session_id: "x" },
      ]),
    );
    expect(list).toHaveLength(1);
    expect(list[0].message_ar).toContain("2 ظهرًا");
    expect(parseHardConflictDetails("not json")).toEqual([]);
    expect(sessionWriteErrorMessageAr("SCHEDULE_HARD_CONFLICTS")).toContain("تعارضات إلزامية");
    expect(sessionWriteErrorMessageAr("STALE_SESSION")).toContain("تغيرت");
    expect(sessionWriteErrorMessageAr("VERSION_LOCKED:approved")).toContain("مسودة جديدة");
  });
});

describe("H-6 / M-19: explicit whitelist payload", () => {
  const form = {
    course_offering_id: "o",
    teaching_assignment_id: null,
    instructor_id: "i",
    room_id: "r",
    section_id: null,
    section_group_id: null,
    study_system: "regular" as const,
    day_of_week: 2,
    start_time: "08:00",
    end_time: "10:00",
    session_type: "lecture",
    expected_students: 30,
    is_locked: false,
    lock_reason: "ignored when unlocked",
  };
  test("only whitelisted fields are sent, never a spread row", () => {
    const row = {
      ...form,
      id: "s",
      college_id: "other",
      updated_at: "x",
      source_type: "auto_generated",
    };
    const payload = buildManualSessionPayload(row);
    expect(Object.keys(payload).sort()).toEqual([...MANUAL_SESSION_FIELDS].sort());
    expect(payload.start_time).toBe("08:00:00");
    expect(payload.lock_reason).toBeNull();
    expect(buildManualSessionPayload(form, "v").schedule_version_id).toBe("v");
  });
});

describe("H-8: approved versions are locked", () => {
  test("approved is write-locked and not editable", () => {
    expect(isScheduleVersionWriteLocked("approved")).toBe(true);
    expect(isScheduleVersionEditableStatus("approved")).toBe(false);
    expect(isScheduleVersionEditableStatus("review")).toBe(true);
    expect(isSessionDialogReadOnly({ canManageRole: true, versionStatus: "approved" })).toBe(true);
    expect(
      canEnterEditMode({
        canManageRole: true,
        hasActiveCollege: true,
        versionId: "v",
        versionStatus: "approved",
      }),
    ).toBe(false);
  });
});

describe("L-11 / M-12: client pre-check fixes", () => {
  const violation = (cohort: string): Conflict => ({
    code: "cohort_component_single_instructor",
    severity: "hard",
    message_ar: "",
    message_en: "",
    schedule_session_id: null,
    related_session_id: null,
    metadata: { cohort_id: cohort, plan_course_id: "p", component_type: "theory" },
  });
  test("distinct version-wide violations do not collapse", () => {
    expect(dedupeConflicts([violation("c1"), violation("c2"), violation("c1")])).toHaveLength(2);
  });
  test("a zero session headcount falls back to the offering (capacity still checked)", () => {
    expect(effectiveExpectedStudents(0, 45)).toBe(45);
    expect(effectiveExpectedStudents(null, 45)).toBe(45);
    expect(effectiveExpectedStudents(30, 45)).toBe(30);
    expect(effectiveExpectedStudents(0, null)).toBe(0);
  });
});
