import test from "node:test";
import assert from "node:assert/strict";
import {
  assertIsolatedStagingPilot,
  PROTECTED_ACCEPTED_SCHEDULE_VERSION_ID,
} from "../src/lib/environment/staging-pilot-guard";

const isolatedDraft = {
  projectRef: "test-project-ref-not-production",
  scheduleVersionId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  scheduleVersionStatus: "draft",
  disposableTest: true,
};

test("accepts only an isolated disposable draft", () => {
  assert.deepEqual(assertIsolatedStagingPilot(isolatedDraft), {
    ok: true,
    environment: "isolated_staging",
    cleanupRequired: true,
  });
});

test("blocks the known production project even if an old document labels it staging", () => {
  const result = assertIsolatedStagingPilot({
    ...isolatedDraft,
    projectRef: "emzytxqkxjjhsivqxdiu",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "PILOT_PRODUCTION_PROJECT_BLOCKED");
});

test("blocks missing runtime identity", () => {
  const result = assertIsolatedStagingPilot({ ...isolatedDraft, projectRef: "" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "PILOT_PROJECT_REF_MISSING");
});

test("blocks protected, non-draft and unmarked schedule versions", () => {
  const protectedResult = assertIsolatedStagingPilot({
    ...isolatedDraft,
    scheduleVersionId: PROTECTED_ACCEPTED_SCHEDULE_VERSION_ID,
  });
  const publishedResult = assertIsolatedStagingPilot({
    ...isolatedDraft,
    scheduleVersionStatus: "published",
  });
  const unmarkedResult = assertIsolatedStagingPilot({
    ...isolatedDraft,
    disposableTest: false,
  });

  assert.equal(protectedResult.ok, false);
  assert.equal(publishedResult.ok, false);
  assert.equal(unmarkedResult.ok, false);
  if (!protectedResult.ok) assert.equal(protectedResult.code, "PILOT_PROTECTED_VERSION_BLOCKED");
  if (!publishedResult.ok) assert.equal(publishedResult.code, "PILOT_VERSION_NOT_DRAFT");
  if (!unmarkedResult.ok) assert.equal(unmarkedResult.code, "PILOT_VERSION_NOT_DISPOSABLE");
});
