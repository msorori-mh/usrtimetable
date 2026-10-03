import { describe, expect, it } from "bun:test";
import type { PrintPageGroup } from "../src/lib/print-center/types";
import { sortProgramTimetablePages } from "../src/lib/reports/program-timetable-order";

type Page = PrintPageGroup & { programOrder: number };

function page(program: number, level: number | null, studySystem: string): Page {
  return {
    key: `p${program}:lvl:${level}|sys:${studySystem}`,
    title: `p${program} l${level} ${studySystem}`,
    studySystem,
    programOrder: program,
    sessions: [
      { course_offerings: level === null ? null : { academic_levels: { level_number: level } } },
    ] as Page["sessions"],
  };
}

describe("program/level timetable print order", () => {
  it("prints level one first, then level two, across all programs", () => {
    const input = [
      page(0, 2, "parallel"),
      page(0, 2, "regular"),
      page(0, 1, "parallel"),
      page(1, 4, "regular"),
      page(1, 1, "regular"),
      page(0, 1, "regular"),
      page(1, null, "regular"),
      page(1, 2, "regular"),
    ];
    const before = input.map((p) => p.key);

    expect(sortProgramTimetablePages(input, (p) => p.programOrder).map((p) => p.title)).toEqual([
      "p0 l1 regular",
      "p0 l1 parallel",
      "p1 l1 regular",
      "p0 l2 regular",
      "p0 l2 parallel",
      "p1 l2 regular",
      "p1 l4 regular",
      "p1 lnull regular",
    ]);
    // The caller's list is left as it was.
    expect(input.map((p) => p.key)).toEqual(before);
  });
});
