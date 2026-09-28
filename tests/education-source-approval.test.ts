import assert from "node:assert/strict";
import test from "node:test";
import {
  EDUCATION_SOURCE_PUBLICATION_TERM_ID,
  EDUCATION_SOURCE_PUBLICATION_VERSION_ID,
  EDUCATION_SOURCE_IDENTITY_REVISION_ID,
  educationSourceTimetableApprovalPercent,
} from "../src/lib/schedule-versions/education-publication";

const published = {
  version_id: EDUCATION_SOURCE_PUBLICATION_VERSION_ID,
  term_id: EDUCATION_SOURCE_PUBLICATION_TERM_ID,
  term_state: "ready",
  required_hours: 722,
  teaching_hours: 722,
  sessions_count: 339,
};

test("approves exactly the published Education term when hours and names are complete", () => {
  assert.equal(educationSourceTimetableApprovalPercent(published, 100), 100);
});

test("preserves approval evidence for the sealed identity-only correction", () => {
  const corrected = { ...published, version_id: EDUCATION_SOURCE_IDENTITY_REVISION_ID };
  assert.equal(educationSourceTimetableApprovalPercent(corrected, 100), 100);
  assert.equal(educationSourceTimetableApprovalPercent(corrected, 95), 95);
  assert.equal(
    educationSourceTimetableApprovalPercent({ ...corrected, term_id: "another-term" }, 100),
    null,
  );
});

test("fails closed outside this version and term or with incomplete evidence", () => {
  assert.equal(
    educationSourceTimetableApprovalPercent(
      { ...published, term_id: "00000000-0000-4000-8000-000000000001" },
      100,
    ),
    null,
  );
  assert.equal(
    educationSourceTimetableApprovalPercent(
      { ...published, version_id: "00000000-0000-4000-8000-000000000002" },
      100,
    ),
    null,
  );
  assert.equal(
    educationSourceTimetableApprovalPercent({ ...published, term_state: "missing" }, 100),
    null,
  );
  assert.equal(
    educationSourceTimetableApprovalPercent({ ...published, required_hours: null }, 100),
    null,
  );
  assert.equal(
    educationSourceTimetableApprovalPercent({ ...published, teaching_hours: 723 }, 100),
    null,
  );
  assert.equal(
    educationSourceTimetableApprovalPercent({ ...published, sessions_count: 0 }, 100),
    null,
  );
  assert.equal(educationSourceTimetableApprovalPercent(published, null), null);
});

test("drops below 100 when scheduled hours or named sessions are incomplete", () => {
  assert.equal(
    educationSourceTimetableApprovalPercent({ ...published, teaching_hours: 700 }, 100),
    97,
  );
  assert.equal(educationSourceTimetableApprovalPercent(published, 95), 95);
});
