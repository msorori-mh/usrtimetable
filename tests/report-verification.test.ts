import test from "node:test";
import assert from "node:assert/strict";
import {
  publicVerificationUrl,
  reportVerificationSource,
} from "../src/lib/reports/verification-link";
const id = "276aba86-83ea-4039-8ee2-e08b364a17d0";
test("strip internal URLs, people filters and authentication parameters", () => {
  assert.deepEqual(
    reportVerificationSource(
      `https://example.test/reports/instructor-schedule?versionId=${id}&instructor=private&access_token=secret#refresh_token=secret`,
    ),
    { versionId: id, kind: "instructor" },
  );
  assert.equal(
    publicVerificationUrl("https://example.test/reports?access_token=secret", id),
    `https://example.test/verify-report?ref=${id}`,
  );
  assert.equal(
    publicVerificationUrl("https://example.test", "javascript:alert(1)"),
    "https://example.test/verify-report",
  );
});
test("print center and invalid references", () => {
  assert.deepEqual(
    reportVerificationSource(`https://example.test/timetable/${id}/print?type=student`),
    { versionId: id, kind: "student" },
  );
  assert.deepEqual(
    reportVerificationSource("https://example.test/reports/rooms-report?versionId=invalid"),
    { versionId: null, kind: "room" },
  );
});
