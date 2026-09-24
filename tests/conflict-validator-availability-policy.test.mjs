import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../src/lib/conflict-engine/validator.ts", import.meta.url),
  "utf8",
);

test("conflict validation reads the college availability policy", () => {
  assert.match(source, /\.from\("scheduling_settings"\)/);
  assert.match(source, /\.select\("enforce_instructor_availability"\)/);
  assert.match(
    source,
    /isInstructorAvailabilityEnforced\(\s*schedulingSettings\.enforce_instructor_availability/,
  );
});

test("availability checks use the resolved college policy, not the global default", () => {
  const defaultCalls =
    source.match(/isInstructorAvailabilityEnforced\(\)/g) ?? [];
  assert.equal(defaultCalls.length, 0);
  assert.match(source, /if \(!enforceInstructorAvailability\)/);
});
