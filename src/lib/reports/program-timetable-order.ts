import type { PrintPageGroup } from "@/lib/print-center/types";

const SYSTEM_ORDER: Record<string, number> = { regular: 0, both: 1, parallel: 2 };

function levelNumber(page: PrintPageGroup): number {
  for (const session of page.sessions) {
    const n = session.course_offerings?.academic_levels?.level_number;
    if (typeof n === "number") return n;
  }
  return Number.MAX_SAFE_INTEGER;
}

/**
 * Printing order for the program/level timetable report: level one first, then
 * level two and so on; inside a level the programs keep the order of the
 * report's program list, and the regular timetable comes before the parallel
 * one. Pages without a known level go last. The input is not mutated.
 */
export function sortProgramTimetablePages<T extends PrintPageGroup>(
  pages: readonly T[],
  programIndex: (page: T) => number,
): T[] {
  return pages
    .map((page, index) => ({ page, index, level: levelNumber(page) }))
    .sort(
      (a, b) =>
        a.level - b.level ||
        programIndex(a.page) - programIndex(b.page) ||
        (SYSTEM_ORDER[String(a.page.studySystem)] ?? 9) -
          (SYSTEM_ORDER[String(b.page.studySystem)] ?? 9) ||
        a.index - b.index,
    )
    .map((entry) => entry.page);
}
