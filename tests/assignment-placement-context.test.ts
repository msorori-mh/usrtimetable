import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  assignmentRowPlacementLabel,
  assignmentRowsForVersion,
  parseAssignmentPlacementContext,
} from "@/lib/teaching-assignments/assignment-placement-context";

const groups = [
  { group_id: "anchor", in_version: true, shared_lecture: false, days: [2, 6, 2] },
  { group_id: "member", in_version: true, shared_lecture: true, days: [2] },
  { group_id: "missing", in_version: true, shared_lecture: false, days: [] },
  { group_id: "old-parent", in_version: false, shared_lecture: false, days: [] },
];
const context = () => parseAssignmentPlacementContext({ version_id: "v", groups }, "v");

describe("assignment placement display", () => {
  it("marks the member's inherited day as merged, without claiming another session", () => {
    const c = context();
    expect(c.get("anchor")?.days).toEqual([6, 2]);
    expect(assignmentRowPlacementLabel(c.get("member"), true)).toBe("الثلاثاء · مدموج");
  });
  it("keeps genuine missing groups visible and labels only out-of-version groups separately", () => {
    const c = context();
    expect(assignmentRowPlacementLabel(c.get("missing"), true)).toBe("غير مسكن");
    expect(assignmentRowPlacementLabel(c.get("old-parent"), true)).toBe("خارج هذه النسخة");
    expect(assignmentRowPlacementLabel(undefined, false)).toBe("غير مسكن");
    const rows = groups.map((g) => ({ delivery_group_id: g.group_id }));
    expect(assignmentRowsForVersion(rows, c, true).map((r) => r.delivery_group_id)).toEqual([
      "anchor",
      "member",
      "missing",
    ]);
    expect(assignmentRowsForVersion(rows, c, false)).toEqual(rows);
    expect(assignmentRowsForVersion(rows, undefined, true)).toEqual(rows);
  });
  it("does not mark an unscheduled shared lecture as placed", () => {
    expect(
      assignmentRowPlacementLabel({ inVersion: true, sharedLecture: true, days: [] }, true),
    ).toBe("غير مسكن · مدموج");
  });
  it("rejects failed, stale, duplicate and malformed context", () => {
    for (const value of [
      null,
      {},
      { version_id: "other", groups },
      { version_id: "v", groups: [...groups, groups[0]] },
      ...[
        null,
        { ...groups[0], days: [7] },
        { ...groups[0], days: ["2"] },
        { ...groups[0], in_version: null },
        { ...groups[0], group_id: "" },
        { ...groups[0], in_version: false },
      ].map((row) => ({ version_id: "v", groups: [row] })),
    ])
      expect(() => parseAssignmentPlacementContext(value, "v")).toThrow();
  });
  it("wires explicit-version filtering and distinguishes assignment completion", () => {
    const source = readFileSync("src/routes/_authenticated/teaching-assignments.tsx", "utf8");
    expect(source).toContain("assignmentRowsForVersion(");
    expect(source).toContain('fully_allocated: "الإسناد مكتمل"');
    expect(source).toContain("scheduleQuery.isError");
  });
});
