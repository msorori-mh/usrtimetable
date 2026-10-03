import { describe, expect, it } from "bun:test";
import {
  physicalSessionId,
  uniquePhysicalSessions,
} from "../src/lib/reports/program-timetable-shared";

describe("merged lecture copies", () => {
  it("resolves a cohort copy back to its physical session", () => {
    expect(physicalSessionId("s1")).toBe("s1");
    expect(physicalSessionId("s1:cohort-a:group-1")).toBe("s1");
    expect(physicalSessionId(null)).toBe("");
  });

  it("counts one lecture once, however many cohorts attend it", () => {
    const rows = [
      { id: "s1:cohort-a:g1", cohort: "a" },
      { id: "s2", cohort: "a" },
      { id: "s1:cohort-b:g1", cohort: "b" },
      { id: "s3:cohort-b:g2", cohort: "b" },
    ];
    expect(uniquePhysicalSessions(rows).map((r) => r.id)).toEqual([
      "s1:cohort-a:g1",
      "s2",
      "s3:cohort-b:g2",
    ]);
    expect(rows).toHaveLength(4);
  });
});
