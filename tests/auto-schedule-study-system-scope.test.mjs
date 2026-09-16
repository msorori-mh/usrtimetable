import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  selectAutoScheduleScope,
  autoScheduleRunStatus,
} from "../src/lib/auto-scheduler/study-system-scope.ts";
const row = (id, study_system) => ({
  id,
  study_system,
  assignment_active: true,
  delivery_group_active: true,
  delivery_group_obsolete: false,
  expected_students: id === "shared" ? 106 : 50,
});
describe("auto-schedule study system scope", () => {
  it("keeps a same-system shared lecture once with full headcount and excludes parallel", () => {
    const shared = row("shared", "regular");
    const rows = [shared, row("p", "parallel"), row("r", "regular")];
    assert.deepEqual(selectAutoScheduleScope(rows, "regular"), [
      shared,
      rows[2],
    ]);
    assert.equal(
      selectAutoScheduleScope(rows, "regular")[0].expected_students,
      106,
    );
    assert.equal(rows.length, 3);
  });
  it("supports parallel and backward-compatible all-system runs", () => {
    const rows = [row("r", "regular"), row("p", "parallel"), row("b", "both")];
    assert.deepEqual(selectAutoScheduleScope(rows.slice(0, 2), "parallel"), [
      rows[1],
    ]);
    assert.deepEqual(selectAutoScheduleScope(rows, "all"), rows);
  });
  it("refuses cross-system shared work before a single-system run", () => {
    for (const scope of ["regular", "parallel"]) {
      assert.throws(() => selectAutoScheduleScope([row("b", "both")], scope));
    }
  });
  it("does not let an inactive historical shared assignment block a run", () => {
    assert.equal(
      selectAutoScheduleScope(
        [
          { ...row("b", "both"), assignment_active: false },
          row("r", "regular"),
        ],
        "regular",
      ).length,
      1,
    );
  });
  it("rejects invalid scope and preserves whole-version completion semantics", () => {
    assert.throws(() => selectAutoScheduleScope([], "invalid"));
    assert.equal(autoScheduleRunStatus("regular", true), "partial");
    assert.equal(autoScheduleRunStatus("parallel", true), "partial");
    assert.equal(autoScheduleRunStatus("all", false), "partial");
    assert.equal(autoScheduleRunStatus("all", true), "completed");
  });
});
