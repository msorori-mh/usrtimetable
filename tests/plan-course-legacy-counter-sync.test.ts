import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildLegacyCounterUpdate,
  countersDiffer,
  deriveLegacyCounters,
  pickSessionDuration,
  DEFAULT_SESSION_DURATION,
  LEGACY_SYNC_PARTIAL_ERROR_AR,
} from "@/lib/academic-delivery/plan-course-editor";

const current = {
  lectures_per_week: 0,
  lecture_session_duration: 2,
  labs_per_week: 0,
  lab_session_duration: 2,
};

describe("plan_courses legacy counter sync (E2E FIX 02)", () => {
  it("derives 1 lecture + 1 lab for theory 2h / practical 2h", () => {
    const c = deriveLegacyCounters(
      [
        { component_type: "theory", weekly_contact_hours: 2, is_timetabled: true },
        { component_type: "practical", weekly_contact_hours: 2, is_timetabled: true },
      ],
      current,
    );
    assert.deepEqual(c, {
      lectures_per_week: 1,
      lecture_session_duration: 2,
      labs_per_week: 1,
      lab_session_duration: 2,
    });
  });

  it("keeps counters × duration equal to weekly hours", () => {
    for (const h of [1, 2, 3, 4, 5, 6, 8]) {
      const c = deriveLegacyCounters(
        [{ component_type: "theory", weekly_contact_hours: h }],
        current,
      );
      assert.equal(c.lectures_per_week * c.lecture_session_duration, h);
    }
  });

  it("folds tutorial into lectures and ignores non-timetabled hours", () => {
    assert.equal(
      deriveLegacyCounters(
        [
          { component_type: "theory", weekly_contact_hours: 2 },
          { component_type: "tutorial", weekly_contact_hours: 2 },
          { component_type: "summer_training", weekly_contact_hours: 6, is_timetabled: false },
        ],
        current,
      ).lectures_per_week,
      2,
    );
  });

  it("zeroes counters on delete while keeping durations valid", () => {
    const c = deriveLegacyCounters([], { ...current, lectures_per_week: 2, labs_per_week: 1 });
    assert.equal(c.lectures_per_week, 0);
    assert.equal(c.labs_per_week, 0);
    assert.ok(c.lecture_session_duration > 0 && c.lab_session_duration > 0);
    assert.equal(deriveLegacyCounters([], null).lab_session_duration, DEFAULT_SESSION_DURATION);
  });

  it("restricts the update payload to the legacy scheduling columns", () => {
    assert.deepEqual(Object.keys(buildLegacyCounterUpdate(current)).sort(), [
      "lab_session_duration",
      "labs_per_week",
      "lecture_session_duration",
      "lectures_per_week",
    ]);
  });

  it("detects no-ops and stale rows", () => {
    assert.equal(countersDiffer(current, current), false);
    assert.equal(countersDiffer(current, { ...current, lectures_per_week: 1 }), true);
    assert.equal(pickSessionDuration(2, 0), DEFAULT_SESSION_DURATION);
  });

  it("has an actionable Arabic partial-failure message", () => {
    assert.ok(LEGACY_SYNC_PARTIAL_ERROR_AR.includes("مزامنة بيانات الجدولة"));
  });
});
