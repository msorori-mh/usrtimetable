import assert from "node:assert/strict";
import test from "node:test";
import { classifyResult, harnesses, runHarnesses } from "./run.mjs";

test("registers each focused harness exactly once", () => {
  assert.equal(new Set(harnesses).size, harnesses.length);
  assert(harnesses.includes("academic-cohort-legacy-section-adapter.harness.ts"));
  assert(harnesses.includes("conflict-exception-reporting.harness.ts"));
});

test("uses the local tsx CLI without a shell or package runner", () => {
  const calls = [];
  const code = runHarnesses({
    fileExists: () => true,
    out: { write() {} },
    spawn(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0, stdout: "", stderr: "" };
    },
  });

  assert.equal(code, 0);
  assert.equal(calls.length, harnesses.length);
  assert.equal(calls[0].command, process.execPath);
  assert.match(calls[0].args[0], /node_modules[\\/]tsx[\\/]dist[\\/]cli\.mjs$/);
  assert.equal(calls[0].options.shell, false);
});

test("separates an exact missing historical artifact from true failures", () => {
  const missing = classifyResult(
    "experimental-schedule-reset-room-integrity.harness.ts",
    { status: 1, stderr: "Error: post-apply verification SQL present (local report)" },
    () => false,
  );
  const realFailure = classifyResult(
    "experimental-schedule-reset-room-integrity.harness.ts",
    { status: 1, stderr: "Error: protected master data changed" },
    () => false,
  );

  assert.equal(missing, "missing-historical-artifact");
  assert.equal(realFailure, "fail");
});
