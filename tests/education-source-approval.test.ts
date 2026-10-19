import assert from "node:assert/strict";
import test from "node:test";
import {
  educationSourceTimetableApprovalPercent,
  isEducationSourcePublication,
  setEducationSourcePublications,
} from "../src/lib/schedule-versions/education-publication";

// Fixture ids (production markers are rows of public.scheduling_policy_exceptions).
const EDUCATION_SOURCE_PUBLICATION_VERSION_ID = "11111111-1111-4111-8111-111111111111";
const EDUCATION_SOURCE_IDENTITY_REVISION_ID = "22222222-2222-4222-8222-222222222222";
const EDUCATION_SOURCE_PUBLICATION_TERM_ID = "33333333-3333-4333-8333-333333333333";
setEducationSourcePublications([
  {
    version_id: EDUCATION_SOURCE_PUBLICATION_VERSION_ID,
    college_id: "c",
    term_id: EDUCATION_SOURCE_PUBLICATION_TERM_ID,
    role: "source",
  },
  {
    version_id: EDUCATION_SOURCE_IDENTITY_REVISION_ID,
    college_id: "c",
    term_id: EDUCATION_SOURCE_PUBLICATION_TERM_ID,
    role: "identity_revision",
  },
]);

test("publication markers are data", () => {
  assert.equal(isEducationSourcePublication(EDUCATION_SOURCE_PUBLICATION_VERSION_ID), true);
  assert.equal(isEducationSourcePublication("other-version"), false);
  assert.equal(
    isEducationSourcePublication(EDUCATION_SOURCE_IDENTITY_REVISION_ID, "other-term"),
    false,
  );
});

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
